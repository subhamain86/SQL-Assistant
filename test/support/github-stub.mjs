/**
 * A local stand-in for github.com used by the V17.6.2 tests (this environment has no network access to github.com).
 * It models what matters for the broker: a PRIVATE repository (404 for anyone without access), a fine-grained PAT, GitHub-App user tokens obtained through the device flow,
 * the contents / blobs / branches / collaborators endpoints, 401 / 403 / 404 / 409 answers, and a record of EVERY request with the kind of credential that made it —
 * so tests can prove that the PAT was used only by the broker and that a user's token was used only for the two sign-in checks.
 *
 *   node test/support/github-stub.mjs <port> <state.json?>      (used by scripts/browser_test_v1762.py)
 *   control endpoint (tests only):  POST /__ctl  {op, ...}   GET /__state
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const OWNER = 'basware'; export const REPO = 'sk-ap-sql-assistant'; export const BRANCH = 'main';
export const PAT = 'github_pat_' + 'CENTRAL0PAT1for2the3broker4only5xyz';       // the central PAT (never allowed to appear anywhere but in the broker → stub requests)
export const USER_OK = 'ghu_' + 'UserWhoCanRead1234567890abcdefgh';             // GitHub-App user token of a user with read access
export const USER_RW = 'ghu_' + 'UserWhoCanWrite1234567890abcdefg';             // … with write access
export const USER_NONE = 'ghu_' + 'UserWithoutAccess1234567890abcdef';          // authenticates, cannot see the repository
export const DEVICE_CODE = 'dc_' + 'stubdevicecode0123456789abcdefghij';
const sha1 = (t) => crypto.createHash('sha1').update(t).digest('hex');

export function createStub(init = {}) {
  const st = {
    files: new Map(Object.entries(init.files || {})), // path → text
    patMode: 'ok',            // ok | rejected | readonly | invisible | ratelimit | expiring | noexpiry
    deviceMode: 'pending',    // pending | approve | deny | expire | disabled
    issue: USER_RW,           // which user token an approval issues
    users: { [USER_OK]: { login: 'reader-ro', read: true, write: false }, [USER_RW]: { login: 'writer-rw', read: true, write: true }, [USER_NONE]: { login: 'outsider', read: false, write: false } },
    requests: [], codeCalls: 0, tokenCalls: 0, permissionsField: true, down: false, shaOf: new Map(),
  };
  const shaFor = (p) => { const t = st.files.get(p); return t === undefined ? null : sha1(`${p}\n${t}`); };
  const credKind = (tok) => (!tok ? 'none' : tok === PAT ? 'PAT' : st.users[tok] ? 'user' : 'unknown');
  const json = (res, code, obj, extra = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...extra }); res.end(JSON.stringify(obj)); };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); const path = u.pathname; const tok = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const chunks = []; for await (const c of req) chunks.push(c); const raw = Buffer.concat(chunks).toString('utf8');
    if (path === '/__state') return json(res, 200, { files: Object.fromEntries(st.files), requests: st.requests, patMode: st.patMode, codeCalls: st.codeCalls, tokenCalls: st.tokenCalls, lastCommitMessage: st.lastCommitMessage || '' });
    if (path === '/__ctl') { const b = JSON.parse(raw || '{}'); if (b.op === 'set') Object.assign(st, b.values || {}); if (b.op === 'file') { if (b.text === null) st.files.delete(b.path); else st.files.set(b.path, b.text); } if (b.op === 'reset') { st.requests.length = 0; st.codeCalls = 0; st.tokenCalls = 0; } return json(res, 200, { ok: true }); }
    st.requests.push({ method: req.method, path: path + u.search, cred: credKind(tok), tok, body: req.method === 'POST' && path.startsWith('/login') ? raw : '' });
    if (st.down) { res.socket.destroy(); return; }
    // ── github.com device flow
    if (path === '/login/device/code' && req.method === 'POST') {
      st.codeCalls += 1; const f = new URLSearchParams(raw); if (st.deviceMode === 'disabled') return json(res, 200, { error: 'device_flow_disabled' });
      if (!f.get('client_id')) return json(res, 200, { error: 'incorrect_client_credentials' });
      return json(res, 200, { device_code: DEVICE_CODE, user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 });
    }
    if (path === '/login/oauth/access_token' && req.method === 'POST') {
      st.tokenCalls += 1; const f = new URLSearchParams(raw); if (f.get('device_code') !== DEVICE_CODE || f.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:device_code') return json(res, 200, { error: 'bad_verification_code' });
      if (st.deviceMode === 'deny') return json(res, 200, { error: 'access_denied' }); if (st.deviceMode === 'expire') return json(res, 200, { error: 'expired_token' });
      if (st.deviceMode === 'approve') return json(res, 200, { access_token: st.issue, token_type: 'bearer', scope: '', refresh_token: 'ghr_' + 'r'.repeat(30), expires_in: 28800 });
      return json(res, 200, { error: 'authorization_pending' });
    }
    // ── REST API
    const authed = tok === PAT ? { kind: 'PAT' } : st.users[tok] ? { kind: 'user', ...st.users[tok] } : null; if (!authed) return json(res, 401, { message: 'Bad credentials' });
    if (path === '/user') { if (authed.kind !== 'user') return json(res, 403, { message: 'Resource not accessible by personal access token' }); return json(res, 200, { login: authed.login }); }
    const m = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/); if (!m) return json(res, 404, { message: 'Not Found' });
    const [, o, r, rest = ''] = m; const exists = o === OWNER && r === REPO;
    if (authed.kind === 'PAT') {
      if (st.patMode === 'rejected') return json(res, 401, { message: 'Bad credentials' });
      if (st.patMode === 'ratelimit') return json(res, 403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' });
      if (st.patMode === 'invisible' || !exists) return json(res, 404, { message: 'Not Found' });
    } else if (!exists || !authed.read) return json(res, 404, { message: 'Not Found' });
    const hdr = authed.kind === 'PAT' && st.patMode === 'expiring' ? { 'github-authentication-token-expiration': new Date(Date.now() + 5 * 86400000).toISOString().replace('T', ' ').replace(/\..*/, ' UTC') } : authed.kind === 'PAT' && st.patMode !== 'noexpiry' ? { 'github-authentication-token-expiration': new Date(Date.now() + 200 * 86400000).toISOString().replace('T', ' ').replace(/\..*/, ' UTC') } : {};
    if (rest === '') { const write = authed.kind === 'PAT' ? st.patMode !== 'readonly' : authed.write; return json(res, 200, { full_name: `${OWNER}/${REPO}`, private: true, ...(st.permissionsField ? { permissions: { admin: false, push: write, pull: true } } : {}) }, hdr); }
    const bm = rest.match(/^\/branches\/(.+)$/); if (bm) return decodeURIComponent(bm[1]) === BRANCH ? json(res, 200, { name: BRANCH }, hdr) : json(res, 404, { message: 'Branch not found' });
    const cm = rest.match(/^\/collaborators\/([^/]+)\/permission$/); if (cm) { const u2 = Object.values(st.users).find((x) => x.login === decodeURIComponent(cm[1])); return json(res, 200, { permission: u2 ? (u2.write ? 'write' : u2.read ? 'read' : 'none') : 'none' }); }
    const gm = rest.match(/^\/git\/blobs\/([0-9a-f]+)$/); if (gm) { for (const [p, t] of st.files) if (shaFor(p) === gm[1]) return json(res, 200, { content: Buffer.from(t, 'utf8').toString('base64'), encoding: 'base64' }, hdr); return json(res, 404, { message: 'Not Found' }); }
    const fm = rest.match(/^\/contents\/(.+)$/);
    if (fm) {
      const p = fm[1].split('/').map(decodeURIComponent).join('/');
      if (req.method === 'GET') { const t = st.files.get(p); if (t === undefined) return json(res, 404, { message: 'Not Found' }, hdr); if (u.searchParams.get('ref') !== BRANCH) return json(res, 404, { message: 'No commit found for the ref' }, hdr);
        const big = Buffer.byteLength(t) > 1024 * 1024; return json(res, 200, { type: 'file', name: p.split('/').pop(), path: p, sha: shaFor(p), size: Buffer.byteLength(t), encoding: big ? 'none' : 'base64', content: big ? '' : Buffer.from(t, 'utf8').toString('base64') }, hdr); }
      if (req.method === 'PUT') {
        if (authed.kind === 'PAT' && st.patMode === 'readonly') return json(res, 403, { message: 'Resource not accessible by personal access token' }, hdr);
        if (authed.kind !== 'PAT') return json(res, 403, { message: 'users never write in these tests' });
        const b = JSON.parse(raw); if (b.branch !== BRANCH) return json(res, 404, { message: 'Branch not found' }); const cur = shaFor(p);
        if (cur !== null && b.sha !== cur) return json(res, 409, { message: `${p} does not match ${cur}` }); if (cur === null && b.sha) return json(res, 422, { message: 'sha was not supplied correctly' });
        const text = Buffer.from(b.content, 'base64').toString('utf8'); st.files.set(p, text); st.lastCommitMessage = b.message; return json(res, cur === null ? 201 : 200, { content: { sha: shaFor(p), path: p }, commit: { message: b.message } }, hdr);
      }
    }
    return json(res, 404, { message: 'Not Found' });
  });
  return { server, st, listen: (port = 0) => new Promise((r) => server.listen(port, '127.0.0.1', () => r(server.address().port))), close: () => new Promise((r) => server.close(r)), shaFor };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2]) || 8799; const s = createStub(); await s.listen(port);
  process.stdout.write(`github stub on :${port}\n`);
}
