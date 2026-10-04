/**
 * Settings → Admin Password (V17.2 behaviour, same storage key sqla.pwvault.v15 so existing passwords keep working).
 * The password itself is never stored: only an AES-GCM encrypted marker. Default password: "admin" (the UI warns while it is used).
 */
import { encryptWithSecret, decryptWithSecret } from './cryptoService';
const STORAGE_KEY = 'sqla.pwvault.v15'; const MARKER = 'sqla-verified-marker-v15'; export const DEFAULT_PASSWORD = 'admin';
let defaultBlobCache: string | null = null;
const read = (): string | null => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } };
async function storedBlob(): Promise<string> { const s = read(); if (s) return s; if (!defaultBlobCache) defaultBlobCache = JSON.stringify(await encryptWithSecret(DEFAULT_PASSWORD, MARKER)); return defaultBlobCache; }
export async function verifyPassword(candidate: string): Promise<boolean> { try { const blob = JSON.parse(await storedBlob()); if (!blob?.salt) return false; return (await decryptWithSecret(candidate, blob)) === MARKER; } catch { return false; } }
export async function changePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  if (!newPassword || newPassword.trim().length < 4) return { ok: false, error: 'New password must be at least 4 characters.' };
  if (newPassword === DEFAULT_PASSWORD) return { ok: false, error: 'Choose a password other than the default "admin".' };
  if (!(await verifyPassword(oldPassword))) return { ok: false, error: 'Current password is incorrect.' };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(await encryptWithSecret(newPassword, MARKER))); return { ok: true }; } catch (e) { return { ok: false, error: `The new password could not be saved (${(e as Error).message || 'browser storage rejected the write'}).` }; }
}
export function resetPasswordToDefault(): void { try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage blocked */ } }
export function isUsingDefaultPassword(): boolean { return read() === null; }
