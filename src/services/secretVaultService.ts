/**
 * Local Secret Vault (V16 behaviour: AES-GCM, key derived from the Admin Password, stored in localStorage).
 * V17: optional llmApiKey / vaultSyncPassphrase; repository synchronisation is an explicit, passphrase-
 * encrypted action (src/v17/services/vaultSyncService.ts) — the implicit V16 auto-push is removed.
 */
import { encryptWithSecret, decryptWithSecret, type EncryptedBlob } from './cryptoService';
import { getFile } from './githubApiService';
import { safeString, safeLocalStorageSet } from '../utils/validation';
import { getDeviceTag } from '../engines/schemaVersionEngine';
const SECRET_VAULT_STORAGE_KEY = 'sqla.secretvault.v15';
export interface M365CopilotConfig { enabled: boolean; tenantId: string; clientId: string; agentEndpoint: string; scope: string; }
export function defaultM365CopilotConfig(): M365CopilotConfig { return { enabled: false, tenantId: '', clientId: '', agentEndpoint: '', scope: '' }; }
export interface SecretVaultConfig { githubRepo: string; githubBranch: string; githubSchemaPath: string; githubToken: string; sharedLocationLabel: string; m365Copilot: M365CopilotConfig; llmApiKey?: string; vaultSyncPassphrase?: string; }
export interface VaultVersionMeta { updatedAt: string; updatedByDevice: string; checksum: string; }
interface StoredVaultFile { blob: EncryptedBlob; meta: VaultVersionMeta; }
export const DEFAULT_BOOTSTRAP_CONFIG = { githubRepo: 'subhamain86/Basware-AP-SQL-Assistant', githubBranch: 'main', githubSchemaPath: 'sql-assistant-data/schemas/registry.json' };
const LEGACY_VAULT_BLOB_PATH = 'sql-assistant-data/vault/secret-vault.enc.json';
function bootstrapConfig(): SecretVaultConfig { return { ...DEFAULT_BOOTSTRAP_CONFIG, githubToken: '', sharedLocationLabel: '', m365Copilot: defaultM365CopilotConfig(), llmApiKey: '', vaultSyncPassphrase: '' }; }
function normalizeM365Config(raw: unknown): M365CopilotConfig { const r = (raw && typeof raw === 'object') ? (raw as Partial<M365CopilotConfig>) : {}; return { enabled: !!r.enabled, tenantId: safeString(r.tenantId, ''), clientId: safeString(r.clientId, ''), agentEndpoint: safeString(r.agentEndpoint, ''), scope: safeString(r.scope, '') }; }
function normalizeVaultConfig(raw: unknown): SecretVaultConfig {
  const r = (raw && typeof raw === 'object') ? (raw as Partial<SecretVaultConfig>) : {};
  return { githubRepo: safeString(r.githubRepo, DEFAULT_BOOTSTRAP_CONFIG.githubRepo) || DEFAULT_BOOTSTRAP_CONFIG.githubRepo, githubBranch: safeString(r.githubBranch, DEFAULT_BOOTSTRAP_CONFIG.githubBranch) || 'main', githubSchemaPath: safeString(r.githubSchemaPath, DEFAULT_BOOTSTRAP_CONFIG.githubSchemaPath) || DEFAULT_BOOTSTRAP_CONFIG.githubSchemaPath, githubToken: safeString(r.githubToken, ''), sharedLocationLabel: safeString(r.sharedLocationLabel, ''), m365Copilot: normalizeM365Config(r.m365Copilot), llmApiKey: safeString(r.llmApiKey, ''), vaultSyncPassphrase: safeString(r.vaultSyncPassphrase, '') };
}
export function maskToken(token: unknown): string { const t = safeString(token); if (!t) return 'Not configured'; return `${'•'.repeat(12)}${t.length > 4 ? t.slice(-4) : ''}`; }
async function checksum(c: SecretVaultConfig): Promise<string> { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ r: c.githubRepo, b: c.githubBranch, p: c.githubSchemaPath })) as BufferSource); return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join(''); }
export interface VaultBootstrapOutcome { ok: boolean; source: 'local' | 'repository' | 'created-fresh'; error?: string; }
class SecretVaultService {
  private unlockedConfig: SecretVaultConfig | null = null; private unlockedPassword: string | null = null; private listeners = new Set<() => void>();
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify(): void { this.listeners.forEach((l) => l()); }
  exists(): boolean { return localStorage.getItem(SECRET_VAULT_STORAGE_KEY) !== null; }
  isUnlocked(): boolean { return this.unlockedConfig !== null; }
  getConfig(): SecretVaultConfig | null { return this.unlockedConfig; }
  hasToken(): boolean { return !!this.unlockedConfig?.githubToken; }
  private async persistLocal(config: SecretVaultConfig, password: string): Promise<{ ok: boolean; error?: string }> {
    try { const blob = await encryptWithSecret(password, JSON.stringify(config)); const meta: VaultVersionMeta = { updatedAt: new Date().toISOString(), updatedByDevice: getDeviceTag(), checksum: await checksum(config) }; const r = safeLocalStorageSet(SECRET_VAULT_STORAGE_KEY, JSON.stringify({ blob, meta } as StoredVaultFile)); return r.ok ? { ok: true } : { ok: false, error: `The Secret Vault could not be saved to browser storage: ${r.error}` }; }
    catch (e) { return { ok: false, error: `Encryption failed: the browser could not encrypt the Secret Vault (${(e as Error)?.name || 'Web Crypto error'}).` }; }
  }
  async tryAutoUnlock(adminPassword: string): Promise<VaultBootstrapOutcome> {
    const rawLocal = localStorage.getItem(SECRET_VAULT_STORAGE_KEY);
    if (rawLocal) {
      try { const parsed = JSON.parse(rawLocal) as StoredVaultFile; const dec = await decryptWithSecret(adminPassword, parsed?.blob); if (dec === null) return { ok: false, source: 'local', error: 'Decryption failed: the local Secret Vault could not be unlocked with the current Admin Password (it may have been reset). Use Secret Vault → Reset, or Pull/Import the V17 encrypted copy.' }; this.unlockedConfig = normalizeVaultConfig(JSON.parse(dec)); this.unlockedPassword = adminPassword; this.notify(); return { ok: true, source: 'local' }; }
      catch { return { ok: false, source: 'local', error: 'The local Secret Vault data is corrupted and could not be read. Use Secret Vault → Reset, then Pull or Import the encrypted copy.' }; }
    }
    try {
      const remote = await getFile(DEFAULT_BOOTSTRAP_CONFIG.githubRepo, DEFAULT_BOOTSTRAP_CONFIG.githubBranch, LEGACY_VAULT_BLOB_PATH, '');
      if (remote) { const pr = JSON.parse(remote.content) as StoredVaultFile; const dec = await decryptWithSecret(adminPassword, pr?.blob); if (dec !== null) { const cfg = normalizeVaultConfig(JSON.parse(dec)); await this.persistLocal(cfg, adminPassword); this.unlockedConfig = cfg; this.unlockedPassword = adminPassword; this.notify(); return { ok: true, source: 'repository' }; } }
    } catch { /* offline / private repo / unreadable legacy copy — fall through to a fresh local vault */ }
    const cfg = bootstrapConfig(); const r = await this.persistLocal(cfg, adminPassword);
    this.unlockedConfig = cfg; this.unlockedPassword = adminPassword; this.notify();
    return r.ok ? { ok: true, source: 'created-fresh' } : { ok: true, source: 'created-fresh', error: r.error };
  }
  lock(): void { this.unlockedConfig = null; this.unlockedPassword = null; this.notify(); }
  async saveConfig(patch: Partial<SecretVaultConfig>): Promise<{ ok: boolean; error?: string }> {
    if (!this.unlockedConfig) return { ok: false, error: 'The Secret Vault is locked — unlock Settings with the Admin Password first.' };
    if (!this.unlockedPassword) return { ok: false, error: 'Session password unavailable — lock and re-unlock Settings.' };
    const merged = normalizeVaultConfig({ ...this.unlockedConfig, ...patch });
    const r = await this.persistLocal(merged, this.unlockedPassword); if (!r.ok) return r;
    this.unlockedConfig = merged; this.notify(); return { ok: true };
  }
  async saveM365CopilotConfig(patch: Partial<M365CopilotConfig>): Promise<{ ok: boolean; error?: string }> { if (!this.unlockedConfig) return { ok: false, error: 'The Secret Vault is locked.' }; return this.saveConfig({ m365Copilot: { ...this.unlockedConfig.m365Copilot, ...patch } }); }
  async reencryptForNewPassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
    const raw = localStorage.getItem(SECRET_VAULT_STORAGE_KEY); if (!raw) return { ok: true };
    try { const p = JSON.parse(raw) as StoredVaultFile; const dec = await decryptWithSecret(oldPassword, p?.blob); if (dec === null) return { ok: false, error: 'Could not re-encrypt the Secret Vault — the old password did not match.' }; const r = await this.persistLocal(normalizeVaultConfig(JSON.parse(dec)), newPassword); if (!r.ok) return r; if (this.unlockedConfig) { this.unlockedPassword = newPassword; this.notify(); } return { ok: true }; }
    catch { return { ok: false, error: 'The local Secret Vault data is corrupted.' }; }
  }
  resetVault(): void { localStorage.removeItem(SECRET_VAULT_STORAGE_KEY); this.unlockedConfig = null; this.unlockedPassword = null; this.notify(); }
}
export const secretVaultService = new SecretVaultService();
