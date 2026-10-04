import { schemaService } from './schemaService';
import { secretVaultService } from './secretVaultService';
import { syncService } from './syncService';
import { isInternalSyncInProgress } from './syncCoordination';
const PUSH_DEBOUNCE_MS = 1200;
let pushTimer: ReturnType<typeof setTimeout> | null = null; let initialized = false; let lastLockedWarningAt = 0;
type ToastFn = (kind: 'success' | 'error' | 'info' | 'warning', text: string) => void;
let toastFn: ToastFn = () => {};
export function setAutoSyncToastHandler(fn: ToastFn): void { toastFn = fn; }
function scheduleBackgroundPush(): void {
  if (isInternalSyncInProgress()) return;
  if (!secretVaultService.isUnlocked()) { const now = Date.now(); if (now - lastLockedWarningAt > 15000) { lastLockedWarningAt = now; toastFn('warning', 'Schema saved locally, but NOT synchronized — unlock Settings (Admin Password) on this device to publish it to other devices.'); } return; }
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => { const r = await syncService.pushRegistryToGitHub('Automatic sync: schema catalogue updated'); if (r.ok) toastFn('success', 'Schema changes synchronized automatically to the repository.'); else if (r.requiresPullFirst) toastFn('warning', 'Automatic sync paused — a newer version exists remotely. Use "Sync Now" to resolve.'); else toastFn('error', r.error || 'Repository synchronization failed.'); }, PUSH_DEBOUNCE_MS);
}
export async function performDiscovery(_reason: string): Promise<void> {
  if (!secretVaultService.isUnlocked()) return;
  const r = await syncService.pullRegistryFromGitHub();
  if (r.ok) { if (r.newSchemasAdded.length) toastFn('success', `${r.newSchemasAdded.length} schema(s) synchronized from the repository: ${r.newSchemasAdded.join(', ')}.`); if (r.updatedSchemas.length) toastFn('info', `${r.updatedSchemas.length} schema(s) updated from the repository: ${r.updatedSchemas.join(', ')}.`); if (r.conflicts.length) toastFn('warning', `${r.conflicts.length} schema(s) have unresolved sync conflicts — review them in Settings.`); if (r.activeSchemaChanged) toastFn('info', 'Active schema updated to match the most recent selection made on another device.'); }
}
export const performBackgroundPull = performDiscovery;
export async function performPublicDiscovery(reason: string): Promise<void> {
  const r = await syncService.discoverPublicRegistry(reason);
  if (r.ok) { if (r.newSchemasAdded.length) toastFn('success', `${r.newSchemasAdded.length} new schema(s) synchronized from the repository: ${r.newSchemasAdded.join(', ')}.`); if (r.updatedSchemas.length) toastFn('info', `${r.updatedSchemas.length} schema(s) refreshed from the repository: ${r.updatedSchemas.join(', ')}.`); if (r.activeSchemaChanged) toastFn('info', 'Active schema updated to match the most recent selection made on another device.'); }
}
export async function handleVaultUnlocked(): Promise<void> { await performDiscovery('vault-unlocked'); }
export function initAutoSync(): void { if (initialized) return; initialized = true; schemaService.subscribe(() => scheduleBackgroundPush()); }
