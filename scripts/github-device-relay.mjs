#!/usr/bin/env node
/**
 * SQL Assistant V17.6.1 — GitHub device-flow RELAY (reference implementation, no dependencies, no secret).
 *
 * Why it exists: SQL Assistant is a static web page. github.com/login/device/code and github.com/login/oauth/access_token do not send CORS headers, so a browser cannot call them. This relay forwards
 * exactly those two requests — nothing else — so a user on a brand-new browser profile can authorize on github.com and let SQL Assistant read the ENCRYPTED Secret Vault from the private repository.
 *
 *   POST /device/code   {"client_id": "..."}                       → GitHub: POST /login/device/code
 *   POST /device/token  {"client_id": "...", "device_code": "..."} → GitHub: POST /login/oauth/access_token (grant_type is added here)
 *   GET  /healthz
 *
 * What it does NOT do: it holds no client secret and no token (the device flow needs neither), it never reads or writes the repository, it does not log request or response bodies, addresses or codes,
 * it does not return refresh tokens, and it answers only the allow-listed client_id(s) for the allow-listed page origin(s).
 * What it SEES: the short-lived sign-in token in the /device/token response. Run it yourself (your organization, HTTPS, no body logging) — do not use a relay operated by someone else.
 *
 *   ALLOWED_CLIENT_IDS=Iv1.abc123...   ALLOWED_ORIGINS=https://tools.example.org   PORT=8787  node scripts/github-device-relay.mjs
 *
 * Put it behind HTTPS (reverse proxy, Azure App Service / Container Apps, Cloudflare Tunnel …) and set "relayUrl" in sql-assistant-data/vault-bootstrap.config.json to its public address (docs/DEPLOYMENT.md).
 * GITHUB_BASE exists for tests only and is accepted only for http://localhost / 127.0.0.1.
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const csv = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const CLIENT_ID = /^[A-Za-z0-9._-]{8,64}$/; const DEVICE_CODE = /^[A-Za-z0-9_-]{8,256}$/;
const CODE_FIELDS = ['device_code', 'user_code', 'verification_uri', 'expires_in', 'interval', 'error', 'error_description'];
const TOKEN_FIELDS = ['access_token', 'token_type', 'scope', 'expires_in', 'error', 'error_description', 'interval']; // refresh_token and refresh_token_expires_in are deliberately NOT passed on
export function createRelay(env = process.env) {
  const clients = new Set(csv(env.ALLOWED_CLIENT_IDS)); const origins = new Set(csv(env.ALLOWED_ORIGINS).map((o) => o.replace(/\/+$/, '')));
  if (!clients.size || [...clients].some((c) => !CLIENT_ID.test(c))) throw new Error('ALLOWED_CLIENT_IDS must list the public client ID(s) of your GitHub App.');
  if (!origins.size || [...origins].some((o) => !/^https?:\/\/[^/\s]+$/.test(o))) throw new Error('ALLOWED_ORIGINS must list the origin(s) that serve SQL Assistant, e.g. https://tools.example.org (no path).');
  let base = String(env.GITHUB_BASE || 'https://github.com').replace(/\/+$/, ''); if (base !== 'https://github.com') { const u = new URL(base); if (!(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) throw new Error('GITHUB_BASE may only be overridden for http://localhost or http://127.0.0.1 (tests).'); }
  const hits = new Map(); const LIMIT = Number(env.RATE_LIMIT_PER_MINUTE || 120); const limited = (key) => { const m = Math.floor(Date.now() / 60000); const h = hits.get(key); if (!h || h.m !== m) { hits.set(key, { m, n: 1 }); if (hits.size > 5000) hits.clear(); return false; } return ++h.n > LIMIT; };
  const pick = (o, fields) => Object.fromEntries(fields.filter((f) => o && o[f] !== undefined && typeof o[f] !== 'object').map((f) => [f, o[f]]));
  async function forward(path, form, fields) {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 10_000);
    try { const r = await fetch(`${base}${path}`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(), signal: ctl.signal });
      const t = await r.text(); let j; try { j = JSON.parse(t); } catch { return [502, { error: 'bad_gateway' }]; } return [r.status === 429 ? 429 : 200, pick(j, fields)]; }
    catch { return [502, { error: 'bad_gateway' }]; } finally { clearTimeout(tm); }
  }
  return http.createServer(async (req, res) => {
    const origin = String(req.headers.origin || '').replace(/\/+$/, ''); const allowed = origins.has(origin);
    const send = (st, obj) => { const h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' }; if (allowed) { h['Access-Control-Allow-Origin'] = origin; h['Access-Control-Allow-Headers'] = 'Content-Type, Accept'; h['Access-Control-Allow-Methods'] = 'POST, OPTIONS'; h['Access-Control-Max-Age'] = '600'; } res.writeHead(st, h); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    const path = String(req.url || '').split('?')[0];
    if (req.method === 'GET' && path === '/healthz') return send(200, { ok: true });
    if (!allowed) return send(403, { error: 'origin_not_allowed' });
    if (req.method === 'OPTIONS') return send(204);
    if (req.method !== 'POST' || (path !== '/device/code' && path !== '/device/token')) return send(404, { error: 'not_found' });
    if (limited(origin)) return send(429, { error: 'rate_limited' });
    let size = 0; const chunks = []; for await (const c of req) { size += c.length; if (size > 2048) return send(413, { error: 'too_large' }); chunks.push(c); }
    let b; try { b = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'bad_request' }); }
    if (!b || typeof b.client_id !== 'string' || !clients.has(b.client_id)) return send(403, { error: 'client_not_allowed' });
    if (path === '/device/code') { const [st, j] = await forward('/login/device/code', { client_id: b.client_id }, CODE_FIELDS); return send(st, j); }
    if (typeof b.device_code !== 'string' || !DEVICE_CODE.test(b.device_code)) return send(400, { error: 'bad_request' });
    const [st, j] = await forward('/login/oauth/access_token', { client_id: b.client_id, device_code: b.device_code, grant_type: GRANT }, TOKEN_FIELDS); return send(st, j);
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let srv; try { srv = createRelay(); } catch (e) { process.stderr.write(`${e.message}\n`); process.exit(2); }
  const port = Number(process.env.PORT || 8787); srv.listen(port, process.env.HOST || '0.0.0.0', () => process.stdout.write(`SQL Assistant GitHub device-flow relay listening on port ${port}\n`));
}
