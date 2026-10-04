import type { SchemaModel } from '../../types';
import { KEYS, readJson, writeJson, type KeyValueStore } from '../../services/storage';
import { norm } from '../engines/schemaContext';
import type { LearnedHint } from '../engines/nluEngine';
export interface LearningRecord { id: string; schemaId: string; requestText: string; tokens: string[]; generatedSql: string; modifiedSql: string | null; finalSql: string | null; tables: string[]; columns: { table: string; column: string }[]; sorts: { table: string; column: string; direction: 'ASC' | 'DESC' }[]; limit: number | null; count: number; status: 'generated' | 'repeated' | 'confirmed'; }
const STOP = new Set(['show', 'list', 'get', 'find', 'the', 'all', 'and', 'with', 'for', 'from', 'me']);
const toks = (t: string) => Array.from(new Set(norm(t).split(' ').filter((w) => w.length > 1 && !STOP.has(w))));
const jac = (a: string[], b: string[]) => { const B = new Set(b); const i = a.filter((x) => B.has(x)).length; const u = new Set([...a, ...b]).size; return u ? i / u : 0; };
export class LearningStore {
  constructor(private store: KeyValueStore) {}
  all(): LearningRecord[] { return readJson<LearningRecord[]>(this.store, KEYS.learning, []); }
  record(i: Omit<LearningRecord, 'id' | 'tokens' | 'count' | 'status' | 'schemaId'> & { schema: SchemaModel; accepted?: boolean }): void {
    const l = this.all(); const tk = toks(i.requestText); const { schema, accepted, ...rest } = i; const same = l.find((r) => r.schemaId === schema.id && jac(r.tokens, tk) >= 0.9);
    if (same) { Object.assign(same, rest, { count: same.count + 1, status: accepted || same.status === 'confirmed' ? 'confirmed' : 'repeated' }); writeJson(this.store, KEYS.learning, [same, ...l.filter((r) => r !== same)].slice(0, 500)); return; }
    writeJson(this.store, KEYS.learning, [{ ...rest, id: `lp_${Date.now().toString(36)}`, schemaId: schema.id, tokens: tk, count: 1, status: accepted ? 'confirmed' : 'generated' }, ...l].slice(0, 500));
  }
  confirm(text: string, s: SchemaModel, finalSql: string, modifiedSql: string | null): boolean { const l = this.all(); const r = l.find((x) => x.schemaId === s.id && jac(x.tokens, toks(text)) >= 0.9); if (!r) return false; Object.assign(r, { status: 'confirmed', finalSql, modifiedSql }); return writeJson(this.store, KEYS.learning, l); }
  hints(text: string, s: SchemaModel): LearnedHint[] { const t = toks(text); return this.all().filter((r) => r.schemaId === s.id && r.status !== 'generated').map((r) => ({ r, x: jac(r.tokens, t) })).filter((y) => y.x >= 0.6).sort((a, b) => b.x - a.x).slice(0, 3).map(({ r, x }) => ({ patternId: r.id, similarity: x, tables: r.tables, columns: r.columns, options: { limit: r.limit, sorts: r.sorts } })); }
}
