import { makeId } from '../utils/id.js';
function detectIntent(text) { const l = text.toLowerCase(); if (/\b(update|change|set|mark)\b/.test(l))
    return 'UPDATE'; if (/\b(insert|add|create)\b/.test(l))
    return 'INSERT'; if (/\b(delete|remove)\b/.test(l))
    return 'DELETE'; return null; }
function findTargetTable(text, schema) {
    const upper = text.toUpperCase();
    const ALIASES = { INVOICE: 'INVOICE_HEADER', 'PURCHASE ORDER': 'PO_HEADER', PO: 'PO_HEADER', VENDOR: 'VENDOR', SUPPLIER: 'VENDOR' };
    for (const t of schema.tables)
        if (upper.includes(t.name) || upper.includes(t.name.replace(/_/g, ' ')))
            return t;
    for (const [alias, name] of Object.entries(ALIASES))
        if (new RegExp(`\\b${alias}\\b`).test(upper)) {
            const t = schema.tables.find((x) => x.name === name);
            if (t)
                return t;
        }
    return null;
}
function extractValueAssignment(text, table) {
    const values = [];
    const lower = text.toLowerCase();
    for (const col of table.columns) {
        if (col.decode)
            for (const d of col.decode)
                if (new RegExp(`\\b${d.label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) {
                    values.push({ id: makeId('crv'), column: col.name, value: d.rawValue });
                    return values;
                }
        const cp = col.name.toLowerCase().replace(/_/g, ' ');
        const lp = (col.label || col.name).toLowerCase();
        const idx = lower.indexOf(cp) !== -1 ? lower.indexOf(cp) : lower.indexOf(lp);
        if (idx !== -1) {
            const m = text.slice(idx).match(/\bto\s+([A-Za-z0-9_.\-]+)/i);
            if (m)
                values.push({ id: makeId('crv'), column: col.name, value: m[1] });
        }
    }
    return values;
}
function extractWhereCondition(text, table) { const pk = table.columns.find((c) => c.isPrimaryKey); const m = text.match(/\b(?:for|where|id|number)\b\D*?(\d+)/i) || text.match(/#\s*(\d+)/) || text.match(/\b[A-Za-z_]+\s+(\d{1,18})\b/); return pk && m ? [{ id: makeId('filt'), table: table.name, column: pk.name, operator: '=', combinator: 'AND', value: m[1] }] : []; }
export function parseCrRequirement(rawText, schema) {
    const notes = [];
    const text = rawText.trim();
    if (!text)
        return { rawText, queryType: null, matchedTable: null, values: [], filters: [], notes: ['No requirement text was provided.'], confidence: 0 };
    const queryType = detectIntent(text);
    if (!queryType)
        return { rawText, queryType: null, matchedTable: null, values: [], filters: [], notes: ['Could not determine whether this is an INSERT, UPDATE, or DELETE. Try starting with "Update...", "Insert...", or "Delete...".'], confidence: 0.1 };
    notes.push(`Detected intent: ${queryType}.`);
    const table = findTargetTable(text, schema);
    if (!table) {
        notes.push('Could not identify a target table from the active schema.');
        return { rawText, queryType, matchedTable: null, values: [], filters: [], notes, confidence: 0.2 };
    }
    notes.push(`Target table: ${table.name}.`);
    const values = queryType === 'DELETE' ? [] : extractValueAssignment(text, table);
    if (values.length)
        notes.push(`Detected ${values.length} column/value assignment(s).`);
    const filters = extractWhereCondition(text, table);
    if (filters.length)
        notes.push(`Detected a WHERE condition on ${filters[0].table}.${filters[0].column}.`);
    else
        notes.push('No WHERE condition detected — you must add one manually before this can be saved (mandatory for UPDATE/DELETE).');
    return { rawText, queryType, matchedTable: table.name, values, filters, notes, confidence: Math.min(1, 0.3 + (values.length ? 0.3 : 0) + (filters.length ? 0.3 : 0)) };
}
//# sourceMappingURL=crNlpEngine.js.map