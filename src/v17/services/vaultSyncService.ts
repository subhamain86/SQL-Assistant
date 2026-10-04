/**
 * V17.0 — Push Secret Vault to Repository without the GitHub Vault feature. The GitHub token and
 * configuration are written to the repository ONLY as AES-256-GCM ciphertext; the key is derived with
 * PBKDF2-SHA-256 (600,000 iterations, random salt) from a separate Vault Sync Passphrase that is
 * NEVER written to the repository.
 */
import { makeError, redactSecrets, type AppError } from '../errors/appErrors';
export const VAULT_SYNC_PATH = 'sql-assistant-data/vault/secret-vault.v17.enc.json';
export const VAULT_SYNC_AAD = 'sqla-vault-sync:v2';
export const VAULT_SYNC_ITERATIONS = 600_000;
const MIN_ITERATIONS = 100_000;
export interface SyncedSecretPayload { githubToken: string; githubRepo: string; githubBranch: string; githubSchemaPath: string; llmApiKey?: string; m365Copilot?: unknown; }
export interface VaultSyncEnvelope {
  format: 'sqla-vault-sync'; version: 2;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string; tagLength: 128 };
  aad: string; ciphertext: string;
  meta: { updatedAt: string; updatedByDevice: string; contains: string[]; ciphertextSha256: string };
}
function b64(bytes: Uint8Array): string { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); }
function unb64(s: string): Uint8Array { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
async function sha256Hex(data: Uint8Array): Promise<string> { const d = await crypto.subtle.digest('SHA-256', data as BufferSource); return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, '0')).join(''); }
async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFKC')) as BufferSource, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export function validatePassphrase(passphrase: string, adminPassword?: string | null): string[] {
  const p = passphrase || ''; const issues: string[] = [];
  if (p.length < 12) issues.push('Use at least 12 characters.');
  if ([/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(p)).length < 3) issues.push('Use at least three of: lower-case, upper-case, digits, symbols.');
  if (adminPassword && p === adminPassword) issues.push('The Vault Sync Passphrase must be different from the Admin Password.');
  if (/^(.)\1+$/.test(p) || /(password|admin|123456|qwerty|basware)/i.test(p)) issues.push('Avoid common words or repeated characters.');
  return issues;
}
export function assertNoPlaintextSecrets(content: string, secrets: (string | undefined | null)[]): AppError | null {
  const leaked = secrets.filter((s): s is string => typeof s === 'string' && s.length >= 6).some((s) => content.includes(s) || content.includes(btoa(s)));
  return leaked ? makeError('ENCRYPTION_FAILED', 'Safety check failed: a secret value was found in readable form in the data about to be written, so nothing was written to the repository.') : null;
}
export async function encryptPayload(payload: SyncedSecretPayload, passphrase: string, deviceTag: string, iterations = VAULT_SYNC_ITERATIONS): Promise<{ envelope?: VaultSyncEnvelope; error?: AppError }> {
  try {
    if (!payload.githubToken) return { error: makeError('ENCRYPTION_FAILED', 'There is no GitHub access token in the local Secret Vault to synchronize. Set the token first (Secret Vault → GitHub Access Token).') };
    const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, Math.max(iterations, MIN_ITERATIONS));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: new TextEncoder().encode(VAULT_SYNC_AAD) as BufferSource, tagLength: 128 }, key, new TextEncoder().encode(JSON.stringify(payload)) as BufferSource));
    const contains = ['githubToken', 'githubRepo', 'githubBranch', 'githubSchemaPath', ...(payload.llmApiKey ? ['llmApiKey'] : []), ...(payload.m365Copilot ? ['m365Copilot'] : [])];
    const envelope: VaultSyncEnvelope = { format: 'sqla-vault-sync', version: 2, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: Math.max(iterations, MIN_ITERATIONS), salt: b64(salt) }, cipher: { name: 'AES-GCM', iv: b64(iv), tagLength: 128 }, aad: VAULT_SYNC_AAD, ciphertext: b64(ct), meta: { updatedAt: new Date().toISOString(), updatedByDevice: deviceTag, contains, ciphertextSha256: await sha256Hex(ct) } };
    const leak = assertNoPlaintextSecrets(JSON.stringify(envelope), [payload.githubToken, payload.llmApiKey, passphrase]); if (leak) return { error: leak };
    return { envelope };
  } catch (e) { return { error: makeError('ENCRYPTION_FAILED', `The browser could not encrypt the Secret Vault (${(e as Error)?.name || 'Web Crypto error'}). Nothing was written.`, undefined, [payload.githubToken, payload.llmApiKey, passphrase]) }; }
}
export function parseEnvelope(text: string): { envelope?: VaultSyncEnvelope; error?: AppError } {
  let obj: unknown; try { obj = JSON.parse(String(text ?? '').replace(/^\uFEFF/, '')); } catch { return { error: makeError('DECRYPTION_FAILED', 'The encrypted Secret Vault file is not valid JSON.') }; }
  const e = obj as VaultSyncEnvelope;
  if (!e || e.format !== 'sqla-vault-sync' || e.version !== 2 || !e.kdf?.salt || !e.cipher?.iv || !e.ciphertext) return { error: makeError('DECRYPTION_FAILED', 'This file is not a V17 encrypted Secret Vault (sqla-vault-sync v2).') };
  if (e.kdf.name !== 'PBKDF2' || e.kdf.hash !== 'SHA-256' || e.cipher.name !== 'AES-GCM' || e.aad !== VAULT_SYNC_AAD) return { error: makeError('DECRYPTION_FAILED', 'The encrypted Secret Vault uses unsupported or modified cryptographic parameters and was rejected.') };
  if (!Number.isInteger(e.kdf.iterations) || e.kdf.iterations < MIN_ITERATIONS || e.kdf.iterations > 5_000_000) return { error: makeError('DECRYPTION_FAILED', 'The encrypted Secret Vault has an unsafe key-derivation setting and was rejected (possible tampering).') };
  return { envelope: e };
}
export async function decryptEnvelope(envelope: VaultSyncEnvelope, passphrase: string): Promise<{ payload?: SyncedSecretPayload; error?: AppError }> {
  try {
    let ct: Uint8Array; try { ct = unb64(envelope.ciphertext); } catch { return { error: makeError('DECRYPTION_FAILED', 'The encrypted Secret Vault file is corrupted (ciphertext is not valid base64).') }; }
    if (envelope.meta?.ciphertextSha256 && (await sha256Hex(ct)) !== envelope.meta.ciphertextSha256) return { error: makeError('DECRYPTION_FAILED', 'The encrypted Secret Vault file is corrupted or was modified (integrity checksum mismatch).') };
    const key = await deriveKey(passphrase, unb64(envelope.kdf.salt), envelope.kdf.iterations);
    let plain: ArrayBuffer;
    try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.cipher.iv) as BufferSource, additionalData: new TextEncoder().encode(envelope.aad) as BufferSource, tagLength: 128 }, key, ct as BufferSource); }
    catch { return { error: makeError('DECRYPTION_FAILED', 'The Vault Sync Passphrase is incorrect, or the encrypted file was modified. Nothing was changed on this device.') }; }
    const payload = JSON.parse(new TextDecoder().decode(plain)) as SyncedSecretPayload;
    if (typeof payload?.githubToken !== 'string' || typeof payload.githubRepo !== 'string') return { error: makeError('DECRYPTION_FAILED', 'The decrypted Secret Vault content is incomplete (missing GitHub configuration).') };
    return { payload };
  } catch (e) { return { error: makeError('DECRYPTION_FAILED', `The encrypted Secret Vault could not be read (${(e as Error)?.name || 'format error'}).`, undefined, [passphrase]) }; }
}
export interface RepoApi { getFile(repo: string, branch: string, path: string, token: string): Promise<{ content: string; sha: string } | null>; putFile(repo: string, branch: string, path: string, token: string, content: string, message: string, sha: string | null): Promise<{ sha: string }>; }
export async function pushVaultSync(args: { payload: SyncedSecretPayload; passphrase: string; adminPassword?: string | null; deviceTag: string; api: RepoApi; iterations?: number }): Promise<{ ok: boolean; error?: AppError; meta?: VaultSyncEnvelope['meta'] }> {
  const secrets = [args.payload.githubToken, args.payload.llmApiKey, args.passphrase];
  const pIssues = validatePassphrase(args.passphrase, args.adminPassword);
  if (pIssues.length) return { ok: false, error: makeError('VAULT_PASSPHRASE_INVALID', 'The Vault Sync Passphrase does not meet the minimum strength rules.', pIssues) };
  const enc = await encryptPayload(args.payload, args.passphrase, args.deviceTag, args.iterations);
  if (!enc.envelope) return { ok: false, error: enc.error };
  const content = JSON.stringify(enc.envelope, null, 2);
  const leak = assertNoPlaintextSecrets(content, secrets); if (leak) return { ok: false, error: leak };
  try {
    const existing = await args.api.getFile(args.payload.githubRepo, args.payload.githubBranch, VAULT_SYNC_PATH, args.payload.githubToken);
    await args.api.putFile(args.payload.githubRepo, args.payload.githubBranch, VAULT_SYNC_PATH, args.payload.githubToken, content, `Update encrypted Secret Vault (V17, ${enc.envelope.meta.updatedAt})`, existing?.sha ?? null);
    return { ok: true, meta: enc.envelope.meta };
  } catch (e) { return { ok: false, error: makeError('REPOSITORY_SYNC_FAILED', `The encrypted Secret Vault could not be written to the repository: ${redactSecrets((e as { message?: string })?.message || 'request failed', secrets)}`, undefined, secrets) }; }
}
export async function pullVaultSync(args: { repo: string; branch: string; readToken: string; passphrase: string; api: RepoApi }): Promise<{ ok: boolean; payload?: SyncedSecretPayload; meta?: VaultSyncEnvelope['meta']; error?: AppError }> {
  const secrets = [args.readToken, args.passphrase];
  let file: { content: string } | null;
  try { file = await args.api.getFile(args.repo, args.branch, VAULT_SYNC_PATH, args.readToken); }
  catch (e) { const msg = (e as { message?: string })?.message || 'request failed'; const status = (e as { status?: number | null })?.status; return { ok: false, error: makeError('REPOSITORY_SYNC_FAILED', status === 401 || status === 403 || status === 404 ? `The repository could not be read without valid access (${msg}). For a private repository, enter a GitHub token with read access on this device first, or use "Import encrypted file".` : `The encrypted Secret Vault could not be downloaded: ${msg}`, undefined, secrets) }; }
  if (!file) return { ok: false, error: makeError('REPOSITORY_SYNC_FAILED', `No encrypted Secret Vault was found at ${VAULT_SYNC_PATH} in ${args.repo} (${args.branch}). Push it from a configured device first. (For a private repository without a token, GitHub also reports a missing file — use "Import encrypted file" in that case.)`) };
  const parsed = parseEnvelope(file.content); if (!parsed.envelope) return { ok: false, error: parsed.error };
  const dec = await decryptEnvelope(parsed.envelope, args.passphrase);
  return dec.payload ? { ok: true, payload: dec.payload, meta: parsed.envelope.meta } : { ok: false, error: dec.error };
}
