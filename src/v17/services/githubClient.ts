import { base64ToUtf8, utf8ToBase64 } from '../../utils/base64';
import { redactSecrets } from '../errors/appErrors';
export interface RepoFile { text: string; sha: string; }
export interface SchemaRepository { describe: string; read(path: string): Promise<RepoFile | null>; write(path: string, text: string, sha: string | null, message: string): Promise<string>; }
/**
 * V17.5.2 — every failure of the repository is a typed RepositoryError so the UI can say WHAT failed and WHAT to do:
 *   auth (401 invalid/expired token) · permission (403 / 429 missing Contents permission or rate limit) · not-found (404) · conflict (409/422 file changed on the server)
 *   timeout (no answer in time) · network (could not reach GitHub) · config (owner / repository / branch not usable) · http (anything else)
 * Messages are unchanged from V17.5.1 where they existed; tokens are redacted from every one of them.
 */
/** V17.6.2 adds the four kinds produced by the central repository-access service (repoBroker.ts): signin (no / expired sign-in) · pat-missing · pat-rejected (invalid, expired or revoked) · pat-insufficient (the central PAT may not use the repository). */
export type RepositoryErrorKind = 'auth' | 'permission' | 'not-found' | 'conflict' | 'timeout' | 'network' | 'config' | 'http' | 'signin' | 'pat-missing' | 'pat-rejected' | 'pat-insufficient';
export class RepositoryError extends Error { constructor(message: string, public kind: RepositoryErrorKind, public status?: number) { super(message); this.name = 'RepositoryError'; } }
export const repositoryErrorKind = (e: unknown): RepositoryErrorKind | null => (e && (e as { name?: string }).name === 'RepositoryError' ? (e as RepositoryError).kind : null);
/** Request time limit. A request that never answers would otherwise block every later synchronization (they are serialized). */
let timeoutMs = 20_000; export const setRepositoryTimeoutMs = (ms: number) => { timeoutMs = Math.max(50, ms); }; export const getRepositoryTimeoutMs = () => timeoutMs;
const SAFE_NAME = /^[A-Za-z0-9_.-]{1,100}$/;
/** No HTTP cache (cache:'no-store'); files > 1 MB via the blob API; tokens redacted from every error; every request has a time limit. */
export function githubRepository(cfg: { owner: string; repo: string; branch: string; token: string }): SchemaRepository {
  const bad = !SAFE_NAME.test(cfg.owner || '') || !SAFE_NAME.test(cfg.repo || '') || !(cfg.branch || 'main').trim() || /[\s?#]/.test(cfg.branch || '');
  const api = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`; const h: Record<string, string> = { Accept: 'application/vnd.github+json', ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) }; // V17.5.6: an empty token sends NO Authorization header (anonymous read of a public repository — used only to try "Retrieve from Repository" before any token exists)
  const url = (p: string) => `${api}/contents/${p.split('/').map(encodeURIComponent).join('/')}`;
  const guard = () => { if (bad) throw new RepositoryError('The repository is not configured correctly: owner and repository may contain only letters, digits, "-", "_" and "." — check the GitHub repository card under Schema → Pull Schema.', 'config'); };
  const fail = (what: string, st: number): never => { const kind: RepositoryErrorKind = st === 401 ? 'auth' : st === 403 || st === 429 ? 'permission' : st === 404 ? 'not-found' : st === 409 || st === 422 ? 'conflict' : 'http';
    throw new RepositoryError(redactSecrets(`${what} failed: ${st === 401 ? 'the GitHub token is invalid or expired' : st === 403 || st === 429 ? 'the token lacks permission (Contents: read/write) or the rate limit was hit' : st === 404 ? 'repository, branch or file not found' : st === 409 || st === 422 ? 'the file changed on the server — synchronize again' : `HTTP ${st}`}.`, [cfg.token]), kind, st); };
  const call = async (u: string, i: RequestInit = {}) => { guard(); const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeoutMs);
    try { return await fetch(u, { ...i, headers: { ...h, ...(i.headers || {}) }, cache: 'no-store', signal: ctl.signal }); }
    catch (e) { if ((e as Error)?.name === 'AbortError') throw new RepositoryError(`GitHub did not answer within ${Math.round(timeoutMs / 1000)} seconds (the connection timed out).`, 'timeout'); throw new RepositoryError(redactSecrets(`Could not reach GitHub (${(e as Error).message}).`, [cfg.token]), 'network'); }
    finally { clearTimeout(tm); } };
  return { describe: `${cfg.owner}/${cfg.repo}@${cfg.branch}`,
    async read(p) { const r = await call(`${url(p)}?ref=${encodeURIComponent(cfg.branch)}`); if (r.status === 404) return null; if (!r.ok) fail(`Reading ${p}`, r.status); const j = (await r.json()) as { content?: string; sha: string; encoding?: string };
      if (j.content && j.encoding !== 'none') return { text: base64ToUtf8(j.content), sha: j.sha };
      const b = await call(`${api}/git/blobs/${j.sha}`); if (!b.ok) fail(`Reading ${p} (large file)`, b.status); return { text: base64ToUtf8(((await b.json()) as { content: string }).content), sha: j.sha }; },
    async write(p, t, sha, m) { const r = await call(url(p), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: m, content: utf8ToBase64(t), branch: cfg.branch, ...(sha ? { sha } : {}) }) }); if (!r.ok) fail(`Writing ${p}`, r.status); return ((await r.json()) as { content?: { sha: string } }).content?.sha || ''; } };
}
export function memoryRepository(files: Record<string, string> = {}): SchemaRepository & { files: Map<string, RepoFile> } {
  let n = 0; const map = new Map<string, RepoFile>(Object.entries(files).map(([k, v]) => [k, { text: v, sha: `sha${++n}` }]));
  return { describe: 'in-memory test repository', files: map, async read(p) { return map.get(p) ? { ...map.get(p)! } : null; }, async write(p, t, s) { const c = map.get(p); if (c && c.sha !== s) throw new Error('Writing failed: the file changed on the server — synchronize again.'); const sha = `sha${++n}`; map.set(p, { text: t, sha }); return sha; } };
}

/**
 * V17.5.6 — live validation of a repository location before an administrator saves it: the repository, the branch and the schema file are looked up with the saved token.
 * A missing schema FILE is not an error (the first publication creates it); a missing repository or branch, or a token that is refused, is.
 */
export interface LocationCheck { ok: boolean; kind?: RepositoryErrorKind | 'branch'; message: string; fileExists?: boolean; }
export async function checkRepositoryLocation(cfg: { owner: string; repo: string; branch: string; token: string; path: string }): Promise<LocationCheck> {
  const secret = [cfg.token]; const api = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`; const h: Record<string, string> = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${cfg.token}` };
  const get = async (u: string): Promise<Response | LocationCheck> => { const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeoutMs);
    try { return await fetch(u, { headers: h, cache: 'no-store', signal: ctl.signal }); }
    catch (e) { return (e as Error)?.name === 'AbortError' ? { ok: false, kind: 'timeout', message: `GitHub did not answer within ${Math.round(timeoutMs / 1000)} seconds, so the location could not be verified.` } : { ok: false, kind: 'network', message: redactSecrets(`Could not reach GitHub (${(e as Error).message}), so the location could not be verified.`, secret) }; }
    finally { clearTimeout(tm); } };
  const refuse = (what: string, st: number): LocationCheck => st === 401 ? { ok: false, kind: 'auth', message: 'The saved GitHub access token was rejected (invalid or expired), so the location could not be verified.' } : st === 403 || st === 429 ? { ok: false, kind: 'permission', message: 'The saved GitHub access token is not allowed to read this repository (or the rate limit was reached), so the location could not be verified.' } : st === 404 ? { ok: false, kind: 'not-found', message: `${what} was not found with the saved access token.` } : { ok: false, kind: 'http', message: `GitHub answered HTTP ${st} while verifying the location.` };
  const r1 = await get(api); if (!(r1 instanceof Response)) return r1; if (!r1.ok) { const x = refuse('The repository', r1.status); return x.kind === 'not-found' ? { ...x, message: 'The repository was not found. Check owner and repository name, and that the saved access token can read it.' } : x; }
  const r2 = await get(`${api}/branches/${cfg.branch.split('/').map(encodeURIComponent).join('/')}`); if (!(r2 instanceof Response)) return r2; if (!r2.ok) { const x = refuse('The branch', r2.status); return x.kind === 'not-found' ? { ...x, kind: 'branch', message: 'The branch was not found in this repository.' } : x; }
  const r3 = await get(`${api}/contents/${cfg.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(cfg.branch)}`); if (!(r3 instanceof Response)) return r3; if (r3.status === 404) return { ok: true, fileExists: false, message: 'Repository and branch verified. The schema file does not exist there yet — the first publication will create it.' };
  if (!r3.ok) return refuse('The schema file', r3.status); return { ok: true, fileExists: true, message: 'Repository, branch and schema file verified.' };
}
/**
 * V17.5.7 — TOKEN VALIDATION (kept apart from encryption, decryption and the Admin Password): does GitHub accept this token for the configured repository, and with which permission?
 *   ok          GitHub accepted the token and the repository is readable with it. `canWrite` is true / false when GitHub reports the permission of the token's user on the repository, null when it does not say.
 *   rejected    HTTP 401 — the token is invalid or expired. It must not replace a working token.
 *   no-access   HTTP 403 / 404 / 429 — the token authenticates (or the repository is hidden from it) but cannot use this repository, or the rate limit was reached. The token is not judged invalid.
 *   unverified  GitHub could not be reached (offline, timeout, unexpected answer) — nothing is known. The token is never echoed in a message.
 * Never sends the token anywhere but api.github.com, never logs it, never puts it in a message.
 */
export interface TokenAccess { state: 'ok' | 'rejected' | 'no-access' | 'unverified'; canWrite: boolean | null; message: string; }
export async function validateTokenAccess(cfg: { owner: string; repo: string; token: string }, limitMs = 8000): Promise<TokenAccess> {
  const secret = [cfg.token]; if (!cfg.token || !SAFE_NAME.test(cfg.owner || '') || !SAFE_NAME.test(cfg.repo || '')) return { state: 'unverified', canWrite: null, message: 'The token could not be checked: the repository is not configured correctly.' };
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), Math.min(limitMs, timeoutMs));
  try {
    const r = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${cfg.token}` }, cache: 'no-store', signal: ctl.signal });
    if (r.status === 401) return { state: 'rejected', canWrite: null, message: 'GitHub rejected the access token (it is invalid or has expired).' };
    if (r.status === 403 || r.status === 429) return { state: 'no-access', canWrite: null, message: 'GitHub accepted the token but it is not allowed to use this repository (it needs Contents: Read, and Read and write to publish), or the rate limit was reached.' };
    if (r.status === 404) return { state: 'no-access', canWrite: null, message: 'The token cannot see the configured repository (wrong repository, or the token is not granted access to it).' };
    if (!r.ok) return { state: 'unverified', canWrite: null, message: `GitHub answered HTTP ${r.status}, so the token could not be checked.` };
    let perm: { push?: boolean; admin?: boolean; maintain?: boolean } | null = null; try { const j = (await r.json()) as { permissions?: { push?: boolean; admin?: boolean; maintain?: boolean } }; perm = j && typeof j.permissions === 'object' && j.permissions ? j.permissions : null; } catch { perm = null; }
    const canWrite = perm ? !!(perm.push || perm.admin || perm.maintain) : null;
    return { state: 'ok', canWrite, message: canWrite === true ? 'GitHub accepted the token: it can read and write the repository.' : canWrite === false ? 'GitHub accepted the token, but it has READ-ONLY access: it can pull but cannot publish or push (Contents: Read and write is needed).' : 'GitHub accepted the token and the repository is readable with it; whether it can write could not be determined.' };
  } catch (e) { return { state: 'unverified', canWrite: null, message: (e as Error)?.name === 'AbortError' ? 'GitHub did not answer in time, so the token could not be checked.' : redactSecrets(`GitHub could not be reached (${(e as Error).message}), so the token could not be checked.`, secret) }; }
  finally { clearTimeout(tm); }
}
