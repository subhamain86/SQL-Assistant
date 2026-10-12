/**
 * V17.6.2 — CENTRAL REPOSITORY ACCESS (client side of server/repo-broker.mjs).
 *
 * The GitHub PAT that reads and writes the data repository is a GitHub Actions repository secret. A secret like that cannot be read by browser code, so it lives in a trusted backend (the
 * "repository access broker"); this module is the only thing the browser knows about it. The page
 *   1. learns where the broker is from a deployed, public configuration file (`sql-assistant-data/repo-broker.config.json`, written by the deploy workflow from a repository *variable*),
 *   2. signs the user in through GitHub's device flow RUN BY THE BROKER — the browser shows a short code and the real github.com address; it never receives a GitHub token or the device code —
 *      and receives a short-lived, broker-signed SESSION (an opaque string that is not a GitHub credential),
 *   3. reads and writes the repository through the broker with that session (`brokerRepository()` is a drop-in SchemaRepository, so schema synchronization, knowledge, the admin message,
 *      Pull Schema, Pull / Push Secret Vault all use the same mechanism).
 * The PAT is never sent to the page, is not in the bundle, and is not in any response — this module cannot receive it because the broker has no endpoint that returns it.
 *
 * Pure logic with injectable I/O (tested in Node). No crypto, no vault code. The session lives in sessionStorage (this tab / browser session) — never in the vault and never in localStorage.
 * No message produced here contains a session, a token, a device code or file content.
 */
import { RepositoryError, getRepositoryTimeoutMs, type SchemaRepository, type RepoFile, type RepositoryErrorKind, type LocationCheck } from './githubClient';
import { normalizeRelayUrl, deployedFileUrl, safeVerificationUri } from './bootstrapAuth';

export const BROKER_CONFIG_RELATIVE_PATH = 'sql-assistant-data/repo-broker.config.json';
export const MAX_BROKER_CONFIG_BYTES = 16 * 1024;
export type BrokerConfigState = { state: 'unknown' } | { state: 'disabled' } | { state: 'invalid'; message: string } | { state: 'enabled'; config: BrokerConfig };
export interface BrokerConfig { url: string; }
const stripBom = (t: string) => t.replace(/^\uFEFF/, '');
const looksLikeHtml = (t: string) => /^\s*</.test(t);

/** `{ "repositoryBroker": { "enabled": true, "url": "https://sql-assistant-broker.example.org" } }` — off unless `enabled` is exactly true; then the address is required and validated (https, http only for localhost, no credentials / query / hash). */
export function parseBrokerConfig(text: string): BrokerConfigState {
  const t = stripBom(String(text ?? '')).trim(); if (!t) return { state: 'disabled' };
  let j: unknown; try { j = JSON.parse(t); } catch { return { state: 'invalid', message: 'the file is not valid JSON' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { state: 'invalid', message: 'the file must contain one JSON object' };
  const g = (j as Record<string, unknown>).repositoryBroker; if (g === undefined || g === null) return { state: 'disabled' };
  if (typeof g !== 'object' || Array.isArray(g)) return { state: 'invalid', message: '"repositoryBroker" must be an object' };
  const o = g as Record<string, unknown>; if (o.enabled === false || o.enabled === undefined) return { state: 'disabled' }; if (o.enabled !== true) return { state: 'invalid', message: '"enabled" must be true or false' };
  const url = normalizeRelayUrl(o.url); if (!url) return { state: 'invalid', message: '"url" must be the https address of the repository access service (http only for localhost) without credentials, query or hash' };
  return { state: 'enabled', config: { url } };
}
export const brokerConfigUrl = (pageUrl: string): string | null => deployedFileUrl(pageUrl, BROKER_CONFIG_RELATIVE_PATH);
/** Reads the administrator's deployment setting. Anything but a valid, enabled file means "central access is not used" (never an error for the user); an INVALID file is reported. */
export async function fetchBrokerConfig(d: { pageUrl?: string; fetchFn?: typeof fetch; timeoutMs?: number } = {}): Promise<BrokerConfigState> {
  const pageUrl = d.pageUrl ?? (typeof location !== 'undefined' ? location.href : ''); const url = brokerConfigUrl(pageUrl); if (!url) return { state: 'disabled' };
  const f: typeof fetch = d.fetchFn ?? ((u, i) => globalThis.fetch(u, i)); const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), d.timeoutMs ?? 5000);
  try { const r = await f(url, { method: 'GET', cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: ctl.signal }); if (!r.ok) return { state: 'disabled' };
    const text = await r.text(); if (text.length > MAX_BROKER_CONFIG_BYTES || looksLikeHtml(text)) return { state: 'disabled' }; return parseBrokerConfig(text);
  } catch { return { state: 'disabled' }; } finally { clearTimeout(tm); }
}

// ───────────────────────────── the session (broker-signed, short-lived, not a GitHub credential) ─────────────────────────────
export interface BrokerSession { token: string; expiresAt: number; login: string; canWrite: boolean; /** broker address and "owner/repo" the sign-in proved access to */ broker: string; repo: string; }
export interface SessionBackend { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; }
export const SESSION_STORAGE_KEY = 'sqla.repoaccess.session.v1762';
const SKEW_MS = 60_000;
const memoryBackend = (): SessionBackend => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }; };
export function defaultSessionBackend(): SessionBackend { try { if (typeof sessionStorage !== 'undefined') { const k = '__sqla_probe__'; sessionStorage.setItem(k, '1'); sessionStorage.removeItem(k); return sessionStorage; } } catch { /* storage blocked */ } return memoryBackend(); }
export class BrokerSessionStore {
  constructor(private backend: SessionBackend = defaultSessionBackend(), private now: () => number = () => Date.now()) {}
  /** The stored session when it is still valid AND belongs to this broker and this repository; otherwise null (an unusable record is removed). */
  get(broker: string, repo: string): BrokerSession | null {
    let raw: string | null = null; try { raw = this.backend.getItem(SESSION_STORAGE_KEY); } catch { return null; } if (!raw) return null;
    try { const s = JSON.parse(raw) as Partial<BrokerSession>;
      if (s && typeof s.token === 'string' && /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s.token) && typeof s.expiresAt === 'number' && s.expiresAt - SKEW_MS > this.now() && s.broker === broker && String(s.repo || '').toLowerCase() === repo.toLowerCase() && typeof s.login === 'string') return { token: s.token, expiresAt: s.expiresAt, login: s.login, canWrite: s.canWrite === true, broker, repo: s.repo as string };
    } catch { /* fall through */ }
    this.clear(); return null;
  }
  set(s: BrokerSession): void { try { this.backend.setItem(SESSION_STORAGE_KEY, JSON.stringify(s)); } catch { /* storage full or blocked: the session then only lasts for this call chain */ } }
  clear(): void { try { this.backend.removeItem(SESSION_STORAGE_KEY); } catch { /* */ } }
}

// ───────────────────────────── talking to the broker ─────────────────────────────
type Json = Record<string, unknown>;
/** What each error code of the broker means for the user. None of them contains a secret, an address or a path. */
const CODE: Record<string, { kind: RepositoryErrorKind; message: string }> = {
  'session-required': { kind: 'signin', message: 'Repository access needs a GitHub sign-in: none is active on this browser.' },
  'session-invalid': { kind: 'signin', message: 'The repository access sign-in is no longer valid. Sign in again.' },
  'session-expired': { kind: 'signin', message: 'The repository access sign-in expired. Sign in again.' },
  'pat-missing': { kind: 'pat-missing', message: 'The central repository access is not set up: the access service has no GitHub PAT (the GitHub Actions secret SQLA_GITHUB_PAT was not delivered to it). An administrator must configure it.' },
  'pat-rejected': { kind: 'pat-rejected', message: 'GitHub rejected the central PAT: it is invalid, expired or revoked. An administrator must replace the GitHub Actions secret SQLA_GITHUB_PAT.' },
  'pat-insufficient': { kind: 'pat-insufficient', message: 'The central PAT is not allowed to do this on the repository: it needs Contents: Read and write on it, and — for an organization that uses SSO — authorization for the organization. An administrator must fix the PAT.' },
  'repository-unavailable': { kind: 'pat-insufficient', message: 'The central PAT cannot see the configured repository (wrong repository name, or the PAT was not granted access to it). An administrator must check the repository configuration and the PAT.' },
  'write-not-permitted': { kind: 'permission', message: 'Your GitHub account has read-only access to the repository, so it cannot publish or push. Ask the repository owner for write access.' },
  'repository-not-allowed': { kind: 'config', message: 'The repository access service is not set up for the configured repository (or your sign-in belongs to another repository). An administrator must add it to SQLA_ALLOWED_REPOSITORIES; then sign in again.' },
  'origin-not-allowed': { kind: 'config', message: 'The repository access service does not accept requests from this page\'s address. An administrator must add it to SQLA_ALLOWED_ORIGINS.' },
  'conflict': { kind: 'conflict', message: 'the file changed on the server — synchronize again.' },
  'rate-limited': { kind: 'permission', message: 'GitHub or the repository access service is limiting requests. Wait a few minutes and try again.' },
  'upstream-timeout': { kind: 'timeout', message: 'GitHub did not answer the repository access service in time.' },
  'upstream-unreachable': { kind: 'network', message: 'The repository access service could not reach GitHub.' },
  'too-large': { kind: 'http', message: 'the file is larger than the repository access service allows.' },
  'secret-in-content': { kind: 'http', message: 'the repository access service refused the file because it appears to contain a token or key in readable form. Nothing was written.' },
  'not-json': { kind: 'http', message: 'the repository access service accepts only JSON files. Nothing was written.' },
  'credential-record-invalid': { kind: 'http', message: 'the repository access service refused the Admin Password record because it is not an encrypted verification marker in the expected format. Nothing was written.' },
  'not-a-file': { kind: 'http', message: 'the repository path is not a file.' },
  'bad-request': { kind: 'config', message: 'the repository access service refused the request (repository, branch or file path is not an allowed value).' },
};
export const brokerError = (code: unknown, status = 0, what = 'The request'): RepositoryError => { const c = typeof code === 'string' ? CODE[code] : undefined; return new RepositoryError(c ? `${what} failed: ${c.message}` : `${what} failed: the repository access service answered HTTP ${status || 'error'}.`, c ? c.kind : 'http', status || undefined); };

interface BrokerCall { url: string; fetchFn?: typeof fetch; timeoutMs?: number; signal?: AbortSignal; }
async function call(c: BrokerCall, method: string, path: string, opt: { session?: string; body?: Json } = {}): Promise<{ status: number; json: Json }> {
  const f: typeof fetch = c.fetchFn ?? ((u, i) => globalThis.fetch(u, i)); const ms = c.timeoutMs ?? getRepositoryTimeoutMs(); const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms); const onAbort = () => ctl.abort(); c.signal?.addEventListener('abort', onAbort);
  try {
    const r = await f(`${c.url}${path}`, { method, cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json', ...(opt.body ? { 'Content-Type': 'application/json' } : {}), ...(opt.session ? { Authorization: `Bearer ${opt.session}` } : {}) }, ...(opt.body ? { body: JSON.stringify(opt.body) } : {}), signal: ctl.signal });
    const text = await r.text(); if (looksLikeHtml(text)) throw new RepositoryError('The repository access service gave an unexpected answer (a web page instead of a response). An administrator must check the address in repo-broker.config.json.', 'http', r.status);
    let j: unknown = {}; if (text) { try { j = JSON.parse(text); } catch { throw new RepositoryError('The repository access service gave an unexpected answer (not JSON).', 'http', r.status); } }
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new RepositoryError('The repository access service gave an unexpected answer.', 'http', r.status);
    return { status: r.status, json: j as Json };
  } catch (e) {
    if (e instanceof RepositoryError) throw e;
    if (c.signal?.aborted) throw new RepositoryError('Cancelled.', 'network'); if ((e as Error)?.name === 'AbortError') throw new RepositoryError(`The repository access service did not answer within ${Math.round(ms / 1000)} seconds.`, 'timeout');
    throw new RepositoryError('The repository access service could not be reached. Check the network connection (or ask an administrator whether the service is running).', 'network');
  } finally { clearTimeout(tm); c.signal?.removeEventListener('abort', onAbort); }
}

export interface BrokerRepoInput extends BrokerCall { owner: string; repo: string; branch: string; /** the current session (null = none) */ session: () => BrokerSession | null; /** called when the broker says the session is no longer valid, so it can be dropped */ onSessionRejected?: () => void; }
const SAFE_NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const q = (i: BrokerRepoInput, path: string, branch = true) => `owner=${encodeURIComponent(i.owner)}&repo=${encodeURIComponent(i.repo)}${branch ? `&branch=${encodeURIComponent(i.branch || 'main')}` : ''}&path=${encodeURIComponent(path)}`;
const sessionOf = (i: BrokerRepoInput): string => { const s = i.session(); if (!s) throw brokerError('session-required', 401); return s.token; };
const guardLocation = (i: BrokerRepoInput) => { if (!SAFE_NAME.test(i.owner || '') || !SAFE_NAME.test(i.repo || '') || !(i.branch || 'main').trim() || /[\s?#]/.test(i.branch || '')) throw new RepositoryError('The repository is not configured correctly: owner and repository may contain only letters, digits, "-", "_" and "." — check the GitHub repository card under Schema → Pull Schema.', 'config'); };
/** A SchemaRepository that reads and writes through the broker. Same contract as githubRepository(): read → null when the file does not exist; typed RepositoryError for everything else. */
export function brokerRepository(i: BrokerRepoInput): SchemaRepository {
  const answer = (what: string, status: number, j: Json): never => { if (status === 401) i.onSessionRejected?.(); throw brokerError(j.error, status, what); };
  return {
    describe: `${i.owner}/${i.repo}@${i.branch} (via the central repository access service)`,
    async read(path: string): Promise<RepoFile | null> {
      guardLocation(i); const { status, json } = await call(i, 'GET', `/v1/contents?${q(i, path)}`, { session: sessionOf(i) });
      if (status === 404 && json.error === 'not-found') return null; if (status !== 200) return answer(`Reading ${path}`, status, json);
      if (typeof json.text !== 'string' || typeof json.sha !== 'string') throw new RepositoryError(`Reading ${path} failed: the repository access service gave an incomplete answer.`, 'http', status); return { text: json.text, sha: json.sha };
    },
    async write(path: string, text: string, sha: string | null, message: string): Promise<string> {
      guardLocation(i); const { status, json } = await call(i, 'PUT', '/v1/contents', { session: sessionOf(i), body: { owner: i.owner, repo: i.repo, branch: i.branch || 'main', path, text, sha, message } });
      if (status !== 200) return answer(`Writing ${path}`, status, json); return typeof json.sha === 'string' ? json.sha : '';
    },
  };
}
/** The administrator's live check of a repository location, through the broker (replaces checkRepositoryLocation when the page uses central access). */
export async function brokerCheckLocation(i: BrokerRepoInput & { path: string }): Promise<LocationCheck> {
  try {
    guardLocation(i); const { status, json } = await call(i, 'POST', '/v1/check', { session: sessionOf(i), body: { owner: i.owner, repo: i.repo, branch: i.branch || 'main', path: i.path } });
    if (status === 200 && json.ok === true) return json.fileExists ? { ok: true, fileExists: true, message: 'Repository, branch and schema file verified (through the central repository access service).' } : { ok: true, fileExists: false, message: 'Repository and branch verified. The schema file does not exist there yet — the first publication will create it.' };
    if (status === 200 && json.error === 'repository-not-found') return { ok: false, kind: 'not-found', message: 'The repository was not found. Check owner and repository name, and that the central PAT may read it.' };
    if (status === 200 && json.error === 'branch-not-found') return { ok: false, kind: 'branch', message: 'The branch was not found in this repository.' };
    if (status === 401) i.onSessionRejected?.(); const e = brokerError(json.error, status, 'Verifying the location'); return { ok: false, kind: e.kind, message: e.message };
  } catch (e) { const k = (e as RepositoryError).kind || 'http'; return { ok: false, kind: k, message: (e as Error).message }; }
}
export type PatState = 'ok' | 'missing' | 'rejected' | 'insufficient' | 'rate-limited' | 'unreachable';
export type BrokerStatus = { ok: true; pat: PatState; canWrite: boolean | null; expiresAt: string | null; expiresInDays: number | null; message: string; warn: boolean } | { ok: false; kind: RepositoryErrorKind; message: string };
const PAT_TEXT: Record<PatState, string> = { ok: 'The central PAT is configured and GitHub accepts it for this repository.', missing: CODE['pat-missing'].message, rejected: CODE['pat-rejected'].message, insufficient: CODE['pat-insufficient'].message, 'rate-limited': 'GitHub is rate-limiting the central PAT right now. Try again in a few minutes.', unreachable: 'The repository access service could not reach GitHub to check the central PAT.' };
/** What the central PAT looks like from the service's point of view — a state and, when GitHub reports it, the expiry date. Never the PAT. */
export async function brokerStatus(i: BrokerRepoInput): Promise<BrokerStatus> {
  try {
    guardLocation(i); const { status, json } = await call(i, 'GET', `/v1/status?owner=${encodeURIComponent(i.owner)}&repo=${encodeURIComponent(i.repo)}`, { session: sessionOf(i) });
    if (status !== 200) { if (status === 401) i.onSessionRejected?.(); const e = brokerError(json.error, status, 'Checking the central PAT'); return { ok: false, kind: e.kind, message: e.message }; }
    const pat = (['ok', 'missing', 'rejected', 'insufficient', 'rate-limited', 'unreachable'] as string[]).includes(String(json.pat)) ? (json.pat as PatState) : 'unreachable';
    const days = typeof json.expiresInDays === 'number' ? json.expiresInDays : null; const expiresAt = typeof json.expiresAt === 'string' ? json.expiresAt : null; const soon = pat === 'ok' && days !== null && days <= 14;
    return { ok: true, pat, canWrite: typeof json.canWrite === 'boolean' ? json.canWrite : null, expiresAt, expiresInDays: days, warn: pat !== 'ok' || soon, message: soon ? `${PAT_TEXT.ok} It expires in ${Math.max(days!, 0)} day(s) — an administrator should replace the GitHub Actions secret SQLA_GITHUB_PAT before then.` : PAT_TEXT[pat] };
  } catch (e) { return { ok: false, kind: (e as RepositoryError).kind || 'http', message: (e as Error).message }; }
}

// ───────────────────────────── sign-in (device flow run by the broker) ─────────────────────────────
export type SignInFailure = 'unreachable' | 'invalid-answer' | 'timeout' | 'device-flow-disabled' | 'client-rejected' | 'denied' | 'expired' | 'cancelled' | 'no-access' | 'repository-not-allowed' | 'origin-not-allowed' | 'rate-limited' | 'unexpected';
export const SIGN_IN_MESSAGES: Record<SignInFailure, string> = {
  'unreachable': 'The repository access service could not be reached. Check the network connection and try again. Nothing was changed.',
  'invalid-answer': 'The repository access service gave an unexpected answer. Ask an administrator to check the address in repo-broker.config.json. Nothing was changed.',
  'timeout': 'The repository access service did not answer in time. Try again. Nothing was changed.',
  'device-flow-disabled': 'GitHub sign-in is not enabled for the application the service uses (the device flow is switched off). An administrator must enable it. Nothing was changed.',
  'client-rejected': 'GitHub did not accept the sign-in client ID configured in the repository access service. An administrator must check SQLA_GITHUB_CLIENT_ID. Nothing was changed.',
  'denied': 'The sign-in was not approved on GitHub, so repository access was not authorized. Select it again to retry. Nothing was changed.',
  'expired': 'The sign-in code expired before it was approved. Start the sign-in again for a new code. Nothing was changed.',
  'cancelled': 'Sign-in cancelled. Nothing was changed.',
  'no-access': 'The GitHub account you signed in with cannot read the configured repository (it is not a member, the organization\'s SSO has not authorized it, or the GitHub App is not installed on the repository). Ask the repository owner for access. Nothing was changed.',
  'repository-not-allowed': CODE['repository-not-allowed'].message,
  'origin-not-allowed': CODE['origin-not-allowed'].message,
  'rate-limited': 'The repository access service is limiting requests. Wait a few minutes and try again. Nothing was changed.',
  'unexpected': 'The GitHub sign-in could not be completed (unexpected answer). Try again. Nothing was changed.',
};
export interface BrokerSignInCode { userCode: string; verificationUri: string; expiresInSec: number; intervalSec: number; }
export type BrokerSignInResult = { ok: true; session: BrokerSession } | { ok: false; kind: SignInFailure; message: string };
export interface BrokerSignInDeps { fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number; requestTimeoutMs?: number; maxWaitMs?: number; signal?: AbortSignal; }
const failure = (kind: SignInFailure): BrokerSignInResult => ({ ok: false, kind, message: SIGN_IN_MESSAGES[kind] });
const fromError = (e: unknown): SignInFailure => { const k = (e as RepositoryError)?.kind; return k === 'timeout' ? 'timeout' : k === 'network' ? ((e as Error).message === 'Cancelled.' ? 'cancelled' : 'unreachable') : 'invalid-answer'; };
const fromCode = (c: unknown): SignInFailure => c === 'device-flow-disabled' ? 'device-flow-disabled' : c === 'client-rejected' ? 'client-rejected' : c === 'repository-not-allowed' ? 'repository-not-allowed' : c === 'origin-not-allowed' ? 'origin-not-allowed' : c === 'rate-limited' ? 'rate-limited' : c === 'upstream-timeout' ? 'timeout' : c === 'upstream-unreachable' ? 'unreachable' : 'unexpected';
/** Starts the broker's device flow, hands the user code (and the verified github.com address) to `onCode`, then polls until the user approves, denies, the code expires or the flow is cancelled. The returned session is a broker session — not a GitHub token. */
export async function runBrokerSignIn(i: { url: string; owner: string; repo: string }, onCode: (c: BrokerSignInCode) => void, d: BrokerSignInDeps = {}): Promise<BrokerSignInResult> {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))); const now = d.now ?? (() => Date.now()); const c: BrokerCall = { url: i.url, fetchFn: d.fetchFn, timeoutMs: d.requestTimeoutMs ?? 12_000, signal: d.signal };
  if (d.signal?.aborted) return failure('cancelled');
  let start: { status: number; json: Json }; try { start = await call(c, 'POST', '/v1/auth/start', { body: {} }); } catch (e) { return failure(fromError(e)); }
  if (start.status !== 200) return failure(fromCode(start.json.error));
  const handle = start.json.handle; const uc = start.json.userCode; const vu = safeVerificationUri(start.json.verificationUri);
  if (typeof handle !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(handle) || typeof uc !== 'string' || !/^[A-Za-z0-9-]{4,24}$/.test(uc) || !vu) return failure('invalid-answer');
  const expires = Math.min(Math.max(Number(start.json.expiresIn) || 900, 30), 1800); let interval = Math.min(Math.max(Number(start.json.interval) || 5, 1), 30); const deadline = now() + Math.min(expires * 1000, d.maxWaitMs ?? 15 * 60_000);
  onCode({ userCode: uc, verificationUri: vu, expiresInSec: expires, intervalSec: interval });
  for (;;) {
    await sleep(interval * 1000); if (d.signal?.aborted) return failure('cancelled'); if (now() >= deadline) return failure('expired');
    let p: { status: number; json: Json }; try { p = await call(c, 'POST', '/v1/auth/poll', { body: { handle, owner: i.owner, repo: i.repo } }); } catch (e) { const k = fromError(e); if (k === 'cancelled') return failure('cancelled'); if (k === 'invalid-answer') return failure(k); if (now() >= deadline) return failure('expired'); continue; } // one network hiccup while polling is retried until the code expires
    if (p.status === 429) return failure('rate-limited'); if (p.status !== 200) return failure(fromCode(p.json.error));
    const st = p.json.status;
    if (st === 'pending') { const n = Number(p.json.interval); if (n > 0) interval = Math.min(Math.max(n, 1), 60); continue; }
    if (st === 'ok') { const s = p.json.session; const exp = Number(p.json.expiresAt); if (typeof s !== 'string' || !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s) || !(exp > now()) || typeof p.json.login !== 'string') return failure('invalid-answer'); return { ok: true, session: { token: s, expiresAt: exp, login: String(p.json.login), canWrite: p.json.canWrite === true, broker: i.url, repo: `${i.owner}/${i.repo}` } }; }
    if (st === 'denied') return failure('denied'); if (st === 'expired') return failure('expired'); if (st === 'no-access') return failure('no-access'); return failure('unexpected');
  }
}
