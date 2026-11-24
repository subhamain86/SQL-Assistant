/**
 * V17.4 — Admin Query Library: trusted, administrator-approved SQL examples.
 * A query is a TRUSTED learning example only when it is approved AND enabled AND still valid against the Active Schema
 * (re-checked, cached per schema fingerprint). It is used as a pattern — never copied (see retrieval.ts / nluEngine.ts).
 */
import type { Dialect, SchemaModel } from '../../types';
import { KEYS, readJson, writeJson, type KeyValueStore } from '../../services/storage';
import { schemaFingerprint, norm } from '../engines/schemaContext';
import { containsSecret } from '../errors/appErrors';
import { validateFinalQuery, type CheckResult } from '../engines/queryValidator';
import { extractSqlPattern } from '../engines/sqlPatterns';
import { tokenize, coverage, jaccard } from '../engines/textTokens';
import type { LearnedHint } from '../engines/nluEngine';

export type AdminDialect = Dialect | 'Any';
const AGG_WORDS: Record<string, string[]> = { SUM: ['total', 'sum', 'spend'], AVG: ['average', 'avg', 'mean'], COUNT: ['count', 'number'], MIN: ['minimum', 'min', 'lowest', 'smallest'], MAX: ['maximum', 'max', 'highest', 'largest'] };
export interface AdminValidation { at: string; valid: boolean; schemaId: string; schemaName: string; fingerprint: string; errors: string[]; warnings: string[]; checks: CheckResult[]; }
export interface AdminQuery {
  id: string; name: string; description: string; sql: string; tables: string[]; columns: string[]; purpose: string; tags: string[]; dialect: AdminDialect;
  schemaName: string; schemaVersions: string; createdBy: string; createdAt: string; updatedAt: string;
  approved: boolean; approvedBy: string; approvedAt: string | null; enabled: boolean; lastValidation: AdminValidation | null; deleted?: boolean;
}
export type AdminInput = Partial<Omit<AdminQuery, 'id' | 'createdAt' | 'updatedAt' | 'approved' | 'approvedBy' | 'approvedAt' | 'lastValidation' | 'deleted'>> & { id?: string; name: string; sql: string };
export interface AdminFilter { text?: string; status?: 'all' | 'approved' | 'draft'; enabled?: 'all' | 'enabled' | 'disabled'; dialect?: string; tag?: string; }
const clip = (s: unknown, n: number) => String(s ?? '').trim().slice(0, n);
const list = (v: unknown, n = 40): string[] => (Array.isArray(v) ? v : String(v ?? '').split(/[,;\n]+/)).map((x) => clip(x, 80)).filter(Boolean).slice(0, n);
const DIALECTS = ['Any', 'SQL Server', 'Oracle', 'PostgreSQL', 'MySQL', 'Generic'];

/** Schema-version compatibility: empty or "*" = any; otherwise a comma-separated list of exact versions or prefixes ("1.", "2.1"). */
export function schemaCompatible(q: Pick<AdminQuery, 'schemaName' | 'schemaVersions'>, s: SchemaModel): { ok: boolean; reason: string } {
  if (q.schemaName.trim() && norm(q.schemaName) !== norm(s.name)) return { ok: false, reason: `written for schema "${q.schemaName}", the Active Schema is "${s.name}"` };
  const v = q.schemaVersions.trim(); if (!v || v === '*') return { ok: true, reason: '' };
  const ok = v.split(',').map((x) => x.trim()).filter(Boolean).some((x) => x === '*' || String(s.version) === x || String(s.version).startsWith(x.replace(/\*$/, '')));
  return ok ? { ok: true, reason: '' } : { ok: false, reason: `written for schema version ${v}, the Active Schema is version ${s.version}` };
}
/** Test / validate a library query against a schema: all 12 final-query checks + declared tables/columns + compatibility. */
export function validateAdminQuery(q: AdminQuery | AdminInput, s: SchemaModel, fallbackDialect: Dialect = 'Generic'): AdminValidation {
  const dialect: Dialect = (q.dialect && q.dialect !== 'Any' ? q.dialect : fallbackDialect) as Dialect; const v = validateFinalQuery(q.sql, s, dialect); const errors = [...v.errors]; const warnings = [...v.warnings];
  const tbl = new Map(s.tables.map((t) => [t.name.toUpperCase(), t])); (q.tables || []).forEach((t) => { if (!tbl.has(t.toUpperCase())) warnings.push(`Declared table ${t} is not in the Active Schema.`); });
  (q.columns || []).forEach((c) => { const [t, col] = c.includes('.') ? c.split('.') : ['', c]; const hit = t ? tbl.get(t.toUpperCase())?.columns.some((x) => x.name.toUpperCase() === col.toUpperCase()) : s.tables.some((x) => x.columns.some((y) => y.name.toUpperCase() === col.toUpperCase())); if (!hit) warnings.push(`Declared column ${c} is not in the Active Schema.`); });
  const comp = schemaCompatible({ schemaName: q.schemaName || '', schemaVersions: q.schemaVersions || '' }, s); if (!comp.ok) errors.push(`Not compatible with the Active Schema: ${comp.reason}.`);
  if (!/^\s*(WITH|SELECT)\b/i.test(q.sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) errors.push('Only SELECT / WITH queries can be trusted examples.');
  return { at: new Date().toISOString(), valid: !errors.length, schemaId: s.id, schemaName: s.name, fingerprint: schemaFingerprint(s), errors: Array.from(new Set(errors)), warnings: Array.from(new Set(warnings)), checks: v.checks };
}
export class AdminQueryLibrary {
  private cache: { raw: string | null; list: AdminQuery[] } | null = null; private valid = new Map<string, boolean>(); private docs = new Map<string, { pattern: ReturnType<typeof extractSqlPattern>['pattern']; doc: Set<string>; nameTokens: string[] }>();
  constructor(private store: KeyValueStore, private who: () => string = () => 'Administrator') {}
  private bag(): AdminQuery[] { const raw = this.store.get(KEYS.adminLib); if (this.cache && this.cache.raw === raw) return this.cache.list; let l: AdminQuery[] = []; try { const b = raw ? JSON.parse(raw) : null; l = Array.isArray(b?.queries) ? b.queries : []; } catch { l = []; } this.cache = { raw, list: l }; this.valid.clear(); return l; }
  private save(l: AdminQuery[]): boolean { const ok = writeJson(this.store, KEYS.adminLib, { schemaVersion: 1, queries: l }); this.cache = { raw: this.store.get(KEYS.adminLib), list: l }; this.valid.clear(); return ok; }
  all(): AdminQuery[] { return this.bag().filter((q) => !q.deleted); } allRaw(): AdminQuery[] { return this.bag(); } get(id: string) { return this.all().find((q) => q.id === id); }
  counts() { const a = this.all(); return { total: a.length, approved: a.filter((q) => q.approved).length, enabled: a.filter((q) => q.enabled).length, trusted: a.filter((q) => q.approved && q.enabled).length }; }
  /** Add (no id) or edit. Editing the SQL withdraws the approval — a changed query must be tested and approved again. */
  upsert(i: AdminInput): { ok: boolean; errors: string[]; query?: AdminQuery } {
    const errors: string[] = []; const name = clip(i.name, 120); const sql = String(i.sql ?? '').trim().slice(0, 20000);
    if (!name) errors.push('Query name is required.'); if (!sql) errors.push('SQL query is required.');
    if (containsSecret(`${name} ${i.description || ''} ${sql}`)) errors.push('The query looks like it contains a credential (token / key) and cannot be stored.');
    const dialect = (DIALECTS.includes(String(i.dialect)) ? i.dialect : 'Any') as AdminDialect; if (errors.length) return { ok: false, errors };
    const l = this.bag().slice(); const now = new Date().toISOString(); const ex = i.id ? l.find((x) => x.id === i.id && !x.deleted) : undefined;
    if (l.some((x) => !x.deleted && x.id !== ex?.id && x.name.toLowerCase() === name.toLowerCase())) return { ok: false, errors: [`A query named "${name}" already exists.`] };
    const keep = <T,>(v: T | undefined, cur: T | undefined, d: T): T => (v !== undefined ? v : cur !== undefined ? cur : d); // a field that is not supplied keeps its current value
    const base: AdminQuery = { id: ex?.id || `aq_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, description: clip(keep(i.description, ex?.description, ''), 600), sql, tables: list(keep<unknown>(i.tables, ex?.tables, [])), columns: list(keep<unknown>(i.columns, ex?.columns, [])), purpose: clip(keep(i.purpose, ex?.purpose, ''), 300), tags: list(keep<unknown>(i.tags, ex?.tags, []), 20).map((t) => t.toLowerCase()), dialect: (i.dialect !== undefined ? dialect : ex?.dialect ?? 'Any') as AdminDialect, schemaName: clip(keep(i.schemaName, ex?.schemaName, ''), 80), schemaVersions: clip(keep(i.schemaVersions, ex?.schemaVersions, ''), 80), createdBy: ex?.createdBy || clip(i.createdBy, 80) || this.who(), createdAt: ex?.createdAt || now, updatedAt: now, approved: ex ? ex.approved : false, approvedBy: ex?.approvedBy || '', approvedAt: ex?.approvedAt || null, enabled: i.enabled ?? ex?.enabled ?? true, lastValidation: ex?.lastValidation || null };
    if (ex && ex.sql.trim() !== sql) { base.approved = false; base.approvedBy = ''; base.approvedAt = null; base.lastValidation = null; }
    if (ex) l[l.indexOf(ex)] = base; else l.unshift(base); return this.save(l) ? { ok: true, errors: [], query: base } : { ok: false, errors: ['Browser storage rejected the write — the library was not changed.'] };
  }
  remove(id: string): boolean { const l = this.bag().slice(); const q = l.find((x) => x.id === id); if (!q) return false; q.deleted = true; q.updatedAt = new Date().toISOString(); return this.save(l); }
  setEnabled(id: string, on: boolean): boolean { const l = this.bag().slice(); const q = l.find((x) => x.id === id && !x.deleted); if (!q) return false; q.enabled = on; q.updatedAt = new Date().toISOString(); return this.save(l); }
  /** Test / validate: stores the result on the query. */
  validate(id: string, s: SchemaModel, d: Dialect): AdminValidation | null { const l = this.bag().slice(); const q = l.find((x) => x.id === id && !x.deleted); if (!q) return null; q.lastValidation = validateAdminQuery(q, s, d); q.updatedAt = new Date().toISOString(); this.save(l); return q.lastValidation; }
  /** Mark approved — refused unless the query validates against the Active Schema right now. */
  approve(id: string, s: SchemaModel, d: Dialect, by = this.who()): { ok: boolean; errors: string[] } {
    const l = this.bag().slice(); const q = l.find((x) => x.id === id && !x.deleted); if (!q) return { ok: false, errors: ['Query not found.'] }; const v = validateAdminQuery(q, s, d); q.lastValidation = v;
    if (!v.valid) { this.save(l); return { ok: false, errors: v.errors }; } q.approved = true; q.approvedBy = by; q.approvedAt = new Date().toISOString(); q.updatedAt = q.approvedAt; this.save(l); return { ok: true, errors: [] };
  }
  unapprove(id: string): boolean { const l = this.bag().slice(); const q = l.find((x) => x.id === id && !x.deleted); if (!q) return false; q.approved = false; q.approvedAt = null; q.approvedBy = ''; q.updatedAt = new Date().toISOString(); return this.save(l); }
  search(f: AdminFilter = {}): AdminQuery[] {
    const t = tokenize(f.text || ''); const raw = (f.text || '').trim().toLowerCase();
    return this.all().filter((q) => (!f.status || f.status === 'all' || (f.status === 'approved' ? q.approved : !q.approved)) && (!f.enabled || f.enabled === 'all' || (f.enabled === 'enabled' ? q.enabled : !q.enabled)) && (!f.dialect || f.dialect === 'all' || q.dialect === f.dialect) && (!f.tag || q.tags.includes(f.tag.toLowerCase())))
      .filter((q) => { if (!raw) return true; const hay = `${q.name} ${q.description} ${q.purpose} ${q.tags.join(' ')} ${q.tables.join(' ')} ${q.columns.join(' ')} ${q.sql}`.toLowerCase(); return hay.includes(raw) || (t.length > 0 && coverage(t, tokenize(hay)) >= 0.99); });
  }
  tags(): string[] { return Array.from(new Set(this.all().flatMap((q) => q.tags))).sort(); }
  /** Trusted = approved + enabled + valid against the Active Schema now (cached per schema fingerprint and query revision). */
  isTrusted(q: AdminQuery, s: SchemaModel, d: Dialect): boolean {
    if (!q.approved || !q.enabled || q.deleted) return false; const k = `${q.id}|${q.updatedAt}|${schemaFingerprint(s)}`; const c = this.valid.get(k); if (c !== undefined) return c;
    const ok = validateAdminQuery(q, s, d).valid; this.valid.set(k, ok); return ok;
  }
  trusted(s: SchemaModel, d: Dialect): AdminQuery[] { return this.all().filter((q) => this.isTrusted(q, s, d)); }
  /** Patterns for the NLU, highest trust. Documents (name, description, purpose, tags, tables, columns) are matched against the request. */
  hints(text: string, s: SchemaModel, d: Dialect, requestTables: string[] = []): { hints: LearnedHint[]; considered: number; trusted: number } {
    const t = tokenize(text); const tr = this.trusted(s, d); if (!t.length || !tr.length) return { hints: [], considered: this.all().length, trusted: tr.length };
    const rt = new Set(requestTables); const fp = schemaFingerprint(s); const out = tr.map((q) => {
      // pattern + token document are cached per query revision and schema version — retrieval never re-parses unchanged SQL
      const key = `${q.id}|${q.updatedAt}|${fp}`; let c = this.docs.get(key);
      if (!c) { const { pattern } = extractSqlPattern(q.sql, s);
        // what the SQL really computes is part of what the query is about: measures, grouping, sorting and filter columns, and the words for its aggregate functions
        const doc = new Set(tokenize(`${q.name} ${q.description} ${q.purpose} ${q.tags.join(' ')} ${q.tables.join(' ')} ${q.columns.join(' ')} ${pattern.tables.join(' ')} ${pattern.columns.map((x) => x.column).join(' ')} ${pattern.aggregates.map((a) => a.column).join(' ')} ${pattern.groupBy.map((g) => g.column).join(' ')} ${pattern.sorts.map((g) => g.column).join(' ')} ${pattern.filterShapes.map((f) => f.column).join(' ')}`)); pattern.aggregates.forEach((a) => (AGG_WORDS[a.agg] || []).forEach((w) => doc.add(w)));
        c = { pattern, doc, nameTokens: tokenize(q.name) }; if (this.docs.size > 2000) this.docs.clear(); this.docs.set(key, c); }
      const { pattern, doc } = c;
      const cov = coverage(t, doc); const nameJ = jaccard(t, c.nameTokens); const tbl = rt.size ? [...rt].filter((x) => pattern.tables.includes(x)).length / new Set([...rt, ...pattern.tables]).size : 0;
      const sim = Math.min(1, 0.65 * cov + 0.2 * nameJ + 0.15 * tbl + (rt.size && tbl === 0 ? -0.2 : 0)); return { q, pattern, sim, cov }; })
      .filter((x) => x.cov >= 0.5 && x.sim >= 0.5 && x.pattern.tables.length).sort((a, b) => b.sim - a.sim).slice(0, 3)
      .map(({ q, pattern, sim }): LearnedHint => ({ patternId: q.id, similarity: sim, tables: pattern.tables, columns: pattern.columns, options: { limit: pattern.limit, sorts: pattern.sorts }, source: 'admin', trust: 1, tier: 'admin', label: q.name, aggregates: pattern.aggregates, groupBy: pattern.groupBy, distinct: pattern.distinct, joinType: pattern.joinType, sortOnAggregate: pattern.sortOnAggregate, filterShapes: pattern.filterShapes, decodes: pattern.decodes }));
    return { hints: out, considered: this.all().length, trusted: tr.length };
  }
  /** Merge from another device: last writer wins per query; a deletion tombstone is kept so it propagates. */
  mergeRemote(remote: AdminQuery[]): { added: number; updated: number } {
    const l = this.bag().slice(); let added = 0; let updated = 0; remote.forEach((r) => { const x = l.find((y) => y.id === r.id); if (!x) { l.push(r); added++; } else if ((r.updatedAt || '') > (x.updatedAt || '')) { l[l.indexOf(x)] = r; updated++; } }); if (added || updated) this.save(l); return { added, updated };
  }
  exportJson(): string { return JSON.stringify({ format: 'sqla-admin-queries', formatVersion: 1, exportedAt: new Date().toISOString(), queries: this.all() }, null, 2); }
}

