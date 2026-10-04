import { encryptWithSecret, decryptWithSecret } from './cryptoService';
import { safeLocalStorageSet } from '../utils/validation';
const STORAGE_KEY = 'sqla.pwvault.v15'; const MARKER = 'sqla-verified-marker-v15'; const DEFAULT_PASSWORD = 'admin';
let defaultBlobCache: string | null = null;
async function getStoredBlobRaw(): Promise<string> { const s = localStorage.getItem(STORAGE_KEY); if (s) return s; if (!defaultBlobCache) defaultBlobCache = JSON.stringify(await encryptWithSecret(DEFAULT_PASSWORD, MARKER)); return defaultBlobCache; }
export async function verifyPassword(candidate: string): Promise<boolean> { try { const blob = JSON.parse(await getStoredBlobRaw()); if (!blob?.salt) return false; return (await decryptWithSecret(candidate, blob)) === MARKER; } catch { return false; } }
export async function changePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  if (!newPassword || newPassword.trim().length < 4) return { ok: false, error: 'New password must be at least 4 characters.' };
  if (!(await verifyPassword(oldPassword))) return { ok: false, error: 'Current password is incorrect.' };
  const r = safeLocalStorageSet(STORAGE_KEY, JSON.stringify(await encryptWithSecret(newPassword, MARKER)));
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
export function resetPasswordToDefault(): void { localStorage.removeItem(STORAGE_KEY); }
export function isUsingDefaultPassword(): boolean { return localStorage.getItem(STORAGE_KEY) === null; }
