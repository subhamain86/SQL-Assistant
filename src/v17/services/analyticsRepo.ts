/**
 * V17.7.4 — USAGE ANALYTICS, serverless provider ("repository"): everything between the encrypted files in the repository and the dashboard. No server, no cloud credential.
 *
 *   <base>/public-key.json          the administrator's PUBLIC key (devices encrypt to it)                    — also pinnable in analytics.config.json
 *   <base>/admin-key.json           the administrator's PRIVATE key(s), wrapped with the administrator password (analyticsCrypto.ts)
 *   <base>/events/YYYY-MM-DD/<id>.json one ENCRYPTED batch of usage events, written once by one device (random 128-bit name, create-only: no write conflict, nothing that links two batches or names a user).
 *                                  One folder per UTC day because GitHub lists at most 1000 files of a folder; "Compact" merges finished days into the monthly roll-ups
 *   <base>/rollups/YYYY-MM.json     an ENCRYPTED monthly roll-up written by the administrator's "Compact" (replaces the batch files it merged)
 *
 * Devices only WRITE (and read the public key). Only an administrator who knows the password can read: the dashboard fetches the files, decrypts them in memory, aggregates them in memory (UsageModel) and drops
 * everything when Analytics is locked. Nothing decrypted, no private key and no password is ever stored.
 *
 * The repository is reached through an injected `RepoIO` (the application passes its ONE repository connection — token, or the in-memory repository of the browser tests), so this module has no network code,
 * no credential and no knowledge of GitHub. Every failure of the write path is a RESULT for the tracker (queue and retry) — never an exception into the application.
 */
import { repositoryErrorKind, type RepoEntry, type RepoFile, type SchemaRepository } from './githubClient';
import * as C from './analyticsCrypto';
import { validateEvent, UsageModel, parseRollup, monthsBetween, utcDay, utcMonth, type Rollup } from './analyticsAggregate';
import type { AnalyticsEvent, TelemetrySink, SendResult } from './analyticsTracker';
import type { AnalyticsSummary } from './analyticsAdmin';

export const DEFAULT_ANALYTICS_PATH = 'sql-assistant-data/analytics';
export const BATCH_COMMIT_MESSAGE = 'SQL Assistant usage batch'; export const ROLLUP_COMMIT_MESSAGE = 'SQL Assistant usage roll-up'; export const KEY_COMMIT_MESSAGE = 'SQL Assistant usage analytics key';
export const MAX_FILES_PER_LOAD = 3000; export const MAX_FILES_PER_COMPACTION = 300; const DAY_MS = 86_400_000;
/** a location below sql-assistant-data/ made of safe segments (the same folder rules as the rest of the repository data) */
export const validAnalyticsPath = (p: unknown): p is string => typeof p === 'string' && p.length <= 120 && /^sql-assistant-data\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(p) && !p.split('/').some((s) => s === '.' || s === '..' || s.startsWith('.'));
export const analyticsPaths = (base: string) => ({ adminKey: `${base}/admin-key.json`, publicKey: `${base}/public-key.json`, eventsDir: `${base}/events`, rollupsDir: `${base}/rollups`, dayDir: (d: string) => `${base}/events/${d}`, eventFile: (d: string, id: string) => `${base}/events/${d}/${id}.json`, rollupFile: (m: string) => `${base}/rollups/${m}.json` });

export interface RepoIO { describe: string; read(path: string): Promise<RepoFile | null>; write(path: string, text: string, sha: string | null, message: string): Promise<string>; list(dir: string): Promise<RepoEntry[]>; remove(path: string, sha: string, message: string): Promise<void>; }
export class RepoUnsupportedError extends Error { constructor(what: string) { super(`${what} is not available through this repository connection.`); this.name = 'RepoUnsupportedError'; } }
/** The application's repository connection as a RepoIO. Listing and deleting exist for the token connection; central access (broker) and the published copy do not — said plainly, never guessed. */
export function repoIOFrom(repo: SchemaRepository | null): RepoIO | null {
  if (!repo) return null;
  return { describe: repo.describe, read: (p) => repo.read(p), write: (p, t, s, m) => repo.write(p, t, s, m),
    list: (d) => (repo.list ? repo.list(d) : Promise.reject(new RepoUnsupportedError('Reading the analytics folder'))), remove: (p, s, m) => (repo.remove ? repo.remove(p, s, m) : Promise.reject(new RepoUnsupportedError('Deleting analytics files'))) };
}

// ───────────────────────────────────────────────────────────── results the page can show (no secret, no file content in any message)
export type RepoFailure = 'no-repository' | 'not-set-up' | 'already-set-up' | 'invalid-password' | 'weak-password' | 'bad-key-file' | 'unreadable' | 'no-write' | 'unsupported' | 'conflict' | 'partial' | 'crypto' | 'unexpected';
export type RepoResult<T> = ({ ok: true } & T) | { ok: false; kind: RepoFailure; message: string };
export const REPO_MESSAGES: Record<RepoFailure, string> = {
  'no-repository': 'No repository connection is available on this device (a GitHub access token with access to the repository is needed to read or write Analytics). SQL Assistant itself is not affected.',
  'not-set-up': 'Analytics has not been set up in the repository yet. An administrator has to set it up first.',
  'already-set-up': 'Analytics is already set up in this repository. Use Change password or Rotate keys.',
  'invalid-password': 'Invalid administrator password',
  'weak-password': 'The password was not accepted.',
  'bad-key-file': 'The Analytics key file in the repository is damaged or does not have the expected format (or its password protection is weaker than allowed), so it was not used.',
  unreadable: 'The Analytics files could not be read from the repository (check the connection and that the access token may read the repository).',
  'no-write': 'The repository did not accept the change: the access token on this device cannot write to the repository (Contents: Read and write is needed).',
  unsupported: 'This repository connection cannot list or delete files (central repository access does not support it). Use a device with a personal GitHub access token for administration.',
  conflict: 'The file changed in the repository while this was being done. Reload and try again.',
  partial: 'The change was only partly applied — see the message and repeat the action.',
  crypto: 'This browser cannot run the cryptography Analytics needs (WebCrypto).',
  unexpected: 'Something unexpected went wrong. SQL Assistant itself is not affected.',
};
const fail = <T>(kind: RepoFailure, message?: string): RepoResult<T> => ({ ok: false, kind, message: message || REPO_MESSAGES[kind] });
function mapError<T>(e: unknown, writing: boolean): RepoResult<T> {
  if (e instanceof RepoUnsupportedError || (e && (e as { name?: string }).name === 'RepoUnsupportedError')) return fail('unsupported');
  const ck = C.cryptoFailure(e); if (ck === 'invalid-password') return fail('invalid-password'); if (ck === 'bad-key-file' || ck === 'weak-kdf') return fail('bad-key-file'); if (ck === 'unsupported') return fail('unexpected');
  const k = repositoryErrorKind(e); if (k === 'conflict') return fail('conflict'); if (writing && (k === 'permission' || k === 'auth' || k === 'pat-insufficient' || k === 'pat-rejected' || k === 'signin')) return fail('no-write'); if (k) return fail(writing && k === 'not-found' ? 'no-write' : 'unreadable');
  return fail(writing ? 'no-write' : 'unreadable');
}
const hasCrypto = (): boolean => C.cryptoAvailable();

// ───────────────────────────────────────────────────────────── the device side: encrypt + write
interface PublicKeyFile { format: typeof C.PUBLIC_KEY_FORMAT; formatVersion: 1; current: C.PublicKeyRecord; updatedAt: string }
export function publicKeyFileText(rec: C.PublicKeyRecord, at: string): string { const f: PublicKeyFile = { format: C.PUBLIC_KEY_FORMAT, formatVersion: 1, current: rec, updatedAt: at }; return `${JSON.stringify(f, null, 2)}\n`; }
export async function readPublicKey(io: RepoIO, base: string): Promise<C.PublicKeyRecord | null> {
  const f = await io.read(analyticsPaths(base).publicKey); if (!f) return null; let j: unknown; try { j = JSON.parse(f.text); } catch { return null; } const o = j as Partial<PublicKeyFile> | null; if (!o || o.format !== C.PUBLIC_KEY_FORMAT || o.formatVersion !== 1) return null; return C.validatePublicKeyRecord(o.current);
}
export interface SinkDeps { io: () => RepoIO | null; base: string; pinned: C.PublicKeyRecord | null; now?: () => number; randomId?: () => string; keyTtlMs?: number; }
const MINUTE = 60_000;
/** Encrypts a batch of events to the administrator's public key and writes it as ONE new file. Every problem is a SendResult for the tracker (queue + back-off); it never throws. */
export class RepositoryTelemetrySink implements TelemetrySink {
  private key: C.PublicKeyRecord | null; private keyAt = 0; constructor(private d: SinkDeps) { this.key = d.pinned; this.keyAt = d.pinned ? Number.MAX_SAFE_INTEGER : 0; }
  /** forget the cached public key (the administrator's own device after a rotation); every other device re-reads it within `keyTtlMs` */
  forgetKey(): void { if (!this.d.pinned) { this.key = null; this.keyAt = 0; } }
  private async publicKey(io: RepoIO, now: number): Promise<C.PublicKeyRecord | null> {
    if (this.d.pinned) return this.d.pinned; if (this.key && now - this.keyAt < (this.d.keyTtlMs ?? 60 * MINUTE)) return this.key;
    const k = await readPublicKey(io, this.d.base); if (k) { this.key = k; this.keyAt = now; return k; } return this.key; // a key that was read once keeps being used if a later read fails
  }
  async send(events: AnalyticsEvent[]): Promise<SendResult> {
    try {
      if (!hasCrypto()) return { ok: false, permanent: true, reason: 'no-webcrypto' };
      const io = this.d.io(); if (!io) return { ok: false, permanent: false, reason: 'no-repository', retryAfterMs: 15 * MINUTE }; const now = (this.d.now ?? Date.now)();
      let key: C.PublicKeyRecord | null; try { key = await this.publicKey(io, now); } catch (e) { return this.mapWrite(e); } if (!key) return { ok: false, permanent: false, reason: 'not-set-up', retryAfterMs: 10 * MINUTE };
      const env = await C.encryptFor(key, C.BATCH_FORMAT, { v: 1, sent: now, events }); const text = JSON.stringify(env); const day = utcDay(now);
      for (let attempt = 0; attempt < 2; attempt += 1) { const id = (this.d.randomId ?? (() => C.randomHexId(16)))(); try { await io.write(analyticsPaths(this.d.base).eventFile(day, id), text, null, BATCH_COMMIT_MESSAGE); return { ok: true }; } catch (e) { if (repositoryErrorKind(e) === 'conflict' && attempt === 0) continue; return this.mapWrite(e); } }
      return { ok: false, permanent: false, reason: 'conflict' };
    } catch { return { ok: false, permanent: false, reason: 'error' }; }
  }
  private mapWrite(e: unknown): SendResult {
    const k = repositoryErrorKind(e); if (k === 'permission' || k === 'auth' || k === 'pat-insufficient' || k === 'pat-rejected' || k === 'signin') return { ok: false, permanent: false, reason: 'no-write-access', retryAfterMs: 60 * MINUTE };
    if (k === 'not-found' || k === 'config') return { ok: false, permanent: false, reason: 'repository-unavailable', retryAfterMs: 60 * MINUTE }; return { ok: false, permanent: false, reason: k || 'unreachable' };
  }
}

// ───────────────────────────────────────────────────────────── administration: set-up, unlock, change password, rotate keys
export interface RepoSession { io: RepoIO; base: string; unlocked: C.UnlockedKeys; adminSha: string; cache: Map<string, CachedFile>; }
interface CachedFile { sha: string; events?: AnalyticsEvent[]; rollup?: Rollup; damaged?: boolean }
export interface PinSnippet { kid: string; jwk: C.PublicJwk }
const pinOf = (r: C.PublicKeyRecord): PinSnippet => ({ kid: r.kid, jwk: r.jwk });

/** First-time set-up. Refuses when a key file already exists (nobody is silently locked out or replaced). Writes the key file FIRST, then the public key. */
export async function setupAnalyticsRepo(io: RepoIO | null, base: string, password: string, opts: { iterations?: number } = {}): Promise<RepoResult<{ pin: PinSnippet }>> {
  if (!io) return fail('no-repository'); if (!hasCrypto()) return fail('crypto'); const p = analyticsPaths(base);
  const problem = C.analyticsPasswordProblem(password); if (problem) return fail('weak-password', problem);
  try {
    let exists: RepoFile | null; try { exists = await io.read(p.adminKey); } catch (e) { return mapError(e, false); } if (exists) return fail('already-set-up');
    const u = await C.createAdminKeyFile(password, { iterations: opts.iterations }); const at = new Date().toISOString();
    try { await io.write(p.adminKey, `${JSON.stringify(u.file, null, 2)}\n`, null, KEY_COMMIT_MESSAGE); } catch (e) { const r = mapError<{ pin: PinSnippet }>(e, true); return !r.ok && r.kind === 'conflict' ? fail('already-set-up') : r; }
    try { await io.write(p.publicKey, publicKeyFileText(u.current, at), null, KEY_COMMIT_MESSAGE); } catch (e) { const r = mapError<{ pin: PinSnippet }>(e, true); return fail('partial', `The key file was written but the public key could not be published (${r.ok ? '' : r.message}) Unlock Analytics and use "Publish public key" to finish.`); }
    return { ok: true, pin: pinOf(u.current) };
  } catch (e) { return mapError(e, true); }
}
/** Checks the password against the key file and keeps the unwrapped keys in memory (inside the returned session). A wrong password → `invalid-password`, nothing else is revealed. */
export async function unlockAnalyticsRepo(io: RepoIO | null, base: string, password: string): Promise<RepoResult<{ session: RepoSession }>> {
  if (!io) return fail('no-repository'); if (!hasCrypto()) return fail('crypto');
  let f: RepoFile | null; try { f = await io.read(analyticsPaths(base).adminKey); } catch (e) { return mapError(e, false); } if (!f) return fail('not-set-up');
  try { const unlocked = await C.unlockAdminKeyFile(f.text, password); return { ok: true, session: { io, base, unlocked, adminSha: f.sha, cache: new Map() } }; } catch (e) { return mapError(e, false); }
}
async function readFreshKeyFile(s: RepoSession): Promise<{ file: C.AdminKeyFile; sha: string } | RepoResult<never>> {
  let f: RepoFile | null; try { f = await s.io.read(analyticsPaths(s.base).adminKey); } catch (e) { return mapError(e, false); } if (!f) return fail('not-set-up'); try { return { file: C.parseAdminKeyFile(f.text), sha: f.sha }; } catch (e) { return mapError(e, false); }
}
const isFail = (x: unknown): x is { ok: false; kind: RepoFailure; message: string } => !!x && typeof x === 'object' && (x as { ok?: unknown }).ok === false;
/** Change the password: the private keys are unwrapped with the current one and wrapped again with the new one. The key pairs do not change, so every existing batch stays readable. Ends the session (the caller locks). */
export async function changePasswordRepo(s: RepoSession, currentPassword: string, newPassword: string, opts: { iterations?: number } = {}): Promise<RepoResult<{ changed: true }>> {
  const fresh = await readFreshKeyFile(s); if (isFail(fresh)) return fresh; const problem = C.analyticsPasswordProblem(newPassword); if (problem) return fail('weak-password', `The new password was not accepted. ${problem}`);
  if (currentPassword === newPassword) return fail('weak-password', 'The new password must differ from the current one.');
  try { const next = await C.rewrapAdminKeyFile(fresh.file, currentPassword, newPassword, { iterations: opts.iterations }); await s.io.write(analyticsPaths(s.base).adminKey, `${JSON.stringify(next, null, 2)}\n`, fresh.sha, KEY_COMMIT_MESSAGE); return { ok: true, changed: true }; } catch (e) { return mapError(e, true); }
}
/** Rotate keys: a new key pair becomes the current one; the old wrapped keys are kept (old data stays readable). The new public key is published for the devices. */
export async function rotateKeysRepo(s: RepoSession, password: string): Promise<RepoResult<{ pin: PinSnippet; session: RepoSession }>> {
  const fresh = await readFreshKeyFile(s); if (isFail(fresh)) return fresh; const p = analyticsPaths(s.base);
  let rotated: C.UnlockedKeys; try { rotated = await C.rotateAdminKeyFile(fresh.file, password); } catch (e) { return mapError(e, false); }
  let sha: string; try { sha = await s.io.write(p.adminKey, `${JSON.stringify(rotated.file, null, 2)}\n`, fresh.sha, KEY_COMMIT_MESSAGE); } catch (e) { return mapError(e, true); }
  const session: RepoSession = { ...s, unlocked: rotated, adminSha: sha || fresh.sha };
  try { let cur: RepoFile | null = null; try { cur = await s.io.read(p.publicKey); } catch { cur = null; } await s.io.write(p.publicKey, publicKeyFileText(rotated.current, new Date().toISOString()), cur ? cur.sha : null, KEY_COMMIT_MESSAGE); } catch (e) { const r = mapError<never>(e, true); return fail('partial', `The new key pair was created and saved, but the new public key could not be published (${r.ok ? '' : r.message}) Use "Publish public key" and repeat.`); }
  return { ok: true, pin: pinOf(rotated.current), session };
}
/** (Re)publishes the CURRENT public key from the key file — finishes an interrupted set-up or rotation. */
export async function publishPublicKeyRepo(s: RepoSession): Promise<RepoResult<{ pin: PinSnippet }>> {
  const p = analyticsPaths(s.base); try { let cur: RepoFile | null = null; try { cur = await s.io.read(p.publicKey); } catch { cur = null; } await s.io.write(p.publicKey, publicKeyFileText(s.unlocked.current, new Date().toISOString()), cur ? cur.sha : null, KEY_COMMIT_MESSAGE); return { ok: true, pin: pinOf(s.unlocked.current) }; } catch (e) { return mapError(e, true); }
}

// ───────────────────────────────────────────────────────────── reading: fetch → decrypt → validate → aggregate (all in memory)
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> { const out: R[] = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i; i += 1; out[k] = await fn(items[k]); } })); return out; }
async function readEventFile(s: RepoSession, e: RepoEntry, nowMs: number): Promise<CachedFile> {
  const hit = s.cache.get(e.path); if (hit && hit.sha === e.sha) return hit; const f = await s.io.read(e.path); const entry: CachedFile = { sha: e.sha, events: [] }; if (!f) { entry.damaged = true; s.cache.set(e.path, entry); return entry; }
  try { const env = C.parseEnvelope(f.text, C.BATCH_FORMAT); const plain = (await C.decryptWith(s.unlocked.keys, env)) as { v?: unknown; sent?: unknown; events?: unknown }; if (!plain || plain.v !== 1 || typeof plain.sent !== 'number' || !Number.isFinite(plain.sent) || !Array.isArray(plain.events)) throw new Error('bad-batch');
    const sent = Math.min(plain.sent, nowMs + 5 * MINUTE); for (const raw of plain.events.slice(0, 500)) { const v = validateEvent(raw, sent); if (v.ok) entry.events!.push(v.ev); }
  } catch { entry.damaged = true; entry.events = []; } s.cache.set(e.path, entry); return entry;
}
async function readRollupFile(s: RepoSession, e: RepoEntry): Promise<CachedFile> {
  const hit = s.cache.get(e.path); if (hit && hit.sha === e.sha) return hit; const f = await s.io.read(e.path); const entry: CachedFile = { sha: e.sha }; if (!f) { entry.damaged = true; s.cache.set(e.path, entry); return entry; }
  try { const r = parseRollup(await C.decryptWith(s.unlocked.keys, C.parseEnvelope(f.text, C.ROLLUP_FORMAT))); if (!r) throw new Error('bad-rollup'); entry.rollup = r; } catch { entry.damaged = true; } s.cache.set(e.path, entry); return entry;
}
const prevMonth = (m: string): string => { const y = Number(m.slice(0, 4)); const mo = Number(m.slice(5, 7)); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };
export interface LoadInfo { files: number; events: number; rollups: number; damaged: number; truncated: boolean; keys: number; currentKid: string }
/** The dashboard numbers for [from, to] (UTC days). Reads only the months that can matter (one month of margin before, for sessions that cross a month end). */
export async function loadSummaryRepo(s: RepoSession, from: string, to: string, nowMs: number, retentionDays: number): Promise<RepoResult<{ data: AnalyticsSummary; info: LoadInfo }>> {
  try {
    const months = new Set(monthsBetween(prevMonth(from.slice(0, 7)), to.slice(0, 7))); const p = analyticsPaths(s.base); const fromMs = Date.parse(`${from}T00:00:00Z`); const toMs = Date.parse(`${to}T00:00:00Z`);
    const lo = Number.isNaN(fromMs) ? '0000-00-00' : utcDay(fromMs - 7 * DAY_MS); const hi = Number.isNaN(toMs) ? '9999-99-99' : utcDay(toMs + 2 * DAY_MS); // a week of margin before (a session that started earlier), two days after (a batch written late)
    const rollupEntries = (await s.io.list(p.rollupsDir)).filter((e) => e.type === 'file' && /^\d{4}-\d{2}\.json$/.test(e.name) && months.has(e.name.slice(0, 7))); const dayDirs = (await s.io.list(p.eventsDir)).filter((e) => e.type === 'dir' && /^\d{4}-\d{2}-\d{2}$/.test(e.name) && e.name >= lo && e.name <= hi);
    const eventEntries: RepoEntry[] = []; for (const d of dayDirs) eventEntries.push(...(await s.io.list(d.path)).filter((e) => e.type === 'file' && /^[a-f0-9]{32}\.json$/.test(e.name)));
    let truncated = false; let evs = eventEntries; if (evs.length + rollupEntries.length > MAX_FILES_PER_LOAD) { truncated = true; evs = eventEntries.slice(-Math.max(0, MAX_FILES_PER_LOAD - rollupEntries.length)); }
    const rolls = await pool(rollupEntries, 4, (e) => readRollupFile(s, e)); const merged = new Set<string>(); const model = new UsageModel(); let damaged = 0; for (const r of rolls) { if (r.rollup) { model.addRollup(r.rollup); for (const n of r.rollup.merged ?? []) merged.add(n); } else damaged += 1; }
    const live = evs.filter((e) => !merged.has(e.name.slice(0, 32))); const files = await pool(live, 4, (e) => readEventFile(s, e, nowMs)); const all: AnalyticsEvent[] = []; for (const f of files) { if (f.damaged) damaged += 1; all.push(...(f.events ?? [])); }
    all.sort((a, b) => a.ts - b.ts || (a.eid < b.eid ? -1 : 1)); for (const ev of all) model.addEvent(ev);
    const r = model.summary(from, to, nowMs, retentionDays); if ('error' in r) return fail('unexpected', r.error === 'range-too-large' ? 'That date range is too large (at most 800 days).' : 'That date range is not valid.');
    return { ok: true, data: r, info: { files: live.length + rollupEntries.length, events: model.eventCount, rollups: rollupEntries.length, damaged, truncated, keys: s.unlocked.keys.size, currentKid: s.unlocked.current.kid } };
  } catch (e) { return mapError(e, false); }
}

// ───────────────────────────────────────────────────────────── compaction + retention (administrator action)
export interface CompactionReport { daysCompacted: string[]; filesMerged: number; filesDeleted: number; rollupsWritten: number; skippedUnreadable: number; prunedDays: number; remaining: boolean; }
/** Merges the batch files of FINISHED days (older than two days) into the monthly roll-ups and removes them; removes whatever is older than the retention period. A run handles at most MAX_FILES_PER_COMPACTION files and says if more remain. */
export async function compactRepo(s: RepoSession, nowMs: number, retentionDays: number, onProgress: (t: string) => void = () => undefined): Promise<RepoResult<{ report: CompactionReport }>> {
  const p = analyticsPaths(s.base); const rep: CompactionReport = { daysCompacted: [], filesMerged: 0, filesDeleted: 0, rollupsWritten: 0, skippedUnreadable: 0, prunedDays: 0, remaining: false }; const cutDay = utcDay(nowMs - retentionDays * DAY_MS); let budget = MAX_FILES_PER_COMPACTION;
  try {
    const rolls = new Map<string, { sha: string; rollup: Rollup }>(); const mergedAll = new Set<string>(); const unreadableMonths = new Set<string>(); // every roll-up is read ONCE: its merged names tell which batch files it already contains (an interrupted run must never count a file twice)
    for (const e of (await s.io.list(p.rollupsDir)).filter((x) => x.type === 'file' && /^\d{4}-\d{2}\.json$/.test(x.name))) { const f = await s.io.read(e.path); if (!f) continue; const r = parseRollup(await C.decryptWith(s.unlocked.keys, C.parseEnvelope(f.text, C.ROLLUP_FORMAT)).catch(() => null)); if (!r) { rep.skippedUnreadable += 1; unreadableMonths.add(e.name.slice(0, 7)); continue; } rolls.set(e.name.slice(0, 7), { sha: f.sha, rollup: r }); for (const n of r.merged ?? []) mergedAll.add(n); }
    const dirs = (await s.io.list(p.eventsDir)).filter((e) => e.type === 'dir' && /^\d{4}-\d{2}-\d{2}$/.test(e.name)).sort((a, b) => (a.name < b.name ? -1 : 1)); const planned: { day: string; entries: RepoEntry[] }[] = [];
    for (const dir of dirs) {
      if (nowMs - (Date.parse(`${dir.name}T00:00:00Z`) + DAY_MS) < 2 * DAY_MS) continue; if (budget <= 0) { rep.remaining = true; break; } // only days that ended more than two days ago
      const entries = (await s.io.list(dir.path)).filter((e) => e.type === 'file' && /^[a-f0-9]{32}\.json$/.test(e.name)); if (!entries.length) continue;
      if (dir.name < cutDay) { onProgress(`Removing ${entries.length} file(s) of ${dir.name} (older than the retention period)…`); for (const e of entries) { if (budget <= 0) { rep.remaining = true; break; } await s.io.remove(e.path, e.sha, ROLLUP_COMMIT_MESSAGE); budget -= 1; rep.filesDeleted += 1; } continue; }
      const take = entries.slice(0, budget); if (take.length < entries.length) rep.remaining = true; budget -= take.length; planned.push({ day: dir.name, entries: take });
    }
    const batch = planned.flatMap((x) => x.entries.map((e) => ({ day: x.day, e }))); if (batch.length) {
      onProgress(`Reading ${batch.length} file(s) of ${planned.length} day(s)…`); const read = await pool(batch, 4, async (b) => ({ ...b, c: await readEventFile({ ...s, cache: new Map() }, b.e, nowMs) })); const ok = read.filter((f) => !f.c.damaged); rep.skippedUnreadable += read.length - ok.length; const already = ok.filter((f) => mergedAll.has(f.e.name.slice(0, 32))); const fresh = ok.filter((f) => !mergedAll.has(f.e.name.slice(0, 32))); // `already`: merged by an earlier, interrupted run — only deleted now
      const events = fresh.flatMap((f) => f.c.events ?? []).sort((a, b) => a.ts - b.ts || (a.eid < b.eid ? -1 : 1)); const byMonth = new Map<string, AnalyticsEvent[]>(); for (const ev of events) { const m = utcMonth(ev.ts); (byMonth.get(m) ?? byMonth.set(m, []).get(m)!).push(ev); } const names = fresh.map((f) => f.e.name.slice(0, 32)); let blocked = false;
      const model = new UsageModel(); for (const r of rolls.values()) model.addRollup(r.rollup); for (const ev of events) model.addEvent(ev); // ONE model over every earlier roll-up and the new events: a session that continues into the next month keeps its identity
      for (const m of byMonth.keys()) {
        if (unreadableMonths.has(m)) { blocked = true; continue; } // a roll-up that exists but cannot be read is never overwritten
        onProgress(`Writing the roll-up of ${m}…`); const prev = rolls.get(m); const roll = model.toRollup(m); roll.merged = [...new Set([...(prev?.rollup.merged ?? []), ...names])].slice(-100_000);
        await s.io.write(p.rollupFile(m), JSON.stringify(await C.encryptFor(s.unlocked.current, C.ROLLUP_FORMAT, roll)), prev ? prev.sha : null, ROLLUP_COMMIT_MESSAGE); rep.rollupsWritten += 1; for (const n of names) mergedAll.add(n);
      }
      if (!blocked) { onProgress(`Removing ${ok.length} merged file(s)…`); for (const f of ok) { await s.io.remove(f.e.path, f.e.sha, ROLLUP_COMMIT_MESSAGE); rep.filesDeleted += 1; } rep.filesMerged += fresh.length; rep.daysCompacted = [...new Set(ok.map((f) => f.day))].sort(); }
    }
    // retention of the roll-ups: days before the cut are dropped; an empty roll-up is deleted
    for (const e of (await s.io.list(p.rollupsDir)).filter((x) => x.type === 'file' && /^\d{4}-\d{2}\.json$/.test(x.name) && x.name.slice(0, 7) <= cutDay.slice(0, 7))) {
      const f = await s.io.read(e.path); if (!f) continue; const r = parseRollup(await C.decryptWith(s.unlocked.keys, C.parseEnvelope(f.text, C.ROLLUP_FORMAT)).catch(() => null)); if (!r) continue;
      const before = Object.keys(r.days).length; for (const d of Object.keys(r.days)) if (d < cutDay) delete r.days[d]; const removed = before - Object.keys(r.days).length; if (!removed) continue; rep.prunedDays += removed;
      if (!Object.keys(r.days).length) await s.io.remove(e.path, f.sha, ROLLUP_COMMIT_MESSAGE); else await s.io.write(e.path, JSON.stringify(await C.encryptFor(s.unlocked.current, C.ROLLUP_FORMAT, r)), f.sha, ROLLUP_COMMIT_MESSAGE);
    }
    s.cache.clear(); return { ok: true, report: rep };
  } catch (e) { s.cache.clear(); const r = mapError<{ report: CompactionReport }>(e, true); return r.ok ? r : fail(r.kind === 'no-write' || r.kind === 'unsupported' || r.kind === 'conflict' ? r.kind : 'partial', `${r.message} ${rep.filesDeleted ? `(${rep.filesDeleted} file(s) were already merged and removed before this stopped; nothing was lost.)` : ''}`.trim()); }
}
