import type { ReadOnlyQueryState, SchemaModel } from '../types';
import { renderFilterClause } from './filterEngine';
import { computeAutoJoinPlan } from './joinAutoEngine';
import { withFkRelationships } from '../v17/engines/joinGraph';
import { activeSelection } from './scope';
const RES = new Set(['as', 'at', 'by', 'in', 'is', 'of', 'on', 'or', 'to', 'and', 'end', 'for', 'not', 'set', 'all', 'asc', 'top', 'key', 'row', 'desc', 'from', 'join', 'case', 'else', 'null', 'then', 'when', 'with', 'left', 'user', 'view']);
export function buildTableAliases(tables: string[]): Record<string, string> { const o: Record<string, string> = {}; const used = new Set<string>(); tables.forEach((t) => { const p = t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); const b = p.length === 1 ? p[0][0] : p.map((x) => x[0]).join(''); let a = b; let n = 2; while (used.has(a) || RES.has(a)) a = `${b}${n++}`; used.add(a); o[t] = a; }); return o; }
export function applyTableAliases(sql: string, al: Record<string, string>): string {
  const names = Object.keys(al).sort((a, b) => b.length - a.length); if (!names.length) return sql; const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const qual = new RegExp(`(^|[^A-Za-z0-9_$#."])(${names.map(esc).join('|')})\\.(?=[A-Za-z_"])`, 'g'); const fj = new RegExp(`\\b(FROM|JOIN)(\\s+)(${names.map(esc).join('|')})\\b(?!\\s*\\.)`, 'g');
  return sql.split(/('(?:[^']|'')*')/).map((p, i) => (i % 2 ? p : p.replace(qual, (_m, pre, t) => `${pre}${al[t]}.`).replace(fj, (_m, k, w, t) => `${k}${w}${t} ${al[t]}`))).join('');
}
/**
 * V17.5 — renders a schema CASE/DECODE definition. The definition is ALWAYS read from the Active Schema at build time (never stored in the
 * query state), so a schema update or pull changes the generated SQL at once and nothing is ever invented.
 */
export function schemaDecodeSql(base: string, decode: { rawValue: string; label: string }[], dialect: string, style: 'case' | 'decode' | undefined, alias: string): { sql: string; style: 'case' | 'decode' } {
  const q = (v: string) => `'${String(v).replace(/'/g, "''")}'`; const fallback = dialect === 'Oracle' || dialect === 'SQL Server' ? `CAST(${base} AS VARCHAR(255))` : base;
  if (style === 'decode' && dialect === 'Oracle') return { style: 'decode', sql: `DECODE(${base}, ${decode.map((d) => `${q(d.rawValue)}, ${q(d.label)}`).join(', ')}, TO_CHAR(${base})) AS ${alias}` };
  return { style: 'case', sql: `CASE ${decode.map((d) => `WHEN ${base} = ${q(d.rawValue)} THEN ${q(d.label)}`).join(' ')} ELSE ${fallback} END AS ${alias}` };
}
export interface BuildResult { sql: string; tablesUsed: string[]; columnsUsed: string[]; applied: string[]; warnings: string[]; }
/** Strips a trailing semicolon / comments from a user-written sub-select. */
export const cleanSubBody = (b: string): string => b.replace(/--.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim().replace(/;+\s*$/, '').trim();
export function buildSelect(st: ReadOnlyQueryState, s: SchemaModel): BuildResult {
  const res: BuildResult = { sql: '', tablesUsed: [], columnsUsed: [], applied: [], warnings: [] };
  if (!st.selectedTables.length) { res.sql = '-- Select at least one table (or describe your requirement above) to generate SQL.'; return res; }
  const act = activeSelection(st); const [p, ...o] = st.selectedTables; const plan = computeAutoJoinPlan(withFkRelationships(s), p, o, st.joinPathChoices || {}); res.warnings.push(...plan.unresolvedWarnings);
  const colExpr = (c: ReadOnlyQueryState['selectedColumns'][number]): string => {
    if (c.manualExpr) return c.manualExpr;
    const base = c.aggregate ? `${c.aggregate}(${c.table}.${c.column})` : `${c.table}.${c.column}`;
    const col = s.tables.find((t) => t.name === c.table)?.columns.find((x) => x.name === c.column);
    if (c.useDecode && !c.aggregate && col?.decode?.length) { const a = c.alias || `${c.column}_DESC`; const r = schemaDecodeSql(base, col.decode, st.dialect, c.decodeStyle, a); res.applied.push(`CASE/DECODE: ${c.table}.${c.column} — schema definition as ${r.style === 'decode' ? 'DECODE' : 'CASE'}${c.decodeStyle === 'decode' && r.style === 'case' ? ' (DECODE is Oracle-only — CASE used)' : ''}`); return r.sql; }
    if (c.useDecode && !c.aggregate && !col?.decode?.length) res.warnings.push(`No CASE/DECODE definition is available for ${c.table}.${c.column} in the active schema — the plain column is used (nothing was invented).`);
    return c.alias ? `${base} AS ${c.alias}` : base;
  };
  const cols = act.columns.length ? act.columns.map(colExpr).join(',\n  ') : '*';
  const L: string[] = [];
  const ctes = (st.advanced.ctes || []).filter((c) => c.name.trim() && c.body.trim()); const recKw = st.advanced.recursive && st.dialect !== 'Oracle' && st.dialect !== 'SQL Server'; if (st.advanced.recursive && !recKw && ctes.length) res.warnings.push(`${st.dialect} does not use the RECURSIVE keyword — recursion is written without it.`); if (ctes.length) L.push(`WITH ${recKw ? 'RECURSIVE ' : ''}${ctes.map((c) => `${c.name.trim()} AS (\n  ${c.body.trim()}\n)`).join(',\n')}`);
  L.push(`SELECT ${st.advanced.distinct ? 'DISTINCT ' : ''}${st.advanced.limit && st.dialect === 'SQL Server' ? `TOP ${st.advanced.limit} ` : ''}${cols}`, `FROM ${p}`);
  let jt = st.advanced.joinType || 'INNER JOIN';
  if (jt === 'FULL JOIN' && st.dialect === 'MySQL') { res.warnings.push('FULL JOIN is not supported by MySQL — LEFT JOIN was used instead.'); jt = 'LEFT JOIN'; }
  plan.joinLines.forEach((j) => L.push(jt === 'INNER JOIN' ? j : j.replace(/^INNER JOIN /, `${jt === 'FULL JOIN' && st.dialect === 'Oracle' ? 'FULL OUTER JOIN' : jt} `)));
  const subs = (st.advanced.subqueries || []).filter((x) => cleanSubBody(x.body) && (x.kind === 'EXISTS' || x.kind === 'NOT EXISTS' || /^[A-Za-z_][\w$#]*\.[A-Za-z_][\w$#]*$/.test(x.column.trim())));
  const subTok = (i: number) => `__SUBQ_${i}__`;
  const whereParts = [...act.filters.map((f, i) => `${i ? `${f.combinator} ` : ''}${renderFilterClause(f.table, f.column, f.operator, f.value, f.value2)}`), ...subs.map((x, i) => `${act.filters.length || i ? 'AND ' : ''}${/EXISTS/.test(x.kind) ? `${x.kind} ` : `${x.column.trim()} ${x.kind} `}${subTok(i)}`)];
  if (whereParts.length) L.push(`WHERE ${whereParts.join('\n  ')}`);
  if (st.advanced.groupByColumns.length) L.push(`GROUP BY ${st.advanced.groupByColumns.join(', ')}`);
  if (st.advanced.havingClause.trim()) L.push(`HAVING ${st.advanced.havingClause.trim()}`);
  if (act.sorts.length) L.push(`ORDER BY ${act.sorts.map((x) => `${x.expression || `${x.table}.${x.column}`} ${x.direction}`).join(', ')}`);
  if (st.advanced.limit && st.dialect !== 'SQL Server') L.push(st.dialect === 'Oracle' ? `FETCH FIRST ${st.advanced.limit} ROWS ONLY` : `LIMIT ${st.advanced.limit}`);
  let sql = L.join('\n');
  // sub-select bodies are user-written: they are inserted AFTER table aliasing so their own table names are never rewritten
  const unsub = (q: string) => subs.reduce((acc, x, i) => acc.replace(subTok(i), `(\n  ${cleanSubBody(x.body).replace(/\n/g, '\n  ')}\n)`), q);
  if (st.advanced.tableAliases) sql = applyTableAliases(sql, buildTableAliases(Array.from(new Set([...st.selectedTables, ...plan.bridgeTablesUsed]))));
  if (st.advanced.viewName.trim() && !ctes.length) { const v = st.advanced.viewName.trim().replace(/[^A-Za-z0-9_]/g, '_'); sql = `WITH ${v} AS (\n${sql.split('\n').map((x) => `  ${x}`).join('\n')}\n)\nSELECT * FROM ${v}`; res.applied.push(`Named query: ${v}`); }
  sql = unsub(sql); res.sql = sql + ';'; res.tablesUsed = [...st.selectedTables];
  res.columnsUsed = act.columns.map((c) => c.manualExpr ? c.alias : `${c.aggregate ? `${c.aggregate}(` : ''}${c.table}.${c.column}${c.aggregate ? ')' : ''}${c.alias ? ` AS ${c.alias}` : ''}`);
  res.applied.push(...plan.description.map((d) => `Join: ${d}`), ...act.filters.map((f) => `Filter: ${renderFilterClause(f.table, f.column, f.operator, f.value, f.value2)}`), ...subs.map((x) => `Filter: ${/EXISTS/.test(x.kind) ? x.kind : `${x.column} ${x.kind}`} (sub-select)`));
  if (st.advanced.groupByColumns.length) res.applied.push(`Group by: ${st.advanced.groupByColumns.join(', ')}`); if (st.advanced.havingClause) res.applied.push(`Having: ${st.advanced.havingClause}`);
  if (act.sorts.length) res.applied.push(`Sort: ${act.sorts.map((x) => `${x.expression || `${x.table}.${x.column}`} ${x.direction}`).join(', ')}`); if (st.advanced.limit) res.applied.push(`Limit: ${st.advanced.limit}`); if (jt !== 'INNER JOIN' && plan.joinLines.length) res.applied.push(`Join type: ${jt}`); if (st.advanced.distinct) res.applied.push('Remove duplicates (DISTINCT)');
  return res;
}
export const buildSelectSQL = (st: ReadOnlyQueryState, s: SchemaModel): string => buildSelect(st, s).sql;
