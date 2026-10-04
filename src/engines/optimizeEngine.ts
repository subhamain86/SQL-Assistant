import type { ReadOnlyQueryState } from '../types';
export function optimizeSuggestions(st: ReadOnlyQueryState): string[] {
  const t: string[] = []; if (!st.selectedColumns.length) t.push('SELECT * returns every column — pick only the columns you need.');
  st.filters.filter((f) => /LIKE/.test(f.operator) && !/^[^%]/.test(f.value)).forEach((f) => t.push(`The LIKE filter on ${f.table}.${f.column} starts with a wildcard, which prevents index use.`));
  if (st.selectedTables.length >= 3 && !st.filters.length) t.push('Several joined tables with no filter can return very large results — add a WHERE condition.');
  if (!st.advanced.limit && !st.sorts.length) t.push('No limit or sort order is set — consider limiting the number of results.');
  return t.length ? t : ['No obvious optimization issues detected for this query.'];
}
