/**
 * V17.7.3 / V17.7.4 — USAGE ANALYTICS at run time: the one place that connects the deployed configuration, the usage tracker and the administrator session to the page.
 *
 * Optional by construction. Nothing here can stop SQL Assistant: start-up is fire-and-forget, every exported function swallows its own failures, and when analytics is disabled, unconfigured, invalid or the
 * service is down the tracking functions are silent no-ops and the Analytics page only explains why it is unavailable.
 *
 * The administrator session: the token returned by the analytics service after a correct password lives in this module's memory ONLY (no storage, no URL, no log). It is dropped by Lock Analytics, after
 * the inactivity period (analytics.adminSessionTimeout, never longer than the service's own idle limit), when the page is left or reloaded, when the service says it is no longer valid, and when the
 * password was changed. Nothing about the dashboard is cached after a lock.
 *
 * V17.7.4: two providers behind the same functions. "service" (V17.7.3): the analytics service checks the password and computes the numbers. "repository" (no server): telemetry is ENCRYPTED on the device and written
 * to the repository; the administrator's password unwraps the private key IN MEMORY (analyticsRepo.ts / analyticsCrypto.ts), the dashboard decrypts and aggregates in memory, and Lock Analytics drops the keys, the
 * decrypted data and the file cache. The password is used once per action and never kept.
 */
import { fetchAnalyticsConfig, type AnalyticsConfigState } from '../v17/services/analyticsConfig';
import { AnalyticsTracker, ServiceTelemetrySink, attachBrowserListeners, sanitizeLabel, type TelemetrySink } from '../v17/services/analyticsTracker';
import { AnalyticsAdminClient, ADMIN_MESSAGES, type AdminResult, type AnalyticsSummary, type LoginOk } from '../v17/services/analyticsAdmin';
import { browserStore } from '../services/storage';
import { brokerSession, repository, secrets, brokerEnabled, hasRepositoryOverride } from './context'; import { store } from './state';
import { RepositoryTelemetrySink, repoIOFrom, unlockAnalyticsRepo, loadSummaryRepo, changePasswordRepo, rotateKeysRepo, setupAnalyticsRepo, compactRepo, publishPublicKeyRepo, REPO_MESSAGES, type RepoSession, type RepoResult, type LoadInfo, type CompactionReport, type PinSnippet } from '../v17/services/analyticsRepo';
import { validatePublicKeyRecord } from '../v17/services/analyticsCrypto';

let repoSession: RepoSession | null = null; let lastLoadInfo: LoadInfo | null = null; let repoSink: RepositoryTelemetrySink | null = null;
let cfg: AnalyticsConfigState = { state: 'unknown' }; let tracker: AnalyticsTracker | null = null; let detach: (() => void) | null = null; let client: AnalyticsAdminClient | null = null; let started = false;
interface AdminSession { token: string; lockAfterMs: number; managed: boolean; startedAt: number }
let session: AdminSession | null = null; let lastActivity = 0; let idleTimer: ReturnType<typeof setInterval> | null = null; let detachIdle: (() => void) | null = null;
const listeners = new Set<() => void>(); const emit = (): void => { [...listeners].forEach((l) => { try { l(); } catch { /* a listener never breaks analytics */ } }); };
export const onAnalyticsChange = (fn: () => void): (() => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export const analyticsConfigState = (): AnalyticsConfigState => cfg;
/** which provider this deployment uses (null while analytics is off) */
export const analyticsProvider = (): 'service' | 'repository' | null => (cfg.state === 'enabled' ? cfg.config.provider : null);
/** the application's ONE repository connection, as the analytics provider needs it — null when this device has none (no token, no override, no central access): analytics then queues and the dashboard says so */
function analyticsIO() { if (!secrets.githubToken && !brokerEnabled() && !hasRepositoryOverride()) return null; return repoIOFrom(repository()); }
const retentionDays = (): number => (cfg.state === 'enabled' && cfg.config.provider === 'repository' ? cfg.config.retentionDays : 400);
const repoBase = (): string => (cfg.state === 'enabled' && cfg.config.provider === 'repository' ? cfg.config.repositoryPath : '');
export type Availability = { kind: 'ready'; message: string } | { kind: 'unknown' | 'disabled' | 'invalid' | 'auth-off'; message: string };
/** What the Analytics page may tell an ordinary user about this deployment (never a secret; the configuration file is public anyway). */
export function analyticsAvailability(): Availability {
  if (cfg.state === 'unknown') return { kind: 'unknown', message: 'Analytics is still starting. Try again in a moment.' };
  if (cfg.state === 'invalid') return { kind: 'invalid', message: `The analytics configuration is not valid (${cfg.message}). Analytics is switched off until an administrator corrects it. SQL Assistant itself is not affected.` };
  if (cfg.state === 'disabled') return { kind: 'disabled', message: 'Usage Analytics is not enabled in this deployment.' };
  if (!cfg.config.adminAuthenticationEnabled) return { kind: 'auth-off', message: 'Administrator authentication is switched off in this deployment (analytics.adminAuthenticationEnabled), so the Analytics dashboard is not available. Usage is still collected.' };
  return { kind: 'ready', message: '' };
}
const mono = (): number => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/** Reads the deployed configuration and, when analytics is enabled, starts measuring. Never throws, never waits for the service. */
export async function startAnalytics(d: { fetchFn?: typeof fetch } = {}): Promise<void> {
  try {
    if (started) return; started = true; cfg = await fetchAnalyticsConfig({ fetchFn: d.fetchFn }); if (cfg.state !== 'enabled') { emit(); return; }
    const c = cfg.config; let sink: TelemetrySink;
    if (c.provider === 'repository') {
      let pinned = null; if (c.publicKey) { pinned = await validatePublicKeyRecord({ kid: c.publicKey.kid, alg: 'ECDH-P256', jwk: c.publicKey.jwk }); if (!pinned) { cfg = { state: 'invalid', message: 'analytics.publicKey is not a valid key (its id does not match the key)' }; emit(); return; } }
      repoSink = new RepositoryTelemetrySink({ io: analyticsIO, base: c.repositoryPath, pinned }); sink = repoSink;
    } else {
      client = new AnalyticsAdminClient(c.serviceUrl, d.fetchFn); const beacon = (u: string, b: Blob): boolean => (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' ? navigator.sendBeacon(u, b) : false);
      sink = new ServiceTelemetrySink(c.serviceUrl, d.fetchFn, beacon);
    }
    // a repository commit per batch: send every 5 minutes (or at 50 queued events), never sooner than 2 minutes after the last send, and once when the page is left
    const cadence = c.provider === 'repository' ? { flushEveryMs: 5 * 60_000, flushAtCount: 50, minFlushGapMs: 2 * 60_000 } : {};
    tracker = new AnalyticsTracker({ config: c, sink, store: browserStore(), mono, wall: () => Date.now(), identity: () => sanitizeLabel(brokerSession()?.login), ...cadence });
    detach = attachBrowserListeners(tracker, { document, window, setInterval: (f, ms) => window.setInterval(f, ms), clearInterval: (h) => window.clearInterval(h as number) });
    emit();
  } catch { tracker = null; }
}
/** Re-reads the configuration (the Analytics page does this when it is opened and analytics is not running, so a transient start-up failure does not stick). */
export async function refreshAnalyticsConfig(): Promise<AnalyticsConfigState> { try { if (cfg.state === 'enabled') return cfg; const next = await fetchAnalyticsConfig(); const was = cfg.state; cfg = next; if (next.state === 'enabled' && !tracker) { started = false; await startAnalytics(); } else if (was !== next.state) emit(); } catch { /* */ } return cfg; }
export function trackFeature(f: string): void { try { tracker?.feature(f); } catch { /* */ } }
export function trackGeneration(kind: string, ok: boolean, needsReview = false): void { try { tracker?.generation(kind, ok, needsReview); } catch { /* */ } }
/** counters only — no event content (for tests and the Analytics page footer) */
export function trackerStats(): ReturnType<AnalyticsTracker['stats']> | null { return tracker ? tracker.stats() : null; }

// ───────────────────────────────────────────────────────────── the administrator session (memory only)
export const isAnalyticsUnlocked = (): boolean => !!session;
export const analyticsLockSeconds = (): number => (session ? Math.round(session.lockAfterMs / 1000) : 0);
export const analyticsPasswordManaged = (): boolean => !!session && session.managed;
/** what the last dashboard load read (files, events, damaged files, keys) — counters only, repository provider */
export const analyticsLoadInfo = (): LoadInfo | null => lastLoadInfo;
const touch = (): void => { lastActivity = Date.now(); };
function checkIdle(): void { if (session && Date.now() - lastActivity > session.lockAfterMs) lockAnalytics('idle'); }
function armIdle(): void {
  disarmIdle(); touch(); const evs = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll', 'input']; const on = (): void => touch(); const vis = (): void => { if (document.visibilityState === 'visible') checkIdle(); };
  evs.forEach((t) => document.addEventListener(t, on, { capture: true, passive: true })); document.addEventListener('visibilitychange', vis); const hide = (): void => { lockAnalytics('hide'); }; window.addEventListener('pagehide', hide);
  idleTimer = setInterval(checkIdle, 1000); detachIdle = () => { evs.forEach((t) => document.removeEventListener(t, on, { capture: true } as EventListenerOptions)); document.removeEventListener('visibilitychange', vis); window.removeEventListener('pagehide', hide); };
}
function disarmIdle(): void { if (idleTimer) { clearInterval(idleTimer); idleTimer = null; } if (detachIdle) { detachIdle(); detachIdle = null; } }
export type LockReason = 'manual' | 'idle' | 'expired' | 'password-changed' | 'hide';
export const LOCK_MESSAGES: Record<LockReason, string> = { manual: 'Analytics locked.', idle: 'Analytics locked automatically after inactivity.', expired: 'The administrator session ended. Unlock Analytics again.', 'password-changed': 'The administrator password was changed. Unlock Analytics with the new password.', hide: '' };
let lastLock: LockReason | null = null; export const lastLockReason = (): LockReason | null => lastLock;
/** Drops the session (and tells the service to revoke it, best effort). Safe to call at any time. */
export function lockAnalytics(reason: LockReason = 'manual'): void {
  try { const s = session; session = null; repoSession = null; lastLoadInfo = null; disarmIdle(); lastLock = s ? reason : lastLock; if (s && client) void client.logout(s.token, { keepalive: reason === 'hide' }); if (s) { emit(); if ((reason === 'idle' || reason === 'expired') && LOCK_MESSAGES[reason]) store.pushToast('info', LOCK_MESSAGES[reason]); } } catch { session = null; }
}
/** Checks the password with the analytics service. On success the session lives in memory; the password is not kept. */
export async function unlockAnalytics(password: string): Promise<AdminResult<Record<string, unknown>>> {
  const a = analyticsAvailability(); if (a.kind !== 'ready' || cfg.state !== 'enabled' || (cfg.config.provider === 'service' && !client)) return { ok: false, kind: 'unreachable', message: a.message || ADMIN_MESSAGES.unreachable };
  if (cfg.config.provider === 'repository') {
    let u: RepoResult<{ session: RepoSession }>; try { u = await unlockAnalyticsRepo(analyticsIO(), repoBase(), password); } catch { return { ok: false, kind: 'unexpected', message: ADMIN_MESSAGES.unexpected }; }
    if (!u.ok) return repoFailure(u); repoSession = u.session; session = { token: '', lockAfterMs: cfg.config.adminSessionTimeout * 1000, managed: false, startedAt: Date.now() }; lastLock = null; armIdle(); emit(); return { ok: true };
  }
  if (!client) return { ok: false, kind: 'unreachable', message: ADMIN_MESSAGES.unreachable };
  let r: AdminResult<LoginOk>; try { r = await client.login(password); } catch { return { ok: false, kind: 'unexpected', message: ADMIN_MESSAGES.unexpected }; }
  if (!r.ok) return r; const idle = Math.min(cfg.config.adminSessionTimeout, r.idleSeconds) * 1000; session = { token: r.token, lockAfterMs: idle, managed: r.passwordManagedExternally, startedAt: Date.now() }; lastLock = null; armIdle(); emit(); return { ok: true };
}
/** The dashboard numbers for a date range (inclusive, UTC days). A refused session locks Analytics. */
export async function fetchAnalyticsSummary(from: string, to: string): Promise<AdminResult<{ data: AnalyticsSummary }>> {
  if (repoSession && session) { const rs = repoSession; let r: RepoResult<{ data: AnalyticsSummary; info: LoadInfo }>; try { r = await loadSummaryRepo(rs, from, to, Date.now(), retentionDays()); } catch { return { ok: false, kind: 'unexpected', message: ADMIN_MESSAGES.unexpected }; } if (!r.ok) return repoFailure(r); if (repoSession === rs) lastLoadInfo = r.info; touch(); return { ok: true, data: r.data }; }
  const s = session; if (!s || !client) return { ok: false, kind: 'session', message: ADMIN_MESSAGES.session };
  let r; try { r = await client.summary(s.token, from, to); } catch { return { ok: false, kind: 'unexpected', message: ADMIN_MESSAGES.unexpected }; }
  if (!r.ok && r.kind === 'session') lockAnalytics('expired'); else touch(); return r;
}
export async function changeAnalyticsPassword(current: string, next: string): Promise<AdminResult<Record<string, unknown>>> {
  if (repoSession && session) { let r: RepoResult<{ changed: true }>; try { r = await changePasswordRepo(repoSession, current, next); } catch { return { ok: false, kind: 'unexpected', message: ADMIN_MESSAGES.unexpected }; } if (!r.ok) return repoFailure(r); session = null; repoSession = null; lastLoadInfo = null; disarmIdle(); lastLock = 'password-changed'; emit(); return { ok: true }; }
  const s = session; if (!s || !client) return { ok: false, kind: 'session', message: ADMIN_MESSAGES.session };
  let r; try { r = await client.changePassword(s.token, current, next); } catch { return { ok: false, kind: 'unexpected', message: ADMIN_MESSAGES.unexpected }; }
  if (r.ok) { session = null; disarmIdle(); lastLock = 'password-changed'; emit(); } else if (r.kind === 'session') lockAnalytics('expired'); else touch(); return r;
}
// ───────────────────────────────────────────────────────────── V17.7.4: the administration actions of the repository provider
/** a repository failure as the page's AdminResult: a wrong password is EXACTLY "Invalid administrator password"; everything else says what to do; `detail` carries the precise reason (for example "not-set-up", "no-write") */
function repoFailure(r: { ok: false; kind: string; message: string }): AdminResult<never> {
  const kind = r.kind === 'invalid-password' ? 'invalid' : r.kind === 'not-set-up' ? 'not-set-up' : r.kind === 'weak-password' ? 'weak-password' : r.kind === 'unexpected' ? 'unexpected' : 'repository';
  return { ok: false, kind, message: r.kind === 'invalid-password' ? ADMIN_MESSAGES.invalid : r.message || REPO_MESSAGES.unexpected, detail: r.kind };
}
/** First-time set-up: writes the key file and the public key. The caller (the page) only offers it to an administrator whose Settings are unlocked; the repository's own write permission is the real gate. */
export async function setupAnalytics(password: string): Promise<AdminResult<{ pin: PinSnippet }>> {
  if (analyticsProvider() !== 'repository') return { ok: false, kind: 'unexpected', message: ADMIN_MESSAGES.unexpected };
  try { const r = await setupAnalyticsRepo(analyticsIO(), repoBase(), password); return r.ok ? { ok: true, pin: r.pin } : repoFailure(r); } catch { return { ok: false, kind: 'unexpected', message: ADMIN_MESSAGES.unexpected }; }
}
export async function rotateAnalyticsKeys(password: string): Promise<AdminResult<{ pin: PinSnippet }>> {
  if (!repoSession || !session) return { ok: false, kind: 'session', message: ADMIN_MESSAGES.session };
  try { const r = await rotateKeysRepo(repoSession, password); if (!r.ok) return repoFailure(r); repoSession = r.session; repoSink?.forgetKey(); touch(); return { ok: true, pin: r.pin }; } catch { return { ok: false, kind: 'unexpected', message: ADMIN_MESSAGES.unexpected }; }
}
export async function publishAnalyticsKey(): Promise<AdminResult<{ pin: PinSnippet }>> {
  if (!repoSession || !session) return { ok: false, kind: 'session', message: ADMIN_MESSAGES.session };
  try { const r = await publishPublicKeyRepo(repoSession); repoSink?.forgetKey(); touch(); return r.ok ? { ok: true, pin: r.pin } : repoFailure(r); } catch { return { ok: false, kind: 'unexpected', message: ADMIN_MESSAGES.unexpected }; }
}
export async function compactAnalytics(onProgress: (t: string) => void): Promise<AdminResult<{ report: CompactionReport }>> {
  if (!repoSession || !session) return { ok: false, kind: 'session', message: ADMIN_MESSAGES.session };
  try { const r = await compactRepo(repoSession, Date.now(), retentionDays(), onProgress); touch(); return r.ok ? { ok: true, report: r.report } : repoFailure(r); } catch { return { ok: false, kind: 'unexpected', message: ADMIN_MESSAGES.unexpected }; }
}
/** counters only (never keys, never data): how many keys are unlocked and which is current */
export function analyticsRepoInfo(): { keys: number; currentKid: string } | null { return repoSession ? { keys: repoSession.unlocked.keys.size, currentKid: repoSession.unlocked.current.kid } : null; }

/** Stops everything (used when the page is torn down in tests). */
export async function stopAnalytics(): Promise<void> { try { lockAnalytics('manual'); if (detach) { detach(); detach = null; } if (tracker) await tracker.stop(); } catch { /* */ } tracker = null; started = false; cfg = { state: 'unknown' }; }
