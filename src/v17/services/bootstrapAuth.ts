/**
 * V17.6.1 — SECURE BOOTSTRAP FOR SECRET VAULT RECOVERY ("GitHub sign-in").
 *
 * The problem: the GitHub access token is INSIDE the encrypted vault, and the vault is in a PRIVATE repository. A brand-new browser profile has no token, and the vault passphrase decrypts the
 * file — it does not authenticate anybody to GitHub. GitHub answers "404 Not Found" to a request without a credential. So some legitimate authorization step has to come first.
 *
 * What this module implements: the OAuth 2.0 DEVICE AUTHORIZATION FLOW (RFC 8628, supported by GitHub Apps and OAuth Apps). The user opens github.com/login/device in a browser tab, enters a short code and
 * signs in as THEMSELVES — the repository's own access control (membership, SSO, app installation) decides whether they may read it. The result is a short-lived, per-user token that is
 *   · kept in memory only, for the one retrieval (never written to browser storage, a URL, a log, a message or the vault),
 *   · scoped by the GitHub App's own permissions (recommended: Contents: Read-only, installed only on the data repository),
 *   · discarded as soon as the encrypted vault file has been read.
 * Nothing privileged is embedded in the application: the only value that is deployed is the app's public client_id, in `sql-assistant-data/vault-bootstrap.config.json` next to index.html
 * (administrator-controlled; the client_id is not a secret and the device flow needs no client secret).
 *
 * Why a relay: github.com/login/device/code and /login/oauth/access_token do not send CORS headers, so a browser cannot call them directly. The administrator therefore runs (or deploys) a tiny
 * relay that forwards exactly those two requests (scripts/github-device-relay.mjs, ~100 lines, no secret, allow-listed client_id and origin). The relay sees the sign-in token in the
 * response, so it must be operated by the organization over HTTPS and must not log bodies (docs/DEPLOYMENT.md).
 *
 * This module has NO crypto, NO storage and NO vault code; it only talks to the relay and returns a short-lived token (or a classified failure). Pure logic with injectable I/O (tested in Node).
 * No message produced here contains a token, device code or file content.
 */
export const BOOTSTRAP_CONFIG_RELATIVE_PATH = 'sql-assistant-data/vault-bootstrap.config.json';
export const MAX_BOOTSTRAP_CONFIG_BYTES = 16 * 1024;
const CLIENT_ID = /^[A-Za-z0-9._-]{8,64}$/;
const DEVICE_CODE = /^[A-Za-z0-9_-]{8,256}$/;
const USER_CODE = /^[A-Za-z0-9-]{4,24}$/;
const TOKEN = /^[\x21-\x7E]{20,255}$/;
export interface BootstrapConfig { clientId: string; relayUrl: string; }
export type BootstrapConfigState = { state: 'disabled' } | { state: 'invalid'; message: string } | { state: 'enabled'; config: BootstrapConfig };
const stripBom = (t: string) => t.replace(/^\uFEFF/, '');
const looksLikeHtml = (t: string) => /^\s*</.test(t);

/** The relay address: https, or http only for localhost / 127.0.0.1 (development and tests). No credentials, query or hash in it. Returns the address without a trailing slash, or null. */
export function normalizeRelayUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null; let u: URL; try { u = new URL(v.trim()); } catch { return null; }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && local)) || u.username || u.password || u.search || u.hash || v.length > 300) return null;
  return u.href.replace(/\/+$/, '');
}
/**
 * `{ "githubSignIn": { "enabled": true, "clientId": "Iv1.…", "relayUrl": "https://relay.example.org/github" } }`
 * Off unless `enabled` is exactly true; then both values are required and validated. Anything else keeps the sign-in off (disabled) or is reported (invalid).
 */
export function parseBootstrapConfig(text: string): BootstrapConfigState {
  const t = stripBom(String(text ?? '')).trim(); if (!t) return { state: 'disabled' };
  let j: unknown; try { j = JSON.parse(t); } catch { return { state: 'invalid', message: 'the file is not valid JSON' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { state: 'invalid', message: 'the file must contain one JSON object' };
  const g = (j as Record<string, unknown>).githubSignIn; if (g === undefined || g === null) return { state: 'disabled' };
  if (typeof g !== 'object' || Array.isArray(g)) return { state: 'invalid', message: '"githubSignIn" must be an object' };
  const o = g as Record<string, unknown>; if (o.enabled === false || o.enabled === undefined) return { state: 'disabled' }; if (o.enabled !== true) return { state: 'invalid', message: '"enabled" must be true or false' };
  const clientId = typeof o.clientId === 'string' ? o.clientId.trim() : ''; if (!CLIENT_ID.test(clientId)) return { state: 'invalid', message: '"clientId" must be the public client ID of your GitHub App (letters, digits, "." "_" "-")' };
  const relayUrl = normalizeRelayUrl(o.relayUrl); if (!relayUrl) return { state: 'invalid', message: '"relayUrl" must be an https address (http only for localhost) without credentials, query or hash' };
  return { state: 'enabled', config: { clientId, relayUrl } };
}
/** The folder the page was loaded from, as a URL (null for file://, data: …) — the same rule the application uses for every deployed file. */
export function bootstrapConfigUrl(pageUrl: string): string | null { return deployedFileUrl(pageUrl, BOOTSTRAP_CONFIG_RELATIVE_PATH); }
/** V17.6.2: the same lookup rule for any deployed file that sits next to index.html (also used by the repository-broker configuration). */
export function deployedFileUrl(pageUrl: string, relativePath: string): string | null {
  let u: URL; try { u = new URL(pageUrl); } catch { return null; } if (u.protocol !== 'https:' && u.protocol !== 'http:') return null; u.hash = ''; u.search = '';
  const segs = u.pathname.split('/'); const last = segs[segs.length - 1]; if (last !== '') { if (last.includes('.')) { segs.pop(); u.pathname = `${segs.join('/')}/`; } else u.pathname = `${u.pathname}/`; }
  return new URL(relativePath, u).href;
}
/** Reads the administrator's deployment setting. Anything but a valid, enabled file means "not available" (never an error for the user — the other routes still work). */
export async function fetchBootstrapConfig(d: { pageUrl?: string; fetchFn?: typeof fetch; timeoutMs?: number } = {}): Promise<BootstrapConfigState> {
  const pageUrl = d.pageUrl ?? (typeof location !== 'undefined' ? location.href : ''); const url = bootstrapConfigUrl(pageUrl); if (!url) return { state: 'disabled' };
  const f: typeof fetch = d.fetchFn ?? ((u, i) => globalThis.fetch(u, i)); const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), d.timeoutMs ?? 8000);
  try { const r = await f(url, { method: 'GET', cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: ctl.signal }); if (!r.ok) return { state: 'disabled' };
    const text = await r.text(); if (text.length > MAX_BOOTSTRAP_CONFIG_BYTES || looksLikeHtml(text)) return { state: 'disabled' }; return parseBootstrapConfig(text);
  } catch { return { state: 'disabled' }; } finally { clearTimeout(tm); }
}

export type DeviceFlowFailure = 'relay-unreachable' | 'relay-invalid' | 'timeout' | 'not-enabled' | 'client-rejected' | 'denied' | 'expired' | 'cancelled' | 'rate-limited' | 'unexpected';
export interface DeviceCode { userCode: string; verificationUri: string; expiresInSec: number; intervalSec: number; }
export type DeviceFlowResult = { ok: true; token: string } | { ok: false; kind: DeviceFlowFailure; message: string };
export const DEVICE_FLOW_MESSAGES: Record<DeviceFlowFailure, string> = {
  'relay-unreachable': 'The GitHub sign-in service configured by your administrator could not be reached. Check the connection and try again — or use "Import encrypted file". Nothing on this device was changed.',
  'relay-invalid': 'The GitHub sign-in service gave an unexpected answer (for example a web page instead of a response), so it was not used. Ask your administrator to check the sign-in relay configuration. Nothing on this device was changed.',
  'timeout': 'The GitHub sign-in service did not answer in time. Try again — or use "Import encrypted file". Nothing on this device was changed.',
  'not-enabled': 'GitHub sign-in is not enabled for this application: the device flow is switched off for the GitHub App (or the relay refuses this request). Ask your administrator to enable the device flow — or use "Import encrypted file". Nothing on this device was changed.',
  'client-rejected': 'GitHub did not accept the application\'s sign-in client ID. Ask your administrator to check the client ID in the deployment configuration. Nothing on this device was changed.',
  'denied': 'The sign-in was not approved on GitHub, so the vault was not retrieved. Select "Retrieve from Repository" to try again. Nothing on this device was changed.',
  'expired': 'The sign-in code expired before it was approved. Select "Retrieve from Repository" for a new code. Nothing on this device was changed.',
  'cancelled': 'Sign-in cancelled. Nothing on this device was changed.',
  'rate-limited': 'GitHub or the sign-in service is limiting requests. Wait a few minutes and try again. Nothing on this device was changed.',
  'unexpected': 'The GitHub sign-in could not be completed (unexpected answer). Try again — or use "Import encrypted file". Nothing on this device was changed.',
};
const fail = (kind: DeviceFlowFailure): DeviceFlowResult => ({ ok: false, kind, message: DEVICE_FLOW_MESSAGES[kind] });
/** Only the real github.com device page may be shown to the user — a relay (or anything in between) must not be able to point them somewhere else. */
export function safeVerificationUri(v: unknown): string | null {
  if (typeof v !== 'string') return null; let u: URL; try { u = new URL(v); } catch { return null; }
  return u.protocol === 'https:' && u.hostname === 'github.com' && !u.username && !u.password && u.port === '' && u.pathname.startsWith('/login/') && !u.hash ? `${u.origin}${u.pathname}` : null;
}
type Json = Record<string, unknown>;
async function post(f: typeof fetch, url: string, body: Json, ms: number, signal?: AbortSignal): Promise<{ kind: 'ok'; json: Json } | { kind: 'fail'; why: DeviceFlowFailure }> {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms); const onAbort = () => ctl.abort(); signal?.addEventListener('abort', onAbort);
  try {
    const r = await f(url, { method: 'POST', cache: 'no-store', credentials: 'omit', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    if (r.status === 429) return { kind: 'fail', why: 'rate-limited' };
    const text = await r.text(); if (text.length > 20_000 || looksLikeHtml(text)) return { kind: 'fail', why: 'relay-invalid' };
    let j: unknown; try { j = JSON.parse(text); } catch { return { kind: 'fail', why: 'relay-invalid' }; }
    if (!j || typeof j !== 'object' || Array.isArray(j)) return { kind: 'fail', why: 'relay-invalid' };
    if (!r.ok && !(j as Json).error) return { kind: 'fail', why: r.status === 403 || r.status === 404 ? 'not-enabled' : 'relay-invalid' };
    return { kind: 'ok', json: j as Json };
  } catch (e) { if (signal?.aborted) return { kind: 'fail', why: 'cancelled' }; return { kind: 'fail', why: (e as Error)?.name === 'AbortError' ? 'timeout' : 'relay-unreachable' }; }
  finally { clearTimeout(tm); signal?.removeEventListener('abort', onAbort); }
}
const errKind = (code: unknown): DeviceFlowFailure => code === 'access_denied' ? 'denied' : code === 'expired_token' || code === 'token_expired' ? 'expired' : code === 'device_flow_disabled' || code === 'unsupported_grant_type' ? 'not-enabled'
  : code === 'incorrect_client_credentials' || code === 'invalid_client' || code === 'client_not_allowed' ? 'client-rejected' : code === 'rate_limited' ? 'rate-limited' : 'unexpected';
export interface DeviceFlowDeps { fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number; requestTimeoutMs?: number; maxWaitMs?: number; signal?: AbortSignal; }
/**
 * Runs the device flow: asks the relay for a code, hands the user code (and the verified github.com address) to `onCode`, then polls until the user approves, denies, the code expires or the flow is cancelled.
 * The returned token is for the CALLER to use once and drop. It is never logged or stored here.
 */
export async function runDeviceFlow(cfg: BootstrapConfig, onCode: (c: DeviceCode) => void, d: DeviceFlowDeps = {}): Promise<DeviceFlowResult> {
  const f: typeof fetch = d.fetchFn ?? ((u, i) => globalThis.fetch(u, i)); const sleep = d.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))); const now = d.now ?? (() => Date.now()); const rt = d.requestTimeoutMs ?? 12_000;
  if (d.signal?.aborted) return fail('cancelled');
  const a = await post(f, `${cfg.relayUrl}/device/code`, { client_id: cfg.clientId }, rt, d.signal); if (a.kind === 'fail') return fail(a.why);
  if (a.json.error) return fail(errKind(a.json.error));
  const dc = a.json.device_code; const uc = a.json.user_code; const vu = safeVerificationUri(a.json.verification_uri);
  if (typeof dc !== 'string' || !DEVICE_CODE.test(dc) || typeof uc !== 'string' || !USER_CODE.test(uc) || !vu) return fail('relay-invalid');
  const expires = Math.min(Math.max(Number(a.json.expires_in) || 900, 30), 1800); let interval = Math.min(Math.max(Number(a.json.interval) || 5, 1), 30);
  const deadline = now() + Math.min(expires * 1000, d.maxWaitMs ?? 15 * 60_000); onCode({ userCode: uc, verificationUri: vu, expiresInSec: expires, intervalSec: interval });
  for (;;) {
    await sleep(interval * 1000); if (d.signal?.aborted) return fail('cancelled'); if (now() >= deadline) return fail('expired');
    const p = await post(f, `${cfg.relayUrl}/device/token`, { client_id: cfg.clientId, device_code: dc }, rt, d.signal);
    if (p.kind === 'fail') { if (p.why === 'cancelled' || p.why === 'rate-limited' || p.why === 'relay-invalid' || p.why === 'not-enabled') return fail(p.why); if (now() >= deadline) return fail('expired'); continue; } // a single network hiccup while polling is retried until the code expires
    const j = p.json; if (typeof j.access_token === 'string') return TOKEN.test(j.access_token) ? { ok: true, token: j.access_token } : fail('relay-invalid');
    const e = j.error; if (e === 'authorization_pending') continue; if (e === 'slow_down') { interval = Math.min(Math.max(Number(j.interval) || interval + 5, interval + 1), 60); continue; }
    return fail(errKind(e));
  }
}
