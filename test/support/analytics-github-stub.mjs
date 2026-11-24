// V17.7.4 test support — a tiny stand-in for the GitHub "contents" API (read file / list folder / create-or-update / delete), as a REAL local HTTP server, so that the repository client
// (githubRepository with `apiBase`) and the analytics provider are tested over HTTP without any network or credential.
//   st.token      the only Authorization bearer token accepted (null = no authentication needed)
//   st.readOnly   true → every write / delete answers 403 (a token without Contents: write)
//   st.down       true → every request answers 502
//   st.requests   every request (method, path, authorization, body, commit message) — used to prove what was sent
import http from 'node:http'; import crypto from 'node:crypto';
export function createGithubStub(opts = {}) {
  const st = { token: opts.token ?? null, readOnly: !!opts.readOnly, down: false, files: new Map(), requests: [], writes: 0 }; let n = 0;
  const shaOf = (text) => crypto.createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex');
  for (const [k, v] of Object.entries(opts.files || {})) st.files.set(k, { text: v, sha: shaOf(v) });
  const server = http.createServer(async (req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    if (req.method === 'OPTIONS') return send(204);
    const chunks = []; for await (const c of req) chunks.push(c); const raw = Buffer.concat(chunks).toString('utf8'); let body = null; try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    const url = new URL(req.url, 'http://x'); const m = /^\/repos\/([^/]+)\/([^/]+)(?:\/contents\/(.*))?$/.exec(url.pathname); st.requests.push({ method: req.method, path: decodeURIComponent(url.pathname), authorization: req.headers.authorization || null, message: body?.message ?? null, body });
    if (st.down) return send(502, { message: 'bad gateway' }); if (st.token && req.headers.authorization !== `Bearer ${st.token}`) return send(401, { message: 'Bad credentials' }); if (!m) return send(404, { message: 'Not Found' });
    if (m[3] === undefined) return send(200, { full_name: `${m[1]}/${m[2]}`, permissions: { push: !st.readOnly, pull: true } });
    const path = decodeURIComponent(m[3]).replace(/\/+$/, '');
    if (req.method === 'GET') {
      const f = st.files.get(path); if (f) return send(200, { type: 'file', name: path.split('/').pop(), path, sha: f.sha, size: Buffer.byteLength(f.text), encoding: 'base64', content: Buffer.from(f.text, 'utf8').toString('base64') });
      const pre = `${path}/`; const seen = new Map(); for (const [k, v] of st.files) { if (!k.startsWith(pre)) continue; const rest = k.slice(pre.length); const i = rest.indexOf('/'); if (i < 0) seen.set(rest, { name: rest, path: k, sha: v.sha, size: Buffer.byteLength(v.text), type: 'file' }); else { const d = rest.slice(0, i); if (!seen.has(d)) seen.set(d, { name: d, path: `${pre}${d}`, sha: `tree${d}`, size: 0, type: 'dir' }); } }
      return seen.size ? send(200, [...seen.values()]) : send(404, { message: 'Not Found' });
    }
    if (st.readOnly) return send(403, { message: 'Resource not accessible by personal access token' });
    if (req.method === 'PUT') {
      if (!body || typeof body.content !== 'string') return send(422, { message: 'content required' }); const cur = st.files.get(path); if (cur && body.sha !== cur.sha) return send(cur ? 422 : 409, { message: '"sha" wasn\'t supplied or does not match' }); if (!cur && body.sha) return send(404, { message: 'Not Found' });
      const text = Buffer.from(body.content, 'base64').toString('utf8'); const sha = shaOf(text + (++n)); st.files.set(path, { text, sha }); st.writes += 1; return send(cur ? 200 : 201, { content: { sha } });
    }
    if (req.method === 'DELETE') { const cur = st.files.get(path); if (!cur) return send(404, { message: 'Not Found' }); if (body?.sha !== cur.sha) return send(409, { message: 'does not match' }); st.files.delete(path); st.writes += 1; return send(200, { commit: {} }); }
    return send(405, { message: 'method' });
  });
  return { st, server, listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`))), close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }) };
}
