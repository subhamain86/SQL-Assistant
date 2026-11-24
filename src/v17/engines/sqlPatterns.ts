/**
 * V17.4 — Reduces a SQL query (Admin Query Library entry or learned query) to schema-validated FEATURES.
 * The offline NLU uses these as patterns (what to select, group, sort, limit…) and rebuilds the SQL itself with the
 * Active Schema — a stored query is never copied. Anything that does not exist in the Active Schema is dropped and reported.
 */
import type { JoinType, SchemaModel } from '../../types';
import { sanitize, splitClauses, selectItems, itemBody, topLevelSplit } from './queryValidator';

export interface SqlPattern {
  tables: string[]; columns: { table: string; column: string }[];
  aggregates: { agg: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'; table: string; column: string; distinct: boolean }[];
  groupBy: { table: string; column: string }[];
  sorts: { table: string; column: string; direction: 'ASC' | 'DESC' }[]; sortOnAggregate: 'ASC' | 'DESC' | null;
  limit: number | null; distinct: boolean; joinType: JoinType | null;
  filterShapes: { table: string; column: string; operator: string }[]; joins: string[]; hasSubquery: boolean; hasCte: boolean;
  /** V17.5: columns shown through a CASE / DECODE that matches the column's schema definition (the definition itself is never stored — it is re-read from the Active Schema). */
  decodes: { table: string; column: string; style: 'case' | 'decode' }[];
}
export const emptyPattern = (): SqlPattern => ({ tables: [], columns: [], aggregates: [], groupBy: [], sorts: [], sortOnAggregate: null, limit: null, distinct: false, joinType: null, filterShapes: [], joins: [], hasSubquery: false, hasCte: false, decodes: [] });
const U = (s: string) => s.trim().toUpperCase();

export function extractSqlPattern(sql: string, schema: SchemaModel): { pattern: SqlPattern; ignored: string[] } {
  const out = emptyPattern(); const ignored: string[] = []; const c = sanitize(sql).trim(); if (!c || /^--/.test(c)) return { pattern: out, ignored };
  const tbl = new Map(schema.tables.map((t) => [U(t.name), t])); const q = splitClauses(c);
  out.hasCte = /^\s*WITH\b/i.test(c); out.hasSubquery = /\(\s*SELECT\b/i.test(q.main.slice(q.main.search(/\bFROM\b/i) >= 0 ? q.main.search(/\bFROM\b/i) : 0));
  const alias = new Map<string, string>(); const add = (t: string, a?: string) => { const T = tbl.get(U(t)); if (!T) { if (t && !ignored.includes(`table ${t}`)) ignored.push(`table ${t}`); return; } if (!out.tables.includes(T.name)) out.tables.push(T.name); alias.set(U(t), T.name); if (a) alias.set(U(a), T.name); };
  const fm = q.from.match(/^([A-Za-z_][\w$#]*)(?:\s+(?:AS\s+)?([A-Za-z_][\w$#]*))?/i); if (q.baseTable) add(q.baseTable, fm?.[2] && !/^(INNER|LEFT|RIGHT|FULL|CROSS|JOIN|ON|WHERE)$/i.test(fm[2]) ? fm[2] : undefined);
  q.joins.forEach((j) => { if (j.table) add(j.table, j.alias || undefined); if (j.type !== 'CROSS') out.joins.push(`${j.type} ${j.table}`); });
  const nonInner = q.joins.find((j) => j.type !== 'INNER'); if (nonInner) out.joinType = (nonInner.type === 'LEFT' ? 'LEFT JOIN' : nonInner.type === 'RIGHT' ? 'RIGHT JOIN' : nonInner.type === 'FULL' ? 'FULL JOIN' : null);
  const resolve = (ref: string): { table: string; column: string } | null => { const m = ref.trim().match(/^([A-Za-z_][\w$#]*)\.([A-Za-z_][\w$#]*)$/); if (m) { const t = tbl.get(alias.get(U(m[1])) ? U(alias.get(U(m[1]))!) : U(m[1])); const col = t?.columns.find((x) => U(x.name) === U(m[2])); if (t && col) return { table: t.name, column: col.name }; ignored.push(`column ${m[1]}.${m[2]}`); return null; }
    if (/^[A-Za-z_][\w$#]*$/.test(ref.trim()) && out.tables.length === 1) { const t = tbl.get(U(out.tables[0]))!; const col = t.columns.find((x) => U(x.name) === U(ref)); if (col) return { table: t.name, column: col.name }; } return null; };
  const sel = q.select.replace(/^\s*DISTINCT\s+/i, () => { out.distinct = true; return ''; }); const top = sel.match(/^\s*TOP\s+(\d+)\s+/i); if (top) out.limit = +top[1];
  selectItems(sel.replace(/^\s*TOP\s+\d+\s+/i, '')).forEach((it) => { const b = itemBody(it); const a = b.match(/^(COUNT|SUM|AVG|MIN|MAX)\s*\(\s*(DISTINCT\s+)?([^()]*)\)$/i);
    if (a) { const r = a[3].trim() === '*' ? (out.tables[0] ? { table: out.tables[0], column: (tbl.get(U(out.tables[0]))!.columns.find((x) => x.isPrimaryKey) || tbl.get(U(out.tables[0]))!.columns[0]).name } : null) : resolve(a[3]); if (r) out.aggregates.push({ agg: U(a[1]) as 'SUM', table: r.table, column: r.column, distinct: !!a[2] }); return; }
    const r = resolve(b); if (r) { if (!out.columns.some((x) => x.table === r.table && x.column === r.column)) out.columns.push(r); } });
  // V17.5: a CASE / DECODE whose WHEN values are exactly (a subset of) the column's schema definition is a schema decode; anything else is a free-form manual CASE and is ignored here
  { const rawSql = sql.replace(/--.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
    const addDecode = (ref: string, lits: string[], style: 'case' | 'decode') => { const r = resolve(ref); if (!r) return; const col = tbl.get(U(r.table))?.columns.find((x) => U(x.name) === U(r.column)); const raws = new Set((col?.decode || []).map((d) => d.rawValue)); if (!raws.size || !lits.length || !lits.every((l) => raws.has(l.replace(/''/g, "'")))) return; if (!out.decodes.some((d) => d.table === r.table && d.column === r.column)) out.decodes.push({ ...r, style }); if (!out.columns.some((x) => x.table === r.table && x.column === r.column)) out.columns.push(r); };
    for (const m of rawSql.matchAll(/\bCASE((?:\s+WHEN\s+[A-Za-z_][\w$#]*\.[A-Za-z_][\w$#]*\s*=\s*'(?:[^']|'')*'\s+THEN\s+'(?:[^']|'')*')+)\s+ELSE/gi)) { const w = [...m[1].matchAll(/WHEN\s+([A-Za-z_][\w$#]*\.[A-Za-z_][\w$#]*)\s*=\s*'((?:[^']|'')*)'/gi)]; if (new Set(w.map((x) => U(x[1]))).size === 1) addDecode(w[0][1], w.map((x) => x[2]), 'case'); }
    for (const m of rawSql.matchAll(/\bDECODE\s*\(\s*([A-Za-z_][\w$#]*\.[A-Za-z_][\w$#]*)\s*,((?:\s*'(?:[^']|'')*'\s*,\s*'(?:[^']|'')*'\s*,?)+)/gi)) { let l = [...m[2].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1]); if (l.length % 2) l = l.slice(0, -1); addDecode(m[1], l.filter((_, i) => i % 2 === 0), 'decode'); } }
  topLevelSplit(q.groupBy, /,/).forEach((g) => { const r = resolve(g); if (r) out.groupBy.push(r); });
  topLevelSplit(q.orderBy, /,/).forEach((o) => { const m = o.match(/^(.*?)(?:\s+(ASC|DESC))?$/i); const dir = (m?.[2] ? U(m[2]) : 'ASC') as 'ASC' | 'DESC'; const e = (m?.[1] || '').trim(); if (/^(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(e)) { out.sortOnAggregate = dir; return; } const r = resolve(e); if (r) out.sorts.push({ ...r, direction: dir }); });
  const lim = q.tail.match(/\bLIMIT\s+(\d+)/i) || q.tail.match(/\bFETCH\s+FIRST\s+(\d+)\s+ROWS?/i); if (lim) out.limit = +lim[1];
  [...q.where.matchAll(/([A-Za-z_][\w$#]*\.[A-Za-z_][\w$#]*)\s*((?:NOT\s+)?(?:LIKE|IN|BETWEEN)\b|IS\s+(?:NOT\s+)?NULL\b|>=|<=|<>|!=|=|>|<)/gi)].forEach((m) => { const r = resolve(m[1]); if (!r) return; const op = U(m[2]).replace(/\s+/g, ' ').replace('!=', '<>'); if (!out.filterShapes.some((f) => f.table === r.table && f.column === r.column && f.operator === op)) out.filterShapes.push({ ...r, operator: op }); });
  return { pattern: out, ignored: Array.from(new Set(ignored)) };
}
