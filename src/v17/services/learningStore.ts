/** Centralized learned query knowledge: only accepted/repeated patterns become hints; schema-scoped; credentials never learned. */
import type { SchemaModel } from '../../types';
import { KEYS, readJson, writeJson, type KeyValueStore } from '../../services/storage';
import { norm, schemaFingerprint } from '../engines/schemaContext';
import { containsSecret } from '../errors/appErrors';
import type { LearnedHint } from '../engines/nluEngine';
export interface LearningRecord { id: string; schemaId: string; schemaFingerprint: string; requestText: string; tokens: string[]; generatedSql: string; modifiedSql: string | null; finalSql: string | null; tables: string[]; columns: { table: string; column: string }[]; sorts: { table: string; column: string; direction: 'ASC' | 'DESC' }[]; limit: number | null; count: number; status: 'generated' | 'repeated' | 'confirmed'; updatedAt: string; }
const STOP = new Set(['show', 'list', 'get', 'find', 'the', 'all', 'and', 'with', 'for', 'from', 'me']);
const toks = (t: string) => Array.from(new Set(norm(t).split(' ').filter((w) => w.length > 1 && !STOP.has(w))));
const jac = (a: string[], b: string[]) => { const B = new Set(b); const i = a.filter((x) => B.has(x)).length; const u = new Set([...a, ...b]).size; return u ? i / u : 0; };
type In = Omit<LearningRecord, 'id' | 'tokens' | 'count' | 'status' | 'schemaId' | 'schemaFingerprint' | 'updatedAt'> & { schema: SchemaModel; accepted?: boolean };
export class LearningStore {
  constructor(private store: KeyValueStore) {}
  all(): LearningRecord[] { return readJson<LearningRecord[]>(this.store, KEYS.learning, []); }
  record(i: In): boolean {
    if (containsSecret(`${i.requestText} ${i.generatedSql} ${i.finalSql || ''}`)) return false;
    const l = this.all(); const tk = toks(i.requestText); const { schema, accepted, ...rest } = i; const same = l.find((r) => r.schemaId === schema.id && jac(r.tokens, tk) >= 0.9); const now = new Date().toISOString();
    if (same) { Object.assign(same, rest, { count: same.count + 1, status: accepted || same.status === 'confirmed' ? 'confirmed' : 'repeated', updatedAt: now, schemaFingerprint: schemaFingerprint(schema) }); return writeJson(this.store, KEYS.learning, [same, ...l.filter((r) => r !== same)].slice(0, 500)); }
    return writeJson(this.store, KEYS.learning, [{ ...rest, id: `lp_${Date.now().toString(36)}`, schemaId: schema.id, schemaFingerprint: schemaFingerprint(schema), tokens: tk, count: 1, status: accepted ? 'confirmed' : 'generated', updatedAt: now }, ...l].slice(0, 500));
  }
  confirm(text: string, s: SchemaModel, finalSql: string, modifiedSql: string | null): boolean { if (containsSecret(`${text} ${finalSql}`)) return false; const l = this.all(); const r = l.find((x) => x.schemaId === s.id && jac(x.tokens, toks(text)) >= 0.9); if (!r) return false; Object.assign(r, { status: 'confirmed', finalSql, modifiedSql, updatedAt: new Date().toISOString() }); return writeJson(this.store, KEYS.learning, l); }
  hints(text: string, s: SchemaModel): LearnedHint[] { const t = toks(text); return this.all().filter((r) => r.schemaId === s.id && r.status !== 'generated').map((r) => ({ r, x: jac(r.tokens, t) })).filter((y) => y.x >= 0.6).sort((a, b) => b.x - a.x).slice(0, 3).map(({ r, x }) => ({ patternId: r.id, similarity: x, tables: r.tables, columns: r.columns, options: { limit: r.limit, sorts: r.sorts } })); }
  clear(): void { writeJson(this.store, KEYS.learning, []); }
}
