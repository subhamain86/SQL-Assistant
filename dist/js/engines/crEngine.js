function formatValue(raw) { const t = raw.trim(); if (t === '')
    return 'NULL'; if (/^-?\d+(\.\d+)?$/.test(t))
    return t; if (/^(sysdate|getdate\(\)|now\(\)|current_date|current_timestamp)$/i.test(t))
    return t.toUpperCase(); if (t.startsWith("'") && t.endsWith("'"))
    return t; return `'${t.replace(/'/g, "''")}'`; }
function buildWhereClause(filters) {
    return filters.map((f, idx) => { const clause = f.operator === 'IS NULL' ? `${f.table}.${f.column} IS NULL` : f.operator === 'IS NOT NULL' ? `${f.table}.${f.column} IS NOT NULL` : `${f.table}.${f.column} ${f.operator} ${formatValue(f.value)}`; return idx === 0 ? clause : `${f.combinator} ${clause}`; }).join('\n  ');
}
export function buildCrSQL(state) {
    if (!state.table)
        return { sql: '-- Choose a table for this Change Request.', blocked: true, reason: 'No table selected.' };
    const where = buildWhereClause(state.filters);
    const needsWhere = state.queryType === 'UPDATE' || state.queryType === 'DELETE';
    if (needsWhere && !where && !state.confirmNoWhere)
        return { sql: '-- A WHERE condition is required to identify which records should be updated or deleted.\n-- Add at least one filter, or explicitly confirm this query should have no WHERE condition.', blocked: true, reason: 'Missing mandatory WHERE clause.' };
    if (state.queryType === 'INSERT') {
        if (!state.values.length)
            return { sql: '-- Add at least one column/value pair to build an INSERT statement.', blocked: true };
        return { sql: `INSERT INTO ${state.table} (${state.values.map((v) => v.column).join(', ')})\nVALUES (${state.values.map((v) => formatValue(v.value)).join(', ')});`, blocked: false };
    }
    if (state.queryType === 'UPDATE') {
        if (!state.values.length)
            return { sql: '-- Add at least one column/value pair to build an UPDATE statement.', blocked: true };
        let sql = `UPDATE ${state.table}\nSET ${state.values.map((v) => `${v.column} = ${formatValue(v.value)}`).join(',\n  ')}`;
        sql += where ? `\nWHERE ${where};` : '\n-- No WHERE condition (explicitly confirmed) — this will affect ALL rows.;';
        return { sql, blocked: false };
    }
    let sql = `DELETE FROM ${state.table}`;
    sql += where ? `\nWHERE ${where};` : '\n-- No WHERE condition (explicitly confirmed) — this will affect ALL rows.;';
    return { sql, blocked: false };
}
//# sourceMappingURL=crEngine.js.map