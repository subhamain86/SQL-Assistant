import { KEYS, readJson, writeJson, type KeyValueStore } from '../../services/storage';
import { decryptWithSecret } from '../../services/cryptoService';
import { encryptWithKey, decryptWithKey, encryptWithPassphrase, decryptWithPassphrase, type DeviceKeyProvider, type VaultEnvelope } from './cryptoBox';
export interface VaultSecrets { githubOwner: string; githubRepo: string; githubBranch: string; schemaPath: string; vaultPath: string; githubToken: string; aiApiKey: string; }
/** Repository location used by V17.0–V17.2 (confirmed by the V17.1 provenance notes). */
export const CANONICAL_SCHEMA_PATH = 'sql-assistant-data/schemas/registry.json';
export const WRONG_PATHS = ['schemas/schema-registry.json'];
export const EMPTY_SECRETS: VaultSecrets = { githubOwner: '', githubRepo: '', githubBranch: 'main', schemaPath: CANONICAL_SCHEMA_PATH, vaultPath: 'sql-assistant-data/vault/secret-vault.v17.enc.json', githubToken: '', aiApiKey: '' };
/** Accepts "owner/repo" in the repo field (V17.2.1 format) as well as separate owner + repo (V10–V17.2 format). */
export function normalizeLocation(s: Partial<VaultSecrets> & Record<string, unknown>, remembered: Record<string, string> | null): VaultSecrets {
  const o: VaultSecrets = { ...EMPTY_SECRETS, ...(s as Partial<VaultSecrets>) };
  if (!o.githubOwner && /\//.test(o.githubRepo)) { const [ow, rp] = o.githubRepo.split('/'); o.githubOwner = ow; o.githubRepo = rp; }
  if (!o.githubOwner && remembered?.owner) o.githubOwner = remembered.owner; if (!o.githubRepo && remembered?.repo) o.githubRepo = remembered.repo.includes('/') ? remembered.repo.split('/')[1] : remembered.repo;
  if (!o.githubBranch) o.githubBranch = remembered?.branch || 'main';
  const given = typeof s.schemaPath === 'string' ? s.schemaPath.trim() : '';
  o.schemaPath = given && !WRONG_PATHS.includes(given) ? given : remembered?.path && !WRONG_PATHS.includes(remembered.path) ? remembered.path : CANONICAL_SCHEMA_PATH;
  if (!o.vaultPath) o.vaultPath = EMPTY_SECRETS.vaultPath; return o;
}
export class SecretVault {
  private cache: VaultSecrets | null = null;
  constructor(private store: KeyValueStore, private keys: DeviceKeyProvider) {}
  private remembered(): Record<string, string> | null { const r = readJson<Record<string, string> | null>(this.store, KEYS.syncLocation, null); return r ? { owner: r.owner || r.githubOwner || '', repo: r.repo || r.githubRepo || '', branch: r.branch || r.githubBranch || '', path: r.path || r.schemaPath || r.githubPath || '' } : null; }
  async load(): Promise<VaultSecrets> { if (this.cache) return this.cache; const env = readJson<VaultEnvelope | null>(this.store, KEYS.vaultLocal, null);
    const base = env ? JSON.parse(await decryptWithKey(env, await this.keys.getKey())) : {}; this.cache = normalizeLocation(base, this.remembered()); return this.cache; }
  async save(s: VaultSecrets): Promise<void> { const c = normalizeLocation(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v ?? '').trim()])) as Record<string, string>, null);
    if (!writeJson(this.store, KEYS.vaultLocal, await encryptWithKey(JSON.stringify(c), await this.keys.getKey()))) throw new Error('Browser storage rejected the encrypted vault write.');
    writeJson(this.store, KEYS.syncLocation, { owner: c.githubOwner, repo: c.githubRepo, branch: c.githubBranch, path: c.schemaPath }); this.cache = c; }
  knownSecrets(): string[] { return this.cache ? [this.cache.githubToken, this.cache.aiApiKey].filter(Boolean) : []; }
  async exportEncrypted(pass: string): Promise<string> { return JSON.stringify(await encryptWithPassphrase(JSON.stringify(await this.load()), pass), null, 2); }
  /** V17.2 local vault (sqla.secretvault.v15, encrypted with the Admin Password): imported once after Settings is unlocked, so tokens saved in V17.2 keep working. */
  async migrateFromV172(adminPassword: string): Promise<boolean> {
    const cur = await this.load(); if (cur.githubToken) return false;
    let raw: string | null = null; try { raw = localStorage.getItem('sqla.secretvault.v15'); } catch { return false; } if (!raw) return false;
    try { const f = JSON.parse(raw); const dec = await decryptWithSecret(adminPassword, f?.blob); if (dec === null) return false; const c = JSON.parse(dec);
      await this.save(normalizeLocation({ githubRepo: String(c.githubRepo || ''), githubBranch: String(c.githubBranch || 'main'), schemaPath: String(c.githubSchemaPath || ''), githubToken: String(c.githubToken || ''), aiApiKey: String(c.llmApiKey || '') } as Record<string, string>, null)); return true;
    } catch { return false; }
  }
  /** Reads both the V17.3.1 envelope and the V17.2 "sqla-vault-sync" v2 envelope (PBKDF2-SHA-256 + AES-256-GCM with AAD). */
  async importEncrypted(text: string, pass: string): Promise<VaultSecrets> {
    let parsed: Record<string, any>; try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('The repository vault file is not valid JSON.'); }
    if (parsed && parsed.format === 'sqla-vault-sync') { const s = await decryptV172Envelope(parsed, pass); await this.save(normalizeLocation({ githubRepo: String(s.githubRepo || ''), githubBranch: String(s.githubBranch || 'main'), schemaPath: String(s.githubSchemaPath || ''), githubToken: String(s.githubToken || ''), aiApiKey: String(s.llmApiKey || '') } as Record<string, string>, null)); this.cache = null; return this.load(); }
    return this.importV1(JSON.stringify(parsed), pass);
  }
  private async importV1(text: string, pass: string): Promise<VaultSecrets> { let e: VaultEnvelope; try { e = JSON.parse(text); } catch { throw new Error('The repository vault file is not valid JSON.'); } const s = JSON.parse(await decryptWithPassphrase(e, pass)); await this.save(normalizeLocation(s, null)); this.cache = null; return this.load(); }
}
export const maskSecret = (v: string) => (v ? `${'•'.repeat(8)}${v.slice(-4)}` : '(not set)');
async function decryptV172Envelope(e: Record<string, any>, pass: string): Promise<Record<string, unknown>> {
  if (e.version !== 2 || e.kdf?.name !== 'PBKDF2' || e.kdf?.hash !== 'SHA-256' || e.cipher?.name !== 'AES-GCM' || !Number.isInteger(e.kdf?.iterations) || e.kdf.iterations < 100000 || e.kdf.iterations > 5000000) throw new Error('The V17.2 vault file uses unsupported or modified parameters and was rejected.');
  const u = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pass).normalize('NFKC')) as BufferSource, 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: u(e.kdf.salt) as BufferSource, iterations: e.kdf.iterations }, km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u(e.cipher.iv) as BufferSource, additionalData: new TextEncoder().encode(String(e.aad)) as BufferSource, tagLength: 128 }, key, u(e.ciphertext) as BufferSource))); }
  catch { throw new Error('The vault could not be decrypted — the passphrase is wrong or the data was modified.'); }
}
