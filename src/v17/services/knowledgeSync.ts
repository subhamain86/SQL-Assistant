/**
 * V17.4 — synchronizes the centralized knowledge (learned queries + Admin Query Library) between devices through the SAME repository
 * connection as the schema registry. One versioned file; records are merged per id (last writer wins, the higher trust tier is kept);
 * deletions travel as tombstones. Every incoming record is sanitized: no credentials, read-only SQL only, size-capped.
 */
import { KEYS, readJson, writeJson, deviceTag, type KeyValueStore } from '../../services/storage';
import { containsSecret, redactSecrets } from '../errors/appErrors';
import { validateReadOnlySql } from '../../engines/validationEngine';
import { WRITER_LABEL } from '../sync/schemaFormat';
import { tokenize } from '../engines/textTokens';
import type { SchemaRepository } from './githubClient';
import { LearningStore, STATUS_RANK, type LearningRecord, type LearnStatus } from './learningStore';
import { AdminQueryLibrary, type AdminQuery } from './adminLibrary';
export const KNOWLEDGE_FORMAT = 'sqla-knowledge'; export const KNOWLEDGE_FORMAT_VERSION = 1;
/** …/schemas/registry.json → …/knowledge/knowledge.json  (default: sql-assistant-data/knowledge/knowledge.json) */
export function knowledgePathFor(schemaPath: string): string { const p = (schemaPath || '').replace(/^\/+/, ''); const m = p.match(/^(.*?)\/schemas\/[^/]+$/); if (m) return `${m[1]}/knowledge/knowledge.json`; const i = p.lastIndexOf('/'); return i > 0 ? `${p.slice(0, i)}/knowledge.json` : 'sql-assistant-data/knowledge/knowledge.json'; }
export interface KnowledgeOutcome { ok: boolean; stage: 'Configuration' | 'Download' | 'Parse' | 'Validation' | 'Persistence' | 'Publish' | null; message: string; path: string; learned: { added: number; updated: number }; admin: { added: number; updated: number }; rejected: string[]; pushed: boolean; }
const S = (v: unknown, n: number) => String(v ?? '').slice(0, n); const A = (v: unknown, n = 60) => (Array.isArray(v) ? v.slice(0, n).map((x) => S(x, 120)) : []); const ID = /^[A-Za-z0-9_-]{1,64}$/;
const ISO = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : new Date(0).toISOString());
export function sanitizeLearning(o: any): LearningRecord | string {
  if (!o || typeof o !== 'object' || !ID.test(String(o.id))) return 'invalid id'; if (typeof o.requestText !== 'string' || !o.requestText.trim()) return 'no request text';
  const sql = `${o.requestText} ${o.generatedSql || ''} ${o.modifiedSql || ''} ${o.finalSql || ''}`; if (containsSecret(sql)) return 'contains a credential';
  const deleted = o.deleted === true; for (const k of ['generatedSql', 'modifiedSql', 'finalSql']) if (o[k] && !validateReadOnlySql(String(o[k])).valid) return 'contains non-read-only SQL';
  const status: LearnStatus = (['generated', 'modified', 'confirmed', 'executed'] as const).includes(o.status) ? o.status : 'generated';
  return { id: o.id, schemaId: S(o.schemaId, 80), schemaName: S(o.schemaName, 80), schemaVersion: S(o.schemaVersion, 30), schemaFingerprint: S(o.schemaFingerprint, 40), dialect: (['SQL Server', 'Oracle', 'PostgreSQL', 'MySQL', 'Generic'].includes(o.dialect) ? o.dialect : '') as LearningRecord['dialect'],
    requestText: S(o.requestText, 600), tokens: tokenize(S(o.requestText, 600)), generatedSql: S(o.generatedSql, 8000), modifiedSql: o.modifiedSql ? S(o.modifiedSql, 8000) : null, finalSql: o.finalSql ? S(o.finalSql, 8000) : null,
    tables: A(o.tables), columns: Array.isArray(o.columns) ? o.columns.slice(0, 80).map((c: any) => ({ table: S(c?.table, 80), column: S(c?.column, 80) })) : [], sorts: Array.isArray(o.sorts) ? o.sorts.slice(0, 10).map((c: any) => ({ table: S(c?.table, 80), column: S(c?.column, 80), direction: c?.direction === 'DESC' ? 'DESC' : 'ASC' })) : [], limit: Number.isInteger(o.limit) ? o.limit : null,
    joins: A(o.joins, 20), filters: Array.isArray(o.filters) ? o.filters.slice(0, 30).map((c: any) => ({ table: S(c?.table, 80), column: S(c?.column, 80), operator: S(c?.operator, 20) })) : [],
    advanced: { distinct: !!o.advanced?.distinct, groupBy: A(o.advanced?.groupBy, 20), having: !!o.advanced?.having, limit: Number.isInteger(o.advanced?.limit) ? o.advanced.limit : null, joinType: (['INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN'].includes(o.advanced?.joinType) ? o.advanced.joinType : null), tableAliases: !!o.advanced?.tableAliases },
    pattern: o.pattern && typeof o.pattern === 'object' ? o.pattern : null, count: Math.min(1e6, Math.max(1, Number.isInteger(o.count) ? o.count : 1)), status: STATUS_RANK[status] ? status : 'generated', resultStatus: (['unknown', 'success', 'failed'].includes(o.resultStatus) ? o.resultStatus : 'unknown'), feedback: (['none', 'positive', 'negative'].includes(o.feedback) ? o.feedback : 'none'), feedbackNote: S(o.feedbackNote, 300), rejected: !!o.rejected,
    createdAt: ISO(o.createdAt), updatedAt: ISO(o.updatedAt), device: S(o.device, 40), ...(deleted ? { deleted: true } : {}) };
}
export function sanitizeAdmin(o: any): AdminQuery | string {
  if (!o || typeof o !== 'object' || !ID.test(String(o.id))) return 'invalid id'; if (typeof o.name !== 'string' || !o.name.trim() || typeof o.sql !== 'string' || !o.sql.trim()) return 'name / SQL missing';
  if (containsSecret(`${o.name} ${o.description || ''} ${o.sql}`)) return 'contains a credential'; if (o.deleted !== true && !validateReadOnlySql(o.sql).valid) return 'contains non-read-only SQL';
  const dialect = (['Any', 'SQL Server', 'Oracle', 'PostgreSQL', 'MySQL', 'Generic'].includes(o.dialect) ? o.dialect : 'Any') as AdminQuery['dialect'];
  return { id: o.id, name: S(o.name, 120), description: S(o.description, 600), sql: S(o.sql, 20000), tables: A(o.tables, 40), columns: A(o.columns, 80), purpose: S(o.purpose, 300), tags: A(o.tags, 20), dialect, schemaName: S(o.schemaName, 80), schemaVersions: S(o.schemaVersions, 80), createdBy: S(o.createdBy, 80), createdAt: ISO(o.createdAt), updatedAt: ISO(o.updatedAt), approved: !!o.approved, approvedBy: S(o.approvedBy, 80), approvedAt: o.approvedAt ? ISO(o.approvedAt) : null, enabled: o.enabled !== false, lastValidation: null, ...(o.deleted === true ? { deleted: true } : {}) };
}
export function parseKnowledge(text: string): { ok: boolean; problem: string; learned: LearningRecord[]; admin: AdminQuery[]; rejected: string[] } {
  const none = { learned: [], admin: [], rejected: [] as string[] }; let v: any; try { v = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) { return { ok: false, problem: `The knowledge file is not valid JSON (${(e as Error).message}).`, ...none }; }
  if (!v || v.format !== KNOWLEDGE_FORMAT) return { ok: false, problem: 'The file is not a SQL Assistant knowledge file (format marker missing).', ...none };
  if (typeof v.formatVersion === 'number' && v.formatVersion > KNOWLEDGE_FORMAT_VERSION) return { ok: false, problem: `The knowledge file uses format ${v.formatVersion}; update SQL Assistant on this device to read it.`, ...none };
  const rejected: string[] = []; const learned: LearningRecord[] = []; const admin: AdminQuery[] = [];
  (Array.isArray(v.learned) ? v.learned.slice(0, 5000) : []).forEach((o: any, i: number) => { const r = sanitizeLearning(o); if (typeof r === 'string') rejected.push(`learned #${i + 1}: ${r}`); else learned.push(r); });
  (Array.isArray(v.admin) ? v.admin.slice(0, 2000) : []).forEach((o: any, i: number) => { const r = sanitizeAdmin(o); if (typeof r === 'string') rejected.push(`admin query #${i + 1}${o?.name ? ` "${S(o.name, 40)}"` : ''}: ${r}`); else admin.push(r); });
  return { ok: true, problem: '', learned, admin, rejected };
}
function fnv(s: string): string { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return `${h.toString(16)}-${s.length.toString(36)}`; }
export class KnowledgeSync {
  private busy: Promise<unknown> | null = null;
  constructor(private learning: LearningStore, private admin: AdminQueryLibrary, private repo: () => SchemaRepository | null, private store: KeyValueStore, private path: () => string, private secrets: () => string[] = () => []) {}
  meta(): { sha: string | null; lastPullAt: string | null; lastPushAt: string | null; lastHash: string | null } { return readJson(this.store, KEYS.knowledgeSync, { sha: null, lastPullAt: null, lastPushAt: null, lastHash: null }); }
  private setMeta(m: object) { writeJson(this.store, KEYS.knowledgeSync, { ...this.meta(), ...m }); }
  /** Only records worth sharing: trusted tiers, repeated ≥ 2, rejections and tombstones (so negative feedback and deletions propagate). */
  private exportLearned(): LearningRecord[] { const clip = (s: string | null) => (s ? s.slice(0, 4000) : s); return this.learning.allRaw().filter((r) => r.deleted || r.status !== 'generated' || r.count >= 2 || r.rejected).map((r) => (r.deleted ? { ...r, generatedSql: '', modifiedSql: null, finalSql: null, pattern: null } : { ...r, generatedSql: clip(r.generatedSql) || '', modifiedSql: clip(r.modifiedSql), finalSql: clip(r.finalSql) })); }
  private serialize(): { text: string; hash: string } { const body = { format: KNOWLEDGE_FORMAT, formatVersion: KNOWLEDGE_FORMAT_VERSION, writtenBy: WRITER_LABEL, writtenByDevice: deviceTag(this.store), learned: this.exportLearned(), admin: this.admin.allRaw().map((q) => ({ ...q, lastValidation: null })) }; const hash = fnv(JSON.stringify(body)); return { text: JSON.stringify({ ...body, writtenAt: new Date().toISOString() }, null, 1), hash }; }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> { const run = async () => { while (this.busy) { try { await this.busy; } catch { /* ignore */ } } const p = fn(); this.busy = p; try { return await p; } finally { this.busy = null; } }; return run(); }
  pull(): Promise<KnowledgeOutcome> { return this.exclusive(() => this.doPull()); } push(): Promise<KnowledgeOutcome> { return this.exclusive(() => this.doPush()); } synchronize(): Promise<KnowledgeOutcome> { return this.exclusive(async () => { const p = await this.doPull(); if (!p.ok) return p; const q = await this.doPush(); return { ...p, ok: q.ok, stage: q.stage, message: q.ok ? p.message : q.message, pushed: q.pushed }; }); }
  private out(path: string, p: Partial<KnowledgeOutcome>): KnowledgeOutcome { return { ok: false, stage: null, message: '', path, learned: { added: 0, updated: 0 }, admin: { added: 0, updated: 0 }, rejected: [], pushed: false, ...p }; }
  private async doPull(): Promise<KnowledgeOutcome> {
    const path = this.path(); const repo = this.repo(); if (!repo) return this.out(path, { stage: 'Configuration', message: 'Repository synchronization is not configured. Enter the GitHub repository and token under Settings → Secret Vault, then synchronize again. Learning and the Admin Query Library keep working on this device.' });
    let f; try { f = await repo.read(path); } catch (e) { return this.out(path, { stage: 'Download', message: `Could not download ${path}: ${redactSecrets((e as Error).message, this.secrets())} Local knowledge was not changed.` }); }
    if (!f) { this.setMeta({ sha: null, lastPullAt: new Date().toISOString() }); return this.out(path, { ok: true, message: `No knowledge file at ${path} yet — publishing creates it.` }); }
    const k = parseKnowledge(f.text); if (!k.ok) return this.out(path, { stage: 'Parse', message: `${k.problem} Local knowledge was not changed.` });
    const l = this.learning.mergeRemote(k.learned); const a = this.admin.mergeRemote(k.admin); this.setMeta({ sha: f.sha, lastPullAt: new Date().toISOString() });
    return this.out(path, { ok: true, learned: l, admin: a, rejected: k.rejected, message: `Pulled ${k.learned.length} learned and ${k.admin.length} Admin Query Library record(s): ${l.added + a.added} added, ${l.updated + a.updated} updated${k.rejected.length ? `; ${k.rejected.length} record(s) rejected by validation` : ''}.` });
  }
  private async doPush(retry = true): Promise<KnowledgeOutcome> {
    const path = this.path(); const repo = this.repo(); if (!repo) return this.out(path, { stage: 'Configuration', message: 'Repository synchronization is not configured.' });
    const s = this.serialize(); const m = this.meta(); if (m.lastHash === s.hash && m.sha) return this.out(path, { ok: true, message: 'Knowledge is up to date — nothing to publish.' });
    if (containsSecret(s.text)) return this.out(path, { stage: 'Publish', message: 'Not published: the knowledge data contains something that looks like a credential. Remove it and try again.' });
    let remote; try { remote = await repo.read(path); } catch (e) { return this.out(path, { stage: 'Download', message: redactSecrets((e as Error).message, this.secrets()) }); }
    if (remote && remote.sha !== m.sha) { const r = await this.doPull(); if (!r.ok) return r; return retry ? this.doPush(false) : this.out(path, { stage: 'Publish', message: 'The repository file keeps changing — try again.' }); }
    try { const sha = await repo.write(path, s.text, remote ? remote.sha : null, `${WRITER_LABEL}: publish knowledge (${this.exportLearned().length} learned, ${this.admin.allRaw().length} admin)`); this.setMeta({ sha, lastPushAt: new Date().toISOString(), lastHash: s.hash }); return this.out(path, { ok: true, pushed: true, message: `Published knowledge to ${path}.` }); }
    catch (e) { return this.out(path, { stage: 'Publish', message: `Publishing failed: ${redactSecrets((e as Error).message, this.secrets())}` }); }
  }
}
