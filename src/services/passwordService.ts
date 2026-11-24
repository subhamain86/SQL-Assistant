/**
 * Settings → Admin Password (V17.2 behaviour, same storage key sqla.pwvault.v15 so existing passwords keep working).
 * The password itself is never stored: only an AES-GCM encrypted marker. Default password: "admin" (the UI warns while it is used).
 *
 * V17.7 — THE DEFAULT HAS ONE DOOR. The default "admin" is compared with a candidate in exactly one function (verifyDefault), reachable only from the `confirmed-default` branch of verifyPassword(); the stored marker is compared in another
 *   (verifyStored) that never falls back to the default (V17.6.9 used one function for both, so an EMPTY stored marker would have been replaced by the default). No other module names, compares or hints the default (tested).
 * V17.6.9 — THE DEFAULT IS CONFIRMED, NEVER PRESUMED. The bootstrap states are loading | central-applied | local-fallback | confirmed-default | error. Only the authority (AdminPasswordService) can report
 *   `confirmed-default`, and only after the AUTHORITATIVE repository answered "no record exists" (or an explicit central reset record was applied). A new device, a device without a repository connection, a refused
 *   credential, a failed read and a published copy that merely lists no record are NOT proof that no Admin Password was ever set — in all of them the default "admin" is refused. The provisional
 *   `default-unverified` state of V17.6.8 no longer exists.
 * V17.6.8 — verifyPassword() is THE authentication boundary: it asks the central-state authority first (see the block below). The local primitives in this module are unchanged.
 * V17.6.7 — the basis of every accepted check is recorded (default accepted WITHOUT a successful central read = "unverified"); a Settings session opened on a default basis is re-locked when a central password is applied.
 * V17.6.6 — verifyPassword() consults the central record BEFORE it accepts the default password on a device without a local marker (new-device fix).
 * V17.6.5 — CENTRALIZED. This module stays the LOCAL primitive (the marker blob in sqla.pwvault.v15, byte-compatible with V17.6.4 so a rollback keeps working).
 * The single authoritative copy lives in the repository (src/v17/services/adminPassword.ts, file …/security/admin-password.json). This module only offers
 *   · the blob primitives that service needs (read / write / validate / verify against a blob),
 *   · a refresh hook: when a candidate does not match the local marker, the central copy is fetched once and the candidate is checked again — so a password
 *     changed on another device works here without waiting for the next scheduled synchronization.
 */
import { encryptWithSecret, decryptWithSecret, type EncryptedBlob } from './cryptoService';
const STORAGE_KEY = 'sqla.pwvault.v15'; export const PASSWORD_MARKER = 'sqla-verified-marker-v15'; const MARKER = PASSWORD_MARKER; export const DEFAULT_PASSWORD = 'admin';
let defaultBlobCache: string | null = null;
const read = (): string | null => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } };
/** The marker blob of the DEFAULT password — used ONLY by verifyDefault(), i.e. only after the authority confirmed the default (V17.7: it is no longer a stand-in for a stored marker that is empty or missing). */
async function defaultBlob(): Promise<string> { if (!defaultBlobCache) defaultBlobCache = JSON.stringify(await encryptWithSecret(DEFAULT_PASSWORD, MARKER)); return defaultBlobCache; }
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** Structure check of an untrusted marker blob (repository file / local store). It cannot tell whether the blob opens — only a password can. */
export function isValidBlob(o: unknown): o is EncryptedBlob { const b = o as EncryptedBlob | null; return !!b && typeof b === 'object' && [b.salt, b.iv, b.ciphertext].every((x) => typeof x === 'string' && x.length > 0 && x.length <= 512 && B64.test(x)) && b.salt.length >= 16 && b.iv.length >= 12 && b.ciphertext.length >= 24; }
/** The marker blob stored on this device, or null while the default password is in use. */
export function readStoredBlob(): EncryptedBlob | null { const s = read(); if (!s) return null; try { const b = JSON.parse(s); return isValidBlob(b) ? b : null; } catch { return null; } }
/** Stores the marker blob (null = back to the default password). Returns false when browser storage rejected the write. */
export function writeStoredBlob(b: EncryptedBlob | null): boolean { try { if (b === null) localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, JSON.stringify(b)); return true; } catch { return false; } }
export async function verifyAgainstBlob(candidate: string, blob: EncryptedBlob): Promise<boolean> { try { return (await decryptWithSecret(candidate, blob)) === MARKER; } catch { return false; } }
/** V17.7: compares ONLY against the marker stored on this device. An empty or damaged marker never matches anything — it is never replaced by the default. */
async function verifyStored(candidate: string): Promise<boolean> { try { const raw = read(); if (!raw) return false; const blob = JSON.parse(raw); if (!blob?.salt) return false; return (await decryptWithSecret(candidate, blob)) === MARKER; } catch { return false; } }
/** V17.7: the ONE place that compares a candidate with the default password. Called only from the `confirmed-default` branch of verifyPassword(). */
async function verifyDefault(candidate: string): Promise<boolean> { try { const blob = JSON.parse(await defaultBlob()); return (await decryptWithSecret(candidate, blob)) === MARKER; } catch { return false; } }
/**
 * V17.6.8 — THE AUTHORITY. Every Admin Password check of the application (Settings unlock, Security tab, repository configuration, token change, Admin Query Library, …) ends in verifyPassword() below,
 * and verifyPassword() never decides alone: it first asks the registered PasswordAuthority (AdminPasswordService) for the state of the CENTRAL Admin Password on this device and obeys it.
 *   · The default "admin" is accepted ONLY when the authority reports the state `confirmed-default` (V17.6.9): the central record is an explicit reset record, or the AUTHORITATIVE repository (central access service,
 *     a token that can see the repository, a test repository) answered that no Admin Password record exists. A new device without a marker, a device without a connection, a refused credential, a failed read and a
 *     published copy that lists no record are NOT proof that the default is valid.
 *   · With no authority registered nothing is registered to consult, so the check fails CLOSED (only a local marker can match).
 * The unlock of Settings is bound to a one-time ticket that only a successful verifyPassword(…, 'settings-unlock') issues (see takeUnlockTicket / AppStore.unlockSettings): no UI or route can open Settings without it.
 */
export type BootstrapState = 'loading' | 'central-applied' | 'local-fallback' | 'confirmed-default' | 'error';
export interface AuthResolution { state: BootstrapState; /** the default password may be accepted (and nothing else may stand in for the central record) */ defaultAllowed: boolean; /** secret-free, human-readable reason (shown to the user when the check is blocked) */ reason: string; }
export interface PasswordAuthority { resolve(): Promise<AuthResolution>; }
let authority: PasswordAuthority | null = null; let lastResolution: AuthResolution | null = null;
export function setPasswordAuthority(a: PasswordAuthority | null): void { authority = a; lastResolution = null; }
const FAIL_CLOSED: AuthResolution = { state: 'error', defaultAllowed: false, reason: 'The central Admin Password service is not available.' };
export const lastAuthResolution = (): AuthResolution | null => lastResolution;
/**
 * V17.6.7 — WHICH credential let the last successful check through.
 *   central            — the marker came from the central record (or was replaced by it during this check)
 *   local              — a local marker (an older installation, or a password set on this device)
 *   default-confirmed  — the central state is known (authoritative repository holds no record / an explicit reset record) and the default is legitimately in force
 * (V17.6.9: there is no provisional default any more; a session opened on the confirmed default is still re-locked the moment a central, non-default password is applied.)
 */
export type AuthBasis = 'central' | 'local' | 'default-confirmed';
let lastBasis: AuthBasis | null = null; let sessionBasis: AuthBasis | null = null;
export const lastAuthBasis = (): AuthBasis | null => lastBasis;
export const sessionAuthBasis = (): AuthBasis | null => sessionBasis;
export const sessionOnDefault = (): boolean => sessionBasis === 'default-confirmed';
export function clearSessionBasis(): void { sessionBasis = null; ticket = null; actionTicket = null; }
/** Kept for compatibility (V17.6.7/8 callers): since V17.6.9 a default basis is only ever issued as 'default-confirmed', so there is nothing left to upgrade. */
export function confirmDefaultSession(): void { /* intentionally empty */ }
/** One-time ticket: issued only by a successful verifyPassword(candidate, 'settings-unlock'); consumed by AppStore.unlockSettings(). Valid for 30 seconds. */
const TICKET_MS = 30_000; let ticket: { basis: AuthBasis; at: number } | null = null;
export function takeUnlockTicket(): AuthBasis | null { const t = ticket; ticket = null; if (!t || Date.now() - t.at > TICKET_MS) return null; sessionBasis = t.basis; authTrace(`session:opened basis=${t.basis}`); return t.basis; }
/**
 * V17.7.1 — ONE-TIME ACTION TICKET for decisions on user-submitted queries (approve / reject). Same construction as the unlock ticket above: only a successful verifyPassword(…, 'admin-action') — i.e. the central
 * Admin Password authority — issues it, takeActionTicket() consumes it (single use, 30 seconds). The submission service (querySubmissions.ts) refuses to approve or reject without it, so the decision is authorized
 * where it is made and not by the visibility of a button or by the page the user happens to be on.
 */
let actionTicket: { basis: AuthBasis; at: number } | null = null;
export function takeActionTicket(): AuthBasis | null { const t = actionTicket; actionTicket = null; if (!t || Date.now() - t.at > TICKET_MS) return null; authTrace('action:ticket-used'); return t.basis; }
/** Authorization state that is held in memory by UI parts (Settings session, repository-configuration editor) is dropped through this single door. */
const invalidateListeners = new Set<(reason: string) => void>();
export function onAdminSessionInvalidated(fn: (reason: string) => void): () => void { invalidateListeners.add(fn); return () => invalidateListeners.delete(fn); }
export function invalidateAdminSession(reason: string): void { sessionBasis = null; ticket = null; actionTicket = null; authTrace(`session:invalidated ${String(reason).slice(0, 60)}`); [...invalidateListeners].forEach((l) => { try { l(reason); } catch { /* a listener must never break the authority */ } }); }
/** In-memory, secret-free trace of the authentication sequence (diagnostics; read by the tests through the e2e hook). Holds event names and numbers only — never a password, marker or token. */
export interface AuthTraceEntry { n: number; e: string }
const traceBuf: AuthTraceEntry[] = []; let traceN = 0;
export function authTrace(e: string): void { traceBuf.push({ n: ++traceN, e: String(e).slice(0, 120) }); if (traceBuf.length > 80) traceBuf.shift(); }
export const authTraceLog = (): AuthTraceEntry[] => traceBuf.slice();
/** Revision of the central record this device last applied or published (0 = none). Read-only; the key is written by AdminPasswordService (KEYS.adminPwMeta). A marker on a device that carries one IS the central verifier. */
const centralRevision = (): number => { try { const m = JSON.parse(localStorage.getItem('sqla.adminpwmeta.v1765') || 'null'); return Number.isInteger(m?.revision) && m.revision > 0 ? m.revision : 0; } catch { return 0; } };
export type VerifyPurpose = 'confirm' | 'settings-unlock' | 'admin-action';
/**
 * THE authoritative Admin Password check. 1) the authority makes sure the central state is loaded / refreshed (start-up bootstrap is awaited, a stale verifier is replaced); 2) the credential that is in force
 * on this device is the only one that can match: the marker (which IS the central verifier once applied) — or, only when the authority allows it, the default.
 */
export async function verifyPassword(candidate: string, purpose: VerifyPurpose = 'confirm'): Promise<boolean> {
  let r: AuthResolution; authTrace('auth:start');
  try { r = authority ? await authority.resolve() : FAIL_CLOSED; } catch { r = FAIL_CLOSED; } lastResolution = r; authTrace(`auth:state=${r.state} default=${r.defaultAllowed ? 'allowed' : 'blocked'}`);
  let ok = false; let basis: AuthBasis | null = null;
  if (r.state === 'loading') { authTrace('auth:blocked loading'); return false; }
  if (read() !== null) { ok = await verifyStored(candidate); basis = r.state === 'central-applied' || centralRevision() > 0 ? 'central' : 'local'; }
  else if (r.defaultAllowed && r.state === 'confirmed-default') { ok = await verifyDefault(candidate); basis = 'default-confirmed'; } // V17.6.9: the default is a candidate ONLY in the explicitly confirmed state — a bare `defaultAllowed` flag is not enough
  else authTrace('auth:blocked default-not-allowed');
  if (!ok) { authTrace('auth:rejected'); return false; }
  lastBasis = basis; authTrace(`auth:accepted basis=${basis}`); if (purpose === 'settings-unlock' && basis) ticket = { basis, at: Date.now() }; if (purpose === 'admin-action' && basis) actionTicket = { basis, at: Date.now() }; return true;
}
/** Why a check that failed may have failed for another reason than a wrong password: the central Admin Password could not be determined and this device holds no local marker. null = a plain wrong password. */
export function authBlockedMessage(): string | null {
  const r = lastResolution; if (!r || r.defaultAllowed || read() !== null) return null; if (r.state === 'loading') return 'The central Admin Password is still being loaded. Try again in a moment.';
  return `${r.reason || 'The central Admin Password could not be determined.'} Settings stay locked until it can be read — retry with the Sync button in the navigation bar (sign in to GitHub when asked), or ask your administrator.`;
}
/** Local verifier for a NEW password (same format as always: PBKDF2-SHA-256 → AES-256-GCM of the fixed marker). Nothing is stored. */
export async function buildVerifier(newPassword: string): Promise<EncryptedBlob> { return encryptWithSecret(newPassword, MARKER); }
export function validateNewPassword(newPassword: string): string | null { if (!newPassword || newPassword.trim().length < 4) return 'New password must be at least 4 characters.'; if (newPassword === DEFAULT_PASSWORD) return 'Choose a password other than the default "admin".'; return null; }
/** LOCAL change only (validation + marker). The application calls AdminPasswordService.change(), which also publishes the change centrally. */
export async function changePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const bad = validateNewPassword(newPassword); if (bad) return { ok: false, error: bad };
  if (!(await verifyPassword(oldPassword))) return { ok: false, error: 'Current password is incorrect.' };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(await encryptWithSecret(newPassword, MARKER))); return { ok: true }; } catch (e) { return { ok: false, error: `The new password could not be saved (${(e as Error).message || 'browser storage rejected the write'}).` }; }
}
/** LOCAL reset only (the application calls AdminPasswordService.reset(), which also publishes the reset centrally). */
export function resetPasswordToDefault(): void { try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage blocked */ } }
export function isUsingDefaultPassword(): boolean { return read() === null; }
