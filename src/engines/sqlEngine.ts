import type { ReadOnlyQueryState, SchemaModel, SelectedColumnSpec } from '../types';
import { renderFilterClause } from './filterEngine';
import { buildSchemaDecodeExpression } from './decodeEngine';
import { computeAutoJoinPlan } from './joinAutoEngine';
import { withFkRelationships } from '../v17/engines/joinGraph';
function renderColumn(spec: SelectedColumnSpec, schema: SchemaModel, dialect: ReadOnlyQueryState['dialect']): string {
  if (spec.manualExpr) return spec.manualExpr;
  const base = spec.aggregate ? `${spec.aggregate}(${spec.table}.${spec.column})` : `${spec.table}.${spec.column}`;
  if (spec.displayMode === 'schema-decode') {
    const table = schema.tables.find((t) => t.name === spec.table); const col = table?.columns.find((c) => c.name === spec.column);
    if (col && col.decode?.length) { const alias = spec.alias || `${spec.column}_DESC`; return buildSchemaDecodeExpression(`${spec.table}.${spec.column}`, col, alias, dialect); }
  }
  return spec.alias ? `${base} AS ${spec.alias}` : base;
}
function buildWhereClauseFromFilters(state: ReadOnlyQueryState): string {
  if (state.filters.length === 0) return '';
  return state.filters.map((f, idx) => { const clause = renderFilterClause(f.table, f.column, f.operator, f.value, f.value2); return idx === 0 ? clause : `${f.combinator} ${clause}`; }).join('\n  ');
}
const ALIAS_RESERVED = new Set(['as', 'at', 'by', 'do', 'go', 'if', 'in', 'is', 'of', 'on', 'or', 'to', 'and', 'end', 'for', 'not', 'set', 'all', 'any', 'asc', 'top', 'use', 'add', 'key', 'row', 'desc', 'from', 'into', 'join', 'case', 'else', 'null', 'then', 'when', 'with', 'left', 'full', 'over', 'user', 'view']);
/** V17.2 — short, unique, non-reserved table aliases (INVOICE_HEADER → ih, VENDOR → v). */
export function buildTableAliases(tables: string[]): Record<string, string> {
  const out: Record<string, string> = {}; const used = new Set<string>();
  tables.forEach((t) => {
    const parts = t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    let base = parts.map((p) => p[0]).join('') || 't'; if (/^\d/.test(base)) base = `t${base}`;
    if (parts.length === 1 && parts[0].length > 1) base = parts[0].slice(0, 1);
    let a = base; let n = 2; while (used.has(a) || ALIAS_RESERVED.has(a)) { a = `${base}${n}`; n += 1; }
    used.add(a); out[t] = a;
  });
  return out;
}
/** Rewrites fully qualified references (TABLE.col) and FROM/JOIN clauses to use aliases, never touching string literals. */
export function applyTableAliases(sql: string, aliases: Record<string, string>): string {
  const names = Object.keys(aliases).sort((a, b) => b.length - a.length); if (!names.length) return sql;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const qualified = new RegExp(`(^|[^A-Za-z0-9_$#."])(${names.map(esc).join('|')})\\.(?=[A-Za-z_"])`, 'g');
  const fromJoin = new RegExp(`\\b(FROM|JOIN)(\\s+)(${names.map(esc).join('|')})\\b(?!\\s*\\.)`, 'g');
  return sql.split(/('(?:[^']|'')*')/).map((part, i) => (i % 2 ? part : part.replace(qualified, (_m, pre, t) => `${pre}${aliases[t]}.`).replace(fromJoin, (_m, kw, ws, t) => `${kw}${ws}${t} ${aliases[t]}`))).join('');
}
export function buildSelectSQL(state: ReadOnlyQueryState, schema: SchemaModel): string {
  if (state.selectedTables.length === 0) return '-- Select at least one table (or describe your requirement above) to generate SQL.';
  const primaryTable = state.selectedTables[0]; const otherTables = state.selectedTables.slice(1);
  const explicitJoinTables = new Set(state.joins.map((j) => j.table));
  const autoJoinTargets = otherTables.filter((t) => !explicitJoinTables.has(t));
  const autoPlan = computeAutoJoinPlan(withFkRelationships(schema), primaryTable, autoJoinTargets, state.joinPathChoices);
  const joinType = state.advanced.joinType === 'LEFT JOIN' ? 'LEFT JOIN' : 'INNER JOIN';
  const selectList = state.selectedColumns.length ? state.selectedColumns.map((c) => renderColumn(c, schema, state.dialect)).join(',\n  ') : '*';
  const lines: string[] = [];
  if (state.advanced.ctes.length) { const cteParts = state.advanced.ctes.filter((c) => c.name.trim() && c.body.trim()).map((c) => `${c.name} AS (\n  ${c.body}\n)`); if (cteParts.length) lines.push(`WITH ${state.advanced.recursive ? 'RECURSIVE ' : ''}${cteParts.join(',\n')}`); }
  lines.push(`SELECT ${state.advanced.distinct ? 'DISTINCT ' : ''}${state.advanced.limit && state.dialect === 'SQL Server' ? `TOP ${state.advanced.limit} ` : ''}${selectList}`);
  lines.push(`FROM ${primaryTable}`);
  autoPlan.joinLines.forEach((jl) => lines.push(joinType === 'LEFT JOIN' ? jl.replace(/^INNER JOIN /, 'LEFT JOIN ') : jl));
  state.joins.forEach((j) => lines.push(`${j.joinType} ${j.table} ON ${j.onLeftTable}.${j.onLeftColumn} = ${j.table}.${j.onRightColumn}`));
  const where = buildWhereClauseFromFilters(state);
  if (where) lines.push(`WHERE ${where}`);
  if (state.advanced.groupByColumns.length) lines.push(`GROUP BY ${state.advanced.groupByColumns.join(', ')}`);
  if (state.advanced.havingClause.trim()) lines.push(`HAVING ${state.advanced.havingClause.trim()}`);
  if (state.sorts.length) lines.push(`ORDER BY ${state.sorts.map((s) => `${s.expression || `${s.table}.${s.column}`} ${s.direction}`).join(', ')}`);
  if (state.advanced.limit && state.dialect !== 'SQL Server') { if (state.dialect === 'Oracle') lines.push(`FETCH FIRST ${state.advanced.limit} ROWS ONLY`); else lines.push(`LIMIT ${state.advanced.limit}`); }
  const sql = lines.join('\n') + ';';
  if (!state.advanced.tableAliases) return sql;
  const inQuery = Array.from(new Set([primaryTable, ...autoPlan.bridgeTablesUsed, ...otherTables, ...state.joins.map((j) => j.table)]));
  return applyTableAliases(sql, buildTableAliases(inQuery));
}
