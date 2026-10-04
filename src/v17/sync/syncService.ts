/**
 * Download → Parse → Detect writer → (legacy) Migrate → Validate → Merge per schema → Persist → Refresh Active Schema → Publish (stamped).
 * Each schema is independent; invalid remote data never replaces a valid local schema; content hashes ignore volatile metadata (no loops).
 */
import type { SchemaModel, PendingConflict, SyncLogEntry } from '../../types';
import { KEYS, readJson, writeJson, type KeyValueStore } from '../../services/storage';
import type { SchemaService } from '../../services/schemaService';
import type { SchemaRepository } from '../services/githubClient';
import { checkRegistry, serializeRegistry, describeIssue, summarizeMigration, WRITER_LABEL, type SchemaReport } from './schemaFormat';
import { redactSecrets } from '../errors/appErrors';
import { makeId } from '../../utils/id';
import { DEFAULT_SCHEMAS } from '../../data/defaultSchemas';
import { CANONICAL_SCHEMA_PATH, V1721_SCHEMA_PATH } from '../services/secretVault';
export interface RejectedSchema { name: string; legacy: boolean; location: string; reason: string; errors: string[]; total: number; }
export interface MigratedSchema { name: string; summary: string[]; warnings: string[]; }
export interface PullOutcome { ok: boolean; stage: string | null; fileProblem: string | null; path: string; remoteWriter: string; remoteLegacy: boolean; remoteMissing: boolean; added: string[]; updated: string[]; unchanged: string[]; localAhead: string[]; conflicts: PendingConflict[]; migrated: MigratedSchema[]; rejected: RejectedSchema[]; activeChanged: boolean; needsPublish: boolean; messages: string[]; }
export interface PushOutcome { ok: boolean; skipped?: string; messages: string[]; problems: string[]; }
const norm = (s: string) => s.trim().toLowerCase();
function fnv(s: string): string { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16) + s.length.toString(36); }
function canon(v: unknown): unknown { if (Array.isArray(v)) return v.map(canon); if (v && typeof v === 'object') { const o: Record<string, unknown> = {}; Object.keys(v).sort().forEach((k) => { const x = (v as Record<string, unknown>)[k]; if (x === undefined || x === null || x === false || x === '' || (Array.isArray(x) && !x.length)) return; o[k] = canon(x); }); return o; } return v; }
export function contentHash(s: Pick<SchemaModel, 'tables' | 'relationships'>): string { return fnv(JSON.stringify(canon({ t: s.tables.map((t) => ({ n: t.name, m: t.module, d: t.description, o: t.objectType || '', c: t.columns.map((c) => ({ ...c, label: c.label === c.name ? '' : c.label })) })), r: s.relationships.map((r) => [r.fromTable, r.fromColumn, r.toTable, r.toColumn, r.kind]) }))); }
let DEF: Set<string> | null = null; const isDefault = (h: string) => (DEF ||= new Set(DEFAULT_SCHEMAS.map(contentHash))).has(h);
export function rejectedFromReport(r: SchemaReport): RejectedSchema { const e = r.errors[0]; return { name: r.name, legacy: r.legacy, location: e ? (e.table ? `${e.table}${e.column ? `.${e.column}` : ''}` : e.path) : '(schema)', reason: e ? `${e.message} (at ${e.path})` : 'Unknown validation problem.', errors: r.errors.slice(0, 25).map(describeIssue), total: r.errors.length }; }
export const rejectionMessage = (x: RejectedSchema) => `${x.legacy ? 'Legacy schema migration could not be completed.' : `Schema "${x.name}" failed validation and was not loaded.`}\nSchema: ${x.name}\nLocation: ${x.location}\nReason: ${x.reason}${x.total > 1 ? ` (…and ${x.total - 1} more)` : ''}\n${x.legacy ? 'The existing valid local schema was preserved.' : 'Your local copy was kept unchanged.'}`;
export const migrationMessage = (m: MigratedSchema) => `Legacy schema detected.\nThe schema "${m.name}" was created by an older SQL Assistant version and required migration before synchronization.\nMigration completed successfully. The schema was validated and synchronized using the current schema format.${m.summary.length ? `\n• ${m.summary.join('\n• ')}` : ''}${m.warnings.length ? `\nAttention: ${m.warnings.join(' ')}` : ''}`;
export class SyncService {
  private busy: Promise<unknown> | null = null;
  constructor(private schemas: SchemaService, private repo: () => SchemaRepository | null, private store: KeyValueStore, private path: () => string, private secrets: () => string[] = () => []) {}
  private bases(): Record<string, string> { return readJson(this.store, KEYS.syncBase, {}); }
  meta(): { sha: string | null; path: string | null; lastPullAt: string | null; lastPushAt: string | null } { return readJson(this.store, KEYS.syncMeta, { sha: null, path: null, lastPullAt: null, lastPushAt: null }); }
  private setMeta(m: object) { writeJson(this.store, KEYS.syncMeta, { ...this.meta(), ...m }); }
  log(): SyncLogEntry[] { return readJson(this.store, KEYS.syncLog, []); }
  private addLog(kind: SyncLogEntry['kind'], message: string) { writeJson(this.store, KEYS.syncLog, [{ id: makeId('log'), timestamp: new Date().toISOString(), kind, message: redactSecrets(message, this.secrets()) }, ...this.log()].slice(0, 200)); }
  conflicts(): PendingConflict[] { return readJson(this.store, KEYS.conflicts, []); }
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> { while (this.busy) { try { await this.busy; } catch { /* */ } } const p = fn(); this.busy = p; try { return await p; } finally { this.busy = null; } }
  pull(): Promise<PullOutcome> { return this.exclusive(() => this.doPull()); }
  private async doPull(): Promise<PullOutcome> {
    const path = this.path(); const out: PullOutcome = { ok: false, stage: null, fileProblem: null, path, remoteWriter: '', remoteLegacy: false, remoteMissing: false, added: [], updated: [], unchanged: [], localAhead: [], conflicts: [], migrated: [], rejected: [], activeChanged: false, needsPublish: false, messages: [] };
    const fail = (stage: string, msg: string) => { out.stage = stage; out.fileProblem = redactSecrets(msg, this.secrets()); this.addLog('error', `${stage}: ${out.fileProblem}`); return out; };
    const repo = this.repo(); if (!repo) return fail('Configuration', 'Repository synchronization is not configured. Add the GitHub repository and token in Settings → Secret Vault.');
    let file; try { file = await repo.read(path); } catch (e) { return fail('Remote file retrieval failed', (e as Error).message); }
    if (!file) { for (const alt of [CANONICAL_SCHEMA_PATH, V1721_SCHEMA_PATH].filter((p) => p !== path)) { let f = null; try { f = await repo.read(alt); } catch { /* */ } if (f) return fail('Remote file location', `No schema file at "${path}", but one exists at "${alt}". Set the schema file path in Settings → Secret Vault to "${alt}" (or publish to create the file at "${path}").`); }
      out.ok = true; out.remoteMissing = true; out.needsPublish = true; return out; }
    const rep = checkRegistry({ text: file.text }); out.remoteWriter = rep.writer.label; out.remoteLegacy = rep.writer.legacy;
    if (rep.fileProblem) return fail('Remote file could not be parsed', `${rep.fileProblem.message} Your local schemas were kept unchanged.`);
    const local = this.schemas.registry(); const bases = this.bases(); const now = new Date().toISOString(); const schemas = local.schemas.map((s) => ({ ...s }));
    const conflicts = this.conflicts().filter((c) => !rep.validSchemas.some((r) => norm(r.name) === norm(c.schemaName)));
    rep.schemas.forEach((r) => {
      if (!r.valid || !r.schema) { out.rejected.push(rejectedFromReport(r)); return; }
      const rs = r.schema; const k = norm(rs.name); const rh = contentHash(rs);
      if (r.migrationStatus === 'migrated') out.migrated.push({ name: rs.name, summary: summarizeMigration(r.migrationNotes), warnings: rs.migration?.warnings || [] });
      const i = schemas.findIndex((s) => norm(s.name) === k);
      if (i < 0) { schemas.push({ ...rs, id: schemas.some((s) => s.id === rs.id) ? `${rs.id}-${Date.now().toString(36)}` : rs.id, status: 'inactive', lastSyncedAt: now }); bases[k] = rh; out.added.push(rs.name); return; }
      const ls = schemas[i]; const lh = contentHash(ls); const base = bases[k];
      if (lh === rh) { schemas[i] = { ...ls, lastSyncedAt: now, migration: ls.migration || rs.migration }; bases[k] = rh; out.unchanged.push(rs.name); return; }
      if ((base && lh === base) || (!base && (isDefault(lh) || r.migrationStatus === 'migrated' && !ls.lastSyncedAt))) { schemas[i] = { ...rs, id: ls.id, status: ls.status, lastSyncedAt: now }; bases[k] = rh; out.updated.push(rs.name); return; }
      if (base && rh === base) { out.localAhead.push(ls.name); return; }
      const c: PendingConflict = { id: makeId('cf'), schemaId: ls.id, schemaName: ls.name, remoteSchemaJson: JSON.stringify(rs), detectedAt: now }; conflicts.push(c); out.conflicts.push(c);
    });
    schemas.forEach((s) => { if (!rep.schemas.some((r) => r.schema && norm(r.schema.name) === norm(s.name)) && !out.rejected.some((x) => norm(x.name) === norm(s.name)) && !out.localAhead.includes(s.name)) out.localAhead.push(s.name); });
    let activeSchemaId = local.activeSchemaId; let activeSchemaUpdatedAt = local.activeSchemaUpdatedAt ?? null;
    const ra = rep.activeSchemaId ? rep.validSchemas.find((s) => s.id === rep.activeSchemaId) : undefined; const mapped = ra ? schemas.find((s) => norm(s.name) === norm(ra.name))?.id : undefined;
    if (mapped && mapped !== local.activeSchemaId && rep.activeSchemaUpdatedAt && (!local.activeSchemaUpdatedAt || rep.activeSchemaUpdatedAt > local.activeSchemaUpdatedAt)) { activeSchemaId = mapped; activeSchemaUpdatedAt = rep.activeSchemaUpdatedAt; out.activeChanged = true; }
    const saved = this.schemas.replaceRegistry({ schemas, activeSchemaId, activeSchemaUpdatedAt });
    if (!saved.ok) return fail('Persistence', `The synchronized schemas could not be saved locally: ${saved.errors.map((e) => `${e.message} ${(e.details || []).slice(0, 3).join(' ')}`).join(' ')} Your local schemas were kept unchanged.`);
    writeJson(this.store, KEYS.syncBase, bases); writeJson(this.store, KEYS.conflicts, conflicts); this.setMeta({ sha: file.sha, path, lastPullAt: now });
    out.ok = true; out.needsPublish = out.migrated.length > 0 || out.localAhead.length > 0 || rep.writer.legacy;
    out.migrated.forEach((m) => out.messages.push(migrationMessage(m)));
    if (out.rejected.length) out.messages.push(`${out.rejected.length} of ${rep.schemas.length} schema(s) in the repository failed validation and were not loaded — your local copies were kept unchanged.`, ...out.rejected.map(rejectionMessage));
    this.addLog('pull', `Pulled ${rep.schemas.length} schema(s) from ${path} (writer: ${rep.writer.label}): ${out.added.length} added, ${out.updated.length} updated, ${out.unchanged.length} unchanged, ${out.migrated.length} migrated, ${out.rejected.length} rejected.`);
    return out;
  }
  push(o: { allowReplacingInvalidRemote?: boolean } = {}): Promise<PushOutcome> { return this.exclusive(() => this.doPush(o)); }
  private async doPush(o: { allowReplacingInvalidRemote?: boolean }): Promise<PushOutcome> {
    const repo = this.repo(); const path = this.path(); if (!repo) return { ok: false, messages: [], problems: ['Repository synchronization is not configured.'] };
    // Publish protection: validate everything BEFORE touching the repository.
    const ser = serializeRegistry(this.schemas.registry(), deviceTag(this.store));
    if (!ser.ok) return { ok: false, messages: [], problems: ser.problems.map((p) => `Schema "${p.name}" is invalid and was not published: ${p.errors.slice(0, 3).map(describeIssue).join('; ')}`) };
    let remote; try { remote = await repo.read(path); } catch (e) { return { ok: false, messages: [], problems: [redactSecrets((e as Error).message, this.secrets())] }; }
    if (remote && remote.sha !== this.meta().sha) { const p = await this.doPull(); if (!p.ok) return { ok: false, messages: [], problems: [p.fileProblem || 'Pull before publish failed.'] }; if (p.conflicts.length) return { ok: false, skipped: 'conflicts', messages: p.messages, problems: [`${p.conflicts.length} schema conflict(s) must be resolved before publishing.`] }; remote = await repo.read(path); return this.write(repo, path, remote); }
    if (remote && !o.allowReplacingInvalidRemote) { const bad = checkRegistry({ text: remote.text }).invalidSchemas.filter((r) => !this.schemas.schemas().some((s) => norm(s.name) === norm(r.name))); if (bad.length) return { ok: false, skipped: 'remote-invalid', messages: [], problems: [`The repository contains ${bad.length} schema(s) that cannot be read (${bad.map((r) => `"${r.name}"`).join(', ')}); publishing would remove them. Use "Publish anyway" to replace them.`] }; }
    return this.write(repo, path, remote);
  }
  private async write(repo: SchemaRepository, path: string, remote: { sha: string } | null): Promise<PushOutcome> {
    const ser = serializeRegistry(this.schemas.registry(), deviceTag(this.store)); if (!ser.ok) return { ok: false, messages: [], problems: ['Local schemas became invalid during synchronization; nothing was published.'] };
    let sha: string; try { sha = await repo.write(path, ser.text, remote ? remote.sha : null, `${WRITER_LABEL}: publish ${this.schemas.schemas().length} validated schema(s)`); } catch (e) { const m = redactSecrets((e as Error).message, this.secrets()); this.addLog('error', m); return { ok: false, messages: [], problems: [m] }; }
    const b: Record<string, string> = {}; this.schemas.schemas().forEach((s) => { b[norm(s.name)] = contentHash(s); }); writeJson(this.store, KEYS.syncBase, b); this.setMeta({ sha, path, lastPushAt: new Date().toISOString() });
    this.addLog('push', `Published ${this.schemas.schemas().length} validated schema(s) to ${path}.`); return { ok: true, messages: [`Published ${this.schemas.schemas().length} validated schema(s) to ${path} using the current schema format.`], problems: [] };
  }
  async synchronize(): Promise<{ pull: PullOutcome; push: PushOutcome | null }> {
    const pull = await this.pull(); if (!pull.ok || !pull.needsPublish || pull.conflicts.length) return { pull, push: null };
    if (pull.rejected.length) return { pull, push: { ok: false, skipped: 'remote-invalid', messages: [], problems: ['Publishing was postponed because the repository still contains schema(s) that cannot be read; use "Publish anyway" after checking them.'] } };
    return { pull, push: await this.push() };
  }
  resolveConflict(id: string, choice: 'keep-local' | 'take-remote'): boolean {
    const c = this.conflicts().find((x) => x.id === id); if (!c) return false; const rs = JSON.parse(c.remoteSchemaJson) as SchemaModel; const b = this.bases();
    if (choice === 'take-remote') { const ls = this.schemas.byId(c.schemaId); if (!this.schemas.saveSchema({ ...rs, id: c.schemaId, status: ls?.status || 'inactive', lastSyncedAt: new Date().toISOString() }).ok) return false; }
    b[norm(rs.name)] = contentHash(rs); writeJson(this.store, KEYS.syncBase, b); writeJson(this.store, KEYS.conflicts, this.conflicts().filter((x) => x.id !== id)); return true;
  }
}
function deviceTag(s: KeyValueStore): string { let t = s.get('sqla.deviceTag.v15'); if (!t) { t = `device-${Math.random().toString(36).slice(2, 8)}`; s.set('sqla.deviceTag.v15', t); } return t; }
