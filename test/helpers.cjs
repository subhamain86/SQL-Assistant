/* Shared test helpers: browser-like globals, fresh "device" loading, and a fake GitHub Contents API. */
const path = require('node:path');
const B = process.env.V17_BUILD || path.join(__dirname, '..', '.test-build');
function installStorage(map = new Map(), opts = {}) { globalThis.localStorage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { if (opts.failKey && opts.failKey(k)) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } map.set(k, String(v)); }, removeItem: (k) => map.delete(k), clear: () => map.clear(), get length() { return map.size; }, key: (i) => Array.from(map.keys())[i] ?? null }; return map; }
installStorage();
/** Loads a fresh copy of every app module against its own localStorage — one call = one device (= one app restart). */
function loadDevice(storage = new Map(), opts = {}) {
  installStorage(storage, opts);
  Object.keys(require.cache).forEach((k) => { if (k.startsWith(B)) delete require.cache[k]; });
  const r = (p) => require(path.join(B, p));
  return { storage, schemaService: r('services/schemaService').schemaService, syncService: r('services/syncService').syncService, vault: r('services/secretVaultService').secretVaultService, fmt: r('v17/sync/schemaFormat'), store: r('state/store').store, integ: () => r('v17/integration'), r };
}
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
/** Minimal GitHub Contents API (GET/PUT, sha concurrency, >1 MB raw delivery, stale-cache simulation, injectable failures). */
function fakeGitHub() {
  const files = new Map(); const history = new Map(); let shaN = 0; const gh = { files, history, mode: null, requests: [], largeThreshold: 1024 * 1024, serveStale: 0 };
  gh.put = (repo, p, content) => { const k = `${repo}|${p}`; if (files.has(k)) history.set(k, files.get(k)); const sha = `sha${++shaN}`; files.set(k, { content, sha }); return sha; };
  gh.get = (repo, p) => files.get(`${repo}|${p}`);
  const json = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (h) => headers[h.toLowerCase()] ?? null }, json: async () => { if (typeof body === 'string') throw new SyntaxError('Unexpected token <'); return body; }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  gh.fetch = async (url, init = {}) => {
    gh.requests.push({ url, method: init.method || 'GET', auth: init.headers?.Authorization || null, cache: init.cache || 'default' });
    const m = String(url).match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/contents\/([^?]+)/); if (!m) throw new TypeError('Failed to fetch');
    const repo = m[1]; const p = decodeURIComponent(m[2]); const k = `${repo}|${p}`;
    switch (gh.mode) { case 'network': throw new TypeError('Failed to fetch'); case 'timeout': { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } case '401': return json(401, { message: 'Bad credentials' }); case '403': return json(403, { message: 'Forbidden' }); case 'ratelimit': return json(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' }); case '500': return json(502, { message: 'Bad gateway' }); case 'html': return json(200, '<!DOCTYPE html><html>proxy</html>'); default: }
    let f = files.get(k);
    if ((init.method || 'GET') === 'GET') {
      if (gh.serveStale > 0 && history.has(k) && !String(url).includes('raw')) { gh.serveStale -= 1; f = history.get(k); }
      if (!f) return json(404, { message: 'Not Found' });
      const size = Buffer.byteLength(f.content, 'utf8');
      if (init.headers?.Accept === 'application/vnd.github.raw') return { ok: true, status: 200, headers: { get: () => null }, text: async () => f.content, json: async () => JSON.parse(f.content) };
      if (size > gh.largeThreshold) return json(200, { type: 'file', sha: f.sha, size, encoding: 'none', content: '' });
      return json(200, { type: 'file', sha: f.sha, size, encoding: 'base64', content: b64(f.content).replace(/(.{60})/g, '$1\n') });
    }
    if (init.method === 'PUT') {
      if (!init.headers?.Authorization) return json(401, { message: 'Requires authentication' });
      if (gh.mode === 'readonly') return json(403, { message: 'Resource not accessible by personal access token' });
      const body = JSON.parse(init.body); if (f && body.sha !== f.sha) return json(f && !body.sha ? 422 : 409, { message: 'sha mismatch' });
      const content = Buffer.from(body.content, 'base64').toString('utf8'); const sha = gh.put(repo, p, content); return json(200, { content: { sha } });
    }
    return json(405, {});
  };
  globalThis.fetch = gh.fetch;
  return gh;
}
const REPO = 'subhamain86/Basware-AP-SQL-Assistant'; const PATH = 'sql-assistant-data/schemas/registry.json';
async function unlock(dev, token = 'ghp_TestToken000000000000000000000000', extra = {}) { const r = await dev.vault.tryAutoUnlock('admin'); await dev.vault.saveConfig({ githubToken: token, githubRepo: REPO, githubBranch: 'main', githubSchemaPath: PATH, ...extra }); return r; }
const emptyState = (dialect = 'Generic') => ({ dialect, naturalLanguageText: '', selectedTables: [], selectedColumns: [], joins: [], filters: [], sorts: [], advanced: { distinct: false, groupByColumns: [], havingClause: '', limit: null, recursive: false, saveAsView: null, caseExpressions: [], decodeExpressions: [], ctes: [] }, generatedSql: '', lastGeneratedAt: null, joinPathChoices: {} });
module.exports = { B, installStorage, loadDevice, fakeGitHub, REPO, PATH, unlock, emptyState };
