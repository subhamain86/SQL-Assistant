import { utf8ToBase64, base64ToUtf8 } from '../utils/base64';
import { safeString, safeTrim, isNonEmptyString } from '../utils/validation';
export interface GitHubFileResult { content: string; sha: string; }
export interface GitHubApiError { status: number | null; message: string; field?: string; }
const TIMEOUT_MS = 8000; // V16.5: every GitHub call fails fast instead of hanging
function authHeaders(token: string): Record<string, string> { const h: Record<string, string> = { Accept: 'application/vnd.github+json' }; if (isNonEmptyString(token)) h.Authorization = `token ${token}`; return h; }
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
export async function getFile(repoRaw: unknown, branchRaw: unknown, pathRaw: unknown, tokenRaw: unknown): Promise<GitHubFileResult | null> {
  const parsed = splitRepo(repoRaw); if (isRepoError(parsed)) throw parsed;
  const branch = safeTrim(branchRaw) || 'main'; const path = safeTrim(pathRaw);
  if (!path) throw { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Repository Path.', field: 'githubSchemaPath' } as GitHubApiError;
  const res = await timedFetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`, { headers: authHeaders(safeString(tokenRaw)) });
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) throw { status: res.status, message: 'GitHub authentication failed — check the access token stored in the Secret Vault, or you have hit the unauthenticated rate limit.', field: 'githubToken' } as GitHubApiError;
  if (!res.ok) throw { status: res.status, message: `GitHub returned an unexpected error (HTTP ${res.status}).` } as GitHubApiError;
  const data = await res.json();
  if (Array.isArray(data)) throw { status: null, message: `"${path}" is a folder, not a file — configure a file path.`, field: 'githubSchemaPath' } as GitHubApiError;
  return { content: base64ToUtf8(data.content as string), sha: data.sha as string };
}
export async function putFile(repoRaw: unknown, branchRaw: unknown, pathRaw: unknown, tokenRaw: unknown, content: string, message: string, sha: string | null): Promise<{ sha: string }> {
  const parsed = splitRepo(repoRaw); if (isRepoError(parsed)) throw parsed;
  const branch = safeTrim(branchRaw) || 'main'; const path = safeTrim(pathRaw); const token = safeString(tokenRaw);
  if (!path) throw { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Repository Path.', field: 'githubSchemaPath' } as GitHubApiError;
  if (!isNonEmptyString(token)) throw { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Access Token.', field: 'githubToken' } as GitHubApiError;
  const body: Record<string, unknown> = { message, content: utf8ToBase64(content), branch }; if (sha) body.sha = sha;
  const res = await timedFetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', headers: { ...authHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status === 401 || res.status === 403) throw { status: res.status, message: 'GitHub authentication failed — check the access token stored in the Secret Vault.', field: 'githubToken' } as GitHubApiError;
  if (res.status === 409 || res.status === 422) throw { status: res.status, message: "The file changed on GitHub since you last synced — pull the latest version first to avoid overwriting someone else's changes." } as GitHubApiError;
  if (!res.ok) { let d = ''; try { const j = await res.json(); d = j.message ? ` (${j.message})` : ''; } catch { /* ignore */ } throw { status: res.status, message: `GitHub rejected the request (HTTP ${res.status})${d}.` } as GitHubApiError; }
  const data = await res.json(); return { sha: data.content?.sha as string };
}
export function isGitHubApiError(e: unknown): e is GitHubApiError { return typeof e === 'object' && e !== null && 'message' in e; }
