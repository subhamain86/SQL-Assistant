/**
 * V17.7.3 — the client side of the ADMINISTRATOR endpoints of the analytics service (server/analytics-service.mjs).
 *
 * The administrator password is checked ONLY by the service (salted scrypt hash on the server). This module sends what the administrator typed to the service over HTTPS and receives a short-lived,
 * revocable session token. Neither the password nor the token is ever stored by this module: the caller keeps the token in page memory (a reload requires signing in again), and nothing here writes to
 * localStorage / sessionStorage / the URL / a log. No message produced here contains the password, the token or any configuration.
 * Pure logic with injectable I/O (tested in Node).
 */
export type AdminFailure = 'invalid' | 'locked' | 'not-configured' | 'unreachable' | 'timeout' | 'origin' | 'rate-limited' | 'session' | 'managed-externally' | 'weak-password' | 'bad-request' | 'unexpected' | 'not-set-up' | 'repository';
export const ADMIN_MESSAGES: Record<AdminFailure, string> = {
  invalid: 'Invalid administrator password', // the exact wording required for a wrong password — nothing more is said about the configuration
  locked: 'Too many attempts. Try again later.',
  'not-configured': 'Analytics administration is not set up on the analytics service yet. An administrator has to set the administrator password on the service.',
  unreachable: 'The analytics service could not be reached, so Analytics cannot be unlocked right now. SQL Assistant itself is not affected.',
  timeout: 'The analytics service did not answer in time. SQL Assistant itself is not affected.',
  origin: 'The analytics service does not accept requests from this page (its allowed origins do not include it). An administrator has to correct the service configuration.',
  'rate-limited': 'The analytics service is limiting requests. Try again in a minute.',
  session: 'The administrator session is no longer valid. Unlock Analytics again.',
  'managed-externally': 'The administrator password is managed in the analytics service\'s environment and cannot be changed here. Change it there (see docs/ANALYTICS.md).',
  'weak-password': 'The new password was not accepted.',
  'bad-request': 'The analytics service did not accept the request.',
  unexpected: 'The analytics service gave an unexpected answer. SQL Assistant itself is not affected.',
  'not-set-up': 'Analytics has not been set up in the repository yet. An administrator has to set it up first.',
  repository: 'The Analytics files in the repository could not be used. SQL Assistant itself is not affected.',
};
export type AdminResult<T> = ({ ok: true } & T) | { ok: false; kind: AdminFailure; message: string; retryAfterSeconds?: number; /** V17.7.4 (repository provider): the precise reason, for the page (for example "no-write", "unsupported") */ detail?: string };
export interface LoginOk { token: string; expiresAt: number; idleSeconds: number; passwordManagedExternally: boolean; }
export interface SummaryRow { users: number; sessions: number; activeMs: number; generations: number; success: number; failure: number; review: number; }
export interface Kpi { uniqueUsers: number; dailyActiveUsers: number; weeklyActiveUsers: number; monthlyActiveUsers: number; totalSessions: number; totalActiveMs: number; averageActiveMsPerSession: number; averageActiveMsPerUser: number; generated: number; successful: number; failed: number; needsReview: number; successRate: number | null; }
export interface AnalyticsSummary { range: { from: string; to: string; days: number; referenceDay: string; timezone: string }; generatedAt: string; dataSince: string | null; retentionDays: number; kpi: Kpi; daily: (SummaryRow & { date: string })[]; weekly: (SummaryRow & { weekStart: string; days: number })[]; monthly: (SummaryRow & { month: string; days: number })[]; features: { id: string; count: number }[]; versions: { version: string; sessions: number; users: number }[]; }

type Json = Record<string, unknown>;
const looksLikeHtml = (t: string) => /^\s*</.test(t);
const n0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const s0 = (v: unknown, max = 64): string => (typeof v === 'string' ? v.slice(0, max) : '');
const row = (r: unknown): SummaryRow => { const o = (r && typeof r === 'object' ? r : {}) as Json; return { users: n0(o.users), sessions: n0(o.sessions), activeMs: n0(o.activeMs), generations: n0(o.generations), success: n0(o.success), failure: n0(o.failure), review: n0(o.review) }; };

/** Accepts only the documented shape: every number is finite and non-negative, every string is length-limited. Anything else is rejected as "unexpected" (a wrong or hostile answer never reaches the page). */
export function parseSummary(j: unknown): AnalyticsSummary | null {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null; const o = j as Json; const r = o.range as Json | undefined; const k = o.kpi as Json | undefined;
  if (!r || typeof r !== 'object' || !k || typeof k !== 'object' || !Array.isArray(o.daily) || !Array.isArray(o.weekly) || !Array.isArray(o.monthly) || !Array.isArray(o.features) || !Array.isArray(o.versions)) return null;
  if (typeof r.from !== 'string' || typeof r.to !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.from) || !/^\d{4}-\d{2}-\d{2}$/.test(r.to)) return null;
  const cap = <T>(a: unknown[], f: (x: unknown) => T, max: number): T[] => a.slice(0, max).map(f);
  return {
    range: { from: r.from, to: r.to, days: n0(r.days), referenceDay: s0(r.referenceDay, 10), timezone: s0(r.timezone, 8) || 'UTC' }, generatedAt: s0(o.generatedAt, 40), dataSince: typeof o.dataSince === 'string' ? s0(o.dataSince, 10) : null, retentionDays: n0(o.retentionDays),
    kpi: { uniqueUsers: n0(k.uniqueUsers), dailyActiveUsers: n0(k.dailyActiveUsers), weeklyActiveUsers: n0(k.weeklyActiveUsers), monthlyActiveUsers: n0(k.monthlyActiveUsers), totalSessions: n0(k.totalSessions), totalActiveMs: n0(k.totalActiveMs), averageActiveMsPerSession: n0(k.averageActiveMsPerSession), averageActiveMsPerUser: n0(k.averageActiveMsPerUser), generated: n0(k.generated), successful: n0(k.successful), failed: n0(k.failed), needsReview: n0(k.needsReview), successRate: typeof k.successRate === 'number' && Number.isFinite(k.successRate) ? k.successRate : null },
    daily: cap(o.daily, (x) => ({ date: s0((x as Json)?.date, 10), ...row(x) }), 900), weekly: cap(o.weekly, (x) => ({ weekStart: s0((x as Json)?.weekStart, 10), days: n0((x as Json)?.days), ...row(x) }), 200), monthly: cap(o.monthly, (x) => ({ month: s0((x as Json)?.month, 7), days: n0((x as Json)?.days), ...row(x) }), 100),
    features: cap(o.features, (x) => ({ id: s0((x as Json)?.id, 40), count: n0((x as Json)?.count) }), 64), versions: cap(o.versions, (x) => ({ version: s0((x as Json)?.version, 32), sessions: n0((x as Json)?.sessions), users: n0((x as Json)?.users) }), 64),
  };
}

export class AnalyticsAdminClient {
  constructor(private url: string, private fetchFn?: typeof fetch, private timeoutMs = 12_000) {}
  private async call(method: 'GET' | 'POST', path: string, o: { token?: string; body?: Json } = {}): Promise<{ status: number; json: Json; retryAfter?: number } | { fail: AdminFailure }> {
    const f: typeof fetch = this.fetchFn ?? ((u, i) => globalThis.fetch(u, i)); const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const r = await f(`${this.url}${path}`, { method, cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json', ...(o.body ? { 'Content-Type': 'application/json' } : {}), ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) }, ...(o.body ? { body: JSON.stringify(o.body) } : {}), signal: ctl.signal });
      const text = await r.text(); if (looksLikeHtml(text)) return { fail: 'unexpected' }; let json: unknown = {}; if (text) { try { json = JSON.parse(text); } catch { return { fail: 'unexpected' }; } } if (!json || typeof json !== 'object' || Array.isArray(json)) return { fail: 'unexpected' };
      const ra = Number(r.headers?.get?.('Retry-After')); return { status: r.status, json: json as Json, retryAfter: ra > 0 ? ra : undefined };
    } catch (e) { return { fail: (e as Error)?.name === 'AbortError' ? 'timeout' : 'unreachable' }; } finally { clearTimeout(tm); }
  }
  private fail<T>(kind: AdminFailure, retry?: number): AdminResult<T> { return { ok: false, kind, message: ADMIN_MESSAGES[kind], ...(retry ? { retryAfterSeconds: retry } : {}) }; }
  private byStatus<T>(c: { status: number; json: Json; retryAfter?: number }): AdminResult<T> {
    const code = typeof c.json.error === 'string' ? c.json.error : ''; const s = c.status;
    if (s === 401 && code === 'invalid-credentials') return this.fail('invalid'); if (s === 401) return this.fail('session'); if (s === 429 && code === 'locked') return this.fail('locked', Number(c.json.retryAfterSeconds) || c.retryAfter); if (s === 429) return this.fail('rate-limited');
    if (s === 503 && code === 'admin-not-configured') return this.fail('not-configured'); if (s === 403 && code === 'origin-not-allowed') return this.fail('origin'); if (s === 409 && code === 'managed-externally') return this.fail('managed-externally');
    if (s === 422 && code === 'weak-password') return { ok: false, kind: 'weak-password', message: s0(c.json.message, 200) || ADMIN_MESSAGES['weak-password'] }; if (s === 400 || s === 413) return this.fail('bad-request'); return this.fail('unexpected');
  }
  async login(password: string): Promise<AdminResult<LoginOk>> {
    const c = await this.call('POST', '/v1/admin/login', { body: { password } }); if ('fail' in c) return this.fail(c.fail);
    if (c.status === 200 && typeof c.json.token === 'string' && /^an1\.[A-Za-z0-9_-]{43}$/.test(c.json.token)) return { ok: true, token: c.json.token, expiresAt: n0(c.json.expiresAt), idleSeconds: n0(c.json.idleSeconds) || 900, passwordManagedExternally: c.json.passwordManagedExternally === true };
    return this.byStatus(c);
  }
  async summary(token: string, from: string, to: string): Promise<AdminResult<{ data: AnalyticsSummary }>> {
    const c = await this.call('GET', `/v1/admin/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { token }); if ('fail' in c) return this.fail(c.fail);
    if (c.status === 200) { const d = parseSummary(c.json); return d ? { ok: true, data: d } : this.fail('unexpected'); } if (c.status === 400) return { ok: false, kind: 'bad-request', message: c.json.error === 'range-too-large' ? 'That date range is too large (at most 800 days).' : 'That date range is not valid.' }; return this.byStatus(c);
  }
  async logout(token: string, o: { keepalive?: boolean } = {}): Promise<void> {
    try { if (o.keepalive) { const f: typeof fetch = this.fetchFn ?? ((u, i) => globalThis.fetch(u, i)); await f(`${this.url}/v1/admin/logout`, { method: 'POST', cache: 'no-store', credentials: 'omit', keepalive: true, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' }); return; } await this.call('POST', '/v1/admin/logout', { token, body: {} }); }
    catch { /* best effort: the session also ends by itself */ }
  }
  async changePassword(token: string, currentPassword: string, newPassword: string): Promise<AdminResult<Record<string, unknown>>> {
    const c = await this.call('POST', '/v1/admin/password', { token, body: { currentPassword, newPassword } }); if ('fail' in c) return this.fail(c.fail); if (c.status === 200 && c.json.ok === true) return { ok: true }; return this.byStatus(c);
  }
}
