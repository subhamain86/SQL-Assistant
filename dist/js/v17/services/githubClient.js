/** Minimal GitHub contents API client. The token is only ever sent in the Authorization header and is redacted from all errors. */
import { base64ToUtf8, utf8ToBase64 } from '../../utils/base64.js';
import { redactSecrets } from '../errors/appErrors.js';
export class GitHubClient {
    constructor(cfg, fetcher = (u, i) => fetch(u, i)) {
        this.cfg = cfg;
        this.fetcher = fetcher;
    }
    url(path) { return `https://api.github.com/repos/${this.cfg.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`; }
    headers() { return { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.cfg.token}`, 'X-GitHub-Api-Version': '2022-11-28' }; }
    fail(what, status, body) {
        const hint = status === 401 ? 'the GitHub token is invalid or expired' : status === 403 ? 'the token lacks permission (Contents: read/write) or the rate limit was hit' : status === 404 ? 'the repository, branch or file was not found' : status === 409 ? 'the file changed on the server — synchronize again' : `HTTP ${status}`;
        throw new Error(redactSecrets(`${what} failed: ${hint}.${body ? ` ${body.slice(0, 160)}` : ''}`, [this.cfg.token]));
    }
    async get(path) {
        let r;
        try {
            r = await this.fetcher(`${this.url(path)}?ref=${encodeURIComponent(this.cfg.branch)}`, { headers: this.headers() });
        }
        catch (e) {
            throw new Error(redactSecrets(`Could not reach GitHub (${e.message}).`, [this.cfg.token]));
        }
        if (r.status === 404)
            return null;
        if (!r.ok)
            this.fail(`Reading ${path}`, r.status, await r.text().catch(() => ''));
        const j = await r.json();
        return { text: base64ToUtf8(j.content || ''), sha: j.sha };
    }
    async put(path, text, sha, message) {
        let r;
        try {
            r = await this.fetcher(this.url(path), { method: 'PUT', headers: { ...this.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ message, content: utf8ToBase64(text), branch: this.cfg.branch, ...(sha ? { sha } : {}) }) });
        }
        catch (e) {
            throw new Error(redactSecrets(`Could not reach GitHub (${e.message}).`, [this.cfg.token]));
        }
        if (!r.ok)
            this.fail(`Writing ${path}`, r.status, await r.text().catch(() => ''));
        const j = await r.json();
        return j.content?.sha || '';
    }
}
export function githubRepository(c) { return { read: (p) => c.get(p), write: (p, t, s, m) => c.put(p, t, s, m) }; }
export function memoryRepository(files = {}) {
    let n = 0;
    const map = new Map(Object.entries(files).map(([k, v]) => [k, { text: v, sha: `sha${++n}` }]));
    return { files: map, async read(p) { return map.get(p) ? { ...map.get(p) } : null; }, async write(p, t, s) { const cur = map.get(p); if (cur && cur.sha !== s)
            throw new Error('Writing failed: the file changed on the server — synchronize again.'); const sha = `sha${++n}`; map.set(p, { text: t, sha }); return sha; } };
}
//# sourceMappingURL=githubClient.js.map