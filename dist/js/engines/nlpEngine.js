import { makeId } from '../utils/id.js';
function allColumns(schema) { return schema.tables.flatMap((t) => t.columns.map((c) => ({ table: t.name, column: c }))); }
const TABLE_SYNONYMS = { INVOICE: 'INVOICE_HEADER', INVOICES: 'INVOICE_HEADER', BILL: 'INVOICE_HEADER', BILLS: 'INVOICE_HEADER', 'PURCHASE ORDER': 'PO_HEADER', 'PURCHASE ORDERS': 'PO_HEADER', PO: 'PO_HEADER', POS: 'PO_HEADER', VENDOR: 'VENDOR', VENDORS: 'VENDOR', SUPPLIER: 'VENDOR', SUPPLIERS: 'VENDOR', ORGANIZATION: 'ORGANIZATION', ORGANIZATIONS: 'ORGANIZATION', ORG: 'ORGANIZATION', 'GL ACCOUNT': 'GL_ACCOUNT', ACCOUNT: 'GL_ACCOUNT', ACCOUNTS: 'GL_ACCOUNT', LEDGER: 'GL_ACCOUNT', USER: 'APP_USER', USERS: 'APP_USER', EMPLOYEE: 'APP_USER', EMPLOYEES: 'APP_USER', APPROVAL: 'APPROVAL_HISTORY', APPROVALS: 'APPROVAL_HISTORY' };
const STOPWORDS = new Set(['the', 'a', 'an', 'show', 'me', 'all', 'get', 'find', 'list', 'with', 'and', 'or', 'for', 'of', 'in', 'on', 'to', 'from', 'that', 'this', 'is', 'are', 'was', 'were', 'by', 'who', 'which', 'each']);
function tokenize(text) { return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 2 && !STOPWORDS.has(t)); }
function descriptionOverlapScore(phraseTokens, candidateText) { const ct = new Set(tokenize(candidateText)); if (ct.size === 0)
    return 0; let hits = 0; phraseTokens.forEach((t) => { if (ct.has(t))
    hits += 1; }); return hits; }
function findTableMentions(text, schema) {
    const upper = text.toUpperCase();
    const found = [];
    for (const t of schema.tables) {
        const spaced = t.name.replace(/_/g, ' ');
        const singularish = spaced.replace(/S$/, '');
        if (upper.includes(t.name) || upper.includes(spaced) || upper.includes(singularish))
            found.push(t);
    }
    Object.entries(TABLE_SYNONYMS).forEach(([alias, tableName]) => { if (upper.includes(alias) && schema.tables.some((t) => t.name === tableName) && !found.some((f) => f.name === tableName))
        found.push(schema.tables.find((t) => t.name === tableName)); });
    const phraseTokens = tokenize(text);
    const minScore = found.length === 0 ? 1 : 2;
    const bestNew = schema.tables.filter((t) => !found.some((f) => f.name === t.name)).map((t) => ({ t, score: descriptionOverlapScore(phraseTokens, `${t.name} ${t.module} ${t.description}`) })).filter((s) => s.score >= minScore).sort((a, b) => b.score - a.score)[0];
    if (bestNew)
        found.push(bestNew.t);
    return found;
}
function findColumnMentions(text, tables) {
    const upper = text.toUpperCase();
    const cols = [];
    const pool = tables.length ? tables.flatMap((t) => t.columns.map((c) => ({ table: t.name, column: c }))) : [];
    const SYNONYMS = { NAME: ['SUPPLIER NAME', 'VENDOR NAME'], STATUS: ['STATE'], AMOUNT: ['VALUE', 'TOTAL'] };
    for (const ref of pool) {
        const nameSpaced = ref.column.name.replace(/_/g, ' ');
        const labelUpper = (ref.column.label || ref.column.name).toUpperCase();
        if (upper.includes(ref.column.name) || upper.includes(nameSpaced) || upper.includes(labelUpper)) {
            cols.push(ref);
            continue;
        }
        for (const [canon, syns] of Object.entries(SYNONYMS)) {
            if (nameSpaced.includes(canon) && syns.some((s) => upper.includes(s))) {
                cols.push(ref);
                break;
            }
        }
    }
    if (pool.length > 0) {
        const phraseTokens = tokenize(text);
        const already = new Set(cols.map((c) => `${c.table}::${c.column.name}`));
        pool.filter((ref) => !already.has(`${ref.table}::${ref.column.name}`)).map((ref) => ({ ref, score: descriptionOverlapScore(phraseTokens, `${ref.column.name} ${ref.column.label} ${ref.column.description}`) })).filter((x) => x.score >= (cols.length === 0 ? 1 : 2)).sort((a, b) => b.score - a.score).slice(0, 3).forEach((s) => cols.push(s.ref));
    }
    return cols;
}
const COMPARISON_PHRASES = [
    { pattern: /greater than or equal to|at least|no less than|>=/, operator: '>=' }, { pattern: /less than or equal to|at most|no more than|<=/, operator: '<=' },
    { pattern: /greater than|more than|above|over|exceed(?:s|ing)?/, operator: '>' }, { pattern: /less than|below|under/, operator: '<' },
    { pattern: /not equal to|different from|<>/, operator: '<>' }, { pattern: /equal to|equals|is exactly|=/, operator: '=' }
];
function extractNumericFilters(text, columns, combinator) {
    const filters = [];
    const numericCols = columns.filter((c) => c.column.type === 'NUMBER');
    const lower = text.toLowerCase();
    numericCols.forEach((ref) => {
        const variants = [ref.column.name.toLowerCase(), (ref.column.label || '').toLowerCase(), ref.column.name.replace(/_/g, ' ').toLowerCase()].filter(Boolean);
        for (const variant of variants) {
            const idx = lower.indexOf(variant);
            if (idx === -1)
                continue;
            const w = lower.slice(idx, idx + 90);
            for (const cmp of COMPARISON_PHRASES) {
                const m = w.match(cmp.pattern);
                if (m) {
                    const after = w.slice(m.index || 0);
                    const num = after.match(/-?\d[\d,]*(\.\d+)?/);
                    if (num) {
                        filters.push({ id: makeId('filt'), table: ref.table, column: ref.column.name, operator: cmp.operator, combinator, value: num[0].replace(/,/g, '') });
                        break;
                    }
                }
            }
            break;
        }
    });
    return filters;
}
function extractDateFilterCandidates(text, tables) {
    const lower = text.toLowerCase();
    const dateCols = tables.flatMap((t) => t.columns.filter((c) => c.type === 'DATE').map((c) => ({ table: t.name, column: c })));
    if (dateCols.length === 0)
        return null;
    let clause = null;
    const lastN = lower.match(/last\s+(\d+)\s*(day|days|week|weeks|month|months|year|years)/);
    if (lastN) {
        const unit = lastN[2].startsWith('day') ? 'DAY' : lastN[2].startsWith('week') ? 'WEEK' : lastN[2].startsWith('month') ? 'MONTH' : 'YEAR';
        clause = { op: '>=', value: `CURRENT_DATE - INTERVAL '${parseInt(lastN[1], 10)} ${unit}'` };
    }
    else if (/\btoday\b/.test(lower))
        clause = { op: '=', value: 'CURRENT_DATE' };
    else if (/\byesterday\b/.test(lower))
        clause = { op: '=', value: "CURRENT_DATE - INTERVAL '1 DAY'" };
    else if (/\bthis\s+week\b/.test(lower))
        clause = { op: '>=', value: "DATE_TRUNC('WEEK', CURRENT_DATE)" };
    else if (/\bthis\s+month\b/.test(lower))
        clause = { op: '>=', value: "DATE_TRUNC('MONTH', CURRENT_DATE)" };
    else if (/\bthis\s+year\b/.test(lower))
        clause = { op: '>=', value: "DATE_TRUNC('YEAR', CURRENT_DATE)" };
    else if (/\blast\s+week\b/.test(lower))
        clause = { op: '>=', value: "DATE_TRUNC('WEEK', CURRENT_DATE) - INTERVAL '1 WEEK'" };
    else if (/\blast\s+month\b/.test(lower))
        clause = { op: '>=', value: "DATE_TRUNC('MONTH', CURRENT_DATE) - INTERVAL '1 MONTH'" };
    else if (/\blast\s+year\b/.test(lower))
        clause = { op: '>=', value: "DATE_TRUNC('YEAR', CURRENT_DATE) - INTERVAL '1 YEAR'" };
    if (!clause)
        return null;
    const preferred = dateCols.find((d) => /invoice_date|created/i.test(d.column.name)) || dateCols[0];
    return { filter: { id: makeId('filt'), table: preferred.table, column: preferred.column.name, operator: clause.op, combinator: 'AND', value: clause.value }, alternativeColumns: dateCols.filter((d) => d !== preferred) };
}
function extractDecodeFilters(text, tables) {
    const upper = text.toUpperCase();
    const filters = [];
    tables.flatMap((t) => t.columns.filter((c) => c.decode && c.decode.length > 0).map((c) => ({ table: t.name, column: c }))).forEach((ref) => { ref.column.decode.forEach((d) => { if (d.label && upper.includes(d.label.toUpperCase()))
        filters.push({ id: makeId('filt'), table: ref.table, column: ref.column.name, operator: '=', combinator: 'AND', value: d.rawValue }); }); });
    return filters;
}
function detectCombinator(text) { return /\bor\b/i.test(text) && !/\band\b/i.test(text) ? 'OR' : 'AND'; }
function extractLimit(text) { const m = text.match(/\b(?:top|first|limit)\s+(\d+)/i); return m ? parseInt(m[1], 10) : null; }
function extractDistinct(text) { return /\bdistinct\b|\bunique\b/i.test(text); }
function extractSorts(text, tables) {
    const m = text.match(/sort(?:ed)?\s+by\s+([a-z0-9_ ]+?)(?:\s+(ascending|asc|descending|desc))?(?:[.,]|$)/i);
    if (!m)
        return [];
    const phrase = m[1].trim().toLowerCase();
    const direction = /desc/i.test(m[2] || '') ? 'DESC' : 'ASC';
    for (const t of tables)
        for (const c of t.columns)
            if (phrase.includes(c.name.toLowerCase()) || (c.label && phrase.includes(c.label.toLowerCase())))
                return [{ id: makeId('sort'), table: t.name, column: c.name, direction }];
    return [];
}
function findUnresolvedTerms(text, schema) {
    const unresolved = [];
    const candidateTerms = text.match(/\b[a-z][a-z0-9]*(?:[_ ][a-z0-9]+){1,3}\b/gi) || [];
    const knownColumnTokens = new Set(allColumns(schema).map((c) => c.column.name.toLowerCase().replace(/_/g, ' ')));
    const knownTableTokens = new Set(schema.tables.map((t) => t.name.toLowerCase().replace(/_/g, ' ')));
    candidateTerms.forEach((term) => { const norm = term.toLowerCase().trim(); if (norm.length < 6)
        return; const looks = /_/.test(term) || norm.split(' ').length >= 2; if (!looks)
        return; const known = knownColumnTokens.has(norm) || knownTableTokens.has(norm) || Array.from(knownColumnTokens).some((k) => k.includes(norm) || norm.includes(k)); if (!known && /status|date|amount|name|code|flag|id/i.test(norm))
        unresolved.push(term); });
    return Array.from(new Set(unresolved)).slice(0, 3);
}
export function parseRequirement(rawText, schema) {
    const notes = [];
    const queryPlan = [];
    const clarifications = [];
    const text = rawText.trim();
    if (!text)
        return { rawText, matchedTables: [], matchedColumns: [], matchedFilters: [], matchedSorts: [], limit: null, distinct: false, confidence: 0, notes: ['No requirement text was provided — using manual selections only.'], queryPlan: [], clarifications: [], unresolvedTerms: [] };
    const tables = findTableMentions(text, schema);
    if (tables.length === 0) {
        notes.push('Could not confidently identify any table from the active schema — try mentioning a table or business term explicitly.');
        return { rawText, matchedTables: [], matchedColumns: [], matchedFilters: [], matchedSorts: [], limit: null, distinct: false, confidence: 0.1, notes, queryPlan, clarifications, unresolvedTerms: findUnresolvedTerms(text, schema) };
    }
    queryPlan.push(`Identified table(s): ${tables.map((t) => t.name).join(', ')}.`);
    const columnRefs = findColumnMentions(text, tables);
    const matchedColumns = columnRefs.map((ref) => ({ id: makeId('col'), table: ref.table, column: ref.column.name, alias: '', useDecode: false, aggregate: null, displayMode: 'raw' }));
    if (matchedColumns.length)
        queryPlan.push(`Identified column(s): ${columnRefs.map((c) => `${c.table}.${c.column.name}`).join(', ')}.`);
    const combinator = detectCombinator(text);
    const matchedFilters = [...extractDecodeFilters(text, tables), ...extractNumericFilters(text, columnRefs, combinator)];
    const dateResult = extractDateFilterCandidates(text, tables);
    if (dateResult) {
        matchedFilters.push(dateResult.filter);
        queryPlan.push(`Applied a relative date filter on ${dateResult.filter.table}.${dateResult.filter.column}.`);
        if (dateResult.alternativeColumns.length)
            clarifications.push({ question: `Multiple date columns exist on ${tables[0].name} — did you mean a different one?`, options: dateResult.alternativeColumns.map((c) => `${c.table}.${c.column.name}`) });
    }
    if (matchedFilters.length)
        queryPlan.push(`Built ${matchedFilters.length} filter(s).`);
    const matchedSorts = extractSorts(text, tables);
    const limit = extractLimit(text);
    const distinct = extractDistinct(text);
    const unresolvedTerms = findUnresolvedTerms(text, schema);
    const confidence = Math.min(1, 0.3 + (matchedColumns.length ? 0.2 : 0) + (matchedFilters.length ? 0.25 : 0) + (tables.length ? 0.25 : 0));
    return { rawText, matchedTables: tables.map((t) => t.name), matchedColumns, matchedFilters, matchedSorts, limit, distinct, confidence, notes, queryPlan, clarifications, unresolvedTerms };
}
export function filterToKnownTables(names, schema) { const s = new Set(schema.tables.map((t) => t.name)); return { known: names.filter((n) => s.has(n)), unknown: names.filter((n) => !s.has(n)) }; }
export function filterToKnownColumns(pairs, schema) { const known = []; const unknown = []; pairs.forEach((p) => { const t = schema.tables.find((x) => x.name === p.table); if (t?.columns.some((c) => c.name === p.column))
    known.push(p);
else
    unknown.push(p); }); return { known, unknown }; }
//# sourceMappingURL=nlpEngine.js.map