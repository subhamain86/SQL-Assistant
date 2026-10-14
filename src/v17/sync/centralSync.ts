/**
 * V17.6.8 — MANUAL "SYNC" (navigation bar). ONE run of the EXISTING centralized synchronization, started by the user.
 *
 * This module contains NO synchronization logic of its own and opens NO connection: it calls, in a fixed order, the same service methods that the scheduled synchronization and
 * Settings → Schema Management → "Sync with GitHub Now" already call, through the repository that repository() in ui/context.ts decides (central access session → published read-only copy → device token).
 *
 *   1. repository authorization   — the existing path (ensureRepositoryAccess): a valid central session is reused; the GitHub sign-in is started only when there is none
 *   2. Admin Password             — AdminPasswordService.synchronize(): retrieve → validate → apply the central verifier (a changed verifier invalidates Settings sessions through the authority) → publish a pending change
 *   3. Schemas + synchronization metadata — SyncService.synchronize(): pull, merge by the existing revision rules, publish eligible local changes
 *   4. Knowledge                  — KnowledgeSync.synchronize()
 *   5. Admin message              — AdminMessageService.synchronize()
 *   6. Secret Vault               — reported, never changed: the repository vault is opened only with its passphrase (Schema → Pull Secret Vault); Sync reads the file to report on it and changes nothing
 *
 * Duplicate concurrent runs are refused (the second caller gets the result "skipped — already running"). Every step reports its own honest status; the overall result is success / partial / skipped / failed.
 * A step never throws into the caller: a service failure becomes a failed step. No message contains a credential (messages come from the services, which redact; a last redaction pass is applied here).
 */
import type { AdminPasswordOutcome } from '../services/adminPassword';
import type { PullOutcome, PushOutcome } from './syncService';
import type { KnowledgeOutcome } from '../services/knowledgeSync';
import type { AdminMessageOutcome } from '../services/adminMessage';
import { redactSecrets } from '../errors/appErrors';

export type StepId = 'access' | 'admin-password' | 'schemas' | 'knowledge' | 'admin-message' | 'secret-vault';
export type StepStatus = 'ok' | 'partial' | 'failed' | 'skipped';
export type SyncResultStatus = 'success' | 'partial' | 'failed' | 'skipped';
export interface SyncStep { id: StepId; label: string; status: StepStatus; message: string; /** informational: does not count towards the overall result */ neutral?: boolean }
export interface CentralSyncResult { status: SyncResultStatus; steps: SyncStep[]; summary: string; /** a different central Admin Password was applied during this run (Settings sessions were invalidated) */ adminPasswordApplied: boolean; alreadyRunning?: boolean; startedAt: string; finishedAt: string }
export type AccessOutcome = { ok: true } | { ok: false; message: string; cancelled: boolean };
export interface VaultReport { present: boolean; valid: boolean; message: string }
export interface CentralSyncDeps {
  adminPassword: { synchronize(): Promise<AdminPasswordOutcome> };
  schemas: { synchronize(): Promise<{ pull: PullOutcome; push: PushOutcome | null }> };
  knowledge: { synchronize(): Promise<KnowledgeOutcome> };
  adminMessage: { synchronize(): Promise<AdminMessageOutcome> };
  /** is a repository connection available right now (central session / published copy / token)? */
  hasRepository: () => boolean;
  /** read-only look at the repository Secret Vault file; may be omitted */
  vaultReport?: () => Promise<VaultReport>;
  secrets?: () => string[];
  now?: () => Date;
}
export interface CentralSyncRunOptions { /** the existing repository authorization path (ensureRepositoryAccess); omitted = use the connection that exists */ ensureAccess?: () => Promise<AccessOutcome>; onProgress?: (p: { step: StepId; label: string; index: number; total: number }) => void }
const LABEL: Record<StepId, string> = { access: 'Repository access', 'admin-password': 'Admin Password', schemas: 'Schemas and synchronization metadata', knowledge: 'Knowledge', 'admin-message': 'Admin message', 'secret-vault': 'Secret Vault' };
const ORDER: StepId[] = ['admin-password', 'schemas', 'knowledge', 'admin-message', 'secret-vault'];

// ───────── pure mapping of the existing outcomes to honest step results (unit-tested)
export function mapAdminPassword(o: AdminPasswordOutcome): { status: StepStatus; message: string } {
  if (!o.ok) return { status: 'failed', message: o.message || 'The central Admin Password could not be synchronized.' };
  return { status: 'ok', message: o.message || (o.synchronized ? 'Admin Password is up to date.' : 'Nothing to synchronize.') };
}
export function mapSchemas(r: { pull: PullOutcome; push: PushOutcome | null }): { status: StepStatus; message: string } {
  const p = r.pull; if (p.fileProblem || (!p.ok && !p.remoteMissing)) return { status: 'failed', message: `${p.stage ? `${p.stage}: ` : ''}${p.fileProblem || 'The repository schema file could not be read.'}` };
  if (p.remoteMissing) return { status: 'ok', message: 'No schema file exists in the repository yet — nothing to pull.' };
  const issues: string[] = []; if (p.rejected.length) issues.push(`${p.rejected.length} repository schema(s) failed validation (local copies kept)`); if (p.conflicts.length) issues.push(`${p.conflicts.length} conflict(s) need a decision (Settings → Synchronization)`);
  if (r.push && !r.push.ok) issues.push(`publishing local changes did not complete: ${[...r.push.problems, ...r.push.messages].filter(Boolean).slice(0, 2).join(' ') || r.push.skipped || 'see the synchronization log'}`);
  if (issues.length) return { status: 'partial', message: `Pulled; ${issues.join('; ')}.` };
  const parts = [p.added.length ? `${p.added.length} added` : '', p.updated.length ? `${p.updated.length} updated` : ''].filter(Boolean); return { status: 'ok', message: `Schemas synchronized${parts.length ? ` (${parts.join(', ')})` : ' — already up to date'}${r.push?.ok ? '; local changes published' : ''}.` };
}
export function mapKnowledge(o: KnowledgeOutcome): { status: StepStatus; message: string } {
  if (!o.ok) return { status: 'failed', message: `${o.stage ? `${o.stage}: ` : ''}${o.message}` };
  if (o.rejected.length) return { status: 'partial', message: `${o.message} ${o.rejected.length} record(s) were rejected.` }; return { status: 'ok', message: o.message || 'Knowledge synchronized.' };
}
export function mapAdminMessage(o: AdminMessageOutcome): { status: StepStatus; message: string } { return o.ok ? { status: 'ok', message: o.message || 'Admin message synchronized.' } : { status: 'failed', message: `${o.stage ? `${o.stage}: ` : ''}${o.message}` }; }
/** success = nothing failed or partial; skipped = nothing ran; partial = something worked and something did not; failed = nothing that ran succeeded */
export function overall(steps: SyncStep[]): SyncResultStatus {
  const counted = steps.filter((s) => !s.neutral); if (!counted.length || counted.every((s) => s.status === 'skipped')) return 'skipped';
  const ran = counted.filter((s) => s.status !== 'skipped'); const bad = ran.filter((s) => s.status === 'failed'); const part = ran.filter((s) => s.status === 'partial');
  if (!bad.length && !part.length) return 'success'; return bad.length === ran.length ? 'failed' : 'partial';
}
export const SUMMARY: Record<SyncResultStatus, string> = { success: 'Synchronized', partial: 'Partly synchronized', failed: 'Synchronization failed', skipped: 'Nothing synchronized' };

export class CentralSync {
  private current: Promise<CentralSyncResult> | null = null; private listeners = new Set<(running: boolean) => void>(); private last: CentralSyncResult | null = null;
  constructor(private d: CentralSyncDeps) {}
  running(): boolean { return this.current !== null; } lastResult(): CentralSyncResult | null { return this.last; }
  subscribe(fn: (running: boolean) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(): void { const r = this.running(); this.listeners.forEach((l) => { try { l(r); } catch { /* a listener must never break a run */ } }); }
  private clean(m: string): string { return redactSecrets(String(m ?? ''), this.d.secrets ? this.d.secrets() : []).slice(0, 600); }
  /** Starts one run. A run that is already in progress is NOT duplicated: the caller gets an immediate "skipped — already running" result. */
  run(o: CentralSyncRunOptions = {}): Promise<CentralSyncResult> {
    const nowIso = () => (this.d.now ? this.d.now() : new Date()).toISOString();
    if (this.current) { const t = nowIso(); return Promise.resolve({ status: 'skipped', steps: [], summary: 'A synchronization is already running.', adminPasswordApplied: false, alreadyRunning: true, startedAt: t, finishedAt: t }); }
    this.current = this.execute(o, nowIso).finally(() => { this.current = null; this.emit(); }); this.emit(); return this.current;
  }
  private async execute(o: CentralSyncRunOptions, nowIso: () => string): Promise<CentralSyncResult> {
    const startedAt = nowIso(); const steps: SyncStep[] = []; let applied = false; const finish = (): CentralSyncResult => { const status = overall(steps); const res: CentralSyncResult = { status, steps, summary: SUMMARY[status], adminPasswordApplied: applied, startedAt, finishedAt: nowIso() }; this.last = res; return res; };
    const skipAll = (why: string, status: StepStatus = 'skipped') => { steps.push({ id: 'access', label: LABEL.access, status, message: this.clean(why) }); ORDER.forEach((id) => steps.push({ id, label: LABEL[id], status: 'skipped', message: 'Not run.', neutral: id === 'secret-vault' })); };
    // 1 — the existing repository authorization path
    try { if (o.ensureAccess) { const a = await o.ensureAccess(); if (!a.ok) { skipAll(a.message, a.cancelled ? 'skipped' : 'failed'); const r = finish(); if (!a.cancelled) { r.status = 'failed'; r.summary = SUMMARY.failed; } else { r.summary = 'Synchronization cancelled — repository access was not granted.'; } return r; } } }
    catch (e) { skipAll(`Repository access failed: ${(e as Error).message}`, 'failed'); const r = finish(); r.status = 'failed'; r.summary = SUMMARY.failed; return r; }
    if (!this.d.hasRepository()) { skipAll('No repository connection is available on this device (central access session, published copy or saved token). Nothing was synchronized and nothing was changed.'); const r = finish(); r.summary = 'Nothing synchronized — no repository connection on this device.'; return r; }
    steps.push({ id: 'access', label: LABEL.access, status: 'ok', message: 'Repository connection available.', neutral: true });
    const total = ORDER.length; const step = async (id: StepId, index: number, fn: () => Promise<{ status: StepStatus; message: string; neutral?: boolean }>) => { o.onProgress?.({ step: id, label: LABEL[id], index: index + 1, total }); try { const r = await fn(); steps.push({ id, label: LABEL[id], status: r.status, message: this.clean(r.message), ...(r.neutral ? { neutral: true } : {}) }); } catch (e) { steps.push({ id, label: LABEL[id], status: 'failed', message: this.clean((e as Error).message || 'Unexpected failure.') }); } };
    await step('admin-password', 0, async () => { const r = await this.d.adminPassword.synchronize(); if (r.changed) applied = true; return mapAdminPassword(r); });
    await step('schemas', 1, async () => mapSchemas(await this.d.schemas.synchronize()));
    await step('knowledge', 2, async () => mapKnowledge(await this.d.knowledge.synchronize()));
    await step('admin-message', 3, async () => mapAdminMessage(await this.d.adminMessage.synchronize()));
    await step('secret-vault', 4, async () => { if (!this.d.vaultReport) return { status: 'skipped' as StepStatus, neutral: true, message: 'The Secret Vault is opened only with its passphrase (Schema → Pull Secret Vault); Sync does not change it.' }; const v = await this.d.vaultReport(); return { status: 'skipped' as StepStatus, neutral: true, message: `${v.message} It is opened only with its passphrase (Schema → Pull Secret Vault); Sync does not change it.` }; });
    return finish();
  }
}
