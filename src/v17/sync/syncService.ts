/**
 * Repository synchronization (V17.2 design, V17.3.1 fixes):
 *   Download (no-store) → Parse → Detect writer → (legacy) Migrate → Normalise → Validate → 3-way merge per schema →
 *   Persist (validated) → Refresh Active Schema → Publish (validated, stamped).
 * Each schema is independent; invalid remote data never replaces a valid local schema; operations are serialised;
 * content hashes ignore volatile metadata so re-reading the same file never loops. Every failure names its stage.
 */
import type { SchemaModel, PendingConflict, SyncLogEntry } from '../../types';
import { KEYS, readJson, writeJson, deviceTag, type KeyValueStore } from '../../services/storage';
import type { SchemaService } from '../../services/schemaService';
import type { SchemaRepository } from '../services/githubClient';
import { checkRegistry, serializeRegistry, describeIssue, summarizeMigration, validateSchemaModel, WRITER_LABEL, type SchemaReport } from './schemaFormat';
import { redactSecrets } from '../errors/appErrors';
import { makeId } from '../../utils/id';
import { DEFAULT_SCHEMAS } from '../../data/defaultSchemas';
import { CANONICAL_SCHEMA_PATH, WRONG_PATHS } from '../services/secretVault';
import { encryptSchemaRegistry, decryptSchemaRegistry, SchemaCryptoError, readHeader, checkPassphrase, encryptedPathFor, type EncryptedSchemaHeader } from '../services/schemaCrypto';
import { repositoryErrorKind, type RepoFile } from '../services/githubClient';
export type SyncStage = 'Configuration' | 'Download' | 'Remote file location' | 'Parse' | 'Format detection' | 'Validation' | 'Persistence' | 'Publish gate' | 'Publish' | 'Passphrase' | 'Decryption' | 'Verify';
/** V17.5.3: the class of a failure, so the UI can say WHAT failed and WHAT to do. Repository kinds come from githubClient; the rest are produced here. */
export type SyncErrorKind = 'auth' | 'permission' | 'not-found' | 'conflict' | 'timeout' | 'network' | 'config' | 'http' | 'signin' | 'pat-missing' | 'pat-rejected' | 'pat-insufficient' | 'passphrase' | 'decryption' | 'validation' | 'verify' | 'would-remove' | 'unresolved-conflict' | 'remote-invalid' | 'nothing' | 'incompatible' | 'storage' | 'location';
export interface RejectedSchema { name: string; legacy: boolean; writer: string; location: string; reason: string; errors: string[]; total: number; }
export interface MigratedSchema { name: string; summary: string[]; warnings: string[]; }
export interface PullOutcome { ok: boolean; stage: SyncStage | null; fileProblem: string | null; path: string; remoteWriter: string; remoteLegacy: boolean; remoteMissing: boolean; added: string[]; updated: string[]; unchanged: string[]; localAhead: string[]; conflicts: PendingConflict[]; migrated: MigratedSchema[]; rejected: RejectedSchema[]; activeChanged: boolean; needsPublish: boolean; messages: string[]; /** V17.5: the repository file was protected by the saved passphrase */ encrypted?: boolean; /** V17.5.3: class of the failure */ errorKind?: SyncErrorKind | null; }
/** V17.5: protection of the synchronized schema by a passphrase kept on this device (see SchemaPassphraseStore). */
export interface EncryptedSync { passphrase: () => Promise<string | null>; path: () => string; /** V17.5.2: is a schema passphrase saved on this device? (synchronous, for the status display) */ saved?: () => boolean; }
export type PullKind = 'add' | 'update' | 'unchanged' | 'local-newer' | 'conflict';
export interface PullRow { name: string; kind: PullKind; localVersion: string; localUpdated: string; remoteVersion: string; remoteUpdated: string; tables: number; columns: number; decodeEntries: number; }
export type PullProblemKind = 'passphrase' | 'incorrect-passphrase' | 'unavailable' | 'missing' | 'decryption' | 'not-encrypted' | 'validation' | 'metadata' | 'configuration' | 'auth' | 'permission' | 'timeout' | 'incompatible';
/** V17.5.2: where this device stands with the shared repository — success, failure and what is still pending. Never claims a local edit is published. */
export interface SyncStatus { configured: boolean; mode: 'encrypted' | 'plain'; path: string; lastPullAt: string | null; lastPushAt: string | null; pending: string[]; conflicts: number; lastError: { at: string; message: string } | null; }
export interface PullPreview { ok: boolean; problem: { kind: PullProblemKind; detail: string; items?: string[] } | null; path: string; header: EncryptedSchemaHeader | null; writtenBy: string; remoteActive: string | null; rows: PullRow[]; willChange: boolean; localActive: { name: string; version: string; updatedAt: string }; file: RepoFile | null; }
interface PullOpts { source?: { file: RepoFile | null; path: string; encrypted: boolean }; forceActivate?: boolean; versionAware?: boolean; /** V17.5.3: the passphrase to use instead of the saved one (null = plain file) */ passphrase?: string | null; /** V17.5.5: when the plain file is missing, check for an encrypted twin and say so instead of reporting an empty repository */ detectEncryptedTwin?: boolean; }
export type PublishedKind = 'added' | 'updated' | 'unchanged';
/** V17.5.3 — options of a publication. The classic callers (Sync with GitHub Now, Settings) pass none of the new ones and behave exactly as in V17.5.2 — except that every write is now read back and verified. */
export interface PushOptions {
  allowReplacingInvalidRemote?: boolean; replaceUndecryptable?: boolean;
  /** use this passphrase for THIS publication instead of the saved one (it is saved only by the caller, after the publication was verified) */ passphrase?: string;
  /** do not write when the repository already holds identical content */ skipIfIdentical?: boolean;
  /** refuse to publish when it would remove a schema that exists in the repository but not on this device */ protectRemote?: boolean;
}
export interface PushOutcome { ok: boolean; stage?: SyncStage; skipped?: string; messages: string[]; problems: string[];
  /** V17.5.3 */ errorKind?: SyncErrorKind | null; /** which schemas were added to / updated in / already identical in the repository */ published?: { name: string; kind: PublishedKind }[];
  /** the repository was read back after the write and the content matched */ verified?: boolean; /** nothing had to be written: the repository already held the same schemas */ upToDate?: boolean; path?: string; encrypted?: boolean; sha?: string; }
export interface PublishPlanItem { name: string; kind: 'new' | 'changed' | 'unchanged'; tables: number; columns: number; decodeEntries: number; problem: string | null; }
export interface PublishPlan { schemas: PublishPlanItem[]; excluded: string[]; path: string; }
const norm = (s: string) => s.trim().toLowerCase();
function fnv(s: string): string { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16) + s.length.toString(36); }
function canon(v: unknown): unknown { if (Array.isArray(v)) return v.map(canon); if (v && typeof v === 'object') { const o: Record<string, unknown> = {}; Object.keys(v).sort().forEach((k) => { const x = (v as Record<string, unknown>)[k]; if (x === undefined || x === null || x === false || x === '' || (Array.isArray(x) && !x.length)) return; o[k] = canon(x); }); return o; } return v; }
/** Logical content only (tables + relationships); migration timestamps, sync times and labels equal to names are ignored. */
export function contentHash(s: Pick<SchemaModel, 'tables' | 'relationships'>): string { return fnv(JSON.stringify(canon({ t: s.tables.map((t) => ({ n: t.name, m: t.module, d: t.description, o: t.objectType || '', c: t.columns.map((c) => ({ ...c, label: c.label === c.name ? '' : c.label })) })), r: s.relationships.map((r) => [r.fromTable, r.fromColumn, r.toTable, r.toColumn, r.kind]) }))); }
let DEF: Set<string> | null = null; const isDefault = (h: string) => (DEF ||= new Set(DEFAULT_SCHEMAS.map(contentHash))).has(h);
export function rejectedFromReport(r: SchemaReport, writer: string): RejectedSchema { const e = r.errors[0]; return { name: r.name, legacy: r.legacy, writer, location: e ? (e.table ? `${e.table}${e.column ? `.${e.column}` : ''}` : e.path) : '(schema)', reason: e ? `${e.message} (at ${e.path})` : 'Unknown validation problem.', errors: r.errors.slice(0, 25).map(describeIssue), total: r.errors.length }; }
export const rejectionMessage = (x: RejectedSchema) => `${x.legacy ? 'Legacy schema migration could not be completed.' : `Schema "${x.name}" failed validation and was not loaded.`}\nSchema: ${x.name}\nWritten by: ${x.writer}\nLocation: ${x.location}\nReason: ${x.reason}${x.total > 1 ? ` (…and ${x.total - 1} more)` : ''}\n${x.legacy ? 'The existing valid local schema was preserved.' : 'Your local copy was kept unchanged.'}`;
export const migrationMessage = (m: MigratedSchema) => `Legacy schema detected.\nThe schema "${m.name}" was created by an older SQL Assistant version and required migration before synchronization.\nMigration completed successfully. The schema was validated and synchronized using the current schema format.${m.summary.length ? `\n• ${m.summary.join('\n• ')}` : ''}${m.warnings.length ? `\nAttention: ${m.warnings.join(' ')}` : ''}`;
export class SyncService {
  private busy: Promise<unknown> | null = null;
  constructor(private schemas: SchemaService, private repo: () => SchemaRepository | null, private store: KeyValueStore, private path: () => string, private secrets: () => string[] = () => [], private enc?: EncryptedSync) {}
  /** The saved passphrase, when this device synchronizes the schema in encrypted form (null = classic plain sync, unchanged from V17.4). */
  private async savedPass(): Promise<string | null> { try { return this.enc ? await this.enc.passphrase() : null; } catch { return null; } }
  private targetPath(pass: string | null): string { return pass && this.enc ? this.enc.path() : this.path(); }
  /** Reads the repository file; with a passphrase the content is decrypted (errors are typed — SchemaCryptoError). The returned sha is always the repository file's sha. */
  private async readRemote(repo: SchemaRepository, path: string, pass: string | null): Promise<{ file: RepoFile | null; header: EncryptedSchemaHeader | null }> {
    const f = await repo.read(path); if (!f) return { file: null, header: null }; if (!pass) return { file: f, header: null };
    const d = await decryptSchemaRegistry(f.text, pass); return { file: { text: d.text, sha: f.sha }, header: d.header };
  }
  /** V17.5.3: the class of a repository / crypto failure (null = unknown). */
  private kindOf(e: unknown): SyncErrorKind | null { const k = repositoryErrorKind(e); if (k) return k; const c = e as SchemaCryptoError; if (c?.name === 'SchemaCryptoError') return c.code === 'incorrect-passphrase' || c.code === 'weak-passphrase' ? 'passphrase' : c.code === 'unsupported' ? 'incompatible' : 'decryption'; return null; }
  private cryptoFail(e: unknown): { stage: SyncStage; message: string } { const c = e as SchemaCryptoError; if (c?.name === 'SchemaCryptoError') return c.code === 'incorrect-passphrase' || c.code === 'weak-passphrase' ? { stage: 'Passphrase', message: `${c.message} The existing local schema has not been changed.` } : { stage: 'Decryption', message: `${c.message} The existing local schema has not been changed.` }; return { stage: 'Download', message: (e as Error)?.message || 'The repository file could not be read.' }; }
  /** One decision rule for classic sync, Pull Schema preview and apply. `versionAware` (Pull Schema only) compares schema timestamps when there is no sync history, so an older repository copy never replaces a newer local one. */
  private decide(r: SchemaReport, ls: SchemaModel | undefined, base: string | undefined, versionAware: boolean): 'add' | 'unchanged' | 'update' | 'local-ahead' | 'conflict' {
    const rs = r.schema!; const rh = contentHash(rs); if (!ls) return 'add'; const lh = contentHash(ls); if (lh === rh) return 'unchanged';
    if ((base && lh === base) || (!base && (isDefault(lh) || (r.migrationStatus === 'migrated' && !ls.lastSyncedAt)))) return 'update';
    if (base && rh === base) return 'local-ahead';
    if (versionAware && !base) return (rs.updatedAt || '') > (ls.updatedAt || '') ? 'update' : 'local-ahead';
    return 'conflict';
  }
  private bases(): Record<string, string> { return readJson(this.store, KEYS.syncBase, {}); }
  meta(): { sha: string | null; path: string | null; lastPullAt: string | null; lastPushAt: string | null } { return readJson(this.store, KEYS.syncMeta, { sha: null, path: null, lastPullAt: null, lastPushAt: null }); }
  private setMeta(m: object) { writeJson(this.store, KEYS.syncMeta, { ...this.meta(), ...m }); }
  log(): SyncLogEntry[] { return readJson(this.store, KEYS.syncLog, []); }
  private addLog(kind: SyncLogEntry['kind'], message: string) { writeJson(this.store, KEYS.syncLog, [{ id: makeId('log'), timestamp: new Date().toISOString(), kind, message: redactSecrets(message, this.secrets()) }, ...this.log()].slice(0, 200)); }
  conflicts(): PendingConflict[] { return readJson(this.store, KEYS.conflicts, []); }
  /** Untouched built-in starter schemas stay local; everything else is published. */
  private publishable() { const r = this.schemas.registry(); const schemas = r.schemas.filter((s) => !isDefault(contentHash(s))); return { ...r, schemas, activeSchemaId: schemas.some((s) => s.id === r.activeSchemaId) ? r.activeSchemaId : schemas[0]?.id || r.activeSchemaId }; }
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> { while (this.busy) { try { await this.busy; } catch { /* */ } } const p = fn(); this.busy = p; try { return await p; } finally { this.busy = null; } }
  /** Read-only check of the repository file (Validate repository file). */
  async validateRemote(): Promise<{ ok: boolean; stage: SyncStage | null; message: string; report: ReturnType<typeof checkRegistry> | null }> {
    const repo = this.repo(); if (!repo) return { ok: false, stage: 'Configuration', message: 'Repository synchronization is not configured.', report: null };
    const vp = await this.savedPass(); const vpath = this.targetPath(vp); let f; try { f = (await this.readRemote(repo, vpath, vp)).file; } catch (e) { const c = this.cryptoFail(e); return { ok: false, stage: c.stage, message: redactSecrets(c.message, this.secrets()), report: null }; }
    if (!f) return { ok: false, stage: 'Remote file location', message: `No schema file at "${vpath}".`, report: null };
    const r = checkRegistry({ text: f.text }); return { ok: !r.fileProblem && !r.invalidSchemas.length, stage: r.fileProblem ? (r.stage === 'parse' ? 'Parse' : 'Format detection') : r.invalidSchemas.length ? 'Validation' : null, message: r.fileProblem ? r.fileProblem.message : `Written by ${r.writer.label}. ${r.validSchemas.length} valid, ${r.migratedSchemas.length} migratable, ${r.invalidSchemas.length} invalid schema(s).`, report: r };
  }
  async downloadRemoteText(): Promise<string | null> { const repo = this.repo(); if (!repo) return null; const f = await repo.read(this.targetPath(await this.savedPass())); return f ? f.text : null; }
  pull(): Promise<PullOutcome> { return this.exclusive(() => this.doPull()); }
  /**
   * V17.5.5 — "Pull Schema" (Schema → Pull Schema from GitHub): ONE action that retrieves the schema file of the configured repository and synchronizes it with this device.
   * It is the existing validated, transactional pull (format / version / tables / columns / data types / relationships / CASE-DECODE / required metadata are checked, a failure keeps the
   * local schemas, a newer local copy is never replaced, schemas changed on both sides become conflicts) with the Pull-Schema rules: the repository's active schema is activated, and an
   * older repository copy is never applied. No passphrase is asked for: a passphrase-protected file can only be opened with a Vault passphrase already saved on this device — the
   * decryption requirement is not bypassed, and a file that cannot be opened is reported instead of being treated as missing.
   */
  pullSchema(): Promise<PullOutcome> { return this.exclusive(() => this.doPull({ versionAware: true, forceActivate: true, detectEncryptedTwin: true })); }
  private async doPull(opts: PullOpts = {}): Promise<PullOutcome> {
    const encPass = opts.source ? null : opts.passphrase !== undefined ? opts.passphrase : await this.savedPass(); const encrypted = opts.source ? opts.source.encrypted : !!encPass; const path = opts.source ? opts.source.path : this.targetPath(encPass); const out: PullOutcome = { ok: false, stage: null, fileProblem: null, path, remoteWriter: '', remoteLegacy: false, remoteMissing: false, added: [], updated: [], unchanged: [], localAhead: [], conflicts: [], migrated: [], rejected: [], activeChanged: false, needsPublish: false, messages: [], encrypted };
    const fail = (stage: SyncStage, msg: string, kind: SyncErrorKind | null = null) => { out.stage = stage; out.errorKind = kind; out.fileProblem = redactSecrets(msg, this.secrets()); this.addLog('error', `${stage}: ${out.fileProblem}`); return out; };
    const repo = this.repo(); if (!repo) return fail('Configuration', 'Repository synchronization is not configured. Set the GitHub access token in Schema → Pull Schema (GitHub repository card).', 'config');
    let file: RepoFile | null; if (opts.source) file = opts.source.file; else { try { file = (await this.readRemote(repo, path, encPass)).file; } catch (e) { const c = this.cryptoFail(e); return fail(c.stage, c.message, this.kindOf(e)); } }
    if (!file) { if (encrypted) { out.ok = true; out.remoteMissing = true; out.needsPublish = true; this.addLog('pull', `No encrypted schema file at ${path} yet.`); return out; } if (opts.detectEncryptedTwin && this.enc) { let twin: RepoFile | null = null; try { twin = await repo.read(this.enc.path()); } catch { /* the plain-file read above already succeeded; a failure here only means we cannot tell */ } if (twin) return fail('Passphrase', 'The repository holds a passphrase-protected schema file, but no Vault passphrase is saved on this device and this page does not ask for one. Ask the administrator to publish the schema without a passphrase (Settings → Schema Management → Sync with GitHub Now on a device that has none saved). The existing local schema has not been changed.', 'passphrase'); }
      for (const alt of [CANONICAL_SCHEMA_PATH, ...WRONG_PATHS].filter((p) => p !== path)) { let f = null; try { f = await repo.read(alt); } catch { /* */ } if (f) return fail('Remote file location', `No schema file at "${path}", but one exists at "${alt}". Set the schema file path in Schema → Pull Schema to "${alt}" (or publish to create the file at "${path}").`); }
      out.ok = true; out.remoteMissing = true; out.needsPublish = true; this.addLog('pull', `No schema file at ${path} yet.`); return out; }
    const rep = checkRegistry({ text: file.text }); out.remoteWriter = rep.writer.label; out.remoteLegacy = rep.writer.legacy;
    if (rep.fileProblem) return fail(rep.stage === 'parse' ? 'Parse' : 'Format detection', `${rep.fileProblem.message} Your local schemas were kept unchanged.`, rep.fileProblem.code === 'FILE_NEWER_FORMAT' ? 'incompatible' : 'validation');
    const local = this.schemas.registry(); const bases = this.bases(); const now = new Date().toISOString(); const schemas = local.schemas.map((s) => ({ ...s }));
    const conflicts = this.conflicts().filter((c) => !rep.validSchemas.some((r) => norm(r.name) === norm(c.schemaName)));
    rep.schemas.forEach((r) => {
      if (!r.valid || !r.schema) { out.rejected.push(rejectedFromReport(r, rep.writer.label)); return; }
      const rs = r.schema; const k = norm(rs.name); const rh = contentHash(rs);
      if (r.migrationStatus === 'migrated') out.migrated.push({ name: rs.name, summary: summarizeMigration(r.migrationNotes), warnings: rs.migration?.warnings || [] });
      const i = schemas.findIndex((s) => norm(s.name) === k);
      if (i < 0) { schemas.push({ ...rs, id: schemas.some((s) => s.id === rs.id) ? `${rs.id}-${Date.now().toString(36)}` : rs.id, status: 'inactive', lastSyncedAt: now }); bases[k] = rh; out.added.push(rs.name); return; }
      const ls = schemas[i]; const base = bases[k]; const verdict = this.decide(r, ls, base, !!opts.versionAware);
      if (verdict === 'unchanged') { schemas[i] = { ...ls, lastSyncedAt: now, migration: ls.migration || rs.migration }; bases[k] = rh; out.unchanged.push(rs.name); return; }
      if (verdict === 'update') { schemas[i] = { ...rs, id: ls.id, status: ls.status, lastSyncedAt: now }; bases[k] = rh; out.updated.push(rs.name); return; }
      if (verdict === 'local-ahead') { out.localAhead.push(ls.name); return; }
      const c: PendingConflict = { id: makeId('cf'), schemaId: ls.id, schemaName: ls.name, remoteSchemaJson: JSON.stringify(rs), detectedAt: now }; conflicts.push(c); out.conflicts.push(c);
    });
    schemas.forEach((s) => { if (!rep.schemas.some((r) => r.schema && norm(r.schema.name) === norm(s.name)) && !out.rejected.some((x) => norm(x.name) === norm(s.name)) && !out.localAhead.includes(s.name) && !isDefault(contentHash(s))) out.localAhead.push(s.name); });
    let activeSchemaId = local.activeSchemaId; let activeSchemaUpdatedAt = local.activeSchemaUpdatedAt ?? null;
    const ra = rep.activeSchemaId ? rep.validSchemas.find((s) => s.id === rep.activeSchemaId) : undefined; const mapped = ra ? schemas.find((s) => norm(s.name) === norm(ra.name))?.id : undefined;
    const localIsDefault = isDefault(contentHash(schemas.find((s) => s.id === activeSchemaId) || schemas[0]));
    if (mapped && mapped !== local.activeSchemaId && ((rep.activeSchemaUpdatedAt && (!local.activeSchemaUpdatedAt || rep.activeSchemaUpdatedAt > local.activeSchemaUpdatedAt)) || (localIsDefault && !local.activeSchemaUpdatedAt))) { activeSchemaId = mapped; activeSchemaUpdatedAt = rep.activeSchemaUpdatedAt; out.activeChanged = true; }
    // Pull Schema is an explicit request: the repository's active schema becomes this device's active schema — but only if it was really applied or is identical (never an older copy that was refused)
    if (opts.forceActivate && ra && mapped && mapped !== activeSchemaId && [...out.added, ...out.updated, ...out.unchanged].some((n) => norm(n) === norm(ra.name))) { activeSchemaId = mapped; activeSchemaUpdatedAt = new Date().toISOString(); out.activeChanged = true; }
    const saved = this.schemas.replaceRegistry({ schemas, activeSchemaId, activeSchemaUpdatedAt });
    if (!saved.ok) return fail('Persistence', `Schema persistence failed: ${saved.errors.map((e) => `${e.message} ${(e.details || []).slice(0, 3).join(' ')}`).join(' ')} Your local schemas were kept unchanged.`, 'storage');
    writeJson(this.store, KEYS.syncBase, bases); writeJson(this.store, KEYS.conflicts, conflicts); this.setMeta({ sha: file.sha, path, lastPullAt: now });
    out.ok = true; out.needsPublish = out.migrated.length > 0 || out.localAhead.length > 0 || rep.writer.legacy;
    if (out.rejected.length) out.stage = 'Validation';
    out.migrated.forEach((m) => out.messages.push(migrationMessage(m)));
    if (out.rejected.length) out.messages.push(`${out.rejected.length} of ${rep.schemas.length} schema(s) in the repository failed validation and were not loaded — your local copies were kept unchanged.`, ...out.rejected.map(rejectionMessage));
    this.addLog('pull', `Pulled ${rep.schemas.length} schema(s) from ${path} (written by ${rep.writer.label}): ${out.added.length} added, ${out.updated.length} updated, ${out.unchanged.length} unchanged, ${out.migrated.length} migrated, ${out.rejected.length} rejected.`);
    return out;
  }
  push(o: PushOptions = {}): Promise<PushOutcome> { return this.exclusive(() => this.doPush(o)); }
  /**
   * V17.5.3 — publication. Validate every schema → read the repository (decrypting with the passphrase) → merge what changed there → compare → encrypt → write →
   * READ BACK, decrypt and compare → only then record the exchange and report success. A write that cannot be confirmed is NEVER reported as success and leaves the
   * schemas marked "not yet published". Only the one registry file is written: every other file in the repository is untouched.
   */
  private async doPush(o: PushOptions): Promise<PushOutcome> {
    const encPass = o.passphrase ?? (await this.savedPass()); const repo = this.repo(); const path = this.targetPath(encPass); const red = (t: string) => redactSecrets(t, [...this.secrets(), o.passphrase]);
    const out = (p: Partial<PushOutcome>): PushOutcome => ({ ok: false, messages: [], problems: [], path, encrypted: !!encPass, ...p });
    if (!repo) return out({ stage: 'Configuration', errorKind: 'config', problems: ['Repository synchronization is not configured.'] });
    if (!this.publishable().schemas.length) return out({ stage: 'Publish gate', errorKind: 'nothing', problems: ['There is nothing to publish: this device only has the built-in starter schema.'] });
    const gate = serializeRegistry(this.publishable(), deviceTag(this.store));
    if (!gate.ok) { const pr = gate.problems.map((p) => `Schema "${p.name}" is invalid and was not published: ${p.errors.slice(0, 3).map(describeIssue).join('; ')}`); this.addLog('error', `Publish gate: ${pr[0]}`); return out({ stage: 'Publish gate', errorKind: 'validation', problems: pr }); }
    let remote: RepoFile | null = null; let rawSha: string | null = null;
    try { remote = (await this.readRemote(repo, path, encPass)).file; } catch (e) {
      const c = this.cryptoFail(e); const isCrypto = (e as Error)?.name === 'SchemaCryptoError'; const wrongPass = (e as SchemaCryptoError)?.code === 'incorrect-passphrase';
      if (isCrypto && o.replaceUndecryptable) { try { rawSha = (await repo.read(path))?.sha ?? null; } catch { rawSha = null; } remote = null; } // an administrator replaces a file that this passphrase cannot open (passphrase changed)
      else { this.addLog('error', `Publish (${c.stage}): ${c.message}`); return out({ stage: c.stage, errorKind: this.kindOf(e), problems: [red(wrongPass ? `${(e as Error).message} The repository file is protected with a different passphrase. If the passphrase was changed by an administrator, update it on this device (Schema → Pull Schema).` : isCrypto ? `${(e as Error).message}` : c.message)] }); }
    }
    if (remote && remote.sha !== this.meta().sha) {
      const p = await this.doPull({ passphrase: encPass }); if (!p.ok) return out({ stage: p.stage || 'Download', errorKind: p.errorKind ?? null, problems: [p.fileProblem || 'Pull before publish failed.'] });
      if (p.conflicts.length) return out({ skipped: 'conflicts', errorKind: 'unresolved-conflict', messages: p.messages, problems: [`${p.conflicts.length} schema conflict(s) must be resolved before publishing.`] });
      try { remote = (await this.readRemote(repo, path, encPass)).file; } catch (e) { return out({ stage: this.cryptoFail(e).stage, errorKind: this.kindOf(e), problems: [red((e as Error).message)] }); }
    }
    const pub = this.publishable(); const rep = remote ? checkRegistry({ text: remote.text }) : null;
    if (rep && !o.allowReplacingInvalidRemote) { const bad = rep.invalidSchemas.filter((r) => !pub.schemas.some((s) => norm(s.name) === norm(r.name))); if (bad.length) return out({ skipped: 'remote-invalid', errorKind: 'remote-invalid', problems: [`The repository contains ${bad.length} schema(s) that cannot be read (${bad.map((r) => `"${r.name}"`).join(', ')}); publishing would remove them. Use "Publish my local copies" to replace them.`] }); }
    const rmap = new Map((rep?.validSchemas || []).map((x) => [norm(x.name), contentHash(x)] as [string, string]));
    const published = pub.schemas.map((x) => ({ name: x.name, kind: (!rmap.has(norm(x.name)) ? 'added' : rmap.get(norm(x.name)) !== contentHash(x) ? 'updated' : 'unchanged') as PublishedKind }));
    if (o.protectRemote) { const dropped = (rep?.validSchemas || []).filter((x) => !pub.schemas.some((s) => norm(s.name) === norm(x.name))).map((x) => x.name); if (dropped.length) return out({ skipped: 'would-remove', errorKind: 'would-remove', problems: [`Publishing from this device would remove ${dropped.length} schema(s) that exist in the repository but not on this device (${dropped.map((n) => `"${n}"`).join(', ')}). Nothing was changed. Pull them first (Schema → Pull Schema), then synchronize again.`] }); }
    const record = (sha: string, lastPushAt: boolean) => { const b: Record<string, string> = {}; pub.schemas.forEach((x) => { b[norm(x.name)] = contentHash(x); }); writeJson(this.store, KEYS.syncBase, b); this.setMeta({ sha, path, ...(lastPushAt ? { lastPushAt: new Date().toISOString() } : {}) }); };
    if (o.skipIfIdentical && remote && published.every((x) => x.kind === 'unchanged')) { record(remote.sha, false); this.addLog('push', `The repository file ${path} already holds the same ${pub.schemas.length} schema(s) — nothing to publish.`); return out({ ok: true, upToDate: true, verified: true, published, sha: remote.sha, messages: [`The repository already holds the same ${pub.schemas.length} schema(s) at ${path} — nothing needed to be published.`] }); }
    const ser = serializeRegistry(pub, deviceTag(this.store)); if (!ser.ok) return out({ stage: 'Publish gate', errorKind: 'validation', problems: ['Local schemas became invalid during synchronization; nothing was published.'] });
    try { const outText = encPass ? await encryptSchemaRegistry(ser.text, encPass, { device: deviceTag(this.store), schemaCount: pub.schemas.length }) : ser.text; await repo.write(path, outText, remote ? remote.sha : rawSha, `${WRITER_LABEL}: publish ${pub.schemas.length} validated schema(s)${encPass ? ' (encrypted)' : ''}`); }
    catch (e) { const m = red((e as Error).message); this.addLog('error', `Publish: ${m}`); return out({ stage: 'Publish', errorKind: this.kindOf(e), published, problems: [m] }); }
    // read the file back from the repository and compare it with what was written — success is reported only after this. GitHub may briefly serve the previous version
    // right after a write, so a mismatch is re-checked a couple of times (0.6 s apart) before it is treated as a failure; a content that never matches is never a success.
    let back: RepoFile | null = null; let why = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 600));
      why = ''; back = null;
      try { back = await repo.read(path); } catch (e) { why = `the file could not be read back (${red((e as Error).message)})`; }
      if (!why && !back) why = 'the file is not present in the repository after the write';
      if (!why && back) { try { const text = encPass ? (await decryptSchemaRegistry(back.text, encPass)).text : back.text; if (text !== ser.text) why = 'the file read back differs from what was written'; } catch { why = 'the file read back could not be decrypted with the passphrase'; } }
      if (!why) break;
    }
    if (why || !back) { this.addLog('error', `Publish verification: ${why}`); return out({ stage: 'Verify', errorKind: 'verify', published, problems: [`The repository did not confirm the update: ${why}. The publication is NOT reported as successful, and the schemas on this device stay marked "not yet published".`] }); }
    record(back.sha, true);
    this.addLog('push', `Published ${pub.schemas.length} validated schema(s) to ${path} (verified by read-back).`);
    return out({ ok: true, verified: true, published, sha: back.sha, messages: [`Published ${pub.schemas.length} validated schema(s) to ${path} ${encPass ? 'as an encrypted file (AES-256-GCM, protected by the passphrase)' : 'using the current schema format'}. The file was read back from the repository and verified.`] });
  }
  /** V17.5.3 — what a publication from this device would contain (pure read, nothing is written): every publishable schema and whether it is new, changed or already exchanged, plus the invalid ones and the starter schemas that stay local. */
  publishPlan(): PublishPlan {
    const bases = this.bases(); const all = this.schemas.registry().schemas; const excluded = all.filter((x) => isDefault(contentHash(x))).map((x) => x.name);
    const schemas = this.publishable().schemas.map((x): PublishPlanItem => { const v = validateSchemaModel(x); const h = contentHash(x); return { name: x.name, kind: bases[norm(x.name)] === undefined ? 'new' : bases[norm(x.name)] !== h ? 'changed' : 'unchanged', tables: x.tables.length, columns: x.tables.reduce((n, t) => n + t.columns.length, 0), decodeEntries: x.tables.reduce((n, t) => n + t.columns.reduce((m, c) => m + (c.decode?.length || 0), 0), 0), problem: v.valid ? null : describeIssue(v.errors[0]) }; });
    return { schemas, excluded, path: this.encryptedFilePath() };
  }
  // ───────── V17.5 Pull Schema (passphrase) ─────────
  /** Where the encrypted twin of the schema registry file lives (same repository, same folder). */
  encryptedFilePath(): string { return this.enc ? this.enc.path() : encryptedPathFor(this.path()); }
  private localActive() { const a = this.schemas.active(); return { name: a.name, version: String(a.version), updatedAt: a.updatedAt }; }
  /**
   * Steps 3–6 of the Pull Schema workflow — validate the passphrase, retrieve, decrypt, validate (format, version, tables, columns, data types, relationships,
   * CASE/DECODE definitions, required metadata) — and compare with the local schemas. NOTHING is written locally: no schema, no sync log, no sync metadata.
   * Cancelling after this point therefore leaves the device exactly as it was.
   */
  previewEncryptedPull(passphrase: string): Promise<PullPreview> { return this.exclusive(() => this.doPreview(passphrase)); }
  applyPreview(p: PullPreview): Promise<PullOutcome> { return this.exclusive(() => this.doPull({ source: { file: p.file, path: p.path, encrypted: true }, forceActivate: true, versionAware: true })); }
  private async doPreview(pass: string): Promise<PullPreview> {
    const path = this.encryptedFilePath(); const known = [...this.secrets(), pass];
    const bad = (kind: PullProblemKind, detail: string, items?: string[], header: EncryptedSchemaHeader | null = null): PullPreview => ({ ok: false, problem: { kind, detail: redactSecrets(detail, known), ...(items ? { items: items.map((i) => redactSecrets(i, known)) } : {}) }, path, header, writtenBy: '', remoteActive: null, rows: [], willChange: false, localActive: this.localActive(), file: null });
    const weak = checkPassphrase(pass); if (weak) return bad('passphrase', weak);
    const repo = this.repo(); if (!repo) return bad('configuration', 'The repository connection is not configured on this device.');
    let raw: RepoFile | null; try { raw = await repo.read(path); } catch (e) { const k = repositoryErrorKind(e); return bad(k === 'auth' ? 'auth' : k === 'permission' ? 'permission' : k === 'timeout' ? 'timeout' : 'unavailable', (e as Error).message); }
    if (!raw) return bad('missing', `No encrypted schema file exists in the repository at "${path}".`);
    const header = readHeader(raw.text); let dec: { text: string; header: EncryptedSchemaHeader };
    try { dec = await decryptSchemaRegistry(raw.text, pass); } catch (e) { const c = e as SchemaCryptoError; return bad(c.code === 'incorrect-passphrase' ? 'incorrect-passphrase' : c.code === 'not-encrypted' ? 'not-encrypted' : c.code === 'unsupported' ? 'incompatible' : 'decryption', c.message || 'Decryption failed.', undefined, header); }
    let json: any; try { json = JSON.parse(dec.text); } catch { return bad('validation', 'The decrypted schema is not valid JSON.', undefined, dec.header); }
    const metaProblems: string[] = (Array.isArray(json?.schemas) ? json.schemas : []).flatMap((s: any, i: number) => ['id', 'name', 'version', 'updatedAt'].filter((k) => typeof s?.[k] !== 'string' || !String(s[k]).trim() || (k === 'updatedAt' && Number.isNaN(Date.parse(s[k])))).map((k) => `schemas[${i}]${s?.name ? ` (${s.name})` : ''}: required metadata "${k}" is missing or invalid.`));
    if (metaProblems.length) return bad('metadata', 'Required schema metadata is missing.', metaProblems.slice(0, 10), dec.header);
    const rep = checkRegistry({ text: dec.text }); if (rep.fileProblem) return bad(rep.fileProblem.code === 'FILE_NEWER_FORMAT' ? 'incompatible' : 'validation', rep.fileProblem.message, undefined, dec.header);
    if (!rep.schemas.length) return bad('validation', 'The synchronized file contains no schemas.', undefined, dec.header);
    if (rep.invalidSchemas.length) return bad('validation', `${rep.invalidSchemas.length} schema(s) failed validation.`, rep.invalidSchemas.flatMap((x) => x.errors.slice(0, 3).map((er) => `${x.name}: ${describeIssue(er)}`)).slice(0, 10), dec.header);
    const bases = this.bases(); const local = this.schemas.registry();
    const rows: PullRow[] = rep.schemas.filter((r) => r.valid && r.schema).map((r) => { const rs = r.schema!; const ls = local.schemas.find((s) => norm(s.name) === norm(rs.name)); const v = this.decide(r, ls, bases[norm(rs.name)], true);
      return { name: rs.name, kind: (v === 'local-ahead' ? 'local-newer' : v) as PullKind, localVersion: ls ? String(ls.version) : '—', localUpdated: ls ? ls.updatedAt : '', remoteVersion: String(rs.version), remoteUpdated: rs.updatedAt, tables: rs.tables.length, columns: rs.tables.reduce((n, t) => n + t.columns.length, 0), decodeEntries: rs.tables.reduce((n, t) => n + t.columns.reduce((m, c) => m + (c.decode?.length || 0), 0), 0) }; });
    const ra = rep.activeSchemaId ? rep.validSchemas.find((s) => s.id === rep.activeSchemaId) : undefined; const activeDiffers = !!ra && norm(ra.name) !== norm(this.schemas.active().name) && rows.some((x) => norm(x.name) === norm(ra.name) && x.kind !== 'local-newer' && x.kind !== 'conflict');
    return { ok: true, problem: null, path, header: dec.header, writtenBy: rep.writer.label, remoteActive: ra ? ra.name : null, rows, willChange: rows.some((x) => x.kind === 'add' || x.kind === 'update' || x.kind === 'conflict') || activeDiffers, localActive: this.localActive(), file: { text: dec.text, sha: raw.sha } };
  }
  /**
   * V17.5.2 — honest synchronization status. `pending` lists the schemas whose content differs from what was last exchanged with the repository (or that were never
   * published): a local edit is therefore reported as "not yet published" until a push really succeeded. Pure read — nothing is written.
   */
  status(): SyncStatus {
    const m = this.meta(); const bases = this.bases(); const pending = this.publishable().schemas.filter((s) => bases[norm(s.name)] !== contentHash(s)).map((s) => s.name);
    const last = [m.lastPullAt, m.lastPushAt].filter(Boolean).sort().pop() || ''; const err = this.log().find((l) => l.kind === 'error');
    const encrypted = !!this.enc && (this.enc.saved ? this.enc.saved() : !!this.store.get(KEYS.schemaPassphrase));
    return { configured: !!this.repo(), mode: encrypted ? 'encrypted' : 'plain', path: encrypted ? this.enc!.path() : this.path(), lastPullAt: m.lastPullAt, lastPushAt: m.lastPushAt, pending, conflicts: this.conflicts().length, lastError: err && err.timestamp > last ? { at: err.timestamp, message: err.message } : null };
  }
  async synchronize(): Promise<{ pull: PullOutcome; push: PushOutcome | null }> {
    const pull = await this.pull(); if (!pull.ok || !pull.needsPublish || pull.conflicts.length) return { pull, push: null };
    if (pull.rejected.length) return { pull, push: { ok: false, skipped: 'remote-invalid', messages: [], problems: ['Publishing was postponed because the repository still contains schema(s) that cannot be read. Review them, then use "Publish my local copies".'] } };
    return { pull, push: await this.push() };
  }
  resolveConflict(id: string, choice: 'keep-local' | 'take-remote'): boolean {
    const c = this.conflicts().find((x) => x.id === id); if (!c) return false; const rs = JSON.parse(c.remoteSchemaJson) as SchemaModel; const b = this.bases();
    if (choice === 'take-remote') { const ls = this.schemas.byId(c.schemaId); if (!this.schemas.saveSchema({ ...rs, id: c.schemaId, status: ls?.status || 'inactive', lastSyncedAt: new Date().toISOString() }).ok) return false; }
    b[norm(rs.name)] = contentHash(rs); writeJson(this.store, KEYS.syncBase, b); writeJson(this.store, KEYS.conflicts, this.conflicts().filter((x) => x.id !== id)); return true;
  }
}
