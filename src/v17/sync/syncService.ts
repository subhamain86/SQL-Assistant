/**
 * Schema synchronization pipeline (V17.2.1).
 *
 *   Repository → Download → Parse → Detect writer/format → (legacy) Migrate → Normalize →
 *   Validate (strict) → Merge per schema → Persist (validated) → Active Schema refresh → Publish (stamped)
 *
 * - Every remote schema is processed independently: one bad schema never blocks the others.
 * - Invalid remote data never overwrites a valid local schema ("your local copies were kept unchanged").
 * - A successfully migrated legacy schema is persisted locally and marked for publishing, so the
 *   repository is rewritten in the current, stamped format and the migration does not repeat.
 * - Content hashes ignore volatile metadata (migration timestamps, sync times) so re-reading the
 *   same legacy file yields the same hash → no endless migration/publish loop.
 */
import type { SchemaModel, SchemaRegistry, PendingConflict, SyncLogEntry } from '../../types';
import { KEYS, readJson, writeJson, type KeyValueStore } from '../../services/storage';
import type { SchemaService } from '../../services/schemaService';
import type { SchemaRepository } from '../services/githubClient';
import { checkRegistry, serializeRegistry, describeIssue, summarizeMigration, type SchemaReport, type SchemaIssue } from './schemaFormat';
import { shouldApplyRemoteActiveSchema, getDeviceTag } from '../../engines/schemaVersionEngine';
import { redactSecrets } from '../errors/appErrors';
import { makeId } from '../../utils/id';
import { DEFAULT_SCHEMAS } from '../../data/defaultSchemas';

export interface RejectedSchema { name: string; legacy: boolean; location: string; reason: string; errors: string[]; total: number; }
export interface MigratedSchema { name: string; summary: string[]; warnings: string[]; }
export interface PullOutcome {
  ok: boolean; fileProblem: string | null; remoteWriter: string; remoteLegacy: boolean; remoteMissing: boolean;
  added: string[]; updated: string[]; unchanged: string[]; localAhead: string[]; conflicts: PendingConflict[];
  migrated: MigratedSchema[]; rejected: RejectedSchema[]; activeChanged: boolean; needsPublish: boolean; messages: string[];
}
export interface PushOutcome { ok: boolean; skipped?: string; messages: string[]; problems: string[]; }
interface SyncMeta { sha: string | null; lastPullAt: string | null; lastPushAt: string | null; }

let DEFAULT_HASHES_CACHE: Set<string> | null = null;
const DEFAULT_HASHES = { has: (h: string) => (DEFAULT_HASHES_CACHE ||= new Set(DEFAULT_SCHEMAS.map((d) => contentHash(d)))).has(h) };
const norm = (s: string) => s.trim().toLowerCase();
function fnv(str: string): string { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0') + str.length.toString(36); }
/** Hash of the logical content only (tables + relationships). Volatile metadata is excluded on purpose. */
/** Canonical form: sorted keys; false / null / undefined / empty values omitted (they are equivalent on read). */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') { const o: Record<string, unknown> = {}; Object.keys(v).sort().forEach((k) => { const x = (v as Record<string, unknown>)[k]; if (x === undefined || x === null || x === false || x === '' || (Array.isArray(x) && !x.length)) return; o[k] = canon(x); }); return o; }
  return v;
}
export function contentHash(s: Pick<SchemaModel, 'tables' | 'relationships'>): string {
  return fnv(JSON.stringify(canon({ t: s.tables.map((t) => ({ n: t.name, m: t.module, d: t.description, o: t.objectType || '', c: t.columns.map((c) => ({ ...c, label: c.label === c.name ? '' : c.label })) })), r: s.relationships.map((r) => [r.fromTable, r.fromColumn, r.toTable, r.toColumn, r.kind]) })));
}

function firstLocation(e: SchemaIssue): string { return e.table ? `${e.table}${e.column ? `.${e.column}` : ''}` : e.path; }
export function rejectedFromReport(r: SchemaReport): RejectedSchema {
  const first = r.errors[0];
  return { name: r.name, legacy: r.legacy, location: first ? firstLocation(first) : '(schema)', reason: first ? first.message : 'Unknown validation problem.', errors: r.errors.slice(0, 25).map(describeIssue), total: r.errors.length };
}
export function rejectionMessage(x: RejectedSchema): string {
  return x.legacy
    ? `Legacy schema migration could not be completed.\nSchema: ${x.name}\nLocation: ${x.location}\nReason: ${x.reason}${x.total > 1 ? ` (…and ${x.total - 1} more)` : ''}\nThe existing valid local schema was preserved.`
    : `Schema "${x.name}" failed validation and was not loaded.\nLocation: ${x.location}\nReason: ${x.reason}${x.total > 1 ? ` (…and ${x.total - 1} more)` : ''}\nYour local copy was kept unchanged.`;
}
export function migrationMessage(m: MigratedSchema): string {
  return `Legacy schema detected.\nThe schema "${m.name}" was created by an older SQL Assistant version and required migration before synchronization.\nMigration completed successfully. The schema was validated and synchronized using the current schema format.${m.summary.length ? `\n• ${m.summary.join('\n• ')}` : ''}${m.warnings.length ? `\nAttention: ${m.warnings.join(' ')}` : ''}`;
}

export class SyncService {
  private busy: Promise<unknown> | null = null;
  constructor(private schemas: SchemaService, private repo: () => SchemaRepository | null, private store: KeyValueStore, private schemaPath: () => string, private knownSecrets: () => string[] = () => []) {}

  private bases(): Record<string, string> { return readJson(this.store, KEYS.syncBase, {}); }
  private setBases(b: Record<string, string>) { writeJson(this.store, KEYS.syncBase, b); }
  meta(): SyncMeta { return readJson(this.store, KEYS.syncMeta, { sha: null, lastPullAt: null, lastPushAt: null }); }
  private setMeta(m: Partial<SyncMeta>) { writeJson(this.store, KEYS.syncMeta, { ...this.meta(), ...m }); }
  log(): SyncLogEntry[] { return readJson(this.store, KEYS.syncLog, []); }
  private addLog(kind: SyncLogEntry['kind'], message: string) { const l = [{ id: makeId('log'), timestamp: new Date().toISOString(), kind, message: redactSecrets(message, this.knownSecrets()) }, ...this.log()].slice(0, 200); writeJson(this.store, KEYS.syncLog, l); }
  conflicts(): PendingConflict[] { return readJson(this.store, KEYS.conflicts, []); }
  private setConflicts(c: PendingConflict[]) { writeJson(this.store, KEYS.conflicts, c); }

  /** Serializes sync operations (no overlapping pull/push races). */
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> { while (this.busy) { try { await this.busy; } catch { /* ignore */ } } const p = fn(); this.busy = p; try { return await p; } finally { this.busy = null; } }

  pull(): Promise<PullOutcome> { return this.exclusive(() => this.doPull()); }
  private async doPull(): Promise<PullOutcome> {
    const out: PullOutcome = { ok: false, fileProblem: null, remoteWriter: '', remoteLegacy: false, remoteMissing: false, added: [], updated: [], unchanged: [], localAhead: [], conflicts: [], migrated: [], rejected: [], activeChanged: false, needsPublish: false, messages: [] };
    const repo = this.repo();
    if (!repo) { out.fileProblem = 'Repository synchronization is not configured. Add the GitHub repository and token in Settings → Secret Vault.'; return out; }
    let file;
    try { file = await repo.read(this.schemaPath()); } catch (e) { out.fileProblem = redactSecrets((e as Error).message, this.knownSecrets()); this.addLog('error', out.fileProblem); return out; }
    if (!file) { out.ok = true; out.remoteMissing = true; out.needsPublish = true; out.messages.push('The repository has no schema file yet — publishing will create it.'); this.addLog('pull', 'Remote schema file not found.'); return out; }
    const report = checkRegistry({ text: file.text });
    out.remoteWriter = report.writer.label; out.remoteLegacy = report.writer.legacy;
    if (report.fileProblem) { out.fileProblem = `${report.fileProblem.message} Your local schemas were kept unchanged.`; this.addLog('error', out.fileProblem); return out; }

    const local = this.schemas.registry(); const bases = this.bases(); const now = new Date().toISOString();
    const schemas = local.schemas.map((s) => ({ ...s }));
    const conflicts = this.conflicts().filter((c) => !report.validSchemas.some((r) => norm(r.name) === norm(c.schemaName)));
    report.schemas.forEach((rep) => {
      if (!rep.valid || !rep.schema) { out.rejected.push(rejectedFromReport(rep)); return; }
      const rs = rep.schema; const key = norm(rs.name); const rh = contentHash(rs);
      if (rep.migrationStatus === 'migrated') out.migrated.push({ name: rs.name, summary: summarizeMigration(rep.migrationNotes), warnings: rs.migration?.warnings || [] });
      const idx = schemas.findIndex((s) => norm(s.name) === key);
      if (idx === -1) {
        const id = schemas.some((s) => s.id === rs.id) ? `${rs.id}-${Date.now().toString(36)}` : rs.id;
        schemas.push({ ...rs, id, status: 'inactive', lastSyncedAt: now }); bases[key] = rh; out.added.push(rs.name); return;
      }
      const ls = schemas[idx]; const lh = contentHash(ls); const base = bases[key];
      if (lh === rh) { schemas[idx] = { ...ls, lastSyncedAt: now, migration: ls.migration || rs.migration }; bases[key] = rh; out.unchanged.push(rs.name); return; }
      if (base && lh === base) { schemas[idx] = { ...rs, id: ls.id, status: ls.status, lastSyncedAt: now }; bases[key] = rh; out.updated.push(rs.name); return; }
      if (base && rh === base) { out.localAhead.push(ls.name); return; }
      // First sync of an untouched built-in schema: the repository copy wins (nothing local to lose).
      if (!base && !ls.lastSyncedAt && DEFAULT_HASHES.has(lh)) { schemas[idx] = { ...rs, id: ls.id, status: ls.status, lastSyncedAt: now }; bases[key] = rh; out.updated.push(rs.name); return; }
      const c: PendingConflict = { id: makeId('cf'), schemaId: ls.id, schemaName: ls.name, localVersion: ls.version, remoteVersion: rs.version, changedPaths: [], remoteSchemaJson: JSON.stringify(rs), detectedAt: now };
      conflicts.push(c); out.conflicts.push(c);
    });
    // Schemas that exist only locally are local-ahead (published on the next push).
    schemas.forEach((s) => { if (!report.schemas.some((r) => r.schema && norm(r.schema.name) === norm(s.name)) && !out.rejected.some((x) => norm(x.name) === norm(s.name)) && !out.localAhead.includes(s.name)) out.localAhead.push(s.name); });
    // Active schema (latest explicit change wins).
    let activeSchemaId = local.activeSchemaId; let activeSchemaUpdatedAt = local.activeSchemaUpdatedAt ?? null;
    const remoteActive = report.activeSchemaId ? report.validSchemas.find((s) => s.id === report.activeSchemaId) : undefined;
    const mappedRemoteActive = remoteActive ? schemas.find((s) => norm(s.name) === norm(remoteActive.name))?.id : undefined;
    if (mappedRemoteActive && shouldApplyRemoteActiveSchema(local.activeSchemaUpdatedAt, report.activeSchemaUpdatedAt, mappedRemoteActive, local.activeSchemaId)) { activeSchemaId = mappedRemoteActive; activeSchemaUpdatedAt = report.activeSchemaUpdatedAt; out.activeChanged = true; }
    const next: SchemaRegistry = { schemas, activeSchemaId, activeSchemaUpdatedAt };
    const saved = this.schemas.replaceRegistry(next);
    if (!saved.ok) { out.fileProblem = `The synchronized schemas could not be saved locally: ${saved.errors.map((e) => e.message).join(' ')} Your local schemas were kept unchanged.`; this.addLog('error', out.fileProblem); return out; }
    this.setBases(bases); this.setConflicts(conflicts); this.setMeta({ sha: file.sha, lastPullAt: now });
    out.ok = true;
    out.needsPublish = out.migrated.length > 0 || out.localAhead.length > 0;
    out.migrated.forEach((m) => out.messages.push(migrationMessage(m)));
    if (out.rejected.length) out.messages.push(`${out.rejected.length} of ${report.schemas.length} schema(s) in the repository failed validation and were not loaded — your local copies were kept unchanged.`, ...out.rejected.map(rejectionMessage));
    this.addLog('pull', `Pulled ${report.schemas.length} schema(s) (writer: ${report.writer.label}): ${out.added.length} added, ${out.updated.length} updated, ${out.unchanged.length} unchanged, ${out.migrated.length} migrated, ${out.rejected.length} rejected, ${out.conflicts.length} conflict(s).`);
    return out;
  }

  /** Publish protection: never writes an invalid schema; always writes the current writer stamp. */
  push(opts: { allowReplacingInvalidRemote?: boolean } = {}): Promise<PushOutcome> { return this.exclusive(() => this.doPush(opts)); }
  private async doPush(opts: { allowReplacingInvalidRemote?: boolean }): Promise<PushOutcome> {
    const repo = this.repo();
    if (!repo) return { ok: false, messages: [], problems: ['Repository synchronization is not configured. Add the GitHub repository and token in Settings → Secret Vault.'] };
    let remote;
    try { remote = await repo.read(this.schemaPath()); } catch (e) { return { ok: false, messages: [], problems: [redactSecrets((e as Error).message, this.knownSecrets())] }; }
    if (remote && remote.sha !== this.meta().sha) {
      const pulled = await this.doPull();
      if (!pulled.ok) return { ok: false, messages: [], problems: [pulled.fileProblem || 'Pull before publish failed.'] };
      if (pulled.conflicts.length) return { ok: false, skipped: 'conflicts', messages: pulled.messages, problems: [`${pulled.conflicts.length} schema conflict(s) must be resolved before publishing.`] };
      remote = await repo.read(this.schemaPath());
    }
    if (remote && !opts.allowReplacingInvalidRemote) {
      const rep = checkRegistry({ text: remote.text });
      const invalidOnlyRemote = rep.invalidSchemas.filter((r) => !this.schemas.schemas().some((s) => norm(s.name) === norm(r.name)));
      if (invalidOnlyRemote.length) return { ok: false, skipped: 'remote-invalid', messages: [], problems: [`The repository contains ${invalidOnlyRemote.length} schema(s) that cannot be read (${invalidOnlyRemote.map((r) => `"${r.name}"`).join(', ')}). Publishing would remove them from the repository. Recover them first, or confirm publishing in Settings → Schema Management.`] };
    }
    const ser = serializeRegistry(this.schemas.registry(), safeDevice());
    if (!ser.ok) return { ok: false, messages: [], problems: ser.problems.map((p) => `Schema "${p.name}" is invalid and was not published: ${p.errors.slice(0, 3).map(describeIssue).join('; ')}`) };
    let sha: string;
    try { sha = await repo.write(this.schemaPath(), ser.text, remote ? remote.sha : null, `SQL Assistant 17.2.1: publish ${this.schemas.schemas().length} validated schema(s)`); }
    catch (e) { const msg = redactSecrets((e as Error).message, this.knownSecrets()); this.addLog('error', msg); return { ok: false, messages: [], problems: [msg] }; }
    const bases: Record<string, string> = {}; this.schemas.schemas().forEach((s) => { bases[norm(s.name)] = contentHash(s); });
    this.setBases(bases); this.setMeta({ sha, lastPushAt: new Date().toISOString() });
    this.addLog('push', `Published ${this.schemas.schemas().length} validated schema(s) in format 2.`);
    return { ok: true, messages: [`Published ${this.schemas.schemas().length} validated schema(s) using the current schema format.`], problems: [] };
  }

  /** Normal synchronization: pull, then publish when this device holds newer or migrated data. */
  async synchronize(): Promise<{ pull: PullOutcome; push: PushOutcome | null }> {
    const pull = await this.pull();
    if (!pull.ok || !pull.needsPublish || pull.conflicts.length) return { pull, push: null };
    if (pull.rejected.length) return { pull, push: { ok: false, skipped: 'remote-invalid', messages: [], problems: ['Publishing was postponed because the repository still contains schema(s) that cannot be read; they would otherwise be removed.'] } };
    return { pull, push: await this.push() };
  }

  resolveConflict(id: string, choice: 'keep-local' | 'take-remote'): boolean {
    const c = this.conflicts().find((x) => x.id === id); if (!c) return false;
    if (choice === 'take-remote') {
      const rs = JSON.parse(c.remoteSchemaJson) as SchemaModel; const ls = this.schemas.byId(c.schemaId);
      const r = this.schemas.saveSchema({ ...rs, id: c.schemaId, status: ls?.status || 'inactive', lastSyncedAt: new Date().toISOString() });
      if (!r.ok) return false;
      const b = this.bases(); b[norm(rs.name)] = contentHash(rs); this.setBases(b);
    } else { const b = this.bases(); b[norm(c.schemaName)] = contentHash(JSON.parse(c.remoteSchemaJson)); this.setBases(b); }
    this.setConflicts(this.conflicts().filter((x) => x.id !== id)); return true;
  }
}
function safeDevice(): string { try { return getDeviceTag(); } catch { return ''; } }
