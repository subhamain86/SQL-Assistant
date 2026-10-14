/**
 * V17.5.6 / V17.5.7 — the ONE authoritative repository configuration (owner / repository, branch, schema file path).
 *
 *   · Defaults:  repositoryDefaults.ts (basware/sk-ap-sql-assistant · main · sql-assistant-data/schemas/registry.json).
 *   · Override:  one record in the existing browser-storage architecture (KEYS.repoConfig). It is written ONLY by saveRepositoryConfig(), which
 *                refuses to do anything unless the existing Admin Password mechanism (passwordService.verifyPassword) accepts the password it is given —
 *                the check lives HERE, in the service, not in the UI, so hiding or disabling controls is not the only protection.
 *   · Consumers: applyRepositoryConfig() is the only function that puts a location into the secrets every synchronization reads (schemas, encrypted schema, knowledge,
 *                admin message, Secret Vault pull / push). Nothing else may carry a location, so Pull Schema and Push Secret Vault can never disagree.
 * The stored record holds NO secret (no token). A record that fails validation when read is ignored (the defaults are used) and reported — never half-applied.
 * Responsibilities stay separate: this module = location + authorization of changes; secretVault.ts = encryption / decryption of the vault; githubClient.ts = network and token checks.
 */
import { KEYS, readJson, writeJson, type KeyValueStore } from '../../services/storage';
import { verifyPassword, authBlockedMessage } from '../../services/passwordService';
import { LOCKED_REPOSITORY } from './repositoryDefaults';
import type { VaultSecrets } from './secretVault';
export interface RepositoryConfig { owner: string; repo: string; branch: string; schemaPath: string; }
export const DEFAULT_REPOSITORY: RepositoryConfig = { owner: LOCKED_REPOSITORY.owner, repo: LOCKED_REPOSITORY.repo, branch: LOCKED_REPOSITORY.branch, schemaPath: LOCKED_REPOSITORY.schemaPath };
export const repositoryLabel = (c: RepositoryConfig) => `${c.owner}/${c.repo}`;
export const sameRepositoryConfig = (a: RepositoryConfig, b: RepositoryConfig) => a.owner === b.owner && a.repo === b.repo && a.branch === b.branch && a.schemaPath === b.schemaPath;
/** "owner/repo" → parts (a pasted GitHub URL such as https://github.com/owner/repo(.git) is accepted too). */
export function parseRepositoryLabel(v: string): { owner: string; repo: string } | null {
  const t = String(v || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '').replace(/\.git$/i, ''); const m = t.match(/^([^/\s]+)\/([^/\s]+)$/); return m ? { owner: m[1], repo: m[2] } : null;
}
/** Every problem with a candidate configuration (empty = valid). Pure — no network. */
export function validateRepositoryConfig(c: Partial<RepositoryConfig>): string[] {
  const p: string[] = []; const owner = String(c.owner ?? '').trim(); const repo = String(c.repo ?? '').trim(); const branch = String(c.branch ?? '').trim(); const path = String(c.schemaPath ?? '').trim();
  if (!owner || !repo) p.push('Repository: enter it as owner/repository (for example basware/sk-ap-sql-assistant).');
  else {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) p.push('Repository owner: use letters, digits and "-" only (1–39 characters, not starting with "-").');
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || repo === '.' || repo === '..' || /\.git$/i.test(repo)) p.push('Repository name: use letters, digits, "-", "_" and "." only (1–100 characters; "." / ".." / a ".git" ending are not allowed).');
  }
  if (!branch) p.push('Branch: enter the branch name (for example main).');
  else if (branch.length > 255 || /[\s\x00-\x1f\x7f~^:?*[\\]/.test(branch) || branch.includes('..') || branch.includes('@{') || branch.includes('//') || /^[/.-]/.test(branch) || /[/.]$/.test(branch) || /\.lock$/i.test(branch) || branch === '@' || branch.split('/').some((s) => s.startsWith('.') || s.endsWith('.lock'))) p.push('Branch: this is not a valid Git branch name (no spaces, "..", "~", "^", ":", "?", "*", "[", "\\", "@{", leading "-" / "/" / ".", trailing "/" / "." / ".lock").');
  if (!path) p.push('Schema file path: enter the path of the schema registry file inside the repository.');
  else {
    if (path.length > 255 || !/^[A-Za-z0-9._\-/]+$/.test(path) || path.startsWith('/') || path.endsWith('/') || path.includes('//') || path.split('/').some((s) => s === '.' || s === '..')) p.push('Schema file path: use a relative repository path made of letters, digits, "/", "-", "_" and "." only — no leading "/", no "..", no spaces or special characters.');
    else if (!/\.json$/i.test(path)) p.push('Schema file path: the schema registry must be a .json file (for example sql-assistant-data/schemas/registry.json).');
    else if (/\.enc\.json$/i.test(path)) p.push('Schema file path: enter the plain registry file (…/registry.json); the encrypted twin (…/registry.enc.json) is derived from it automatically.');
  }
  return p;
}
const clean = (c: Partial<RepositoryConfig>): RepositoryConfig => ({ owner: String(c.owner ?? '').trim(), repo: String(c.repo ?? '').trim(), branch: String(c.branch ?? '').trim(), schemaPath: String(c.schemaPath ?? '').trim() });
export interface LoadedRepositoryConfig { config: RepositoryConfig; custom: boolean; /** a stored record existed but was invalid and was ignored */ problem: string | null; }
/** The configuration in force on this device: the administrator's saved override when it is valid, otherwise the defaults. Never throws. */
export function loadRepositoryConfig(store: KeyValueStore): LoadedRepositoryConfig {
  const raw = readJson<Record<string, unknown> | null>(store, KEYS.repoConfig, null); if (!raw) return { config: { ...DEFAULT_REPOSITORY }, custom: false, problem: null };
  const c = clean({ owner: raw.owner as string, repo: raw.repo as string, branch: raw.branch as string, schemaPath: raw.schemaPath as string }); const bad = typeof raw !== 'object' ? ['not an object'] : validateRepositoryConfig(c);
  if (bad.length) return { config: { ...DEFAULT_REPOSITORY }, custom: false, problem: 'The saved repository configuration on this device is not valid and was ignored (the defaults are in use). An administrator can set it again.' };
  return { config: c, custom: !sameRepositoryConfig(c, DEFAULT_REPOSITORY), problem: null };
}
/** The only place a location is applied to the secrets. The token, AI key and vault file path are untouched; the input is not modified. */
export function applyRepositoryConfig(s: VaultSecrets, c: RepositoryConfig): VaultSecrets { return { ...s, githubOwner: c.owner, githubRepo: c.repo, githubBranch: c.branch, schemaPath: c.schemaPath }; }
export type SaveConfigResult = { ok: true; config: RepositoryConfig; custom: boolean; notes: string[] } | { ok: false; kind: 'unauthorized' | 'invalid' | 'unverified' | 'storage'; message: string; problems: string[] };
export interface SaveConfigOptions {
  /** Test seam — defaults to the real Admin Password check. */ verify?: (password: string) => Promise<boolean>;
  /** Optional live verification (repository / branch / path reachable with the saved token). Returns null when fine, or a refusal message. May add notes. */ liveCheck?: (c: RepositoryConfig) => Promise<{ refuse: string | null; notes: string[] }>;
}
/** Persists a new configuration. Order: Admin Password → validation → live check → single write (+ read-back). A refusal changes nothing. Saving the defaults removes the override. */
export async function saveRepositoryConfig(store: KeyValueStore, input: Partial<RepositoryConfig>, adminPassword: string, o: SaveConfigOptions = {}): Promise<SaveConfigResult> {
  let ok = false; try { ok = await (o.verify || verifyPassword)(String(adminPassword ?? '')); } catch { ok = false; }
  if (!ok) return { ok: false, kind: 'unauthorized', message: authBlockedMessage() ? `${authBlockedMessage()} The repository configuration was not changed.` : 'Incorrect Admin Password — the repository configuration was not changed.', problems: [] };
  const c = clean(input); const problems = validateRepositoryConfig(c); if (problems.length) return { ok: false, kind: 'invalid', message: 'The repository configuration is not valid — nothing was saved.', problems };
  const notes: string[] = []; if (o.liveCheck) { const r = await o.liveCheck(c); notes.push(...r.notes); if (r.refuse) return { ok: false, kind: 'unverified', message: r.refuse, problems: [] }; }
  const isDefault = sameRepositoryConfig(c, DEFAULT_REPOSITORY);
  if (isDefault) { store.remove(KEYS.repoConfig); if (store.get(KEYS.repoConfig) !== null) return { ok: false, kind: 'storage', message: 'Browser storage rejected the change — the previous configuration is still in force.', problems: [] }; return { ok: true, config: c, custom: false, notes }; }
  const prev = store.get(KEYS.repoConfig); if (!writeJson(store, KEYS.repoConfig, { v: 1, ...c, savedAt: new Date().toISOString() })) return { ok: false, kind: 'storage', message: 'Browser storage rejected the change — the previous configuration is still in force.', problems: [] };
  const back = loadRepositoryConfig(store); if (back.problem || !sameRepositoryConfig(back.config, c)) { if (prev === null) store.remove(KEYS.repoConfig); else store.set(KEYS.repoConfig, prev); return { ok: false, kind: 'storage', message: 'The configuration could not be read back after saving — the previous configuration was restored.', problems: [] }; }
  return { ok: true, config: c, custom: true, notes };
}
