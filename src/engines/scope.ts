/**
 * V17.4 — "in-scope" view of a Read Only query state.
 * Selections made for a table that is currently NOT selected are kept in the state (so they come back when the table is
 * selected again — nothing is lost while the user keeps configuring the query) but they never reach the generated SQL.
 */
import type { ReadOnlyQueryState, SelectedColumnSpec, FilterCondition, SortSpec } from '../types';
export interface ActiveSelection { columns: SelectedColumnSpec[]; filters: FilterCondition[]; sorts: SortSpec[]; hiddenCount: number; }
export function activeSelection(st: Pick<ReadOnlyQueryState, 'selectedTables' | 'selectedColumns' | 'filters' | 'sorts'>): ActiveSelection {
  const scope = new Set(st.selectedTables);
  const columns = st.selectedColumns.filter((c) => (c.manualExpr && !c.table) || scope.has(c.table));
  const filters = st.filters.filter((f) => scope.has(f.table));
  const sorts = st.sorts.filter((x) => x.expression || scope.has(x.table));
  const hiddenCount = (st.selectedColumns.length - columns.length) + (st.filters.length - filters.length) + (st.sorts.length - sorts.length);
  return { columns, filters, sorts, hiddenCount };
}
