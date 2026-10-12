/**
 * V17.6.5 — CENTRAL ADMIN PASSWORD: synchronization, Save and Reset (injectable I/O, tested in Node).
 *
 * READ  (this device refreshes the record at app start, when the tab becomes visible, at the scheduled sync, on "Sync with GitHub Now" and once when an unlock fails):
 *         1. a device that holds a repository sign-in (V17.6.2 broker session) or a token asks the repository directly for a FRESH copy;
 *         2. otherwise — or when that fails — it reads the PUBLISHED copy (V17.6.3), which needs no credential and is accepted only when its SHA-256 equals the publication marker's.
 *       Every record passes the strict parser, the isDefault⇔marker consistency check and the rollback rule (adminCredential.ts) before it is applied. A refused record changes nothing: the device
 *       keeps its last good record (cached in browser storage for offline use) and the user is told once.
 * WRITE (Save, Reset): only through the authenticated route (the broker session or a device token). The new record is written, READ BACK through the same route and compared, and only then does
 *       this device apply it and report success. A failure names the step (verify / access / read / write / confirm) and leaves this device unchanged. The password itself is never written; the
 *       record holds only the encrypted verification marker.
 * No password, token or key is ever placed in a message, a URL, a log or storage by this module.
 */
import { KEYS, readJson, writeJson, type KeyValueStore } from '../../services/storage';
import { RepositoryError, type SchemaRepository, type RepoFile } from './githubClient';
import { redactSecrets } from '../errors/appErrors';
import { sha256Hex } from './publishedData';
import { ADMIN_CREDENTIAL_PATH, parseAdminCredential, serializeAdminCredential, sameCredential, credentialIsConsistent, credentialMatches, buildAdminCredential, decideAdoption, checkNewPassword, type AdminCredentialRecord } from './adminCredential';
import { checkPassword, recordAttempt, lockRemainingMs, lockMessage, localPasswordMatches, hasLocalPassword, DEFAULT_PASSWORD, type CentralView } from '../../services/passwordService';

export type ReadSource = 'authenticated' | 'published'; export type AdoptedFrom = ReadSource | 'save';
export type RefreshReason = 'start' | 'visible' | 'scheduled' | 'sync' | 'unlock-failed' | 'manual';
export type RefreshStatus = 'applied' | 'unchanged' | 'absent' | 'refused' | 'pending' | 'unreachable' | 'unavailable';
export interface RefreshOutcome {
  status: RefreshStatus; source: ReadSource | null; message: string; record: AdminCredentialRecord | null; previous: AdminCredentialRecord | null;
  /** the record in force on this device changed (applied or removed) */ changed: boolean;
  /** the user should be told (a refusal is announced once per distinct bad record) */ notify: boolean;
  /** first time a central record is in force on a device that still holds a local password: explain once that the central one wins */ explainOnce: boolean;
}
export interface WriteRoute { repo: SchemaRepository; kind: 'broker' | 'token' | 'test'; canWrite: boolean | null; }
export type AccessOutcome = { ok: true } | { ok: false; message: string; cancelled?: boolean };
export interface CredentialDeps {
  store: KeyValueStore; deviceId: () => string;
  /** a fresh-read route: broker session, device token or test repository (null = none on this device) */ authRepo: () => SchemaRepository | null;
  /** the published copy (SHA-256 checked); null when no valid publication marker exists */ publishedRepo: () => SchemaRepository | null;
  /** the route a change may be written through (null = this device has none) */ writeRoute: () => WriteRoute | null;
  /** is "file not found" from the authenticated route a FINAL answer? True for the broker and the test repository; For a bare device token it is true only when the repository itself is readable with that token, because GitHub answers 404 both for a missing file and for a private repository the token cannot see (default: true) */ authAbsentIsFinal?: () => boolean | Promise<boolean>;
  /** optional: ask GitHub whether a device token may write (true / false / null = unknown) */ probeWrite?: (route: WriteRoute) => Promise<boolean | null>;
  /** optional: refresh the publication marker before the refresh that follows a failed unlock */ beforeUnlockRefresh?: () => Promise<void>;
  secrets?: () => string[]; now?: () => number; path?: string;
}
export type FailStep = 'policy' | 'verify' | 'access' | 'read' | 'write' | 'confirm';
export type FailKind = 'weak' | 'wrong-password' | 'locked' | 'not-signed-in' | 'no-route' | 'no-permission' | 'network' | 'conflict' | 'service' | 'refused' | 'unexpected';
export type ChangeResult = { ok: true; record: AdminCredentialRecord; message: string } | { ok: false; step: FailStep; kind: FailKind; message: string };
export interface VerifyResult { ok: boolean; locked: boolean; lockedMs: number; /** the entered password is this device's OLD local password, which the central record replaced */ localOnly: boolean; refreshed: RefreshOutcome | null; }
interface Meta { adoptedFrom: AdoptedFrom | null; adoptedAt: number; explained: boolean; noticed: string | null; lastRefusal: { at: string; reason: string; message: string } | null; lastCheck: { at: string; source: ReadSource | null; result: RefreshStatus } | null; }
const EMPTY_META: Meta = { adoptedFrom: null, adoptedAt: 0, explained: false, noticed: null, lastRefusal: null, lastCheck: null };
const LAG_WINDOW_MS = 24 * 3_600_000;

const NO_WRITE_ROUTE_DETAIL = 'This device has no way to write to the repository: no GitHub sign-in through the central repository access service and no GitHub access token';
export const NO_WRITE_ROUTE_MESSAGE = `${NO_WRITE_ROUTE_DETAIL}. Nothing was saved centrally.`;
const FAIL_TAIL: Record<FailStep, string> = { policy: 'Nothing was changed.', verify: 'Nothing was changed.', access: 'Nothing was changed.', read: 'Nothing was changed on this device or in the repository.', write: 'Nothing was changed on this device, and the central record is unchanged.', confirm: 'This device was NOT changed. The repository may already hold the new record — use "Sync with GitHub Now" to refresh, then check again.' };
const STEP_NAME: Record<FailStep, string> = { policy: 'password policy', verify: 'current password', access: 'repository access', read: 'reading the central record', write: 'writing the central record', confirm: 'reading it back' };
const KIND_NAME: Record<FailKind, string> = { weak: 'weak password', 'wrong-password': 'wrong password', locked: 'locked out', 'not-signed-in': 'sign-in', 'no-route': 'no write route', 'no-permission': 'permission', network: 'network', conflict: 'conflict', service: 'repository access service', refused: 'record refused', unexpected: 'unexpected answer' };

export class AdminCredentialService {
  private inflight: Promise<RefreshOutcome> | null = null; private busy: Promise<unknown> | null = null;
  constructor(private deps: CredentialDeps) {}
  private now = (): number => (this.deps.now ?? Date.now)(); private get path(): string { return this.deps.path ?? ADMIN_CREDENTIAL_PATH; }
  private known = (): string[] => this.deps.secrets?.() ?? [];
  private clean = (m: string): string => redactSecrets(m, this.known());

  // ───────────────────────────── what this device holds ─────────────────────────────
  /** The last good central record cached on this device (re-validated strictly on every read), or null when there is none. */
  current(): AdminCredentialRecord | null { const t = this.deps.store.get(KEYS.adminCredential); if (!t) return null; const p = parseAdminCredential(t); return p.ok ? p.record : null; }
  /** What passwordService verifies against. */
  view(): CentralView | null { const r = this.current(); return r ? { marker: r.marker, isDefault: r.isDefault } : null; }
  meta(): Meta { const m = readJson<Partial<Meta>>(this.deps.store, KEYS.adminCredentialMeta, {}); return { ...EMPTY_META, ...(m && typeof m === 'object' ? m : {}) }; }
  private setMeta(p: Partial<Meta>): void { writeJson(this.deps.store, KEYS.adminCredentialMeta, { ...this.meta(), ...p }); }
  private adopt(r: AdminCredentialRecord, from: AdoptedFrom): boolean { if (!this.deps.store.set(KEYS.adminCredential, serializeAdminCredential(r))) return false; const back = this.current(); if (!back || !sameCredential(back, r)) return false; this.setMeta({ adoptedFrom: from, adoptedAt: this.now(), noticed: null, lastRefusal: null }); return true; }
  private drop(): void { this.deps.store.remove(KEYS.adminCredential); this.setMeta({ adoptedFrom: null, adoptedAt: 0 }); }
  /** One line for the Security tab and the lock screen (no secret in it). */
  status(): { central: boolean; isDefault: boolean; revision: number | null; updatedAt: string | null; updatedBy: string | null; lastCheck: Meta['lastCheck']; lastRefusal: Meta['lastRefusal'] } {
    const r = this.current(); const m = this.meta(); return { central: !!r, isDefault: !!r?.isDefault, revision: r?.revision ?? null, updatedAt: r?.updatedAt ?? null, updatedBy: r?.updatedBy ?? null, lastCheck: m.lastCheck, lastRefusal: m.lastRefusal };
  }

  // ───────────────────────────── refresh ─────────────────────────────
  refresh(_reason: RefreshReason = 'manual'): Promise<RefreshOutcome> { if (this.inflight) return this.inflight; this.inflight = this.doRefresh().finally(() => { this.inflight = null; }); return this.inflight; }
  private out(o: Partial<RefreshOutcome> & Pick<RefreshOutcome, 'status' | 'message'>, previous: AdminCredentialRecord | null): RefreshOutcome {
    const record = this.current(); if (record || o.status === 'refused' || this.meta().lastCheck) this.setMeta({ lastCheck: { at: new Date(this.now()).toISOString(), source: o.source ?? null, result: o.status } }); // a device with no central record writes nothing (V17.6.4 storage behaviour)
    return { source: null, record, previous, changed: false, notify: false, explainOnce: false, ...o };
  }
  private async readFrom(repo: SchemaRepository): Promise<{ ok: true; file: RepoFile | null } | { ok: false; message: string }> { try { return { ok: true, file: await repo.read(this.path) }; } catch (e) { return { ok: false, message: this.clean((e as Error).message || 'the read failed') }; } }
  /** The published copy lags behind a change that this device already knows about (it saved it, or read it fresh): that is not a rollback attack and is not announced. */
  private lagging(source: ReadSource, previous: AdminCredentialRecord | null, incomingRevision: number | null): boolean {
    if (source !== 'published' || !previous) return false; const m = this.meta(); if (!m.adoptedFrom || m.adoptedFrom === 'published' || this.now() - m.adoptedAt > LAG_WINDOW_MS) return false; return incomingRevision === null || incomingRevision < previous.revision;
  }
  private async doRefresh(): Promise<RefreshOutcome> {
    const previous = this.current(); let found: { source: ReadSource; file: RepoFile | null } | null = null; let failure: string | null = null; let unconfirmed = false;
    const auth = this.deps.authRepo(); if (auth) { const r = await this.readFrom(auth); if (!r.ok) failure = r.message; else if (r.file === null && !(await (this.deps.authAbsentIsFinal?.() ?? true))) unconfirmed = true; else found = { source: 'authenticated', file: r.file }; }
    if (!found) { const pub = this.deps.publishedRepo(); if (pub) { const r = await this.readFrom(pub); if (r.ok) found = { source: 'published', file: r.file }; else failure = failure ?? r.message; } }
    if (!found && unconfirmed) return this.out({ status: 'unavailable', message: 'The repository did not return the central Admin Password record (it may not exist, or the token on this device may not be allowed to see the repository), and no published copy answered. This device keeps the record it holds.' }, previous);
    if (!found) return failure ? this.out({ status: 'unreachable', message: `The central Admin Password record could not be refreshed (${failure}). This device keeps the last good record.` }, previous) : this.out({ status: 'unavailable', message: 'No repository access and no published copy are available on this device, so the central Admin Password record was not checked.' }, previous);
    const { source, file } = found;
    if (!file) {
      if (!previous) return this.out({ status: 'absent', source, message: 'There is no central Admin Password record; this device uses its own password.' }, previous);
      if (source === 'published' && this.meta().adoptedFrom !== 'published') return this.out({ status: 'pending', source, message: 'The published copy does not list the central Admin Password record (yet); this device keeps the record it holds.' }, previous);
      this.drop(); return this.out({ status: 'absent', source, changed: true, notify: true, message: 'The central Admin Password record is no longer in the repository. This device uses its own local password again.' }, previous);
    }
    const parsed = parseAdminCredential(file.text); if (!parsed.ok) return this.refuse(parsed.reason, parsed.message, file.text, source, previous);
    if (!(await credentialIsConsistent(parsed.record))) return this.refuse('tampered', 'its encrypted marker does not match its "isDefault" flag', file.text, source, previous);
    const d = decideAdoption(previous, parsed.record);
    if (d.action === 'refuse') { if (d.reason === 'rollback' && this.lagging(source, previous, parsed.record.revision)) return this.out({ status: 'pending', source, message: 'The published copy is not up to date yet (it still shows an older revision); this device keeps the newer record it already holds.' }, previous); return this.refuse(d.reason, d.message, file.text, source, previous); }
    if (d.action === 'same') { this.setMeta({ noticed: null, lastRefusal: null }); return this.out({ status: 'unchanged', source, message: 'The central Admin Password record is up to date.', explainOnce: this.takeExplain() }, previous); }
    if (!this.adopt(parsed.record, source)) return this.out({ status: 'unreachable', source, message: 'Browser storage rejected the write, so the central Admin Password record could not be kept on this device.' }, previous);
    return this.out({ status: 'applied', source, changed: true, message: parsed.record.isDefault ? 'The Admin Password was reset to the default on another device.' : 'The Admin Password was changed on another device.', explainOnce: this.takeExplain() }, previous);
  }
  private takeExplain(): boolean { if (this.meta().explained || !hasLocalPassword()) return false; this.setMeta({ explained: true }); return true; }
  private async refuse(reason: string, detail: string, text: string, source: ReadSource, previous: AdminCredentialRecord | null): Promise<RefreshOutcome> {
    const fp = `${reason}:${(await sha256Hex(String(text))).slice(0, 16)}`; const notify = this.meta().noticed !== fp;
    const message = `The central Admin Password record was refused (${detail}). This device keeps ${previous ? 'the last good record' : 'using its local password'}.`;
    this.setMeta({ noticed: fp, lastRefusal: { at: new Date(this.now()).toISOString(), reason, message } }); return this.out({ status: 'refused', source, message, notify }, previous);
  }

  // ───────────────────────────── verification (unlock and every protected action that wants a refresh-then-retry) ─────────────────────────────
  /** Checks a password with the lock-out. When it fails, the record is refreshed ONCE (a password changed on another device then works at once) and the check is repeated before it counts as a wrong attempt. */
  async verifyWithRefresh(candidate: string): Promise<VerifyResult> {
    const rem = lockRemainingMs(this.now()); if (rem > 0) return { ok: false, locked: true, lockedMs: rem, localOnly: false, refreshed: null };
    let ok = await checkPassword(candidate); let refreshed: RefreshOutcome | null = null;
    if (!ok) { try { await this.deps.beforeUnlockRefresh?.(); refreshed = await this.refresh('unlock-failed'); } catch { refreshed = null; } if (refreshed?.changed) ok = await checkPassword(candidate); }
    recordAttempt(ok, this.now()); const left = lockRemainingMs(this.now()); const localOnly = !ok && !!this.current() && (await localPasswordMatches(candidate));
    return { ok, locked: !ok && left > 0, lockedMs: left, localOnly, refreshed };
  }

  // ───────────────────────────── Save and Reset ─────────────────────────────
  /** The message names the step and, for access / read / write / read-back, the kind (sign-in, permission, network, conflict …), then the cause, then what is unchanged. */
  private fail(step: FailStep, kind: FailKind, detail: string): ChangeResult {
    const head = step === 'policy' || step === 'verify' ? '' : `Failed at "${STEP_NAME[step]}" (${KIND_NAME[kind]}): `; return { ok: false, step, kind, message: `${head}${detail}${/[.!?]$/.test(detail) ? '' : '.'} ${FAIL_TAIL[step]}` };
  }
  private classify(e: unknown): { kind: FailKind; detail: string } {
    const m = this.clean((e as Error)?.message || 'The request failed'); const re = e instanceof RepositoryError ? e : null; const k = re ? re.kind : null;
    if (k === 'permission') return re!.status === 429 || /limiting requests/i.test(m) ? { kind: 'network', detail: m } : { kind: 'no-permission', detail: m }; // 429 / the service's own rate limit = "try again later"; 403 = no write permission
    if (k === 'signin' || k === 'auth') return { kind: 'not-signed-in', detail: m }; if (k === 'conflict' || /changed on the server/i.test(m)) return { kind: 'conflict', detail: `The record changed on the server while it was being saved (${m.replace(/\.$/, '')})` };
    if (k === 'timeout' || k === 'network') return { kind: 'network', detail: m }; if (k === 'pat-missing' || k === 'pat-rejected' || k === 'pat-insufficient' || k === 'config' || k === 'not-found') return { kind: 'service', detail: m }; return { kind: 'unexpected', detail: m };
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> { const run = async () => { while (this.busy) { try { await this.busy; } catch { /* ignore */ } } const p = fn(); this.busy = p; try { return await p; } finally { this.busy = null; } }; return run(); }
  private async access(ensure: (() => Promise<AccessOutcome>) | undefined, forReset: boolean): Promise<{ ok: true; route: WriteRoute } | { ok: false; result: ChangeResult }> {
    if (ensure) { const a = await ensure(); if (!a.ok) return { ok: false, result: this.fail('access', 'not-signed-in', a.cancelled ? 'The GitHub sign-in was cancelled' : a.message.replace(/\s*Nothing was changed\.?$/i, '')) }; }
    const route = this.deps.writeRoute(); if (!route) return { ok: false, result: this.fail('access', 'no-route', `${NO_WRITE_ROUTE_DETAIL}${forReset ? '. A reset needs the current Admin Password or a GitHub sign-in with write access, and a way to write to the repository' : ''}`) };
    if (route.canWrite === false) return { ok: false, result: this.fail('access', 'no-permission', 'Your GitHub account has read-only access to the repository, so it cannot write the central Admin Password record. Ask the repository owner for write access') };
    return { ok: true, route };
  }
  /** Reads the record through the write route, builds the next one, writes it, reads it back, and only then applies it on this device. */
  private async commit(route: WriteRoute, password: string, isDefault: boolean, message: string): Promise<ChangeResult> {
    let remote: RepoFile | null; try { remote = await route.repo.read(this.path); } catch (e) { const c = this.classify(e); return this.fail('read', c.kind, c.detail); }
    let base = this.current(); if (remote) { const p = parseAdminCredential(remote.text); if (p.ok && (!base || p.record.revision > base.revision)) base = p.record; } // a damaged remote file is replaced (its sha is used); a newer remote revision is built upon
    const rec = await buildAdminCredential(password, { previous: base, updatedBy: this.deps.deviceId(), isDefault }); const text = serializeAdminCredential(rec);
    try { await route.repo.write(this.path, text, remote ? remote.sha : null, message); } catch (e) { const c = this.classify(e); return this.fail('write', c.kind, c.detail); }
    let back: RepoFile | null; try { back = await route.repo.read(this.path); } catch (e) { const c = this.classify(e); return this.fail('confirm', c.kind, `The record was sent but could not be read back (${c.detail.replace(/\.$/, '')})`); }
    const bp = back ? parseAdminCredential(back.text) : null; if (!bp || !bp.ok || !sameCredential(bp.record, rec) || !(await credentialMatches(bp.record, password))) return this.fail('confirm', 'refused', 'The record that the repository returned is not the one that was written');
    if (!this.adopt(rec, 'save')) return this.fail('confirm', 'unexpected', 'Browser storage rejected the write, so this device could not keep the new record');
    this.setMeta({ explained: true }); return { ok: true, record: rec, message: '' };
  }
  /** Settings → Security → "Save (all devices)". Order: policy → current password → access → read → write → read back → apply. */
  save(i: { current: string; next: string; ensureAccess?: () => Promise<AccessOutcome> }): Promise<ChangeResult> {
    return this.exclusive(async () => {
      const pol = checkNewPassword(i.next); if (!pol.ok) return this.fail('policy', 'weak', pol.message);
      const v = await this.verifyWithRefresh(i.current); if (!v.ok) return v.locked ? this.fail('verify', 'locked', lockMessage(v.lockedMs)) : this.fail('verify', 'wrong-password', v.localOnly ? 'The current password is incorrect: that is the old password stored on this device, which the central Admin Password replaced' : 'The current password is incorrect');
      const a = await this.access(i.ensureAccess, false); if (!a.ok) return a.result;
      return this.commit(a.route, i.next, false, 'Update the Admin Password record');
    });
  }
  /** Settings → Security → "Reset to default". Authorized by the current Admin Password, or — for a forgotten password — by a GitHub sign-in with write access. Nobody else can trigger it. */
  reset(i: { currentPassword?: string; ensureAccess?: () => Promise<AccessOutcome> }): Promise<ChangeResult & { authorizedBy?: 'password' | 'signin' }> {
    return this.exclusive(async () => {
      const byPassword = !!(i.currentPassword && i.currentPassword.length > 0);
      if (byPassword) { const v = await this.verifyWithRefresh(i.currentPassword as string); if (!v.ok) return v.locked ? this.fail('verify', 'locked', lockMessage(v.lockedMs)) : this.fail('verify', 'wrong-password', 'The current password is incorrect'); }
      const a = await this.access(i.ensureAccess, true); if (!a.ok) return a.result;
      if (!byPassword) { const cw = a.route.canWrite ?? (this.deps.probeWrite ? await this.deps.probeWrite(a.route) : null); if (cw === false) return this.fail('access', 'no-permission', 'Your GitHub account has read-only access to the repository, so it cannot reset the Admin Password. Reset needs the current Admin Password or a GitHub sign-in with write access'); }
      const r = await this.commit(a.route, DEFAULT_PASSWORD, true, 'Reset the Admin Password record to the default'); return r.ok ? { ...r, authorizedBy: byPassword ? 'password' : 'signin' } : r;
    });
  }
}
