/**
 * Automatic vs manual Advanced Options. Any Advanced Option the user set by hand is authoritative and never
 * overwritten by the description engine (manual always wins).
 */
import type { ReadOnlyQueryState, SelectedColumnSpec, FilterCondition, SortSpec, ValidationIssue } from '../../types';
import type { V17Requirement } from './nluEngine';
export type ManualOptionKey = 'distinct' | 'groupBy' | 'having' | 'limit' | 'sorts' | 'recursive' | 'ctes' | 'columns' | 'tableAliases' | 'joinType';
const MANUAL_KEYS: ManualOptionKey[] = ['distinct', 'groupBy', 'having', 'limit', 'sorts', 'recursive', 'ctes', 'columns', 'tableAliases', 'joinType'];
class AdvancedOverrides {
  private keys = new Set<ManualOptionKey>(); private listeners = new Set<() => void>();
  mark(k: ManualOptionKey): void { if (!this.keys.has(k)) { this.keys.add(k); this.listeners.forEach((l) => l()); } }
  release(k: ManualOptionKey): void { if (this.keys.delete(k)) this.listeners.forEach((l) => l()); }
  isManual(k: ManualOptionKey): boolean { return this.keys.has(k); }
  list(): ManualOptionKey[] { return MANUAL_KEYS.filter((k) => this.keys.has(k)); }
  clear(): void { if (this.keys.size) { this.keys.clear(); this.listeners.forEach((l) => l()); } }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
export const advancedOverrides = new AdvancedOverrides();
export const ADVANCED_INPUT_KEYS: Record<string, ManualOptionKey> = { advDistinct: 'distinct', advGroupBy: 'groupBy', advHaving: 'having', advLimit: 'limit', advRecursive: 'recursive', addCteBtn: 'ctes', advTableAliases: 'tableAliases', advJoinType: 'joinType' };
export interface ApplyResult { state: ReadOnlyQueryState; applied: string[]; keptManual: string[]; }
function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }
const colKey = (c: SelectedColumnSpec) => (c.manualExpr ? `manual:${c.alias || c.id}` : `${c.table}::${c.column}::${c.aggregate || ''}`);
const filterKey = (f: FilterCondition) => `${f.table}::${f.column}::${f.operator}::${f.value}::${f.value2 || ''}`;
const sortKey = (s: SortSpec) => s.expression || `${s.table}::${s.column}`;
export function applyV17ToState(current: ReadOnlyQueryState, req: V17Requirement, overrides: Pick<AdvancedOverrides, 'isManual'> = advancedOverrides): ApplyResult {
  const s = clone(current); const applied: string[] = []; const keptManual: string[] = [];
  const tableSet = new Set(s.selectedTables); req.matchedTables.forEach((t) => { if (!tableSet.has(t)) { tableSet.add(t); applied.push(`Table ${t}`); } }); s.selectedTables = Array.from(tableSet);
  if (req.aggregateMode && !overrides.isManual('columns')) {
    const customManual = s.selectedColumns.filter((c) => c.manualExpr && (c.displayMode === 'manual-decode' || !c.table || !s.selectedTables.includes(c.table)) && !req.matchedColumns.some((m) => m.alias && m.alias === c.alias));
    s.selectedColumns = [...req.matchedColumns, ...customManual]; applied.push('Aggregate column list');
  } else {
    const existing = new Set(s.selectedColumns.map(colKey));
    req.matchedColumns.forEach((c) => { if (!existing.has(colKey(c))) { s.selectedColumns.push(c); existing.add(colKey(c)); } });
    if (req.aggregateMode) keptManual.push('Columns (manually selected — aggregates were added alongside them)');
  }
  const fk = new Set(s.filters.map(filterKey)); req.matchedFilters.forEach((f) => { if (!fk.has(filterKey(f))) { s.filters.push(f); fk.add(filterKey(f)); applied.push(`Condition ${f.table}.${f.column} ${f.operator}`); } });
  if (overrides.isManual('sorts') && s.sorts.length) keptManual.push('Sort order');
  else { const sk = new Set(s.sorts.map(sortKey)); req.matchedSorts.forEach((so) => { if (!sk.has(sortKey(so))) { s.sorts.push(so); sk.add(sortKey(so)); applied.push('Sort order'); } }); }
  if (overrides.isManual('groupBy') && s.advanced.groupByColumns.length) keptManual.push('GROUP BY'); else if (req.groupBy.length) { s.advanced.groupByColumns = [...req.groupBy]; applied.push('GROUP BY'); }
  if (overrides.isManual('having') && s.advanced.havingClause.trim()) keptManual.push('HAVING'); else if (req.having) { s.advanced.havingClause = req.having; applied.push('HAVING'); }
  if (overrides.isManual('limit')) keptManual.push('LIMIT'); else if (req.limit && !s.advanced.limit) { s.advanced.limit = req.limit; applied.push('LIMIT'); }
  if (overrides.isManual('distinct')) keptManual.push('DISTINCT'); else if (req.distinct && !s.advanced.distinct) { s.advanced.distinct = true; applied.push('DISTINCT'); }
  if (overrides.isManual('tableAliases')) keptManual.push('Table aliases'); else if (req.tableAliases && !s.advanced.tableAliases) { s.advanced.tableAliases = true; applied.push('Table aliases'); }
  if (overrides.isManual('joinType')) keptManual.push('Join type'); else if (req.joinType && s.advanced.joinType !== req.joinType) { s.advanced.joinType = req.joinType; applied.push(req.joinType); }
  const fixed = completeGroupBy(s); if (fixed.length) applied.push(`GROUP BY completed with ${fixed.join(', ')}`);
  return { state: s, applied, keptManual };
}
function plainColumns(state: ReadOnlyQueryState): string[] { return state.selectedColumns.filter((c) => !c.aggregate && !c.manualExpr).map((c) => `${c.table}.${c.column}`); }
function hasAggregate(state: ReadOnlyQueryState): boolean { return state.selectedColumns.some((c) => !!c.aggregate || /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(c.manualExpr || '')); }
export function completeGroupBy(state: ReadOnlyQueryState): string[] {
  if (!hasAggregate(state)) return [];
  const gb = new Set(state.advanced.groupByColumns.map((g) => g.toUpperCase()));
  const missing = plainColumns(state).filter((c) => !gb.has(c.toUpperCase()));
  if (missing.length) state.advanced.groupByColumns.push(...missing);
  return missing;
}
export function validateAdvancedConsistency(state: ReadOnlyQueryState): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const agg = hasAggregate(state); const gb = new Set(state.advanced.groupByColumns.map((g) => g.trim().toUpperCase()));
  if (agg) { const missing = plainColumns(state).filter((c) => !gb.has(c.toUpperCase())); if (missing.length) issues.push({ severity: 'error', message: `Column(s) ${missing.join(', ')} are selected alongside an aggregate but are not in GROUP BY — add them to GROUP BY or remove them.` }); }
  if (state.advanced.havingClause.trim() && !agg && !state.advanced.groupByColumns.length) issues.push({ severity: 'warning', message: 'HAVING is set but the query has no GROUP BY or aggregate — use a WHERE filter instead.' });
  if (state.advanced.groupByColumns.length && !agg) issues.push({ severity: 'warning', message: 'GROUP BY is set but no aggregate (COUNT/SUM/AVG/MIN/MAX) is selected — results will behave like DISTINCT.' });
  if (state.advanced.recursive && !state.advanced.ctes.some((c) => c.name.trim() && c.body.trim())) issues.push({ severity: 'warning', message: 'WITH RECURSIVE is enabled but no CTE is defined — it will have no effect.' });
  if (state.advanced.distinct && state.sorts.some((s) => !s.expression && !state.selectedColumns.some((c) => c.table === s.table && c.column === s.column)) && state.selectedColumns.length) issues.push({ severity: 'warning', message: 'With DISTINCT, ORDER BY columns should also be selected (some databases reject it otherwise).' });
  const known = new Set(state.selectedTables);
  state.advanced.groupByColumns.forEach((g) => { const m = g.match(/^([A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z_][A-Za-z0-9_]*$/); if (m && !known.has(m[1])) issues.push({ severity: 'error', message: `GROUP BY column ${g} belongs to table ${m[1]}, which is not selected.` }); });
  state.sorts.forEach((s) => { if (!s.expression && s.table && !known.has(s.table)) issues.push({ severity: 'error', message: `ORDER BY column ${s.table}.${s.column} belongs to a table that is not selected.` }); });
  if (state.advanced.joinType === 'LEFT JOIN' && state.selectedTables.length < 2) issues.push({ severity: 'warning', message: 'LEFT JOIN is selected but only one table is in the query.' });
  return issues;
}
