/**
 * V17.6.5 — CENTRAL ADMIN PASSWORD RECORD (pure logic, no storage, no network).
 *
 * One small JSON file in the repository, `sql-assistant-data/security/admin-credential.json`:
 *
 *   { "format": "sqla-admin-credential", "formatVersion": 1, "revision": 7, "updatedAt": "<ISO>", "updatedBy": "<device id>", "isDefault": false,
 *     "marker": { "salt": "<b64>", "iv": "<b64>", "ciphertext": "<b64>" } }
 *
 * `marker` is the EXISTING encrypted verification marker of the Admin Password (PBKDF2-SHA-256 150 000 iterations → AES-256-GCM over the fixed text "sqla-verified-marker-v15"; the same format as
 * the browser-storage entry sqla.pwvault.v15). The password is NEVER written: neither in plaintext, nor Base64, nor in any reversible form. Entering a password "verifies" it by decrypting the marker; only
 * the right password decrypts it (GCM authenticates). Anything else in the record — revision, time, device, isDefault — is public metadata.
 *
 * The parser is deliberately strict: exactly these keys, exact types, canonical Base64 of the exact lengths this cipher produces (salt 16 bytes, IV 12 bytes, marker 24 bytes + 16 byte tag = 40 bytes),
 * at most 4 KB. A password-like extra field, a different cipher, a newer format version, a damaged file — all are REFUSED, and the caller keeps its last good record.
 * `isDefault` is checked against the marker itself (a default record must open with the public default password and a normal one must not), so a record cannot claim to be something it is not.
 * Rollback protection (decideAdoption): only a higher revision with a time stamp not older than the current one is applied; an older revision, or the same revision with different content, is refused.
 */
import { encryptWithSecret, decryptWithSecret, type EncryptedBlob } from '../../services/cryptoService';
import { MARKER, DEFAULT_PASSWORD } from '../../services/passwordService';

export const ADMIN_CREDENTIAL_PATH = 'sql-assistant-data/security/admin-credential.json';
export const ADMIN_CREDENTIAL_FORMAT = 'sqla-admin-credential'; export const ADMIN_CREDENTIAL_FORMAT_VERSION = 1;
export const MAX_ADMIN_CREDENTIAL_BYTES = 4096; export const MIN_NEW_PASSWORD_LENGTH = 10;
export interface AdminCredentialRecord { format: typeof ADMIN_CREDENTIAL_FORMAT; formatVersion: 1; revision: number; updatedAt: string; updatedBy: string; isDefault: boolean; marker: EncryptedBlob; }
export type CredentialProblem = 'damaged' | 'unknown-version' | 'tampered';
export type ParsedCredential = { ok: true; record: AdminCredentialRecord } | { ok: false; reason: CredentialProblem; message: string };

const TOP_KEYS = ['format', 'formatVersion', 'revision', 'updatedAt', 'updatedBy', 'isDefault', 'marker']; const MARKER_KEYS = ['salt', 'iv', 'ciphertext'];
const SALT_RE = /^[A-Za-z0-9+/]{22}==$/; const IV_RE = /^[A-Za-z0-9+/]{16}$/; const CT_RE = /^[A-Za-z0-9+/]{54}==$/; // 16 / 12 / 40 bytes
const DEVICE_RE = /^[A-Za-z0-9_-]{1,40}$/; const ISO_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const canonicalB64 = (s: string): boolean => { try { return btoa(atob(s)) === s; } catch { return false; } };
const isoOk = (v: unknown): v is string => typeof v === 'string' && ISO_RE.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;
const bad = (reason: CredentialProblem, message: string): ParsedCredential => ({ ok: false, reason, message });
const sameKeys = (o: Record<string, unknown>, keys: string[]): boolean => { const k = Object.keys(o); return k.length === keys.length && keys.every((x) => k.includes(x)); };

/** Strict parser for untrusted text (the repository file, the published copy, the device's cached copy). Never throws. */
export function parseAdminCredential(text: unknown): ParsedCredential {
  const t = String(text ?? '').replace(/^\uFEFF/, ''); if (!t.trim()) return bad('damaged', 'the record is empty'); if (t.length > MAX_ADMIN_CREDENTIAL_BYTES) return bad('damaged', 'the record is larger than an Admin Password record can be');
  let j: unknown; try { j = JSON.parse(t); } catch { return bad('damaged', 'the record is not valid JSON'); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return bad('damaged', 'the record is not a JSON object'); const o = j as Record<string, unknown>;
  if (o.format !== ADMIN_CREDENTIAL_FORMAT) return bad('damaged', 'it is not an SQL Assistant Admin Password record');
  if (o.formatVersion !== ADMIN_CREDENTIAL_FORMAT_VERSION) return bad('unknown-version', typeof o.formatVersion === 'number' && o.formatVersion > ADMIN_CREDENTIAL_FORMAT_VERSION ? 'it was written by a newer version of SQL Assistant — update this device' : 'its format version is not one this version understands');
  if (!sameKeys(o, TOP_KEYS)) return bad('tampered', 'it contains fields that an Admin Password record never has (or lacks required ones)');
  if (typeof o.revision !== 'number' || !Number.isSafeInteger(o.revision) || o.revision < 1 || o.revision > 1_000_000_000) return bad('damaged', '"revision" is not a positive whole number');
  if (!isoOk(o.updatedAt)) return bad('damaged', '"updatedAt" is not a valid time stamp'); if (typeof o.updatedBy !== 'string' || !DEVICE_RE.test(o.updatedBy)) return bad('damaged', '"updatedBy" is not a device id'); if (typeof o.isDefault !== 'boolean') return bad('damaged', '"isDefault" is not true or false');
  const m = o.marker; if (!m || typeof m !== 'object' || Array.isArray(m)) return bad('damaged', '"marker" is missing'); const mk = m as Record<string, unknown>; if (!sameKeys(mk, MARKER_KEYS)) return bad('tampered', 'the marker has unexpected fields');
  if (typeof mk.salt !== 'string' || !SALT_RE.test(mk.salt) || !canonicalB64(mk.salt) || typeof mk.iv !== 'string' || !IV_RE.test(mk.iv) || !canonicalB64(mk.iv) || typeof mk.ciphertext !== 'string' || !CT_RE.test(mk.ciphertext) || !canonicalB64(mk.ciphertext)) return bad('tampered', 'the encrypted marker is not in the format this application writes (AES-256-GCM, PBKDF2 salt)');
  return { ok: true, record: { format: ADMIN_CREDENTIAL_FORMAT, formatVersion: 1, revision: o.revision, updatedAt: o.updatedAt, updatedBy: o.updatedBy, isDefault: o.isDefault, marker: { salt: mk.salt, iv: mk.iv, ciphertext: mk.ciphertext } } };
}
/** Canonical text of a record (fixed key order). Everything written to the repository / the device cache goes through here. */
export const serializeAdminCredential = (r: AdminCredentialRecord): string => `${JSON.stringify({ format: r.format, formatVersion: r.formatVersion, revision: r.revision, updatedAt: r.updatedAt, updatedBy: r.updatedBy, isDefault: r.isDefault, marker: { salt: r.marker.salt, iv: r.marker.iv, ciphertext: r.marker.ciphertext } }, null, 2)}\n`;
export const sameCredential = (a: AdminCredentialRecord, b: AdminCredentialRecord): boolean => serializeAdminCredential(a) === serializeAdminCredential(b);

/** Does `candidate` decrypt the record's marker? (The ONLY way a password is ever checked.) */
export async function credentialMatches(r: AdminCredentialRecord, candidate: string): Promise<boolean> { try { return (await decryptWithSecret(candidate, r.marker)) === MARKER; } catch { return false; } }
/** A record must be what it says it is: `isDefault` ⇔ the marker opens with the public default password. A mismatch means the record was forged or damaged. */
export async function credentialIsConsistent(r: AdminCredentialRecord): Promise<boolean> { return (await credentialMatches(r, DEFAULT_PASSWORD)) === r.isDefault; }

export interface BuildOptions { previous: AdminCredentialRecord | null; updatedBy: string; isDefault: boolean; now?: Date; }
/** The next record: revision = previous + 1, a time stamp that is never older than the previous one, and a FRESH encrypted marker (new random salt and IV) for `password`. */
export async function buildAdminCredential(password: string, o: BuildOptions): Promise<AdminCredentialRecord> {
  if (!DEVICE_RE.test(o.updatedBy)) throw new Error('The device id is not valid.');
  let at = (o.now ?? new Date()).getTime(); if (o.previous) at = Math.max(at, Date.parse(o.previous.updatedAt) + (at <= Date.parse(o.previous.updatedAt) ? 1 : 0));
  return { format: ADMIN_CREDENTIAL_FORMAT, formatVersion: 1, revision: (o.previous?.revision ?? 0) + 1, updatedAt: new Date(at).toISOString(), updatedBy: o.updatedBy, isDefault: o.isDefault, marker: await encryptWithSecret(password, MARKER) };
}

export type RefusalReason = 'rollback' | 'older-timestamp' | 'conflicting-content';
export type Adoption = { action: 'apply' } | { action: 'same' } | { action: 'refuse'; reason: RefusalReason; message: string };
/** Rollback protection. A higher revision whose time stamp is not older is applied; the identical record changes nothing; everything else is refused. */
export function decideAdoption(current: AdminCredentialRecord | null, incoming: AdminCredentialRecord): Adoption {
  if (!current) return { action: 'apply' };
  if (incoming.revision === current.revision) return sameCredential(current, incoming) ? { action: 'same' } : { action: 'refuse', reason: 'conflicting-content', message: `it has the same revision (${current.revision}) as the record this device holds but different content` };
  if (incoming.revision < current.revision) return { action: 'refuse', reason: 'rollback', message: `it is an older revision (${incoming.revision}) than the one this device holds (${current.revision})` };
  if (Date.parse(incoming.updatedAt) < Date.parse(current.updatedAt)) return { action: 'refuse', reason: 'older-timestamp', message: 'it has a higher revision but an older time stamp than the record this device holds' };
  return { action: 'apply' };
}

// ───────────────────────────── password policy and strength ─────────────────────────────
export function checkNewPassword(pw: string): { ok: true } | { ok: false; message: string } {
  const p = String(pw ?? ''); if (p.trim().toLowerCase() === DEFAULT_PASSWORD) return { ok: false, message: 'Weak password: choose a password other than the default "admin".' };
  if ([...p].length < MIN_NEW_PASSWORD_LENGTH) return { ok: false, message: `Weak password: use at least ${MIN_NEW_PASSWORD_LENGTH} characters (this one has ${[...p].length}).` }; return { ok: true };
}
export interface Strength { score: 0 | 1 | 2 | 3 | 4; label: string; }
/** A simple local estimate (length and variety) for the indicator only; the policy is checkNewPassword(). Nothing is sent anywhere. */
export function passwordStrength(pw: string): Strength {
  const p = String(pw ?? ''); const n = [...p].length; if (!n) return { score: 0, label: 'Enter a password' }; if (p.trim().toLowerCase() === DEFAULT_PASSWORD || n < MIN_NEW_PASSWORD_LENGTH) return { score: n < 6 ? 0 : 1, label: n < MIN_NEW_PASSWORD_LENGTH ? `Too short (${n}/${MIN_NEW_PASSWORD_LENGTH})` : 'Too weak' };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(p)).length; const distinct = new Set([...p]).size; let s = 1 + (n >= 14 ? 1 : 0) + (classes >= 3 ? 1 : 0) + (n >= 18 && classes >= 2 ? 1 : 0); if (distinct < 5) s = 1; s = Math.min(4, s);
  return { score: s as Strength['score'], label: (['', 'Fair', 'Good', 'Strong', 'Very strong'] as const)[s] };
}
