/**
 * V17.6.5 — CENTRALIZED ADMIN PASSWORD.
 *
 * One authoritative, encrypted Admin Password record lives in the repository next to the schema registry (…/schemas/registry.json → …/security/admin-password.json) and travels through the
 * SAME repository connection as every other synchronization (central access service, a saved token, or the published copy — repository() in ui/context.ts decides; this module has no
 * authentication path of its own). Every device converges on that record:
 *
 *   · The record holds NO password. It holds the same encrypted verification marker that V17.6.4 kept in browser storage (`sqla.pwvault.v15`: PBKDF2-SHA-256 150 000 → AES-256-GCM of a fixed marker,
 *     random salt and IV), a revision number and a time stamp. A reset-to-default is a record with `isDefault: true` and no marker at all (nothing to decrypt: the default is the application's default).
 *   · Devices adopt the central record when its revision is newer (or equal and different): the local marker is replaced, so every device accepts the same password.
 *   · A change made on a device is stored locally first, then published; if publishing is impossible now (offline, read-only published copy, no token) it stays PENDING and is retried at every
 *     synchronization. A pending change never overwrites a newer central record: the central record wins and the user is told.
 *   · Optimistic concurrency: the file's sha is sent with every write; a concurrent change is re-read and re-evaluated once.
 *   · Existing installations (V17.6.4 and older): a device that has a custom local marker and finds NO central record publishes it as revision 1 (the first device to synchronize defines the central
 *     password); every other device then adopts it. A fresh installation (default password, no record) publishes nothing. Nothing is ever downgraded: an absent central file never resets a device.
 *   · The local marker keeps the V17.6.4 key and format, so a rollback to V17.6.4 keeps the last synchronized password. V17.6.4 ignores the new meta key and the new repository file.
 * V17.6.6 — NEW-DEVICE FIX. A device that has never seen the central record (default password, no marker) must ask the central record BEFORE it accepts anything (see verifyPassword in passwordService.ts):
 *   the default "admin" is valid only when no central record exists / none can be read; the unlock check waits for a synchronization that is already running instead of skipping it; a central read that
 *   failed is never reported as "synchronized"; and the unlock check asks the central record whenever a repository connection exists at that moment (also one that appeared after start-up: sign-in, token / vault restore).
 * Failures never throw and never lock anybody out: a record that is not valid is ignored and the local password keeps working.
 * V17.7 — THE DEFAULT IS CONFIRMED BY EVIDENCE, NEVER INFERRED. Four holes that V17.6.9 left at this boundary are closed (each tested):
 *   (1) `applied` + "no marker on this device" used to MEAN "explicit reset". It is now evidence-based: the observation records whether the central record that was applied IS a reset (`reset`); a device whose marker is missing/damaged
 *       while the applied record holds a verifier is inconsistent — the default is refused and the verifier is re-applied from the central record at once (the throttle is bypassed);
 *   (2) a device that once held a central record (meta revision > 0) and now finds the record ABSENT in the authoritative repository does NOT fall back to the default (a vanished / rolled-back record is not an administrator's reset);
 *   (3) a device without a verifier never keeps the default against a valid NON-default central record, whatever the revision numbers say (the central record is applied);
 *   (4) synchronization never publishes a reset record (doPush): a reset is published only by reset() after the administrator was authenticated. A missing marker can therefore never become a central "reset to default".
 * V17.6.9 — THE DEFAULT IS CONFIRMED, NEVER PRESUMED. resolution() reports `confirmed-default` only for (a) an explicit central reset record (isDefault) that was applied, (b) a reset that this device holds and has yet to publish, or
 *   (c) "no record" answered by the AUTHORITATIVE repository (central access service, a token that sees the repository, a test repository) after the repository itself was verified. A device without a connection, a refused
 *   credential, a failed read, an invalid record, a bootstrap or synchronization in progress, and a published copy that lists no record never enable the default. The state machine is the only place that decides.
 * V17.6.8 — THE AUTHENTICATION BOUNDARY. This service is also the PasswordAuthority of passwordService.verifyPassword(): it owns the explicit bootstrap state of the centralized password
 *   (loading → central-applied | local-fallback | confirmed-default | error — V17.6.9 renamed the provisional state; there is no provisional default any more) and tells every check what is in force on this device. Start-up sequence (bootstrap()): repository authorization is initialized by the
 *   caller → the central record is retrieved → its structure, revision and format are validated → its encrypted verifier is applied to the active authentication state (the local marker) → the state is marked loaded →
 *   only then may a check complete. A check that arrives earlier WAITS for that sequence; it never falls back to the default. A change or reset is published FIRST (central record, revision + 1, read back) and applied
 *   locally only after that succeeded. A central record that is applied and changes the verifier invalidates every Settings session (and the repository-configuration editor) opened on the old one.
 */
import { KEYS, readJson, writeJson, type KeyValueStore } from '../../services/storage';
import { readStoredBlob, writeStoredBlob, isValidBlob, isUsingDefaultPassword, authTrace, authTraceLog, confirmDefaultSession, buildVerifier, validateNewPassword, verifyPassword, invalidateAdminSession, type AuthResolution, type BootstrapState, type PasswordAuthority } from '../../services/passwordService';
import type { EncryptedBlob } from '../../services/cryptoService';
import { redactSecrets, containsSecret } from '../errors/appErrors';
import { APP_VERSION } from '../sync/schemaFormat';
import type { SchemaRepository } from './githubClient';
export const ADMIN_PASSWORD_FORMAT = 'sqla-admin-password'; export const ADMIN_PASSWORD_FORMAT_VERSION = 1;
export interface AdminPasswordRecord { format: string; formatVersion: number; revision: number; isDefault: boolean; verifier: EncryptedBlob | null; updatedAt: string; updatedByDevice: string; appVersion: string; }
export interface AdminPasswordMeta { revision: number; pending: boolean; sha: string | null; updatedAt: string | null; lastPullAt: string | null; }
export type AdminPasswordStage = 'Configuration' | 'Download' | 'Parse' | 'Validation' | 'Publish' | 'Storage' | null;
export interface AdminPasswordOutcome { ok: boolean; /** this device now holds the central state */ synchronized: boolean; /** the local marker was replaced by the central record */ changed: boolean; /** this device's own different password was replaced */ replacedLocal: boolean; message: string; stage: AdminPasswordStage; }
export interface AdoptEvent { /** the local password state was replaced by a DIFFERENT central state */ changed: boolean; /** the adopted central record is a reset to the default (the default is legitimately in force) */ isDefault: boolean; }
export type AdminPasswordStatus = { state: 'unconfigured' | 'unsynchronized' | 'pending' | 'synchronized'; revision: number; lastPullAt: string | null; text: string };
/** Where the repository connection of this moment comes from: 'authoritative' = the real repository (central access service, a saved token, a test repository); 'published' = the read-only published copy (can be older than the repository); 'none' = no connection. */
export type CentralSource = 'authoritative' | 'published' | 'none';
/** What the last attempt to consult the central record found (in this page session). */
type Observation = { outcome: 'none' | 'applied' | 'local-newer' | 'absent' | 'invalid' | 'unavailable'; source: CentralSource; problem: string; /** the kind of the repository error (auth / permission / not-found / config / timeout / network …) */ kind?: string; /** V17.7: the central record that was applied / compared IS an explicit reset to the default (the only evidence that the default is in force when a record exists) */ reset?: boolean };
export interface AdminPasswordOptions { /** the kind of repository connection right now (default: a connection ⇒ authoritative) */ source?: () => CentralSource; /** this device has no central source to ask at all — no central access service, no published copy, no token (default: no connection) */ standalone?: () => boolean; /** gives the authorization path one more chance before a decision is taken (re-reads the access-service configuration / publication marker) */ rediscover?: () => Promise<void>; /** a successful central read younger than this (ms) is not repeated at a login check (default 4000; tests use 0) */ refreshMs?: number; /** the authoritative repository is really reachable with this connection (an absent record may only be believed when it is) — default: yes */ confirmRepository?: () => Promise<boolean>; }
export interface AdminPasswordDiagnostics { status: AdminPasswordStatus; revision: number; pending: boolean; centralKnown: boolean; problem: string; state: BootstrapState; defaultAllowed: boolean; source: CentralSource; trace: { n: number; e: string }[] }
/** …/schemas/registry.json → …/security/admin-password.json  (default: sql-assistant-data/security/admin-password.json) */
export function adminPasswordPathFor(schemaPath: string): string { const p = (schemaPath || '').replace(/^\/+/, ''); const m = p.match(/^(.*?)\/schemas\/[^/]+$/); if (m) return `${m[1]}/security/admin-password.json`; const i = p.lastIndexOf('/'); return i > 0 ? `${p.slice(0, i)}/admin-password.json` : 'sql-assistant-data/security/admin-password.json'; }
const isoOk = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
/** Untrusted input (the repository file): every field is validated. Returns null when it is not a usable record. */
export function sanitizePasswordRecord(o: any): AdminPasswordRecord | null {
  if (!o || typeof o !== 'object' || o.format !== ADMIN_PASSWORD_FORMAT || typeof o.formatVersion !== 'number' || o.formatVersion > ADMIN_PASSWORD_FORMAT_VERSION || o.formatVersion < 1) return null;
  if (!Number.isInteger(o.revision) || o.revision < 1 || o.revision > 1_000_000_000 || typeof o.isDefault !== 'boolean' || !isoOk(o.updatedAt)) return null;
  if (o.isDefault ? o.verifier !== null && o.verifier !== undefined : !isValidBlob(o.verifier)) return null;
  return { format: ADMIN_PASSWORD_FORMAT, formatVersion: ADMIN_PASSWORD_FORMAT_VERSION, revision: o.revision, isDefault: o.isDefault, verifier: o.isDefault ? null : { salt: o.verifier.salt, iv: o.verifier.iv, ciphertext: o.verifier.ciphertext }, updatedAt: String(o.updatedAt), updatedByDevice: String(o.updatedByDevice ?? '').slice(0, 40), appVersion: String(o.appVersion ?? '').slice(0, 20) };
}
const sameState = (a: { isDefault: boolean; verifier: EncryptedBlob | null }, b: { isDefault: boolean; verifier: EncryptedBlob | null }) => a.isDefault === b.isDefault && (a.isDefault || (!!a.verifier && !!b.verifier && a.verifier.salt === b.verifier.salt && a.verifier.iv === b.verifier.iv && a.verifier.ciphertext === b.verifier.ciphertext));
export class AdminPasswordService implements PasswordAuthority {
  private busy: Promise<unknown> | null = null; private listeners = new Set<() => void>(); private adoptListeners = new Set<(e: AdoptEvent) => void>(); /** time of the last SUCCESSFUL central read (a failed read never counts as "just checked") */ private lastPullMs = 0; private lastProblem = '';
  private epoch = 0; private boot: Promise<AdminPasswordOutcome> | null = null; private loading = true; private obs: Observation = { outcome: 'none', source: 'none', problem: '' };
  constructor(private store: KeyValueStore, private repo: () => SchemaRepository | null, private path: () => string, private secrets: () => string[] = () => [], private opts: AdminPasswordOptions = {}) {}
  private get refreshMs(): number { return this.opts.refreshMs ?? 4000; }
  private source(): CentralSource { if (this.opts.source) return this.opts.source(); return this.repo() ? 'authoritative' : 'none'; }
  private standalone(): boolean { return this.opts.standalone ? this.opts.standalone() : !this.repo(); }
  /** V17.6.7: called after a CENTRAL record was applied on this device (start-up, scheduled sync, manual Sync, unlock check…). */
  onAdopt(fn: (e: AdoptEvent) => void): () => void { this.adoptListeners.add(fn); return () => this.adoptListeners.delete(fn); }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); } private emit() { this.listeners.forEach((l) => l()); }
  private meta(): AdminPasswordMeta | null { const m = readJson<Partial<AdminPasswordMeta> | null>(this.store, KEYS.adminPwMeta, null); if (!m || !Number.isInteger(m.revision) || (m.revision as number) < 0) return null; return { revision: m.revision as number, pending: !!m.pending, sha: typeof m.sha === 'string' ? m.sha : null, updatedAt: isoOk(m.updatedAt) ? (m.updatedAt as string) : null, lastPullAt: isoOk(m.lastPullAt) ? (m.lastPullAt as string) : null }; }
  private setMeta(m: Partial<AdminPasswordMeta>): boolean { const cur = this.meta() ?? { revision: 0, pending: false, sha: null, updatedAt: null, lastPullAt: null }; return writeJson(this.store, KEYS.adminPwMeta, { ...cur, ...m }); }
  pendingPublish(): boolean { return !!this.meta()?.pending; }
  private out(p: Partial<AdminPasswordOutcome>): AdminPasswordOutcome { return { ok: false, synchronized: false, changed: false, replacedLocal: false, message: '', stage: null, ...p }; }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> { const run = async () => { while (this.busy) { try { await this.busy; } catch { /* ignore */ } } const p = fn(); this.busy = p; try { return await p; } finally { this.busy = null; } }; return run(); }

  // ───────────────────────── V17.6.8: the bootstrap state and the authority
  /** The explicit bootstrap state of the centralized Admin Password on this device. */
  bootstrapState(): BootstrapState { return this.resolution().state; }
  /** V17.7: this device has applied / published a central record at some time (meta revision > 0): an absent record is then NOT the first-time situation. */
  private knewCentralRecord(): boolean { const m = this.meta(); return !!m && m.revision > 0; }
  private resolution(): AuthResolution {
    if (this.loading) return { state: 'loading', defaultAllowed: false, reason: 'The central Admin Password is being loaded.' };
    const hasMarker = !isUsingDefaultPassword(); const o = this.obs; const why = o.problem ? ` (${o.problem})` : '';
    // V17.6.9: while a synchronization / central change is running (a newer revision is being applied, a conflict is being resolved) a device WITHOUT a marker has no decided state: the default is not a candidate.
    if (this.busy && !hasMarker) return { state: 'loading', defaultAllowed: false, reason: 'The central Admin Password is being synchronized.' };
    switch (o.outcome) {
      case 'applied': if (hasMarker) return { state: 'central-applied', defaultAllowed: false, reason: 'The central Admin Password is applied.' };
        // V17.7: no marker on this device. The default is in force ONLY when the central record that was applied is an explicit reset; a missing / damaged marker next to an applied VERIFIER is an inconsistent state, never a reset.
        return o.reset === true ? { state: 'confirmed-default', defaultAllowed: true, reason: 'The central record is an explicit reset to the default password.' } : { state: 'error', defaultAllowed: false, reason: 'The central Admin Password verifier is not present on this device; it is being applied again and the default password is not accepted.' };
      case 'local-newer': if (hasMarker) return { state: 'local-fallback', defaultAllowed: false, reason: 'This device holds a newer Admin Password change that is not yet published.' };
        // V17.7: a local state without a verifier that is NEWER than the central record is a reset only when the central record itself is a reset; otherwise it is a missing marker, and the default is refused.
        return o.reset === true ? { state: 'confirmed-default', defaultAllowed: true, reason: 'The central record is an explicit reset to the default password (this device holds a newer one that is not yet published).' } : { state: 'error', defaultAllowed: false, reason: 'This device holds no Admin Password verifier and the central record is not a reset, so the default password is not accepted until the central record is applied.' };
      case 'absent': // "no record" is believed ONLY from the authoritative repository (doPull0 has already verified that GitHub really answered for this repository and branch). A published copy can be older than the repository.
        if (hasMarker) return { state: 'local-fallback', defaultAllowed: false, reason: o.source === 'published' ? 'The published copy of the repository lists no central Admin Password record; the password stored on this device is used.' : 'The repository holds no central Admin Password record; the password stored on this device is used.' };
        if (o.source === 'authoritative' && this.knewCentralRecord()) return { state: 'error', defaultAllowed: false, reason: 'This device has applied a central Admin Password record before, but the repository now holds none. A vanished record is not a reset — the default password is not accepted; an administrator must publish a reset (or restore the record).' }; // V17.7
        if (o.source === 'authoritative') return { state: 'confirmed-default', defaultAllowed: true, reason: 'The repository holds no central Admin Password record: the default password is in force until one is set.' };
        return { state: 'error', defaultAllowed: false, reason: 'The published copy of the repository lists no central Admin Password record, but a published copy can be older than the repository, so it cannot confirm that none was ever set. The default password is not accepted.' };
      case 'invalid': return { state: 'error', defaultAllowed: false, reason: `The central Admin Password record in the repository is not valid or was written by a newer version${why}. It was not changed.` };
      default: // 'unavailable' | 'none' — a failed read, a refused credential or no connection at all is never proof that no Admin Password exists
        if (hasMarker) return { state: 'local-fallback', defaultAllowed: false, reason: `The central Admin Password could not be read${why || ''}; the password stored on this device is used.` };
        return { state: 'error', defaultAllowed: false, reason: `The central Admin Password could not be read${why || ' (no repository connection on this device yet)'}, so the default password is not accepted.` };
    }
  }
  /**
   * START-UP BOOTSTRAP (idempotent: one run per page session, shared by every caller). The caller has initialized the repository authorization path (access-service configuration, publication marker, saved token) before.
   * Retrieve → validate → apply → mark loaded; only afterwards can a check complete. Never throws.
   */
  bootstrap(): Promise<AdminPasswordOutcome> {
    if (!this.boot) { this.loading = true; authTrace('bootstrap:start'); this.emit();
      this.boot = (async () => { let r: AdminPasswordOutcome; try { if (this.source() === 'none' && this.opts.rediscover) { try { await this.opts.rediscover(); } catch { /* the decision below is taken on what is known */ } } r = await this.synchronize(); } catch (e) { r = this.out({ stage: 'Download', message: redactSecrets((e as Error).message, this.secrets()) }); this.obs = { outcome: 'unavailable', source: this.source(), problem: 'unexpected failure' }; }
        this.loading = false; authTrace(`bootstrap:done state=${this.resolution().state}`); this.emit(); return r; })(); }
    return this.boot;
  }
  /** The PasswordAuthority: waits for the bootstrap (never accepts the default while it runs), asks the central record again when the last successful read is older than `minMs` (a stale verifier is replaced), then reports what is in force. */
  async resolve(minMs = this.refreshMs): Promise<AuthResolution> {
    try {
      await this.bootstrap(); while (this.busy) { try { await this.busy; } catch { /* ignore */ } }
      if (this.source() === 'none' && this.opts.rediscover) { try { await this.opts.rediscover(); } catch { /* ignore */ } }
      // V17.6.9: an observation made through a DIFFERENT kind of source (published copy → authoritative token / sign-in that appeared after start-up) is never trusted for the new connection: read again at once, whatever the throttle says
      if (this.source() !== 'none' && (Date.now() - this.lastPullMs >= minMs || this.lastProblem !== '' || this.obs.source !== this.source() || this.inconsistent())) await this.pull();
      else if (this.source() === 'none') { this.obs = { outcome: 'unavailable', source: 'none', problem: '' }; this.lastProblem = ''; }
    } catch { /* never throws */ }
    const r = this.resolution(); authTrace(`login:central-state-${this.centralKnown() ? 'known' : 'unknown'}`); return r;
  }
  /** V17.7: the applied central record holds a verifier but this device has none (storage was cleared / damaged after the record was applied) — the record is applied again at once, whatever the throttle says. */
  private inconsistent(): boolean { return this.obs.outcome === 'applied' && this.obs.reset !== true && isUsingDefaultPassword(); }
  /** Compatibility (V17.6.5–V17.6.7 name): resolve, then report whether the central state is known on this device. */
  async refreshForLogin(minMs = this.refreshMs): Promise<boolean> { await this.resolve(minMs); return this.centralKnown(); }
  /** The central state is known on this device: a read succeeded in this page session and the last read did not fail. */
  private centralKnown(): boolean { return this.source() !== 'none' && this.lastPullMs > 0 && this.lastProblem === ''; }
  /** V17.6.7: the Settings page is shown on a provisional session — look again now that a connection may exist (one synchronization, throttled). */
  recheckSession(minMs = 15_000): void { if (this.source() === 'none' || this.busy || Date.now() - this.lastPullMs < minMs) return; authTrace('session:recheck'); void this.synchronize().catch(() => undefined); }
  /** Secret-free diagnostics: the bootstrap state, the status line, the revision / pending flag and the authentication trace. */
  diagnostics(): AdminPasswordDiagnostics { const m = this.meta(); const r = this.resolution(); return { status: this.status(), revision: m?.revision ?? 0, pending: !!m?.pending, centralKnown: this.centralKnown(), problem: this.lastProblem, state: r.state, defaultAllowed: r.defaultAllowed, source: this.source(), trace: authTraceLog() }; }
  /** The reason of the last failed central read (never a secret), or '' */
  problem(): string { return this.lastProblem; }
  /** What the Security tab says about the central state (never a secret). */
  status(): AdminPasswordStatus {
    const m = this.meta(); const rev = m?.revision ?? 0; const last = m?.lastPullAt ?? null;
    if (this.source() === 'none') return { state: 'unconfigured', revision: rev, lastPullAt: last, text: 'no repository connection on this device — the Admin Password is kept on this device until a connection is set up' };
    if (m?.pending) return { state: 'pending', revision: rev, lastPullAt: last, text: 'a change made on this device is not yet published centrally — it is retried at every synchronization' };
    if (rev > 0) return { state: 'synchronized', revision: rev, lastPullAt: last, text: `synchronized with the central repository (revision ${rev})${this.lastProblem ? ` — the last check failed: ${this.lastProblem}` : ''}` };
    return { state: 'unsynchronized', revision: rev, lastPullAt: last, text: this.lastProblem ? `not yet synchronized — the central record could not be read (${this.lastProblem}); settings stay protected by what this device holds until a synchronization succeeds — retry with the Sync button` : 'not yet synchronized — happens at start-up and with the Sync button' };
  }
  /** Download + merge (central record is authoritative). Never throws. */
  pull(): Promise<AdminPasswordOutcome> { return this.exclusive(() => this.doPull().then((r) => r.out)); }
  /** Pull, then publish what this device holds and the centre lacks (an upgrade seed, a pending change, a pending reset). */
  synchronize(): Promise<AdminPasswordOutcome> { return this.exclusive(async () => { const p = await this.doPull(); if (!p.out.ok || !p.publish) return p.out; const q = await this.doPush(); return q.ok ? { ...q, changed: p.out.changed, replacedLocal: p.out.replacedLocal } : { ...p.out, ok: true, synchronized: false, stage: q.stage, message: q.message }; }); }
  /** Throttled pull for "the tab became visible again". */
  pullIfStale(minMs = 5 * 60_000): Promise<AdminPasswordOutcome | null> { return Date.now() - this.lastPullMs < minMs ? Promise.resolve(null) : this.synchronize(); }
  private adopt(r: AdminPasswordRecord, sha: string): boolean {
    const had = readStoredBlob(); const differs = !sameState({ isDefault: had === null, verifier: had }, r); const ok = writeStoredBlob(r.isDefault ? null : r.verifier); if (!ok) return false;
    const saved = this.setMeta({ revision: r.revision, pending: false, sha, updatedAt: r.updatedAt, lastPullAt: new Date().toISOString() }); if (!saved) { if (had) writeStoredBlob(had); else writeStoredBlob(null); return false; }
    this.obs = { outcome: 'applied', source: this.source(), problem: '', reset: r.isDefault }; authTrace(`central:loaded rev=${r.revision} default=${r.isDefault} changed=${differs}`); if (r.isDefault) confirmDefaultSession();
    // V17.6.8: a verifier that is DIFFERENT from the one this device held invalidates every authorization that rests on the old one (Settings session, repository-configuration editor, cached state) — whatever it was opened with.
    if (differs) { this.epoch += 1; invalidateAdminSession('central-verifier-changed'); } this.emit(); this.adoptListeners.forEach((l) => { try { l({ changed: differs, isDefault: r.isDefault }); } catch { /* a listener must never break synchronization */ } }); return true;
  }
  private note(o: Partial<Observation> & { outcome: Observation['outcome'] }): void { this.obs = { source: this.source(), problem: '', ...o }; }
  private async doPull(): Promise<{ out: AdminPasswordOutcome; publish: boolean }> {
    try { const r = await this.doPull0(); this.emit(); return r; } catch (e) { this.note({ outcome: 'unavailable', problem: 'unexpected failure' }); this.lastProblem = 'unexpected failure'; return { out: this.out({ stage: 'Download', message: redactSecrets((e as Error).message, this.secrets()) }), publish: false }; }
  }
  private async doPull0(): Promise<{ out: AdminPasswordOutcome; publish: boolean }> {
    authTrace('sync:start'); const repo = this.repo(); const src = this.source(); const none = (o: Partial<AdminPasswordOutcome>) => ({ out: this.out(o), publish: false });
    if (!repo) { this.note({ outcome: 'unavailable', source: 'none' }); return none({ stage: 'Configuration', message: 'Repository synchronization is not configured.' }); }
    let f; try { f = await repo.read(this.path()); } catch (e) { this.lastProblem = redactSecrets((e as Error).message, this.secrets()).slice(0, 200); this.note({ outcome: 'unavailable', source: src, problem: this.lastProblem, kind: String((e as { kind?: string }).kind || '') }); authTrace('central:read-failed'); return none({ stage: 'Download', message: redactSecrets((e as Error).message, this.secrets()) }); }
    // V17.6.8: an ABSENT record is believed only when the repository itself answered: GitHub answers "not found" for a private repository (or branch) the token cannot see, which looks exactly like "no record".
    if (!f && src === 'authoritative' && this.opts.confirmRepository) { let reachable = false; try { reachable = await this.opts.confirmRepository(); } catch { reachable = false; } if (!reachable) { this.lastProblem = 'the repository or branch could not be verified with this connection'; this.note({ outcome: 'unavailable', source: src, problem: this.lastProblem, kind: 'not-found' }); authTrace('central:repository-unverified'); return none({ stage: 'Download', message: 'The repository could not be verified with this connection (not found, or no access), so "no Admin Password record" cannot be believed.' }); } }
    this.lastPullMs = Date.now(); this.lastProblem = ''; authTrace(f ? 'central:downloaded' : 'central:absent');
    const meta = this.meta(); const blob = readStoredBlob(); const now = new Date().toISOString();
    if (!f) { // no central record
      this.note({ outcome: 'absent', source: src }); if (src === 'authoritative' && !meta && blob === null && isUsingDefaultPassword()) confirmDefaultSession();
      if (!meta && blob === null && isUsingDefaultPassword()) return none({ ok: true, synchronized: false, message: 'No central Admin Password record exists — this device uses the default password; nothing is synchronized until a password is set.' });
      if (!meta && blob === null) return none({ ok: true, message: 'This device holds an Admin Password marker that cannot be read; it was not published.' });
      if (!meta) { if (!this.setMeta({ revision: 1, pending: true, sha: null, updatedAt: now, lastPullAt: now })) return none({ stage: 'Storage', message: 'Browser storage rejected the write.' }); return { out: this.out({ ok: true, message: 'This device holds an Admin Password that is not central yet — it will be published.' }), publish: true }; }
      if (blob === null) return none({ ok: true, synchronized: false, message: 'The central Admin Password record is missing and this device holds no verifier to publish; the default password is not accepted until an administrator publishes a record.' }); // V17.7: a missing marker is never republished as a reset
      this.setMeta({ sha: null, pending: true, lastPullAt: now }); return { out: this.out({ ok: true, message: 'The central Admin Password record is missing — this device will publish its current one.' }), publish: true };
    }
    let remote: AdminPasswordRecord | null = null; try { remote = sanitizePasswordRecord(JSON.parse(String(f.text).replace(/^\uFEFF/, ''))); } catch { remote = null; }
    if (!remote) { this.lastProblem = 'the central record is not valid'; this.note({ outcome: 'invalid', source: src, problem: 'the central record is not valid' }); authTrace('central:invalid'); return none({ stage: 'Parse', message: 'The Admin Password file in the repository is not valid (or was written by a newer version) and was ignored; the Admin Password of this device is unchanged.' }); }
    const localRev = meta?.revision ?? 0; const localState = { isDefault: blob === null, verifier: blob };
    const take = (note = ''): { out: AdminPasswordOutcome; publish: boolean } => { const differs = !sameState(localState, remote!); if (!this.adopt(remote!, f.sha)) { this.note({ outcome: 'unavailable', source: src, problem: 'browser storage rejected the write' }); return none({ stage: 'Storage', message: 'Browser storage rejected the write — the Admin Password of this device was not updated.' }); } return { out: this.out({ ok: true, synchronized: true, changed: differs, replacedLocal: differs && !(!meta && blob === null), message: differs ? `The central Admin Password was applied on this device.${note}` : 'Admin Password is up to date.' }), publish: false }; };
    const same = (): { out: AdminPasswordOutcome; publish: boolean } => { this.setMeta({ sha: f.sha, pending: false, lastPullAt: now }); this.note({ outcome: 'applied', source: src, reset: remote!.isDefault }); return none({ ok: true, synchronized: true, message: 'Admin Password is up to date.' }); };
    if (localRev === 0) return take(); // fresh device, or a V17.6.4 device that never published: the central record is authoritative
    if (blob === null && !remote.isDefault) return take(' This device held no Admin Password verifier, so the central one is in force.'); // V17.7: a device without a verifier never keeps the default against a valid non-default central record
    if (meta!.pending) {
      if (remote.revision >= localRev) { if (remote.revision === localRev && sameState(localState, remote)) return same(); return take(' A change made on this device had not been published, and the password had already been changed centrally — the central one is in force.'); }
      this.setMeta({ sha: f.sha, lastPullAt: now }); this.note({ outcome: 'local-newer', source: src, reset: remote.isDefault }); return { out: this.out({ ok: true, message: 'This device holds a newer Admin Password change — it will be published.' }), publish: true };
    }
    if (remote.revision > localRev) return take();
    if (remote.revision === localRev) { if (sameState(localState, remote)) return same(); return take(); }
    this.setMeta({ pending: true, sha: f.sha, lastPullAt: now }); this.note({ outcome: 'local-newer', source: src, reset: remote.isDefault }); return { out: this.out({ ok: true, message: 'The central Admin Password record is older than this device — it will be republished.' }), publish: true };
  }
  /** Current local state as a record (revision = the one stored in the meta). */
  private localRecord(): AdminPasswordRecord | null {
    const m = this.meta(); if (!m || m.revision < 1) return null; const blob = readStoredBlob(); if (blob === null && !isUsingDefaultPassword()) return null; // an unreadable marker is never published
    return { format: ADMIN_PASSWORD_FORMAT, formatVersion: ADMIN_PASSWORD_FORMAT_VERSION, revision: m.revision, isDefault: blob === null, verifier: blob, updatedAt: m.updatedAt ?? new Date().toISOString(), updatedByDevice: (this.store.get(KEYS.device) || 'device').slice(0, 40), /* read only — a reset must not create or change any other browser-storage entry */ appVersion: APP_VERSION };
  }
  /** Republishes what this device holds (an upgrade seed of a custom password, or a pending change from an older version). */
  private async doPush(retry = true): Promise<AdminPasswordOutcome> {
    const repo = this.repo(); if (!repo) return this.out({ stage: 'Configuration', message: 'The repository connection is not set up on this device (Schema → Pull Schema), so the Admin Password could not be synchronized centrally.' });
    const r = this.localRecord(); if (!r) return this.out({ ok: true, synchronized: true, message: 'Nothing to publish.' }); const text = JSON.stringify(r, null, 1);
    if (r.isDefault) return this.out({ ok: true, synchronized: false, message: 'Synchronization never publishes a reset to the default password; only Settings → Security → Reset (after the administrator signed in) does.' }); // V17.7
    if (containsSecret(text)) return this.out({ stage: 'Validation', message: 'The Admin Password record looks like it contains a credential and was not published.' });
    let remote; try { remote = await repo.read(this.path()); } catch (e) { return this.out({ stage: 'Download', message: redactSecrets((e as Error).message, this.secrets()) }); }
    if (remote) { let theirs: AdminPasswordRecord | null = null; try { theirs = sanitizePasswordRecord(JSON.parse(String(remote.text).replace(/^\uFEFF/, ''))); } catch { theirs = null; }
      if (theirs && (theirs.revision > r.revision || (theirs.revision === r.revision && !sameState(theirs, r)))) { const had = readStoredBlob(); if (!this.adopt(theirs, remote.sha)) return this.out({ stage: 'Storage', message: 'Browser storage rejected the write.' }); return this.out({ ok: true, synchronized: true, changed: !sameState({ isDefault: had === null, verifier: had }, theirs), replacedLocal: !sameState({ isDefault: had === null, verifier: had }, theirs), message: 'The Admin Password was changed centrally in the meantime; the central one is in force on this device.' }); }
      if (theirs && theirs.revision === r.revision) { this.setMeta({ pending: false, sha: remote.sha }); this.note({ outcome: 'applied', reset: theirs.isDefault }); return this.out({ ok: true, synchronized: true, message: 'Admin Password is up to date.' }); }
      if (!theirs) return this.out({ stage: 'Validation', message: 'The Admin Password file in the repository is not valid; it was not replaced.' }); }
    try { const sha = await repo.write(this.path(), text, remote ? remote.sha : null, r.isDefault ? 'Reset Admin Password to default (no password in this file)' : 'Update Admin Password (encrypted verifier only)'); this.setMeta({ sha, pending: false, lastPullAt: new Date().toISOString() }); this.note({ outcome: 'applied', reset: r.isDefault }); this.emit(); return this.out({ ok: true, synchronized: true, message: 'Admin Password published to the central repository.' }); }
    catch (e) { const m = redactSecrets((e as Error).message, this.secrets()); if (retry && /changed on the server/.test(m)) return this.doPush(false); return this.out({ stage: 'Publish', message: m }); }
  }

  // ───────────────────────── Central password changes (V17.6.8: publish FIRST, apply locally only after that succeeded)
  /** block = the change must not go ahead (the central state is not known, the connection is read-only, …). `localOnly` = standalone device: there is no central record to keep consistent. */
  private async gate(): Promise<{ block: AdminPasswordOutcome | null; localOnly: boolean }> {
    if (this.source() === 'none' && this.opts.rediscover) { try { await this.opts.rediscover(); } catch { /* ignore */ } }
    const src = this.source();
    if (src === 'none') return this.standalone() ? { block: null, localOnly: true } : { block: this.out({ stage: 'Configuration', message: 'The Admin Password is kept centrally, but this device has no repository connection right now (sign in to GitHub with the Sync button, or set a token), so it was NOT changed.' }), localOnly: false };
    await this.bootstrap(); const p = await this.pull(); if (!p.ok || this.lastProblem) return { block: this.out({ stage: p.stage || 'Download', message: `The central Admin Password record could not be read (${this.lastProblem || p.message}), so the password was NOT changed. Retry when the repository is reachable.` }), localOnly: false };
    if (src === 'published') return { block: this.out({ stage: 'Publish', message: 'This device reads the published copy of the repository and holds no GitHub access token, so it cannot publish a new Admin Password. The password was NOT changed.' }), localOnly: false };
    return { block: null, localOnly: false };
  }
  /** Writes the new central record (revision + 1, optimistic concurrency, one retry), reads it back, and returns the revision / sha — or an outcome that says why nothing was published. */
  private async publishRecord(rec: { isDefault: boolean; verifier: EncryptedBlob | null }): Promise<{ ok: true; revision: number; sha: string; at: string } | { ok: false; out: AdminPasswordOutcome }> {
    const repo = this.repo(); if (!repo) return { ok: false, out: this.out({ stage: 'Configuration', message: 'The repository connection is not set up on this device.' }) };
    for (let attempt = 0; attempt < 2; attempt++) {
      let remote; try { remote = await repo.read(this.path()); } catch (e) { return { ok: false, out: this.out({ stage: 'Download', message: redactSecrets((e as Error).message, this.secrets()) }) }; }
      let theirs: AdminPasswordRecord | null = null; if (remote) { try { theirs = sanitizePasswordRecord(JSON.parse(String(remote.text).replace(/^\uFEFF/, ''))); } catch { theirs = null; } if (!theirs) return { ok: false, out: this.out({ stage: 'Validation', message: 'The Admin Password file in the repository is not valid; it was not replaced and the password was NOT changed.' }) }; }
      const known = this.meta()?.revision ?? 0; if (theirs && theirs.revision > known) { this.adopt(theirs, remote!.sha); return { ok: false, out: this.out({ ok: false, synchronized: true, changed: true, replacedLocal: true, stage: 'Validation', message: 'The Admin Password was changed centrally in the meantime; the central one is now in force on this device and your change was NOT applied.' }) }; }
      const revision = Math.max(known, theirs?.revision ?? 0) + 1; const at = new Date().toISOString();
      const record: AdminPasswordRecord = { format: ADMIN_PASSWORD_FORMAT, formatVersion: ADMIN_PASSWORD_FORMAT_VERSION, revision, isDefault: rec.isDefault, verifier: rec.isDefault ? null : rec.verifier, updatedAt: at, updatedByDevice: (this.store.get(KEYS.device) || 'device').slice(0, 40), appVersion: APP_VERSION }; const text = JSON.stringify(record, null, 1);
      if (containsSecret(text)) return { ok: false, out: this.out({ stage: 'Validation', message: 'The Admin Password record looks like it contains a credential and was not published.' }) };
      try { const sha = await repo.write(this.path(), text, remote ? remote.sha : null, rec.isDefault ? 'Reset Admin Password to default (no password in this file)' : 'Update Admin Password (encrypted verifier only)');
        let back; try { back = await repo.read(this.path()); } catch { back = null; } const backRec = back ? (() => { try { return sanitizePasswordRecord(JSON.parse(String(back.text).replace(/^\uFEFF/, ''))); } catch { return null; } })() : null;
        if (!backRec || backRec.revision !== revision || !sameState(backRec, record)) return { ok: false, out: this.out({ stage: 'Publish', message: 'The new central Admin Password record could not be read back consistently, so the password was NOT changed on this device. Synchronize and try again.' }) };
        return { ok: true, revision, sha: back!.sha || sha, at }; }
      catch (e) { const m = redactSecrets((e as Error).message, this.secrets()); if (attempt === 0 && /changed on the server/.test(m)) continue; return { ok: false, out: this.out({ stage: 'Publish', message: `${m} The password was NOT changed.` }) }; }
    }
    return { ok: false, out: this.out({ stage: 'Publish', message: 'The central Admin Password record changed repeatedly while it was being updated; the password was NOT changed. Try again.' }) };
  }
  private applyLocal(v: EncryptedBlob | null, pub: { revision: number; sha: string; at: string } | null): boolean {
    const had = readStoredBlob(); if (!writeStoredBlob(v)) return false;
    if (pub && !this.setMeta({ revision: pub.revision, pending: false, sha: pub.sha, updatedAt: pub.at, lastPullAt: new Date().toISOString() })) { writeStoredBlob(had); return false; }
    if (pub) { this.lastPullMs = Date.now(); this.lastProblem = ''; this.note({ outcome: 'applied', reset: v === null }); } this.emit(); return true;
  }
  /** Settings → Security → Change Admin Password. Order: central state known → current password verified by the authority → new verifier built → published (revision + 1, read back) → applied locally. */
  async change(oldPassword: string, newPassword: string): Promise<AdminPasswordOutcome & { error?: string }> {
    const bad = validateNewPassword(newPassword); if (bad) return { ...this.out({ stage: 'Validation', message: bad }), error: bad };
    const e0 = this.epoch; const g = await this.gate(); if (g.block) return { ...g.block, error: g.block.message };
    if (this.epoch !== e0) { const m = 'The central Admin Password changed while the change was being prepared; nothing was changed. Unlock with the current central password and try again.'; return { ...this.out({ stage: 'Validation', message: m }), error: m }; }
    if (!(await verifyPassword(oldPassword))) { const m = 'Current password is incorrect.'; return { ...this.out({ stage: 'Validation', message: m }), error: m }; }
    return this.exclusive(async () => {
      let verifier: EncryptedBlob; try { verifier = await buildVerifier(newPassword); } catch (e) { const m = `The new password could not be prepared (${(e as Error).message}).`; return { ...this.out({ stage: 'Validation', message: m }), error: m }; }
      if (g.localOnly) { if (!this.applyLocal(verifier, null)) return this.out({ stage: 'Storage', message: 'The new password could not be saved: browser storage rejected the write. The password was NOT changed.' }); return this.out({ ok: true, message: 'The Admin Password was changed on this device (no central repository is configured here, so nothing was published).' }); }
      const pub = await this.publishRecord({ isDefault: false, verifier }); if (!pub.ok) return { ...pub.out, error: pub.out.message };
      if (!this.applyLocal(verifier, pub)) return this.out({ ok: true, synchronized: true, stage: 'Storage', message: 'The new Admin Password was published centrally, but browser storage rejected the write on this device. It will be applied here at the next synchronization.' });
      return this.out({ ok: true, synchronized: true, message: `The Admin Password was changed and synchronized to the central repository (revision ${pub.revision}); other devices apply it at their next synchronization or when it is entered there.` });
    });
  }
  /** Settings → Security → Reset Admin Password to Default (and the Danger Zone button): the reset record is published FIRST, then this device returns to "admin". */
  async reset(): Promise<AdminPasswordOutcome> {
    const e0 = this.epoch; const g = await this.gate(); if (g.block) return g.block;
    if (this.epoch !== e0) return this.out({ stage: 'Validation', message: 'The central Admin Password changed while the reset was being prepared (this device was behind); nothing was reset. Unlock with the current central password and try again.' });
    return this.exclusive(async () => {
      if (g.localOnly) return this.out({ stage: 'Configuration', message: 'This device has no repository connection, so the default password could not be confirmed afterwards: a device without a connection never accepts the default, and Settings would stay locked. The Admin Password was NOT reset — change it instead, or connect the repository first (Sync button).' }); // V17.6.9
      const pub = await this.publishRecord({ isDefault: true, verifier: null }); if (!pub.ok) return pub.out;
      if (!this.applyLocal(null, pub)) return this.out({ ok: true, synchronized: true, stage: 'Storage', message: 'The reset was published centrally, but browser storage rejected the write on this device. It will be applied here at the next synchronization.' });
      return this.out({ ok: true, synchronized: true, message: 'The Admin Password was reset to the default and the reset was synchronized to the central repository.' });
    });
  }
}
