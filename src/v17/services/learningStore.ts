/**
 * Controlled, schema-aware learning from previous query activity (offline).
 * Records: request text, generated SQL, user-modified SQL, final accepted SQL, tables, columns,
 * filters, joins, sorts, grouping, aggregation, schema id + fingerprint.
 * Patterns become hints only after they are repeated or explicitly confirmed (accepted), they are
 * scoped to the schema they were learned on, and the NLU re-checks every element against the
 * CURRENT Active Schema — obsolete patterns can never override it.
 */
import type { SchemaModel } from '../../types';
import { KEYS, browserStore, readJson, writeJson, type KeyValueStore } from '../../services/storage';
import { schemaFingerprint, wordTokens } from '../engines/schemaContext';
import type { LearnedHint } from '../engines/nluEngine';
export interface LearningRecord {
  id: string; schemaId: string; schemaFingerprint: string; requestText: string; tokens: string[];
  generatedSql: string; modifiedSql: string | null; finalSql: string | null;
  tables: string[]; columns: { table: string; column: string }[]; filters: string[]; joins: string[];
  sorts: { table: string; column: string; direction: 'ASC' | 'DESC' }[]; groupBy: string[]; aggregation: string[];
  distinct: boolean; limit: number | null; count: number; status: 'generated' | 'repeated' | 'confirmed'; updatedAt: string;
}
const MAX = 500;
const STOP = new Set(['show', 'list', 'get', 'find', 'the', 'all', 'and', 'with', 'for', 'from', 'me', 'give']);
const toks = (t: string) => Array.from(new Set(wordTokens(t).filter((w) => !STOP.has(w))));
function jaccard(a: string[], b: string[]): number { const A = new Set(a); const B = new Set(b); let i = 0; A.forEach((x) => { if (B.has(x)) i += 1; }); const u = A.size + B.size - i; return u ? i / u : 0; }
export class LearningStore {
  constructor(private store: KeyValueStore = browserStore) {}
  all(): LearningRecord[] { return readJson<LearningRecord[]>(this.store, KEYS.learning, []); }
  private save(list: LearningRecord[]): boolean { return writeJson(this.store, KEYS.learning, list.slice(0, MAX)); }
  record(input: Omit<LearningRecord, 'id' | 'tokens' | 'count' | 'status' | 'updatedAt' | 'schemaFingerprint' | 'schemaId'> & { schema: SchemaModel; accepted?: boolean }): LearningRecord {
    const list = this.all(); const tokens = toks(input.requestText); const fp = schemaFingerprint(input.schema);
    const same = list.find((r) => r.schemaId === input.schema.id && jaccard(r.tokens, tokens) >= 0.9 && r.tables.join() === input.tables.join());
    const { schema: _s, accepted, ...rest } = input;
    if (same) {
      Object.assign(same, rest, { tokens, schemaFingerprint: fp, count: same.count + 1, updatedAt: new Date().toISOString() });
      same.status = accepted || same.status === 'confirmed' ? 'confirmed' : 'repeated';
      this.save([same, ...list.filter((r) => r !== same)]); return same;
    }
    const rec: LearningRecord = { ...rest, id: `lp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, schemaId: input.schema.id, schemaFingerprint: fp, tokens, count: 1, status: accepted ? 'confirmed' : 'generated', updatedAt: new Date().toISOString() };
    this.save([rec, ...list]); return rec;
  }
  /** Mark the latest record for this request as accepted, storing user-modified / final SQL. */
  confirm(requestText: string, schema: SchemaModel, finalSql: string, modifiedSql: string | null): boolean {
    const list = this.all(); const t = toks(requestText);
    const r = list.find((x) => x.schemaId === schema.id && jaccard(x.tokens, t) >= 0.9); if (!r) return false;
    r.status = 'confirmed'; r.finalSql = finalSql; r.modifiedSql = modifiedSql; r.updatedAt = new Date().toISOString();
    return this.save(list);
  }
  hints(text: string, schema: SchemaModel): LearnedHint[] {
    const t = toks(text); if (!t.length) return [];
    return this.all().filter((r) => r.schemaId === schema.id && r.status !== 'generated')
      .map((r) => ({ r, sim: jaccard(r.tokens, t) })).filter((x) => x.sim >= 0.6).sort((a, b) => b.sim - a.sim).slice(0, 3)
      .map(({ r, sim }) => ({ patternId: r.id, similarity: sim, status: r.status as 'repeated' | 'confirmed', weight: r.status === 'confirmed' ? 1 : 0.7, tables: r.tables, columns: r.columns, options: { distinct: r.distinct, limit: r.limit, sorts: r.sorts } }));
  }
  /** Removes patterns whose tables/columns no longer exist in the given schema. */
  prune(schema: SchemaModel): number {
    const tables = new Set(schema.tables.map((t) => t.name)); const cols = new Set(schema.tables.flatMap((t) => t.columns.map((c) => `${t.name}.${c.name}`)));
    const list = this.all(); const keep = list.filter((r) => r.schemaId !== schema.id || (r.tables.every((t) => tables.has(t)) && r.columns.every((c) => cols.has(`${c.table}.${c.column}`))));
    this.save(keep); return list.length - keep.length;
  }
  clear(): void { this.save([]); }
}
