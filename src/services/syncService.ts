/**
 * Repository / shared-location synchronisation.
 *
 * V17.1 fixes (kept): publish gate (invalid data is never pushed), normalise-then-validate with one shared rule set,
 * per-schema verdict (invalid remote schemas are rejected individually; valid local copies are never overwritten).
 *
 * V17.2 root-cause fixes for the error that kept coming back (see docs/ROOT_CAUSE_V17.2.md):
 *  1. STALE COPIES — the GitHub API response is cacheable for 60 s. After a repaired registry was published, the
 *     next discovery could be served the OLD (invalid) file from the browser cache, show "failed validation" again,
 *     and — because the just-pushed schemas were marked as synced — fast-forward the device back to the old copy.
 *     Fixed by `cache: 'no-store'` (githubApiService) and by never applying a file whose sha this device has already
 *     replaced (superseded-sha guard).
 *  2. WRONG LOCATION — unauthenticated discovery always read the built-in default repo/branch/path, while pushes went
 *     to the configured location. A stale invalid file at the default path was re-validated on every app start and
 *     could never be fixed by publishing. Discovery, pull, push and diagnostics now share ONE location (configured,
 *     or the last configured location remembered on this device).
 *  3. NO MERGE BASE — without knowing what was last synchronised, a device could not tell "remote is older than my
 *     edit" from "remote has newer changes", so normal syncs produced false conflicts or overwrote edits. Each schema
 *     now has a recorded base (content hash at last sync) and a 3-way rule:
 *        remote = local → nothing to do;  remote = base → local is ahead (published next push);
 *        local = base → fast-forward to remote;  both changed → conflict for the user to resolve.
 *  4. RACES — pull, push and discovery are serialised (one at a time); a push rejected because another device wrote
 *     first (409/422) is recovered automatically: pull (3-way merge) → push again.
 *  5. DIAGNOSTICS — every failure names its stage (retrieval, parsing, structure, table, column, duplicate, version,
 *     normalisation, persistence), the exact JSON path, and — for invalid remote data — which device / app version
 *     wrote the file, so an out-of-date device that keeps publishing old data can be identified.
 */
import type { SyncConfig, SyncSource, SyncTimeOption, SyncStatus, SchemaModel, SchemaRegistry, PendingConflict, SyncLogEntry, SyncLogEntryKind } from '../types';
import { secretVaultService } from './secretVaultService';
import { schemaService } from './schemaService';
import { detectConflict, shouldApplyRemoteActiveSchema, getDeviceTag } from '../engines/schemaVersionEngine';
import { getFile, putFile, isGitHubApiError } from './githubApiService';
import { beginInternalSync, endInternalSync } from './syncCoordination';
import { rememberedSyncLocation, locationKey, type SyncLocation } from './syncLocation';
import { safeTrim, safeLocalStorageSet, assertSyncConfigOrError, readJsonStorage } from '../utils/validation';
import { makeId } from '../utils/id';
import { checkRegistry, serializeRegistry, repairSchema, normalizeSchema, validateSchemaModel, describeIssue, describeIssueWithStage, formatRegistryReport, fileProblemStage, stageOf, contentHash, writerVersion, compareVersions, APP_VERSION, APP_NAME, type RegistryReport, type SchemaReport } from '../v17/sync/schemaFormat';

const CONFIG_KEY = 'sqla.syncconfig.v15'; const STATUS_KEY = 'sqla.syncstatus.v15'; const LEGACY_SHA_KEY = 'sqla.registrysha.v15'; const CONFLICTS_KEY = 'sqla.pendingconflicts.v15'; const LOG_KEY = 'sqla.synclog.v15';
const SHA_KEY = 'sqla.registrysha.v17'; const BASE_KEY = 'sqla.syncbase.v17'; const SUPERSEDED_KEY = 'sqla.syncsuperseded.v17';
const DISCOVERY_MIN_INTERVAL_MS = 90_000;
export interface RemoteRejection { schemaId: string; schemaName: string; errors: string[]; allErrorsRepairable: boolean; localExists: boolean; localValid: boolean; detectedAt: string; origin: string; }
export interface PullOutcome { ok: boolean; error?: string; newSchemasAdded: string[]; updatedSchemas: string[]; conflicts: PendingConflict[]; unchanged: number; activeSchemaChanged?: boolean; rejected?: RemoteRejection[]; warning?: string; notes?: string[]; localAhead?: string[]; stale?: boolean; notice?: string; }
export interface PushOutcome { ok: boolean; error?: string; requiresPullFirst?: boolean; blockedByValidation?: boolean; recovered?: boolean; }
const emptyPull = (extra: Partial<PullOutcome>): PullOutcome => ({ ok: false, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0, ...extra });
/** True when the schema was synchronised and has not been edited locally since (fallback when no merge base is known yet). */
function hasNoUnsyncedLocalEdits(local: SchemaModel): boolean { if (!local.lastSyncedAt) return false; const u = Date.parse(local.updatedAt); const l = Date.parse(local.lastSyncedAt); return Number.isFinite(u) && Number.isFinite(l) && u <= l; }

class SyncService {
  private config: SyncConfig = readJsonStorage<SyncConfig>(CONFIG_KEY, { source: 'github', time: 'manual', customTime: null });
  private status: SyncStatus = ((() => { try { return localStorage.getItem(STATUS_KEY) as SyncStatus; } catch { return null; } })()) || 'never';
  private lastSyncedAt: string | null = null;
  private lastError: string | null = null;
  private notice: string | null = null;
  private pendingConflicts: PendingConflict[] = readJsonStorage<PendingConflict[]>(CONFLICTS_KEY, []);
  private syncLog: SyncLogEntry[] = readJsonStorage<SyncLogEntry[]>(LOG_KEY, []);
  private remoteRejections: RemoteRejection[] = [];
  private lastRemoteInvalid = new Map<string, SchemaModel>();
  private lastRemoteText: string | null = null;
  private inFlightDiscovery: Promise<PullOutcome> | null = null;
  private lastDiscoveryAt = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private directoryHandle: any = null;
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  constructor() { this.rescheduleTimer(); }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify(): void { this.listeners.forEach((l) => l()); }
  /** Serialises synchronisation operations so pull, push and discovery never interleave. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> { const run = this.queue.then(fn, fn); this.queue = run.catch(() => undefined); return run; }
  private persistConfig(): void { safeLocalStorageSet(CONFIG_KEY, JSON.stringify(this.config)); }
  private persistPendingConflicts(): void { safeLocalStorageSet(CONFLICTS_KEY, JSON.stringify(this.pendingConflicts)); this.notify(); }
  private logEvent(kind: SyncLogEntryKind, message: string): void { this.syncLog = [{ id: makeId('log'), timestamp: new Date().toISOString(), kind, message }, ...this.syncLog].slice(0, 100); safeLocalStorageSet(LOG_KEY, JSON.stringify(this.syncLog)); }
  getConfig(): SyncConfig { return this.config; }
  getStatus(): SyncStatus { return this.status; }
  getLastSyncedAt(): string | null { return this.lastSyncedAt; }
  getLastError(): string | null { return this.lastError; }
  getNotice(): string | null { return this.notice; }
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
  // ------------------------------------------------------------------ location, sha, base, superseded
  /** ONE location for discovery, pull, push and diagnostics (V17.2). */
  currentLocation(): SyncLocation & { token: string; authenticated: boolean } {
    const c = secretVaultService.isUnlocked() ? secretVaultService.getConfig() : null;
    if (c) return { repo: c.githubRepo, branch: safeTrim(c.githubBranch) || 'main', path: safeTrim(c.githubSchemaPath), token: c.githubToken || '', authenticated: !!c.githubToken };
    return { ...rememberedSyncLocation(), token: '', authenticated: false };
  }
  private shaFor(lk: string): string | null { const m = readJsonStorage<Record<string, string>>(SHA_KEY, {}); if (m[lk]) return m[lk]; try { const legacy = localStorage.getItem(LEGACY_SHA_KEY); return legacy || null; } catch { return null; } }
  private setSha(lk: string, sha: string): void { const m = readJsonStorage<Record<string, string>>(SHA_KEY, {}); m[lk] = sha; safeLocalStorageSet(SHA_KEY, JSON.stringify(m)); try { localStorage.removeItem(LEGACY_SHA_KEY); } catch { /* ignore */ } }
  private isSuperseded(lk: string, sha: string): boolean { return (readJsonStorage<Record<string, string[]>>(SUPERSEDED_KEY, {})[lk] || []).includes(sha); }
  private addSuperseded(lk: string, sha: string | null): void { if (!sha) return; const m = readJsonStorage<Record<string, string[]>>(SUPERSEDED_KEY, {}); m[lk] = [sha, ...(m[lk] || []).filter((x) => x !== sha)].slice(0, 50); safeLocalStorageSet(SUPERSEDED_KEY, JSON.stringify(m)); }
  private getBase(lk: string, id: string): string | null { return readJsonStorage<Record<string, string>>(BASE_KEY, {})[`${lk}|${id}`] ?? null; }
  private setBases(lk: string, entries: [string, string][]): void { if (!entries.length) return; const m = readJsonStorage<Record<string, string>>(BASE_KEY, {}); entries.forEach(([id, h]) => { m[`${lk}|${id}`] = h; }); safeLocalStorageSet(BASE_KEY, JSON.stringify(m)); }
  private missingConfigMessage(): string | null {
    if (!secretVaultService.isUnlocked()) return 'The Secret Vault is locked. Enter the Admin Password to unlock it and enable synchronization.';
    const c = secretVaultService.getConfig()!;
    const r = assertSyncConfigOrError([{ key: 'githubRepo', label: 'Repository', value: c.githubRepo, required: true }, { key: 'githubBranch', label: 'Branch', value: c.githubBranch, required: false }, { key: 'githubSchemaPath', label: 'Repository Path', value: c.githubSchemaPath, required: true }, { key: 'githubToken', label: 'Access Token', value: c.githubToken, required: true, sensitive: true }]);
    return r.ok ? null : r.message;
  }
  // ------------------------------------------------------------------ conflicts
  private addPendingConflict(schemaId: string, schemaName: string, lv: string, rv: string, paths: string[], remote: SchemaModel): PendingConflict {
    const existing = this.pendingConflicts.find((c) => c.schemaId === schemaId);
    const conflict: PendingConflict = { id: existing?.id || makeId('conflict'), schemaId, schemaName, localVersion: lv, remoteVersion: rv, changedPaths: paths, remoteSchemaJson: JSON.stringify(remote), detectedAt: new Date().toISOString() };
    this.pendingConflicts = [...this.pendingConflicts.filter((c) => c.schemaId !== schemaId), conflict]; this.persistPendingConflicts(); return conflict;
  }
  /** Applies the user's choice. The stored remote copy is re-validated before it can replace local data. */
  resolvePendingConflict(conflictId: string, decision: 'local' | 'remote'): { ok: boolean; error?: string } {
    const c = this.pendingConflicts.find((x) => x.id === conflictId); if (!c) return { ok: false, error: 'This conflict no longer exists.' };
    let n; try { n = normalizeSchema(JSON.parse(c.remoteSchemaJson)); } catch { n = null; }
    const v = n?.schema ? validateSchemaModel(n.schema) : null;
    const lk = locationKey(this.currentLocation());
    if (decision === 'remote') {
      if (!n?.schema || !v?.valid) return { ok: false, error: `The stored remote copy of "${c.schemaName}" no longer passes validation, so it was not applied: ${(v?.errors || n?.issues || []).slice(0, 3).map(describeIssue).join(' ')}` };
      beginInternalSync(); let saved = false; try { saved = schemaService.replaceSchemaContent(c.schemaId, n.schema); } finally { endInternalSync(); }
      if (!saved) return { ok: false, error: `Schema persistence failed: the remote copy of "${c.schemaName}" could not be saved to browser storage (${schemaService.getStorageHealth().lastError || 'storage write rejected'}).` };
    }
    if (n?.schema) this.setBases(lk, [[c.schemaId, contentHash(n.schema)]]); // the remote copy has now been seen: "Use Local" makes the local copy the one to publish
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
  // ------------------------------------------------------------------ remote verdicts
  private originOf(report: RegistryReport, s: SchemaReport): string {
    const parts: string[] = [];
    parts.push(report.writtenBy ? `file written by ${report.writtenBy}${report.writtenByDevice ? ` on ${report.writtenByDevice}` : ''}` : `file written by ${APP_NAME} V17.0 or older (it has no writer stamp) — a device that has not been updated to V17.1+ publishes schemas without validating them`);
    const vm = s.schema?.versionMeta; if (vm?.updatedByDevice) parts.push(`schema last edited on ${vm.updatedByDevice}${vm.lastUpdated ? ` at ${vm.lastUpdated}` : ''}`);
    return parts.join('; ');
  }
  private rejectionsFrom(report: RegistryReport): RemoteRejection[] {
    this.lastRemoteInvalid.clear();
    return report.invalidSchemas.map((s) => { if (s.schema) this.lastRemoteInvalid.set(s.id, s.schema); const local = schemaService.getSchemaById(s.id); return { schemaId: s.id, schemaName: s.name, errors: s.errors.map(describeIssueWithStage), allErrorsRepairable: s.allErrorsRepairable, localExists: !!local, localValid: local ? validateSchemaModel(local).valid : false, detectedAt: new Date().toISOString(), origin: this.originOf(report, s) }; });
  }
  private rejectionMessage(report: RegistryReport, rejected: RemoteRejection[]): string {
    const head = `Schema synchronization: ${rejected.length} of ${report.schemas.length} schema(s) in the repository failed validation and were not loaded — your local copies were kept unchanged.`;
    const body = rejected.map((r) => `"${r.schemaName}" — ${r.errors.slice(0, 3).join(' ')}${r.errors.length > 3 ? ` …and ${r.errors.length - 3} more.` : ''} (${r.origin}.)`).join(' ');
    return `${head} ${body} Use the recovery options in Settings → Schema Management.`;
  }
  private fileProblemMessage(report: RegistryReport): string { return `Schema synchronization failed — ${fileProblemStage(report.fileProblem!.code)}: the remote schema file could not be loaded — ${report.fileProblem!.message} Your local schemas were not changed.`; }
  private staleAppNotice(report: RegistryReport): string | null { const v = writerVersion(report.writtenBy); if (v && compareVersions(v, writerVersion(APP_VERSION)!) > 0) return `The schema file was last written by ${report.writtenBy}, which is newer than this copy (${APP_NAME} ${APP_VERSION}). Reload the page or install the latest version on this device.`; return null; }
  /** 3-way merge of valid remote schemas into the local registry. */
  private applyReport(report: RegistryReport, lk: string, collectConflicts: boolean): Omit<PullOutcome, 'ok'> {
    const newSchemasAdded: string[] = []; const updatedSchemas: string[] = []; const conflicts: PendingConflict[] = []; const localAhead: string[] = []; const bases: [string, string][] = []; let unchanged = 0; const persistFailures: string[] = [];
    for (const remote of report.validSchemas) {
      const rh = contentHash(remote); const local = schemaService.getSchemaById(remote.id);
      if (!local) { const o = schemaService.addSchemaFromRemote(remote); if (o === 'added') newSchemasAdded.push(remote.name); else if (o === 'updated') updatedSchemas.push(remote.name); else if (o === 'failed') persistFailures.push(remote.name); else unchanged += 1; if (o !== 'failed') bases.push([remote.id, rh]); continue; }
      const lh = contentHash(local); const base = this.getBase(lk, remote.id);
      if (lh === rh) { unchanged += 1; bases.push([remote.id, rh]); continue; }
      if (base && rh === base) { localAhead.push(local.name); continue; }
      if ((base && lh === base) || (!base && hasNoUnsyncedLocalEdits(local))) { if (schemaService.replaceSchemaContent(remote.id, remote)) { updatedSchemas.push(remote.name); bases.push([remote.id, rh]); } else persistFailures.push(remote.name); continue; }
      if (collectConflicts) { const c = detectConflict(local, remote); conflicts.push(this.addPendingConflict(remote.id, remote.name, c.localVersion, c.remoteVersion, c.changedPaths.length ? c.changedPaths : ['content changed on both sides'], remote)); }
    }
    this.setBases(lk, bases);
    const rejected = this.rejectionsFrom(report);
    this.remoteRejections = rejected;
    const activeSchemaChanged = this.syncActiveSchemaPointer(report);
    const notice = this.staleAppNotice(report) ?? undefined; this.notice = notice ?? null;
    const warnings: string[] = [];
    if (rejected.length) warnings.push(this.rejectionMessage(report, rejected));
    if (persistFailures.length) warnings.push(`Schema synchronization failed — Schema persistence failed: ${persistFailures.join(', ')} could not be saved to browser storage (${schemaService.getStorageHealth().lastError || 'storage write rejected'}). Free browser storage (Settings → Danger Zone → Clean up) and sync again.`);
    return { newSchemasAdded, updatedSchemas, conflicts, unchanged, activeSchemaChanged, rejected, localAhead, notice, warning: warnings.length ? warnings.join(' ') : undefined, notes: [...report.registryNotes, ...report.schemas.flatMap((s) => s.notes.map((n) => `"${s.name}": ${n}`))] };
  }
  private safeCheck(text: string): RegistryReport | string { try { return checkRegistry({ text }); } catch (e) { return `Schema synchronization failed — Schema normalization failed: ${(e as Error)?.message || 'unexpected data shape'}. Your local schemas were not changed.`; } }
  // ------------------------------------------------------------------ discovery & pull
  /** Discovery on app load / page mount (unauthenticated when the vault is locked). Throttled and de-duplicated. */
  discoverPublicRegistry(reason: string, force = false): Promise<PullOutcome> {
    if (this.inFlightDiscovery) return this.inFlightDiscovery;
    if (!force && Date.now() - this.lastDiscoveryAt < DISCOVERY_MIN_INTERVAL_MS) return Promise.resolve({ ...emptyPull({}), ok: true });
    this.inFlightDiscovery = this.exclusive(() => this.doDiscover(reason)).finally(() => { this.inFlightDiscovery = null; this.lastDiscoveryAt = Date.now(); });
    return this.inFlightDiscovery;
  }
  private async doDiscover(reason: string): Promise<PullOutcome> {
    const loc = this.currentLocation(); const lk = locationKey(loc);
    try {
      const file = await getFile(loc.repo, loc.branch, loc.path, loc.token);
      if (!file) return { ...emptyPull({}), ok: true };
      if (this.isSuperseded(lk, file.sha)) { this.logEvent('suppressed', `Discovery (${reason}) received an outdated copy of the schema file (already replaced by this device); it was ignored.`); return { ...emptyPull({}), ok: true, stale: true }; }
      this.lastRemoteText = file.content;
      const report = this.safeCheck(file.content);
      if (typeof report === 'string') { this.lastError = report; this.logEvent('error', report); this.notify(); return emptyPull({ error: report }); }
      if (report.fileProblem) { const msg = this.fileProblemMessage(report); this.lastError = msg; this.logEvent('error', msg); this.notify(); return emptyPull({ error: msg }); }
      beginInternalSync(); let r: Omit<PullOutcome, 'ok'>;
      try { r = this.applyReport(report, lk, false); } finally { endInternalSync(); }
      if (loc.authenticated) this.setSha(lk, file.sha);
      if (r.newSchemasAdded.length || r.updatedSchemas.length) this.logEvent('discovery', `Discovery (${reason}): ${r.newSchemasAdded.length} new, ${r.updatedSchemas.length} updated.`);
      if (r.warning) { this.lastError = r.warning; this.logEvent('error', r.warning); } else if (this.lastError?.startsWith('Schema synchronization')) this.lastError = null;
      this.notify();
      return { ok: true, ...r };
    } catch (e) { return emptyPull({ error: `Schema synchronization failed — Remote file retrieval failed: ${(e as { message?: string })?.message || 'discovery request failed'}` }); }
  }
  pullRegistryFromGitHub(): Promise<PullOutcome> { return this.exclusive(() => this.doPull()); }
  private async doPull(): Promise<PullOutcome> {
    const missing = this.missingConfigMessage(); if (missing) { this.logEvent('error', missing); return emptyPull({ error: missing }); }
    const loc = this.currentLocation(); const lk = locationKey(loc);
    this.status = 'syncing'; this.notify(); beginInternalSync();
    try {
      const file = await getFile(loc.repo, loc.branch, loc.path, loc.token);
      if (!file) { this.status = 'never'; this.notify(); const msg = 'No schema file found yet at the configured path — create or import a schema to establish the repository as the source of truth.'; this.logEvent('pull', msg); return emptyPull({ error: msg }); }
      if (this.isSuperseded(lk, file.sha)) { this.status = 'synchronized'; this.logEvent('suppressed', 'GitHub returned an outdated copy of the schema file (already replaced by this device); it was ignored — try again in a minute.'); this.notify(); return { ...emptyPull({}), ok: true, stale: true }; }
      this.setSha(lk, file.sha); this.lastRemoteText = file.content;
      const report = this.safeCheck(file.content);
      if (typeof report === 'string') { this.status = 'failed'; this.lastError = report; safeLocalStorageSet(STATUS_KEY, this.status); this.notify(); this.logEvent('error', report); return emptyPull({ error: report }); }
      if (report.fileProblem) { this.status = 'failed'; const msg = this.fileProblemMessage(report); this.lastError = msg; safeLocalStorageSet(STATUS_KEY, this.status); this.notify(); this.logEvent('error', msg); return emptyPull({ error: msg }); }
      const r = this.applyReport(report, lk, true);
      this.status = r.warning ? 'failed' : 'synchronized'; this.lastSyncedAt = new Date().toISOString();
      this.lastError = r.warning ?? null; safeLocalStorageSet(STATUS_KEY, this.status);
      this.logEvent(r.warning ? 'error' : 'pull', r.warning ?? `Pull complete: ${r.newSchemasAdded.length} new, ${r.updatedSchemas.length} updated, ${r.unchanged} up to date, ${r.localAhead?.length || 0} newer locally, ${r.conflicts.length} conflict(s).`);
      this.notify(); return { ok: true, ...r };
    } catch (e) {
      this.status = 'failed'; safeLocalStorageSet(STATUS_KEY, this.status);
      const message = `Repository synchronization failed — Remote file retrieval failed: ${isGitHubApiError(e) ? e.message : (e as Error)?.message || 'the repository request failed'}`;
      this.lastError = message; this.notify(); this.logEvent('error', message); return emptyPull({ error: message });
    } finally { endInternalSync(); }
  }
  // ------------------------------------------------------------------ push
  validateLocalForPublish(): { ok: boolean; message?: string } {
    const bad = schemaService.getLocalHealth().filter((h) => !h.valid);
    if (!bad.length) return { ok: true };
    const details = bad.map((h) => `"${h.name}": ${h.errors.slice(0, 3).map(describeIssueWithStage).join(' ')}${h.errors.length > 3 ? ` …and ${h.errors.length - 3} more.` : ''}`).join(' ');
    return { ok: false, message: `Not published: ${bad.length} local schema(s) do not pass validation, and publishing them would make synchronization fail on every other device. ${details} Use "Repair" in Settings → Schema Management, or correct the record in Manual Schema Update.` };
  }
  pushRegistryToGitHub(commitMessage?: string): Promise<PushOutcome> { return this.exclusive(() => this.doPush(commitMessage)); }
  /** Push; if another device wrote first, pull (3-way merge) and push once more — no manual intervention for normal syncs. */
  pushWithRecovery(commitMessage?: string): Promise<PushOutcome> {
    return this.exclusive(async () => {
      const first = await this.doPush(commitMessage); if (first.ok || !first.requiresPullFirst) return first;
      const pulled = await this.doPull();
      if (!pulled.ok) return { ok: false, error: pulled.error };
      if (pulled.conflicts.length) return { ok: false, error: `The repository has newer changes that conflict with this device for ${pulled.conflicts.map((c) => `"${c.schemaName}"`).join(', ')}. Resolve them in Settings → Synchronization → Conflict Management, then synchronize again.` };
      if (pulled.rejected?.length) return { ok: false, error: pulled.warning };
      const second = await this.doPush(commitMessage);
      return second.ok ? { ok: true, recovered: true } : second;
    });
  }
  private async doPush(commitMessage?: string): Promise<PushOutcome> {
    const missing = this.missingConfigMessage(); if (missing) { this.logEvent('error', missing); return { ok: false, error: missing }; }
    const gate = this.validateLocalForPublish();
    if (!gate.ok) { this.lastError = gate.message!; this.logEvent('suppressed', gate.message!); this.notify(); return { ok: false, error: gate.message, blockedByValidation: true }; }
    const loc = this.currentLocation(); const lk = locationKey(loc);
    this.status = 'syncing'; this.notify(); beginInternalSync();
    try {
      const registry = schemaService.getRegistry();
      const content = serializeRegistry(registry, getDeviceTag());
      const selfCheck = checkRegistry({ text: content });
      if (selfCheck.fileProblem || selfCheck.invalidSchemas.length) throw new Error(`internal check of the data about to be published failed: ${formatRegistryReport(selfCheck).slice(0, 4).join(' ')}`);
      const previousSha = this.shaFor(lk);
      const r = await putFile(loc.repo, loc.branch, loc.path, loc.token, content, safeTrim(commitMessage) || `Update ${APP_NAME} schema registry (${new Date().toISOString()})`, previousSha);
      this.addSuperseded(lk, previousSha); this.setSha(lk, r.sha);
      this.setBases(lk, registry.schemas.map((s) => [s.id, contentHash(s)] as [string, string]));
      schemaService.markAllSynced();
      this.status = 'synchronized'; this.lastSyncedAt = new Date().toISOString(); this.lastError = null; this.remoteRejections = []; this.lastRemoteText = content; safeLocalStorageSet(STATUS_KEY, this.status);
      this.logEvent('push', `Schema registry saved to the repository (${registry.schemas.length} schema(s), format ${selfCheck.formatVersion}).`); this.notify(); return { ok: true };
    } catch (e) {
      this.status = 'failed'; safeLocalStorageSet(STATUS_KEY, this.status);
      const api = isGitHubApiError(e) ? e : null; const msg = `Repository synchronization failed: ${api?.message || (e as Error)?.message || 'the repository request failed'}`;
      const requiresPull = !!api && (api.status === 409 || api.status === 422);
      if (!requiresPull) { this.lastError = msg; this.logEvent('error', msg); } else this.logEvent('suppressed', 'Push rejected because the repository changed since the last pull; a pull is required first.');
      this.notify(); return { ok: false, error: msg, requiresPullFirst: requiresPull };
    } finally { endInternalSync(); }
  }
  async syncWithGitHubSimple(): Promise<PullOutcome> { return this.pullRegistryFromGitHub(); }
  // ------------------------------------------------------------------ diagnostics & recovery
  async validateRepositoryFile(): Promise<{ ok: boolean; lines: string[]; report?: RegistryReport }> {
    const loc = this.currentLocation();
    try {
      const file = await getFile(loc.repo, loc.branch, loc.path, loc.token);
      if (!file) return { ok: false, lines: [`No schema file exists at ${loc.path} in ${loc.repo} (${loc.branch})${loc.authenticated ? '' : ' — or the repository is private; unlock Settings so the request uses your access token'}.`] };
      this.lastRemoteText = file.content;
      const report = checkRegistry({ text: file.content });
      const notice = this.staleAppNotice(report);
      return { ok: !report.fileProblem && !report.invalidSchemas.length, lines: [`Checked ${loc.repo}/${loc.path} (${loc.branch}, ${file.content.length.toLocaleString()} characters, ${loc.authenticated ? 'authenticated' : 'public access'}). This device: ${getDeviceTag()}, ${APP_NAME} ${APP_VERSION}.`, ...formatRegistryReport(report), ...(notice ? [notice] : [])], report };
    } catch (e) { return { ok: false, lines: [`Remote file retrieval failed: ${(e as { message?: string })?.message || 'request failed'}`] }; }
  }
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
  async restoreFromRepository(schemaId: string): Promise<{ ok: boolean; message: string }> {
    const loc = this.currentLocation();
    try {
      const file = await getFile(loc.repo, loc.branch, loc.path, loc.token);
      if (!file) return { ok: false, message: 'The repository has no schema file to restore from.' };
      const report = checkRegistry({ text: file.content });
      if (report.fileProblem) return { ok: false, message: this.fileProblemMessage(report) };
      const remote = report.validSchemas.find((s) => s.id === schemaId);
      if (!remote) { const bad = report.invalidSchemas.find((s) => s.id === schemaId); return { ok: false, message: bad ? `The repository copy of "${bad.name}" is also invalid, so neither copy was changed: ${bad.errors.slice(0, 3).map(describeIssueWithStage).join(' ')}` : 'This schema does not exist in the repository.' }; }
      const local = schemaService.getSchemaById(schemaId);
      if (!local) { schemaService.addSchemaFromRemote(remote); return { ok: true, message: `"${remote.name}" was restored from the repository.` }; }
      const c = detectConflict(local, remote);
      this.addPendingConflict(schemaId, remote.name, c.localVersion, c.remoteVersion, c.changedPaths.length ? c.changedPaths : ['repository copy'], remote); this.notify();
      return { ok: true, message: `The valid repository copy of "${remote.name}" is listed under Conflict Management — choose "Use Remote" to restore it.` };
    } catch (e) { return { ok: false, message: `Remote file retrieval failed: ${(e as { message?: string })?.message || 'request failed'}` }; }
  }
  async pullFromSharedLocation(activeSchema: SchemaModel): Promise<{ ok: boolean; error?: string; conflict?: ReturnType<typeof detectConflict>; incoming?: SchemaModel }> {
    if (!this.directoryHandle) return { ok: false, error: 'No shared location connected yet.' };
    try {
      const fh = await this.directoryHandle.getFileHandle('schema.json', { create: false }); const text = await (await fh.getFile()).text();
      const report = checkRegistry({ text }); if (report.fileProblem) return { ok: false, error: report.fileProblem.message };
      const incoming = report.validSchemas[0]; if (!incoming) return { ok: false, error: `schema.json failed validation: ${report.invalidSchemas.map((s) => s.errors.slice(0, 3).map(describeIssueWithStage).join(' ')).join(' ')}` };
      return { ok: true, conflict: detectConflict(activeSchema, incoming), incoming };
    } catch (e) { return { ok: false, error: 'Could not read schema.json from the connected location: ' + (e as Error).message }; }
  }
  async pushToSharedLocation(schema: SchemaModel): Promise<{ ok: boolean; error?: string }> {
    if (!this.directoryHandle) return { ok: false, error: 'No shared location connected yet.' };
    const v = validateSchemaModel(schema); if (!v.valid) return { ok: false, error: `Not written: the schema does not pass validation — ${v.errors.slice(0, 3).map((e) => `${stageOf(e)}: ${describeIssue(e)}`).join(' ')}` };
    try { const fh = await this.directoryHandle.getFileHandle('schema.json', { create: true }); const w = await fh.createWritable(); await w.write(JSON.stringify(schema, null, 2)); await w.close(); return { ok: true }; }
    catch (e) { return { ok: false, error: 'Could not write to the connected location: ' + (e as Error).message }; }
  }
}
export type { SchemaRegistry };
export const syncService = new SyncService();
