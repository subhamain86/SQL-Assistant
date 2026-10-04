export function optimizeSuggestions(state) {
    const tips = [];
    if (state.selectedColumns.length === 0)
        tips.push('You are selecting every column (SELECT *). List only the columns you need to reduce network and memory cost.');
    state.filters.filter((f) => f.operator === 'LIKE' || f.operator === 'NOT LIKE').forEach((f) => { if (f.value.trim().startsWith('%'))
        tips.push(`The LIKE filter on ${f.table}.${f.column} starts with "%", which prevents an index range scan.`); });
    if ((state.joins.length + state.selectedTables.length - 1) >= 2 && state.filters.length === 0)
        tips.push('Multiple joins with no WHERE filter can return very large result sets.');
    if (state.advanced.limit === null && state.sorts.length === 0)
        tips.push('No result limit or ORDER BY is set — add one to keep results manageable.');
    if (state.filters.some((f) => f.operator === 'IN' && f.value.split(',').length > 50))
        tips.push('One of your IN filters has a large number of literal values.');
    if (state.advanced.recursive)
        tips.push('Recursive hierarchy walks can be expensive on deep trees.');
    if (state.advanced.groupByColumns.length > 0 && !state.advanced.havingClause.trim() && state.selectedColumns.some((c) => c.aggregate))
        tips.push('You are aggregating with GROUP BY but have no HAVING clause.');
    if (!tips.length)
        tips.push('No obvious optimization issues detected for this query shape.');
    return tips;
}
//# sourceMappingURL=optimizeEngine.js.map