import type { ReadOnlyQueryState, ValidationIssue } from '../../types';
import type { V17Requirement } from './nluEngine';
export type ManualOptionKey = 'distinct' | 'groupBy' | 'having' | 'limit' | 'sorts' | 'columns' | 'tableAliases' | 'joinType';
class Overrides { private k = new Set<ManualOptionKey>(); mark(x: ManualOptionKey) { this.k.add(x); } isManual(x: ManualOptionKey) { return this.k.has(x); } clear() { this.k.clear(); } }
export const advancedOverrides = new Overrides();
export const ADVANCED_INPUT_KEYS: Record<string, ManualOptionKey> = { advDistinct: 'distinct', advGroupBy: 'groupBy', advHaving: 'having', advLimit: 'limit', advTableAliases: 'tableAliases', advJoinType: 'joinType' };
export function applyV17ToState(cur: ReadOnlyQueryState, req: V17Requirement, ov: Pick<Overrides, 'isManual'> = advancedOverrides): { state: ReadOnlyQueryState; keptManual: string[] } {
  const s: ReadOnlyQueryState = JSON.parse(JSON.stringify(cur)); const kept: string[] = [];
  req.matchedTables.forEach((t) => { if (!s.selectedTables.includes(t)) s.selectedTables.push(t); });
  if (req.aggregateMode && !ov.isManual('columns')) s.selectedColumns = [...req.matchedColumns];
  else req.matchedColumns.forEach((c) => { if (!s.selectedColumns.some((x) => x.table === c.table && x.column === c.column)) s.selectedColumns.push(c); });
  req.matchedFilters.forEach((f) => { if (!s.filters.some((x) => x.table === f.table && x.column === f.column && x.operator === f.operator && x.value === f.value)) s.filters.push(f); });
  if (ov.isManual('sorts') && s.sorts.length) kept.push('Sort order'); else req.matchedSorts.forEach((x) => s.sorts.push(x));
  if (ov.isManual('groupBy') && s.advanced.groupByColumns.length) kept.push('GROUP BY'); else if (req.groupBy.length) s.advanced.groupByColumns = [...req.groupBy];
  if (ov.isManual('having') && s.advanced.havingClause) kept.push('HAVING'); else if (req.having) s.advanced.havingClause = req.having;
  if (ov.isManual('limit')) kept.push('LIMIT'); else if (req.limit && !s.advanced.limit) s.advanced.limit = req.limit;
  if (ov.isManual('distinct')) kept.push('DISTINCT'); else if (req.distinct) s.advanced.distinct = true;
  if (ov.isManual('joinType')) kept.push('Join type'); else if (req.joinType) s.advanced.joinType = req.joinType;
  completeGroupBy(s); return { state: s, keptManual: kept };
}
const hasAgg = (s: ReadOnlyQueryState) => s.selectedColumns.some((c) => !!c.aggregate || /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(c.manualExpr || ''));
const plain = (s: ReadOnlyQueryState) => s.selectedColumns.filter((c) => !c.aggregate && !c.manualExpr).map((c) => `${c.table}.${c.column}`);
export function completeGroupBy(s: ReadOnlyQueryState): void { if (!hasAgg(s)) return; const gb = new Set(s.advanced.groupByColumns.map((g) => g.toUpperCase())); plain(s).filter((c) => !gb.has(c.toUpperCase())).forEach((c) => s.advanced.groupByColumns.push(c)); }
export function validateAdvancedConsistency(s: ReadOnlyQueryState): ValidationIssue[] {
  const i: ValidationIssue[] = []; const gb = new Set(s.advanced.groupByColumns.map((g) => g.toUpperCase()));
  if (hasAgg(s)) { const m = plain(s).filter((c) => !gb.has(c.toUpperCase())); if (m.length) i.push({ severity: 'error', message: `Column(s) ${m.join(', ')} are selected alongside an aggregate but are not in GROUP BY.` }); }
  return i;
}
