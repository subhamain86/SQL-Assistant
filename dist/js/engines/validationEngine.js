import { validateAdvancedConsistency } from '../v17/engines/advancedOptionsResolver.js';
const DESTRUCTIVE_KEYWORDS = ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'DROP', 'ALTER', 'TRUNCATE', 'GRANT', 'REVOKE', 'CREATE'];
function stripCommentsAndStrings(sql) { let out = sql.replace(/--.*$/gm, ' '); out = out.replace(/\/\*[\s\S]*?\*\//g, ' '); out = out.replace(/'(?:[^']|'')*'/g, "''"); return out; }
export function validateReadOnlySql(sql) {
    const issues = [];
    const cleaned = stripCommentsAndStrings(sql).toUpperCase();
    for (const kw of DESTRUCTIVE_KEYWORDS) {
        const re = new RegExp(`(^|[^A-Z_])${kw}([^A-Z_]|$)`);
        if (re.test(cleaned))
            issues.push({ severity: 'error', message: `Destructive statement detected: "${kw}" is not permitted in the Read Only Query Builder. Use the Query Builder for CR instead.` });
    }
    if (!/\bSELECT\b/.test(cleaned) && !/\bWITH\b/.test(cleaned))
        issues.push({ severity: 'warning', message: 'No SELECT / WITH statement detected yet.' });
    return { valid: issues.filter((i) => i.severity === 'error').length === 0, issues };
}
export function validateSqlStructure(sql) {
    const issues = [];
    const s = sql.trim();
    if (!s || s.startsWith('--'))
        return issues;
    const noComments = s.replace(/--.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
    if ((noComments.match(/'/g) || []).length % 2)
        issues.push({ severity: 'error', message: 'Unterminated string literal: the SQL has an odd number of single quotes.' });
    const c = stripCommentsAndStrings(s);
    let depth = 0;
    for (const ch of c) {
        if (ch === '(')
            depth += 1;
        if (ch === ')') {
            depth -= 1;
            if (depth < 0)
                break;
        }
    }
    if (depth !== 0)
        issues.push({ severity: 'error', message: depth > 0 ? 'Unbalanced parentheses: a "(" is not closed.' : 'Unbalanced parentheses: there is an extra ")".' });
    const U = c.toUpperCase();
    if (/\bSELECT\b/.test(U) && !/\bFROM\b/.test(U))
        issues.push({ severity: 'error', message: 'SELECT statement has no FROM clause.' });
    const top = U.replace(/\([^()]*\)/g, ' ').replace(/\([^()]*\)/g, ' ');
    const order = ['WHERE', 'GROUP BY', 'HAVING', 'ORDER BY'].map((k) => ({ k, i: top.search(new RegExp(`\\b${k.replace(' ', '\\s+')}\\b`)) })).filter((x) => x.i >= 0);
    for (let i = 1; i < order.length; i++)
        if (order[i].i < order[i - 1].i)
            issues.push({ severity: 'error', message: `Clause order is invalid: ${order[i].k} appears before ${order[i - 1].k}.` });
    if (/\bHAVING\b/.test(top) && !/\bGROUP\s+BY\b/.test(top) && !/\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/.test(U))
        issues.push({ severity: 'warning', message: 'HAVING is used without GROUP BY or an aggregate.' });
    if (/,\s*(FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING)\b/.test(U))
        issues.push({ severity: 'error', message: 'A trailing comma appears before a clause keyword.' });
    const sel = U.match(/\bSELECT\b([\s\S]*?)\bFROM\b/);
    if (sel) {
        const al = [...sel[1].matchAll(/\bAS\s+([A-Z_][A-Z0-9_$#]*)/g)].map((m) => m[1]);
        const dup = al.filter((a, i) => al.indexOf(a) !== i);
        if (dup.length)
            issues.push({ severity: 'error', message: `Duplicate output column alias(es): ${Array.from(new Set(dup)).join(', ')}.` });
    }
    return issues;
}
export function validateReadOnlyState(state) {
    const issues = [];
    if (state.selectedTables.length === 0)
        issues.push({ severity: 'warning', message: 'Select at least one table, or describe your requirement above.' });
    if (state.advanced.limit !== null && state.advanced.limit <= 0)
        issues.push({ severity: 'error', message: 'Result limit must be a positive number.' });
    const seen = new Set();
    state.selectedColumns.forEach((c) => { if (c.alias) {
        if (seen.has(c.alias.toUpperCase()))
            issues.push({ severity: 'error', message: `Duplicate alias "${c.alias}" — aliases must be unique.` });
        seen.add(c.alias.toUpperCase());
    } });
    state.filters.forEach((f, idx) => { if (!['IS NULL', 'IS NOT NULL'].includes(f.operator) && f.value.trim() === '')
        issues.push({ severity: 'error', message: `Filter #${idx + 1} on ${f.table}.${f.column} needs a value.` }); if (f.operator === 'BETWEEN' && !(f.value2 ?? '').trim())
        issues.push({ severity: 'error', message: `Filter #${idx + 1} on ${f.table}.${f.column} (BETWEEN) needs a second value.` }); });
    issues.push(...validateAdvancedConsistency(state));
    return issues;
}
export function validateCrState(state) {
    const issues = [];
    if (!state.table)
        issues.push({ severity: 'error', message: 'Select a table for this Change Request.' });
    if (state.queryType !== 'DELETE' && state.values.length === 0)
        issues.push({ severity: 'error', message: 'Add at least one column/value pair.' });
    if ((state.queryType === 'UPDATE' || state.queryType === 'DELETE') && state.filters.length === 0 && !state.confirmNoWhere)
        issues.push({ severity: 'error', message: 'A WHERE condition is required — add a filter or explicitly confirm no WHERE condition.' });
    return issues;
}
export function validateFullReadOnly(state) { const issues = [...validateReadOnlyState(state), ...validateReadOnlySql(state.generatedSql).issues, ...validateSqlStructure(state.generatedSql)]; return { valid: issues.filter((i) => i.severity === 'error').length === 0, issues }; }
//# sourceMappingURL=validationEngine.js.map