#!/usr/bin/env node
/**
 * SQL Assistant V17.6.2 — REPOSITORY ACCESS BROKER (the trusted backend that holds the centrally managed GitHub PAT).
 *
 * Why it exists. SQL Assistant is a static page. A GitHub Actions *repository secret* cannot be read by browser code, by GitHub Pages or through any GitHub API, so the PAT
 * can only ever be used by a TRUSTED EXECUTION ENVIRONMENT. This is that environment: a small, dependency-free HTTP service that
 *   · reads the PAT from the environment variable SQLA_GITHUB_PAT — the value of the GitHub Actions repository secret of the same name, injected by .github/workflows/deploy-broker.yml,
 *   · lets a caller use it only AFTER the caller proved — through GitHub's own device-flow sign-in — that the caller's GitHub account may read the repository,
 *   · performs exactly four kinds of operation for that caller and returns only their result (file text + sha, a sha, a status) — NEVER the PAT, never a GitHub token of the caller.
 *
 *   GET  /healthz                         → { ok, patConfigured }                                          (no secret, no authentication)
 *   POST /v1/auth/start                   → { handle, userCode, verificationUri, expiresIn, interval }       starts GitHub's device flow (the device code stays inside this service)
 *   POST /v1/auth/poll   {handle,owner,repo} → { status: pending | ok | denied | expired | no-access | error, … }   on ok: a short-lived broker SESSION (not a GitHub token)
 *   GET  /v1/status?owner&repo            → the state of the central PAT for that repository (ok / missing / rejected / insufficient / unreachable) and its expiry when GitHub reports it
 *   POST /v1/check       {owner,repo,branch,path} → does the repository / branch exist, does the file exist
 *   GET  /v1/contents?owner&repo&branch&path     → { text, sha }        read one file below an allowed folder
 *   PUT  /v1/contents    {owner,repo,branch,path,text,sha,message} → { sha }   write one JSON file below an allowed folder (only for callers who can write to the repository)
 *
 * V17.6.5: a write to sql-assistant-data/security/admin-credential.json must be a valid encrypted Admin Password record (see validateAdminCredential); anything else at that path is refused with 422 credential-record-invalid.
 * What it refuses: any repository that is not in SQLA_ALLOWED_REPOSITORIES; any path outside SQLA_ALLOWED_PATH_PREFIXES (default sql-assistant-data/) — so .github/workflows can never be written —; non-JSON
 * or oversized bodies; a body that contains a GitHub token / private key (or the PAT itself); callers without a valid, unexpired session; writes by callers whose GitHub account has no write permission.
 * What it never does: log bodies, tokens, codes or file contents; return the PAT; keep the caller's GitHub token (it is used for two checks and dropped); use the PAT for anything but the file operations above.
 *
 * Configuration (environment):
 *   SQLA_GITHUB_PAT            the central PAT (GitHub Actions secret SQLA_GITHUB_PAT).  Fine-grained, ONE repository, Contents: Read and write (Metadata: Read is implied).
 *   SQLA_GITHUB_CLIENT_ID      public client ID of the GitHub App / OAuth App with the device flow enabled (used only to sign callers in; no client secret is used anywhere)
 *   SQLA_ALLOWED_ORIGINS       comma-separated page origins that may call the service, e.g. https://basware.github.io
 *   SQLA_ALLOWED_REPOSITORIES  comma-separated owner/repo list the PAT may be used for (default basware/sk-ap-sql-assistant)
 *   SQLA_ALLOWED_PATH_PREFIXES comma-separated folders (default sql-assistant-data/)
 *   SQLA_SESSION_SECRET        ≥ 32 characters; signs the sessions (a random one is generated at start-up when it is not set — sessions then end when the service restarts)
 *   SQLA_SESSION_TTL_MINUTES   default 480 (8 h), at most 1440
 *   SQLA_RATE_LIMIT_PER_MINUTE default 240 requests per caller per minute
 *   SQLA_AUDIT_LOG             "0" switches the audit lines off (default: one JSON line per write / sign-in: event, login, repository, path, outcome — never content)
 *   PORT                       default 8788
 *   GITHUB_API_BASE / GITHUB_WEB_BASE   tests only; accepted only for http://localhost / http://127.0.0.1
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const csv = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const SAFE_NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const CLIENT_ID = /^[A-Za-z0-9._-]{8,64}$/;
const SESSION_RE = /^v1\.[A-Za-z0-9_-]{10,2000}\.[A-Za-z0-9_-]{43}$/;
const CRED = /\bgh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const MAX_JSON_SMALL = 4096; const DEFAULT_MAX_WRITE = 8 * 1024 * 1024;
const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

export const validRepoPath = (p, prefixes) => typeof p === 'string' && p.length > 0 && p.length <= 255 && /^[A-Za-z0-9._\-/]+$/.test(p) && !p.startsWith('/') && !p.endsWith('/') && !p.includes('//')
  && !p.split('/').some((s) => s === '.' || s === '..' || s.startsWith('.')) && /\.json$/i.test(p) && prefixes.some((x) => p.startsWith(x));
const validBranch = (b) => typeof b === 'string' && b.length > 0 && b.length <= 255 && !/[\s\x00-\x1f\x7f~^:?*[\\]/.test(b) && !b.includes('..') && !b.includes('@{') && !b.includes('//') && !/^[/.-]/.test(b) && !/[/.]$/.test(b) && !/\.lock$/i.test(b);


// ───────────────────────────── V17.6.5 — the central Admin Password record ─────────────────────────────
// sql-assistant-data/security/admin-credential.json holds ONLY the encrypted verification marker (PBKDF2-SHA-256 150 000 → AES-256-GCM over a fixed text) in a versioned envelope — never the password.
// The same strict check runs in the browser (src/v17/services/adminCredential.ts), in scripts/publish-data.mjs and in scripts/security_check.mjs; this is the server's copy, so the one trusted write path
// refuses anything else at that path: a password-like field, plaintext, another cipher, a record whose isDefault flag does not match its marker. It cannot (and does not claim to) stop someone with write
// access from replacing the record with another VALID one — see docs/SECURITY.md.
export const ADMIN_CREDENTIAL_PATH = 'sql-assistant-data/security/admin-credential.json';
const AC_MARKER = 'sqla-verified-marker-v15'; const AC_DEFAULT = 'admin';
const AC_TOP = ['format', 'formatVersion', 'revision', 'updatedAt', 'updatedBy', 'isDefault', 'marker'];
const acKeys = (o, keys) => { const k = Object.keys(o); return k.length === keys.length && keys.every((x) => k.includes(x)); };
const acB64 = (s) => Buffer.from(s, 'base64').toString('base64') === s;
const acOpens = (m, password) => { try { const key = crypto.pbkdf2Sync(password, Buffer.from(m.salt, 'base64'), 150000, 32, 'sha256'); const ct = Buffer.from(m.ciphertext, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(m.iv, 'base64')); d.setAuthTag(ct.subarray(ct.length - 16)); return Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString('utf8') === AC_MARKER; } catch { return false; } };
export function validateAdminCredential(text) {
  const bad = (reason) => ({ ok: false, reason }); const t = String(text ?? '').replace(/^\uFEFF/, ''); if (!t.trim() || Buffer.byteLength(t, 'utf8') > 4096) return bad('empty or larger than 4 KB');
  let o; try { o = JSON.parse(t); } catch { return bad('not valid JSON'); } if (!o || typeof o !== 'object' || Array.isArray(o)) return bad('not a JSON object');
  if (o.format !== 'sqla-admin-credential' || o.formatVersion !== 1) return bad('not an Admin Password record of format version 1'); if (!acKeys(o, AC_TOP)) return bad('unexpected or missing fields');
  if (!Number.isSafeInteger(o.revision) || o.revision < 1 || o.revision > 1e9) return bad('revision'); if (typeof o.updatedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(o.updatedAt) || Number.isNaN(Date.parse(o.updatedAt)) || new Date(o.updatedAt).toISOString() !== o.updatedAt) return bad('updatedAt');
  if (typeof o.updatedBy !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(o.updatedBy)) return bad('updatedBy'); if (typeof o.isDefault !== 'boolean') return bad('isDefault');
  const m = o.marker; if (!m || typeof m !== 'object' || Array.isArray(m) || !acKeys(m, ['salt', 'iv', 'ciphertext'])) return bad('marker fields');
  if (typeof m.salt !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(m.salt) || !acB64(m.salt) || typeof m.iv !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(m.iv) || !acB64(m.iv) || typeof m.ciphertext !== 'string' || !/^[A-Za-z0-9+/]{54}==$/.test(m.ciphertext) || !acB64(m.ciphertext)) return bad('marker is not an AES-256-GCM marker of the expected size');
  if (acOpens(m, AC_DEFAULT) !== o.isDefault) return bad('isDefault does not match the marker'); return { ok: true, record: o };
}

export function createBroker(env = process.env) {
  const pat = String(env.SQLA_GITHUB_PAT || '').trim();
  const clientId = String(env.SQLA_GITHUB_CLIENT_ID || '').trim();
  const origins = new Set(csv(env.SQLA_ALLOWED_ORIGINS).map((o) => o.replace(/\/+$/, '')));
  const repos = new Set(csv(env.SQLA_ALLOWED_REPOSITORIES || 'basware/sk-ap-sql-assistant').map((r) => r.toLowerCase()));
  const prefixes = csv(env.SQLA_ALLOWED_PATH_PREFIXES || 'sql-assistant-data/').map((p) => (p.endsWith('/') ? p : `${p}/`));
  if (!CLIENT_ID.test(clientId)) throw new Error('SQLA_GITHUB_CLIENT_ID must be the public client ID of the GitHub App / OAuth App used to sign callers in.');
  if (!origins.size || [...origins].some((o) => !/^https?:\/\/[^/\s]+$/.test(o))) throw new Error('SQLA_ALLOWED_ORIGINS must list the origin(s) that serve SQL Assistant, e.g. https://basware.github.io (no path).');
  if (!repos.size || [...repos].some((r) => !/^[a-z0-9_.-]{1,100}\/[a-z0-9_.-]{1,100}$/.test(r))) throw new Error('SQLA_ALLOWED_REPOSITORIES must list owner/repo values.');
  if (!prefixes.length || prefixes.some((p) => !/^[A-Za-z0-9._\-/]+\/$/.test(p) || p.startsWith('/') || p.includes('..') || p.startsWith('.'))) throw new Error('SQLA_ALLOWED_PATH_PREFIXES must list repository folders such as sql-assistant-data/.');
  const local = (u) => { const x = new URL(u); return x.protocol === 'http:' && (x.hostname === 'localhost' || x.hostname === '127.0.0.1'); };
  const override = (v, dflt) => { const b = String(v || dflt).replace(/\/+$/, ''); if (b !== dflt && !local(b)) throw new Error('GITHUB_API_BASE / GITHUB_WEB_BASE may only be overridden for http://localhost or http://127.0.0.1 (tests).'); return b; };
  const API = override(env.GITHUB_API_BASE, 'https://api.github.com'); const WEB = override(env.GITHUB_WEB_BASE, 'https://github.com');
  const secretEnv = String(env.SQLA_SESSION_SECRET || ''); if (secretEnv && secretEnv.length < 32) throw new Error('SQLA_SESSION_SECRET must be at least 32 characters.');
  const key = secretEnv || crypto.randomBytes(48).toString('base64url');
  const ttlMin = Math.min(Math.max(Number(env.SQLA_SESSION_TTL_MINUTES) || 480, 5), 1440);
  const LIMIT = Math.max(10, Number(env.SQLA_RATE_LIMIT_PER_MINUTE) || 240); const MAX_WRITE = Math.max(1024, Number(env.SQLA_MAX_WRITE_BYTES) || DEFAULT_MAX_WRITE);
  const audit = env.SQLA_AUDIT_LOG !== '0'; const auditOut = typeof env.__AUDIT_SINK === 'function' ? env.__AUDIT_SINK : (l) => process.stdout.write(`${l}\n`);
  const note = (o) => { if (audit) auditOut(JSON.stringify({ t: new Date().toISOString(), ...o })); };

  // ── sessions: stateless, HMAC-signed, scoped to the broker. They are NOT GitHub tokens and grant nothing at GitHub.
  const b64u = (v) => Buffer.from(v).toString('base64url');
  const mac = (body) => crypto.createHmac('sha256', key).update(`sqla-session.v1.${body}`).digest('base64url');
  const issue = (login, canWrite, repo) => { const iat = Math.floor(Date.now() / 1000); const exp = iat + ttlMin * 60; const body = b64u(JSON.stringify({ sub: login, cw: !!canWrite, rp: repo, iat, exp })); return { token: `v1.${body}.${mac(body)}`, expiresAt: exp * 1000 }; };
  const readSession = (req) => {
    const h = String(req.headers.authorization || ''); const m = h.match(/^Bearer (\S+)$/); if (!m) return { ok: false, reason: 'session-required' }; const t = m[1]; if (!SESSION_RE.test(t)) return { ok: false, reason: 'session-invalid' };
    const [, body, sig] = t.split('.'); const want = mac(body); const a = Buffer.from(sig); const b = Buffer.from(want); if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'session-invalid' };
    let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'session-invalid' }; }
    if (!p || typeof p.sub !== 'string' || typeof p.exp !== 'number') return { ok: false, reason: 'session-invalid' }; if (p.exp * 1000 <= Date.now()) return { ok: false, reason: 'session-expired' };
    return { ok: true, login: p.sub, canWrite: p.cw === true, repo: String(p.rp || '') };
  };

  // ── rate limiting (per session subject, else per origin)
  const hits = new Map(); const limited = (k) => { const m = Math.floor(Date.now() / 60000); const h = hits.get(k); if (!h || h.m !== m) { hits.set(k, { m, n: 1 }); if (hits.size > 10000) hits.clear(); return false; } return ++h.n > LIMIT; };

  // ── the device flow state: the device code never leaves this service
  const pending = new Map();
  const sweep = () => { const n = Date.now(); for (const [k, v] of pending) if (v.expiresAt <= n) pending.delete(k); };

  // ── GitHub access
  async function gh(base, path, { method = 'GET', token = '', json, form, ms = 15000 } = {}) {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms);
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'sql-assistant-repo-broker', 'X-GitHub-Api-Version': '2022-11-28' }; if (token) headers.Authorization = `Bearer ${token}`;
    let body; if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); } else if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; headers.Accept = 'application/json'; body = new URLSearchParams(form).toString(); }
    try { const r = await fetch(`${base}${path}`, { method, headers, body, signal: ctl.signal, redirect: 'error' }); const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch { j = null; } return { status: r.status, json: j, headers: r.headers }; }
    catch (e) { return { status: 0, json: null, headers: new Headers(), timeout: e?.name === 'AbortError' }; }
    finally { clearTimeout(tm); }
  }
  const repoApi = (o, r) => `/repos/${encodeURIComponent(o)}/${encodeURIComponent(r)}`;
  const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
  const rateLimited = (x) => x.status === 429 || (x.status === 403 && (x.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(String(x.json?.message || ''))));
  /** Maps a GitHub answer to the PAT problem it means, or null when it is not a PAT problem. */
  const patProblem = (x) => { if (!pat) return 'pat-missing'; if (x.status === 0) return x.timeout ? 'upstream-timeout' : 'upstream-unreachable'; if (x.status === 401) return 'pat-rejected'; if (rateLimited(x)) return 'rate-limited'; if (x.status === 403) return 'pat-insufficient'; return null; };
  const parseExpiry = (h) => { const v = h.get('github-authentication-token-expiration'); if (!v) return null; const t = Date.parse(String(v).replace(' UTC', 'Z').replace(' ', 'T')); return Number.isNaN(t) ? null : new Date(t).toISOString(); };

  let patCache = null; // { at, key, value } — the answer about the PAT is cached for 60 s (no secret in it)
  async function patStatus(o, r) {
    if (!pat) return { state: 'missing', canWrite: null, expiresAt: null };
    const k = `${o}/${r}`.toLowerCase(); if (patCache && patCache.key === k && Date.now() - patCache.at < 60_000) return patCache.value;
    const x = await gh(API, repoApi(o, r), { token: pat, ms: 10000 }); let v;
    if (x.status === 200) { const p = x.json?.permissions; const cw = p && typeof p === 'object' ? !!(p.push || p.admin || p.maintain) : null; v = { state: cw === false ? 'insufficient' : 'ok', canWrite: cw, expiresAt: parseExpiry(x.headers) }; }
    else if (x.status === 404) v = { state: 'insufficient', canWrite: null, expiresAt: parseExpiry(x.headers), detail: 'repository-invisible' };
    else { const pr = patProblem(x); v = { state: pr === 'pat-rejected' ? 'rejected' : pr === 'pat-insufficient' ? 'insufficient' : pr === 'rate-limited' ? 'rate-limited' : 'unreachable', canWrite: null, expiresAt: null }; }
    if (v.state !== 'unreachable' && v.state !== 'rate-limited') patCache = { at: Date.now(), key: k, value: v }; return v;
  }

  // ── tiny HTTP helpers
  async function readBody(req, limit) { let size = 0; const chunks = []; for await (const c of req) { size += c.length; if (size > limit) return { tooLarge: true }; chunks.push(c); } if (!size) return { json: {} }; try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? { json: j } : { bad: true }; } catch { return { bad: true }; } }
  const strOk = (v, max = 255) => typeof v === 'string' && v.length > 0 && v.length <= max;

  const server = http.createServer(async (req, res) => {
    const origin = String(req.headers.origin || '').replace(/\/+$/, ''); const allowed = origins.has(origin);
    const send = (st, obj) => { const h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' }; if (allowed) { h['Access-Control-Allow-Origin'] = origin; h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'; h['Access-Control-Allow-Methods'] = 'GET, POST, PUT, OPTIONS'; h['Access-Control-Max-Age'] = '600'; } res.writeHead(st, h); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    const url = new URL(req.url || '/', 'http://x'); const path = url.pathname;
    try {
      if (req.method === 'GET' && path === '/healthz') return send(200, { ok: true, patConfigured: !!pat });
      if (!allowed) return send(403, { error: 'origin-not-allowed' });
      if (req.method === 'OPTIONS') return send(204);
      if (limited(origin)) return send(429, { error: 'rate-limited' });
      const repoOf = (o, r) => { if (!strOk(o, 100) || !strOk(r, 100) || !SAFE_NAME.test(o) || !SAFE_NAME.test(r)) return null; return repos.has(`${o}/${r}`.toLowerCase()) ? { o, r } : false; };

      // ───────── sign-in (GitHub device flow, run by this service so that the browser never sees a GitHub token or a device code)
      if (req.method === 'POST' && path === '/v1/auth/start') {
        const b = await readBody(req, MAX_JSON_SMALL); if (b.tooLarge) return send(413, { error: 'too-large' }); if (b.bad) return send(400, { error: 'bad-request' });
        sweep(); if (pending.size > 2000) return send(429, { error: 'rate-limited' });
        const x = await gh(WEB, '/login/device/code', { method: 'POST', form: { client_id: clientId } });
        if (x.status === 0) return send(502, { error: x.timeout ? 'upstream-timeout' : 'upstream-unreachable' });
        const j = x.json || {}; if (j.error) return send(502, { error: j.error === 'device_flow_disabled' ? 'device-flow-disabled' : j.error === 'incorrect_client_credentials' ? 'client-rejected' : 'upstream-error' });
        if (typeof j.device_code !== 'string' || typeof j.user_code !== 'string') return send(502, { error: 'upstream-error' });
        const handle = crypto.randomBytes(24).toString('base64url'); const expiresIn = Math.min(Math.max(Number(j.expires_in) || 900, 30), 1800); const interval = Math.min(Math.max(Number(j.interval) || 5, 1), 30);
        pending.set(handle, { deviceCode: j.device_code, expiresAt: Date.now() + expiresIn * 1000, interval, next: Date.now() + interval * 1000 - 500 });
        const vu = typeof j.verification_uri === 'string' && /^https:\/\/github\.com\/login\//.test(j.verification_uri) ? j.verification_uri : 'https://github.com/login/device';
        return send(200, { handle, userCode: j.user_code, verificationUri: vu, expiresIn, interval });
      }
      if (req.method === 'POST' && path === '/v1/auth/poll') {
        const b = await readBody(req, MAX_JSON_SMALL); if (b.tooLarge) return send(413, { error: 'too-large' }); if (b.bad || !b.json) return send(400, { error: 'bad-request' });
        const rp = repoOf(b.json.owner, b.json.repo); if (rp === null) return send(400, { error: 'bad-request' }); if (rp === false) return send(403, { error: 'repository-not-allowed' });
        const hd = b.json.handle; if (!strOk(hd, 100) || !pending.has(hd)) return send(200, { status: 'expired' }); const p = pending.get(hd);
        if (p.expiresAt <= Date.now()) { pending.delete(hd); return send(200, { status: 'expired' }); }
        if (Date.now() < p.next) return send(200, { status: 'pending', interval: p.interval });
        p.next = Date.now() + p.interval * 1000 - 500;
        const x = await gh(WEB, '/login/oauth/access_token', { method: 'POST', form: { client_id: clientId, device_code: p.deviceCode, grant_type: GRANT } });
        if (x.status === 0) return send(200, { status: 'pending', interval: p.interval, hiccup: true });
        const j = x.json || {};
        if (typeof j.access_token !== 'string') {
          const e = j.error; if (e === 'authorization_pending') return send(200, { status: 'pending', interval: p.interval });
          if (e === 'slow_down') { p.interval = Math.min(p.interval + 5, 60); return send(200, { status: 'pending', interval: p.interval }); }
          pending.delete(hd); if (e === 'expired_token') return send(200, { status: 'expired' }); if (e === 'access_denied') return send(200, { status: 'denied' }); return send(200, { status: 'error', error: 'upstream-error' });
        }
        let ut = j.access_token; pending.delete(hd);
        try {
          const u = await gh(API, '/user', { token: ut, ms: 10000 }); if (u.status !== 200 || typeof u.json?.login !== 'string') return send(200, { status: 'error', error: u.status === 401 ? 'signin-rejected' : 'upstream-error' });
          const login = String(u.json.login);
          const rr = await gh(API, repoApi(rp.o, rp.r), { token: ut, ms: 10000 });
          if (rr.status === 404 || rr.status === 403) { note({ event: 'signin', login, repo: `${rp.o}/${rp.r}`, outcome: 'no-access' }); return send(200, { status: 'no-access' }); }
          if (rr.status !== 200) return send(200, { status: 'error', error: 'upstream-error' });
          let canWrite = false; const perm = rr.json?.permissions;
          if (perm && typeof perm === 'object') canWrite = !!(perm.push || perm.admin || perm.maintain);
          else if (pat) { const c = await gh(API, `${repoApi(rp.o, rp.r)}/collaborators/${encodeURIComponent(login)}/permission`, { token: pat, ms: 10000 }); canWrite = c.status === 200 && ['admin', 'write', 'maintain'].includes(String(c.json?.permission || '')); } // fail closed: unknown ⇒ read-only
          const s = issue(login, canWrite, `${rp.o}/${rp.r}`); note({ event: 'signin', login, repo: `${rp.o}/${rp.r}`, outcome: 'ok', canWrite });
          return send(200, { status: 'ok', session: s.token, expiresAt: s.expiresAt, login, canWrite });
        } finally { ut = ''; }
      }

      // ───────── everything below needs a valid session
      const s = readSession(req); if (!s.ok) return send(401, { error: s.reason });
      if (limited(`s:${s.login}`)) return send(429, { error: 'rate-limited' });
      const bound = (rp) => rp && s.repo.toLowerCase() === `${rp.o}/${rp.r}`.toLowerCase(); // a session is valid only for the repository whose access it proved

      if (req.method === 'GET' && path === '/v1/status') {
        const rp = repoOf(url.searchParams.get('owner'), url.searchParams.get('repo')); if (rp === null) return send(400, { error: 'bad-request' }); if (rp === false || !bound(rp)) return send(403, { error: 'repository-not-allowed' });
        const v = await patStatus(rp.o, rp.r); const days = v.expiresAt ? Math.floor((Date.parse(v.expiresAt) - Date.now()) / 86400000) : null;
        return send(200, { pat: v.state, canWrite: v.canWrite, expiresAt: v.expiresAt, expiresInDays: days, session: { login: s.login, canWrite: s.canWrite } });
      }
      const target = (o, r, b, p) => { const rp = repoOf(o, r); if (rp === null || !validBranch(b) || !validRepoPath(p, prefixes)) return { err: [400, { error: 'bad-request' }] }; if (rp === false || !bound(rp)) return { err: [403, { error: 'repository-not-allowed' }] }; return { rp, branch: b, path: p }; };
      const patFail = (x, what) => { const pr = patProblem(x); if (pr === 'pat-missing') return [503, { error: 'pat-missing' }]; if (pr === 'pat-rejected') return [502, { error: 'pat-rejected' }]; if (pr === 'pat-insufficient') return [502, { error: 'pat-insufficient' }]; if (pr === 'rate-limited') return [429, { error: 'rate-limited' }]; if (pr === 'upstream-timeout') return [504, { error: 'upstream-timeout' }]; if (pr === 'upstream-unreachable') return [502, { error: 'upstream-unreachable' }]; return [502, { error: 'upstream-error', what }]; };

      if (req.method === 'POST' && path === '/v1/check') {
        const b = await readBody(req, MAX_JSON_SMALL); if (b.tooLarge) return send(413, { error: 'too-large' }); if (b.bad || !b.json) return send(400, { error: 'bad-request' });
        const t = target(b.json.owner, b.json.repo, b.json.branch, b.json.path); if (t.err) return send(...t.err); if (!pat) return send(503, { error: 'pat-missing' });
        const a = await gh(API, repoApi(t.rp.o, t.rp.r), { token: pat }); if (a.status === 404) return send(200, { ok: false, error: 'repository-not-found' }); if (a.status !== 200) return send(...patFail(a, 'repository'));
        const br = await gh(API, `${repoApi(t.rp.o, t.rp.r)}/branches/${encPath(t.branch)}`, { token: pat }); if (br.status === 404) return send(200, { ok: false, error: 'branch-not-found' }); if (br.status !== 200) return send(...patFail(br, 'branch'));
        const f = await gh(API, `${repoApi(t.rp.o, t.rp.r)}/contents/${encPath(t.path)}?ref=${encodeURIComponent(t.branch)}`, { token: pat }); if (f.status === 404) return send(200, { ok: true, fileExists: false }); if (f.status !== 200) return send(...patFail(f, 'file'));
        return send(200, { ok: true, fileExists: true });
      }
      if (req.method === 'GET' && path === '/v1/contents') {
        const t = target(url.searchParams.get('owner'), url.searchParams.get('repo'), url.searchParams.get('branch'), url.searchParams.get('path')); if (t.err) return send(...t.err); if (!pat) return send(503, { error: 'pat-missing' });
        const base = repoApi(t.rp.o, t.rp.r); const x = await gh(API, `${base}/contents/${encPath(t.path)}?ref=${encodeURIComponent(t.branch)}`, { token: pat });
        if (x.status === 404) { const a = await gh(API, base, { token: pat, ms: 10000 }); if (a.status === 404) return send(502, { error: 'repository-unavailable' }); if (a.status === 200) return send(404, { error: 'not-found' }); return send(...patFail(a, 'repository')); }
        if (x.status !== 200) return send(...patFail(x, 'read'));
        const j = x.json; if (!j || Array.isArray(j) || j.type !== 'file' || typeof j.sha !== 'string') return send(422, { error: 'not-a-file' });
        let content = j.content; if (!(typeof content === 'string' && content) || j.encoding === 'none') { const bl = await gh(API, `${base}/git/blobs/${encodeURIComponent(j.sha)}`, { token: pat, ms: 30000 }); if (bl.status !== 200 || typeof bl.json?.content !== 'string') return send(...patFail(bl, 'read')); content = bl.json.content; }
        const text = Buffer.from(content.replace(/\s+/g, ''), 'base64').toString('utf8'); return send(200, { text, sha: j.sha });
      }
      if (req.method === 'PUT' && path === '/v1/contents') {
        const b = await readBody(req, MAX_WRITE + 8192); if (b.tooLarge) return send(413, { error: 'too-large' }); if (b.bad || !b.json) return send(400, { error: 'bad-request' });
        const t = target(b.json.owner, b.json.repo, b.json.branch, b.json.path); if (t.err) return send(...t.err);
        if (!s.canWrite) { note({ event: 'write', login: s.login, repo: `${t.rp.o}/${t.rp.r}`, path: t.path, outcome: 'write-not-permitted' }); return send(403, { error: 'write-not-permitted' }); }
        const text = b.json.text; if (typeof text !== 'string' || !text) return send(400, { error: 'bad-request' }); if (Buffer.byteLength(text, 'utf8') > MAX_WRITE) return send(413, { error: 'too-large' });
        const sha = b.json.sha === null || b.json.sha === undefined ? null : b.json.sha; if (sha !== null && !(typeof sha === 'string' && /^[0-9a-f]{40,64}$/i.test(sha))) return send(400, { error: 'bad-request' });
        try { JSON.parse(text); } catch { return send(422, { error: 'not-json' }); }
        if (t.path === ADMIN_CREDENTIAL_PATH || /(^|\/)security\/admin-credential\.json$/.test(t.path)) { const v = validateAdminCredential(text); if (!v.ok) { note({ event: 'write', login: s.login, repo: `${t.rp.o}/${t.rp.r}`, path: t.path, outcome: 'credential-record-invalid' }); return send(422, { error: 'credential-record-invalid' }); } }
        if (CRED.test(text) || (pat && text.includes(pat))) { note({ event: 'write', login: s.login, repo: `${t.rp.o}/${t.rp.r}`, path: t.path, outcome: 'secret-in-content' }); return send(422, { error: 'secret-in-content' }); }
        if (!pat) return send(503, { error: 'pat-missing' });
        const msg = `${String(b.json.message || 'SQL Assistant update').replace(/[\r\n]+/g, ' ').replace(CRED, '[redacted]').slice(0, 160)} (via repository broker · ${s.login})`;
        const x = await gh(API, `${repoApi(t.rp.o, t.rp.r)}/contents/${encPath(t.path)}`, { method: 'PUT', token: pat, ms: 30000, json: { message: msg, content: Buffer.from(text, 'utf8').toString('base64'), branch: t.branch, ...(sha ? { sha } : {}) } });
        if (x.status === 200 || x.status === 201) { note({ event: 'write', login: s.login, repo: `${t.rp.o}/${t.rp.r}`, path: t.path, outcome: 'ok' }); return send(200, { sha: String(x.json?.content?.sha || '') }); }
        note({ event: 'write', login: s.login, repo: `${t.rp.o}/${t.rp.r}`, path: t.path, outcome: `http-${x.status}` });
        if (x.status === 409 || x.status === 422) return send(409, { error: 'conflict' }); if (x.status === 404) return send(502, { error: 'repository-unavailable' }); return send(...patFail(x, 'write'));
      }
      return send(404, { error: 'not-found-route' });
    } catch { return send(500, { error: 'internal' }); } // never echo the exception
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let srv; try { srv = createBroker(); } catch (e) { process.stderr.write(`SQL Assistant repository broker: ${e.message}\n`); process.exit(1); }
  const port = Number(process.env.PORT) || 8788; srv.listen(port, () => {
    process.stdout.write(`SQL Assistant repository broker listening on :${port} — central PAT ${process.env.SQLA_GITHUB_PAT ? 'configured' : 'MISSING (set the SQLA_GITHUB_PAT secret)'}; sessions ${process.env.SQLA_SESSION_SECRET ? 'signed with SQLA_SESSION_SECRET' : 'signed with a random key (they end when the service restarts)'}.\n`);
  });
}
