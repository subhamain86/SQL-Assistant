/**
 * V17.4 — Centralized, tiered, offline self-learning.
 * Stored as one versioned JSON structure (`sqla.learning.v174`) that is synchronized between devices through the
 * knowledge file in the repository (see knowledgeSync.ts). Not every generated query is trusted:
 *
 *   tier            how it is reached                                            weight as a pattern
 *   executed        user reports "ran successfully" when accepting               0.85
 *   confirmed       user accepts the generated SQL unchanged (Accept & Learn)    0.70
 *   modified        user edits the SQL and accepts the edited final SQL          0.65
 *   repeated        the same request was generated ≥ 3 times, never rejected     0.40
 *   generated       generated, never confirmed                                   0   (stored, never used as a pattern)
 *   (Admin Query Library entries rank above all of these: 1.00 — see adminLibrary.ts)
 *
 * Credentials are never learned, rejected/failed queries are never used, and the Active Schema always wins at retrieval.
 */
import type { Dialect, JoinType, SchemaModel } from '../../types';
import { KEYS, readJson, writeJson, deviceTag, type KeyValueStore } from '../../services/storage';
import { schemaFingerprint, norm } from '../engines/schemaContext';
import { containsSecret } from '../errors/appErrors';
import { extractSqlPattern, type SqlPattern } from '../engines/sqlPatterns';
import { tokenize, jaccard } from '../engines/textTokens';
import type { LearnedHint } from '../engines/nluEngine';

export type LearnStatus = 'generated' | 'modified' | 'confirmed' | 'executed';
export type LearnTier = LearnStatus | 'repeated';
export type ResultStatus = 'unknown' | 'success' | 'failed';
export type Feedback = 'none' | 'positive' | 'negative';
export const STATUS_RANK: Record<LearnStatus, number> = { generated: 1, modified: 2, confirmed: 3, executed: 4 };
export const TIER_WEIGHT: Record<LearnTier, number> = { executed: 0.85, confirmed: 0.7, modified: 0.65, repeated: 0.4, generated: 0 };
export const TIER_LABEL: Record<LearnTier, string> = { executed: 'Successfully executed', confirmed: 'Confirmed', modified: 'Modified & confirmed', repeated: 'Repeated pattern', generated: 'Generated (unconfirmed)' };

export interface LearningRecord {
  id: string; schemaId: string; schemaName: string; schemaVersion: string; schemaFingerprint: string; dialect: Dialect | '';
  requestText: string; tokens: string[]; generatedSql: string; modifiedSql: string | null; finalSql: string | null;
  tables: string[]; columns: { table: string; column: string }[]; sorts: { table: string; column: string; direction: 'ASC' | 'DESC' }[]; limit: number | null;
  joins: string[]; filters: { table: string; column: string; operator: string }[];
  advanced: { distinct: boolean; groupBy: string[]; having: boolean; limit: number | null; joinType: JoinType | null; tableAliases: boolean };
  pattern: SqlPattern | null;
  count: number; status: LearnStatus; resultStatus: ResultStatus; feedback: Feedback; feedbackNote: string; rejected: boolean;
  createdAt: string; updatedAt: string; device: string; deleted?: boolean;
}
export interface LearnInput {
  schema: SchemaModel; requestText: string; generatedSql: string; modifiedSql: string | null; finalSql: string | null;
  tables: string[]; columns: { table: string; column: string }[]; sorts: { table: string; column: string; direction: 'ASC' | 'DESC' }[]; limit: number | null;
  accepted?: boolean; dialect?: Dialect; resultStatus?: ResultStatus; feedback?: Feedback; feedbackNote?: string;
  advanced?: Partial<LearningRecord['advanced']>;
}
interface Bag { schemaVersion: number; records: LearningRecord[]; }
const MAX = 1000; const TOMBSTONE_MS = 90 * 864e5; const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n);
export const tierOf = (r: Pick<LearningRecord, 'status' | 'count'>): LearnTier => (r.status === 'generated' && r.count >= 3 ? 'repeated' : r.status);
export const weightOf = (r: LearningRecord): number => (r.rejected || r.deleted || r.resultStatus === 'failed' || r.feedback === 'negative' ? 0 : TIER_WEIGHT[tierOf(r)]);

export class LearningStore {
  private cache: { raw: string | null; list: LearningRecord[] } | null = null;
  private index: { size: number; map: Map<string, number[]> } | null = null;
  constructor(private store: KeyValueStore) {}
  private bag(): Bag { const raw = this.store.get(KEYS.learning174); if (this.cache && this.cache.raw === raw) return { schemaVersion: 1, records: this.cache.list }; let list: LearningRecord[] = []; try { const b = raw ? (JSON.parse(raw) as Bag) : null; list = Array.isArray(b?.records) ? b!.records : []; } catch { list = []; } this.cache = { raw, list }; this.index = null; return { schemaVersion: 1, records: list }; }
  private save(list: LearningRecord[]): boolean {
    const now = Date.now(); const live = list.filter((r) => !r.deleted).sort((a, b) => weightOf(b) - weightOf(a) || (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, MAX);
    const dead = list.filter((r) => r.deleted && now - Date.parse(r.updatedAt || '') < TOMBSTONE_MS); const next = [...live, ...dead]; const ok = writeJson(this.store, KEYS.learning174, { schemaVersion: 1, records: next });
    this.cache = { raw: this.store.get(KEYS.learning174), list: next }; this.index = null; return ok;
  }
  /** Live (non-deleted) records. */ all(): LearningRecord[] { return this.bag().records.filter((r) => !r.deleted); }
  /** Everything including deletion tombstones — used by synchronization only. */ allRaw(): LearningRecord[] { return this.bag().records; }
  get(id: string): LearningRecord | undefined { return this.all().find((r) => r.id === id); }
  stats(): Record<LearnTier, number> & { total: number; rejected: number } { const s = { executed: 0, confirmed: 0, modified: 0, repeated: 0, generated: 0, total: 0, rejected: 0 }; this.all().forEach((r) => { s.total++; if (r.rejected || r.feedback === 'negative' || r.resultStatus === 'failed') s.rejected++; s[tierOf(r)]++; }); return s; }
  private same(list: LearningRecord[], schema: SchemaModel, tk: string[]) { return list.find((r) => !r.deleted && (r.schemaId === schema.id || norm(r.schemaName) === norm(schema.name)) && jaccard(r.tokens, tk) >= 0.9); }
  private build(i: LearnInput, tk: string[]): LearningRecord {
    const sql = i.finalSql || i.modifiedSql || i.generatedSql; const px = sql && !/^--/.test(sql.trim()) ? extractSqlPattern(sql, i.schema).pattern : null; const now = new Date().toISOString();
    return { id: `lp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, schemaId: i.schema.id, schemaName: i.schema.name, schemaVersion: String(i.schema.version ?? ''), schemaFingerprint: schemaFingerprint(i.schema), dialect: i.dialect || '',
      requestText: clip(i.requestText, 600), tokens: tk, generatedSql: clip(i.generatedSql, 8000), modifiedSql: i.modifiedSql ? clip(i.modifiedSql, 8000) : null, finalSql: i.finalSql ? clip(i.finalSql, 8000) : null,
      tables: i.tables.length ? [...i.tables] : px?.tables || [], columns: i.columns.length ? i.columns : px?.columns || [], sorts: i.sorts.length ? i.sorts : px?.sorts || [], limit: i.limit ?? px?.limit ?? null,
      joins: px?.joins || [], filters: px?.filterShapes || [], advanced: { distinct: px?.distinct ?? false, groupBy: (px?.groupBy || []).map((g) => `${g.table}.${g.column}`), having: false, limit: i.limit ?? px?.limit ?? null, joinType: px?.joinType ?? null, tableAliases: false, ...(i.advanced || {}) }, pattern: px,
      count: 1, status: 'generated', resultStatus: i.resultStatus || 'unknown', feedback: i.feedback || 'none', feedbackNote: clip(i.feedbackNote, 300), rejected: false, createdAt: now, updatedAt: now, device: deviceTag(this.store) };
  }
  /** Generated (or accepted) interaction. Returns false when nothing was stored (empty text / credential / storage refused). */
  record(i: LearnInput): boolean {
    if (!i.requestText.trim() || containsSecret(`${i.requestText} ${i.generatedSql} ${i.modifiedSql || ''} ${i.finalSql || ''}`)) return false;
    const list = this.bag().records.slice(); const tk = tokenize(i.requestText); const same = this.same(list, i.schema, tk);
    if (same) { const fresh = this.build(i, tk); Object.assign(same, { generatedSql: fresh.generatedSql || same.generatedSql, tables: fresh.tables, columns: fresh.columns, sorts: fresh.sorts, limit: fresh.limit, joins: fresh.joins, filters: fresh.filters, advanced: fresh.advanced, pattern: fresh.pattern, schemaId: i.schema.id, schemaName: i.schema.name, schemaVersion: fresh.schemaVersion, schemaFingerprint: fresh.schemaFingerprint, count: same.count + 1, updatedAt: fresh.updatedAt }); if (i.accepted) return this.promote(same, i, list); return this.save(list); }
    const r = this.build(i, tk); if (i.accepted) { list.unshift(r); return this.promote(r, i, list); } list.unshift(r); return this.save(list);
  }
  private promote(r: LearningRecord, i: LearnInput, list: LearningRecord[]): boolean {
    const target: LearnStatus = i.resultStatus === 'success' ? 'executed' : i.modifiedSql ? 'modified' : 'confirmed';
    if (STATUS_RANK[target] >= STATUS_RANK[r.status]) r.status = target; r.finalSql = i.finalSql || r.finalSql; r.modifiedSql = i.modifiedSql ?? r.modifiedSql;
    const px = r.finalSql && !/^--/.test(r.finalSql) ? extractSqlPattern(r.finalSql, i.schema).pattern : null; if (px) { r.pattern = px; r.tables = px.tables.length ? px.tables : r.tables; r.columns = px.columns.length ? px.columns : r.columns; r.joins = px.joins; r.filters = px.filterShapes; r.sorts = px.sorts.length ? px.sorts : r.sorts; r.limit = px.limit ?? r.limit; r.advanced = { ...r.advanced, distinct: px.distinct, groupBy: px.groupBy.map((g) => `${g.table}.${g.column}`), joinType: px.joinType, limit: px.limit ?? r.advanced.limit }; }
    if (i.resultStatus === 'failed') { r.resultStatus = 'failed'; r.rejected = true; r.feedback = 'negative'; } else { if (i.resultStatus) r.resultStatus = i.resultStatus; r.rejected = false; if (r.feedback === 'negative') r.feedback = i.feedback || 'none'; }
    if (i.feedback && i.feedback !== 'none') r.feedback = i.feedback; if (i.feedbackNote) r.feedbackNote = clip(i.feedbackNote, 300); r.updatedAt = new Date().toISOString(); return this.save(list);
  }
  /** "Accept & Learn". Creates the record when the description was never generated on this device. */
  confirm(text: string, s: SchemaModel, finalSql: string, modifiedSql: string | null, extra: { resultStatus?: ResultStatus; feedback?: Feedback; feedbackNote?: string; dialect?: Dialect } = {}): boolean {
    return this.record({ schema: s, requestText: text, generatedSql: modifiedSql ? '' : finalSql, modifiedSql, finalSql, tables: [], columns: [], sorts: [], limit: null, accepted: true, ...extra });
  }
  /** User feedback on the last generated result for this description ("Report issue"). A negative result removes it from the trusted patterns. */
  setFeedback(text: string, s: SchemaModel, feedback: Feedback, note = '', failed = false): boolean {
    const list = this.bag().records.slice(); const r = this.same(list, s, tokenize(text)); if (!r) return false; r.feedback = feedback; r.feedbackNote = clip(note, 300); if (failed || feedback === 'negative') { r.rejected = true; r.resultStatus = failed ? 'failed' : r.resultStatus; } else if (feedback === 'positive') r.rejected = false; r.updatedAt = new Date().toISOString(); return this.save(list);
  }
  remove(id: string): boolean { const list = this.bag().records.slice(); const r = list.find((x) => x.id === id); if (!r) return false; r.deleted = true; r.updatedAt = new Date().toISOString(); return this.save(list); }
  /** Marks everything deleted (tombstones) so the clear also reaches other devices on the next knowledge sync. */
  clear(): void { const now = new Date().toISOString(); this.save(this.bag().records.map((r) => ({ ...r, deleted: true, updatedAt: now }))); }
  /** Merge records from another device (last writer per record wins; the higher trust tier is never lost). */
  mergeRemote(remote: LearningRecord[]): { added: number; updated: number } {
    const list = this.bag().records.slice(); let added = 0; let updated = 0;
    remote.forEach((r) => { const l = list.find((x) => x.id === r.id); if (!l) { list.push(r); added++; return; } if ((r.updatedAt || '') > (l.updatedAt || '')) { const keep = STATUS_RANK[l.status] > STATUS_RANK[r.status] && !r.deleted ? l.status : r.status; Object.assign(l, r, { status: keep, count: Math.max(l.count, r.count) }); updated++; } });
    if (added || updated) this.save(list); return { added, updated };
  }
  private buildIndex() { const map = new Map<string, number[]>(); const l = this.all(); l.forEach((r, i) => r.tokens.forEach((t) => { const a = map.get(t); if (a) a.push(i); else map.set(t, [i]); })); this.index = { size: l.length, map }; return this.index; }
  /** Trusted patterns similar to the request for THIS schema. Indexed; never reads or rebuilds anything on a Manual Selector change. */
  hints(text: string, s: SchemaModel, requestTables: string[] = []): LearnedHint[] {
    const t = tokenize(text); if (!t.length) return []; const l = this.all(); const ix = this.index && this.index.size === l.length ? this.index : this.buildIndex(); const cand = new Set<number>(); t.forEach((x) => (ix.map.get(x) || []).forEach((i) => cand.add(i)));
    const rt = new Set(requestTables); const fp = schemaFingerprint(s);
    return [...cand].map((i) => l[i]).filter((r) => (r.schemaId === s.id || norm(r.schemaName) === norm(s.name)) && weightOf(r) > 0).map((r) => { const jac = jaccard(r.tokens, t); const tbl = rt.size ? [...rt].filter((x) => r.tables.includes(x)).length / new Set([...rt, ...r.tables]).size : 0; const sim = rt.size ? 0.75 * jac + 0.25 * tbl : jac; return { r, sim }; })
      .filter((x) => x.sim >= 0.5).sort((a, b) => b.sim * weightOf(b.r) - a.sim * weightOf(a.r)).slice(0, 3).map(({ r, sim }) => { const p = r.pattern; return { patternId: r.id, similarity: sim, tables: r.tables, columns: r.columns, options: { limit: r.limit, sorts: r.sorts }, source: 'learned' as const, trust: weightOf(r), tier: tierOf(r), label: r.requestText.slice(0, 60), stale: r.schemaFingerprint !== fp, aggregates: p?.aggregates || [], groupBy: p?.groupBy || [], distinct: p?.distinct || false, joinType: p?.joinType || null, sortOnAggregate: p?.sortOnAggregate || null, filterShapes: p?.filterShapes || [], decodes: p?.decodes || [] }; });
  }
}
