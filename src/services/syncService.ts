import type { SyncConfig, SyncSource, SyncTimeOption, SyncStatus, SchemaModel, SchemaRegistry, PendingConflict, SyncLogEntry, SyncLogEntryKind } from '../types';
import { secretVaultService, DEFAULT_BOOTSTRAP_CONFIG } from './secretVaultService';
import { schemaService } from './schemaService';
import { validateIncomingRegistryFile } from '../engines/schemaIntegrityEngine';
import { detectConflict, shouldApplyRemoteActiveSchema } from '../engines/schemaVersionEngine';
import { getFile, putFile, isGitHubApiError } from './githubApiService';
import { beginInternalSync, endInternalSync } from './syncCoordination';
import { safeTrim, safeLocalStorageSet, assertSyncConfigOrError, sanitizeIncomingSchema } from '../utils/validation';
import { makeId } from '../utils/id';
const CONFIG_KEY = 'sqla.syncconfig.v15'; const STATUS_KEY = 'sqla.syncstatus.v15'; const LAST_KNOWN_SHA_KEY = 'sqla.registrysha.v15'; const CONFLICTS_KEY = 'sqla.pendingconflicts.v15'; const LOG_KEY = 'sqla.synclog.v15';
export interface PullOutcome { ok: boolean; error?: string; newSchemasAdded: string[]; updatedSchemas: string[]; conflicts: PendingConflict[]; unchanged: number; activeSchemaChanged?: boolean; }
export interface PushOutcome { ok: boolean; error?: string; requiresPullFirst?: boolean; }
function readJson<T>(key: string, fallback: T): T { try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; } }
class SyncService {
  private config: SyncConfig = readJson<SyncConfig>(CONFIG_KEY, { source: 'github', time: 'manual', customTime: null });
  private status: SyncStatus = ((() => { try { return localStorage.getItem(STATUS_KEY) as SyncStatus; } catch { return null; } })()) || 'never';
  private lastSyncedAt: string | null = null;
  private lastError: string | null = null;
  private pendingConflicts: PendingConflict[] = readJson<PendingConflict[]>(CONFLICTS_KEY, []);
  private syncLog: SyncLogEntry[] = readJson<SyncLogEntry[]>(LOG_KEY, []);
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
  isFileSystemAccessSupported(): boolean { return typeof (window as any).showDirectoryPicker === 'function'; }
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
  resolvePendingConflict(conflictId: string, decision: 'local' | 'remote'): void {
    const c = this.pendingConflicts.find((x) => x.id === conflictId); if (!c) return;
    beginInternalSync(); try { if (decision === 'remote') { try { schemaService.replaceSchemaContent(c.schemaId, JSON.parse(c.remoteSchemaJson)); } catch { /* ignore */ } } } finally { endInternalSync(); }
    this.pendingConflicts = this.pendingConflicts.filter((x) => x.id !== conflictId); this.persistPendingConflicts();
  }
  /** V16.4/16.5: last-write-wins Active Schema pointer — called after schema content is merged. */
  syncActiveSchemaPointer(remote: Partial<SchemaRegistry>): boolean {
    const local = schemaService.getRegistry();
    if (!shouldApplyRemoteActiveSchema(local.activeSchemaUpdatedAt, remote.activeSchemaUpdatedAt, remote.activeSchemaId, local.activeSchemaId)) return false;
    const applied = schemaService.applyRemoteActivePointer(remote.activeSchemaId!, remote.activeSchemaUpdatedAt!);
    if (applied) this.logEvent('pull', `Active schema updated from another device (newer selection at ${remote.activeSchemaUpdatedAt}).`);
    return applied;
  }
  private applyMerge(remoteSchemas: SchemaModel[], collectConflicts: boolean): { newSchemasAdded: string[]; updatedSchemas: string[]; conflicts: PendingConflict[]; unchanged: number } {
    const newSchemasAdded: string[] = []; const updatedSchemas: string[] = []; const conflicts: PendingConflict[] = []; let unchanged = 0;
    for (const remote of remoteSchemas) {
      const local = schemaService.getSchemaById(remote.id);
      if (!local) { const o = schemaService.addSchemaFromRemote(remote); if (o === 'added') newSchemasAdded.push(remote.name); else if (o === 'updated') updatedSchemas.push(remote.name); else unchanged += 1; continue; }
      const c = detectConflict(local, remote); if (!c.hasConflict) { unchanged += 1; continue; }
      if (collectConflicts) conflicts.push(this.addPendingConflict(remote.id, remote.name, c.localVersion, c.remoteVersion, c.changedPaths, remote));
    }
    return { newSchemasAdded, updatedSchemas, conflicts, unchanged };
  }
  async discoverPublicRegistry(reason: string): Promise<PullOutcome> {
    try {
      const file = await getFile(DEFAULT_BOOTSTRAP_CONFIG.githubRepo, DEFAULT_BOOTSTRAP_CONFIG.githubBranch, DEFAULT_BOOTSTRAP_CONFIG.githubSchemaPath, '');
      if (!file) return { ok: true, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 };
      const raw = JSON.parse(file.content); const integrity = validateIncomingRegistryFile(raw);
      if (!integrity.valid) return { ok: false, error: 'Schema synchronization failed: the repository schema file failed validation.', newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 };
      const schemas = (raw.schemas as unknown[]).map((s) => sanitizeIncomingSchema(s)) as SchemaModel[];
      beginInternalSync(); let merged; let activeChanged = false;
      try { merged = this.applyMerge(schemas, false); activeChanged = this.syncActiveSchemaPointer(raw); } finally { endInternalSync(); }
      if (merged.newSchemasAdded.length || merged.updatedSchemas.length) this.logEvent('discovery', `Public discovery (${reason}): ${merged.newSchemasAdded.length} new, ${merged.updatedSchemas.length} updated.`);
      return { ok: true, ...merged, conflicts: [], activeSchemaChanged: activeChanged };
    } catch (e) { return { ok: false, error: `Schema synchronization failed: ${(e as Error)?.message || (e as { message?: string })?.message || 'public discovery request failed'}`, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 }; }
  }
  async pullRegistryFromGitHub(): Promise<PullOutcome> {
    const missing = this.missingConfigMessage(); if (missing) { this.logEvent('error', missing); return { ok: false, error: missing, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 }; }
    const cfg = secretVaultService.getConfig()!; this.status = 'syncing'; this.notify(); beginInternalSync();
    try {
      const file = await getFile(cfg.githubRepo, safeTrim(cfg.githubBranch) || 'main', safeTrim(cfg.githubSchemaPath), cfg.githubToken);
      if (!file) { this.status = 'never'; this.notify(); const msg = 'No schema file found yet at the configured path — create or import a schema to establish the repository as the source of truth.'; this.logEvent('pull', msg); return { ok: false, error: msg, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 }; }
      this.setLastKnownSha(file.sha);
      const raw = JSON.parse(file.content); const integrity = validateIncomingRegistryFile(raw);
      if (!integrity.valid) { this.status = 'failed'; const msg = 'Schema synchronization failed: the remote schema file failed validation: ' + integrity.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; '); this.lastError = msg; this.notify(); this.logEvent('error', msg); return { ok: false, error: msg, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 }; }
      const merged = this.applyMerge((raw.schemas as unknown[]).map((s) => sanitizeIncomingSchema(s)) as SchemaModel[], true);
      const activeChanged = this.syncActiveSchemaPointer(raw);
      this.status = 'synchronized'; this.lastSyncedAt = new Date().toISOString(); this.lastError = null; safeLocalStorageSet(STATUS_KEY, this.status);
      this.logEvent('pull', `Discovery complete: ${merged.newSchemasAdded.length} new, ${merged.updatedSchemas.length} updated, ${merged.unchanged} up to date, ${merged.conflicts.length} conflict(s).`);
      this.notify(); return { ok: true, ...merged, activeSchemaChanged: activeChanged };
    } catch (e) {
      this.status = 'failed'; safeLocalStorageSet(STATUS_KEY, this.status);
      const message = `Repository synchronization failed: ${isGitHubApiError(e) ? e.message : (e as Error)?.message || 'the repository request failed'}`;
      this.lastError = message; this.notify(); this.logEvent('error', message); return { ok: false, error: message, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 };
    } finally { endInternalSync(); }
  }
  async pushRegistryToGitHub(commitMessage?: string): Promise<PushOutcome> {
    const missing = this.missingConfigMessage(); if (missing) { this.logEvent('error', missing); return { ok: false, error: missing }; }
    const cfg = secretVaultService.getConfig()!; this.status = 'syncing'; this.notify(); beginInternalSync();
    try {
      const registry = schemaService.getRegistry();
      const r = await putFile(cfg.githubRepo, safeTrim(cfg.githubBranch) || 'main', safeTrim(cfg.githubSchemaPath), cfg.githubToken, JSON.stringify(registry, null, 2), safeTrim(commitMessage) || `Update SQL Assistant schema registry (${new Date().toISOString()})`, this.lastKnownSha());
      this.setLastKnownSha(r.sha); schemaService.markAllSynced();
      this.status = 'synchronized'; this.lastSyncedAt = new Date().toISOString(); this.lastError = null; safeLocalStorageSet(STATUS_KEY, this.status);
      this.logEvent('push', `Schema registry saved to the repository (${registry.schemas.length} schema(s)).`); this.notify(); return { ok: true };
    } catch (e) {
      this.status = 'failed'; safeLocalStorageSet(STATUS_KEY, this.status);
      const api = isGitHubApiError(e) ? e : null; const msg = `Repository synchronization failed: ${api?.message || (e as Error)?.message || 'the repository request failed'}`;
      this.lastError = msg; this.notify(); this.logEvent('error', msg); return { ok: false, error: msg, requiresPullFirst: !!api && (api.status === 409 || api.status === 422) };
    } finally { endInternalSync(); }
  }
  async syncWithGitHubSimple(): Promise<PullOutcome> { return this.pullRegistryFromGitHub(); }
}
export const syncService = new SyncService();
