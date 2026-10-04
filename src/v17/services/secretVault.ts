import { KEYS, readJson, writeJson, type KeyValueStore } from '../../services/storage';
import { encryptWithKey, decryptWithKey, encryptWithPassphrase, decryptWithPassphrase, type DeviceKeyProvider, type VaultEnvelope } from './cryptoBox';
export interface VaultSecrets { githubToken: string; githubRepo: string; githubBranch: string; schemaPath: string; vaultPath: string; aiApiKey: string; }
/** V17.3: the schema path is again the one used by V17.0–V17.2 (sql-assistant-data/schemas/registry.json). */
export const CANONICAL_SCHEMA_PATH = 'sql-assistant-data/schemas/registry.json';
export const V1721_SCHEMA_PATH = 'schemas/schema-registry.json';
export const EMPTY_SECRETS: VaultSecrets = { githubToken: '', githubRepo: '', githubBranch: 'main', schemaPath: CANONICAL_SCHEMA_PATH, vaultPath: 'sql-assistant-data/vault/secret-vault.v17_3.enc.json', aiApiKey: '' };
/** Corrects locations written by the V17.2.1/V17.2.2 packages (wrong default path) and fills in the remembered V17.2 location. */
export function normalizeLocation(s: VaultSecrets, remembered: { repo?: string; branch?: string; path?: string } | null): VaultSecrets {
  const o = { ...s }; if (!o.schemaPath || o.schemaPath === V1721_SCHEMA_PATH) o.schemaPath = remembered?.path || CANONICAL_SCHEMA_PATH;
  if (!o.githubRepo && remembered?.repo) o.githubRepo = remembered.repo; if (!o.githubBranch) o.githubBranch = remembered?.branch || 'main';
  if (!o.vaultPath || o.vaultPath === 'vault/secret-vault.enc.json' || o.vaultPath === 'sql-assistant-data/vault/secret-vault.enc.json') o.vaultPath = EMPTY_SECRETS.vaultPath; return o;
}
export class SecretVault {
  private cache: VaultSecrets | null = null;
  constructor(private store: KeyValueStore, private keys: DeviceKeyProvider) {}
  private remembered(): { repo?: string; branch?: string; path?: string } | null { const r = readJson<Record<string, string> | null>(this.store, KEYS.syncLocation, null); return r ? { repo: r.repo || r.githubRepo, branch: r.branch || r.githubBranch, path: r.path || r.schemaPath || r.githubSchemaPath } : null; }
  async load(): Promise<VaultSecrets> { if (this.cache) return this.cache; const env = readJson<VaultEnvelope | null>(this.store, KEYS.vaultLocal, null);
    const base = env ? { ...EMPTY_SECRETS, ...JSON.parse(await decryptWithKey(env, await this.keys.getKey())) } : { ...EMPTY_SECRETS }; this.cache = normalizeLocation(base, this.remembered()); return this.cache; }
  async save(s: VaultSecrets): Promise<void> { const c = normalizeLocation({ ...EMPTY_SECRETS, ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v ?? '').trim()])) } as VaultSecrets, null);
    if (!writeJson(this.store, KEYS.vaultLocal, await encryptWithKey(JSON.stringify(c), await this.keys.getKey()))) throw new Error('Browser storage rejected the encrypted vault write.');
    writeJson(this.store, KEYS.syncLocation, { repo: c.githubRepo, branch: c.githubBranch, path: c.schemaPath }); this.cache = c; }
  knownSecrets(): string[] { return this.cache ? [this.cache.githubToken, this.cache.aiApiKey].filter(Boolean) : []; }
  async exportEncrypted(pass: string): Promise<string> { return JSON.stringify(await encryptWithPassphrase(JSON.stringify(await this.load()), pass), null, 2); }
  async importEncrypted(text: string, pass: string): Promise<VaultSecrets> { let e: VaultEnvelope; try { e = JSON.parse(text); } catch { throw new Error('The repository vault file is not valid JSON.'); } const s = { ...EMPTY_SECRETS, ...JSON.parse(await decryptWithPassphrase(e, pass)) } as VaultSecrets; await this.save(s); return this.load(); }
}
export const maskSecret = (v: string) => (v ? `${'•'.repeat(8)}${v.slice(-4)}` : '(not set)');
