/**
 * Settings → Admin Password (V17.2 behaviour, same storage key sqla.pwvault.v15 so existing passwords keep working).
 * The password itself is never stored: only an AES-GCM encrypted marker. Default password: "admin" (the UI warns while it is used).
 *
 * V17.6.5 — CENTRAL ADMIN PASSWORD. When a valid central record is in force (see v17/services/adminCredential.ts), verification uses the encrypted marker inside THAT record instead of the marker
 * stored on this device: the entered password must still decrypt the marker, nothing else is accepted, and the password is never written anywhere. The device's own marker (sqla.pwvault.v15) is
 * never touched by the central flow, so with no central record every function below behaves exactly as in V17.6.4. This module stays low level (no network, no repository code): the record is
 * handed in through setCentralProvider().
 * V17.6.5 — LOCK-OUT. After 5 wrong attempts verification is refused for 60 s, doubling with every further wrong attempt up to 15 minutes; a correct password resets it. Only an engaged lock-out (a number and a
 * time stamp — nothing password-like) is kept in browser storage so a reload does not clear it; below the threshold nothing is written.
 */
import { encryptWithSecret, decryptWithSecret, type EncryptedBlob } from './cryptoService';
const STORAGE_KEY = 'sqla.pwvault.v15'; export const MARKER = 'sqla-verified-marker-v15'; export const DEFAULT_PASSWORD = 'admin';
const LOCK_KEY = 'sqla.pwlock.v1765';
export const LOCK_THRESHOLD = 5; export const LOCK_BASE_MS = 60_000; export const LOCK_MAX_MS = 15 * 60_000;
let defaultBlobCache: string | null = null;
const read = (): string | null => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } };
async function storedBlob(): Promise<string> { const s = read(); if (s) return s; if (!defaultBlobCache) defaultBlobCache = JSON.stringify(await encryptWithSecret(DEFAULT_PASSWORD, MARKER)); return defaultBlobCache; }

// ───────────────────────────── the central record in force (supplied by the credential service) ─────────────────────────────
export interface CentralView { marker: EncryptedBlob; isDefault: boolean; }
let central: () => CentralView | null = () => null;
export const setCentralProvider = (fn: (() => CentralView | null) | null): void => { central = fn || (() => null); };
export const hasCentralCredential = (): boolean => central() !== null;
export const CENTRAL_MANAGED_MESSAGE = 'The Admin Password is managed centrally for all devices, so a change on this device only would be ignored. Use "Save (all devices)".';

// ───────────────────────────── lock-out ─────────────────────────────
interface LockState { fails: number; until: number; }
/** The counter lives in memory (per storage object) while no lock-out is in force, so an ordinary wrong password writes NOTHING to browser storage (as in V17.6.4); only an ENGAGED lock-out (5th wrong attempt on) is persisted, so a reload cannot clear it. */
const mem = new WeakMap<object, LockState>(); const memKey = (): object => { try { return (globalThis.localStorage as object) || mem; } catch { return mem; } };
const num = (v: unknown, max: number): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };
function readLock(): LockState {
  try { const r = localStorage.getItem(LOCK_KEY); if (r) { const j = JSON.parse(r) as Record<string, unknown>; return { fails: Math.floor(num(j?.fails, 1000)), until: num(j?.until, 8.64e15) }; } } catch { /* fall through to the in-memory copy */ }
  return mem.get(memKey()) ?? { fails: 0, until: 0 };
}
function writeLock(s: LockState): void { mem.set(memKey(), s); try { if (s.until > 0) localStorage.setItem(LOCK_KEY, JSON.stringify(s)); else localStorage.removeItem(LOCK_KEY); } catch { /* storage blocked: the in-memory copy still applies */ } }
export const lockFailures = (): number => readLock().fails;
/** Lock-out length after `fails` consecutive wrong attempts: none below 5, then 60 s, 120 s, 240 s … at most 15 minutes. */
export const lockDurationMs = (fails: number): number => (fails < LOCK_THRESHOLD ? 0 : Math.min(LOCK_MAX_MS, LOCK_BASE_MS * 2 ** (fails - LOCK_THRESHOLD)));
export const lockRemainingMs = (now: number = Date.now()): number => Math.max(0, readLock().until - now);
export function recordAttempt(ok: boolean, now: number = Date.now()): void {
  if (ok) { writeLock({ fails: 0, until: 0 }); return; }
  const s = readLock(); const fails = s.fails + 1; writeLock({ fails, until: fails >= LOCK_THRESHOLD ? now + lockDurationMs(fails) : s.until });
}
export const lockMessage = (ms: number): string => { const s = Math.max(1, Math.ceil(ms / 1000)); return `Too many wrong attempts. Try again in ${s >= 120 ? `${Math.ceil(s / 60)} minutes` : `${s} second${s === 1 ? '' : 's'}`}.`; };
/** Text for the UI when verification was refused because of the lock-out (null when not locked). */
export const lockNote = (now: number = Date.now()): string | null => { const r = lockRemainingMs(now); return r > 0 ? lockMessage(r) : null; };

// ───────────────────────────── verification ─────────────────────────────
/** Does `candidate` decrypt the marker in force (the central record's when one exists, otherwise this device's)? No lock-out bookkeeping. */
export async function checkPassword(candidate: string): Promise<boolean> { try { const c = central(); const blob = c ? c.marker : JSON.parse(await storedBlob()); if (!blob?.salt) return false; return (await decryptWithSecret(candidate, blob)) === MARKER; } catch { return false; } }
/** Does `candidate` match the marker stored on THIS device (even though a central record is in force)? Used only to explain "the central password replaced the local one". */
export async function localPasswordMatches(candidate: string): Promise<boolean> { try { const s = read(); if (!s) return false; const blob = JSON.parse(s); return !!blob?.salt && (await decryptWithSecret(candidate, blob)) === MARKER; } catch { return false; } }
export const hasLocalPassword = (): boolean => read() !== null;
/** The check every protected action uses. While locked out it answers false without looking at the password (see lockNote()). */
export async function verifyPassword(candidate: string): Promise<boolean> { if (lockRemainingMs() > 0) return false; const ok = await checkPassword(candidate); recordAttempt(ok); return ok; }
export async function changePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  if (central()) return { ok: false, error: CENTRAL_MANAGED_MESSAGE };
  if (!newPassword || newPassword.trim().length < 4) return { ok: false, error: 'New password must be at least 4 characters.' };
  if (newPassword === DEFAULT_PASSWORD) return { ok: false, error: 'Choose a password other than the default "admin".' };
  if (!(await verifyPassword(oldPassword))) return { ok: false, error: lockNote() || 'Current password is incorrect.' };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(await encryptWithSecret(newPassword, MARKER))); return { ok: true }; } catch (e) { return { ok: false, error: `The new password could not be saved (${(e as Error).message || 'browser storage rejected the write'}).` }; }
}
export function resetPasswordToDefault(): void { try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage blocked */ } }
export function isUsingDefaultPassword(): boolean { const c = central(); return c ? c.isDefault : read() === null; }
