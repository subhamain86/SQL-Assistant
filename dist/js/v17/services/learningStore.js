import { KEYS, browserStore, readJson, writeJson } from '../../services/storage.js';
import { schemaFingerprint, wordTokens } from '../engines/schemaContext.js';
const MAX = 500;
const STOP = new Set(['show', 'list', 'get', 'find', 'the', 'all', 'and', 'with', 'for', 'from', 'me', 'give']);
const toks = (t) => Array.from(new Set(wordTokens(t).filter((w) => !STOP.has(w))));
function jaccard(a, b) { const A = new Set(a); const B = new Set(b); let i = 0; A.forEach((x) => { if (B.has(x))
    i += 1; }); const u = A.size + B.size - i; return u ? i / u : 0; }
export class LearningStore {
    constructor(store = browserStore) {
        this.store = store;
    }
    all() { return readJson(this.store, KEYS.learning, []); }
    save(list) { return writeJson(this.store, KEYS.learning, list.slice(0, MAX)); }
    record(input) {
        const list = this.all();
        const tokens = toks(input.requestText);
        const fp = schemaFingerprint(input.schema);
        const same = list.find((r) => r.schemaId === input.schema.id && jaccard(r.tokens, tokens) >= 0.9 && r.tables.join() === input.tables.join());
        const { schema: _s, accepted, ...rest } = input;
        if (same) {
            Object.assign(same, rest, { tokens, schemaFingerprint: fp, count: same.count + 1, updatedAt: new Date().toISOString() });
            same.status = accepted || same.status === 'confirmed' ? 'confirmed' : 'repeated';
            this.save([same, ...list.filter((r) => r !== same)]);
            return same;
        }
        const rec = { ...rest, id: `lp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, schemaId: input.schema.id, schemaFingerprint: fp, tokens, count: 1, status: accepted ? 'confirmed' : 'generated', updatedAt: new Date().toISOString() };
        this.save([rec, ...list]);
        return rec;
    }
    /** Mark the latest record for this request as accepted, storing user-modified / final SQL. */
    confirm(requestText, schema, finalSql, modifiedSql) {
        const list = this.all();
        const t = toks(requestText);
        const r = list.find((x) => x.schemaId === schema.id && jaccard(x.tokens, t) >= 0.9);
        if (!r)
            return false;
        r.status = 'confirmed';
        r.finalSql = finalSql;
        r.modifiedSql = modifiedSql;
        r.updatedAt = new Date().toISOString();
        return this.save(list);
    }
    hints(text, schema) {
        const t = toks(text);
        if (!t.length)
            return [];
        return this.all().filter((r) => r.schemaId === schema.id && r.status !== 'generated')
            .map((r) => ({ r, sim: jaccard(r.tokens, t) })).filter((x) => x.sim >= 0.6).sort((a, b) => b.sim - a.sim).slice(0, 3)
            .map(({ r, sim }) => ({ patternId: r.id, similarity: sim, status: r.status, weight: r.status === 'confirmed' ? 1 : 0.7, tables: r.tables, columns: r.columns, options: { distinct: r.distinct, limit: r.limit, sorts: r.sorts } }));
    }
    /** Removes patterns whose tables/columns no longer exist in the given schema. */
    prune(schema) {
        const tables = new Set(schema.tables.map((t) => t.name));
        const cols = new Set(schema.tables.flatMap((t) => t.columns.map((c) => `${t.name}.${c.name}`)));
        const list = this.all();
        const keep = list.filter((r) => r.schemaId !== schema.id || (r.tables.every((t) => tables.has(t)) && r.columns.every((c) => cols.has(`${c.table}.${c.column}`))));
        this.save(keep);
        return list.length - keep.length;
    }
    clear() { this.save([]); }
}
//# sourceMappingURL=learningStore.js.map