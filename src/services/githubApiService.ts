/**
 * GitHub Contents API access. V17.1 fixes:
 *  - Files larger than 1 MB: the Contents API returns `content: ""` with `encoding: "none"`; V17.0
 *    decoded the empty string and the schema then failed as "invalid JSON". Large files are now
 *    downloaded through the raw media type.
 *  - Non-JSON / unexpected API responses, corrupted base64 and non-UTF-8 content are reported precisely.
 *  - 401 (invalid/expired token), 403 (rate limit vs. missing permission), 404, 409/422, 5xx and network
 *    timeouts each have a specific message. Tokens are never included in messages.
 */
import { utf8ToBase64, base64ToUtf8 } from '../utils/base64';
import { safeString, safeTrim, isNonEmptyString } from '../utils/validation';
export interface GitHubFileResult { content: string; sha: string; size?: number; }
export interface GitHubApiError { status: number | null; message: string; field?: string; }
const TIMEOUT_MS = 8000; // V16.5: every GitHub call fails fast instead of hanging
function authHeaders(token: string, accept = 'application/vnd.github+json'): Record<string, string> { const h: Record<string, string> = { Accept: accept }; if (isNonEmptyString(token)) h.Authorization = `token ${token}`; return h; }
function splitRepo(raw: unknown): { owner: string; repo: string } | GitHubApiError {
  const full = safeTrim(raw);
  if (!full) return { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Repository.', field: 'githubRepo' };
  const p = full.split('/'); if (p.length !== 2 || !p[0] || !p[1]) return { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Repository must be in the form "owner/repo".', field: 'githubRepo' };
  return { owner: p[0], repo: p[1] };
}
function isRepoError(x: { owner: string; repo: string } | GitHubApiError): x is GitHubApiError { return 'message' in x; }
async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: c.signal }); }
  catch (e) { throw { status: null, message: (e as Error)?.name === 'AbortError' ? `GitHub did not respond within ${TIMEOUT_MS / 1000} s (network, proxy or firewall).` : 'Network error — could not reach GitHub (offline, blocked by a firewall/proxy, or CORS).' } as GitHubApiError; }
  finally { clearTimeout(t); }
}
function authError(res: Response, writing: boolean): GitHubApiError {
  if (res.status === 401) return { status: 401, message: 'GitHub rejected the access token (HTTP 401): it is invalid, expired or revoked. Set a new token in Settings → Secret Vault.', field: 'githubToken' };
  const remaining = res.headers?.get?.('x-ratelimit-remaining');
  if (remaining === '0') return { status: 403, message: 'GitHub API rate limit reached (HTTP 403). Wait for the limit to reset, or unlock Settings so requests use your access token.', field: 'githubToken' };
  return { status: 403, message: writing ? 'GitHub refused the write (HTTP 403): the access token does not have write permission ("Contents: Read and write") for this repository.' : 'GitHub refused access (HTTP 403): the access token does not have read permission for this repository.', field: 'githubToken' };
}
const contentsUrl = (o: string, r: string, path: string) => `https://api.github.com/repos/${o}/${r}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
export async function getFile(repoRaw: unknown, branchRaw: unknown, pathRaw: unknown, tokenRaw: unknown): Promise<GitHubFileResult | null> {
  const parsed = splitRepo(repoRaw); if (isRepoError(parsed)) throw parsed;
  const branch = safeTrim(branchRaw) || 'main'; const path = safeTrim(pathRaw); const token = safeString(tokenRaw);
  if (!path) throw { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Repository Path.', field: 'githubSchemaPath' } as GitHubApiError;
  const url = `${contentsUrl(parsed.owner, parsed.repo, path)}?ref=${encodeURIComponent(branch)}`;
  const res = await timedFetch(url, { headers: authHeaders(token) });
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) throw authError(res, false);
  if (!res.ok) throw { status: res.status, message: res.status >= 500 ? `GitHub is temporarily unavailable (HTTP ${res.status}). Try again later.` : `GitHub returned an unexpected error (HTTP ${res.status}).` } as GitHubApiError;
  let data: any; try { data = await res.json(); } catch { throw { status: res.status, message: 'GitHub returned a response that is not JSON (possibly a proxy or captive-portal page).' } as GitHubApiError; }
  if (Array.isArray(data)) throw { status: null, message: `"${path}" is a folder, not a file — configure a file path.`, field: 'githubSchemaPath' } as GitHubApiError;
  if (!data || typeof data !== 'object' || typeof data.sha !== 'string') throw { status: null, message: 'GitHub returned an unexpected response for the schema file (missing file metadata).' } as GitHubApiError;
  if (data.type && data.type !== 'file') throw { status: null, message: `"${path}" is a ${data.type}, not a regular file.`, field: 'githubSchemaPath' } as GitHubApiError;
  const size = typeof data.size === 'number' ? data.size : undefined;
  if ((data.encoding === 'none' || !data.content) && (size ?? 0) > 0) {
    // Files > 1 MB are not inlined by the Contents API — download the raw content instead.
    const raw = await timedFetch(url, { headers: authHeaders(token, 'application/vnd.github.raw') });
    if (raw.status === 401 || raw.status === 403) throw authError(raw, false);
    if (!raw.ok) throw { status: raw.status, message: `GitHub could not deliver the large schema file (${Math.round((size ?? 0) / 1024)} KB, HTTP ${raw.status}).` } as GitHubApiError;
    return { content: await raw.text(), sha: data.sha, size };
  }
  if (data.encoding && data.encoding !== 'base64') throw { status: null, message: `GitHub returned the file in an unsupported encoding "${data.encoding}".` } as GitHubApiError;
  let content: string; try { content = base64ToUtf8(String(data.content ?? '')); } catch (e) { throw { status: null, message: (e as Error).message } as GitHubApiError; }
  return { content, sha: data.sha, size };
}
export async function putFile(repoRaw: unknown, branchRaw: unknown, pathRaw: unknown, tokenRaw: unknown, content: string, message: string, sha: string | null): Promise<{ sha: string }> {
  const parsed = splitRepo(repoRaw); if (isRepoError(parsed)) throw parsed;
  const branch = safeTrim(branchRaw) || 'main'; const path = safeTrim(pathRaw); const token = safeString(tokenRaw);
  if (!path) throw { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Repository Path.', field: 'githubSchemaPath' } as GitHubApiError;
  if (!isNonEmptyString(token)) throw { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Access Token.', field: 'githubToken' } as GitHubApiError;
  const body: Record<string, unknown> = { message, content: utf8ToBase64(content), branch }; if (sha) body.sha = sha;
  const res = await timedFetch(contentsUrl(parsed.owner, parsed.repo, path), { method: 'PUT', headers: { ...authHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status === 401 || res.status === 403) throw authError(res, true);
  if (res.status === 404) throw { status: 404, message: `Repository "${safeTrim(repoRaw)}" or branch "${branch}" was not found, or the token cannot see it.`, field: 'githubRepo' } as GitHubApiError;
  if (res.status === 409 || res.status === 422) throw { status: res.status, message: "The file changed on GitHub since you last synced — pull the latest version first to avoid overwriting someone else's changes." } as GitHubApiError;
  if (!res.ok) { let d = ''; try { const j = await res.json(); d = j.message ? ` (${j.message})` : ''; } catch { /* ignore */ } throw { status: res.status, message: `GitHub rejected the request (HTTP ${res.status})${d}.` } as GitHubApiError; }
  let data: any; try { data = await res.json(); } catch { throw { status: res.status, message: 'GitHub accepted the write but returned an unreadable response; pull to confirm the file was saved.' } as GitHubApiError; }
  return { sha: String(data?.content?.sha ?? '') };
}
export function isGitHubApiError(e: unknown): e is GitHubApiError { return typeof e === 'object' && e !== null && 'message' in e; }
