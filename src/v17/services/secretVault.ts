import { KEYS, readJson, writeJson, type KeyValueStore } from '../../services/storage';
import { decryptWithSecret } from '../../services/cryptoService';
import { encryptWithKey, decryptWithKey, encryptWithPassphrase, decryptWithPassphrase, type DeviceKeyProvider, type VaultEnvelope } from './cryptoBox';
import { utf8ToBase64 } from '../../utils/base64';
export const KEY_MISSING_MESSAGE = 'This device cannot open its saved Secret Vault: the device key that encrypted it is not available (browser data was cleared, the browser profile changed, or the vault was copied from another device). The saved data was kept, not deleted. Enter the Vault Sync Passphrase and use "Retrieve from Repository" (Schema → Pull Schema → Pull Secret Vault to Repository, or "Import encrypted file"), or set the access token again there.';
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
  /** V17.5.6: the repository location is NOT taken from what is stored in the vault — it is applied by this function (the single authoritative repository configuration). Identity by default. */
  private locate: (s: VaultSecrets) => VaultSecrets = (s) => s;
  setLocator(fn: (s: VaultSecrets) => VaultSecrets): void { this.locate = fn; }
  private remembered(): Record<string, string> | null { const r = readJson<Record<string, string> | null>(this.store, KEYS.syncLocation, null); return r ? { owner: r.owner || r.githubOwner || '', repo: r.repo || r.githubRepo || '', branch: r.branch || r.githubBranch || '', path: r.path || r.schemaPath || r.githubPath || '' } : null; }
  async load(): Promise<VaultSecrets> { return this.locate(await this.loadStored()); }
  private async loadStored(): Promise<VaultSecrets> { if (this.cache) return this.cache; const env = readJson<VaultEnvelope | null>(this.store, KEYS.vaultLocal, null);
    let base: Record<string, unknown> = {}; if (env) { try { base = JSON.parse(await decryptWithKey(env, await this.keys.getKey())); } catch { throw new Error(KEY_MISSING_MESSAGE); } } this.cache = normalizeLocation(base, this.remembered()); return this.cache; }
  /** Before a new envelope replaces an unreadable one, the old one is kept under a backup key (never silently deleted). */
  private async backupIfUnreadable(): Promise<void> { const env = readJson<VaultEnvelope | null>(this.store, KEYS.vaultLocal, null); if (!env) return; try { await decryptWithKey(env, await this.keys.getKey()); } catch { this.store.set(`${KEYS.vaultLocal}.unreadable-${Date.now()}`, JSON.stringify(env)); } }
  async save(s: VaultSecrets): Promise<void> { await this.backupIfUnreadable(); const c = normalizeLocation(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v ?? '').trim()])) as Record<string, string>, null);
    if (!writeJson(this.store, KEYS.vaultLocal, await encryptWithKey(JSON.stringify(c), await this.keys.getKey()))) throw new Error('Browser storage rejected the encrypted vault write.');
    writeJson(this.store, KEYS.syncLocation, { owner: c.githubOwner, repo: c.githubRepo, branch: c.githubBranch, path: c.schemaPath }); this.cache = c; }
  knownSecrets(): string[] { return this.cache ? [this.cache.githubToken, this.cache.aiApiKey].filter(Boolean) : []; }
  /** Step 1 of "Push Secret Vault to Repository": validates the configuration. Returns every problem found (empty = ready). */
  async validateForPush(passphrase: string, confirm: string, central = false): Promise<string[]> {
    const p: string[] = []; const c = await this.load();
    if (central) { if (!c.aiApiKey) p.push('There is no secret to protect: save an AI/LLM API key on this device first. (Repository access is central, so the GitHub token is not part of the vault.)'); }
    else if (!c.githubToken && !c.aiApiKey) p.push('There is no secret to protect: save a GitHub access token (or an AI/LLM API key) on this device first.');
    const hasO = !!c.githubOwner; const hasR = !!c.githubRepo; if ((hasO !== hasR) || (hasO && (!/^[\w.-]+$/.test(c.githubOwner) || !/^[\w.-]+$/.test(c.githubRepo)))) p.push('The repository must be set as owner/repo under "GitHub repository" (or left empty).');
    if (!c.githubBranch.trim()) p.push('Branch is required.');
    for (const [n, v] of [['Schema file path', c.schemaPath], ['Vault file path', c.vaultPath]] as const) if (!v.trim() || v.startsWith('/') || v.includes('..') || /[\\:*?"<>|]/.test(v)) p.push(`${n} is not a valid repository path.`);
    { const vp = c.vaultPath.trim(); const twin = c.schemaPath.replace(/\.json$/i, '.enc.json'); if (vp === c.schemaPath.trim() || vp === twin || /(^|\/)(schemas|knowledge|messages)\//i.test(vp) || !/\.json$/i.test(vp)) p.push('The Vault file path must be a .json file outside the schemas / knowledge / messages folders, so that pushing the vault can never overwrite another synchronized file.'); }
    if (c.githubToken && /\s/.test(c.githubToken)) p.push('The saved GitHub token contains spaces — re-enter it.');
    if (!passphrase || passphrase.length < 10) p.push('The Vault Sync Passphrase must be at least 10 characters.'); else if (passphrase !== confirm) p.push('The passphrases do not match.');
    if (/^(password|passphrase|1234567890|qwertyuiop)/i.test(passphrase)) p.push('Choose a less guessable Vault Sync Passphrase.');
    return p;
  }
  /** Encrypts for the repository. The result is asserted to contain NO plaintext (or plain base64) copy of any secret before it is returned. */
  async exportEncrypted(pass: string, central = false): Promise<string> {
    /* V17.6.2: with central repository access no GitHub token is published in the vault */ const cur = central ? { ...(await this.load()), githubToken: '' } : await this.load(); const text = JSON.stringify(await encryptWithPassphrase(JSON.stringify(cur), pass), null, 2);
    [cur.githubToken, cur.aiApiKey].filter((x) => x && x.length >= 6).forEach((sec) => { if (text.includes(sec) || text.includes(utf8ToBase64(sec)) || text.includes(encodeURIComponent(sec))) throw new Error('Safety check failed: the repository representation would contain a secret in readable form. Nothing was written.'); });
    return text;
  }
  /** Verifies a pushed file: decrypts it with the passphrase and compares it with this device's configuration (nothing is saved). */
  async verifyEncrypted(text: string, pass: string, central = false): Promise<boolean> { try { const dec = JSON.parse(await decryptWithPassphrase(JSON.parse(text) as VaultEnvelope, pass)); const cur = await this.load(); return (central ? !dec.githubToken : dec.githubToken === cur.githubToken) && dec.githubRepo === cur.githubRepo && dec.githubOwner === cur.githubOwner && (dec.aiApiKey || '') === (cur.aiApiKey || ''); } catch { return false; } }
  /** V17.2 local vault (sqla.secretvault.v15, encrypted with the Admin Password): imported once after Settings is unlocked, so tokens saved in V17.2 keep working. */
  async migrateFromV172(adminPassword: string): Promise<boolean> {
    const cur = await this.load(); if (cur.githubToken) return false;
    let raw: string | null = null; try { raw = localStorage.getItem('sqla.secretvault.v15'); } catch { return false; } if (!raw) return false;
    try { const f = JSON.parse(raw); const dec = await decryptWithSecret(adminPassword, f?.blob); if (dec === null) return false; const c = JSON.parse(dec);
      await this.save(normalizeLocation({ githubRepo: String(c.githubRepo || ''), githubBranch: String(c.githubBranch || 'main'), schemaPath: String(c.githubSchemaPath || ''), githubToken: String(c.githubToken || ''), aiApiKey: String(c.llmApiKey || '') } as Record<string, string>, null)); return true;
    } catch { return false; }
  }
  /** Reads both the V17.3.1 envelope and the V17.2 "sqla-vault-sync" v2 envelope (PBKDF2-SHA-256 + AES-256-GCM with AAD). Returns the secrets now in force on this device. */
  async importEncrypted(text: string, pass: string): Promise<VaultSecrets> { return (await this.importSecrets(text, pass)).secrets; }
  /**
   * V17.5.6 / V17.5.7 — IMPORT (never push): decrypts a Secret Vault and merges it into this device's vault.
   *  · the GitHub access token inside is validated and stored encrypted through the normal save path — no token has to exist on this device first;
   *  · V17.5.7: when `opts.verifyToken` is given, GitHub is asked whether the token works. A token GitHub REJECTS (401) is treated like an invalid one: it never replaces a saved token;
   *  · an empty / missing / invalid token NEVER replaces a token that is already saved (same for the AI/LLM key);
   *  · a vault that holds nothing usable is rejected with a message and changes nothing;
   *  · the VAULT FILE PATH inside the file is IGNORED (this device's own path stays in force) and the repository location inside it is overridden by the authoritative configuration on every read, so a crafted vault can never redirect a later push onto another repository file;
   *  · nothing is written to any repository, and no secret appears in the report.
   */
  async importSecrets(text: string, pass: string, opts: { verifyToken?: (token: string) => Promise<TokenCheck>; /** V17.6.2: repository access is central — the GitHub token inside the vault is neither validated nor restored (no token is needed, or wanted, on this device) */ skipToken?: boolean } = {}): Promise<{ secrets: VaultSecrets; report: VaultImportReport }> {
    let parsed: Record<string, any>; try { parsed = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch { throw new Error('The vault file is not valid JSON — it is not an encrypted Secret Vault.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The file is not an encrypted SQL Assistant Secret Vault.');
    let inc: VaultSecrets;
    if (parsed.format === 'sqla-vault-sync') { const s = await decryptV172Envelope(parsed, pass); inc = normalizeLocation({ githubRepo: String(s.githubRepo || ''), githubBranch: String(s.githubBranch || 'main'), schemaPath: String(s.githubSchemaPath || ''), githubToken: String(s.githubToken || ''), aiApiKey: String(s.llmApiKey || '') } as Record<string, string>, null); }
    else { if (parsed.v !== 1 || !parsed.kdf || !parsed.salt) throw new Error('The file is not an encrypted SQL Assistant Secret Vault (it has no vault envelope). Choose the vault file, for example secret-vault.v17.enc.json.'); let dec: Record<string, unknown>; const plain = await decryptWithPassphrase(parsed as VaultEnvelope, pass); try { dec = JSON.parse(plain); } catch { throw new Error('The vault was decrypted but its content is damaged.'); } if (!dec || typeof dec !== 'object' || Array.isArray(dec)) throw new Error('The vault was decrypted but its content is not a Secret Vault.'); inc = normalizeLocation(dec as Record<string, unknown>, null); }
    const skip = !!opts.skipToken; const incomingToken = String(inc.githubToken || '').trim(); const token = skip ? '' : incomingToken; const ai = String(inc.aiApiKey || '').trim(); let tokenOk = isPlausibleToken(token); const warnings: string[] = [];
    if (skip && !ai) throw new Error('The Secret Vault was opened and is valid, but there is nothing to restore on this device: repository access is central (no GitHub token is needed here) and the vault holds no AI/LLM API key. Nothing was changed on this device.');
    if (!token && !ai) throw new Error('The Secret Vault was opened, but it contains no GitHub access token and no AI/LLM API key. Nothing was changed on this device.');
    if (token && !tokenOk && !ai) throw new Error('The Secret Vault contains a GitHub access token that is not valid (it has spaces or is too short). Nothing was changed on this device — an existing token was kept.');
    let cur: VaultSecrets; let deviceVaultUnreadable = false; try { cur = await this.loadStored(); } catch { cur = { ...EMPTY_SECRETS }; deviceVaultUnreadable = true; } // an unreadable device vault is exactly the case import is for (it is backed up by save())
    const hadToken = !!cur.githubToken; let access: TokenCheck | null = null; let tokenRejected = false; let tokenNoAccess = false; let tokenUnconfirmed = false;
    if (tokenOk && opts.verifyToken) { try { access = await opts.verifyToken(token); } catch { access = null; }
      if (access?.state === 'rejected') { tokenOk = false; tokenRejected = true; if (!ai) throw new Error(`GitHub rejected the access token in this Secret Vault (it is invalid or has expired), so recovery is not possible from this file. Nothing was changed on this device${hadToken ? ' — the token already saved was kept' : ''}. Create a new token and set it in the GitHub repository card, then push the vault again from a working device.`); }
      // V17.6.1 — a token is restored only when GitHub accepted it for the configured repository. One that authenticates but cannot use the repository (no Contents permission, not granted to it, not SSO-authorized, rate limit) is not restored; an unconfirmed one (GitHub unreachable) never replaces a token that is already saved.
      else if (access?.state === 'no-access') { tokenOk = false; tokenNoAccess = true; if (!ai) throw new Error(`The access token in this Secret Vault cannot use the configured repository (it lacks the Contents permission, is not granted access to the repository, is not authorized for the organization's SSO — or GitHub's rate limit was reached), so it was not restored. Nothing was changed on this device${hadToken ? ' — the token already saved was kept' : ''}. Create a fine-grained token with Contents: Read for this repository, set it on a working device and push the vault again — or try again in a few minutes if it was the rate limit.`); }
      else if (access?.state === 'unverified' && hadToken && cur.githubToken !== token) { tokenOk = false; tokenUnconfirmed = true; if (!ai) throw new Error('GitHub could not be reached to check the access token in this Secret Vault (network problem or time-out), so it was not used to replace the token already saved on this device, which was kept. Check the connection and try again.'); } }
    const next: VaultSecrets = { ...cur };
    if (skip) { if (incomingToken) warnings.push('The GitHub access token inside the vault was not restored: repository access is central, so no token is needed (or kept) on this device.'); }
    else if (tokenOk) next.githubToken = token; else if (tokenNoAccess) warnings.push(`The access token in the imported vault cannot use the configured repository (missing Contents permission, not granted to the repository, not SSO-authorized, or a rate limit) and was not restored${hadToken ? ' — the token already saved on this device was kept' : ''}.`); else if (tokenUnconfirmed) warnings.push('GitHub could not be reached to check the access token in the imported vault, so the token already saved on this device was kept.'); else if (tokenRejected) warnings.push(`GitHub rejected the access token in the imported vault (invalid or expired) and it was not used${hadToken ? ' — the token already saved on this device was kept' : '. Create a new token and set it in the GitHub repository card'}.`); else if (!token) warnings.push(hadToken ? 'The imported vault contains no GitHub access token — the token already saved on this device was kept.' : 'The imported vault contains no GitHub access token — set one in the GitHub repository card.'); else warnings.push('The GitHub access token in the imported vault is not valid (spaces or too short) and was not used' + (hadToken ? ' — the token already saved on this device was kept.' : '.'));
    if (tokenOk && access && access.state !== 'ok') warnings.push(access.message + (access.state === 'unverified' ? ' The token was saved anyway.' : ''));
    if (tokenOk && access?.state === 'ok' && access.canWrite === false) warnings.push(access.message);
    if (ai) next.aiApiKey = ai;
    for (const k of ['githubOwner', 'githubRepo', 'githubBranch', 'schemaPath'] as const) if (inc[k]) next[k] = inc[k]; // stored for format compatibility only — the authoritative repository configuration overrides them whenever the vault is read
    await this.save(next); this.cache = null; const secrets = await this.load();
    return { secrets, report: { tokenSkipped: skip && !!incomingToken, tokenImported: tokenOk, tokenKept: !tokenOk && hadToken && !skip, tokenReplaced: tokenOk && hadToken && cur.githubToken !== token, tokenRejected, aiKeyImported: !!ai, deviceVaultWasUnreadable: deviceVaultUnreadable, access: tokenOk ? access : null, warnings } };
  }
  /** Before a push replaces a vault file that is already in the repository: can it be opened with this passphrase, and would the push remove a secret it holds? Nothing is saved. */
  async compareWithRemote(text: string, pass: string, central = false): Promise<{ readable: boolean; wouldRemove: string[] }> {
    let dec: Record<string, unknown>; try { dec = JSON.parse(await decryptWithPassphrase(JSON.parse(text) as VaultEnvelope, pass)); } catch { return { readable: false, wouldRemove: [] }; }
    const cur = await this.load(); const wouldRemove: string[] = []; if (!central && dec.githubToken && !cur.githubToken) wouldRemove.push('GitHub access token'); if (dec.aiApiKey && !cur.aiApiKey) wouldRemove.push('AI/LLM API key'); return { readable: true, wouldRemove };
  }
}
/** The outcome of asking GitHub about a token (see githubClient.validateTokenAccess). Declared here structurally so the vault stays free of network code. */
export interface TokenCheck { state: 'ok' | 'rejected' | 'no-access' | 'unverified'; canWrite: boolean | null; message: string; }
export interface VaultImportReport { /** V17.6.2: the vault held a token that was deliberately not restored (central repository access) */ tokenSkipped?: boolean; tokenImported: boolean; tokenKept: boolean; tokenReplaced: boolean; tokenRejected: boolean; aiKeyImported: boolean; deviceVaultWasUnreadable: boolean; access: TokenCheck | null; warnings: string[]; }
/** A GitHub token must be one run of printable characters (no spaces) of a plausible length — the formats differ (ghp_…, github_pat_…, legacy 40-hex), so the prefix is not enforced. */
export const isPlausibleToken = (t: string) => /^[\x21-\x7E]{20,255}$/.test(t);
export const isValidRepoPath = (v: string) => !!v.trim() && !v.startsWith('/') && !v.includes('..') && !/[\\:*?"<>|]/.test(v);
export const maskSecret = (v: string) => (v ? `${'•'.repeat(8)}${v.slice(-4)}` : '(not set)');
async function decryptV172Envelope(e: Record<string, any>, pass: string): Promise<Record<string, unknown>> {
  if (e.version !== 2 || e.kdf?.name !== 'PBKDF2' || e.kdf?.hash !== 'SHA-256' || e.cipher?.name !== 'AES-GCM' || !Number.isInteger(e.kdf?.iterations) || e.kdf.iterations < 100000 || e.kdf.iterations > 5000000) throw new Error('The V17.2 vault file uses unsupported or modified parameters and was rejected.');
  const u = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pass).normalize('NFKC')) as BufferSource, 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: u(e.kdf.salt) as BufferSource, iterations: e.kdf.iterations }, km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u(e.cipher.iv) as BufferSource, additionalData: new TextEncoder().encode(String(e.aad)) as BufferSource, tagLength: 128 }, key, u(e.ciphertext) as BufferSource))); }
  catch { throw new Error('The vault could not be decrypted — the passphrase is wrong or the data was modified.'); }
}
