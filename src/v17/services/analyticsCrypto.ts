/**
 * V17.7.4 — USAGE ANALYTICS, serverless provider ("repository"): the cryptography. WebCrypto only (no library, no network, no storage, no console).
 *
 * What it gives:
 *   · ONE administrator key pair, ECDH P-256. The PUBLIC key goes to the devices; the PRIVATE key exists only (a) wrapped in `admin-key.json` and (b) unwrapped in the memory of an unlocked Analytics session.
 *   · The private key is wrapped with AES-256-GCM under a key derived from the ADMINISTRATOR PASSWORD with PBKDF2-HMAC-SHA-256 (≥ 600 000 iterations, random 16-byte salt). A wrong password makes the GCM tag fail —
 *     that failure IS the authentication: no password, no password hash, no verifier text and no "known plaintext" is stored anywhere. (An attacker who can read the file can only guess offline: see docs/ANALYTICS_SERVERLESS.md.)
 *   · Telemetry is encrypted on the device with a hybrid scheme: an ephemeral ECDH key pair per batch → HKDF-SHA-256 → AES-256-GCM, bound to the key id and the format by the AAD. Only the holder of the private key can read it.
 *   · Batches are padded to size buckets so a file's size does not reveal how many events it holds.
 *
 * Nothing here knows about GitHub, the page or the tracker. Pure functions over bytes and objects, tested in Node (which has the same WebCrypto).
 */
export const KDF_MIN_ITERATIONS = 600_000; export const KDF_DEFAULT_ITERATIONS = 600_000; export const KDF_MAX_ITERATIONS = 5_000_000;
export const ADMIN_KEY_FORMAT = 'sqla-analytics-admin-key'; export const PUBLIC_KEY_FORMAT = 'sqla-analytics-public-key'; export const BATCH_FORMAT = 'sqla-analytics-batch'; export const ROLLUP_FORMAT = 'sqla-analytics-rollup';
export const MIN_PASSWORD_LENGTH = 14; export const MAX_PASSWORD_LENGTH = 128;
const te = new TextEncoder(); const td = new TextDecoder();

// ───────────────────────────────────────────────────────────── encodings
export function b64uEncode(b: Uint8Array): string { let s = ''; for (let i = 0; i < b.length; i += 1) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function b64uDecode(t: string): Uint8Array { if (typeof t !== 'string' || !/^[A-Za-z0-9_-]*$/.test(t)) throw new AnalyticsCryptoError('bad-encoding'); const p = t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4); const s = atob(p); const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i += 1) o[i] = s.charCodeAt(i); return o; }
export const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
export const randomHexId = (bytes = 16): string => Array.from(randomBytes(bytes), (x) => x.toString(16).padStart(2, '0')).join('');
/** WebCrypto accepts ArrayBuffer-backed views only — a plain copy keeps the type checker and every runtime happy. */
const buf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

export type CryptoFailure = 'bad-encoding' | 'invalid-password' | 'bad-key-file' | 'bad-public-key' | 'bad-envelope' | 'unknown-key' | 'decrypt-failed' | 'weak-kdf' | 'unsupported';
export class AnalyticsCryptoError extends Error { constructor(public kind: CryptoFailure, message?: string) { super(message || kind); this.name = 'AnalyticsCryptoError'; } }
export const cryptoFailure = (e: unknown): CryptoFailure | null => (e && (e as { name?: string }).name === 'AnalyticsCryptoError' ? (e as AnalyticsCryptoError).kind : null);
export const cryptoAvailable = (): boolean => typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.getRandomValues === 'function';

// ───────────────────────────────────────────────────────────── password policy (checked where a password is CHOSEN; an existing password is never judged by it)
const COMMON = ['password', 'passw0rd', 'administrator', 'admin', 'letmein', 'welcome', 'qwerty', 'qwertyuiop', 'iloveyou', 'changeme', 'sqlassistant', 'analytics', 'basware', 'invoiceready', 'abcdefgh', 'abcdefghijklmnop', '1234567890'];
const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', 'zyxwvutsrqponmlkjihgfedcba', '01234567890123456789', '98765432109876543210', 'qwertyuiopasdfghjklzxcvbnm', 'qwertyuiop', 'asdfghjkl'];
/** '' when the password may be chosen, otherwise the reason (shown to the administrator). Minimum 14 characters; trivially weak values are refused. */
export function analyticsPasswordProblem(pw: string): string {
  const s = String(pw ?? '').normalize('NFKC'); if (s.length < MIN_PASSWORD_LENGTH) return `The password must have at least ${MIN_PASSWORD_LENGTH} characters.`; if (s.length > MAX_PASSWORD_LENGTH) return `The password must have at most ${MAX_PASSWORD_LENGTH} characters.`;
  const low = s.toLowerCase(); if (new Set(low).size < 8) return 'That password is too easy to guess: it uses too few different characters. Use a longer passphrase of unrelated words.';
  if (/^(.{1,6})\1+$/.test(low)) return 'That password is a repeated pattern. Use a longer passphrase of unrelated words.';
  const stripped = COMMON.reduce((t, w) => t.split(w).join(''), low).replace(/[^\p{L}]+/gu, ''); if (stripped.length < 8) return 'That password is built from common words and digits only. Use a passphrase of unrelated words.';
  for (const q of SEQUENCES) if (q.includes(low) || low.split('').every((_c, i, a) => i === 0 || q.includes(a[i - 1] + a[i]))) return 'That password is a keyboard or alphabet sequence. Use a passphrase of unrelated words.';
  return '';
}

// ───────────────────────────────────────────────────────────── key pair + key id
export interface PublicJwk { kty: 'EC'; crv: 'P-256'; x: string; y: string; }
export interface PublicKeyRecord { kid: string; alg: 'ECDH-P256'; jwk: PublicJwk; }
const B64U_43 = /^[A-Za-z0-9_-]{43}$/;
/** strict: exactly the four public members of a P-256 key — a JWK that carries `d` (a private key) or anything else is refused. */
export function parsePublicJwk(j: unknown): PublicJwk | null { if (!j || typeof j !== 'object' || Array.isArray(j)) return null; const o = j as Record<string, unknown>; const keys = Object.keys(o).sort().join(','); if (keys !== 'crv,kty,x,y' || o.kty !== 'EC' || o.crv !== 'P-256' || typeof o.x !== 'string' || typeof o.y !== 'string' || !B64U_43.test(o.x) || !B64U_43.test(o.y)) return null; return { kty: 'EC', crv: 'P-256', x: o.x, y: o.y }; }
export async function keyIdOf(j: PublicJwk): Promise<string> { const d = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(`${j.crv}|${j.x}|${j.y}`))); return b64uEncode(d.slice(0, 9)); }
export async function publicKeyRecord(j: PublicJwk): Promise<PublicKeyRecord> { return { kid: await keyIdOf(j), alg: 'ECDH-P256', jwk: j }; }
/** A public record is accepted only if the key id matches the key and the point is really on the curve (the import checks that). */
export async function validatePublicKeyRecord(r: unknown): Promise<PublicKeyRecord | null> {
  if (!r || typeof r !== 'object') return null; const o = r as Record<string, unknown>; const jwk = parsePublicJwk(o.jwk); if (!jwk || o.alg !== 'ECDH-P256' || typeof o.kid !== 'string' || o.kid !== (await keyIdOf(jwk))) return null;
  try { await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []); } catch { return null; } return { kid: o.kid, alg: 'ECDH-P256', jwk };
}

// ───────────────────────────────────────────────────────────── the administrator key file (private key wrapped with the password)
export interface WrappedKey { kid: string; alg: 'ECDH-P256'; publicJwk: PublicJwk; iv: string; ct: string; createdAt: string; }
export interface AdminKeyFile { format: typeof ADMIN_KEY_FORMAT; formatVersion: 1; kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string }; keys: WrappedKey[]; current: string; updatedAt: string; }
export interface UnlockedKeys { file: AdminKeyFile; keys: Map<string, CryptoKey>; current: PublicKeyRecord; }
const wrapAad = (kid: string): Uint8Array => te.encode(`${ADMIN_KEY_FORMAT}|1|${kid}`);

async function deriveWrapKey(password: string, saltB64: string, iterations: number): Promise<CryptoKey> {
  if (!Number.isInteger(iterations) || iterations < KDF_MIN_ITERATIONS || iterations > KDF_MAX_ITERATIONS) throw new AnalyticsCryptoError('weak-kdf');
  const base = await crypto.subtle.importKey('raw', buf(te.encode(String(password ?? '').normalize('NFKC'))), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: buf(b64uDecode(saltB64)), iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const wrapPkcs8 = async (wk: CryptoKey, pkcs8: Uint8Array, kid: string): Promise<{ iv: string; ct: string }> => { const iv = randomBytes(12); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(wrapAad(kid)) }, wk, buf(pkcs8))); return { iv: b64uEncode(iv), ct: b64uEncode(ct) }; };
const unwrapPkcs8 = async (wk: CryptoKey, k: WrappedKey): Promise<Uint8Array> => { try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(b64uDecode(k.iv)), additionalData: buf(wrapAad(k.kid)) }, wk, buf(b64uDecode(k.ct)))); } catch { throw new AnalyticsCryptoError('invalid-password'); } };
async function newKeyPair(): Promise<{ record: PublicKeyRecord; pkcs8: Uint8Array }> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']); const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey; const pub = parsePublicJwk({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }); if (!pub) throw new AnalyticsCryptoError('unsupported');
  return { record: await publicKeyRecord(pub), pkcs8: new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey)) };
}
const importPrivate = (pkcs8: Uint8Array): Promise<CryptoKey> => crypto.subtle.importKey('pkcs8', buf(pkcs8), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']); // NOT extractable: once unwrapped it can be used but not read back

/** Structural check of a file read from the repository (a damaged / hostile file never reaches the key derivation). */
export function parseAdminKeyFile(text: string): AdminKeyFile {
  let j: unknown; try { j = JSON.parse(text); } catch { throw new AnalyticsCryptoError('bad-key-file'); } if (!j || typeof j !== 'object') throw new AnalyticsCryptoError('bad-key-file'); const o = j as Record<string, unknown>; const kdf = o.kdf as Record<string, unknown> | undefined;
  if (o.format !== ADMIN_KEY_FORMAT || o.formatVersion !== 1 || !kdf || kdf.name !== 'PBKDF2-SHA256' || typeof kdf.salt !== 'string' || kdf.salt.length < 16 || kdf.salt.length > 64 || !Array.isArray(o.keys) || !o.keys.length || o.keys.length > 50 || typeof o.current !== 'string') throw new AnalyticsCryptoError('bad-key-file');
  if (typeof kdf.iterations !== 'number' || !Number.isInteger(kdf.iterations)) throw new AnalyticsCryptoError('bad-key-file'); if (kdf.iterations < KDF_MIN_ITERATIONS || kdf.iterations > KDF_MAX_ITERATIONS) throw new AnalyticsCryptoError('weak-kdf');
  const keys: WrappedKey[] = []; for (const k of o.keys as unknown[]) { const w = k as Record<string, unknown>; const pub = parsePublicJwk(w?.publicJwk); if (!w || !pub || w.alg !== 'ECDH-P256' || typeof w.kid !== 'string' || typeof w.iv !== 'string' || typeof w.ct !== 'string' || w.iv.length !== 16 || w.ct.length < 64 || w.ct.length > 400) throw new AnalyticsCryptoError('bad-key-file'); keys.push({ kid: w.kid, alg: 'ECDH-P256', publicJwk: pub, iv: w.iv, ct: w.ct, createdAt: typeof w.createdAt === 'string' ? w.createdAt.slice(0, 40) : '' }); }
  if (!keys.some((k) => k.kid === o.current)) throw new AnalyticsCryptoError('bad-key-file');
  return { format: ADMIN_KEY_FORMAT, formatVersion: 1, kdf: { name: 'PBKDF2-SHA256', iterations: kdf.iterations, salt: kdf.salt }, keys, current: o.current, updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt.slice(0, 40) : '' };
}
const currentRecord = async (f: AdminKeyFile): Promise<PublicKeyRecord> => { const k = f.keys.find((x) => x.kid === f.current)!; const rec = await validatePublicKeyRecord({ kid: k.kid, alg: k.alg, jwk: k.publicJwk }); if (!rec) throw new AnalyticsCryptoError('bad-key-file'); return rec; };

/** First-time set-up: a new key pair, wrapped under the (policy-checked) password. Returns the file to write and the unlocked keys. */
export async function createAdminKeyFile(password: string, opts: { iterations?: number; now?: () => string } = {}): Promise<UnlockedKeys> {
  const problem = analyticsPasswordProblem(password); if (problem) throw new AnalyticsCryptoError('invalid-password', problem);
  const iterations = opts.iterations ?? KDF_DEFAULT_ITERATIONS; const salt = b64uEncode(randomBytes(16)); const wk = await deriveWrapKey(password, salt, iterations); const kp = await newKeyPair(); const at = (opts.now ?? (() => new Date().toISOString()))();
  const w = await wrapPkcs8(wk, kp.pkcs8, kp.record.kid); const file: AdminKeyFile = { format: ADMIN_KEY_FORMAT, formatVersion: 1, kdf: { name: 'PBKDF2-SHA256', iterations, salt }, keys: [{ kid: kp.record.kid, alg: 'ECDH-P256', publicJwk: kp.record.jwk, ...w, createdAt: at }], current: kp.record.kid, updatedAt: at };
  return { file, keys: new Map([[kp.record.kid, await importPrivate(kp.pkcs8)]]), current: kp.record };
}
/** Unlocks every key of the file with the password. A wrong password (or a tampered file) → `invalid-password`; a structurally bad file → `bad-key-file`. */
export async function unlockAdminKeyFile(text: string | AdminKeyFile, password: string): Promise<UnlockedKeys> {
  const file = typeof text === 'string' ? parseAdminKeyFile(text) : text; const wk = await deriveWrapKey(password, file.kdf.salt, file.kdf.iterations); const keys = new Map<string, CryptoKey>();
  for (const k of file.keys) keys.set(k.kid, await importPrivate(await unwrapPkcs8(wk, k)));
  return { file, keys, current: await currentRecord(file) };
}
/** Change password: every private key is unwrapped with the OLD password and wrapped again under the NEW one (new salt) — the key pairs are unchanged, so every existing batch stays readable. */
export async function rewrapAdminKeyFile(file: AdminKeyFile, oldPassword: string, newPassword: string, opts: { iterations?: number; now?: () => string } = {}): Promise<AdminKeyFile> {
  const problem = analyticsPasswordProblem(newPassword); if (problem) throw new AnalyticsCryptoError('invalid-password', `The new password was not accepted. ${problem}`);
  const oldWk = await deriveWrapKey(oldPassword, file.kdf.salt, file.kdf.iterations); const plain: { k: WrappedKey; pkcs8: Uint8Array }[] = []; for (const k of file.keys) plain.push({ k, pkcs8: await unwrapPkcs8(oldWk, k) });
  const iterations = Math.max(opts.iterations ?? KDF_DEFAULT_ITERATIONS, KDF_MIN_ITERATIONS); const salt = b64uEncode(randomBytes(16)); const wk = await deriveWrapKey(newPassword, salt, iterations); const keys: WrappedKey[] = [];
  for (const p of plain) { const w = await wrapPkcs8(wk, p.pkcs8, p.k.kid); keys.push({ ...p.k, ...w }); p.pkcs8.fill(0); }
  return { ...file, kdf: { name: 'PBKDF2-SHA256', iterations, salt }, keys, updatedAt: (opts.now ?? (() => new Date().toISOString()))() };
}
/** Rotate keys: the password must be right (the current key is unwrapped to prove it), a NEW pair is created and wrapped under the same derived key; the old wrapped keys stay so old data stays readable. */
export async function rotateAdminKeyFile(file: AdminKeyFile, password: string, opts: { now?: () => string } = {}): Promise<UnlockedKeys> {
  if (file.keys.length >= 40) throw new AnalyticsCryptoError('unsupported', 'Too many keys: compact the data and start from a new set-up.');
  const wk = await deriveWrapKey(password, file.kdf.salt, file.kdf.iterations); const keys = new Map<string, CryptoKey>(); for (const k of file.keys) keys.set(k.kid, await importPrivate(await unwrapPkcs8(wk, k)));
  const kp = await newKeyPair(); const at = (opts.now ?? (() => new Date().toISOString()))(); const w = await wrapPkcs8(wk, kp.pkcs8, kp.record.kid); keys.set(kp.record.kid, await importPrivate(kp.pkcs8));
  const next: AdminKeyFile = { ...file, keys: [...file.keys, { kid: kp.record.kid, alg: 'ECDH-P256', publicJwk: kp.record.jwk, ...w, createdAt: at }], current: kp.record.kid, updatedAt: at };
  return { file: next, keys, current: kp.record };
}

// ───────────────────────────────────────────────────────────── hybrid encryption of a batch / roll-up
export interface Envelope { format: typeof BATCH_FORMAT | typeof ROLLUP_FORMAT; v: 1; kid: string; epk: { x: string; y: string }; iv: string; ct: string; }
const PAD_BUCKETS = [1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576, 2097152, 4194304];
const infoOf = (fmt: string, kid: string): Uint8Array => te.encode(`sqla-analytics|${fmt}|1|${kid}`);
async function envelopeKey(priv: CryptoKey, pub: CryptoKey, fmt: string, kid: string): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256); const ikm = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: buf(te.encode('sqla-analytics-v1')), info: buf(infoOf(fmt, kid)) }, ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/** `value` is JSON-serialised, padded with spaces to a size bucket (JSON ignores trailing whitespace) and encrypted to the recipient's public key. */
export async function encryptFor(recipient: PublicKeyRecord, format: Envelope['format'], value: unknown): Promise<Envelope> {
  const rec = await validatePublicKeyRecord(recipient); if (!rec) throw new AnalyticsCryptoError('bad-public-key');
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']); const pub = await crypto.subtle.importKey('jwk', rec.jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const key = await envelopeKey(eph.privateKey, pub, format, rec.kid); const ej = (await crypto.subtle.exportKey('jwk', eph.publicKey)) as JsonWebKey; if (!ej.x || !ej.y) throw new AnalyticsCryptoError('unsupported');
  let plain = te.encode(JSON.stringify(value)); const bucket = PAD_BUCKETS.find((b) => b >= plain.length + 16) ?? plain.length; if (bucket > plain.length) { const p = new Uint8Array(bucket); p.set(plain); p.fill(0x20, plain.length); plain = p; }
  const iv = randomBytes(12); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(infoOf(format, rec.kid)) }, key, buf(plain)));
  return { format, v: 1, kid: rec.kid, epk: { x: ej.x, y: ej.y }, iv: b64uEncode(iv), ct: b64uEncode(ct) };
}
export function parseEnvelope(text: string, format: Envelope['format']): Envelope {
  let j: unknown; try { j = JSON.parse(text); } catch { throw new AnalyticsCryptoError('bad-envelope'); } if (!j || typeof j !== 'object') throw new AnalyticsCryptoError('bad-envelope'); const o = j as Record<string, unknown>; const e = o.epk as Record<string, unknown> | undefined;
  if (o.format !== format || o.v !== 1 || typeof o.kid !== 'string' || o.kid.length > 24 || !e || typeof e.x !== 'string' || typeof e.y !== 'string' || !B64U_43.test(e.x) || !B64U_43.test(e.y) || typeof o.iv !== 'string' || o.iv.length !== 16 || typeof o.ct !== 'string' || o.ct.length < 22 || o.ct.length > 6_000_000) throw new AnalyticsCryptoError('bad-envelope');
  return { format, v: 1, kid: o.kid, epk: { x: e.x, y: e.y }, iv: o.iv, ct: o.ct };
}
/** Decrypts with the private key of the envelope's key id; an unknown key id → `unknown-key`; a damaged / forged envelope → `decrypt-failed` (the plaintext is parsed as JSON only after the tag verified). */
export async function decryptWith(keys: Map<string, CryptoKey>, env: Envelope): Promise<unknown> {
  const priv = keys.get(env.kid); if (!priv) throw new AnalyticsCryptoError('unknown-key');
  try { const pub = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: env.epk.x, y: env.epk.y }, { name: 'ECDH', namedCurve: 'P-256' }, false, []); const key = await envelopeKey(priv, pub, env.format, env.kid);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(b64uDecode(env.iv)), additionalData: buf(infoOf(env.format, env.kid)) }, key, buf(b64uDecode(env.ct))); return JSON.parse(td.decode(pt));
  } catch { throw new AnalyticsCryptoError('decrypt-failed'); }
}
