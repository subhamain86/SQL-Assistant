/**
 * Repository / shared-location synchronisation.
 *
 * V17.1 root-cause fixes (see docs/ROOT_CAUSE_V17.1.md):
 *  1. PUBLISH GATE — V17.0 (and every V16.x) pushed the local registry without validating it, while
 *     pull/discovery validated strictly. A schema left with a dangling foreign key (created by the V16
 *     Manual Schema Update delete, which did not check dependencies) was therefore published, and from
 *     then on EVERY device — including the one that published it — failed with "the remote schema file
 *     failed validation". Push now validates every schema with the same rules first and refuses to
 *     publish invalid data, naming the exact record and offering an explicit repair.
 *  2. ONE RULE SET, NORMALISE BEFORE VALIDATE — remote data is parsed and normalised (lossless legacy
 *     conversions, reported) by v17/sync/schemaFormat.ts BEFORE validation, with the same validator used
 *     for import and Manual Schema Update. V17.0 validated the raw JSON and only sanitised afterwards.
 *  3. PER-SCHEMA VERDICT — one invalid schema no longer blocks the whole file. Valid schemas are merged;
 *     invalid ones are rejected individually with JSON paths, and the local copy is never touched.
 *  4. Precise messages: file-level problems (empty file, HTML page, LFS pointer, merge-conflict markers,
 *     JSON syntax with line/column, newer format) and schema-level errors are reported verbatim.
 */
import type { SyncConfig, SyncSource, SyncTimeOption, SyncStatus, SchemaModel, SchemaRegistry, PendingConflict, SyncLogEntry, SyncLogEntryKind } from '../types';
import { secretVaultService, DEFAULT_BOOTSTRAP_CONFIG } from './secretVaultService';
import { schemaService } from './schemaService';
import { detectConflict, shouldApplyRemoteActiveSchema } from '../engines/schemaVersionEngine';
import { getFile, putFile, isGitHubApiError } from './githubApiService';
import { beginInternalSync, endInternalSync } from './syncCoordination';
import { safeTrim, safeLocalStorageSet, assertSyncConfigOrError } from '../utils/validation';
import { makeId } from '../utils/id';
import { checkRegistry, serializeRegistry, repairSchema, normalizeSchema, validateSchemaModel, describeIssue, formatRegistryReport, type RegistryReport, type SchemaReport } from '../v17/sync/schemaFormat';

const CONFIG_KEY = 'sqla.syncconfig.v15'; const STATUS_KEY = 'sqla.syncstatus.v15'; const LAST_KNOWN_SHA_KEY = 'sqla.registrysha.v15'; const CONFLICTS_KEY = 'sqla.pendingconflicts.v15'; const LOG_KEY = 'sqla.synclog.v15';
export interface RemoteRejection { schemaId: string; schemaName: string; errors: string[]; allErrorsRepairable: boolean; localExists: boolean; localValid: boolean; detectedAt: string; }
export interface PullOutcome { ok: boolean; error?: string; newSchemasAdded: string[]; updatedSchemas: string[]; conflicts: PendingConflict[]; unchanged: number; activeSchemaChanged?: boolean; rejected?: RemoteRejection[]; warning?: string; notes?: string[]; }
export interface PushOutcome { ok: boolean; error?: string; requiresPullFirst?: boolean; blockedByValidation?: boolean; }
function readJson<T>(key: string, fallback: T): T { try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; } }
/** True when the schema was synchronised and has not been edited locally since (updatedAt ≤ lastSyncedAt). */
function hasNoUnsyncedLocalEdits(local: SchemaModel): boolean { if (!local.lastSyncedAt) return false; const u = Date.parse(local.updatedAt); const l = Date.parse(local.lastSyncedAt); return Number.isFinite(u) && Number.isFinite(l) && u <= l; }
const emptyPull = (extra: Partial<PullOutcome>): PullOutcome => ({ ok: false, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0, ...extra });

class SyncService {
  private config: SyncConfig = readJson<SyncConfig>(CONFIG_KEY, { source: 'github', time: 'manual', customTime: null });
  private status: SyncStatus = ((() => { try { return localStorage.getItem(STATUS_KEY) as SyncStatus; } catch { return null; } })()) || 'never';
  private lastSyncedAt: string | null = null;
  private lastError: string | null = null;
  private pendingConflicts: PendingConflict[] = readJson<PendingConflict[]>(CONFLICTS_KEY, []);
  private syncLog: SyncLogEntry[] = readJson<SyncLogEntry[]>(LOG_KEY, []);
  private remoteRejections: RemoteRejection[] = [];
  private lastRemoteInvalid = new Map<string, SchemaModel>();
  private lastRemoteText: string | null = null;
  private inFlightDiscovery: Promise<PullOutcome> | null = null;
  private directoryHandle: any = null;
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  constructor() { this.rescheduleTimer(); }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify(): void { this.listeners.forEach((l) => l()); }
  private persistConfig(): void { safeLocalStorageSet(CONFIG_KEY, JSON.stringify(this.config)); }
  private persistPendingConflicts(): void { safeLocalStorageSet(CONFLICTS_KEY, JSON.stringify(this.pendingConflicts)); this.notify(); }
  private logEvent(kind: SyncLogEntryKind, message: string): void { this.syncLog = [{ id: makeId('log'), timestamp: new Date().toISOString(), kind, message }, ...this.syncLog].slice(0, 100); safeLocalStorageSet(LOG_KEY, JSON.stringify(this.syncLog)); }
  getConfig(): SyncConfig { return this.config; }
  getStatus(): SyncStatus { return this.status; }
  getLastSyncedAt(): string | null { return this.lastSyncedAt; }
  getLastError(): string | null { return this.lastError; }
  clearLastError(): void { if (this.lastError !== null) { this.lastError = null; this.notify(); } }
  getPendingConflicts(): PendingConflict[] { return this.pendingConflicts; }
  getSyncLog(): SyncLogEntry[] { return this.syncLog; }
  getRemoteRejections(): RemoteRejection[] { return this.remoteRejections; }
  getLastRemoteText(): string | null { return this.lastRemoteText; }
  isFileSystemAccessSupported(): boolean { return typeof window !== 'undefined' && typeof (window as any).showDirectoryPicker === 'function'; }
  hasConnectedLocation(): boolean { return this.directoryHandle !== null; }
  setSource(source: SyncSource): void { this.config = { ...this.config, source }; this.persistConfig(); this.notify(); }
  setTime(time: SyncTimeOption, customTime: string | null = null): void { this.config = { ...this.config, time, customTime }; this.persistConfig(); this.rescheduleTimer(); this.notify(); }
  private rescheduleTimer(): void { if (this.scheduleTimer) { clearInterval(this.scheduleTimer); this.scheduleTimer = null; } const ms = this.intervalMsFor(this.config.time); if (ms && typeof setInterval !== 'undefined') this.scheduleTimer = setInterval(() => { this.pullRegistryFromGitHub().catch(() => {}); }, ms); }
  private intervalMsFor(t: SyncTimeOption): number | null { switch (t) { case '15m': return 15 * 60000; case '30m': return 30 * 60000; case '1h': return 3600000; case '4h': return 4 * 3600000; case '6h': return 6 * 3600000; case 'daily': case 'custom': return 24 * 3600000; default: return null; } }
  async connectSharedLocation(): Promise<{ ok: boolean; error?: string; label?: string }> {
    if (!this.isFileSystemAccessSupported()) return { ok: false, error: 'This browser does not support the File System Access API. Use Import/Export instead, or switch to GitHub sync.' };
    try { const h = await (window as any).showDirectoryPicker({ mode: 'readwrite' }); this.directoryHandle = h; this.notify(); return { ok: true, label: h.name as string }; } catch { return { ok: false, error: 'Folder selection was cancelled or denied.' }; }
  }
  private lastKnownSha(): string | null { try { return localStorage.getItem(LAST_KNOWN_SHA_KEY); } catch { return null; } }
  private setLastKnownSha(sha: string | null): void { if (sha) safeLocalStorageSet(LAST_KNOWN_SHA_KEY, sha); else localStorage.removeItem(LAST_KNOWN_SHA_KEY); }
  private missingConfigMessage(): string | null {
    if (!secretVaultService.isUnlocked()) return 'The Secret Vault is locked. Enter the Admin Password to unlock it and enable synchronization.';
    const c = secretVaultService.getConfig()!;
    const r = assertSyncConfigOrError([{ key: 'githubRepo', label: 'Repository', value: c.githubRepo, required: true }, { key: 'githubBranch', label: 'Branch', value: c.githubBranch, required: false }, { key: 'githubSchemaPath', label: 'Repository Path', value: c.githubSchemaPath, required: true }, { key: 'githubToken', label: 'Access Token', value: c.githubToken, required: true, sensitive: true }]);
    return r.ok ? null : r.message;
  }
  private addPendingConflict(schemaId: string, schemaName: string, lv: string, rv: string, paths: string[], remote: SchemaModel): PendingConflict {
    const existing = this.pendingConflicts.find((c) => c.schemaId === schemaId);
    const conflict: PendingConflict = { id: existing?.id || makeId('conflict'), schemaId, schemaName, localVersion: lv, remoteVersion: rv, changedPaths: paths, remoteSchemaJson: JSON.stringify(remote), detectedAt: new Date().toISOString() };
    this.pendingConflicts = [...this.pendingConflicts.filter((c) => c.schemaId !== schemaId), conflict]; this.persistPendingConflicts(); return conflict;
  }
  /** Applies the user's choice. The stored remote copy is re-validated before it can replace local data. */
  resolvePendingConflict(conflictId: string, decision: 'local' | 'remote'): { ok: boolean; error?: string } {
    const c = this.pendingConflicts.find((x) => x.id === conflictId); if (!c) return { ok: false, error: 'This conflict no longer exists.' };
    if (decision === 'remote') {
      let n; try { n = normalizeSchema(JSON.parse(c.remoteSchemaJson)); } catch { n = null; }
      const v = n?.schema ? validateSchemaModel(n.schema) : null;
      if (!n?.schema || !v?.valid) return { ok: false, error: `The stored remote copy of "${c.schemaName}" no longer passes validation, so it was not applied: ${(v?.errors || n?.issues || []).slice(0, 3).map(describeIssue).join(' ')}` };
      beginInternalSync(); try { schemaService.replaceSchemaContent(c.schemaId, n.schema); } finally { endInternalSync(); }
    }
    this.pendingConflicts = this.pendingConflicts.filter((x) => x.id !== conflictId); this.persistPendingConflicts();
    return { ok: true };
  }
  /** V16.4/16.5: last-write-wins Active Schema pointer — applied after content is merged, only to an existing valid schema. */
  syncActiveSchemaPointer(remote: { activeSchemaId?: string | null; activeSchemaUpdatedAt?: string | null }): boolean {
    const local = schemaService.getRegistry();
    if (!shouldApplyRemoteActiveSchema(local.activeSchemaUpdatedAt, remote.activeSchemaUpdatedAt, remote.activeSchemaId, local.activeSchemaId)) return false;
    const target = schemaService.getSchemaById(remote.activeSchemaId!); if (!target || !validateSchemaModel(target).valid) return false;
    const applied = schemaService.applyRemoteActivePointer(remote.activeSchemaId!, remote.activeSchemaUpdatedAt!);
    if (applied) this.logEvent('pull', `Active schema updated from another device (newer selection at ${remote.activeSchemaUpdatedAt}).`);
    return applied;
  }
  private rejectionsFrom(report: RegistryReport): RemoteRejection[] {
    this.lastRemoteInvalid.clear();
    return report.invalidSchemas.map((s: SchemaReport) => { if (s.schema) this.lastRemoteInvalid.set(s.id, s.schema); const local = schemaService.getSchemaById(s.id); return { schemaId: s.id, schemaName: s.name, errors: s.errors.map(describeIssue), allErrorsRepairable: s.allErrorsRepairable, localExists: !!local, localValid: local ? validateSchemaModel(local).valid : false, detectedAt: new Date().toISOString() }; });
  }
  private rejectionMessage(report: RegistryReport, rejected: RemoteRejection[]): string {
    const head = `Schema synchronization: ${rejected.length} of ${report.schemas.length} schema(s) in the repository failed validation and were not loaded — your local copies were kept unchanged.`;
    const body = rejected.map((r) => `"${r.schemaName}": ${r.errors.slice(0, 3).join(' ')}${r.errors.length > 3 ? ` …and ${r.errors.length - 3} more.` : ''}`).join(' ');
    return `${head} ${body} Use the recovery options in Settings → Schema Management.`;
  }
  private applyReport(report: RegistryReport, collectConflicts: boolean): Omit<PullOutcome, 'ok'> {
    const newSchemasAdded: string[] = []; const updatedSchemas: string[] = []; const conflicts: PendingConflict[] = []; let unchanged = 0;
    for (const remote of report.validSchemas) {
      const local = schemaService.getSchemaById(remote.id);
      if (!local) { const o = schemaService.addSchemaFromRemote(remote); if (o === 'added') newSchemasAdded.push(remote.name); else if (o === 'updated') updatedSchemas.push(remote.name); else unchanged += 1; continue; }
      const c = detectConflict(local, remote); if (!c.hasConflict) { unchanged += 1; continue; }
      // V17.1 fast-forward: the local copy has no edits since it was last synchronised (and the remote copy passed
      // validation), so there is nothing to lose — apply the newer repository copy instead of parking it as a conflict.
      if (hasNoUnsyncedLocalEdits(local)) { schemaService.replaceSchemaContent(remote.id, remote); updatedSchemas.push(remote.name); continue; }
      if (collectConflicts) conflicts.push(this.addPendingConflict(remote.id, remote.name, c.localVersion, c.remoteVersion, c.changedPaths, remote));
    }
    const rejected = this.rejectionsFrom(report);
    this.remoteRejections = rejected;
    const activeSchemaChanged = this.syncActiveSchemaPointer(report);
    return { newSchemasAdded, updatedSchemas, conflicts, unchanged, activeSchemaChanged, rejected, warning: rejected.length ? this.rejectionMessage(report, rejected) : undefined, notes: [...report.registryNotes, ...report.schemas.flatMap((s) => s.notes.map((n) => `"${s.name}": ${n}`))] };
  }
  private fileProblemMessage(report: RegistryReport): string { return `Schema synchronization failed: the remote schema file could not be loaded — ${report.fileProblem!.message} Your local schemas were not changed.`; }
  private remoteLocation(): { repo: string; branch: string; path: string; token: string; authenticated: boolean } {
    const c = secretVaultService.isUnlocked() ? secretVaultService.getConfig() : null;
    if (c?.githubToken) return { repo: c.githubRepo, branch: safeTrim(c.githubBranch) || 'main', path: safeTrim(c.githubSchemaPath), token: c.githubToken, authenticated: true };
    return { repo: DEFAULT_BOOTSTRAP_CONFIG.githubRepo, branch: DEFAULT_BOOTSTRAP_CONFIG.githubBranch, path: DEFAULT_BOOTSTRAP_CONFIG.githubSchemaPath, token: '', authenticated: false };
  }
  /** Unauthenticated discovery on app load / page mount. Concurrent calls share one request. */
  discoverPublicRegistry(reason: string): Promise<PullOutcome> {
    if (this.inFlightDiscovery) return this.inFlightDiscovery;
    this.inFlightDiscovery = this.doDiscover(reason).finally(() => { this.inFlightDiscovery = null; });
    return this.inFlightDiscovery;
  }
  private async doDiscover(reason: string): Promise<PullOutcome> {
    try {
      const file = await getFile(DEFAULT_BOOTSTRAP_CONFIG.githubRepo, DEFAULT_BOOTSTRAP_CONFIG.githubBranch, DEFAULT_BOOTSTRAP_CONFIG.githubSchemaPath, '');
      if (!file) return { ...emptyPull({}), ok: true };
      this.lastRemoteText = file.content;
      const report = checkRegistry({ text: file.content });
      if (report.fileProblem) { const msg = this.fileProblemMessage(report); this.lastError = msg; this.logEvent('error', msg); this.notify(); return emptyPull({ error: msg }); }
      beginInternalSync(); let r: Omit<PullOutcome, 'ok'>;
      try { r = this.applyReport(report, false); } finally { endInternalSync(); }
      if (r.newSchemasAdded.length || r.updatedSchemas.length) this.logEvent('discovery', `Public discovery (${reason}): ${r.newSchemasAdded.length} new, ${r.updatedSchemas.length} updated.`);
      if (r.warning) { this.lastError = r.warning; this.logEvent('error', r.warning); } else if (this.lastError?.startsWith('Schema synchronization')) this.lastError = null;
      this.notify();
      return { ok: true, ...r };
    } catch (e) { return emptyPull({ error: `Schema synchronization failed: ${(e as { message?: string })?.message || 'public discovery request failed'}` }); }
  }
  async pullRegistryFromGitHub(): Promise<PullOutcome> {
    const missing = this.missingConfigMessage(); if (missing) { this.logEvent('error', missing); return emptyPull({ error: missing }); }
    const cfg = secretVaultService.getConfig()!; this.status = 'syncing'; this.notify(); beginInternalSync();
    try {
      const file = await getFile(cfg.githubRepo, safeTrim(cfg.githubBranch) || 'main', safeTrim(cfg.githubSchemaPath), cfg.githubToken);
      if (!file) { this.status = 'never'; this.notify(); const msg = 'No schema file found yet at the configured path — create or import a schema to establish the repository as the source of truth.'; this.logEvent('pull', msg); return emptyPull({ error: msg }); }
      this.setLastKnownSha(file.sha); this.lastRemoteText = file.content;
      const report = checkRegistry({ text: file.content });
      if (report.fileProblem) { this.status = 'failed'; const msg = this.fileProblemMessage(report); this.lastError = msg; safeLocalStorageSet(STATUS_KEY, this.status); this.notify(); this.logEvent('error', msg); return emptyPull({ error: msg }); }
      const r = this.applyReport(report, true);
      this.status = r.rejected?.length ? 'failed' : 'synchronized'; this.lastSyncedAt = new Date().toISOString();
      this.lastError = r.warning ?? null; safeLocalStorageSet(STATUS_KEY, this.status);
      this.logEvent(r.warning ? 'error' : 'pull', r.warning ?? `Discovery complete: ${r.newSchemasAdded.length} new, ${r.updatedSchemas.length} updated, ${r.unchanged} up to date, ${r.conflicts.length} conflict(s).`);
      this.notify(); return { ok: true, ...r };
    } catch (e) {
      this.status = 'failed'; safeLocalStorageSet(STATUS_KEY, this.status);
      const message = `Repository synchronization failed: ${isGitHubApiError(e) ? e.message : (e as Error)?.message || 'the repository request failed'}`;
      this.lastError = message; this.notify(); this.logEvent('error', message); return emptyPull({ error: message });
    } finally { endInternalSync(); }
  }
  /** Validation gate shared by push and the UI: every local schema must pass before anything is published. */
  validateLocalForPublish(): { ok: boolean; message?: string } {
    const bad = schemaService.getLocalHealth().filter((h) => !h.valid);
    if (!bad.length) return { ok: true };
    const details = bad.map((h) => `"${h.name}": ${h.errors.slice(0, 3).map(describeIssue).join(' ')}${h.errors.length > 3 ? ` …and ${h.errors.length - 3} more.` : ''}`).join(' ');
    return { ok: false, message: `Not published: ${bad.length} local schema(s) do not pass validation, and publishing them would make synchronization fail on every other device. ${details} Use "Repair" in Settings → Schema Management, or correct the record in Manual Schema Update.` };
  }
  async pushRegistryToGitHub(commitMessage?: string): Promise<PushOutcome> {
    const missing = this.missingConfigMessage(); if (missing) { this.logEvent('error', missing); return { ok: false, error: missing }; }
    const gate = this.validateLocalForPublish();
    if (!gate.ok) { this.lastError = gate.message!; this.logEvent('suppressed', gate.message!); this.notify(); return { ok: false, error: gate.message, blockedByValidation: true }; }
    const cfg = secretVaultService.getConfig()!; this.status = 'syncing'; this.notify(); beginInternalSync();
    try {
      const registry = schemaService.getRegistry();
      const content = serializeRegistry(registry);
      const selfCheck = checkRegistry({ text: content });
      if (selfCheck.fileProblem || selfCheck.invalidSchemas.length) throw new Error(`internal check of the data about to be published failed: ${formatRegistryReport(selfCheck).slice(0, 4).join(' ')}`);
      const r = await putFile(cfg.githubRepo, safeTrim(cfg.githubBranch) || 'main', safeTrim(cfg.githubSchemaPath), cfg.githubToken, content, safeTrim(commitMessage) || `Update SQL Assistant schema registry (${new Date().toISOString()})`, this.lastKnownSha());
      this.setLastKnownSha(r.sha); schemaService.markAllSynced();
      this.status = 'synchronized'; this.lastSyncedAt = new Date().toISOString(); this.lastError = null; this.remoteRejections = []; this.lastRemoteText = content; safeLocalStorageSet(STATUS_KEY, this.status);
      this.logEvent('push', `Schema registry saved to the repository (${registry.schemas.length} schema(s), format ${selfCheck.formatVersion}).`); this.notify(); return { ok: true };
    } catch (e) {
      this.status = 'failed'; safeLocalStorageSet(STATUS_KEY, this.status);
      const api = isGitHubApiError(e) ? e : null; const msg = `Repository synchronization failed: ${api?.message || (e as Error)?.message || 'the repository request failed'}`;
      this.lastError = msg; this.notify(); this.logEvent('error', msg); return { ok: false, error: msg, requiresPullFirst: !!api && (api.status === 409 || api.status === 422) };
    } finally { endInternalSync(); }
  }
  async syncWithGitHubSimple(): Promise<PullOutcome> { return this.pullRegistryFromGitHub(); }
  // ------------------------------------------------------------------ V17.1 diagnostics & recovery
  /** Downloads and fully validates the repository file without changing anything locally. */
  async validateRepositoryFile(): Promise<{ ok: boolean; lines: string[]; report?: RegistryReport }> {
    const loc = this.remoteLocation();
    try {
      const file = await getFile(loc.repo, loc.branch, loc.path, loc.token);
      if (!file) return { ok: false, lines: [`No schema file exists at ${loc.path} in ${loc.repo} (${loc.branch})${loc.authenticated ? '' : ' — or the repository is private; unlock Settings so the request uses your access token'}.`] };
      this.lastRemoteText = file.content;
      const report = checkRegistry({ text: file.content });
      return { ok: !report.fileProblem && !report.invalidSchemas.length, lines: [`Checked ${loc.repo}/${loc.path} (${loc.branch}, ${file.content.length.toLocaleString()} characters, ${loc.authenticated ? 'authenticated' : 'public access'}).`, ...formatRegistryReport(report)], report };
    } catch (e) { return { ok: false, lines: [`Repository synchronization failed: ${(e as { message?: string })?.message || 'request failed'}`] }; }
  }
  /** Explicitly repairs a rejected remote schema copy and offers it as a pending conflict (or adds it if absent locally). */
  loadRepairedRemoteSchema(schemaId: string): { ok: boolean; changes: string[]; message: string } {
    const remote = this.lastRemoteInvalid.get(schemaId);
    if (!remote) return { ok: false, changes: [], message: 'The rejected remote copy is no longer available — run Sync with GitHub Now again.' };
    const r = repairSchema(remote);
    if (r.remainingErrors.length) return { ok: false, changes: r.changes, message: `The remote copy of "${remote.name}" still has problems that cannot be repaired automatically: ${r.remainingErrors.slice(0, 3).map(describeIssue).join(' ')}` };
    const local = schemaService.getSchemaById(schemaId);
    beginInternalSync();
    try {
      if (local) { const c = detectConflict(local, r.schema); this.addPendingConflict(schemaId, remote.name, c.localVersion, `${c.remoteVersion} (repaired)`, c.changedPaths.length ? c.changedPaths : ['repaired copy'], r.schema); }
      else schemaService.addSchemaFromRemote(r.schema);
    } finally { endInternalSync(); }
    this.remoteRejections = this.remoteRejections.filter((x) => x.schemaId !== schemaId); this.notify();
    return { ok: true, changes: r.changes, message: local ? `A repaired copy of "${remote.name}" is now listed under Conflict Management — choose "Use Remote" to apply it or "Use Local" to keep yours. Then use Push All Schemas to publish a valid file.` : `The repaired remote schema "${remote.name}" was added on this device (inactive).` };
  }
  /** Local copy is invalid but the repository has a valid copy: offer it as a pending conflict (explicit choice). */
  async restoreFromRepository(schemaId: string): Promise<{ ok: boolean; message: string }> {
    const loc = this.remoteLocation();
    try {
      const file = await getFile(loc.repo, loc.branch, loc.path, loc.token);
      if (!file) return { ok: false, message: 'The repository has no schema file to restore from.' };
      const report = checkRegistry({ text: file.content });
      if (report.fileProblem) return { ok: false, message: this.fileProblemMessage(report) };
      const remote = report.validSchemas.find((s) => s.id === schemaId);
      if (!remote) { const bad = report.invalidSchemas.find((s) => s.id === schemaId); return { ok: false, message: bad ? `The repository copy of "${bad.name}" is also invalid, so neither copy was changed: ${bad.errors.slice(0, 3).map(describeIssue).join(' ')}` : 'This schema does not exist in the repository.' }; }
      const local = schemaService.getSchemaById(schemaId);
      if (!local) { schemaService.addSchemaFromRemote(remote); return { ok: true, message: `"${remote.name}" was restored from the repository.` }; }
      const c = detectConflict(local, remote);
      this.addPendingConflict(schemaId, remote.name, c.localVersion, c.remoteVersion, c.changedPaths.length ? c.changedPaths : ['repository copy'], remote); this.notify();
      return { ok: true, message: `The valid repository copy of "${remote.name}" is listed under Conflict Management — choose "Use Remote" to restore it.` };
    } catch (e) { return { ok: false, message: `Repository synchronization failed: ${(e as { message?: string })?.message || 'request failed'}` }; }
  }
  async pullFromSharedLocation(activeSchema: SchemaModel): Promise<{ ok: boolean; error?: string; conflict?: ReturnType<typeof detectConflict>; incoming?: SchemaModel }> {
    if (!this.directoryHandle) return { ok: false, error: 'No shared location connected yet.' };
    try {
      const fh = await this.directoryHandle.getFileHandle('schema.json', { create: false }); const text = await (await fh.getFile()).text();
      const report = checkRegistry({ text }); if (report.fileProblem) return { ok: false, error: report.fileProblem.message };
      const incoming = report.validSchemas[0]; if (!incoming) return { ok: false, error: `schema.json failed validation: ${report.invalidSchemas.map((s) => s.errors.slice(0, 3).map(describeIssue).join(' ')).join(' ')}` };
      return { ok: true, conflict: detectConflict(activeSchema, incoming), incoming };
    } catch (e) { return { ok: false, error: 'Could not read schema.json from the connected location: ' + (e as Error).message }; }
  }
  async pushToSharedLocation(schema: SchemaModel): Promise<{ ok: boolean; error?: string }> {
    if (!this.directoryHandle) return { ok: false, error: 'No shared location connected yet.' };
    const v = validateSchemaModel(schema); if (!v.valid) return { ok: false, error: `Not written: the schema does not pass validation — ${v.errors.slice(0, 3).map(describeIssue).join(' ')}` };
    try { const fh = await this.directoryHandle.getFileHandle('schema.json', { create: true }); const w = await fh.createWritable(); await w.write(JSON.stringify(schema, null, 2)); await w.close(); return { ok: true }; }
    catch (e) { return { ok: false, error: 'Could not write to the connected location: ' + (e as Error).message }; }
  }
}
export type { SchemaRegistry };
export const syncService = new SyncService();
