import type { ReadOnlyQueryState, SchemaModel } from '../types';
import { renderFilterClause } from './filterEngine';
import { computeAutoJoinPlan } from './joinAutoEngine';
import { withFkRelationships } from '../v17/engines/joinGraph';
const RES = new Set(['as', 'at', 'by', 'in', 'is', 'of', 'on', 'or', 'to', 'and', 'end', 'for', 'not', 'set', 'all', 'asc', 'top', 'key', 'row', 'desc', 'from', 'join', 'case', 'else', 'null', 'then', 'when', 'with', 'left', 'user', 'view']);
export function buildTableAliases(tables: string[]): Record<string, string> { const o: Record<string, string> = {}; const used = new Set<string>(); tables.forEach((t) => { const p = t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); const b = p.length === 1 ? p[0][0] : p.map((x) => x[0]).join(''); let a = b; let n = 2; while (used.has(a) || RES.has(a)) a = `${b}${n++}`; used.add(a); o[t] = a; }); return o; }
export function applyTableAliases(sql: string, al: Record<string, string>): string {
  const names = Object.keys(al).sort((a, b) => b.length - a.length); if (!names.length) return sql; const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const qual = new RegExp(`(^|[^A-Za-z0-9_$#."])(${names.map(esc).join('|')})\\.(?=[A-Za-z_"])`, 'g'); const fj = new RegExp(`\\b(FROM|JOIN)(\\s+)(${names.map(esc).join('|')})\\b(?!\\s*\\.)`, 'g');
  return sql.split(/('(?:[^']|'')*')/).map((p, i) => (i % 2 ? p : p.replace(qual, (_m, pre, t) => `${pre}${al[t]}.`).replace(fj, (_m, k, w, t) => `${k}${w}${t} ${al[t]}`))).join('');
}
export interface BuildResult { sql: string; tablesUsed: string[]; columnsUsed: string[]; applied: string[]; warnings: string[]; }
export function buildSelect(st: ReadOnlyQueryState, s: SchemaModel): BuildResult {
  const res: BuildResult = { sql: '', tablesUsed: [], columnsUsed: [], applied: [], warnings: [] };
  if (!st.selectedTables.length) { res.sql = '-- Select at least one table (or describe your requirement above) to generate SQL.'; return res; }
  const [p, ...o] = st.selectedTables; const plan = computeAutoJoinPlan(withFkRelationships(s), p, o, st.joinPathChoices || {}); res.warnings.push(...plan.unresolvedWarnings);
  const colExpr = (c: ReadOnlyQueryState['selectedColumns'][number]): string => {
    if (c.manualExpr) return c.manualExpr;
    const base = c.aggregate ? `${c.aggregate}(${c.table}.${c.column})` : `${c.table}.${c.column}`;
    const col = s.tables.find((t) => t.name === c.table)?.columns.find((x) => x.name === c.column);
    if (c.useDecode && !c.aggregate && col?.decode?.length) { const a = c.alias || `${c.column}_DESC`; return `CASE ${col.decode.map((d) => `WHEN ${base} = '${d.rawValue.replace(/'/g, "''")}' THEN '${d.label.replace(/'/g, "''")}'`).join(' ')} ELSE ${st.dialect === 'Oracle' || st.dialect === 'SQL Server' ? `CAST(${base} AS VARCHAR(255))` : base} END AS ${a}`; }
    return c.alias ? `${base} AS ${c.alias}` : base;
  };
  const cols = st.selectedColumns.length ? st.selectedColumns.map(colExpr).join(',\n  ') : '*';
  const L: string[] = [];
  const ctes = (st.advanced.ctes || []).filter((c) => c.name.trim() && c.body.trim()); if (ctes.length) L.push(`WITH ${st.advanced.recursive ? 'RECURSIVE ' : ''}${ctes.map((c) => `${c.name.trim()} AS (\n  ${c.body.trim()}\n)`).join(',\n')}`);
  L.push(`SELECT ${st.advanced.distinct ? 'DISTINCT ' : ''}${st.advanced.limit && st.dialect === 'SQL Server' ? `TOP ${st.advanced.limit} ` : ''}${cols}`, `FROM ${p}`);
  plan.joinLines.forEach((j) => L.push(st.advanced.joinType === 'LEFT JOIN' ? j.replace(/^INNER JOIN /, 'LEFT JOIN ') : j));
  if (st.filters.length) L.push(`WHERE ${st.filters.map((f, i) => `${i ? `${f.combinator} ` : ''}${renderFilterClause(f.table, f.column, f.operator, f.value, f.value2)}`).join('\n  ')}`);
  if (st.advanced.groupByColumns.length) L.push(`GROUP BY ${st.advanced.groupByColumns.join(', ')}`);
  if (st.advanced.havingClause.trim()) L.push(`HAVING ${st.advanced.havingClause.trim()}`);
  if (st.sorts.length) L.push(`ORDER BY ${st.sorts.map((x) => `${x.expression || `${x.table}.${x.column}`} ${x.direction}`).join(', ')}`);
  if (st.advanced.limit && st.dialect !== 'SQL Server') L.push(st.dialect === 'Oracle' ? `FETCH FIRST ${st.advanced.limit} ROWS ONLY` : `LIMIT ${st.advanced.limit}`);
  let sql = L.join('\n');
  if (st.advanced.tableAliases) sql = applyTableAliases(sql, buildTableAliases(Array.from(new Set([...st.selectedTables, ...plan.bridgeTablesUsed]))));
  if (st.advanced.viewName.trim() && !ctes.length) { const v = st.advanced.viewName.trim().replace(/[^A-Za-z0-9_]/g, '_'); sql = `WITH ${v} AS (\n${sql.split('\n').map((x) => `  ${x}`).join('\n')}\n)\nSELECT * FROM ${v}`; res.applied.push(`Named query: ${v}`); }
  res.sql = sql + ';'; res.tablesUsed = [...st.selectedTables];
  res.columnsUsed = st.selectedColumns.map((c) => c.manualExpr ? c.alias : `${c.aggregate ? `${c.aggregate}(` : ''}${c.table}.${c.column}${c.aggregate ? ')' : ''}${c.alias ? ` AS ${c.alias}` : ''}`);
  res.applied.push(...plan.description.map((d) => `Join: ${d}`), ...st.filters.map((f) => `Filter: ${renderFilterClause(f.table, f.column, f.operator, f.value, f.value2)}`));
  if (st.advanced.groupByColumns.length) res.applied.push(`Group by: ${st.advanced.groupByColumns.join(', ')}`); if (st.advanced.havingClause) res.applied.push(`Having: ${st.advanced.havingClause}`);
  if (st.sorts.length) res.applied.push(`Sort: ${st.sorts.map((x) => `${x.expression || `${x.table}.${x.column}`} ${x.direction}`).join(', ')}`); if (st.advanced.limit) res.applied.push(`Limit: ${st.advanced.limit}`); if (st.advanced.distinct) res.applied.push('Remove duplicates (DISTINCT)');
  return res;
}
export const buildSelectSQL = (st: ReadOnlyQueryState, s: SchemaModel): string => buildSelect(st, s).sql;
