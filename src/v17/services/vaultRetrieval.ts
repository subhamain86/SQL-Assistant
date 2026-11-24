/**
 * V17.6.1 — how "Pull Secret Vault to Repository → Retrieve from Repository" obtains the ENCRYPTED vault file from the configured GitHub repository, and how the file is checked before anything is decrypted.
 *
 * Why this exists. Up to V17.5.7 the retrieval started from the token saved on the device. With none, it made one anonymous request — and GitHub answers "404 Not Found" to every anonymous request for a PRIVATE
 * repository, so: no token ⇒ no vault ⇒ no token. A saved but REJECTED token (expired / revoked — exactly when the fresh token inside the vault is wanted) stopped the retrieval at the 401 as well.
 * What no front end can change: a private repository does not serve a file to a caller that presents no credential, and the vault passphrase is not a credential for GitHub. So the order is:
 *   1  the token saved on this device — when there is one AND GitHub still accepts it;
 *   2  an anonymous read — only when no working token exists (a public repository);
 *   3  GitHub SIGN-IN (bootstrapAuth.ts, device flow): the user authorizes as themselves; the short-lived token it returns is passed to retrieveVaultAuthorized() for this one read and then dropped.
 * Every route reads only; none writes. This module returns CIPHERTEXT only — no crypto, no storage, no credential handling (decryption, validation and restoring the token are SecretVault.importSecrets).
 * Pure logic with injectable I/O (tested in Node). Messages never contain a token, a passphrase, the repository name or a file path.
 */
import { githubRepository, checkRepositoryLocation, repositoryErrorKind, type SchemaRepository, type LocationCheck } from './githubClient';
import { isValidRepoPath } from './secretVault'; import { redactSecrets } from '../errors/appErrors';
export type VaultRetrievalVia = 'repository-token' | 'repository-anonymous' | 'repository-signin' | 'repository-broker' | 'repository-published' | 'test-repository';
export type VaultRetrievalFailure = 'file-not-found' | 'repository-not-found' | 'branch-not-found' | 'denied' | 'token-rejected' | 'bootstrap-unavailable' | 'rate-limit' | 'network' | 'timeout' | 'config' | 'unexpected' | 'signin-expired' | 'signin-no-access' | 'signin-required' | 'pat-missing' | 'pat-rejected' | 'pat-insufficient';
export type VaultRetrieval = { ok: true; text: string; via: VaultRetrievalVia; notes: string[] } | { ok: false; kind: VaultRetrievalFailure; message: string; notes: string[] };
export interface VaultRetrievalInput {
  location: { owner: string; repo: string; branch: string }; vaultPath: string; defaultPath: string;
  /** the token saved on this device ('' = none). It is OPTIONAL — it is never required to start a retrieval. */ savedToken: string;
  /** a repository that stands in for the token / anonymous routes: the in-memory repository in tests, or (V17.6.2) the central repository-access service */ override?: SchemaRepository | null;
  /** how the override is labelled in the result (default 'test-repository') */ overrideVia?: VaultRetrievalVia;
  makeRepository?: (token: string) => SchemaRepository; checkLocation?: typeof checkRepositoryLocation;
}
const IMPORT_FILE = 'select "Import encrypted file" and choose the Secret Vault file (for example secret-vault.v17.enc.json, downloaded from the repository in your browser, where you are signed in to GitHub)';
const KEPT = 'Your saved settings were not changed.';
export const MESSAGES: Record<VaultRetrievalFailure, string> = {
  'file-not-found': `No encrypted Secret Vault was found at the vault file path in the configured repository. Push it first from a device that has the GitHub access token (Settings → Secret Vault → Push Secret Vault to Repository), or use "Import encrypted file". ${KEPT}`,
  'repository-not-found': `The configured repository was not found with the access token saved on this device. Ask an administrator to check the GitHub repository card above (repository name, and that the token may read it). ${KEPT}`,
  'branch-not-found': `The configured branch was not found in the repository. Ask an administrator to check the GitHub repository card above. ${KEPT}`,
  'denied': `GitHub denied access to the repository: the access token saved on this device is not allowed to read it (it needs Contents: Read, and for an organization that uses SSO it must be authorized), or GitHub's rate limit was reached. Ask the repository owner to grant access or wait a few minutes — or use "Import encrypted file". ${KEPT}`,
  'token-rejected': `GitHub rejected the access token saved on this device (it is invalid or has expired), so it was not used. The vault could not be read without a valid credential. You do not have to fix the token first: ${IMPORT_FILE} — the access token inside it replaces the rejected one. ${KEPT}`,
  'bootstrap-unavailable': `No GitHub access token is set on this device, and the vault could not be read without one: GitHub hides a private repository from anonymous requests (it answers "not found"), and the vault passphrase does not authenticate to GitHub. You do not have to set the token first: ${IMPORT_FILE} — the access token inside it is stored on this device automatically. An administrator can also enable "GitHub sign-in" recovery so that this button asks you to authorize on github.com instead (deployment notes: "Vault recovery sign-in"). ${KEPT}`,
  'rate-limit': `GitHub refused the anonymous request (its rate limit for unauthenticated requests, or an access restriction). Wait a few minutes, or use "Import encrypted file". ${KEPT}`,
  'network': `GitHub could not be reached. Check your network connection and try again — or use "Import encrypted file". ${KEPT}`,
  'timeout': `GitHub did not answer in time. Check your network connection and try again — or use "Import encrypted file". ${KEPT}`,
  'config': `The repository configuration is not usable (owner, repository or branch). Ask an administrator to check the GitHub repository card above. ${KEPT}`,
  'unexpected': `The vault file could not be read from the repository (unexpected answer from GitHub). Try again, or use "Import encrypted file". ${KEPT}`,
  'signin-expired': `GitHub no longer accepts the sign-in (it expired or was revoked), so the vault was not read. Select "Retrieve from Repository" to sign in again. ${KEPT}`,
  'signin-required': `Repository access needs a GitHub sign-in (none is active, or it expired). Sign in and select \"Retrieve from Repository\" again — or use \"Import encrypted file\". ${KEPT}`,
  'pat-missing': `The central repository access is not set up: the access service has no GitHub PAT. An administrator must configure the GitHub Actions secret SQLA_GITHUB_PAT — or use \"Import encrypted file\". ${KEPT}`,
  'pat-rejected': `GitHub rejected the central PAT (it is invalid, expired or revoked). An administrator must replace the GitHub Actions secret SQLA_GITHUB_PAT — or use \"Import encrypted file\". ${KEPT}`,
  'pat-insufficient': `The central PAT is not allowed to read the configured repository (it needs Contents: Read, and authorization for the organization's SSO), or the repository name is wrong. An administrator must fix the PAT or the repository card — or use \"Import encrypted file\". ${KEPT}`,
  'signin-no-access': `The GitHub account you signed in with cannot read the configured repository (it is not a member, the organization's SSO has not authorized it, or the GitHub App is not installed on this repository). Ask the repository owner to grant access, then try again — or use "Import encrypted file". ${KEPT}`,
};
/** The failures after which asking the user to sign in on GitHub can help (a missing, rejected or insufficient credential, or the anonymous rate limit). */
export const SIGN_IN_CAN_HELP: VaultRetrievalFailure[] = ['bootstrap-unavailable', 'token-rejected', 'denied', 'rate-limit'];
const uniq = (a: string[]) => [...new Set(a.filter(Boolean))];
const mk = (i: VaultRetrievalInput) => i.makeRepository || ((token: string) => githubRepository({ owner: i.location.owner, repo: i.location.repo, branch: i.location.branch || 'main', token }));
const readAll = async (repo: SchemaRepository, paths: string[]): Promise<{ text: string } | null> => { for (const p of paths) { const f = await repo.read(p); if (f) return { text: f.text }; } return null; };
const failOf = (kind: VaultRetrievalFailure, notes: string[]): VaultRetrieval => ({ ok: false, kind, message: MESSAGES[kind], notes });

export async function retrieveVaultFile(i: VaultRetrievalInput): Promise<VaultRetrieval> {
  const notes: string[] = []; const paths = uniq([i.vaultPath, i.defaultPath]).filter(isValidRepoPath); if (!paths.length) return failOf('config', notes); const make = mk(i);
  if (i.override) { try { const f = await readAll(i.override, paths); return f ? { ok: true, text: f.text, via: i.overrideVia || 'test-repository', notes } : failOf('file-not-found', notes); }
    catch (e) { const k = repositoryErrorKind(e); if (i.overrideVia === 'repository-published') notes.push(redactSecrets((e as Error).message, [])); return failOf(k === 'signin' ? 'signin-required' : k === 'pat-missing' ? 'pat-missing' : k === 'pat-rejected' ? 'pat-rejected' : k === 'pat-insufficient' ? 'pat-insufficient' : k === 'permission' ? 'denied' : k === 'timeout' ? 'timeout' : k === 'network' ? 'network' : k === 'config' ? 'config' : 'unexpected', notes); } }
  let tokenRejected = false; let denied = false; let net: 'network' | 'timeout' | null = null; let rateLimited = false; let classified: VaultRetrievalFailure | null = null; let configBad = false;
  const noteKind = (e: unknown, authed: boolean) => { const k = repositoryErrorKind(e);
    if (k === 'auth') { if (authed) tokenRejected = true; } else if (k === 'permission') { if (authed) denied = true; else rateLimited = true; } else if (k === 'timeout') net = net || 'timeout'; else if (k === 'network') net = 'network'; else if (k === 'config') configBad = true; };
  if (i.savedToken) { // 1 ── the saved token, if there is one and GitHub still accepts it
    try {
      const f = await readAll(make(i.savedToken), paths); if (f) return { ok: true, text: f.text, via: 'repository-token', notes };
      const c: LocationCheck = await (i.checkLocation || checkRepositoryLocation)({ owner: i.location.owner, repo: i.location.repo, branch: i.location.branch || 'main', token: i.savedToken, path: paths[0] }); // tells "file missing" from "repository / branch missing"
      if (c.ok) classified = c.fileExists ? 'unexpected' : 'file-not-found'; else classified = c.kind === 'branch' ? 'branch-not-found' : c.kind === 'not-found' ? 'repository-not-found' : c.kind === 'auth' ? null : c.kind === 'permission' ? 'denied' : c.kind === 'network' ? 'network' : c.kind === 'timeout' ? 'timeout' : 'unexpected';
      if (!c.ok && c.kind === 'auth') tokenRejected = true;
    } catch (e) { noteKind(e, true); }
    if (tokenRejected) notes.push('The access token saved on this device was rejected by GitHub (invalid or expired), so it was not used for this retrieval.');
  }
  if (!i.savedToken || tokenRejected) { // 2 ── an anonymous read (a public repository); a private one answers 404 and is reported as such
    try { const f = await readAll(make(''), paths); if (f) return { ok: true, text: f.text, via: 'repository-anonymous', notes }; } catch (e) { noteKind(e, false); }
  }
  if (classified && classified !== 'network' && classified !== 'timeout') return failOf(classified, notes);
  if (configBad) return failOf('config', notes); if (tokenRejected) return failOf('token-rejected', notes); if (denied) return failOf('denied', notes);
  if (net || classified === 'network' || classified === 'timeout') return failOf(net || (classified as 'network' | 'timeout'), notes);
  if (rateLimited && !i.savedToken) return failOf('rate-limit', notes);
  return failOf('bootstrap-unavailable', notes);
}

/** Route 3: reads the vault with the SHORT-LIVED token obtained by the GitHub sign-in. Same read, classified for an account that signed in as itself. The token is used for this call only. */
export async function retrieveVaultAuthorized(i: Omit<VaultRetrievalInput, 'savedToken' | 'override'> & { token: string }): Promise<VaultRetrieval> {
  const notes: string[] = []; const paths = uniq([i.vaultPath, i.defaultPath]).filter(isValidRepoPath); if (!paths.length) return failOf('config', notes);
  const make = mk({ ...i, savedToken: '' });
  try {
    const f = await readAll(make(i.token), paths); if (f) return { ok: true, text: f.text, via: 'repository-signin', notes };
    const c = await (i.checkLocation || checkRepositoryLocation)({ owner: i.location.owner, repo: i.location.repo, branch: i.location.branch || 'main', token: i.token, path: paths[0] });
    if (c.ok) return failOf(c.fileExists ? 'unexpected' : 'file-not-found', notes);
    return failOf(c.kind === 'branch' ? 'branch-not-found' : c.kind === 'not-found' || c.kind === 'permission' ? 'signin-no-access' : c.kind === 'auth' ? 'signin-expired' : c.kind === 'network' ? 'network' : c.kind === 'timeout' ? 'timeout' : 'unexpected', notes);
  } catch (e) {
    const k = repositoryErrorKind(e); return failOf(k === 'auth' ? 'signin-expired' : k === 'permission' || k === 'not-found' ? 'signin-no-access' : k === 'timeout' ? 'timeout' : k === 'network' ? 'network' : k === 'config' ? 'config' : 'unexpected', notes);
  }
}

/**
 * Is this text an encrypted SQL Assistant Secret Vault of a version this build can read? Structural check only — nothing is decrypted and nothing is echoed.
 * Accepted: the V17.3.1+ envelope (v:1, AES-256-GCM, PBKDF2-SHA256, Base64 salt / iv / ct) and the V17.2 "sqla-vault-sync" v2 envelope — exactly what SecretVault.importSecrets reads.
 * Refused with a specific reason: an HTML page (a sign-in or error page returned instead of the file), text that is not JSON, JSON that is not a vault, a newer / unknown version or algorithm, a device-key envelope
 * (the copy kept in browser storage), an incomplete envelope, and an implausible iteration count (a denial-of-service attempt on a writable repository).
 */
export function validateVaultPayload(text: string): { ok: true } | { ok: false; kind: 'html' | 'not-json' | 'not-a-vault' | 'unsupported' | 'damaged'; message: string } {
  const t = String(text ?? '').replace(/^\uFEFF/, ''); if (/^\s*</.test(t)) return { ok: false, kind: 'html', message: 'the server returned a web page (for example a sign-in or error page) instead of the encrypted Secret Vault' };
  let j: Record<string, unknown>; try { const p = JSON.parse(t); if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, kind: 'not-a-vault', message: 'the file is JSON but not an encrypted SQL Assistant Secret Vault' }; j = p as Record<string, unknown>; } catch { return { ok: false, kind: 'not-json', message: 'the file is not valid JSON' }; }
  const B64 = /^[A-Za-z0-9+/]+={0,2}$/; const iterOk = (n: unknown) => Number.isInteger(n) && (n as number) >= 100_000 && (n as number) <= 5_000_000;
  if (j.format === 'sqla-vault-sync') { const k = j.kdf as Record<string, unknown> | undefined; const c = j.cipher as Record<string, unknown> | undefined;
    if (j.version !== 2) return { ok: false, kind: 'unsupported', message: 'the file is a vault of a version this build cannot read (V17.2 vaults are version 2)' };
    return k && c && typeof k.salt === 'string' && typeof c.iv === 'string' && typeof j.ciphertext === 'string' && iterOk(k.iterations) ? { ok: true } : { ok: false, kind: 'damaged', message: 'the V17.2 vault envelope is incomplete or uses unsupported key-derivation parameters' }; }
  if (j.v === undefined || j.salt === undefined) return { ok: false, kind: 'not-a-vault', message: 'the file is not an encrypted SQL Assistant Secret Vault (it has no vault envelope)' };
  if (j.v !== 1) return { ok: false, kind: 'unsupported', message: 'the vault was written in a newer or unknown format version — update SQL Assistant on this device' };
  if (j.alg !== 'AES-256-GCM' || j.kdf !== 'PBKDF2-SHA256') return { ok: false, kind: 'unsupported', message: 'the vault uses an encryption format this version cannot read (expected AES-256-GCM with PBKDF2-SHA256)' };
  const str = (k: string) => typeof j[k] === 'string' && B64.test(j[k] as string);
  if (!str('salt') || !str('iv') || !str('ct')) return { ok: false, kind: 'damaged', message: 'the vault envelope is incomplete or damaged' };
  if (j.iter !== undefined && !iterOk(j.iter)) return { ok: false, kind: 'damaged', message: 'the vault envelope has an unsupported key-derivation setting' };
  return { ok: true };
}
