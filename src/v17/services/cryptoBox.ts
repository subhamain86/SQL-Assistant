/**
 * Authenticated encryption for Secret Vault data (AES-256-GCM).
 * - Repository copy: key derived from the user's Vault Sync Passphrase (PBKDF2-SHA-256, 310 000
 *   iterations, random 16-byte salt). The passphrase/key is never stored in the repository or source.
 * - Device copy: encrypted with a random, NON-EXTRACTABLE device key kept in IndexedDB.
 * Tampering is detected by GCM authentication (decrypt fails).
 */
export const VAULT_ENVELOPE_VERSION = 1;
export const PBKDF2_ITERATIONS = 310_000;
const AAD = new TextEncoder().encode('sql-assistant/secret-vault/v1');
export interface VaultEnvelope { v: number; alg: 'AES-256-GCM'; kdf: 'PBKDF2-SHA256' | 'DEVICE-KEY'; iter?: number; salt?: string; iv: string; ct: string; }
const b64 = (u: Uint8Array) => { let s = ''; u.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function subtle(): SubtleCrypto { const s = globalThis.crypto?.subtle; if (!s) throw new Error('Web Crypto is not available in this browser (a secure https:// or localhost context is required).'); return s; }
export async function deriveKey(passphrase: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  if (!passphrase || passphrase.length < 10) throw new Error('The Vault Sync Passphrase must be at least 10 characters.');
  const base = await subtle().importKey('raw', new TextEncoder().encode(passphrase) as BufferSource, 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(key: CryptoKey, plaintext: string): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: AAD as BufferSource }, key, new TextEncoder().encode(plaintext) as BufferSource));
  return { iv: b64(iv), ct: b64(ct) };
}
async function open(key: CryptoKey, env: VaultEnvelope): Promise<string> {
  try { const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(env.iv) as BufferSource, additionalData: AAD as BufferSource }, key, unb64(env.ct) as BufferSource); return new TextDecoder().decode(pt); }
  catch { throw new Error('The vault could not be decrypted — the passphrase is wrong or the data was modified.'); }
}
export async function encryptWithPassphrase(plaintext: string, passphrase: string): Promise<VaultEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16)); const key = await deriveKey(passphrase, salt);
  return { v: VAULT_ENVELOPE_VERSION, alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iter: PBKDF2_ITERATIONS, salt: b64(salt), ...(await seal(key, plaintext)) };
}
export async function decryptWithPassphrase(env: VaultEnvelope, passphrase: string): Promise<string> {
  if (!env || env.v !== VAULT_ENVELOPE_VERSION || env.alg !== 'AES-256-GCM' || env.kdf !== 'PBKDF2-SHA256' || !env.salt) throw new Error('The vault file is not a recognised encrypted vault.');
  return open(await deriveKey(passphrase, unb64(env.salt), env.iter || PBKDF2_ITERATIONS), env);
}
export async function encryptWithKey(plaintext: string, key: CryptoKey): Promise<VaultEnvelope> { return { v: VAULT_ENVELOPE_VERSION, alg: 'AES-256-GCM', kdf: 'DEVICE-KEY', ...(await seal(key, plaintext)) }; }
export async function decryptWithKey(env: VaultEnvelope, key: CryptoKey): Promise<string> { return open(key, env); }
export interface DeviceKeyProvider { getKey(): Promise<CryptoKey>; }
/** Non-extractable AES key persisted in IndexedDB (structured-clone of CryptoKey). */
export const indexedDbKeyProvider: DeviceKeyProvider = {
  async getKey() {
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('sql-assistant-keys', 1); r.onupgradeneeded = () => r.result.createObjectStore('keys'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const get = () => new Promise<CryptoKey | undefined>((res, rej) => { const t = db.transaction('keys', 'readonly').objectStore('keys').get('vault-device-key'); t.onsuccess = () => res(t.result as CryptoKey | undefined); t.onerror = () => rej(t.error); });
    let key = await get();
    if (!key) { key = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) as CryptoKey; await new Promise<void>((res, rej) => { const t = db.transaction('keys', 'readwrite').objectStore('keys').put(key, 'vault-device-key'); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); }
    return key;
  }
};
export function memoryKeyProvider(): DeviceKeyProvider { let k: CryptoKey | null = null; return { async getKey() { if (!k) k = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) as CryptoKey; return k; } }; }
