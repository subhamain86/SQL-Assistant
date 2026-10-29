/**
 * V17.7.1 — THE shared GitHub connection state. Before V17.7.1 nothing looked at GitHub until the user opened Schema → Pull Schema, so the Home page could say nothing true about the connection and a
 * saved token was only ever tried when a pull / sync was started. This module is the one place that
 *   · initialises the connection when SQL Assistant opens (main.ts → startGithubConnection()), without any page having to be opened;
 *   · reports the REAL state to every page that shows it (Home, GitHub Repository) — one state, no second copy of anything;
 *   · re-checks when — and only when — the repository location or the token on this device changed (context.ts → onSecretsChanged), or when the user asks (force).
 *
 * What it does NOT do (all deliberate, all tested):
 *   · it holds no token and no token store of its own: the token stays in the Secret Vault (secrets in context.ts); here only a one-way 32-bit fingerprint of it is remembered, to notice a change;
 *   · it never writes to the repository, never publishes, never pulls or merges anything on its own — start-up only VALIDATES (read-only requests: GitHub's repository lookup, or the central service's status);
 *   · it never starts the GitHub device sign-in by itself (that needs the user to approve on github.com) — it reports `signin-required` and the Home / GitHub Repository page offers the existing sign-in;
 *   · it never throws and never blocks start-up: every failure becomes a state with a message; unrelated features keep working;
 *   · it asks GitHub again only when something changed, the user asked, or the last answer is older than FRESH_MS; callers that arrive while a check runs share that one check.
 * Messages never contain the token (redactSecrets on everything that came from a network error).
 */
import { secrets, hasRepositoryOverride, brokerConfig, refreshBrokerConfig, brokerSession, brokerInput, publishedEnabled, publishedState, refreshPublished, services, onSecretsChanged } from './context';
import { validateTokenAccess } from '../v17/services/githubClient'; import { brokerStatus } from '../v17/services/repoBroker'; import { redactSecrets } from '../v17/errors/appErrors';

export type GithubState = 'idle' | 'checking' | 'connected' | 'published' | 'signin-required' | 'not-configured' | 'rejected' | 'no-access' | 'unreachable' | 'error';
export type GithubMode = 'token' | 'central' | 'published' | 'test' | 'none';
export interface GithubConn { state: GithubState; mode: GithubMode; /** what is the matter, in plain words (never a token) */ message: string; /** what the user can do about it ('' when nothing is needed) */ action: string; checkedAt: string | null; /** true / false when GitHub or the access service said whether this connection may write; null = unknown or not applicable */ canWrite: boolean | null; login: string | null; repo: string; }
export interface PullNote { kind: 'ok' | 'warn' | 'err' | 'running'; text: string; at: string | null; }
export const FRESH_MS = 5 * 60_000;
const IDLE: GithubConn = { state: 'idle', mode: 'none', message: 'The GitHub connection has not been checked yet.', action: '', checkedAt: null, canWrite: null, login: null, repo: '' };
let conn: GithubConn = { ...IDLE }; let pull: PullNote = { kind: 'ok', text: '', at: null }; let inflight: Promise<GithubConn> | null = null; let inflightSig = ''; let lastSig = ''; let lastAt = 0; let checks = 0; let watching = false;
const listeners = new Set<() => void>(); const emit = (): void => { [...listeners].forEach((l) => { try { l(); } catch { /* a listener must never break the connection check */ } }); };
export const githubConn = (): GithubConn => conn; export const githubPullNote = (): PullNote => pull; export const githubChecks = (): number => checks;
export function subscribeGithub(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
/** The result of the last schema pull (Home button or Pull Schema tab) — plain text, no token, shown on Home so it survives the page re-render a successful pull causes. */
export function setGithubPullNote(n: PullNote): void { pull = { ...n, text: String(n.text).slice(0, 300) }; emit(); }
const fnv = (s: string): string => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
/** What the check depends on. The token enters only as a one-way fingerprint. */
function signature(): string { return [secrets.githubOwner, secrets.githubRepo, secrets.githubBranch, secrets.githubToken ? fnv(secrets.githubToken) : '-', brokerConfig.state, brokerSession() ? 'session' : 'no-session', publishedState.state, hasRepositoryOverride() ? 'test' : ''].join('|'); }
/** Last successful synchronization with the repository on this device (schemas), or null. */
export function lastSyncAt(): string | null { try { const m = services().sync.meta(); return [m.lastPullAt, m.lastPushAt].filter((x): x is string => !!x).sort().pop() || null; } catch { return null; } }
const label = (): string => (secrets.githubOwner && secrets.githubRepo ? `${secrets.githubOwner}/${secrets.githubRepo}` : '');
const make = (p: Partial<GithubConn> & Pick<GithubConn, 'state' | 'mode' | 'message'>): GithubConn => ({ action: '', checkedAt: new Date().toISOString(), canWrite: null, login: null, repo: label(), ...p });

async function evaluate(): Promise<GithubConn> {
  if (hasRepositoryOverride()) return make({ state: 'connected', mode: 'test', message: 'A test repository stands in for GitHub.' });
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return make({ state: 'unreachable', mode: brokerConfig.state === 'enabled' ? 'central' : secrets.githubToken ? 'token' : 'none', message: 'This device is offline. SQL Assistant keeps working; GitHub is checked again when you are back online.', action: 'Reconnect, then select Check connection.' });
  if (brokerConfig.state === 'unknown') await refreshBrokerConfig();
  if (brokerConfig.state === 'invalid') return make({ state: 'error', mode: 'central', message: `The central repository access configuration is not valid (${brokerConfig.message}).`, action: 'Ask your administrator to correct sql-assistant-data/repo-broker.config.json.' });
  if (brokerConfig.state === 'enabled') {
    if (!secrets.githubOwner || !secrets.githubRepo) return make({ state: 'not-configured', mode: 'central', message: 'The repository is not configured.', action: 'An administrator can check the GitHub repository configuration.' });
    const s = brokerSession(); if (!s) return make({ state: 'signin-required', mode: 'central', message: 'Central repository access is available. A GitHub sign-in is needed once per browser session.', action: 'Select Sign in to GitHub.' });
    const inp = brokerInput(); if (!inp) return make({ state: 'error', mode: 'central', message: 'Central repository access is not available.', action: 'Reload the page; if it persists, ask your administrator.' });
    const st = await brokerStatus(inp);
    if (!st.ok) { const k = st.kind; return make({ state: k === 'signin' ? 'signin-required' : k === 'timeout' || k === 'network' ? 'unreachable' : 'error', mode: 'central', login: s.login, message: st.message, action: k === 'signin' ? 'Select Sign in to GitHub.' : k === 'timeout' || k === 'network' ? 'Check your network connection and select Check connection.' : 'An administrator must fix the central repository access service.' }); }
    if (st.pat !== 'ok') return make({ state: st.pat === 'rate-limited' || st.pat === 'unreachable' ? 'unreachable' : 'error', mode: 'central', login: s.login, message: st.message, action: st.pat === 'rate-limited' || st.pat === 'unreachable' ? 'Wait a few minutes, then select Check connection.' : 'An administrator must fix the central repository access (the GitHub PAT of the access service).' });
    return make({ state: 'connected', mode: 'central', login: s.login, canWrite: typeof st.canWrite === 'boolean' ? (st.canWrite && s.canWrite) : s.canWrite, message: st.message });
  }
  if (secrets.githubToken && secrets.githubOwner && secrets.githubRepo) {
    const t = await validateTokenAccess({ owner: secrets.githubOwner, repo: secrets.githubRepo, token: secrets.githubToken });
    const msg = redactSecrets(t.message, [secrets.githubToken]);
    if (t.state === 'ok') return make({ state: 'connected', mode: 'token', canWrite: t.canWrite, message: msg });
    if (t.state === 'rejected') return make({ state: 'rejected', mode: 'token', message: msg, action: 'Set a new access token in the GitHub repository card (Admin Password), or import it with Pull Secret Vault.' });
    if (t.state === 'no-access') return make({ state: 'no-access', mode: 'token', message: msg, action: 'Ask the repository owner to grant the token access (Contents: Read), or wait if the rate limit was reached.' });
    return make({ state: 'unreachable', mode: 'token', message: msg, action: 'Check your network connection and select Check connection.' });
  }
  if (publishedState.state === 'unknown') await refreshPublished();
  if (publishedEnabled()) return make({ state: 'published', mode: 'published', canWrite: false, message: 'Reading the published copy of the repository (read-only). No GitHub credential is needed for this.', action: 'To publish changes from this device, set the access token in the GitHub repository card.' });
  return make({ state: 'not-configured', mode: 'none', message: 'No GitHub access is set up on this device yet.', action: 'Open GitHub Repository and set the access token or import it with Pull Secret Vault (Admin Password / Vault passphrase). SQL Assistant works without it.' });
}

/**
 * Initialises / refreshes the connection state. Never throws, never writes. Without `force` the answer is reused when nothing relevant changed and it is younger than FRESH_MS.
 * Callers that arrive while a check runs receive that same check.
 */
export function initGithubConnection(opts: { force?: boolean } = {}): Promise<GithubConn> {
  // a check that is already running answers every caller — unless it started with inputs that have changed since (a token saved while it ran) and this caller insists: then it waits for that check and runs a fresh one
  if (inflight) { if (!opts.force || inflightSig === signature()) return inflight; return inflight.then(() => initGithubConnection(opts)); }
  const sig = signature(); if (!opts.force && conn.state !== 'idle' && conn.state !== 'checking' && sig === lastSig && Date.now() - lastAt < FRESH_MS) return Promise.resolve(conn);
  checks++; inflightSig = sig; conn = { ...conn, state: 'checking', message: 'Checking the GitHub connection…', action: '', repo: label() }; emit();
  inflight = (async (): Promise<GithubConn> => {
    let r: GithubConn;
    try { r = await evaluate(); } catch (err) { r = make({ state: 'error', mode: 'none', message: redactSecrets(`The GitHub connection could not be checked (${(err as Error)?.message || 'unexpected error'}).`, [secrets.githubToken]), action: 'Select Check connection to try again. SQL Assistant keeps working without GitHub.' }); }
    conn = r; lastSig = signature(); lastAt = Date.now(); return r;
  })().finally(() => { inflight = null; emit(); });
  return inflight;
}
/**
 * Start-up wiring (called once from boot()): the first check, plus a re-check whenever the token or the repository location on this device changes. The listener only asks for a check when the
 * signature really changed, so saving unrelated settings causes no GitHub request.
 */
export function startGithubConnection(): void {
  if (watching) return; watching = true;
  onSecretsChanged(() => { if (signature() !== lastSig) void initGithubConnection({ force: true }); });
  void initGithubConnection();
}
