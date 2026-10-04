/** Settings → Secret Vault. Holds the GitHub token/config and the AI/LLM API key — encrypted at rest and in the repository. */
import { KEYS, browserStore, readJson, writeJson } from '../../services/storage.js';
import { encryptWithKey, decryptWithKey, encryptWithPassphrase, decryptWithPassphrase, indexedDbKeyProvider } from './cryptoBox.js';
export const EMPTY_SECRETS = { githubToken: '', githubRepo: 'subhamain86/Basware-AP-SQL-Assistant', githubBranch: 'main', schemaPath: 'schemas/schema-registry.json', vaultPath: 'vault/secret-vault.enc.json', aiApiKey: '' };
export const SENSITIVE_FIELDS = ['githubToken', 'aiApiKey'];
export class SecretVault {
    constructor(store = browserStore, keys = indexedDbKeyProvider) {
        this.store = store;
        this.keys = keys;
        this.cache = null;
    }
    hasLocal() { return !!this.store.get(KEYS.vaultLocal); }
    async load() {
        if (this.cache)
            return this.cache;
        const env = readJson(this.store, KEYS.vaultLocal, null);
        if (!env) {
            this.cache = { ...EMPTY_SECRETS };
            return this.cache;
        }
        const text = await decryptWithKey(env, await this.keys.getKey());
        this.cache = { ...EMPTY_SECRETS, ...JSON.parse(text) };
        return this.cache;
    }
    async save(s) {
        const clean = { ...EMPTY_SECRETS, ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v ?? '').trim()])) };
        const env = await encryptWithKey(JSON.stringify(clean), await this.keys.getKey());
        if (!writeJson(this.store, KEYS.vaultLocal, env))
            throw new Error('Browser storage rejected the encrypted vault write.');
        this.cache = clean;
    }
    /** Values that must be redacted from any message shown or logged. */
    knownSecrets() { return this.cache ? SENSITIVE_FIELDS.map((k) => this.cache[k]).filter(Boolean) : []; }
    async exportEncrypted(passphrase) { return JSON.stringify(await encryptWithPassphrase(JSON.stringify(await this.load()), passphrase), null, 2); }
    async importEncrypted(text, passphrase) {
        let env;
        try {
            env = JSON.parse(text);
        }
        catch {
            throw new Error('The repository vault file is not valid JSON.');
        }
        const s = { ...EMPTY_SECRETS, ...JSON.parse(await decryptWithPassphrase(env, passphrase)) };
        await this.save(s);
        return s;
    }
}
export function maskSecret(v) { return v ? `${'•'.repeat(8)}${v.slice(-4)}` : '(not set)'; }
//# sourceMappingURL=secretVault.js.map