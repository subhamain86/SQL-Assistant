/** Settings → Secret Vault. Holds the GitHub token/config and the AI/LLM API key — encrypted at rest and in the repository. */
import { KEYS, browserStore, readJson, writeJson, type KeyValueStore } from '../../services/storage';
import { encryptWithKey, decryptWithKey, encryptWithPassphrase, decryptWithPassphrase, indexedDbKeyProvider, type DeviceKeyProvider, type VaultEnvelope } from './cryptoBox';
export interface VaultSecrets { githubToken: string; githubRepo: string; githubBranch: string; schemaPath: string; vaultPath: string; aiApiKey: string; }
export const EMPTY_SECRETS: VaultSecrets = { githubToken: '', githubRepo: 'subhamain86/Basware-AP-SQL-Assistant', githubBranch: 'main', schemaPath: 'schemas/schema-registry.json', vaultPath: 'vault/secret-vault.enc.json', aiApiKey: '' };
export const SENSITIVE_FIELDS: (keyof VaultSecrets)[] = ['githubToken', 'aiApiKey'];
export class SecretVault {
  private cache: VaultSecrets | null = null;
  constructor(private store: KeyValueStore = browserStore, private keys: DeviceKeyProvider = indexedDbKeyProvider) {}
  hasLocal(): boolean { return !!this.store.get(KEYS.vaultLocal); }
  async load(): Promise<VaultSecrets> {
    if (this.cache) return this.cache;
    const env = readJson<VaultEnvelope | null>(this.store, KEYS.vaultLocal, null);
    if (!env) { this.cache = { ...EMPTY_SECRETS }; return this.cache; }
    const text = await decryptWithKey(env, await this.keys.getKey());
    this.cache = { ...EMPTY_SECRETS, ...JSON.parse(text) }; return this.cache!;
  }
  async save(s: VaultSecrets): Promise<void> {
    const clean: VaultSecrets = { ...EMPTY_SECRETS, ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v ?? '').trim()])) } as VaultSecrets;
    const env = await encryptWithKey(JSON.stringify(clean), await this.keys.getKey());
    if (!writeJson(this.store, KEYS.vaultLocal, env)) throw new Error('Browser storage rejected the encrypted vault write.');
    this.cache = clean;
  }
  /** Values that must be redacted from any message shown or logged. */
  knownSecrets(): string[] { return this.cache ? SENSITIVE_FIELDS.map((k) => this.cache![k]).filter(Boolean) : []; }
  async exportEncrypted(passphrase: string): Promise<string> { return JSON.stringify(await encryptWithPassphrase(JSON.stringify(await this.load()), passphrase), null, 2); }
  async importEncrypted(text: string, passphrase: string): Promise<VaultSecrets> {
    let env: VaultEnvelope; try { env = JSON.parse(text); } catch { throw new Error('The repository vault file is not valid JSON.'); }
    const s = { ...EMPTY_SECRETS, ...JSON.parse(await decryptWithPassphrase(env, passphrase)) } as VaultSecrets;
    await this.save(s); return s;
  }
}
export function maskSecret(v: string): string { return v ? `${'•'.repeat(8)}${v.slice(-4)}` : '(not set)'; }
