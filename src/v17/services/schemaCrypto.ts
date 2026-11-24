/**
 * V17.5 — passphrase protection of the synchronized schema file (real authenticated encryption, no encoding tricks).
 *
 *   file          sqla-schema-sync v1, JSON: a small CLEAR header (format, versions, writer, time, schema COUNT — nothing about tables or columns)
 *                 + cipher { AES-256-GCM, PBKDF2-SHA-256 310 000 iterations, random 16-byte salt, random 12-byte IV, ciphertext+tag }
 *                 + check  { a second GCM seal of a constant under the SAME key }
 *   key           derived from the passphrase on the device; the passphrase and the key are never written to the repository, a URL or a log
 *   AAD           binds the clear header to the ciphertext: editing any header field makes decryption fail (tamper detection)
 *   check         lets us tell "wrong passphrase" (check fails) from "damaged file" (check opens, data does not) without ever showing key material
 *
 * No key or passphrase exists in the source code. Decryption and validation both happen BEFORE anything is written to the local schema store.
 */
import { PBKDF2_ITERATIONS, deriveKeyFromPassphrase, sealWith, openWith, randomBytes, toB64, fromB64 } from './cryptoBox';
import { APP_VERSION, SCHEMA_FORMAT_VERSION, WRITER_LABEL } from '../sync/schemaFormat';
export const SCHEMA_SYNC_FORMAT = 'sqla-schema-sync'; export const SCHEMA_SYNC_FORMAT_VERSION = 1; export const MIN_PASSPHRASE_LENGTH = 10;
const CHECK_PLAIN = 'sqla-schema-sync:passphrase-check:v1'; const CHECK_AAD = 'sql-assistant/schema-sync/check/v1';
const aadFor = (h: { formatVersion: number; writtenAt: string; schemaCount: number }) => `sql-assistant/schema-sync/v1|${h.formatVersion}|${h.writtenAt}|${h.schemaCount}`;
export type SchemaCryptoCode = 'weak-passphrase' | 'incorrect-passphrase' | 'not-encrypted' | 'unsupported' | 'corrupted';
export class SchemaCryptoError extends Error { constructor(public code: SchemaCryptoCode, message: string) { super(message); this.name = 'SchemaCryptoError'; } }
export interface EncryptedSchemaHeader { format: string; formatVersion: number; appVersion: string; writtenBy: string; writtenByDevice: string; writtenAt: string; schemaFormatVersion: number; schemaCount: number; }
/** Validation of the passphrase itself — done BEFORE any repository access or decryption is attempted. */
export function checkPassphrase(p: string): string | null { if (!p || !p.trim()) return 'Enter the passphrase.'; if (p.length < MIN_PASSPHRASE_LENGTH) return `The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`; return null; }
/** …/schemas/registry.json → …/schemas/registry.enc.json (the encrypted twin of the schema registry file, in the same repository and folder) */
export function encryptedPathFor(schemaPath: string): string { const p = (schemaPath || '').trim(); return /\.json$/i.test(p) ? p.replace(/\.json$/i, '.enc.json') : `${p || 'sql-assistant-data/schemas/registry'}.enc.json`; }
const isB64 = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max && /^[A-Za-z0-9+/]+={0,2}$/.test(v);
function parse(fileText: string): Record<string, any> { let v: unknown; try { v = JSON.parse(String(fileText).replace(/^\uFEFF/, '')); } catch { throw new SchemaCryptoError('corrupted', 'The synchronized schema file is not readable (it is not valid JSON).'); } if (!v || typeof v !== 'object' || Array.isArray(v)) throw new SchemaCryptoError('corrupted', 'The synchronized schema file is not readable.'); return v as Record<string, any>; }
export function readHeader(fileText: string): EncryptedSchemaHeader | null { try { const v = parse(fileText); if (v.format !== SCHEMA_SYNC_FORMAT) return null; return { format: v.format, formatVersion: Number(v.formatVersion) || 0, appVersion: String(v.appVersion || ''), writtenBy: String(v.writtenBy || ''), writtenByDevice: String(v.writtenByDevice || ''), writtenAt: String(v.writtenAt || ''), schemaFormatVersion: Number(v.schemaFormatVersion) || 0, schemaCount: Number(v.schemaCount) || 0 }; } catch { return null; } }
export async function encryptSchemaRegistry(registryText: string, passphrase: string, meta: { device: string; schemaCount: number; now?: () => string }): Promise<string> {
  const weak = checkPassphrase(passphrase); if (weak) throw new SchemaCryptoError('weak-passphrase', weak);
  const header: EncryptedSchemaHeader = { format: SCHEMA_SYNC_FORMAT, formatVersion: SCHEMA_SYNC_FORMAT_VERSION, appVersion: APP_VERSION, writtenBy: WRITER_LABEL, writtenByDevice: meta.device, writtenAt: (meta.now || (() => new Date().toISOString()))(), schemaFormatVersion: SCHEMA_FORMAT_VERSION, schemaCount: meta.schemaCount };
  const salt = randomBytes(16); const key = await deriveKeyFromPassphrase(passphrase, salt, PBKDF2_ITERATIONS); const body = await sealWith(key, registryText, aadFor(header)); const check = await sealWith(key, CHECK_PLAIN, CHECK_AAD);
  const out = JSON.stringify({ ...header, cipher: { alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iter: PBKDF2_ITERATIONS, salt: toB64(salt), iv: body.iv, ct: body.ct }, check }, null, 1);
  if (out.includes(registryText.slice(0, 40)) || out.includes(passphrase)) throw new SchemaCryptoError('corrupted', 'Safety check failed: the encrypted file would contain readable data. Nothing was written.'); // belt and braces
  return out;
}
export async function decryptSchemaRegistry(fileText: string, passphrase: string): Promise<{ text: string; header: EncryptedSchemaHeader }> {
  const weak = checkPassphrase(passphrase); if (weak) throw new SchemaCryptoError('weak-passphrase', weak);
  const v = parse(fileText);
  if (v.format !== SCHEMA_SYNC_FORMAT) { if (Array.isArray(v.schemas) || Array.isArray(v.tables)) throw new SchemaCryptoError('not-encrypted', 'The synchronized schema file is not encrypted (it is a plain schema file written without a passphrase).'); throw new SchemaCryptoError('unsupported', 'The file is not a SQL Assistant encrypted schema file.'); }
  const header = readHeader(fileText)!; if (header.formatVersion > SCHEMA_SYNC_FORMAT_VERSION) throw new SchemaCryptoError('unsupported', `The encrypted schema file uses format ${header.formatVersion}; update SQL Assistant on this device to read it.`);
  const c = v.cipher; if (!c || c.alg !== 'AES-256-GCM' || c.kdf !== 'PBKDF2-SHA256' || !Number.isInteger(c.iter) || c.iter < 100_000 || c.iter > 2_000_000 || !isB64(c.salt, 64) || !isB64(c.iv, 32) || !isB64(c.ct, 20_000_000) || !v.check || !isB64(v.check.iv, 32) || !isB64(v.check.ct, 256)) throw new SchemaCryptoError('corrupted', 'The encrypted schema file is damaged or uses unsupported parameters.');
  const key = await deriveKeyFromPassphrase(passphrase, fromB64(c.salt), c.iter);
  try { if ((await openWith(key, v.check.iv, v.check.ct, CHECK_AAD)) !== CHECK_PLAIN) throw new Error('x'); } catch { throw new SchemaCryptoError('incorrect-passphrase', 'The passphrase is incorrect.'); }
  try { return { text: await openWith(key, c.iv, c.ct, aadFor(header)), header }; } catch { throw new SchemaCryptoError('corrupted', 'The schema could not be decrypted: the file is damaged or was modified.'); }
}
