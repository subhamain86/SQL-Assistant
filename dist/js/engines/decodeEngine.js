import { safeTrim } from '../utils/validation.js';
export function validateDecodeEntries(entries) { const issues = []; const seen = new Set(); entries.forEach((e) => { const raw = safeTrim(e?.rawValue); if (!raw) {
    issues.push('Every decode entry needs a raw value.');
    return;
} if (seen.has(raw))
    issues.push(`Duplicate decode raw value "${raw}".`); seen.add(raw); }); return issues; }
export function decodeLegend(column) { if (!column.decode || !column.decode.length)
    return ''; return column.decode.map((d) => `${safeTrim(d.rawValue)}=${safeTrim(d.label)}`).join(', '); }
function quoteLiteral(v) { return `'${v.replace(/'/g, "''")}'`; }
export function buildSchemaDecodeExpression(sourceExpr, column, alias, dialect) {
    const entries = column.decode || [];
    if (!entries.length)
        return sourceExpr;
    if (dialect === 'Oracle')
        return `DECODE(${sourceExpr}, ${entries.map((e) => `${quoteLiteral(safeTrim(e.rawValue))}, ${quoteLiteral(safeTrim(e.label))}`).join(', ')}, ${sourceExpr}) AS ${alias}`;
    return `CASE ${entries.map((e) => `WHEN ${sourceExpr} = ${quoteLiteral(safeTrim(e.rawValue))} THEN ${quoteLiteral(safeTrim(e.label))}`).join(' ')} ELSE ${sourceExpr} END AS ${alias}`;
}
export function buildManualCaseExpression(whens, elseValue, alias) { const e = elseValue.trim() ? ` ELSE ${quoteLiteral(elseValue)}` : ''; return `CASE ${whens.map((w) => `WHEN ${w.whenExpr} THEN ${quoteLiteral(w.thenValue)}`).join(' ')}${e} END AS ${alias}`; }
export function buildManualDecodeExpression(source, pairs, elseValue, alias, dialect) {
    if (dialect === 'Oracle') {
        const e = elseValue.trim() ? `, ${quoteLiteral(elseValue)}` : '';
        return `DECODE(${source}, ${pairs.map((p) => `${quoteLiteral(p.rawValue)}, ${quoteLiteral(p.label)}`).join(', ')}${e}) AS ${alias}`;
    }
    const e = elseValue.trim() ? ` ELSE ${quoteLiteral(elseValue)}` : '';
    return `CASE ${pairs.map((p) => `WHEN ${source} = ${quoteLiteral(p.rawValue)} THEN ${quoteLiteral(p.label)}`).join(' ')}${e} END AS ${alias}`;
}
//# sourceMappingURL=decodeEngine.js.map