/**
 * V17.5 — the passphrase saved on THIS device for the synchronized schema.
 * Stored only as AES-256-GCM ciphertext under the same non-extractable device key that protects the Secret Vault (never plaintext, never Base64, never in the
 * repository, a URL, a log or an error message). If the device key is gone the value is reported as unreadable and kept — it is not silently deleted.
 */
import { KEYS, readJson, writeJson, type KeyValueStore } from '../../services/storage';
import { encryptWithKey, decryptWithKey, type DeviceKeyProvider, type VaultEnvelope } from './cryptoBox';
import { checkPassphrase } from './schemaCrypto';
export class SchemaPassphraseStore {
  private cache: string | null | undefined; private bad = false;
  constructor(private store: KeyValueStore, private keys: DeviceKeyProvider) {}
  /** A passphrase is saved on this device (it may still be unreadable if the device key was lost). */
  hasSaved(): boolean { return !!this.store.get(KEYS.schemaPassphrase); }
  isUnreadable(): boolean { return this.bad; }
  async get(): Promise<string | null> {
    if (this.cache !== undefined) return this.cache; const env = readJson<VaultEnvelope | null>(this.store, KEYS.schemaPassphrase, null); if (!env) { this.cache = null; return null; }
    try { this.cache = JSON.parse(await decryptWithKey(env, await this.keys.getKey())).p as string; this.bad = false; } catch { this.cache = null; this.bad = true; } return this.cache;
  }
  async set(p: string): Promise<void> { const problem = checkPassphrase(p); if (problem) throw new Error(problem); if (!writeJson(this.store, KEYS.schemaPassphrase, await encryptWithKey(JSON.stringify({ p }), await this.keys.getKey()))) throw new Error('Browser storage rejected the write — the passphrase was not saved on this device.'); this.cache = p; this.bad = false; }
  clear(): void { this.store.remove(KEYS.schemaPassphrase); this.cache = null; this.bad = false; }
  /** Values to redact from any message that might otherwise echo them. */
  known(): string[] { return this.cache ? [this.cache] : []; }
}
