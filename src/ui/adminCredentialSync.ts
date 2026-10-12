/**
 * V17.6.5 — keeps this device's copy of the central Admin Password record fresh and tells the user what matters, once.
 * Called at app start, when the tab becomes visible, at the scheduled sync, by "Sync with GitHub Now" and (through the credential service) once when an unlock fails.
 * Never throws, never blocks the UI, never shows a secret. A refresh that changes nothing is silent.
 *   · a record refused (damaged, unknown version, tampered, rolled back) → one warning; the device keeps its last good record;
 *   · the Admin Password was RESET to the default on another device → Settings lock here at once (the unlocked session ends) and the usual default-password warning applies at the next unlock;
 *   · the central record replaced a different local password → explained once (the local password is not overwritten, it is simply no longer used while the central record exists).
 */
import { services, refreshPublished } from './context';
import { store } from './state';
import type { RefreshOutcome, RefreshReason } from '../v17/services/adminCredentialService';

export const ADMIN_CREDENTIAL_EVENT = 'sqla:admin-credential';
const MIN_GAP_MS = 15_000; let lastAt = 0;
/** What the user is told for an outcome (null = nothing). Exported for tests. */
export function outcomeNotice(o: RefreshOutcome): { kind: 'info' | 'warning'; text: string } | null {
  if (o.status === 'refused' && o.notify) return { kind: 'warning', text: o.message };
  if (o.status === 'applied' && o.record?.isDefault) return { kind: 'warning', text: 'The Admin Password was reset to the default "admin" on another device. Settings are locked here; unlock with "admin" and set a new password under Settings → Security.' };
  if (o.status === 'absent' && o.changed && o.notify) return { kind: 'info', text: o.message };
  if (o.explainOnce) return { kind: 'info', text: 'The Admin Password is now managed centrally for all devices. It replaces the password stored on this device (that one is kept but is not used while the central record exists).' };
  return null;
}
export async function refreshAdminCredential(reason: RefreshReason, opt: { force?: boolean } = {}): Promise<RefreshOutcome | null> {
  try {
    const now = Date.now(); if (!opt.force && (reason === 'visible' || reason === 'scheduled') && now - lastAt < MIN_GAP_MS) return null; lastAt = now;
    await refreshPublished(); const o = await services().credential.refresh(reason);
    if (o.status === 'applied' && o.record?.isDefault && store.settingsUnlocked) store.lockSettings();
    const n = outcomeNotice(o); if (n) store.pushToast(n.kind, n.text);
    if (o.changed || o.status === 'refused') document.dispatchEvent(new CustomEvent(ADMIN_CREDENTIAL_EVENT, { detail: { status: o.status } }));
    return o;
  } catch { return null; }
}
