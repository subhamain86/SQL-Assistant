import { deriveFkRelationships, isResolvableRelationship } from './joinGraph.js';
const GENERIC = new Set(['header', 'line', 'lines', 'history', 'data', 'table', 'master', 'detail', 'details', 'app', 'info', 'record', 'records']);
const EXTRA_TABLE_SYNONYMS = {
    INVOICE_HEADER: ['invoice', 'invoices', 'bill', 'bills'], INVOICE_LINE: ['invoice line', 'invoice lines', 'invoice line items'],
    PO_HEADER: ['purchase order', 'purchase orders', 'po', 'pos'], PO_LINE: ['po line', 'po lines', 'purchase order line', 'purchase order lines'],
    VENDOR: ['vendor', 'vendors', 'supplier', 'suppliers'], ORGANIZATION: ['organization', 'organizations', 'organisation', 'organisations', 'org', 'orgs'],
    GL_ACCOUNT: ['gl account', 'gl accounts', 'account', 'accounts', 'ledger account'], APP_USER: ['user', 'users', 'employee', 'employees', 'approver', 'approvers', 'buyer', 'buyers'],
    APPROVAL_HISTORY: ['approval', 'approvals', 'approval history']
};
export function normalizeWords(s) { return String(s ?? '').toLowerCase().replace(/_/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
export function wordTokens(s) { return normalizeWords(s).split(' ').filter((t) => t.length > 1); }
export function isNumericType(t) { return /NUMBER|NUMERIC|INT|DEC|FLOAT|DOUBLE|REAL|MONEY/i.test(t || ''); }
export function isDateType(t) { return /DATE|TIME/i.test(t || ''); }
export function isStringType(t) { return /CHAR|TEXT|CLOB|STRING|FLAG/i.test(t || '') || (!isNumericType(t) && !isDateType(t)); }
function fnv1a(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
} return h.toString(16).padStart(8, '0'); }
export function schemaFingerprint(schema) {
    const canon = JSON.stringify({ id: schema.id, t: schema.tables.map((t) => [t.name, t.module, t.description, t.objectType || 'TABLE', t.columns.map((c) => [c.name, c.label, c.type, c.description, !!c.isPrimaryKey, !!c.isForeignKey, c.references?.table || '', c.references?.column || '', (c.decode || []).map((d) => `${d.rawValue}=${d.label}`).join('|')])]), r: schema.relationships.map((r) => [r.fromTable, r.fromColumn, r.toTable, r.toColumn]) });
    return `${fnv1a(canon)}-${canon.length.toString(36)}`;
}
function singular(w) { return w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w; }
function plural(w) { return w.endsWith('y') ? `${w.slice(0, -1)}ies` : w.endsWith('s') ? w : `${w}s`; }
const PHRASE_STOP = new Set(['for', 'to', 'by', 'of', 'in', 'on', 'at', 'and', 'or', 'the', 'with', 'from', 'per', 'all', 'any', 'is', 'as', 'if', 'it', 'no', 'not', 'type', 'value', 'values', 'data', 'info']);
/** Module prefixes such as IA_, PP_, ADM_ (a short first word shared by several tables or equal to the module). */
export function detectTablePrefixes(tables) {
    const counts = new Map();
    tables.forEach((t) => { const w = normalizeWords(t.name).split(' '); if (w.length > 1 && w[0].length <= 4)
        counts.set(w[0], (counts.get(w[0]) || 0) + 1); });
    const out = new Set();
    counts.forEach((n, w) => { if (n >= 3 || tables.some((t) => normalizeWords(t.module) === w))
        out.add(w); });
    return out;
}
function buildTableEntry(t, prefixes = new Set()) {
    const spaced = normalizeWords(t.name);
    const allWords = spaced.split(' ');
    const words = allWords.length > 1 && prefixes.has(allWords[0]) ? allWords.slice(1) : allWords;
    const phrases = new Set([spaced, singular(spaced), plural(spaced)]);
    if (words !== allWords) {
        const unp = words.join(' ');
        phrases.add(unp);
        phrases.add(singular(unp));
        phrases.add(plural(unp));
    }
    const meaningful = words.filter((w) => !GENERIC.has(w));
    if (meaningful.length && meaningful.length < words.length) {
        const core = meaningful.join(' ');
        phrases.add(core);
        phrases.add(plural(core));
        phrases.add(singular(core));
    }
    (EXTRA_TABLE_SYNONYMS[t.name.toUpperCase()] || []).forEach((p) => phrases.add(p));
    const tokens = new Set([...wordTokens(t.name), ...wordTokens(t.description), ...wordTokens(t.module)]);
    const pk = t.columns.find((c) => c.isPrimaryKey) || null;
    const displayColumn = t.columns.find((c) => /(^|_)(NAME|FULL_NAME|TITLE)$/i.test(c.name)) || t.columns.find((c) => /name/i.test(c.label || '') && isStringType(c.type)) || t.columns.find((c) => !c.isPrimaryKey && !c.isForeignKey && isStringType(c.type) && !c.decode?.length) || null;
    const nameColumn = t.columns.find((c) => /(^|_)(NAME|FULL_NAME|TITLE)$/i.test(c.name)) || null;
    const core = (meaningful.length ? meaningful : words).join('_').toUpperCase();
    return { table: t, phrases: Array.from(phrases).filter((p) => p.length > 1), tokens, displayColumn, nameColumn, pk, core };
}
function buildColumnEntry(table, c, prefixes = new Set()) {
    const nameSpaced = normalizeWords(c.name);
    const label = normalizeWords(c.label || c.name);
    const phrases = new Set([nameSpaced, label]);
    const tableWords = new Set(wordTokens(table).filter((w) => !prefixes.has(w)));
    const stripped = nameSpaced.split(' ').filter((w) => !tableWords.has(w)).join(' ');
    if (stripped && stripped !== nameSpaced && stripped.length > 2 && !PHRASE_STOP.has(stripped))
        phrases.add(stripped);
    Array.from(phrases).forEach((p) => { const parts = p.split(' '); const last = parts.pop() || ''; if (last.length > 2 && !/^(id|no)$/.test(last))
        phrases.add([...parts, plural(last)].join(' ')); });
    return { table, column: c, phrases: Array.from(phrases).filter((p) => p.length > 1), tokens: new Set([...wordTokens(c.name), ...wordTokens(c.label || ''), ...wordTokens(c.description || '')]) };
}
const cache = new Map();
export function invalidateSchemaContext() { cache.clear(); }
export function getSchemaContext(schema) {
    const fp = schemaFingerprint(schema);
    const hit = cache.get(schema.id);
    if (hit && hit.fingerprint === fp)
        return hit;
    const prefixes = detectTablePrefixes(schema.tables);
    const tables = schema.tables.map((t) => buildTableEntry(t, prefixes));
    const columns = schema.tables.flatMap((t) => t.columns.map((c) => buildColumnEntry(t.name, c, prefixes)));
    const tableUpper = new Map(tables.map((e) => [e.table.name.toUpperCase(), e]));
    const adjacency = new Map();
    const link = (a, b) => { if (!adjacency.has(a))
        adjacency.set(a, new Set()); adjacency.get(a).add(b); };
    [...schema.relationships.filter((r) => isResolvableRelationship(schema, r)), ...deriveFkRelationships(schema)].forEach((r) => { if (tableUpper.has(r.fromTable.toUpperCase()) && tableUpper.has(r.toTable.toUpperCase())) {
        link(r.fromTable, r.toTable);
        link(r.toTable, r.fromTable);
    } });
    const ctx = { fingerprint: fp, schemaId: schema.id, schemaName: schema.name, tables, columns, tableUpper, adjacency };
    cache.set(schema.id, ctx);
    return ctx;
}
export function relationshipDistance(ctx, a, b) {
    if (a === b)
        return 0;
    const seen = new Set([a]);
    let frontier = [a];
    let depth = 0;
    while (frontier.length && depth < 6) {
        depth += 1;
        const next = [];
        for (const n of frontier)
            for (const m of ctx.adjacency.get(n) || []) {
                if (m === b)
                    return depth;
                if (!seen.has(m)) {
                    seen.add(m);
                    next.push(m);
                }
            }
        frontier = next;
    }
    return Infinity;
}
export function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export function softNormalize(text) { return text.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim(); }
export function findPhrase(soft, phrase) {
    if (!phrase)
        return [];
    const re = new RegExp(`(^|[^a-z0-9])(${escapeRe(phrase).replace(/ /g, '\\s+')})(?=[^a-z0-9]|$)`, 'g');
    const out = [];
    let m;
    while ((m = re.exec(soft))) {
        const start = m.index + m[1].length;
        out.push({ start, end: start + m[2].length });
        if (re.lastIndex === m.index)
            re.lastIndex += 1;
    }
    return out;
}
//# sourceMappingURL=schemaContext.js.map