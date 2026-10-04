import { base64ToUtf8, utf8ToBase64 } from '../../utils/base64';
import { redactSecrets } from '../errors/appErrors';
export interface RepoFile { text: string; sha: string; }
export interface SchemaRepository { describe: string; read(path: string): Promise<RepoFile | null>; write(path: string, text: string, sha: string | null, message: string): Promise<string>; }
/** No HTTP cache (cache:'no-store'); files > 1 MB via the blob API; tokens redacted from every error. */
export function githubRepository(cfg: { owner: string; repo: string; branch: string; token: string }): SchemaRepository {
  const api = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`; const h = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${cfg.token}` };
  const url = (p: string) => `${api}/contents/${p.split('/').map(encodeURIComponent).join('/')}`;
  const fail = (what: string, st: number): never => { throw new Error(redactSecrets(`${what} failed: ${st === 401 ? 'the GitHub token is invalid or expired' : st === 403 ? 'the token lacks permission (Contents: read/write) or the rate limit was hit' : st === 404 ? 'repository, branch or file not found' : st === 409 || st === 422 ? 'the file changed on the server — synchronize again' : `HTTP ${st}`}.`, [cfg.token])); };
  const call = async (u: string, i: RequestInit = {}) => { try { return await fetch(u, { ...i, headers: { ...h, ...(i.headers || {}) }, cache: 'no-store' }); } catch (e) { throw new Error(redactSecrets(`Could not reach GitHub (${(e as Error).message}).`, [cfg.token])); } };
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
