/**
 * V17.7.1 — QUERY SUBMISSIONS: how an ordinary user proposes a successfully tested SQL query for the shared Query Library, and how an administrator decides on it.
 *
 *   user tests a query → Add New Query → Submit for approval → PENDING APPROVAL → administrator reviews → Approve / Reject → an approved query becomes an entry of the Admin Query Library
 *
 * Design rules (each one tested in test/v1771.test.mjs):
 *   · A submission is NOT a library entry. It lives in its own store (sqla.querysubs.v1771) and its own repository file (…/knowledge/submissions.json) and is never read by the NLU, the retrieval or the
 *     trusted-example logic: AdminQueryLibrary.trusted() / hints() only ever look at the library. Nothing a user submits — locally or through the repository — can make a query trusted.
 *   · The ONLY way into the library is approve(): it needs the one-time ACTION TICKET that a successful Admin Password check (verifyPassword(…, 'admin-action')) issues and consumes it. The decision is therefore
 *     authorized at the place where it is made, not by hiding a button. It then goes through the existing AdminQueryLibrary.upsert() + approve() (validated against the Active Schema, SELECT / WITH only),
 *     so an approved submission is an ordinary library entry in every respect. reject() needs the same ticket.
 *   · Submitted SQL is untrusted text: it is never executed (SQL Assistant never executes SQL), only read-only SELECT / WITH statements are accepted at all (a destructive statement or a credential is refused at
 *     submission and again when a file is read), metadata is clipped and control characters are removed, and everything is escaped where it is displayed.
 *   · The SQL text is preserved exactly as submitted. Schema warnings (unknown table / column, a failed check) do not block a submission — the administrator sees them — but they block an approval until fixed.
 *   · Sharing: when the repository connection may write, the pending submission is published to …/knowledge/submissions.json (never into knowledge.json: a V17.7 device rewrites that file without knowing
 *     anything new in it, which would drop the submissions). A connection that cannot write (read-only GitHub account, published copy, no connection) keeps the submission on the device and says so; the submission
 *     can be exported as a file and imported by the administrator. publish-data.mjs does not publish submissions.json to the site: unreviewed SQL is not served to every device.
 *   · Duplicates: the same SQL (comparison ignores case, whitespace, comments and a trailing semicolon) is refused while it is pending or already in the library; a name that is taken is refused.
 */
import type { Dialect, SchemaModel } from '../../types';
import { readJson, writeJson, type KeyValueStore } from '../../services/storage';
import { containsSecret, redactSecrets } from '../errors/appErrors';
import { validateReadOnlySql } from '../../engines/validationEngine';
import { WRITER_LABEL } from '../sync/schemaFormat';
import { takeActionTicket } from '../../services/passwordService';
import { validateAdminQuery, type AdminDialect, type AdminInput, type AdminQueryLibrary } from './adminLibrary';
import { repositoryErrorKind, type SchemaRepository } from './githubClient';

export const SUBMISSION_FORMAT = 'sqla-query-submissions'; export const SUBMISSION_FORMAT_VERSION = 1;
export const SUBMISSIONS_KEY = 'sqla.querysubs.v1771'; export const SUBMISSIONS_SYNC_KEY = 'sqla.querysubssync.v1771';
export type SubmissionStatus = 'pending' | 'approved' | 'rejected';
export const STATUS_LABEL: Record<SubmissionStatus, string> = { pending: 'Pending approval', approved: 'Approved', rejected: 'Rejected' };
export interface QuerySubmission {
  id: string; name: string; description: string; purpose: string; sql: string; tables: string[]; columns: string[]; tags: string[]; dialect: AdminDialect; schemaName: string; schemaVersions: string; usageNotes: string;
  submittedBy: string; /** the device that created it — "my submissions" are the ones of this device */ device: string; submittedAt: string; updatedAt: string; testedByUser: boolean;
  status: SubmissionStatus; reviewedBy: string; reviewedAt: string | null; reviewNote: string; /** id of the library entry an approval created */ libraryId: string; /** schema warnings found at submission (the administrator sees them) */ warnings: string[];
}
export interface SubmissionInput { name: string; sql: string; description?: string; purpose?: string; tables?: string | string[]; columns?: string | string[]; tags?: string | string[]; dialect?: string; schemaName?: string; schemaVersions?: string; usageNotes?: string; submittedBy?: string; testedByUser?: boolean; }
const DIALECTS = ['Any', 'SQL Server', 'Oracle', 'PostgreSQL', 'MySQL', 'Generic']; const ID = /^[A-Za-z0-9_-]{1,64}$/; const ISO = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : new Date(0).toISOString());
/** Metadata is plain text: control characters removed, length capped. (It is escaped again wherever it is shown.) */
const clip = (s: unknown, n: number): string => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, n);
const list = (v: unknown, n = 40): string[] => (Array.isArray(v) ? v : String(v ?? '').split(/[,;\n]+/)).map((x) => clip(x, 80)).filter(Boolean).slice(0, n);
/** The comparison form of a query: comments, case, whitespace and a trailing semicolon do not make two queries different. */
export function normalizeSql(sql: string): string { return String(sql ?? '').replace(/--.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').replace(/[\s;]+$/, '').trim().toLowerCase(); }
export const submissionsPathFor = (schemaPath: string): string => { const p = (schemaPath || '').replace(/^\/+/, ''); const m = p.match(/^(.*?)\/schemas\/[^/]+$/); if (m) return `${m[1]}/knowledge/submissions.json`; const i = p.lastIndexOf('/'); return i > 0 ? `${p.slice(0, i)}/submissions.json` : 'sql-assistant-data/knowledge/submissions.json'; };

/** Why a SQL text can never be a library query (these block a submission). Warnings about the schema are NOT in this list. */
export function sqlBlockers(sql: string): string[] {
  const t = String(sql ?? ''); if (!t.trim()) return ['The SQL query is required.']; const out: string[] = [];
  if (t.length > 20000) out.push('The SQL query is longer than 20,000 characters.');
  if (containsSecret(t)) out.push('The query looks like it contains a credential (token / key / password) and cannot be submitted.');
  const body = t.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (!/^\s*\(*\s*(WITH|SELECT)\b/i.test(body)) out.push('Only read-only SELECT / WITH queries can be added to the Query Library.');
  validateReadOnlySql(t).issues.filter((i) => i.severity === 'error').forEach((i) => out.push(i.message.replace(' in the Read Only Query Builder', ' in the Query Library')));
  return Array.from(new Set(out));
}
/** A record read from a file or from the store: structure checked, every string clipped, status forced into the known set. Returns the reason when the record is refused. */
export function sanitizeSubmission(o: unknown): QuerySubmission | string {
  const x = o as Record<string, unknown> | null; if (!x || typeof x !== 'object' || !ID.test(String(x.id))) return 'invalid id'; if (typeof x.name !== 'string' || !x.name.trim() || typeof x.sql !== 'string' || !x.sql.trim()) return 'name / SQL missing';
  if (containsSecret(`${x.name} ${x.description || ''} ${x.usageNotes || ''} ${x.reviewNote || ''} ${x.sql}`)) return 'contains a credential'; if (sqlBlockers(String(x.sql)).length) return 'contains SQL that is not a read-only SELECT / WITH';
  const status: SubmissionStatus = x.status === 'approved' || x.status === 'rejected' ? x.status : 'pending';
  return { id: String(x.id), name: clip(x.name, 120), description: clip(x.description, 600), purpose: clip(x.purpose, 300), sql: String(x.sql).slice(0, 20000), tables: list(x.tables), columns: list(x.columns, 80), tags: list(x.tags, 20).map((t) => t.toLowerCase()), dialect: (DIALECTS.includes(String(x.dialect)) ? x.dialect : 'Any') as AdminDialect, schemaName: clip(x.schemaName, 80), schemaVersions: clip(x.schemaVersions, 80), usageNotes: clip(x.usageNotes, 600),
    submittedBy: clip(x.submittedBy, 80) || 'User', device: clip(x.device, 40), submittedAt: ISO(x.submittedAt), updatedAt: ISO(x.updatedAt), testedByUser: x.testedByUser === true, status, reviewedBy: clip(x.reviewedBy, 80), reviewedAt: x.reviewedAt ? ISO(x.reviewedAt) : null, reviewNote: clip(x.reviewNote, 300), libraryId: ID.test(String(x.libraryId || '')) ? String(x.libraryId) : '', warnings: (Array.isArray(x.warnings) ? x.warnings : []).slice(0, 20).map((w) => clip(w, 300)).filter(Boolean) };
}
export function parseSubmissions(text: string): { ok: boolean; problem: string; submissions: QuerySubmission[]; rejected: string[] } {
  let v: any; try { v = JSON.parse(String(text ?? '').replace(/^\uFEFF/, '')); } catch (err) { return { ok: false, problem: `The file is not valid JSON (${(err as Error).message}).`, submissions: [], rejected: [] }; }
  if (!v || v.format !== SUBMISSION_FORMAT) return { ok: false, problem: 'The file is not a SQL Assistant query submissions file (format marker missing).', submissions: [], rejected: [] };
  if (typeof v.formatVersion === 'number' && v.formatVersion > SUBMISSION_FORMAT_VERSION) return { ok: false, problem: `The file uses format ${v.formatVersion}; update SQL Assistant on this device to read it.`, submissions: [], rejected: [] };
  const submissions: QuerySubmission[] = []; const rejected: string[] = []; (Array.isArray(v.submissions) ? v.submissions.slice(0, 2000) : []).forEach((o: unknown, i: number) => { const r = sanitizeSubmission(o); if (typeof r === 'string') rejected.push(`submission #${i + 1}: ${r}`); else submissions.push(r); });
  return { ok: true, problem: '', submissions, rejected };
}
const fnv = (s: string): string => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return `${h.toString(16)}-${s.length.toString(36)}`; };
const RANK: Record<SubmissionStatus, number> = { pending: 0, rejected: 1, approved: 1 };

export class QuerySubmissions {
  private cache: { raw: string | null; list: QuerySubmission[] } | null = null;
  /** `device` identifies this device ("my submissions"); `who` is the name an administrator's decision is recorded under. */
  constructor(private store: KeyValueStore, private device: () => string, private who: () => string = () => 'Administrator') {}
  private bag(): QuerySubmission[] { const raw = this.store.get(SUBMISSIONS_KEY); if (this.cache && this.cache.raw === raw) return this.cache.list; let l: QuerySubmission[] = []; try { const b = raw ? JSON.parse(raw) : null; l = (Array.isArray(b?.submissions) ? b.submissions : []).map((o: unknown) => sanitizeSubmission(o)).filter((r: QuerySubmission | string): r is QuerySubmission => typeof r !== 'string'); } catch { l = []; } this.cache = { raw, list: l }; return l; }
  private save(l: QuerySubmission[]): boolean { const ok = writeJson(this.store, SUBMISSIONS_KEY, { schemaVersion: 1, submissions: l }); this.cache = { raw: this.store.get(SUBMISSIONS_KEY), list: l }; return ok; }
  all(): QuerySubmission[] { return this.bag().slice().sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)); }
  pending(): QuerySubmission[] { return this.all().filter((s) => s.status === 'pending'); } decided(): QuerySubmission[] { return this.all().filter((s) => s.status !== 'pending'); }
  mine(): QuerySubmission[] { const d = this.device(); return this.all().filter((s) => s.device === d); } get(id: string): QuerySubmission | undefined { return this.bag().find((s) => s.id === id); }
  hash(): string { return fnv(JSON.stringify(this.bag().map((s) => [s.id, s.status, s.updatedAt]))); }

  /** Everything that can be said about a submission BEFORE it is saved: blockers (it cannot be submitted), warnings (it can, the administrator will see them) and duplicates. Pure — nothing is stored. */
  check(i: SubmissionInput, s: SchemaModel, lib: AdminQueryLibrary): { blockers: string[]; warnings: string[] } {
    const blockers: string[] = []; const name = clip(i.name, 120); if (!name) blockers.push('Query name is required.'); blockers.push(...sqlBlockers(i.sql));
    if (containsSecret(`${name} ${i.description || ''} ${i.purpose || ''} ${i.usageNotes || ''}`)) blockers.push('The name, description or notes look like they contain a credential and cannot be submitted.');
    if (i.testedByUser !== true) blockers.push('Confirm that you ran this query successfully before submitting it.');
    const norm = normalizeSql(i.sql); if (norm) {
      const inLib = lib.all().find((q) => normalizeSql(q.sql) === norm); if (inLib) blockers.push(`The Query Library already contains this query as "${inLib.name}".`);
      const pend = this.pending().find((q) => normalizeSql(q.sql) === norm); if (pend) blockers.push(`This query is already waiting for approval ("${pend.name}", submitted ${pend.submittedAt.slice(0, 10)}).`); }
    if (name) { const l = name.toLowerCase(); if (lib.all().some((q) => q.name.toLowerCase() === l)) blockers.push(`A query named "${name}" already exists in the Query Library — choose another name.`); if (this.pending().some((q) => q.name.toLowerCase() === l)) blockers.push(`A submission named "${name}" is already waiting for approval — choose another name.`); }
    let warnings: string[] = []; if (!sqlBlockers(i.sql).length) { try { const dialect = (i.dialect && i.dialect !== 'Any' && DIALECTS.includes(i.dialect) ? i.dialect : 'Generic') as Dialect; const v = validateAdminQuery({ name: name || 'x', sql: i.sql, dialect: (DIALECTS.includes(String(i.dialect)) ? i.dialect : 'Any') as AdminDialect, tables: list(i.tables), columns: list(i.columns), schemaName: clip(i.schemaName, 80), schemaVersions: clip(i.schemaVersions, 80) || '*' }, s, dialect); warnings = [...v.errors, ...v.warnings]; } catch (err) { warnings = [`The query could not be checked against the Active Schema (${(err as Error).message}).`]; } }
    return { blockers: Array.from(new Set(blockers)), warnings: Array.from(new Set(warnings)).map((w) => clip(w, 300)) };
  }
  /** Saves a PENDING submission. Success is reported only when browser storage accepted the write. */
  submit(i: SubmissionInput, s: SchemaModel, lib: AdminQueryLibrary): { ok: boolean; errors: string[]; warnings: string[]; submission?: QuerySubmission } {
    const c = this.check(i, s, lib); if (c.blockers.length) return { ok: false, errors: c.blockers, warnings: c.warnings };
    const now = new Date().toISOString(); const sub: QuerySubmission = { id: `qs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, name: clip(i.name, 120), description: clip(i.description, 600), purpose: clip(i.purpose, 300), sql: String(i.sql).trim().slice(0, 20000), tables: list(i.tables), columns: list(i.columns, 80), tags: list(i.tags, 20).map((t) => t.toLowerCase()), dialect: (DIALECTS.includes(String(i.dialect)) ? i.dialect : 'Any') as AdminDialect, schemaName: clip(i.schemaName, 80), schemaVersions: clip(i.schemaVersions, 80) || '*', usageNotes: clip(i.usageNotes, 600), submittedBy: clip(i.submittedBy, 80) || 'User', device: this.device(), submittedAt: now, updatedAt: now, testedByUser: true, status: 'pending', reviewedBy: '', reviewedAt: null, reviewNote: '', libraryId: '', warnings: c.warnings.slice(0, 20) };
    const l = this.bag().slice(); l.unshift(sub); return this.save(l) ? { ok: true, errors: [], warnings: c.warnings, submission: sub } : { ok: false, errors: ['Browser storage rejected the write — the submission was NOT saved.'], warnings: c.warnings };
  }
  /** What stands in the way of approving a pending submission now (pure; the administrator UI shows this before it asks for the password). */
  approvalProblems(id: string, lib: AdminQueryLibrary, s: SchemaModel, d: Dialect): string[] {
    const sub = this.get(id); if (!sub) return ['The submission was not found.']; if (sub.status !== 'pending') return [`This submission was already ${sub.status === 'approved' ? 'approved' : 'rejected'}.`];
    const out: string[] = []; const norm = normalizeSql(sub.sql); const dup = lib.all().find((q) => normalizeSql(q.sql) === norm); if (dup) out.push(`The Query Library already contains this query as "${dup.name}" — reject the submission as a duplicate.`);
    if (lib.all().some((q) => q.name.toLowerCase() === sub.name.toLowerCase())) out.push(`A library query named "${sub.name}" already exists — reject the submission or ask the user to rename it.`);
    const v = validateAdminQuery(this.asInput(sub), s, d); if (!v.valid) out.push(...v.errors.map((x) => `Not valid against the Active Schema "${s.name}": ${x}`)); return out;
  }
  private asInput(sub: QuerySubmission): AdminInput { return { name: sub.name, sql: sub.sql, description: sub.description, purpose: sub.purpose, tables: sub.tables, columns: sub.columns, tags: sub.tags, dialect: sub.dialect, schemaName: sub.schemaName, schemaVersions: sub.schemaVersions, createdBy: sub.submittedBy, enabled: true }; }
  /** ADMINISTRATOR ONLY. Needs the one-time action ticket of a successful Admin Password check. Creates the library entry through the existing AdminQueryLibrary (upsert + approve), then marks the submission approved. */
  approve(id: string, lib: AdminQueryLibrary, s: SchemaModel, d: Dialect): { ok: boolean; errors: string[]; libraryId?: string } {
    if (!takeActionTicket()) return { ok: false, errors: ['Administrator authorization is required: confirm the Admin Password to approve a query. Nothing was changed.'] };
    const problems = this.approvalProblems(id, lib, s, d); if (problems.length) return { ok: false, errors: problems };
    const sub = this.get(id)!; const up = lib.upsert(this.asInput(sub)); if (!up.ok || !up.query) return { ok: false, errors: up.errors };
    const ap = lib.approve(up.query.id, s, d, this.who()); if (!ap.ok) { lib.remove(up.query.id); return { ok: false, errors: ap.errors }; }
    const l = this.bag().slice(); const t = l.find((x) => x.id === id)!; const now = new Date().toISOString(); t.status = 'approved'; t.reviewedBy = this.who(); t.reviewedAt = now; t.updatedAt = now; t.libraryId = up.query.id; t.reviewNote = '';
    return this.save(l) ? { ok: true, errors: [], libraryId: up.query.id } : { ok: false, errors: ['The query was added to the library, but browser storage rejected the status change of the submission. Check the Admin Query Library.'], libraryId: up.query.id };
  }
  /** ADMINISTRATOR ONLY (same ticket). The submission keeps its status and the feedback; it never enters the library. */
  reject(id: string, note: string): { ok: boolean; errors: string[] } {
    if (!takeActionTicket()) return { ok: false, errors: ['Administrator authorization is required: confirm the Admin Password to reject a query. Nothing was changed.'] };
    const l = this.bag().slice(); const t = l.find((x) => x.id === id); if (!t) return { ok: false, errors: ['The submission was not found.'] }; if (t.status !== 'pending') return { ok: false, errors: [`This submission was already ${t.status === 'approved' ? 'approved' : 'rejected'}.`] };
    if (containsSecret(note)) return { ok: false, errors: ['The feedback looks like it contains a credential and cannot be stored.'] };
    const now = new Date().toISOString(); t.status = 'rejected'; t.reviewedBy = this.who(); t.reviewedAt = now; t.updatedAt = now; t.reviewNote = clip(note, 300); return this.save(l) ? { ok: true, errors: [] } : { ok: false, errors: ['Browser storage rejected the write — the submission is still pending.'] };
  }
  /** Merge records from the repository / a file. A decision is never undone by an older copy; otherwise the newer record wins. Nothing here touches the Admin Query Library. */
  mergeRemote(remote: QuerySubmission[]): { added: number; updated: number } {
    const l = this.bag().slice(); let added = 0; let updated = 0;
    remote.forEach((r) => { const x = l.find((y) => y.id === r.id); if (!x) { l.push(r); added++; return; } if (RANK[r.status] > RANK[x.status] || (RANK[r.status] === RANK[x.status] && r.updatedAt > x.updatedAt)) { l[l.indexOf(x)] = r; updated++; } });
    if (added || updated) this.save(l); return { added, updated };
  }
  exportJson(scope: 'mine' | 'all' = 'mine'): string { return JSON.stringify({ format: SUBMISSION_FORMAT, formatVersion: SUBMISSION_FORMAT_VERSION, exportedAt: new Date().toISOString(), writtenBy: WRITER_LABEL, submissions: scope === 'mine' ? this.mine() : this.all() }, null, 2); }
  /** Administrator import of a file a user exported (the fallback when that user's connection cannot write). Only PENDING records are taken from a file: a file can never carry a decision. */
  importFile(text: string): { ok: boolean; message: string; added: number; rejected: string[] } {
    const p = parseSubmissions(text); if (!p.ok) return { ok: false, message: p.problem, added: 0, rejected: [] };
    const known = new Set(this.bag().map((x) => x.id)); const fresh = p.submissions.filter((x) => !known.has(x.id)).map((x) => ({ ...x, status: 'pending' as const, reviewedBy: '', reviewedAt: null, reviewNote: '', libraryId: '' })); const r = this.mergeRemote(fresh);
    return { ok: true, message: `${r.added} submission(s) imported as pending${p.submissions.length - fresh.length ? `; ${p.submissions.length - fresh.length} already on this device` : ''}${p.rejected.length ? `; ${p.rejected.length} refused by validation` : ''}.`, added: r.added, rejected: p.rejected };
  }
}

export interface SubmissionSyncOutcome { ok: boolean; /** the user's connection may not write (read-only account, published copy, no connection) — the submission stays on this device */ readOnly: boolean; stage: 'Configuration' | 'Download' | 'Parse' | 'Publish' | null; message: string; added: number; updated: number; pushed: boolean; }
/** Repository exchange of submissions.json — pull merges, push publishes. Same conflict rule as the knowledge file: a changed remote is merged first, then written; a failure never changes local data. */
export class SubmissionSync {
  private busy: Promise<unknown> | null = null;
  constructor(private subs: QuerySubmissions, private repo: () => SchemaRepository | null, private store: KeyValueStore, private path: () => string, private secrets: () => string[] = () => []) {}
  meta(): { sha: string | null; lastPullAt: string | null; lastPushAt: string | null; lastHash: string | null } { return readJson(this.store, SUBMISSIONS_SYNC_KEY, { sha: null, lastPullAt: null, lastPushAt: null, lastHash: null }); }
  private setMeta(m: object) { writeJson(this.store, SUBMISSIONS_SYNC_KEY, { ...this.meta(), ...m }); }
  /** true when everything on this device is already in the repository file */
  isShared(): boolean { const m = this.meta(); return !!m.sha && m.lastHash === this.subs.hash(); }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> { const run = async () => { while (this.busy) { try { await this.busy; } catch { /* ignore */ } } const p = fn(); this.busy = p; try { return await p; } finally { this.busy = null; } }; return run(); }
  private out(p: Partial<SubmissionSyncOutcome>): SubmissionSyncOutcome { return { ok: false, readOnly: false, stage: null, message: '', added: 0, updated: 0, pushed: false, ...p }; }
  pull(): Promise<SubmissionSyncOutcome> { return this.exclusive(() => this.doPull()); } push(): Promise<SubmissionSyncOutcome> { return this.exclusive(() => this.doPush()); }
  synchronize(): Promise<SubmissionSyncOutcome> { return this.exclusive(async () => { const p = await this.doPull(); if (!p.ok) return p; const q = await this.doPush(); return { ...q, added: p.added, updated: p.updated }; }); }
  private fail(stage: NonNullable<SubmissionSyncOutcome['stage']>, err: unknown, what: string): SubmissionSyncOutcome { const kind = repositoryErrorKind(err); return this.out({ stage, readOnly: stage === 'Publish' && kind === 'permission', message: `${what}: ${redactSecrets((err as Error)?.message || 'unexpected error', this.secrets())}` }); }
  private async doPull(): Promise<SubmissionSyncOutcome> {
    const path = this.path(); const repo = this.repo(); if (!repo) return this.out({ stage: 'Configuration', message: 'No repository connection — the submission stays on this device.' });
    let f; try { f = await repo.read(path); } catch (err) { return this.fail('Download', err, 'Could not read the submissions file'); }
    if (!f) { this.setMeta({ sha: null, lastPullAt: new Date().toISOString() }); return this.out({ ok: true, message: 'No submissions file in the repository yet.' }); }
    const p = parseSubmissions(f.text); if (!p.ok) return this.out({ stage: 'Parse', message: `${p.problem} Local submissions were not changed.` });
    const r = this.subs.mergeRemote(p.submissions); this.setMeta({ sha: f.sha, lastPullAt: new Date().toISOString() }); return this.out({ ok: true, added: r.added, updated: r.updated, message: `${p.submissions.length} submission(s) read: ${r.added} added, ${r.updated} updated${p.rejected.length ? `; ${p.rejected.length} refused by validation` : ''}.` });
  }
  private async doPush(retry = true): Promise<SubmissionSyncOutcome> {
    const path = this.path(); const repo = this.repo(); if (!repo) return this.out({ stage: 'Configuration', readOnly: true, message: 'No repository connection.' });
    const body = { format: SUBMISSION_FORMAT, formatVersion: SUBMISSION_FORMAT_VERSION, writtenBy: WRITER_LABEL, submissions: this.subs.all() }; const text = JSON.stringify({ ...body, writtenAt: new Date().toISOString() }, null, 1); const m = this.meta();
    if (m.sha && m.lastHash === this.subs.hash()) return this.out({ ok: true, message: 'Submissions are up to date — nothing to publish.' });
    if (containsSecret(text)) return this.out({ stage: 'Publish', message: 'Not published: the submissions contain something that looks like a credential.' });
    let remote; try { remote = await repo.read(path); } catch (err) { return this.fail('Download', err, 'Could not read the submissions file'); }
    if (remote && remote.sha !== m.sha) { const r = await this.doPull(); if (!r.ok) return r; return retry ? this.doPush(false) : this.out({ stage: 'Publish', message: 'The repository file keeps changing — try again.' }); }
    try { const sha = await repo.write(path, text, remote ? remote.sha : null, `${WRITER_LABEL}: query submissions (${this.subs.all().length})`); this.setMeta({ sha, lastPushAt: new Date().toISOString(), lastHash: this.subs.hash() }); return this.out({ ok: true, pushed: true, message: 'Published the submissions to the repository.' }); }
    catch (err) { return this.fail('Publish', err, 'Publishing failed'); }
  }
}
