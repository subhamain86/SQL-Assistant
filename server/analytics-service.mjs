#!/usr/bin/env node
/**
 * SQL Assistant V17.7.3 — USAGE ANALYTICS SERVICE (the trusted backend of the optional Usage Analytics feature, provider "service").
 *
 * Why it exists. SQL Assistant is a static page. A static page can neither keep a password secret (everything in it is readable by anyone who loads it) nor combine the usage of many people, so the
 * password that protects the Analytics dashboard and the numbers behind it live HERE, in a small dependency-free Node ≥ 20 service:
 *   · the Analytics administrator password is stored only as a salted scrypt hash — never in the page, in the page's configuration, in browser storage or in any response —; it is configured and
 *     rotated here (environment variable, or the command line / the dashboard's "Change administrator password"), so SQL Assistant never has to be rebuilt for it;
 *   · the page sends USAGE METADATA ONLY (see ALLOWED EVENTS below); this service refuses everything else, so even a tampered page cannot store SQL, results, credentials or any other free text here;
 *   · the dashboard numbers are computed here and are returned only to a caller that authenticated with the administrator password (short-lived, revocable session token, kept in page memory only).
 *
 *   GET  /healthz                              → { ok, adminConfigured }                                             (no secret, no authentication)
 *   POST /v1/events        { events: [...] }   → { accepted, rejected }                                              usage metadata from the page (origin allow-list, rate limited, no authentication)
 *   POST /v1/admin/login   { password }        → { token, expiresAt, idleSeconds }                                   401 invalid-credentials · 429 locked · 503 admin-not-configured
 *   POST /v1/admin/logout                      → { ok }                                                              revokes the session
 *   GET  /v1/admin/summary?from=&to=           → the dashboard numbers (aggregates only — never a per-user list)     needs the session token
 *   POST /v1/admin/password { currentPassword, newPassword } → { ok }                                                rotates the password, revokes every session   409 managed-externally when the hash comes from the environment
 *
 * ALLOWED EVENTS (everything else is rejected, field by field — there is no free-text field that could carry SQL or data):
 *   common   v:1, eid (opaque id), t (kind), ts (ms), uid (random per-device id, 32 hex), sid (random per-session id), ver (application version), usr (optional label, only when the deployment enabled it)
 *   session_start · active { ms } · feature { f ∈ FEATURES } · generation { k ∈ GENERATION_KINDS, ok, rv? } · session_end
 *
 * Privacy. Stored per UTC day: counters, the set of anonymous user keys (a salted SHA-256 of the device id / label — the raw value is never stored) and per-user counters. Nothing else.
 *
 * Configuration (environment):
 *   SQLA_ANALYTICS_ALLOWED_ORIGINS   REQUIRED. Comma-separated page origins that may call the service, e.g. https://basware.github.io (no path)
 *   SQLA_ANALYTICS_ADMIN_PASSWORD_HASH   the administrator password as a scrypt hash (`node server/analytics-service.mjs hash-password`). Managed centrally (platform secret / Key Vault); the dashboard cannot change it
 *   SQLA_ANALYTICS_ADMIN_PASSWORD        alternative for a platform that can only store plain secrets: hashed in memory at start-up, never logged (≥ 12 characters). The dashboard cannot change it
 *   (neither set)                        the password is read from <data dir>/admin-credential.json (written by `set-admin-password` or by the dashboard's change-password form). With NO password at all the
 *                                        administration endpoints answer 503 admin-not-configured — there is no default password and no setup endpoint
 *   SQLA_ANALYTICS_DATA_DIR          default ./analytics-data — the store (analytics-store.json) and admin-credential.json; use a persistent folder (for example /var/lib/sqla-analytics)
 *   SQLA_ANALYTICS_ADMIN_IDLE_SECONDS    default 1800 — an administrator session ends after this long without a request (60 … 28800). The page locks itself earlier (analytics.adminSessionTimeout, default 900); keep this value ≥ that one
 *   SQLA_ANALYTICS_ADMIN_MAX_SECONDS     default 28800 — and in any case this long after the login (≥ idle, ≤ 86400)
 *   SQLA_ANALYTICS_RETENTION_DAYS    default 400 (30 … 3650)
 *   SQLA_ANALYTICS_RATE_LIMIT_PER_MINUTE  default 600 telemetry requests per caller address per minute (behind a reverse proxy or a hosting platform that forwards the caller address also set SQLA_ANALYTICS_TRUST_PROXY=1, otherwise every user shares the proxy's address)
 *   SQLA_ANALYTICS_TRUST_PROXY       "1" = the caller address is the first X-Forwarded-For entry (only behind a reverse proxy you control)
 *   SQLA_ANALYTICS_AUDIT_LOG         "0" switches the audit lines off (default: one JSON line per login / lock-out / password change — never a password, token or event content)
 *   PORT                             default 8789
 *
 * Commands:  node server/analytics-service.mjs                          start the service
 *            node server/analytics-service.mjs set-admin-password        set / rotate the password in <data dir>/admin-credential.json (prompts, hidden; --stdin reads one line)
 *            node server/analytics-service.mjs hash-password             print the value for SQLA_ANALYTICS_ADMIN_PASSWORD_HASH (prompts, hidden; --stdin reads one line)
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ───────────────────────────────────────────────────────────── constants shared (by name) with src/v17/services/analyticsTracker.ts — test/v1773.test.mjs asserts that both lists are equal
export const FEATURES = ['quick-start', 'read-only-builder', 'cr-builder', 'describe-read-only', 'describe-cr', 'query-add', 'query-library', 'schema', 'github', 'error-rectifier', 'settings', 'about', 'sync', 'guided-walkthrough', 'copy-sql', 'accept-learn'];
export const GENERATION_KINDS = ['read-only', 'cr', 'describe-read-only', 'describe-cr'];
export const EVENT_TYPES = ['session_start', 'active', 'feature', 'generation', 'session_end'];
export const MAX_ACTIVE_MS_PER_EVENT = 15 * 60 * 1000;

const MIN_PASSWORD = 12; const MAX_PASSWORD = 128;
const WEAK = new Set(['password1234', 'password12345', 'administrator', 'administrator1', 'qwertyuiop12', '123456789012', 'sqlassistant', 'sqlassistant1', 'analytics1234', 'changeme1234']);
const csv = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const clampInt = (v, d, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(Math.max(n, lo), hi) : d; };
const DAY_MS = 86_400_000;

// ───────────────────────────────────────────────────────────── passwords: salted scrypt, constant-time comparison
const KDF_DEFAULT = { N: 16384, r: 8, p: 1 };
const normalizePassword = (pw) => String(pw ?? '').normalize('NFKC');
const scryptAsync = (pw, salt, N, r, p, len) => new Promise((resolve, reject) => crypto.scrypt(normalizePassword(pw), salt, len, { N, r, p, maxmem: 160 * N * r }, (e, k) => (e ? reject(e) : resolve(k))));
export function passwordProblem(pw) {
  const s = normalizePassword(pw);
  if (s.length < MIN_PASSWORD) return `The password must have at least ${MIN_PASSWORD} characters.`; if (s.length > MAX_PASSWORD) return `The password must have at most ${MAX_PASSWORD} characters.`;
  if (/^(.)\1+$/.test(s) || WEAK.has(s.toLowerCase())) return 'That password is too easy to guess. Choose a longer, less predictable one.';
  return '';
}
/** `scrypt$N$r$p$salt$hash` (base64url). The cost parameters are part of the value, so the cost can be raised later without invalidating existing hashes. */
export async function hashPassword(pw, kdf = KDF_DEFAULT) { const salt = crypto.randomBytes(16); const key = await scryptAsync(pw, salt, kdf.N, kdf.r, kdf.p, 32); return `scrypt$${kdf.N}$${kdf.r}$${kdf.p}$${salt.toString('base64url')}$${key.toString('base64url')}`; }
export function hashPasswordSync(pw, kdf = KDF_DEFAULT) { const salt = crypto.randomBytes(16); const key = crypto.scryptSync(normalizePassword(pw), salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 160 * kdf.N * kdf.r }); return `scrypt$${kdf.N}$${kdf.r}$${kdf.p}$${salt.toString('base64url')}$${key.toString('base64url')}`; }
export function parseHash(stored) {
  const m = /^scrypt\$(\d{1,8})\$(\d{1,2})\$(\d)\$([A-Za-z0-9_-]{16,64})\$([A-Za-z0-9_-]{43})$/.exec(String(stored || '').trim()); if (!m) return null;
  const N = Number(m[1]); const r = Number(m[2]); const p = Number(m[3]);
  if (N < 1024 || N > 1 << 20 || (N & (N - 1)) !== 0 || r < 1 || r > 16 || p < 1 || p > 4 || 128 * N * r > 256 * 1024 * 1024) return null; // bounded cost: a hostile value must not become a denial of service
  return { N, r, p, salt: Buffer.from(m[4], 'base64url'), key: Buffer.from(m[5], 'base64url') };
}
export async function verifyPasswordHash(pw, stored) { const h = parseHash(stored); if (!h) return false; let k; try { k = await scryptAsync(pw, h.salt, h.N, h.r, h.p, h.key.length); } catch { return false; } return k.length === h.key.length && crypto.timingSafeEqual(k, h.key); }

// ───────────────────────────────────────────────────────────── events: strict validation (the privacy boundary)
const ID = /^[A-Za-z0-9_-]{8,40}$/; const UID = /^[a-f0-9]{32}$/; const SID = /^[a-f0-9]{24,32}$/; const VER = /^[0-9A-Za-z.+_-]{1,32}$/; const USR = /^[A-Za-z0-9._-]{1,64}$/;
const COMMON = ['v', 'eid', 't', 'ts', 'uid', 'sid', 'ver', 'usr'];
const EXTRA = { session_start: [], session_end: [], active: ['ms'], feature: ['f'], generation: ['k', 'ok', 'rv'] };
/** → { ok: true, ev } with only the allowed fields, or { ok: false, reason }. No other field and no other value shape is ever accepted. */
export function validateEvent(raw, nowMs = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not-an-object' };
  const t = raw.t; if (!EVENT_TYPES.includes(t)) return { ok: false, reason: 'unknown-type' };
  const allowed = new Set([...COMMON, ...EXTRA[t]]); for (const k of Object.keys(raw)) if (!allowed.has(k)) return { ok: false, reason: 'unexpected-field' };
  if (raw.v !== 1) return { ok: false, reason: 'bad-version' };
  if (typeof raw.eid !== 'string' || !ID.test(raw.eid)) return { ok: false, reason: 'bad-id' }; if (typeof raw.uid !== 'string' || !UID.test(raw.uid)) return { ok: false, reason: 'bad-user' }; if (typeof raw.sid !== 'string' || !SID.test(raw.sid)) return { ok: false, reason: 'bad-session' };
  if (typeof raw.ver !== 'string' || !VER.test(raw.ver)) return { ok: false, reason: 'bad-app-version' }; if (raw.usr !== undefined && (typeof raw.usr !== 'string' || !USR.test(raw.usr))) return { ok: false, reason: 'bad-label' };
  let ts = nowMs; if (raw.ts !== undefined) { if (!Number.isInteger(raw.ts) || raw.ts < 0) return { ok: false, reason: 'bad-time' }; if (raw.ts >= nowMs - 7 * DAY_MS && raw.ts <= nowMs + 5 * 60_000) ts = raw.ts; } // a time outside the window (or a skewed client clock) is replaced by the server time
  const ev = { t, eid: raw.eid, ts, uid: raw.uid, sid: raw.sid, ver: raw.ver }; if (raw.usr !== undefined) ev.usr = raw.usr;
  if (t === 'active') { if (!Number.isInteger(raw.ms) || raw.ms < 1 || raw.ms > MAX_ACTIVE_MS_PER_EVENT) return { ok: false, reason: 'bad-active-time' }; ev.ms = raw.ms; }
  if (t === 'feature') { if (typeof raw.f !== 'string' || !FEATURES.includes(raw.f)) return { ok: false, reason: 'unknown-feature' }; ev.f = raw.f; }
  if (t === 'generation') { if (typeof raw.k !== 'string' || !GENERATION_KINDS.includes(raw.k) || typeof raw.ok !== 'boolean' || (raw.rv !== undefined && typeof raw.rv !== 'boolean')) return { ok: false, reason: 'bad-generation' }; ev.k = raw.k; ev.ok = raw.ok; ev.rv = raw.rv === true; }
  return { ok: true, ev };
}

// ───────────────────────────────────────────────────────────── dates (all buckets are UTC days)
export const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const parseDay = (s) => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; const t = Date.parse(`${s}T00:00:00Z`); return Number.isNaN(t) || utcDay(t) !== s ? null : t; };
const addDays = (s, n) => utcDay(Date.parse(`${s}T00:00:00Z`) + n * DAY_MS);
const weekStart = (s) => { const d = new Date(`${s}T00:00:00Z`); return addDays(s, -((d.getUTCDay() + 6) % 7)); }; // Monday

// ───────────────────────────────────────────────────────────── the store: per-day roll-ups (no raw events)
const emptyDay = () => ({ sessions: 0, activeMs: 0, users: {}, features: {}, versions: {}, gen: { ok: 0, fail: 0, review: 0 } });
const FORMAT = 'sqla-analytics-store';

export function createAnalyticsService(env = process.env, opts = {}) {
  const origins = new Set(csv(env.SQLA_ANALYTICS_ALLOWED_ORIGINS).map((o) => o.replace(/\/+$/, '')));
  if (!origins.size || [...origins].some((o) => !/^https?:\/\/[^/\s]+$/.test(o))) throw new Error('SQLA_ANALYTICS_ALLOWED_ORIGINS must list the origin(s) that serve SQL Assistant, e.g. https://basware.github.io (no path).');
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const dataDir = path.resolve(String(opts.dataDir || env.SQLA_ANALYTICS_DATA_DIR || 'analytics-data'));
  const idleMs = clampInt(env.SQLA_ANALYTICS_ADMIN_IDLE_SECONDS, 1800, 60, 28800) * 1000; const maxMs = Math.max(idleMs, clampInt(env.SQLA_ANALYTICS_ADMIN_MAX_SECONDS, 28800, 60, 86400) * 1000);
  const retentionDays = clampInt(env.SQLA_ANALYTICS_RETENTION_DAYS, 400, 30, 3650); const LIMIT = clampInt(env.SQLA_ANALYTICS_RATE_LIMIT_PER_MINUTE, 600, 10, 100000);
  const trustProxy = env.SQLA_ANALYTICS_TRUST_PROXY === '1'; const audit = env.SQLA_ANALYTICS_AUDIT_LOG !== '0'; const auditOut = typeof opts.auditSink === 'function' ? opts.auditSink : (l) => process.stdout.write(`${l}\n`);
  const kdf = opts.kdf || KDF_DEFAULT;
  const note = (o) => { if (audit) auditOut(JSON.stringify({ t: new Date(now()).toISOString(), ...o })); };

  // ── persistence (atomic; falls back to memory when the folder cannot be written — reported by healthz-less logs only)
  let storage = 'file'; try { fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 }); fs.accessSync(dataDir, fs.constants.W_OK); } catch { storage = 'memory'; }
  const storePath = path.join(dataDir, 'analytics-store.json'); const credPath = path.join(dataDir, 'admin-credential.json');
  const writeAtomic = (file, text, mode) => { const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`; fs.writeFileSync(tmp, text, { mode }); fs.renameSync(tmp, file); };
  let store = { format: FORMAT, formatVersion: 1, salt: crypto.randomBytes(16).toString('base64url'), days: {}, sessions: {} };
  if (storage === 'file' && fs.existsSync(storePath)) { try { const j = JSON.parse(fs.readFileSync(storePath, 'utf8')); if (j && j.format === FORMAT && j.formatVersion === 1 && typeof j.salt === 'string' && j.days && typeof j.days === 'object') { store = j; store.sessions = store.sessions && typeof store.sessions === 'object' ? store.sessions : {}; } } catch { /* a damaged store is not overwritten silently: it is kept next to the new one */ try { fs.renameSync(storePath, `${storePath}.damaged-${Date.now()}`); } catch { /* */ } } }
  let dirty = false; const flush = () => { if (!dirty || storage !== 'file') return; try { writeAtomic(storePath, JSON.stringify(store), 0o600); dirty = false; } catch { /* retried at the next flush */ } };
  const prune = () => { const cut = utcDay(now() - retentionDays * DAY_MS); for (const d of Object.keys(store.days)) if (d < cut) { delete store.days[d]; dirty = true; } const n = now(); for (const [k, v] of Object.entries(store.sessions)) if (n - v.l > 2 * DAY_MS) { delete store.sessions[k]; dirty = true; } };
  prune(); const timer = setInterval(() => { flush(); }, 10_000); timer.unref?.(); const pruneTimer = setInterval(prune, 6 * 3600_000); pruneTimer.unref?.();

  // ── admin credential: environment hash > environment plain password (hashed now) > file. Never a default.
  const envHash = String(env.SQLA_ANALYTICS_ADMIN_PASSWORD_HASH || '').trim(); const envPlain = String(env.SQLA_ANALYTICS_ADMIN_PASSWORD || '');
  if (envHash && !parseHash(envHash)) throw new Error('SQLA_ANALYTICS_ADMIN_PASSWORD_HASH is not a valid hash — create it with: node server/analytics-service.mjs hash-password');
  if (!envHash && envPlain && passwordProblem(envPlain)) throw new Error(`SQLA_ANALYTICS_ADMIN_PASSWORD is not acceptable: ${passwordProblem(envPlain)}`);
  const managedHash = envHash || (envPlain ? hashPasswordSync(envPlain, kdf) : '');
  const fingerprint = (h) => crypto.createHash('sha256').update(h).digest('hex').slice(0, 12);
  let credCache = { mtime: -1, value: null };
  const credential = () => { // { source, hash, version } | null — a changed file (the command line rotated it) is picked up without a restart
    if (managedHash) return { source: 'env', hash: managedHash, version: fingerprint(managedHash) };
    if (storage !== 'file') return credCache.value;
    try { const st = fs.statSync(credPath); if (st.mtimeMs !== credCache.mtime) { const j = JSON.parse(fs.readFileSync(credPath, 'utf8')); credCache = { mtime: st.mtimeMs, value: j && j.format === 'sqla-analytics-admin-credential' && parseHash(j.hash) ? { source: 'file', hash: j.hash, version: `${j.version || 1}:${fingerprint(j.hash)}` } : null }; } return credCache.value; }
    catch { credCache = { mtime: -1, value: credCache.value && storage !== 'file' ? credCache.value : null }; return credCache.value; }
  };
  async function writeCredential(newHash) { const cur = credential(); const version = (cur && cur.source === 'file' ? Number(String(cur.version).split(':')[0]) || 0 : 0) + 1; writeAtomic(credPath, `${JSON.stringify({ format: 'sqla-analytics-admin-credential', formatVersion: 1, hash: newHash, version, updatedAt: new Date(now()).toISOString() }, null, 2)}\n`, 0o600); credCache = { mtime: -1, value: null }; }

  // ── sessions (in memory: a restart ends every session — the administrator signs in again)
  const sessions = new Map(); const tokenKey = (t) => crypto.createHash('sha256').update(t).digest('hex');
  const sweepSessions = () => { const n = now(); for (const [k, s] of sessions) if (n - s.last > idleMs || n - s.created > maxMs) sessions.delete(k); };
  const startSession = (version) => { sweepSessions(); if (sessions.size >= 50) { const oldest = [...sessions.entries()].sort((a, b) => a[1].last - b[1].last)[0]; if (oldest) sessions.delete(oldest[0]); } const token = `an1.${crypto.randomBytes(32).toString('base64url')}`; const n = now(); sessions.set(tokenKey(token), { created: n, last: n, version }); return { token, expiresAt: n + Math.min(idleMs, maxMs) }; };
  const readSession = (req) => {
    const m = /^Bearer (an1\.[A-Za-z0-9_-]{43})$/.exec(String(req.headers.authorization || '')); if (!m) return null; const k = tokenKey(m[1]); const s = sessions.get(k); if (!s) return null;
    const n = now(); const c = credential(); if (n - s.last > idleMs || n - s.created > maxMs || !c || c.version !== s.version) { sessions.delete(k); return null; } s.last = n; return { key: k, session: s };
  };

  // ── limiters
  const addrOf = (req) => { let a = req.socket?.remoteAddress || 'unknown'; if (trustProxy) { const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (f) a = f; } return a; };
  const hits = new Map(); const rate = (k, limit) => { const m = Math.floor(now() / 60000); const h = hits.get(k); if (!h || h.m !== m) { hits.set(k, { m, n: 1 }); if (hits.size > 20000) hits.clear(); return false; } return ++h.n > limit; };
  const fails = new Map(); let globalFails = []; // per caller address: consecutive failures and lock-out level; plus a global back-stop
  const lockLeft = (addr) => { const f = fails.get(addr); const n = now(); const g = globalFails.filter((t) => n - t < 3600_000); globalFails = g; const gl = g.length >= 100 ? Math.ceil((g[g.length - 1] + 60_000 - n) / 1000) : 0; /* back-stop: after 100 failures within an hour every login waits a minute after the latest failure */ const al = f && f.until > n ? Math.ceil((f.until - n) / 1000) : 0; return Math.max(al, gl, 0); };
  const failure = (addr) => { const f = fails.get(addr) || { n: 0, level: 0, until: 0, last: 0 }; const n = now(); if (n - f.last > 3600_000) { f.n = 0; f.level = 0; } f.last = n; f.n += 1; if (f.n >= 5) { f.level += 1; f.n = 0; f.until = n + Math.min(900_000, 30_000 * 2 ** (f.level - 1)) ; } fails.set(addr, f); globalFails.push(n); if (fails.size > 5000) fails.clear(); };
  const success = (addr) => { fails.delete(addr); };

  // ── ingest
  const seenEvents = new Map(); // eid → expiry (duplicates of a retried batch are ignored; kept in memory only). The sessions seen in the last two days are part of the persisted store, so a restart never turns a running session into a new one.
  const pruneSeen = () => { const n = now(); if (seenEvents.size > 200000) for (const [k, v] of seenEvents) if (v < n) seenEvents.delete(k); };
  const userKey = (ev) => crypto.createHash('sha256').update(`${store.salt}:${ev.usr || ev.uid}`).digest('hex').slice(0, 24);
  function apply(ev) {
    const n = now(); if (seenEvents.has(ev.eid)) return 'duplicate'; seenEvents.set(ev.eid, n + 2 * DAY_MS);
    const day = utcDay(ev.ts); const d = (store.days[day] ||= emptyDay()); const uk = userKey(ev); const u = (d.users[uk] ||= { s: 0, a: 0 });
    let sess = store.sessions[ev.sid];
    if (!sess) { sess = { f: ev.ts, a: 0, l: n, u: uk }; store.sessions[ev.sid] = sess; d.sessions += 1; u.s += 1; const v = (d.versions[ev.ver] ||= { s: 0, u: [] }); v.s += 1; if (!v.u.includes(uk)) v.u.push(uk); } sess.l = n; if (ev.ts < sess.f) sess.f = ev.ts;
    if (ev.t === 'active') { // the claimed active time can never exceed the time that has really passed since the session was first seen (a page cannot claim more time than exists)
      const room = Math.max(0, ev.ts - sess.f + 90_000 - sess.a); const ms = Math.min(ev.ms, room); dirty = true; if (ms <= 0) return 'rejected-time'; sess.a += ms; d.activeMs += ms; u.a += ms; }
    else if (ev.t === 'feature') d.features[ev.f] = (d.features[ev.f] || 0) + 1;
    else if (ev.t === 'generation') { if (ev.ok) { d.gen.ok += 1; if (ev.rv) d.gen.review += 1; } else d.gen.fail += 1; }
    dirty = true; return 'ok';
  }

  // ── the dashboard numbers
  function summary(fromS, toS) {
    const today = utcDay(now()); let to = toS ? parseDay(toS) : parseDay(today); let from = fromS ? parseDay(fromS) : null; if (to === null || (fromS && from === null)) return { error: 'bad-range' };
    const toDay = utcDay(to); if (from === null) from = to - 29 * DAY_MS; const fromDay = utcDay(from); if (fromDay > toDay) return { error: 'bad-range' }; const span = Math.round((to - from) / DAY_MS) + 1; if (span > 800) return { error: 'range-too-large' };
    const ref = toDay > today ? today : toDay; const keys = []; for (let i = 0; i < span; i += 1) keys.push(addDays(fromDay, i));
    const agg = (dayList) => { const users = new Set(); let sessions = 0; let activeMs = 0; let ok = 0; let fail = 0; let review = 0; for (const k of dayList) { const d = store.days[k]; if (!d) continue; sessions += d.sessions; activeMs += d.activeMs; ok += d.gen.ok; fail += d.gen.fail; review += d.gen.review; for (const uk of Object.keys(d.users)) users.add(uk); } return { users, sessions, activeMs, ok, fail, review }; };
    const row = (label, a) => ({ label, users: a.users.size, sessions: a.sessions, activeMs: a.activeMs, generations: a.ok + a.fail, success: a.ok, failure: a.fail, review: a.review });
    const total = agg(keys); const window = (n) => { const l = []; for (let i = 0; i < n; i += 1) l.push(addDays(ref, -i)); return agg(l).users.size; };
    const daily = keys.map((k) => ({ date: k, ...row(k, agg([k])) })); const group = (fn) => { const m = new Map(); for (const k of keys) { const g = fn(k); (m.get(g) || m.set(g, []).get(g)).push(k); } return [...m.entries()].map(([g, l]) => ({ ...row(g, agg(l)), key: g, days: l.length })); };
    const weekly = group(weekStart).map((r) => ({ weekStart: r.key, ...r })); const monthly = group((k) => k.slice(0, 7)).map((r) => ({ month: r.key, ...r }));
    const features = {}; const versions = new Map(); for (const k of keys) { const d = store.days[k]; if (!d) continue; for (const [f, c] of Object.entries(d.features)) features[f] = (features[f] || 0) + c; for (const [v, x] of Object.entries(d.versions)) { const e = versions.get(v) || { sessions: 0, users: new Set() }; e.sessions += x.s; x.u.forEach((u) => e.users.add(u)); versions.set(v, e); } }
    const gen = total.ok + total.fail; const earliest = Object.keys(store.days).sort()[0] || null;
    return { range: { from: fromDay, to: toDay, days: span, referenceDay: ref, timezone: 'UTC' }, generatedAt: new Date(now()).toISOString(), dataSince: earliest, retentionDays,
      kpi: { uniqueUsers: total.users.size, dailyActiveUsers: window(1), weeklyActiveUsers: window(7), monthlyActiveUsers: window(30), totalSessions: total.sessions, totalActiveMs: total.activeMs, averageActiveMsPerSession: total.sessions ? Math.round(total.activeMs / total.sessions) : 0, averageActiveMsPerUser: total.users.size ? Math.round(total.activeMs / total.users.size) : 0, generated: gen, successful: total.ok, failed: total.fail, needsReview: total.review, successRate: gen ? Math.round((total.ok / gen) * 1000) / 10 : null },
      daily: daily.map(({ label, ...r }) => r), weekly: weekly.map(({ label, key, ...r }) => r), monthly: monthly.map(({ label, key, ...r }) => r),
      features: Object.entries(features).map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
      versions: [...versions.entries()].map(([version, x]) => ({ version, sessions: x.sessions, users: x.users.size })).sort((a, b) => b.sessions - a.sessions || a.version.localeCompare(b.version)) };
  }

  // ── tiny HTTP helpers
  async function readBody(req, limit) { let size = 0; const chunks = []; for await (const c of req) { size += c.length; if (size > limit) return { tooLarge: true }; chunks.push(c); } if (!size) return { json: {} }; try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? { json: j } : { bad: true }; } catch { return { bad: true }; } }

  const server = http.createServer(async (req, res) => {
    const origin = String(req.headers.origin || '').replace(/\/+$/, ''); const allowed = origins.has(origin);
    const send = (st, obj, extra = {}) => { const h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin', ...extra }; if (allowed) { h['Access-Control-Allow-Origin'] = origin; h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'; h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'; h['Access-Control-Max-Age'] = '600'; } res.writeHead(st, h); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    const url = new URL(req.url || '/', 'http://x'); const p = url.pathname; const addr = addrOf(req);
    try {
      if (req.method === 'GET' && p === '/healthz') return send(200, { ok: true, adminConfigured: !!credential() });
      if (!allowed) return send(403, { error: 'origin-not-allowed' });
      if (req.method === 'OPTIONS') return send(204);

      // ───────── telemetry
      if (req.method === 'POST' && p === '/v1/events') {
        if (rate(`ev:${addr}`, LIMIT)) return send(429, { error: 'rate-limited' });
        const b = await readBody(req, 64 * 1024); if (b.tooLarge) return send(413, { error: 'too-large' }); if (b.bad || !Array.isArray(b.json.events) || b.json.events.length > 100) return send(400, { error: 'bad-request' });
        let accepted = 0; let rejected = 0; const t = now(); pruneSeen();
        for (const raw of b.json.events) { const v = validateEvent(raw, t); if (!v.ok) { rejected += 1; continue; } if (rate(`uid:${v.ev.uid}`, 300)) { rejected += 1; continue; } const r = apply(v.ev); if (r === 'ok' || r === 'duplicate') accepted += 1; else rejected += 1; }
        return send(200, { accepted, rejected });
      }

      // ───────── administration
      if (req.method === 'POST' && p === '/v1/admin/login') {
        const c = credential(); if (!c) return send(503, { error: 'admin-not-configured' });
        const wait = lockLeft(addr); if (wait > 0) { note({ event: 'admin-login', outcome: 'locked', addr: fingerprint(addr) }); return send(429, { error: 'locked', retryAfterSeconds: wait }, { 'Retry-After': String(wait) }); }
        const b = await readBody(req, 4096); if (b.tooLarge) return send(413, { error: 'too-large' }); if (b.bad || typeof b.json.password !== 'string' || !b.json.password || b.json.password.length > 1024) { failure(addr); return send(401, { error: 'invalid-credentials' }); }
        if (await verifyPasswordHash(b.json.password, c.hash)) { success(addr); const s = startSession(c.version); note({ event: 'admin-login', outcome: 'ok', addr: fingerprint(addr) }); return send(200, { token: s.token, expiresAt: s.expiresAt, idleSeconds: Math.round(idleMs / 1000), maxSeconds: Math.round(maxMs / 1000), passwordManagedExternally: c.source === 'env' }); }
        failure(addr); note({ event: 'admin-login', outcome: 'invalid', addr: fingerprint(addr) }); return send(401, { error: 'invalid-credentials' });
      }
      if (req.method === 'POST' && p === '/v1/admin/logout') { const s = readSession(req); if (s) sessions.delete(s.key); return send(200, { ok: true }); }
      if (req.method === 'GET' && p === '/v1/admin/summary') {
        const s = readSession(req); if (!s) return send(401, { error: 'session-invalid' }); if (rate(`sum:${s.key}`, 60)) return send(429, { error: 'rate-limited' });
        const r = summary(url.searchParams.get('from') || '', url.searchParams.get('to') || ''); if (r.error) return send(400, { error: r.error }); return send(200, r);
      }
      if (req.method === 'POST' && p === '/v1/admin/password') {
        const s = readSession(req); if (!s) return send(401, { error: 'session-invalid' }); const c = credential(); if (!c) return send(503, { error: 'admin-not-configured' });
        if (c.source === 'env') return send(409, { error: 'managed-externally' });
        const wait = lockLeft(addr); if (wait > 0) return send(429, { error: 'locked', retryAfterSeconds: wait }, { 'Retry-After': String(wait) });
        const b = await readBody(req, 4096); if (b.tooLarge) return send(413, { error: 'too-large' }); if (b.bad || typeof b.json.currentPassword !== 'string' || typeof b.json.newPassword !== 'string') return send(400, { error: 'bad-request' });
        if (!(await verifyPasswordHash(b.json.currentPassword, c.hash))) { failure(addr); note({ event: 'admin-password-change', outcome: 'invalid-current', addr: fingerprint(addr) }); return send(401, { error: 'invalid-credentials' }); } success(addr);
        const problem = passwordProblem(b.json.newPassword); if (problem) return send(422, { error: 'weak-password', message: problem });
        if (normalizePassword(b.json.newPassword) === normalizePassword(b.json.currentPassword)) return send(422, { error: 'weak-password', message: 'The new password must differ from the current one.' });
        try { await writeCredential(await hashPassword(b.json.newPassword, kdf)); } catch { return send(500, { error: 'storage-failed' }); }
        sessions.clear(); note({ event: 'admin-password-change', outcome: 'ok', addr: fingerprint(addr) }); return send(200, { ok: true, reauthenticate: true });
      }
      return send(404, { error: 'not-found-route' });
    } catch { return send(500, { error: 'internal' }); } // never echo the exception
  });

  return {
    server, flush, listen: (port, host) => new Promise((resolve) => server.listen(port, host || '127.0.0.1', () => resolve(server.address().port))),
    close: () => new Promise((resolve) => { clearInterval(timer); clearInterval(pruneTimer); flush(); server.close(() => resolve()); server.closeAllConnections?.(); }),
    info: { dataDir, storage, retentionDays, idleSeconds: idleMs / 1000, maxSeconds: maxMs / 1000, credentialSource: () => credential()?.source || 'none' },
    /** test / operations seams (no secret): the number of live administrator sessions and the roll-up of one day */
    _sessions: () => sessions.size, _day: (d) => store.days[d] || null, _store: () => store,
  };
}

// ───────────────────────────────────────────────────────────── command line
async function readSecret(prompt, fromStdin) {
  if (fromStdin || !process.stdin.isTTY) { const chunks = []; for await (const c of process.stdin) chunks.push(c); return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0]; }
  process.stdout.write(prompt); return new Promise((resolve) => { let s = ''; process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8'); process.stdin.on('data', function onData(ch) { for (const c of ch) { if (c === '\r' || c === '\n' || c === '\u0004') { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.removeListener('data', onData); process.stdout.write('\n'); return resolve(s); } if (c === '\u0003') process.exit(130); if (c === '\u007f' || c === '\b') s = s.slice(0, -1); else s += c; } }); });
}
async function main(argv) {
  const cmd = argv[2]; const stdin = argv.includes('--stdin');
  if (cmd === 'hash-password' || cmd === 'set-admin-password') {
    const pw = await readSecret('New administrator password: ', stdin); if (!stdin && process.stdin.isTTY) { const again = await readSecret('Repeat the password: ', false); if (again !== pw) { process.stderr.write('The two entries differ. Nothing was changed.\n'); process.exit(1); } }
    const bad = passwordProblem(pw); if (bad) { process.stderr.write(`${bad} Nothing was changed.\n`); process.exit(1); } const h = await hashPassword(pw);
    if (cmd === 'hash-password') { process.stdout.write(`${h}\n`); process.stderr.write('Store this value as SQLA_ANALYTICS_ADMIN_PASSWORD_HASH (a platform secret). It is a hash, not the password.\n'); return; }
    const dir = path.resolve(String((argv.indexOf('--data-dir') > 0 && argv[argv.indexOf('--data-dir') + 1]) || process.env.SQLA_ANALYTICS_DATA_DIR || 'analytics-data')); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); const file = path.join(dir, 'admin-credential.json');
    let version = 1; try { version = (Number(JSON.parse(fs.readFileSync(file, 'utf8')).version) || 0) + 1; } catch { /* first password */ }
    const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, `${JSON.stringify({ format: 'sqla-analytics-admin-credential', formatVersion: 1, hash: h, version, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(tmp, file);
    process.stdout.write(`The administrator password was ${version > 1 ? 'changed' : 'set'} (${file}). A running service uses it at once; open administrator sessions end.\n`); return;
  }
  if (cmd && !cmd.startsWith('-')) { process.stderr.write(`Unknown command "${cmd}". Commands: set-admin-password, hash-password (or none, to start the service).\n`); process.exit(2); }
  let svc; try { svc = createAnalyticsService(); } catch (e) { process.stderr.write(`SQL Assistant analytics service: ${e.message}\n`); process.exit(1); }
  const port = Number(process.env.PORT) || 8789; await svc.listen(port, process.env.HOST || '0.0.0.0');
  const src = svc.info.credentialSource(); process.stdout.write(`SQL Assistant analytics service listening on :${port} — administrator password ${src === 'none' ? 'NOT SET (run: node server/analytics-service.mjs set-admin-password, or set SQLA_ANALYTICS_ADMIN_PASSWORD_HASH)' : `configured (${src})`}; storage ${svc.info.storage}${svc.info.storage === 'file' ? ` (${svc.info.dataDir})` : ' — the data folder is not writable, usage is kept in memory only'}.\n`);
  const stop = async () => { await svc.close(); process.exit(0); }; process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv).catch((e) => { process.stderr.write(`SQL Assistant analytics service: ${e && e.message ? e.message : 'failed'}\n`); process.exit(1); });
