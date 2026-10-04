import type { ReadOnlyQueryState, SchemaModel } from '../types';
import { renderFilterClause } from './filterEngine';
import { computeAutoJoinPlan } from './joinAutoEngine';
import { withFkRelationships } from '../v17/engines/joinGraph';
const RES = new Set(['as', 'at', 'by', 'in', 'is', 'of', 'on', 'or', 'to', 'and', 'end', 'for', 'not', 'set', 'all', 'asc', 'top', 'key', 'row', 'desc', 'from', 'join', 'case', 'else', 'null', 'then', 'when', 'with', 'left', 'user', 'view']);
export function buildTableAliases(tables: string[]): Record<string, string> { const o: Record<string, string> = {}; const used = new Set<string>(); tables.forEach((t) => { const p = t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); let b = p.length === 1 ? p[0][0] : p.map((x) => x[0]).join(''); let a = b; let n = 2; while (used.has(a) || RES.has(a)) a = `${b}${n++}`; used.add(a); o[t] = a; }); return o; }
export function applyTableAliases(sql: string, al: Record<string, string>): string {
  const names = Object.keys(al).sort((a, b) => b.length - a.length); const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const qual = new RegExp(`(^|[^A-Za-z0-9_$#."])(${names.map(esc).join('|')})\\.(?=[A-Za-z_"])`, 'g'); const fj = new RegExp(`\\b(FROM|JOIN)(\\s+)(${names.map(esc).join('|')})\\b(?!\\s*\\.)`, 'g');
  return sql.split(/('(?:[^']|'')*')/).map((p, i) => (i % 2 ? p : p.replace(qual, (_m, pre, t) => `${pre}${al[t]}.`).replace(fj, (_m, k, w, t) => `${k}${w}${t} ${al[t]}`))).join('');
}
export function buildSelectSQL(st: ReadOnlyQueryState, s: SchemaModel): string {
  if (!st.selectedTables.length) return '-- Select at least one table (or describe your requirement above) to generate SQL.';
  const [p, ...o] = st.selectedTables; const ex = new Set(st.joins.map((j) => j.table));
  const plan = computeAutoJoinPlan(withFkRelationships(s), p, o.filter((t) => !ex.has(t)));
  const cols = st.selectedColumns.length ? st.selectedColumns.map((c) => c.manualExpr || `${c.aggregate ? `${c.aggregate}(${c.table}.${c.column})` : `${c.table}.${c.column}`}${c.alias ? ` AS ${c.alias}` : ''}`).join(',\n  ') : '*';
  const L: string[] = []; const ctes = st.advanced.ctes.filter((c) => c.name.trim() && c.body.trim());
  if (ctes.length) L.push(`WITH ${st.advanced.recursive ? 'RECURSIVE ' : ''}${ctes.map((c) => `${c.name} AS (\n  ${c.body}\n)`).join(',\n')}`);
  L.push(`SELECT ${st.advanced.distinct ? 'DISTINCT ' : ''}${st.advanced.limit && st.dialect === 'SQL Server' ? `TOP ${st.advanced.limit} ` : ''}${cols}`, `FROM ${p}`);
  plan.joinLines.forEach((j) => L.push(st.advanced.joinType === 'LEFT JOIN' ? j.replace(/^INNER JOIN /, 'LEFT JOIN ') : j));
  st.joins.forEach((j) => L.push(`${j.joinType} ${j.table} ON ${j.onLeftTable}.${j.onLeftColumn} = ${j.table}.${j.onRightColumn}`));
  if (st.filters.length) L.push(`WHERE ${st.filters.map((f, i) => `${i ? `${f.combinator} ` : ''}${renderFilterClause(f.table, f.column, f.operator, f.value, f.value2)}`).join('\n  ')}`);
  if (st.advanced.groupByColumns.length) L.push(`GROUP BY ${st.advanced.groupByColumns.join(', ')}`);
  if (st.advanced.havingClause.trim()) L.push(`HAVING ${st.advanced.havingClause.trim()}`);
  if (st.sorts.length) L.push(`ORDER BY ${st.sorts.map((x) => `${x.expression || `${x.table}.${x.column}`} ${x.direction}`).join(', ')}`);
  if (st.advanced.limit && st.dialect !== 'SQL Server') L.push(st.dialect === 'Oracle' ? `FETCH FIRST ${st.advanced.limit} ROWS ONLY` : `LIMIT ${st.advanced.limit}`);
  const sql = L.join('\n') + ';';
  return st.advanced.tableAliases ? applyTableAliases(sql, buildTableAliases(Array.from(new Set([...st.selectedTables, ...st.joins.map((j) => j.table)])))) : sql;
}
