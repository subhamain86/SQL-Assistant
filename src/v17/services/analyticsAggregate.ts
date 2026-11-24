/**
 * V17.7.4 — USAGE ANALYTICS, serverless provider: the strict event validator and the aggregation, in the browser, over DECRYPTED events.
 *
 * This is the same arithmetic as the analytics service (server/analytics-service.mjs): a per-day roll-up (sessions, active time, user keys, features, versions, generation outcomes), the same active-time cap
 * (a session cannot claim more active time than has really passed since it was first seen), the same DAU / WAU / MAU, weekly (Monday) and monthly rows. test/v1774.test.mjs feeds the SAME events to both and requires
 * identical dashboards, so the two providers cannot drift apart.
 *
 * Trust: the people who can write telemetry are the people who can write to the repository (and have the public key). Whatever they write is validated here field by field, exactly like the service does —
 * a hostile or damaged batch can neither carry free text into the dashboard nor claim an absurd value. Nothing here touches the network, the page, storage or a secret.
 */
import { FEATURES, GENERATION_KINDS, MAX_ACTIVE_MS_PER_EVENT, type AnalyticsEvent, type AnalyticsEventType } from './analyticsTracker';
import type { AnalyticsSummary, SummaryRow } from './analyticsAdmin';

const DAY_MS = 86_400_000; const EVENT_TYPES: AnalyticsEventType[] = ['session_start', 'active', 'feature', 'generation', 'session_end'];
const ID = /^[A-Za-z0-9_-]{8,40}$/; const UID = /^[a-f0-9]{32}$/; const SID = /^[a-f0-9]{24,32}$/; const VER = /^[0-9A-Za-z.+_-]{1,32}$/; const USR = /^[A-Za-z0-9._-]{1,64}$/;
const COMMON = ['v', 'eid', 't', 'ts', 'uid', 'sid', 'ver', 'usr'];
const EXTRA: Record<AnalyticsEventType, string[]> = { session_start: [], session_end: [], active: ['ms'], feature: ['f'], generation: ['k', 'ok', 'rv'] };
export type EventCheck = { ok: true; ev: AnalyticsEvent } | { ok: false; reason: string };
/** The service's validator, in TypeScript: only the documented fields and value shapes pass; a time outside [now − 7 days, now + 5 min] is replaced by `nowMs` (for a batch: the time the device wrote it). */
export function validateEvent(raw: unknown, nowMs: number): EventCheck {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not-an-object' }; const r = raw as Record<string, unknown>; const t = r.t as AnalyticsEventType;
  if (!EVENT_TYPES.includes(t)) return { ok: false, reason: 'unknown-type' }; const allowed = new Set([...COMMON, ...EXTRA[t]]); for (const k of Object.keys(r)) if (!allowed.has(k)) return { ok: false, reason: 'unexpected-field' };
  if (r.v !== 1) return { ok: false, reason: 'bad-version' }; if (typeof r.eid !== 'string' || !ID.test(r.eid)) return { ok: false, reason: 'bad-id' }; if (typeof r.uid !== 'string' || !UID.test(r.uid)) return { ok: false, reason: 'bad-user' }; if (typeof r.sid !== 'string' || !SID.test(r.sid)) return { ok: false, reason: 'bad-session' };
  if (typeof r.ver !== 'string' || !VER.test(r.ver)) return { ok: false, reason: 'bad-app-version' }; if (r.usr !== undefined && (typeof r.usr !== 'string' || !USR.test(r.usr))) return { ok: false, reason: 'bad-label' };
  let ts = nowMs; if (r.ts !== undefined) { if (typeof r.ts !== 'number' || !Number.isInteger(r.ts) || r.ts < 0) return { ok: false, reason: 'bad-time' }; if (r.ts >= nowMs - 7 * DAY_MS && r.ts <= nowMs + 5 * 60_000) ts = r.ts; }
  const ev: AnalyticsEvent = { v: 1, t, eid: r.eid, ts, uid: r.uid, sid: r.sid, ver: r.ver }; if (r.usr !== undefined) ev.usr = r.usr as string;
  if (t === 'active') { if (typeof r.ms !== 'number' || !Number.isInteger(r.ms) || r.ms < 1 || r.ms > MAX_ACTIVE_MS_PER_EVENT) return { ok: false, reason: 'bad-active-time' }; ev.ms = r.ms; }
  if (t === 'feature') { if (typeof r.f !== 'string' || !(FEATURES as readonly string[]).includes(r.f)) return { ok: false, reason: 'unknown-feature' }; ev.f = r.f as AnalyticsEvent['f']; }
  if (t === 'generation') { if (typeof r.k !== 'string' || !(GENERATION_KINDS as readonly string[]).includes(r.k) || typeof r.ok !== 'boolean' || (r.rv !== undefined && typeof r.rv !== 'boolean')) return { ok: false, reason: 'bad-generation' }; ev.k = r.k as AnalyticsEvent['k']; ev.ok = r.ok; ev.rv = r.rv === true; }
  return { ok: true, ev };
}

// ───────────────────────────────────────────────────────────── dates (UTC days)
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const utcMonth = (ms: number): string => new Date(ms).toISOString().slice(0, 7);
const parseDay = (s: unknown): number | null => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; const t = Date.parse(`${s}T00:00:00Z`); return Number.isNaN(t) || utcDay(t) !== s ? null : t; };
const addDays = (s: string, n: number): string => utcDay(Date.parse(`${s}T00:00:00Z`) + n * DAY_MS);
const weekStart = (s: string): string => { const d = new Date(`${s}T00:00:00Z`); return addDays(s, -((d.getUTCDay() + 6) % 7)); };
/** every YYYY-MM from the month of `from` to the month of `to` (inclusive) */
export function monthsBetween(from: string, to: string): string[] { const out: string[] = []; let y = Number(from.slice(0, 4)); let m = Number(from.slice(5, 7)); const ey = Number(to.slice(0, 4)); const em = Number(to.slice(5, 7)); while ((y < ey || (y === ey && m <= em)) && out.length < 400) { out.push(`${y}-${String(m).padStart(2, '0')}`); m += 1; if (m > 12) { m = 1; y += 1; } } return out; }

// ───────────────────────────────────────────────────────────── the roll-up model
export interface DayAgg { sessions: number; activeMs: number; users: Record<string, { s: number; a: number }>; features: Record<string, number>; versions: Record<string, { s: number; u: string[] }>; gen: { ok: number; fail: number; review: number }; }
export interface SessAgg { f: number; a: number; u: string; l: number; }
/** `merged`: the names of the batch files this roll-up already contains — a batch file that was merged but could not be deleted is not counted twice. */
export interface Rollup { month: string; days: Record<string, DayAgg>; sessions: Record<string, SessAgg>; merged?: string[]; }
const emptyDay = (): DayAgg => ({ sessions: 0, activeMs: 0, users: {}, features: {}, versions: {}, gen: { ok: 0, fail: 0, review: 0 } });
/** a short, deterministic key for a user (device id, or the label when one was sent) — the raw value is never kept in a roll-up */
export function userKeyOf(ev: { usr?: string; uid: string }): string { const s = `sqla-uk1:${ev.usr || ev.uid}`; let a = 0x811c9dc5; let b = 0x01000193 ^ 0xdeadbeef; for (let i = 0; i < s.length; i += 1) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b + c, 0x85ebca6b) >>> 0; b ^= b >>> 13; } return `${a.toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`; }

export class UsageModel {
  readonly days = new Map<string, DayAgg>(); readonly sessions = new Map<string, SessAgg>(); private seen = new Set<string>();
  eventCount = 0;
  /** Adds one VALIDATED event. Events must be added in time order per session (the caller sorts). */
  addEvent(ev: AnalyticsEvent): 'ok' | 'duplicate' | 'rejected-time' {
    if (this.seen.has(ev.eid)) return 'duplicate'; this.seen.add(ev.eid); this.eventCount += 1;
    const day = utcDay(ev.ts); let d = this.days.get(day); if (!d) { d = emptyDay(); this.days.set(day, d); } const uk = userKeyOf(ev); const u = (d.users[uk] ||= { s: 0, a: 0 });
    let sess = this.sessions.get(ev.sid);
    if (!sess) { sess = { f: ev.ts, a: 0, u: uk, l: ev.ts }; this.sessions.set(ev.sid, sess); d.sessions += 1; u.s += 1; const v = (d.versions[ev.ver] ||= { s: 0, u: [] }); v.s += 1; if (!v.u.includes(uk)) v.u.push(uk); } if (ev.ts > sess.l) sess.l = ev.ts; if (ev.ts < sess.f) sess.f = ev.ts;
    if (ev.t === 'active') { const room = Math.max(0, ev.ts - sess.f + 90_000 - sess.a); const ms = Math.min(ev.ms ?? 0, room); if (ms <= 0) return 'rejected-time'; sess.a += ms; d.activeMs += ms; u.a += ms; }
    else if (ev.t === 'feature' && ev.f) d.features[ev.f] = (d.features[ev.f] || 0) + 1;
    else if (ev.t === 'generation') { if (ev.ok) { d.gen.ok += 1; if (ev.rv) d.gen.review += 1; } else d.gen.fail += 1; }
    return 'ok';
  }
  /** Adds a (validated) roll-up: its days and the sessions that were still open at its end (so a session that continues in the next month is not counted again). */
  addRollup(r: Rollup): void {
    for (const [day, x] of Object.entries(r.days)) { const d = this.days.get(day); if (!d) { this.days.set(day, structuredClone(x)); continue; }
      d.sessions += x.sessions; d.activeMs += x.activeMs; for (const [k, v] of Object.entries(x.users)) { const e = (d.users[k] ||= { s: 0, a: 0 }); e.s += v.s; e.a += v.a; } for (const [k, v] of Object.entries(x.features)) d.features[k] = (d.features[k] || 0) + v;
      for (const [k, v] of Object.entries(x.versions)) { const e = (d.versions[k] ||= { s: 0, u: [] }); e.s += v.s; v.u.forEach((id) => { if (!e.u.includes(id)) e.u.push(id); }); } d.gen.ok += x.gen.ok; d.gen.fail += x.gen.fail; d.gen.review += x.gen.review; }
    for (const [sid, s] of Object.entries(r.sessions)) if (!this.sessions.has(sid)) this.sessions.set(sid, { ...s });
  }
  /** The roll-up of one month: its days, and the sessions whose last event is in the last 48 hours of the month. */
  toRollup(month: string): Rollup {
    const days: Record<string, DayAgg> = {}; for (const [k, v] of this.days) if (k.startsWith(`${month}-`)) days[k] = structuredClone(v);
    const dayKeys = Object.keys(days).sort(); const lastDay = dayKeys[dayKeys.length - 1]; const cut = lastDay ? Date.parse(`${lastDay}T00:00:00Z`) + DAY_MS - 2 * DAY_MS : 0; const sessions: Record<string, SessAgg> = {}; let n = 0;
    for (const [sid, s] of this.sessions) if (utcMonth(s.l) === month && s.l >= cut && n < 5000) { sessions[sid] = { ...s }; n += 1; }
    return { month, days, sessions };
  }
  /** Removes every day before `cutDay` (retention). Returns the number of days removed. */
  prune(cutDay: string): number { let n = 0; for (const k of [...this.days.keys()]) if (k < cutDay) { this.days.delete(k); n += 1; } return n; }

  summary(fromS: string, toS: string, nowMs: number, retentionDays: number): AnalyticsSummary | { error: 'bad-range' | 'range-too-large' } {
    const today = utcDay(nowMs); const to = toS ? parseDay(toS) : parseDay(today); let from = fromS ? parseDay(fromS) : null; if (to === null || (fromS && from === null)) return { error: 'bad-range' };
    const toDay = utcDay(to); if (from === null) from = to - 29 * DAY_MS; const fromDay = utcDay(from); if (fromDay > toDay) return { error: 'bad-range' }; const span = Math.round((to - from) / DAY_MS) + 1; if (span > 800) return { error: 'range-too-large' };
    const ref = toDay > today ? today : toDay; const keys: string[] = []; for (let i = 0; i < span; i += 1) keys.push(addDays(fromDay, i));
    const agg = (list: string[]) => { const users = new Set<string>(); let sessions = 0; let activeMs = 0; let ok = 0; let fail = 0; let review = 0; for (const k of list) { const d = this.days.get(k); if (!d) continue; sessions += d.sessions; activeMs += d.activeMs; ok += d.gen.ok; fail += d.gen.fail; review += d.gen.review; for (const uk of Object.keys(d.users)) users.add(uk); } return { users, sessions, activeMs, ok, fail, review }; };
    type A = ReturnType<typeof agg>; const row = (a: A): SummaryRow => ({ users: a.users.size, sessions: a.sessions, activeMs: a.activeMs, generations: a.ok + a.fail, success: a.ok, failure: a.fail, review: a.review });
    const total = agg(keys); const window = (n: number): number => { const l: string[] = []; for (let i = 0; i < n; i += 1) l.push(addDays(ref, -i)); return agg(l).users.size; };
    const daily = keys.map((k) => ({ date: k, ...row(agg([k])) })); const group = (fn: (k: string) => string): { key: string; days: number; r: SummaryRow }[] => { const m = new Map<string, string[]>(); for (const k of keys) { const g = fn(k); (m.get(g) ?? m.set(g, []).get(g)!).push(k); } return [...m.entries()].map(([g, l]) => ({ key: g, days: l.length, r: row(agg(l)) })); };
    const weekly = group(weekStart).map((x) => ({ weekStart: x.key, days: x.days, ...x.r })); const monthly = group((k) => k.slice(0, 7)).map((x) => ({ month: x.key, days: x.days, ...x.r }));
    const features: Record<string, number> = {}; const versions = new Map<string, { sessions: number; users: Set<string> }>(); for (const k of keys) { const d = this.days.get(k); if (!d) continue; for (const [f, c] of Object.entries(d.features)) features[f] = (features[f] || 0) + c; for (const [v, x] of Object.entries(d.versions)) { const e = versions.get(v) ?? { sessions: 0, users: new Set<string>() }; e.sessions += x.s; x.u.forEach((u) => e.users.add(u)); versions.set(v, e); } }
    const gen = total.ok + total.fail; const earliest = [...this.days.keys()].sort()[0] ?? null;
    return { range: { from: fromDay, to: toDay, days: span, referenceDay: ref, timezone: 'UTC' }, generatedAt: new Date(nowMs).toISOString(), dataSince: earliest, retentionDays,
      kpi: { uniqueUsers: total.users.size, dailyActiveUsers: window(1), weeklyActiveUsers: window(7), monthlyActiveUsers: window(30), totalSessions: total.sessions, totalActiveMs: total.activeMs, averageActiveMsPerSession: total.sessions ? Math.round(total.activeMs / total.sessions) : 0, averageActiveMsPerUser: total.users.size ? Math.round(total.activeMs / total.users.size) : 0, generated: gen, successful: total.ok, failed: total.fail, needsReview: total.review, successRate: gen ? Math.round((total.ok / gen) * 1000) / 10 : null },
      daily, weekly, monthly,
      features: Object.entries(features).map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
      versions: [...versions.entries()].map(([version, x]) => ({ version, sessions: x.sessions, users: x.users.size })).sort((a, b) => b.sessions - a.sessions || a.version.localeCompare(b.version)) };
  }
}

// ───────────────────────────────────────────────────────────── a decrypted roll-up is validated like an event: bounded numbers, known names, nothing else
const num = (v: unknown, max = 1e12): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.floor(v) : 0);
export function parseRollup(raw: unknown): Rollup | null {
  if (!raw || typeof raw !== 'object') return null; const o = raw as Record<string, unknown>; if (typeof o.month !== 'string' || !/^\d{4}-\d{2}$/.test(o.month) || !o.days || typeof o.days !== 'object') return null;
  const days: Record<string, DayAgg> = {}; for (const [k, v] of Object.entries(o.days as Record<string, unknown>)) {
    if (!k.startsWith(`${o.month}-`) || parseDay(k) === null || !v || typeof v !== 'object') continue; const d = v as Record<string, unknown>; const out = emptyDay(); out.sessions = num(d.sessions, 1e9); out.activeMs = num(d.activeMs);
    for (const [uk, x] of Object.entries((d.users && typeof d.users === 'object' ? d.users : {}) as Record<string, { s?: unknown; a?: unknown }>).slice(0, 200_000)) if (/^[a-f0-9]{16}$/.test(uk) && x && typeof x === 'object') out.users[uk] = { s: num(x.s, 1e9), a: num(x.a) };
    for (const [f, c] of Object.entries((d.features && typeof d.features === 'object' ? d.features : {}) as Record<string, unknown>)) if ((FEATURES as readonly string[]).includes(f)) out.features[f] = num(c, 1e9);
    for (const [ver, x] of Object.entries((d.versions && typeof d.versions === 'object' ? d.versions : {}) as Record<string, { s?: unknown; u?: unknown }>).slice(0, 200)) if (VER.test(ver) && x && typeof x === 'object') out.versions[ver] = { s: num(x.s, 1e9), u: (Array.isArray(x.u) ? x.u : []).filter((id): id is string => typeof id === 'string' && /^[a-f0-9]{16}$/.test(id)).slice(0, 200_000) };
    const g = (d.gen && typeof d.gen === 'object' ? d.gen : {}) as Record<string, unknown>; out.gen = { ok: num(g.ok, 1e9), fail: num(g.fail, 1e9), review: num(g.review, 1e9) }; days[k] = out;
  }
  const sessions: Record<string, SessAgg> = {}; for (const [sid, x] of Object.entries((o.sessions && typeof o.sessions === 'object' ? o.sessions : {}) as Record<string, { f?: unknown; a?: unknown; u?: unknown; l?: unknown }>).slice(0, 5000)) if (SID.test(sid) && x && typeof x === 'object' && typeof x.u === 'string' && /^[a-f0-9]{16}$/.test(x.u)) sessions[sid] = { f: num(x.f, 4e12), a: num(x.a), u: x.u, l: num(x.l, 4e12) };
  const merged = (Array.isArray(o.merged) ? o.merged : []).filter((n): n is string => typeof n === 'string' && /^[a-f0-9]{32}$/.test(n)).slice(0, 100_000);
  return { month: o.month, days, sessions, merged };
}
