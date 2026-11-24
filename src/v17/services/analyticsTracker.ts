/**
 * V17.7.3 — USAGE ANALYTICS: measuring actual active usage and sending usage METADATA to the analytics service.
 *
 * WHAT IS COLLECTED (and nothing else — the event builders below accept only these shapes, and the service refuses anything else, field by field):
 *   · session_start / session_end                       — a page session began / ended
 *   · active { ms }                                     — milliseconds of ACTIVE use (see ActivityMeter)
 *   · feature { f }                                     — one of the FEATURES below was opened / used (a fixed list of names, never a title or a text)
 *   · generation { k, ok, rv }                          — a SQL generation was requested: which builder (fixed list), whether it produced valid SQL, whether it was flagged for review
 *   · on every event: a random per-device id (stays the same across sessions, so a user is not counted again for every session), a random per-session id, the application version and — only when the deployment
 *     enabled analytics.collectUserIdentity and a GitHub sign-in exists — the GitHub login as a label.
 * NEVER collected: generated SQL, SQL the user typed, descriptions, query results, schema content, customer data, credentials, passwords, connection strings, the URL, the page text, the user agent.
 * There is no function in this file that takes free text; the only strings that can enter an event are the enumerations below, the application version and the sign-in label (charset-restricted).
 *
 * ACTIVE USAGE is not "the page is open". ActivityMeter counts time only while the tab is visible AND focused AND the last interaction (pointer, key, touch, scroll, input) is less than the
 * inactivity timeout old. It pauses when the tab is hidden, when the window loses focus (SQL Assistant is in the background) and when the timeout elapses; it resumes at the next interaction.
 *
 * FAILURE HANDLING: nothing here can throw into the application and nothing waits for the network. Events are queued (bounded, kept in browser storage so a closed tab does not lose them), sent in
 * batches with back-off, and dropped when the service refuses them permanently. If the service is unreachable or disabled SQL Assistant behaves exactly as without analytics.
 * Pure logic with injectable I/O (tested in Node).
 */
import type { KeyValueStore } from '../../services/storage';

export const FEATURES = ['quick-start', 'read-only-builder', 'cr-builder', 'describe-read-only', 'describe-cr', 'query-add', 'query-library', 'schema', 'github', 'error-rectifier', 'settings', 'about', 'sync', 'guided-walkthrough', 'copy-sql', 'accept-learn'] as const;
export type FeatureId = (typeof FEATURES)[number];
export const GENERATION_KINDS = ['read-only', 'cr', 'describe-read-only', 'describe-cr'] as const;
export type GenerationKind = (typeof GENERATION_KINDS)[number];
export const MAX_ACTIVE_MS_PER_EVENT = 15 * 60 * 1000;
export const ANALYTICS_STORAGE = { userId: 'sqla.analytics.uid.v1773', queue: 'sqla.analytics.queue.v1773' } as const;
export type AnalyticsEventType = 'session_start' | 'active' | 'feature' | 'generation' | 'session_end';
export interface AnalyticsEvent { v: 1; eid: string; t: AnalyticsEventType; ts: number; uid: string; sid: string; ver: string; usr?: string; ms?: number; f?: FeatureId; k?: GenerationKind; ok?: boolean; rv?: boolean; }

// ───────────────────────────────────────────────────────────── ActivityMeter
export class ActivityMeter {
  private visible = true; private focused = true; private last = 0; private running = false; private seg = 0; private acc = 0; private clock = 0;
  constructor(private inactivityMs: number) {}
  private fwd(t: number): number { if (t < this.clock) t = this.clock; this.clock = t; return t; } // a clock that jumps back never produces negative time
  private settle(t: number): void {
    if (!this.running) return; const limit = this.last + this.inactivityMs; const end = Math.min(t, limit); if (end > this.seg) this.acc += end - this.seg;
    if (t >= limit) { this.running = false; } else this.seg = t;
  }
  /** The page was opened (the user just navigated to it): counts as the first interaction when the tab is visible and focused. */
  start(t: number, visible: boolean, focused: boolean): void { t = this.fwd(t); this.visible = visible; this.focused = focused; if (visible && focused) this.begin(t); }
  private begin(t: number): void { this.last = t; if (!this.running) { this.running = true; this.seg = t; } }
  /** An interaction. `strong` ones (pointer down, key, touch, input) can only happen in a focused window, so they also mean "focused". */
  interaction(t: number, strong = true): void { t = this.fwd(t); this.settle(t); if (strong) this.focused = true; if (this.visible && this.focused) this.begin(t); }
  setVisible(v: boolean, t: number): void { t = this.fwd(t); this.settle(t); this.visible = v; if (!v) this.running = false; /* resumes only at the next interaction */ }
  setFocused(f: boolean, t: number): void { t = this.fwd(t); this.settle(t); this.focused = f; if (!f) this.running = false; }
  tick(t: number): void { this.settle(this.fwd(t)); }
  /** Active milliseconds since the last drain — and only when at least `minMs` have accumulated (the rest stays for the next drain). */
  drain(t: number, minMs = 1000): number { this.settle(this.fwd(t)); if (this.acc < minMs) return 0; const ms = Math.floor(this.acc); this.acc -= ms; return ms; }
  isActive(): boolean { return this.running; }
  pending(): number { return this.acc; }
}

// ───────────────────────────────────────────────────────────── identity and ids (random, no personal data)
export function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes); try { if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(a); else throw new Error('no crypto'); } catch { for (let i = 0; i < bytes; i += 1) a[i] = Math.floor(Math.random() * 256); }
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
/** The per-device id: random, created once, kept in browser storage — so two sessions of the same browser profile are ONE user. Without storage it lives for the page session only. */
export function loadOrCreateUserId(store: KeyValueStore): string {
  try { const cur = store.get(ANALYTICS_STORAGE.userId); if (cur && /^[a-f0-9]{32}$/.test(cur)) return cur; } catch { /* unreadable storage: a new id */ }
  const id = randomHex(16); try { store.set(ANALYTICS_STORAGE.userId, id); } catch { /* unwritable storage: the id lives for this page session */ } return id;
}
/** The optional user label (a GitHub login): charset-restricted; anything else means "no label". */
export const sanitizeLabel = (login: unknown): string | null => (typeof login === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(login) ? login : null);
const SAFE_VERSION = /^[0-9A-Za-z.+_-]{1,32}$/;

// ───────────────────────────────────────────────────────────── transport
/** `handedOff`: the batch was given to the browser's beacon queue at page exit — the browser gives no acknowledgement, so the caller keeps the events until a normal request is acknowledged (the service ignores a repeated event id). */
export type SendResult = { ok: true; handedOff?: boolean } | { ok: false; permanent: boolean; reason: string; /** V17.7.4: the sink knows a better time to retry than the default back-off (for example one hour after "no write access") */ retryAfterMs?: number };
export interface TelemetrySink { send(events: AnalyticsEvent[], opts?: { exit?: boolean }): Promise<SendResult>; }
/** POSTs batches to `<serviceUrl>/v1/events` as text/plain (a "simple" request: no preflight, usable from pagehide via sendBeacon / keepalive). No credentials, no cookies. */
export class ServiceTelemetrySink implements TelemetrySink {
  constructor(private url: string, private fetchFn?: typeof fetch, private beacon?: (url: string, data: Blob) => boolean, private timeoutMs = 8000) {}
  async send(events: AnalyticsEvent[], opts: { exit?: boolean } = {}): Promise<SendResult> {
    const body = JSON.stringify({ events }); const url = `${this.url}/v1/events`;
    if (opts.exit && this.beacon) { try { if (this.beacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return { ok: true, handedOff: true }; } catch { /* fall back to fetch */ } }
    const f: typeof fetch = this.fetchFn ?? ((u, i) => globalThis.fetch(u, i)); const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const r = await f(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body, credentials: 'omit', cache: 'no-store', keepalive: !!opts.exit && body.length < 60000, signal: ctl.signal });
      if (r.ok) return { ok: true }; if (r.status === 400 || r.status === 413 || r.status === 422) return { ok: false, permanent: true, reason: `refused (${r.status})` }; return { ok: false, permanent: false, reason: `HTTP ${r.status}` };
    } catch { return { ok: false, permanent: false, reason: 'unreachable' }; } finally { clearTimeout(tm); }
  }
}

// ───────────────────────────────────────────────────────────── the tracker
export interface TrackerDeps {
  config: { inactivityTimeout: number; collectUserIdentity: boolean; applicationVersion: string };
  sink: TelemetrySink; store: KeyValueStore; mono: () => number; wall: () => number; identity: () => string | null;
  /** V17.7.4: a sink that makes a repository COMMIT per batch sends rarely — `flushEveryMs` (default 60 s), `flushAtCount` (default 20 queued events) and `minFlushGapMs` (no send caused by a hidden tab sooner than this after the last one; page exit is never delayed) */
  flushEveryMs?: number; flushAtCount?: number; minFlushGapMs?: number;
}
const QUEUE_MAX = 100; const BATCH = 50; const FLUSH_EVERY_MS = 60_000; const BACKOFF_MIN_MS = 15_000; const BACKOFF_MAX_MS = 10 * 60_000; const STALE_MS = 24 * 3600_000;
export class AnalyticsTracker {
  readonly uid: string; readonly sid: string; private meter: ActivityMeter; private queue: AnalyticsEvent[] = [];
  private lastFlush = 0; private nextAttempt = 0; private failures = 0; private inflight = false; private started = false; private stopped = false;
  private counters = { sent: 0, dropped: 0, enqueued: 0 };
  constructor(private d: TrackerDeps) {
    this.uid = loadOrCreateUserId(d.store); this.sid = randomHex(12); this.meter = new ActivityMeter(Math.max(1, d.config.inactivityTimeout) * 1000);
    this.queue = this.loadQueue();
  }
  private ver(): string { return SAFE_VERSION.test(this.d.config.applicationVersion) ? this.d.config.applicationVersion : '0'; }
  private base(t: AnalyticsEventType): AnalyticsEvent { const ev: AnalyticsEvent = { v: 1, eid: randomHex(8), t, ts: this.d.wall(), uid: this.uid, sid: this.sid, ver: this.ver() }; if (this.d.config.collectUserIdentity) { const l = sanitizeLabel(this.safeIdentity()); if (l) ev.usr = l; } return ev; }
  private safeIdentity(): string | null { try { return this.d.identity(); } catch { return null; } }
  private loadQueue(): AnalyticsEvent[] { try { const raw = this.d.store.get(ANALYTICS_STORAGE.queue); if (!raw) return []; const a = JSON.parse(raw); if (!Array.isArray(a)) return []; const cut = this.d.wall() - STALE_MS; return a.filter((e) => e && typeof e === 'object' && typeof e.eid === 'string' && typeof e.ts === 'number' && e.ts >= cut).slice(-QUEUE_MAX); } catch { return []; } }
  private persist(): void { try { if (this.queue.length) this.d.store.set(ANALYTICS_STORAGE.queue, JSON.stringify(this.queue)); else this.d.store.remove(ANALYTICS_STORAGE.queue); } catch { /* storage blocked: the queue then lives in memory only */ } }
  private enqueue(ev: AnalyticsEvent): void { this.queue.push(ev); this.counters.enqueued += 1; while (this.queue.length > QUEUE_MAX) { this.queue.shift(); this.counters.dropped += 1; } this.persist(); }

  start(visible: boolean, focused: boolean): void { if (this.started) return; this.started = true; try { this.meter.start(this.d.mono(), visible, focused); this.enqueue(this.base('session_start')); } catch { /* analytics never throws into the application */ } }
  interaction(strong = true): void { try { if (!this.stopped) this.meter.interaction(this.d.mono(), strong); } catch { /* */ } }
  setVisible(v: boolean): void { try { this.meter.setVisible(v, this.d.mono()); if (!v) void this.flush(); } catch { /* */ } }
  setFocused(f: boolean): void { try { this.meter.setFocused(f, this.d.mono()); } catch { /* */ } }
  feature(f: string): void { try { if (this.stopped || !(FEATURES as readonly string[]).includes(f)) return; const ev = this.base('feature'); ev.f = f as FeatureId; this.enqueue(ev); } catch { /* */ } }
  generation(kind: string, ok: boolean, needsReview = false): void { try { if (this.stopped || !(GENERATION_KINDS as readonly string[]).includes(kind)) return; const ev = this.base('generation'); ev.k = kind as GenerationKind; ev.ok = ok === true; ev.rv = ok === true && needsReview === true; this.enqueue(ev); } catch { /* */ } }
  /** Called by a timer every few seconds: settles the meter, and sends when a minute has passed (or the queue is long). */
  tick(): void { try { if (this.stopped) return; this.meter.tick(this.d.mono()); const n = this.d.wall(); if (n - this.lastFlush >= (this.d.flushEveryMs ?? FLUSH_EVERY_MS) || this.queue.length >= (this.d.flushAtCount ?? 20)) void this.flush(); } catch { /* */ } }
  private collectActive(): void { let ms = this.meter.drain(this.d.mono()); while (ms > 0) { const part = Math.min(ms, MAX_ACTIVE_MS_PER_EVENT); const ev = this.base('active'); ev.ms = part; this.enqueue(ev); ms -= part; } }
  async flush(opts: { exit?: boolean } = {}): Promise<void> {
    try {
      this.collectActive(); if (!this.queue.length) return; const n = this.d.wall(); if (this.inflight || (!opts.exit && n < this.nextAttempt)) return; if (!opts.exit && this.d.minFlushGapMs && this.lastFlush && n - this.lastFlush < this.d.minFlushGapMs && this.queue.length < (this.d.flushAtCount ?? 20)) return;
      this.lastFlush = n; const batch = this.queue.slice(0, BATCH); this.inflight = true; let r: SendResult; try { r = await this.d.sink.send(batch, { exit: opts.exit }); } catch { r = { ok: false, permanent: false, reason: 'error' }; } finally { this.inflight = false; }
      const gone = new Set(batch.map((e) => e.eid));
      if (r.ok && r.handedOff) { /* page exit: kept (and persisted) until a normal request is acknowledged — the next page session sends them again; the service ignores a repeated event id */ }
      else if (r.ok) { this.queue = this.queue.filter((e) => !gone.has(e.eid)); this.counters.sent += batch.length; this.failures = 0; this.nextAttempt = 0; }
      else if (r.permanent) { this.queue = this.queue.filter((e) => !gone.has(e.eid)); this.counters.dropped += batch.length; }
      else { this.failures += 1; this.nextAttempt = n + (r.retryAfterMs && r.retryAfterMs > 0 ? Math.min(r.retryAfterMs, 6 * 3600_000) : Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (this.failures - 1))); }
      this.persist();
    } catch { /* */ }
  }
  /** Page is going away / analytics switched off: one last event and one last (best-effort) send. */
  async stop(): Promise<void> { try { if (this.stopped) return; if (this.started) this.enqueue(this.base('session_end')); await this.flush({ exit: true }); this.stopped = true; } catch { this.stopped = true; } }
  stats(): { queued: number; sent: number; dropped: number; failures: number; active: boolean; pendingActiveMs: number } { return { queued: this.queue.length, sent: this.counters.sent, dropped: this.counters.dropped, failures: this.failures, active: this.meter.isActive(), pendingActiveMs: Math.floor(this.meter.pending()) }; }
  /** The queued events exactly as they would be sent — for tests and the privacy review (no secret can be in them: see the event builders). */
  peek(): AnalyticsEvent[] { return this.queue.map((e) => ({ ...e })); }
}

// ───────────────────────────────────────────────────────────── browser binding
type ListenerOptions = boolean | { capture?: boolean; passive?: boolean };
export interface BrowserEnv {
  document: { visibilityState: string; hasFocus?: () => boolean; addEventListener: (t: string, f: () => void, o?: ListenerOptions) => void; removeEventListener: (t: string, f: () => void, o?: ListenerOptions) => void };
  window: { addEventListener: (t: string, f: () => void, o?: ListenerOptions) => void; removeEventListener: (t: string, f: () => void, o?: ListenerOptions) => void };
  setInterval: (f: () => void, ms: number) => unknown; clearInterval: (h: unknown) => void;
}
/** Connects a tracker to the page: interactions, visibility, focus, page hide. Returns the function that removes every listener. */
export function attachBrowserListeners(tracker: AnalyticsTracker, env: BrowserEnv): () => void {
  const doc = env.document; const win = env.window; const visible = () => doc.visibilityState !== 'hidden'; const focused = () => (doc.hasFocus ? doc.hasFocus() : true);
  tracker.start(visible(), focused());
  const strong = () => tracker.interaction(true); const weak = () => tracker.interaction(false); const opts = { capture: true, passive: true };
  const onVis = () => tracker.setVisible(visible()); const onBlur = () => tracker.setFocused(false); const onFocus = () => tracker.setFocused(true); const onHide = () => { void tracker.stop(); };
  let lastMove = 0; const onMove = () => { const n = Date.now(); if (n - lastMove >= 1000) { lastMove = n; weak(); } };
  const strongEvents = ['pointerdown', 'keydown', 'touchstart', 'input']; const weakEvents = ['wheel', 'scroll'];
  strongEvents.forEach((t) => doc.addEventListener(t, strong, opts)); weakEvents.forEach((t) => doc.addEventListener(t, weak, opts)); doc.addEventListener('mousemove', onMove, opts); doc.addEventListener('visibilitychange', onVis);
  win.addEventListener('blur', onBlur); win.addEventListener('focus', onFocus); win.addEventListener('pagehide', onHide);
  const timer = env.setInterval(() => tracker.tick(), 5000);
  return () => { strongEvents.forEach((t) => doc.removeEventListener(t, strong, opts)); weakEvents.forEach((t) => doc.removeEventListener(t, weak, opts)); doc.removeEventListener('mousemove', onMove, opts); doc.removeEventListener('visibilitychange', onVis); win.removeEventListener('blur', onBlur); win.removeEventListener('focus', onFocus); win.removeEventListener('pagehide', onHide); env.clearInterval(timer); };
}
