import { parseRequirement } from '../../engines/nlpEngine.js';
import { makeId } from '../../utils/id.js';
import { getSchemaContext, softNormalize, findPhrase, isNumericType, isDateType, isStringType, relationshipDistance, wordTokens } from './schemaContext.js';
import { agoExpr, startOfExpr, todayExpr, nextDayExpr, dateLiteral, parseDateToken, monthIndex, monthRange, monthBucketExpr, yearBucketExpr, DATE_TOKEN_RE } from './dateExpressions.js';
import { countryNameToIso2 } from './countryCodes.js';
export const NLU_ENGINE_VERSION = 'offline-nlu-17.2';
export const AUTO_APPLY_THRESHOLD = 0.6;
const STOP_AFTER = '(?:and|or|with|where|for|in|during|since|from|order|ordered|sorted|sort|having|top|limit|last|this|between|over|above|greater|more|less|below|under|which|that|by|per|whose|of|on|before|after|until|grouped|group|including|excluding|showing|show|plus|then|created|dated|posted|due)';
const NEGATORS = /(?:\bnot|\bnon|\bexcluding|\bexcept|\bother than|\bwithout|\bisn't|\baren't|\bnot in)\s*$/;
const COMPARATORS = [
    { re: /^(?:is\s+)?(?:greater than or equal to|at least|no less than|>=|minimum of)/, op: '>=' },
    { re: /^(?:is\s+)?(?:less than or equal to|at most|no more than|<=|maximum of|up to)/, op: '<=' },
    { re: /^(?:is\s+)?(?:greater than|more than|above|over|exceed(?:s|ing)?|higher than|>)/, op: '>' },
    { re: /^(?:is\s+)?(?:less than|below|under|lower than|fewer than|<)/, op: '<' },
    { re: /^(?:is\s+)?(?:not equal to|different from|other than|<>|!=)/, op: '<>' },
    { re: /^(?:is\s+)?(?:equal to|equals|is exactly|exactly|=|is|of)/, op: '=' }
];
const NUM = String.raw `-?\d[\d,]*(?:\.\d+)?(?:\s*(?:k|m|million|thousand))?`;
function overlaps(a, b) { return a.start < b.end && b.start < a.end; }
function parseNumber(raw) { const s = raw.replace(/,/g, '').trim().toLowerCase(); const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(k|thousand|m|million)?$/); if (!m)
    return s; const n = parseFloat(m[1]) * (m[2] === 'k' || m[2] === 'thousand' ? 1000 : m[2] === 'm' || m[2] === 'million' ? 1000000 : 1); return String(Number.isInteger(n) ? n : +n.toFixed(6)); }
function aliasFor(prefix, column) { const a = `${prefix}_${column}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_'); return a.length > 30 ? a.slice(0, 30) : a; }
function q(table, column) { return `${table}.${column}`; }
function detectMentions(soft, ctx) {
    const cands = [];
    ctx.tables.forEach((entry) => entry.phrases.forEach((p) => findPhrase(soft, p).forEach((span) => cands.push({ kind: 't', entry, span }))));
    ctx.columns.forEach((entry) => entry.phrases.forEach((p) => { if (p.length < 2 || /^(id|no|name|code)$/.test(p))
        return; findPhrase(soft, p).forEach((span) => cands.push({ kind: 'c', entry, span })); }));
    // Longest phrase wins; on equal length an entity (table) beats a same-named column (e.g. "invoices" → IA_INVOICE, not PP_RE_APPROVAL_SETTING.INVOICES).
    cands.sort((a, b) => (b.span.end - b.span.start) - (a.span.end - a.span.start) || (a.kind === b.kind ? 0 : a.kind === 't' ? -1 : 1));
    const accepted = [];
    for (const c of cands) {
        const clash = accepted.find((a) => overlaps(a.span, c.span));
        if (!clash) {
            accepted.push(c);
            continue;
        }
        if (c.kind === 'c' && clash.kind === 'c' && clash.span.start === c.span.start && clash.span.end === c.span.end)
            accepted.push(c);
    }
    return {
        tables: accepted.filter((a) => a.kind === 't').map((a) => ({ entry: a.entry, span: a.span })),
        columns: accepted.filter((a) => a.kind === 'c').map((a) => ({ entry: a.entry, span: a.span }))
    };
}
export function runOfflineNlu(rawText, schema, opts) {
    const ctx = getSchemaContext(schema);
    const base = parseRequirement(rawText, schema);
    const empty = (extra) => ({ ...base, groupBy: [], having: '', aggregateMode: false, autoOptions: [], schemaGaps: [], learnedPatternIds: [], schemaFingerprint: ctx.fingerprint, schemaId: schema.id, engine: 'v17-offline-nlu', ...extra });
    const text = rawText.trim();
    if (!text)
        return empty({});
    const dialect = opts.dialect;
    const soft = softNormalize(text);
    const auto = [];
    const notes = [];
    const plan = [];
    const clarifications = [];
    const dateLogic = [];
    const add = (kind, description, confidence) => { auto.push({ kind, description, confidence, applied: confidence >= AUTO_APPLY_THRESHOLD }); return confidence >= AUTO_APPLY_THRESHOLD; };
    const knownIds = new Set([...schema.tables.map((t) => t.name.toUpperCase()), ...schema.tables.flatMap((t) => t.columns.map((c) => c.name.toUpperCase()))]);
    const unknownIdentifiers = (text.match(/\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/g) || []).filter((id) => !knownIds.has(id.toUpperCase()));
    let maskedSoft = soft;
    unknownIdentifiers.forEach((id) => { const p = softNormalize(id); maskedSoft = maskedSoft.split(p).join(' '.repeat(p.length)); });
    const mentions = detectMentions(maskedSoft, ctx);
    // "root document type is Invoice": a word that is a decode label of the column just mentioned is a value, not a table.
    mentions.tables = mentions.tables.filter((t) => { const word = soft.slice(t.span.start, t.span.end); return !mentions.columns.some((h) => h.span.end <= t.span.start && t.span.start - h.span.end <= 14 && (h.entry.column.decode || []).some((d) => { const l = softNormalize(d.label || ''); return l === word || `${l}s` === word; })); });
    const tableOrder = [];
    const pushTable = (name, pos) => { const ex = tableOrder.find((t) => t.name === name); if (!ex)
        tableOrder.push({ name, pos });
    else if (pos < ex.pos)
        ex.pos = pos; };
    mentions.tables.forEach((h) => pushTable(h.entry.table.name, h.span.start));
    const explicitColumnHits = mentions.columns;
    const isView = (table) => ctx.tableUpper.get(table.toUpperCase())?.table.objectType === 'VIEW';
    explicitColumnHits.forEach((h) => {
        if (!(h.span.end - h.span.start > 4 && /\s/.test(soft.slice(h.span.start, h.span.end))))
            return;
        let same = explicitColumnHits.filter((o) => o.span.start === h.span.start && o.span.end === h.span.end);
        if (same.length > 1) {
            const nv = same.filter((o) => !isView(o.entry.table));
            if (nv.length)
                same = nv;
        }
        if (same.length > 1) {
            const words = soft.slice(h.span.start, h.span.end);
            const owned = same.filter((o) => ctx.tableUpper.get(o.entry.table.toUpperCase())?.phrases.some((p) => findPhrase(words, p).length > 0));
            if (owned.length === 1)
                same = owned;
        }
        if (same.length === 1 && same[0] === h)
            pushTable(h.entry.table, h.span.start);
    });
    if (tableOrder.length === 0)
        base.matchedTables.forEach((t, i) => pushTable(t, 10000 + i));
    tableOrder.sort((a, b) => a.pos - b.pos);
    let tables = tableOrder.map((t) => t.name).filter((t) => ctx.tableUpper.has(t.toUpperCase()));
    const primary = () => tables[0];
    const inScope = (t) => tables.includes(t);
    const ensureTable = (t, why) => { if (!inScope(t) && ctx.tableUpper.has(t.toUpperCase())) {
        tables.push(t);
        add('table', `Added ${t} (${why}).`, 0.8);
    } };
    const pickColumn = (cands, phraseText) => {
        if (!cands.length)
            return null;
        const scoped = cands.filter((c) => inScope(c.table));
        const nonView = (l) => { const t = l.filter((c) => !isView(c.table)); return t.length ? t : l; };
        const pool = nonView(scoped.length ? scoped : cands);
        const words = new Set(wordTokens(phraseText));
        const owner = pool.find((c) => wordTokens(c.table).some((w) => words.has(w)) && c.column.isPrimaryKey);
        if (owner)
            return owner;
        return pool.find((c) => c.table === primary()) || pool[0];
    };
    const resolvedHits = [];
    const seenSpan = new Set();
    explicitColumnHits.forEach((h) => {
        const key = `${h.span.start}:${h.span.end}`;
        if (seenSpan.has(key))
            return;
        seenSpan.add(key);
        const same = explicitColumnHits.filter((o) => o.span.start === h.span.start && o.span.end === h.span.end).map((o) => o.entry);
        const best = pickColumn(same, soft.slice(h.span.start, h.span.end));
        const word = soft.slice(h.span.start, h.span.end);
        if (best && !inScope(best.table) && !/\s/.test(word) && ctx.columns.some((c) => inScope(c.table) && c.column.decode?.some((d) => softNormalize(d.label || '') === word)))
            return;
        if (best && (inScope(best.table) || (same.length === 1 && (/\s/.test(word) || !tableOrder.length)))) {
            ensureTable(best.table, `column ${best.column.name} was mentioned`);
            resolvedHits.push({ entry: best, span: h.span });
        }
    });
    const colEntry = (table, column) => ctx.columns.find((c) => c.table === table && c.column.name === column) || null;
    const findColumnByWords = (words, predicate, allowOutOfScope = false) => {
        const w = softNormalize(words).replace(/[^a-z0-9 ]/g, ' ').trim();
        if (!w)
            return null;
        const cands = ctx.columns.filter((c) => predicate(c.column) && (allowOutOfScope || inScope(c.table)) && c.phrases.some((p) => p === w || findPhrase(w, p).length > 0 || findPhrase(p, w).length > 0));
        if (!cands.length)
            return null;
        cands.sort((a, b) => Math.max(...b.phrases.filter((p) => findPhrase(w, p).length).map((p) => p.length), 0) - Math.max(...a.phrases.filter((p) => findPhrase(w, p).length).map((p) => p.length), 0));
        return pickColumn(cands, w);
    };
    const tableByWords = (words) => { const w = softNormalize(words).trim(); return ctx.tables.find((t) => t.phrases.includes(w)) || ctx.tables.find((t) => t.phrases.some((p) => findPhrase(w, p).length > 0)) || null; };
    const filters = [];
    const decodeHits = [];
    ctx.columns.filter((c) => inScope(c.table) && c.column.decode?.length).forEach((entry) => {
        entry.column.decode.forEach((d) => {
            const label = softNormalize(d.label || '');
            if (!label || label.length < 2)
                return;
            const occ = [...findPhrase(soft, label), ...findPhrase(soft, `un${label}`).map((s) => ({ ...s, un: true }))];
            occ.forEach((s) => {
                if (resolvedHits.some((h) => overlaps(h.span, s)) || mentions.tables.some((t) => overlaps(t.span, s) && t.entry.table.name !== entry.table))
                    return;
                const before = soft.slice(Math.max(0, s.start - 14), s.start);
                decodeHits.push({ entry, raw: d.rawValue, label: d.label, neg: !!s.un || NEGATORS.test(before), pos: s.start });
            });
        });
    });
    const decodeByLabelPos = new Map();
    decodeHits.forEach((h) => { const l = decodeByLabelPos.get(h.pos) || []; l.push(h); decodeByLabelPos.set(h.pos, l); });
    const chosenDecode = [];
    decodeByLabelPos.forEach((hits) => {
        if (hits.length === 1) {
            chosenDecode.push(hits[0]);
            return;
        }
        const near = hits.find((h) => resolvedHits.some((r) => r.entry === h.entry && Math.abs(r.span.end - h.pos) < 30));
        chosenDecode.push(near || hits.find((h) => h.entry.table === primary()) || hits[0]);
    });
    const byColumn = new Map();
    chosenDecode.forEach((h) => { const k = q(h.entry.table, h.entry.column.name); const l = byColumn.get(k) || []; if (!l.some((x) => x.raw === h.raw))
        l.push(h); byColumn.set(k, l); });
    byColumn.forEach((hits) => {
        const table = hits[0].entry.table;
        const column = hits[0].entry.column.name;
        const neg = hits.every((h) => h.neg);
        if (hits.length === 1) {
            filters.push({ id: makeId('filt'), table, column, operator: neg ? '<>' : '=', value: hits[0].raw, combinator: 'AND' });
            add('filter', `${q(table, column)} ${neg ? '<>' : '='} '${hits[0].raw}' (${hits[0].label}).`, 0.85);
        }
        else {
            filters.push({ id: makeId('filt'), table, column, operator: neg ? 'NOT IN' : 'IN', value: hits.map((h) => h.raw).join(','), combinator: 'AND' });
            add('filter', `${q(table, column)} ${neg ? 'NOT IN' : 'IN'} (${hits.map((h) => h.label).join(', ')}) — multiple values for one column combined into a list.`, 0.85);
        }
    });
    let aggregateMode = false;
    const aggregates = [];
    const aggPatterns = [
        { agg: 'COUNT', re: /\b(?:count(?:\s+of)?|number of|how many|no\.? of|total number of|total count of)\s+(distinct\s+|unique\s+|different\s+)?([a-z0-9 ]{2,40})/g },
        { agg: 'AVG', re: /\b(?:average|avg|mean)\s+(?:of\s+)?(?:the\s+)?([a-z0-9 ]{2,40})/g },
        { agg: 'SUM', re: /\b(?:total|sum of|sum|aggregate)\s+(?:of\s+)?(?:the\s+)?(?!number\b|count\b)([a-z0-9 ]{2,40})/g },
        { agg: 'MAX', re: /\b(?:max|maximum)\s+(?:of\s+)?(?:the\s+)?([a-z0-9 ]{2,40})/g },
        { agg: 'MIN', re: /\b(?:min|minimum)\s+(?:of\s+)?(?:the\s+)?([a-z0-9 ]{2,40})/g }
    ];
    const takenAggSpans = [];
    aggPatterns.forEach(({ agg, re }) => {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(soft))) {
            const span = { start: m.index, end: m.index + m[0].length };
            if (takenAggSpans.some((s) => overlaps(s, span)))
                continue;
            if (resolvedHits.some((h) => h.span.start <= m.index && m.index < h.span.end && !/^(total|sum|count|number|average|avg|max|min)\b/.test(soft.slice(h.span.start, h.span.end))))
                continue;
            const tail = (agg === 'COUNT' ? m[2] : m[1]) || '';
            const phrase = tail.split(new RegExp(`\\s${STOP_AFTER}\\s|\\s${STOP_AFTER}$`))[0].trim();
            if (agg === 'COUNT') {
                const distinct = !!m[1];
                const col = findColumnByWords(phrase, () => true, true);
                const tbl = tableByWords(phrase);
                if (col && (distinct || !tbl)) {
                    ensureTable(col.table, 'counted column');
                    aggregates.push({ agg, entry: col, distinct, alias: aliasFor(distinct ? 'DISTINCT' : 'COUNT', col.column.name), expr: distinct ? `COUNT(DISTINCT ${q(col.table, col.column.name)})` : `COUNT(${q(col.table, col.column.name)})` });
                }
                else if (tbl) {
                    ensureTable(tbl.table.name, 'counted entity');
                    const pk = tbl.pk || tbl.table.columns[0];
                    const ce = pk ? colEntry(tbl.table.name, pk.name) : null;
                    aggregates.push({ agg, entry: ce, distinct: distinct || tbl.table.name !== primary(), alias: aliasFor(tbl.core, 'COUNT'), expr: ce ? `COUNT(${distinct || tbl.table.name !== primary() ? 'DISTINCT ' : ''}${q(tbl.table.name, ce.column.name)})` : 'COUNT(*)' });
                }
                else {
                    const prev = soft.slice(Math.max(0, m.index - 30), m.index).trim().split(' ').slice(-2).join(' ');
                    const pt = tableByWords(prev) || tableByWords(prev.split(' ').pop() || '') || ctx.tableUpper.get((primary() || '').toUpperCase()) || null;
                    const pk = pt ? (pt.pk || pt.table.columns[0]) : null;
                    if (pt && pk) {
                        ensureTable(pt.table.name, 'counted entity');
                        const ce = colEntry(pt.table.name, pk.name);
                        aggregates.push({ agg, entry: ce, distinct: pt.table.name !== primary(), alias: aliasFor(pt.core, 'COUNT'), expr: `COUNT(${pt.table.name !== primary() ? 'DISTINCT ' : ''}${q(pt.table.name, pk.name)})` });
                    }
                    else
                        aggregates.push({ agg, entry: null, distinct: false, alias: 'RECORD_COUNT', expr: 'COUNT(*)' });
                }
                takenAggSpans.push(span);
                aggregateMode = true;
                continue;
            }
            let col = findColumnByWords(phrase, (c) => isNumericType(c.type) && !c.isPrimaryKey && !c.isForeignKey);
            if (!col && /\b(amount|value|spend|spent|cost|price|sum|total)\b/.test(phrase + ' ' + m[0])) {
                const pt = ctx.tableUpper.get((primary() || '').toUpperCase());
                const guess = pt?.table.columns.find((c) => isNumericType(c.type) && /AMOUNT|TOTAL|VALUE/i.test(c.name) && !c.isPrimaryKey && !c.isForeignKey);
                if (guess) {
                    col = colEntry(pt.table.name, guess.name);
                    notes.push(`Interpreted "${phrase || m[0].trim()}" as ${q(pt.table.name, guess.name)}.`);
                }
            }
            if (!col)
                continue;
            aggregates.push({ agg, entry: col, distinct: false, alias: aliasFor(agg === 'SUM' ? 'TOTAL' : agg, col.column.name), expr: `${agg}(${q(col.table, col.column.name)})` });
            takenAggSpans.push(span);
            aggregateMode = true;
        }
    });
    const havingNoun = soft.match(new RegExp(`\\bhaving\\s+(?:more than|over|at least|fewer than|less than|under|at most)\\s+${NUM}\\s+([a-z ]{2,30})`));
    if (!aggregateMode && havingNoun && primary()) {
        const nounTbl = tableByWords(havingNoun[1].trim().split(' ').slice(0, 2).join(' ')) || tableByWords(havingNoun[1].trim().split(' ')[0]);
        if (nounTbl && nounTbl.table.name !== primary()) {
            ensureTable(nounTbl.table.name, 'HAVING count');
            const pk = nounTbl.pk || nounTbl.table.columns[0];
            const ce = colEntry(nounTbl.table.name, pk.name);
            aggregates.push({ agg: 'COUNT', entry: ce, distinct: true, alias: aliasFor(nounTbl.core, 'COUNT'), expr: `COUNT(DISTINCT ${q(nounTbl.table.name, pk.name)})` });
            aggregateMode = true;
        }
    }
    if (aggregateMode)
        aggregates.forEach((a) => add('aggregation', `${a.expr} AS ${a.alias}`, a.entry || a.agg === 'COUNT' ? 0.85 : 0.5));
    const groupBy = [];
    const groupSelect = [];
    function pickDateColumn(hintText) {
        const dateCols = ctx.columns.filter((c) => isDateType(c.column.type) && inScope(c.table));
        if (!dateCols.length)
            return null;
        const h = softNormalize(hintText + ' ' + soft);
        const kw = [[/\bdue\b/, /DUE/i], [/\bpost(ed|ing)?\b/, /POST/i], [/\bapprov(ed|al)\b/, /APPROV/i], [/\b(created|raised|issued|invoice date|invoiced)\b/, /INVOICE_DATE|CREAT|PO_DATE/i], [/\bpaid|payment\b/, /PAY/i], [/\b(start|starting)\b/, /START/i], [/\b(end|ending|expir)/, /END|EXPIR/i]];
        for (const [re, colRe] of kw)
            if (re.test(h)) {
                const hit = dateCols.find((c) => colRe.test(c.column.name) && c.table === primary()) || dateCols.find((c) => colRe.test(c.column.name));
                if (hit)
                    return hit;
            }
        const named = resolvedHits.find((r) => isDateType(r.entry.column.type));
        if (named)
            return named.entry;
        const live = dateCols.filter((c) => !/^\s*obsolete/i.test(c.column.description || ''));
        for (const re of [/INVOICE_DATE/i, /^(CREATION_TIME|CREATED(_DATE|_AT|_TIME)?|CREATION_DATE)$/i, /^(DOCUMENT_)?DATE$|_DATE$/i]) {
            const hit = live.find((c) => c.table === primary() && re.test(c.column.name));
            if (hit)
                return hit;
        }
        return live.find((c) => c.table === primary()) || live[0] || dateCols[0];
    }
    const groupRe = new RegExp(`\\b(?:grouped by|group by|broken down by|split by|for each|for every|per|by)\\s+(?:each\\s+|the\\s+)?([a-z0-9 ]{2,40}?)(?=\\s${STOP_AFTER}\\b|[,.;]|$)`, 'g');
    if (aggregateMode || /\b(per|for each|for every|group(?:ed)? by|broken down by)\b/.test(soft)) {
        let m;
        while ((m = groupRe.exec(soft))) {
            const before = soft.slice(Math.max(0, m.index - 10), m.index);
            if (/(sort|sorted|order|ordered|them|results)\s*$/.test(before) || /^by\s/.test(m[0]) && /(top|first|highest|lowest)\s+\d*\s*[a-z ]*$/.test(soft.slice(Math.max(0, m.index - 30), m.index)))
                continue;
            const phrase = m[1].trim();
            if (/^(month|monthly|year|yearly|annually)$/.test(phrase.split(' ').pop() || '')) {
                const dcol = pickDateColumn(phrase);
                if (!dcol)
                    continue;
                const ref = q(dcol.table, dcol.column.name);
                const isMonth = /month/.test(phrase);
                const expr = isMonth ? monthBucketExpr(ref, dialect) : yearBucketExpr(ref, dialect);
                const alias = isMonth ? 'PERIOD_MONTH' : 'PERIOD_YEAR';
                groupBy.push(expr);
                groupSelect.push({ id: makeId('col'), table: dcol.table, column: alias, alias, useDecode: false, aggregate: null, manualExpr: `${expr} AS ${alias}` });
                add('group-by', `GROUP BY ${expr}`, 0.75);
                dateLogic.push(`grouped by ${isMonth ? 'month' : 'year'} of ${ref}`);
                continue;
            }
            const col = findColumnByWords(phrase, (c) => !isNumericType(c.type) || !!c.isPrimaryKey || !!c.isForeignKey, true);
            const tbl = tableByWords(phrase);
            let target = null;
            if (tbl && (!col || softNormalize(phrase) === tbl.phrases.find((p) => p === softNormalize(phrase)))) {
                const dc = tbl.displayColumn || tbl.pk;
                if (dc)
                    target = { table: tbl.table.name, column: dc.name };
            }
            else if (col)
                target = { table: col.table, column: col.column.name };
            if (!target)
                continue;
            ensureTable(target.table, 'grouping');
            const ref = q(target.table, target.column);
            if (!groupBy.includes(ref)) {
                groupBy.push(ref);
                groupSelect.push({ id: makeId('col'), table: target.table, column: target.column, alias: '', useDecode: false, aggregate: null, displayMode: 'raw' });
                add('group-by', `GROUP BY ${ref}`, aggregateMode ? 0.85 : 0.6);
            }
        }
    }
    if (aggregateMode && !groupBy.length && havingNoun) {
        const pt = ctx.tableUpper.get(primary().toUpperCase());
        const dc = pt ? (pt.nameColumn || pt.displayColumn || pt.pk) : null;
        if (pt && dc) {
            const ref = q(pt.table.name, dc.name);
            groupBy.push(ref);
            groupSelect.push({ id: makeId('col'), table: pt.table.name, column: dc.name, alias: '', useDecode: false, aggregate: null, displayMode: 'raw' });
            add('group-by', `GROUP BY ${ref}`, 0.8);
        }
    }
    if (aggregateMode && !groupBy.length) {
        const te = soft.match(/\b(?:top|bottom|highest|lowest|first|best|worst|biggest|largest|smallest)\s+(?:\d{1,6}\s+)?([a-z ]{2,30}?)\s+by\b/);
        const tbl = te ? tableByWords(te[1].trim()) : null;
        const dc = tbl ? (tbl.nameColumn || tbl.displayColumn || tbl.pk) : null;
        if (tbl && dc) {
            ensureTable(tbl.table.name, 'ranked entity');
            const ref = q(tbl.table.name, dc.name);
            groupBy.push(ref);
            groupSelect.push({ id: makeId('col'), table: tbl.table.name, column: dc.name, alias: '', useDecode: false, aggregate: null, displayMode: 'raw' });
            add('group-by', `GROUP BY ${ref} (ranking ${tbl.table.name})`, 0.8);
        }
    }
    const numericColsInText = resolvedHits.filter((h) => isNumericType(h.entry.column.type));
    const aggregatedCols = new Set(aggregates.filter((a) => a.entry && a.agg !== 'COUNT').map((a) => q(a.entry.table, a.entry.column.name)));
    let having = '';
    numericColsInText.forEach((h) => {
        const after = soft.slice(h.span.end, h.span.end + 70).replace(/^\s+/, '');
        const between = after.match(new RegExp(`^(?:is\\s+)?between\\s+(${NUM})\\s+and\\s+(${NUM})`));
        const ref = q(h.entry.table, h.entry.column.name);
        if (between) {
            filters.push({ id: makeId('filt'), table: h.entry.table, column: h.entry.column.name, operator: 'BETWEEN', value: parseNumber(between[1]), value2: parseNumber(between[2]), combinator: 'AND' });
            add('filter', `${ref} BETWEEN ${parseNumber(between[1])} AND ${parseNumber(between[2])}`, 0.85);
            return;
        }
        for (const c of COMPARATORS) {
            const cm = after.match(c.re);
            if (!cm)
                continue;
            const rest = after.slice(cm[0].length);
            const nm = rest.match(new RegExp(`^\\s*(${NUM})\\b`));
            if (!nm)
                continue;
            const value = parseNumber(nm[1]);
            const isAggTarget = aggregatedCols.has(ref) && /(total|sum|average|avg|mean)\s+(?:of\s+)?(?:the\s+)?[a-z ]{0,30}$/.test(soft.slice(Math.max(0, h.span.start - 25), h.span.start + 1));
            if (isAggTarget) {
                const a = aggregates.find((x) => x.entry && q(x.entry.table, x.entry.column.name) === ref);
                having = having ? `${having} AND ${a.expr} ${c.op} ${value}` : `${a.expr} ${c.op} ${value}`;
                add('having', `HAVING ${a.expr} ${c.op} ${value}`, 0.8);
            }
            else {
                filters.push({ id: makeId('filt'), table: h.entry.table, column: h.entry.column.name, operator: c.op, value, combinator: 'AND' });
                add('filter', `${ref} ${c.op} ${value}`, 0.85);
            }
            break;
        }
    });
    if (!numericColsInText.length) {
        const bare = soft.match(new RegExp(`\\b(over|above|more than|greater than|exceeding|at least|under|below|less than)\\s+(${NUM})\\b(?!\\s*(?:days?|weeks?|months?|years?|rows?|records?|results?|invoices?|items?|lines?))`));
        const pt = ctx.tableUpper.get((primary() || '').toUpperCase());
        const amt = pt?.table.columns.find((c) => isNumericType(c.type) && /AMOUNT|TOTAL|VALUE/i.test(c.name) && !c.isPrimaryKey && !c.isForeignKey);
        if (bare && amt && pt && !aggregateMode) {
            const op = COMPARATORS.find((c) => c.re.test(bare[1])).op;
            if (add('filter', `${q(pt.table.name, amt.name)} ${op} ${parseNumber(bare[2])} (amount column inferred from "${bare[0]}")`, 0.65))
                filters.push({ id: makeId('filt'), table: pt.table.name, column: amt.name, operator: op, value: parseNumber(bare[2]), combinator: 'AND' });
        }
    }
    if (aggregateMode) {
        const hc = soft.match(new RegExp(`\\b(?:having|with)\\s+(?:a\\s+)?(?:count\\s+|total\\s+|sum\\s+)?(more than|over|greater than|at least|fewer than|less than|under|at most)\\s+(${NUM})\\s*([a-z ]{0,30})`));
        if (hc && !having) {
            const op = COMPARATORS.find((c) => c.re.test(hc[1])).op;
            const n = parseNumber(hc[2]);
            const nounTbl = hc[3] ? tableByWords(hc[3].trim().split(' ').slice(0, 2).join(' ')) : null;
            const countAgg = aggregates.find((a) => a.agg === 'COUNT');
            const expr = nounTbl ? (() => { const pk = nounTbl.pk || nounTbl.table.columns[0]; ensureTable(nounTbl.table.name, 'HAVING count'); return `COUNT(${nounTbl.table.name !== primary() ? 'DISTINCT ' : ''}${q(nounTbl.table.name, pk.name)})`; })() : countAgg ? countAgg.expr : aggregates[0].expr;
            having = `${expr} ${op} ${n}`;
            add('having', `HAVING ${having}`, 0.75);
        }
    }
    const mapCountry = (col, v) => {
        if (!/country/i.test(`${col.name} ${col.label}`) || !(Number(col.length) <= 3 || /\biso\b/i.test(col.description || '')))
            return v;
        const iso = countryNameToIso2(v);
        if (iso) {
            notes.push(`"${v}" was mapped to the ISO country code '${iso}' used by ${col.name}.`);
            return iso;
        }
        return v;
    };
    resolvedHits.filter((h) => isStringType(h.entry.column.type) && !h.entry.column.decode?.length).forEach((h) => {
        const normText = text.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
        const after = normText.toLowerCase().slice(h.span.end, h.span.end + 90).replace(/^\s+/, '');
        const raw = normText.slice(h.span.end, h.span.end + 90).replace(/^\s+/, '');
        const ref = q(h.entry.table, h.entry.column.name);
        const valueAt = (offset) => { const r = raw.slice(offset).trim(); const qm = r.match(/^['"“‘]([^'"”’]{1,80})['"”’]/); if (qm)
            return qm[1]; const wm = r.match(new RegExp(`^([A-Za-z0-9@._\\-/]+(?:\\s+(?!${STOP_AFTER}\\b)[A-Z0-9][A-Za-z0-9@._\\-/]*){0,3})`)); return wm ? wm[1] : null; };
        const push = (op, value, desc) => { filters.push({ id: makeId('filt'), table: h.entry.table, column: h.entry.column.name, operator: op, value, combinator: 'AND' }); add('filter', `${ref} ${desc}`, 0.8); };
        let m;
        if ((m = after.match(/^(?:is\s+)?(?:empty|null|missing|blank|not set|not provided)\b/)))
            return push('IS NULL', '', 'IS NULL');
        if ((m = after.match(/^(?:is\s+)?(?:not\s+(?:empty|null|blank|missing)|present|provided|set)\b/)))
            return push('IS NOT NULL', '', 'IS NOT NULL');
        if ((m = after.match(/^(?:that\s+|which\s+)?(?:does\s+not|doesn't|not)\s+(?:contain|include|like)\s+/))) {
            const v = valueAt(m[0].length);
            if (v)
                push('NOT LIKE', `%${v}%`, `NOT LIKE '%${v}%'`);
            return;
        }
        if ((m = after.match(/^(?:that\s+|which\s+)?(?:contains?|containing|includes?|including|like|matching|mentions?)\s+/))) {
            const v = valueAt(m[0].length);
            if (v)
                push('LIKE', `%${v}%`, `LIKE '%${v}%'`);
            return;
        }
        if ((m = after.match(/^(?:that\s+|which\s+)?(?:starts?|starting|begins?|beginning)\s+with\s+/))) {
            const v = valueAt(m[0].length);
            if (v)
                push('LIKE', `${v}%`, `LIKE '${v}%'`);
            return;
        }
        if ((m = after.match(/^(?:that\s+|which\s+)?(?:ends?|ending)\s+with\s+/))) {
            const v = valueAt(m[0].length);
            if (v)
                push('LIKE', `%${v}`, `LIKE '%${v}'`);
            return;
        }
        if ((m = after.match(/^(?:is\s+)?(?:not\s+in|none of)\s*\(?/))) {
            const list = raw.slice(m[0].length).match(/^\(?([^)]+?)\)?(?=\s+(?:and|or|sorted|order|with)\b|$|[.;])/);
            if (list) {
                const vals = list[1].split(/\s*(?:,|\bor\b|\band\b)\s*/).map((v) => mapCountry(h.entry.column, v.replace(/['"]/g, '').trim())).filter(Boolean);
                if (vals.length)
                    push('NOT IN', vals.join(','), `NOT IN (${vals.join(', ')})`);
            }
            return;
        }
        if ((m = after.match(/^(?:is\s+)?(?:in|one of|any of)\s*\(?/))) {
            const list = raw.slice(m[0].length).match(/^\(?([^)]+?)\)?(?=\s+(?:and|sorted|order|with)\b|$|[.;])/);
            if (list) {
                const vals = list[1].split(/\s*(?:,|\bor\b)\s*/).map((v) => mapCountry(h.entry.column, v.replace(/['"]/g, '').trim())).filter(Boolean);
                if (vals.length > 1)
                    push('IN', vals.join(','), `IN (${vals.join(', ')})`);
                else if (vals.length === 1)
                    push('=', vals[0], `= '${vals[0]}'`);
            }
            return;
        }
        if ((m = after.match(/^(?:is\s+not|not|<>|!=|other than)\s+/))) {
            const v = valueAt(m[0].length);
            if (v) {
                const mv = mapCountry(h.entry.column, v);
                push('<>', mv, `<> '${mv}'`);
            }
            return;
        }
        if ((m = after.match(/^(?:is|=|equals?|equal to|named|called|:)\s*/))) {
            const v = valueAt(m[0].length);
            if (v && !/^(the|a|an|not|null|empty|in|of)$/i.test(v) && !tableByWords(v.toLowerCase())) {
                const mv = mapCountry(h.entry.column, v);
                push('=', mv, `= '${mv}'`);
            }
        }
    });
    // Bare country names ("vendors in Germany or France") → ISO code filter on the in-scope country column.
    const countryCol = ctx.columns.find((c) => inScope(c.table) && /country/i.test(`${c.column.name} ${c.column.label}`) && isStringType(c.column.type) && (Number(c.column.length) <= 3 || /\biso\b/i.test(c.column.description || '')));
    if (countryCol && !filters.some((f) => f.table === countryCol.table && f.column === countryCol.column.name)) {
        const words = soft.replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
        const found = [];
        for (let i = 0; i < words.length; i++) {
            for (const n of [3, 2, 1]) {
                const ph = words.slice(i, i + n).join(' ');
                if (n > 1 && words.length < i + n)
                    continue;
                const iso = n === 1 && ph.length < 4 && ph !== 'uk' && ph !== 'usa' && ph !== 'uae' ? null : countryNameToIso2(ph);
                if (iso && !found.some((f) => f.iso === iso)) {
                    found.push({ iso, neg: /\b(not|excluding|except|outside)\s*(in\s*)?$/.test(words.slice(Math.max(0, i - 2), i).join(' ')) });
                    i += n - 1;
                    break;
                }
            }
        }
        if (found.length) {
            const neg = found.every((f) => f.neg);
            const vals = found.map((f) => f.iso);
            filters.push({ id: makeId('filt'), table: countryCol.table, column: countryCol.column.name, operator: vals.length > 1 ? (neg ? 'NOT IN' : 'IN') : (neg ? '<>' : '='), value: vals.join(','), combinator: 'AND' });
            add('filter', `${q(countryCol.table, countryCol.column.name)} ${vals.length > 1 ? 'IN' : '='} (${vals.join(', ')}) — country name(s) mapped to ISO codes`, 0.8);
        }
    }
    mentions.tables.forEach((th) => {
        const m = soft.slice(th.span.end, th.span.end + 30).match(/^\s*(?:#|no\.?|number|num)?\s*(\d{1,18})\b(?!\s*(?:days?|weeks?|months?|years?|rows?|records?|results?|%))/);
        const pk = th.entry.pk;
        if (m && pk && !filters.some((f) => f.table === th.entry.table.name && f.column === pk.name)) {
            ensureTable(th.entry.table.name, 'identified record');
            filters.push({ id: makeId('filt'), table: th.entry.table.name, column: pk.name, operator: '=', value: m[1], combinator: 'AND' });
            add('filter', `${q(th.entry.table.name, pk.name)} = ${m[1]}`, 0.8);
        }
    });
    mentions.tables.forEach((th) => {
        const raw = text.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().slice(th.span.end, th.span.end + 80);
        const m = raw.match(/^\s*(?:named|called|=|:)?\s*['"“‘]([^'"”’]{1,80})['"”’]/);
        const dc = th.entry.displayColumn;
        if (m && dc && !filters.some((f) => f.table === th.entry.table.name && f.column === dc.name)) {
            ensureTable(th.entry.table.name, 'named entity');
            filters.push({ id: makeId('filt'), table: th.entry.table.name, column: dc.name, operator: '=', value: m[1], combinator: 'AND' });
            add('filter', `${q(th.entry.table.name, dc.name)} = '${m[1]}'`, 0.8);
        }
    });
    const dateFilters = [];
    const dcol = /\b(today|yesterday|this|current|last|past|previous|since|before|after|until|between|during|in|on|from)\b/.test(soft) ? pickDateColumn('') : null;
    if (dcol) {
        const T = dcol.table, C = dcol.column.name;
        const ref = q(T, C);
        const isTs = /TIME/i.test(dcol.column.type);
        const f = (op, value, value2) => dateFilters.push({ id: makeId('filt'), table: T, column: C, operator: op, value, value2, combinator: 'AND' });
        const range = (from, to) => { f('>=', from); f('<', to); };
        let m;
        let desc = '';
        const unitOf = (u) => (u.startsWith('day') ? 'DAY' : u.startsWith('week') ? 'WEEK' : u.startsWith('month') ? 'MONTH' : 'YEAR');
        const lowerRaw = text.toLowerCase();
        const nextIso = (iso) => { const nb = new Date(`${iso}T00:00:00Z`); nb.setUTCDate(nb.getUTCDate() + 1); return nb.toISOString().slice(0, 10); };
        if ((m = lowerRaw.match(new RegExp(`\\bbetween\\s+${DATE_TOKEN_RE}\\s+and\\s+${DATE_TOKEN_RE}`, 'i')))) {
            const a = parseDateToken(m[1]);
            const b = parseDateToken(m[2]);
            if (a && b) {
                if (isTs)
                    range(dateLiteral(a.iso, dialect), dateLiteral(nextIso(b.iso), dialect));
                else
                    f('BETWEEN', dateLiteral(a.iso, dialect), dateLiteral(b.iso, dialect));
                desc = `${ref} between ${a.iso} and ${b.iso}`;
                if (a.ambiguous || b.ambiguous)
                    clarifications.push({ question: 'Dates were read as DD/MM/YYYY — confirm this is correct.', options: [a.iso, b.iso] });
            }
        }
        else if ((m = lowerRaw.match(new RegExp(`\\b(since|after|from|on or after|starting)\\s+${DATE_TOKEN_RE}`, 'i')))) {
            const a = parseDateToken(m[2]);
            if (a) {
                f(m[1] === 'after' ? '>' : '>=', dateLiteral(a.iso, dialect));
                desc = `${ref} ${m[1] === 'after' ? '>' : '>='} ${a.iso}`;
            }
        }
        else if ((m = lowerRaw.match(new RegExp(`\\b(before|until|up to|on or before)\\s+${DATE_TOKEN_RE}`, 'i')))) {
            const a = parseDateToken(m[2]);
            if (a) {
                const op = m[1] === 'before' ? '<' : '<=';
                f(op, dateLiteral(a.iso, dialect));
                desc = `${ref} ${op} ${a.iso}`;
            }
        }
        else if ((m = lowerRaw.match(new RegExp(`\\bon\\s+${DATE_TOKEN_RE}`, 'i')))) {
            const a = parseDateToken(m[1]);
            if (a) {
                range(dateLiteral(a.iso, dialect), dateLiteral(nextIso(a.iso), dialect));
                desc = `${ref} on ${a.iso}`;
            }
        }
        else if ((m = soft.match(/\b(?:in|during|for)\s+([a-z]{3,9})\s+(\d{4})\b/)) && monthIndex(m[1]) >= 0) {
            const r = monthRange(+m[2], monthIndex(m[1]) + 1);
            range(dateLiteral(r.from, dialect), dateLiteral(r.to, dialect));
            desc = `${ref} in ${m[1]} ${m[2]}`;
        }
        else if ((m = soft.match(/\b(?:in|during|for|of)\s+(?:the\s+)?(?:year\s+)?((?:19|20|21)\d{2})\b(?!\s*(?:rows|records|results))/))) {
            range(dateLiteral(`${m[1]}-01-01`, dialect), dateLiteral(`${+m[1] + 1}-01-01`, dialect));
            desc = `${ref} in ${m[1]}`;
        }
        else if ((m = soft.match(/\b(?:last|past|previous)\s+(\d+)\s*(days?|weeks?|months?|years?)\b/))) {
            f('>=', agoExpr(+m[1], unitOf(m[2]), dialect));
            desc = `${ref} within the last ${m[1]} ${m[2]}`;
        }
        else if (/\btoday\b/.test(soft)) {
            range(todayExpr(dialect), nextDayExpr(dialect));
            desc = `${ref} = today`;
        }
        else if (/\byesterday\b/.test(soft)) {
            range(agoExpr(1, 'DAY', dialect), todayExpr(dialect));
            desc = `${ref} = yesterday`;
        }
        else if ((m = soft.match(/\b(?:this|current)\s+(week|month|year)\b/))) {
            f('>=', startOfExpr(unitOf(m[1]), 0, dialect));
            desc = `${ref} in the current ${m[1]}`;
        }
        else if ((m = soft.match(/\b(?:last|previous|past|prior)\s+(week|month|year)\b/))) {
            const u = unitOf(m[1]);
            range(startOfExpr(u, 1, dialect), startOfExpr(u, 0, dialect));
            desc = `${ref} in the previous ${m[1]}`;
        }
        if (dateFilters.length) {
            for (let i = filters.length - 1; i >= 0; i--)
                if (/^(CURRENT_DATE|DATE_TRUNC)/.test(filters[i].value))
                    filters.splice(i, 1);
            filters.push(...dateFilters);
            add('date-filter', desc, 0.85);
            dateLogic.push(desc);
            const others = ctx.columns.filter((c) => isDateType(c.column.type) && inScope(c.table) && c !== dcol);
            if (others.length && !resolvedHits.some((r) => r.entry === dcol))
                clarifications.push({ question: `Date filter applied to ${ref}. Other date columns exist — choose a different one if needed.`, options: others.map((o) => q(o.table, o.column.name)) });
        }
    }
    const sorts = [];
    let limit = null;
    let m2;
    if ((m2 = soft.match(/\b(?:top|first|limit(?:ed)? to|only|bottom|last|latest|newest|most recent|recent|oldest|earliest|highest|lowest|largest|smallest|biggest)\s+(\d{1,6})\b(?!\s*(?:days?|weeks?|months?|years?))/)) || (m2 = soft.match(/\b(\d{1,6})\s+(?:rows|records|results|entries)\b/))) {
        limit = parseInt(m2[1], 10);
        add('limit', `Limit to ${limit} rows`, 0.85);
    }
    const sortAgg = (desc, why) => { const a = aggregates.find((x) => x.agg !== 'COUNT') || aggregates[0]; if (a) {
        sorts.push({ id: makeId('sort'), table: '', column: a.alias, direction: desc ? 'DESC' : 'ASC', expression: a.expr });
        add('sort', `ORDER BY ${a.expr} ${desc ? 'DESC' : 'ASC'} (${why})`, 0.8);
        return true;
    } return false; };
    const explicitSort = soft.match(/\b(?:sort|sorted|order|ordered|rank|ranked)\s+(?:them\s+|results\s+|the results\s+|it\s+)?by\s+([a-z0-9 ]{2,40}?)(?:\s+(asc|ascending|desc|descending|highest first|lowest first|newest first|oldest first|latest first))?(?=\s+(?:and|with|where|limit|top|for|in)\b|[,.;]|$)/);
    if (explicitSort) {
        const desc = /desc|highest|newest|latest/.test(explicitSort[2] || '');
        const phrase = explicitSort[1].trim();
        const aggWord = /^(total|sum|count|average|amount total|number)/.test(phrase) && aggregateMode;
        if (!(aggWord && sortAgg(desc, `sorted by ${phrase}`))) {
            const col = findColumnByWords(phrase, () => true, true);
            if (col) {
                ensureTable(col.table, 'sort column');
                sorts.push({ id: makeId('sort'), table: col.table, column: col.column.name, direction: desc ? 'DESC' : 'ASC' });
                add('sort', `ORDER BY ${q(col.table, col.column.name)} ${desc ? 'DESC' : 'ASC'}`, 0.85);
            }
            else if (aggregateMode)
                sortAgg(desc, `sorted by ${phrase}`);
        }
    }
    else if ((m2 = soft.match(/\b(top|highest|largest|biggest|most|bottom|lowest|smallest|least)\b(?:\s+\d+)?(?:\s+[a-z]+){0,3}?\s+by\s+([a-z0-9 ]{2,40}?)(?=\s+(?:and|with|where|for|in|during|this|last)\b|[,.;]|$)/))) {
        const desc = /top|highest|largest|biggest|most/.test(m2[1]);
        if (!(aggregateMode && sortAgg(desc, `${m2[1]} by ${m2[2]}`))) {
            const col = findColumnByWords(m2[2], (c) => isNumericType(c.type) || isDateType(c.type), true);
            if (col) {
                ensureTable(col.table, 'ranking column');
                sorts.push({ id: makeId('sort'), table: col.table, column: col.column.name, direction: desc ? 'DESC' : 'ASC' });
                add('sort', `ORDER BY ${q(col.table, col.column.name)} ${desc ? 'DESC' : 'ASC'}`, 0.8);
            }
        }
    }
    else if ((m2 = soft.match(/\b(highest|largest|biggest|lowest|smallest)\s+([a-z0-9 ]{2,30}?)(?=\s+(?:and|with|where|for|in|first)\b|[,.;]|$)/))) {
        const desc = /highest|largest|biggest/.test(m2[1]);
        if (!(aggregateMode && sortAgg(desc, m2[0]))) {
            const col = findColumnByWords(m2[2], (c) => isNumericType(c.type), true);
            if (col) {
                sorts.push({ id: makeId('sort'), table: col.table, column: col.column.name, direction: desc ? 'DESC' : 'ASC' });
                add('sort', `ORDER BY ${q(col.table, col.column.name)} ${desc ? 'DESC' : 'ASC'}`, 0.75);
            }
        }
    }
    else if (/\b(latest|most recent|newest|recent|oldest|earliest)\b/.test(soft)) {
        const dc = pickDateColumn('');
        if (dc) {
            const desc = !/\b(oldest|earliest)\b/.test(soft);
            sorts.push({ id: makeId('sort'), table: dc.table, column: dc.column.name, direction: desc ? 'DESC' : 'ASC' });
            add('sort', `ORDER BY ${q(dc.table, dc.column.name)} ${desc ? 'DESC' : 'ASC'}`, 0.75);
        }
    }
    else if (aggregateMode && limit) {
        sortAgg(!/\b(bottom|lowest|least|smallest)\b/.test(soft), `top ${limit}`);
    }
    if (!sorts.length && base.matchedSorts.length)
        base.matchedSorts.filter((s) => inScope(s.table)).forEach((s) => sorts.push(s));
    const distinct = !aggregateMode && /\b(distinct|unique|different|without duplicates|de-?duplicated?)\b/.test(soft);
    if (distinct)
        add('distinct', 'SELECT DISTINCT', 0.85);
    const tableAliases = /\b(?:with|using|use)\s+(?:short\s+)?(?:table\s+)?alias(?:es)?\b/.test(soft) ? true : undefined;
    if (tableAliases)
        add('alias', 'Table aliases (e.g. INVOICE_HEADER ih)', 0.85);
    const joinType = /\b(left join|left outer join|including (?:those|ones|records|rows|items|entries) (?:without|with no)|even (?:if|when) (?:there (?:is|are) )?no|with or without)\b/.test(soft) ? 'LEFT JOIN' : undefined;
    if (joinType)
        add('join', 'LEFT JOIN (keep rows without a match)', 0.8);
    const learnedIds = [];
    (opts.hints || []).filter((h) => h.similarity >= 0.6).sort((a, b) => b.weight * b.similarity - a.weight * a.similarity).slice(0, 1).forEach((h) => {
        const validTables = h.tables.filter((t) => ctx.tableUpper.has(t.toUpperCase()));
        const validCols = h.columns.filter((c) => ctx.columns.some((e) => e.table === c.table && e.column.name === c.column));
        if (validTables.length !== h.tables.length || validCols.length !== h.columns.length) {
            notes.push('A learned pattern referenced schema elements that no longer exist in the Active Schema and was ignored; the request was evaluated against the current Active Schema.');
            return;
        }
        let used = false;
        if (!tables.length && validTables.length) {
            tables = [...validTables];
            used = true;
        }
        else
            validTables.forEach((t) => { if (!inScope(t) && relationshipDistance(ctx, primary(), t) <= 2) {
                tables.push(t);
                used = true;
            } });
        if (!resolvedHits.length && !aggregateMode)
            validCols.filter((c) => inScope(c.table)).forEach((c) => { const e = colEntry(c.table, c.column); if (e) {
                resolvedHits.push({ entry: e, span: { start: -1, end: -1 } });
                used = true;
            } });
        if (limit === null && h.options.limit) {
            limit = h.options.limit;
            used = true;
        }
        if (!sorts.length && h.options.sorts?.length)
            h.options.sorts.filter((s) => inScope(s.table)).forEach((s) => { sorts.push({ id: makeId('sort'), ...s }); used = true; });
        if (used) {
            learnedIds.push(h.patternId);
            add('learned', `Applied learned pattern (${h.status}, similarity ${(h.similarity * 100).toFixed(0)}%).`, Math.min(0.95, 0.6 + h.similarity * 0.3));
        }
    });
    if (tables.length > 1)
        tables.slice(1).forEach((t) => { const d = relationshipDistance(ctx, primary(), t); if (d === Infinity) {
            add('join', `No relationship path from ${primary()} to ${t} in the Active Schema — no JOIN can be generated for it.`, 0.3);
            notes.push(`No relationship path was found between ${primary()} and ${t} in the Active Schema; add the relationship in Settings → Manual Schema Update or remove the table.`);
        }
        else
            add('join', `JOIN ${t} (${d === 1 ? 'direct relationship' : `${d}-step relationship path`})`, d <= 2 ? 0.85 : 0.6); });
    const gaps = [];
    const allTableNames = new Set(schema.tables.map((t) => t.name.toUpperCase()));
    const allColNames = new Set(schema.tables.flatMap((t) => t.columns.map((c) => c.name.toUpperCase())));
    (text.match(/\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/g) || []).forEach((id) => { const u = id.toUpperCase(); if (!allTableNames.has(u) && !allColNames.has(u))
        gaps.push({ kind: /_(ID|DATE|NAME|CODE|AMOUNT|STATUS|FLAG|NO|NUMBER)$/i.test(id) ? 'column' : 'term', term: id }); });
    [...text.matchAll(/\b(?:table|from table)\s+["'`]?([A-Za-z][A-Za-z0-9_]*)["'`]?/gi)].forEach((m) => { if (/^(alias(es)?|aliasing|names?|joins?|rows?|columns?|data)$/i.test(m[1]))
        return; if (!allTableNames.has(m[1].toUpperCase()) && !tableByWords(m[1]))
        gaps.push({ kind: 'table', term: m[1] }); });
    [...text.matchAll(/\b(?:column|field)\s+["'`]?([A-Za-z][A-Za-z0-9_ ]{1,30}?)["'`]?(?=\s|$|[,.;])/gi)].forEach((m) => { const t = m[1].trim(); if (!allColNames.has(t.toUpperCase().replace(/ /g, '_')) && !findColumnByWords(t, () => true, true))
        gaps.push({ kind: 'column', term: t }); });
    const vocab = new Set([...ctx.tables.flatMap((t) => t.phrases.flatMap((p) => p.split(' '))), ...ctx.columns.flatMap((c) => c.phrases.flatMap((p) => p.split(' ')))]);
    base.unresolvedTerms.forEach((t) => { const words = softNormalize(t).split(' ').filter((w) => w.length > 2); if (/_/.test(t) || gaps.some((g) => g.term.toLowerCase() === t.toLowerCase()) || words.some((w) => vocab.has(w) || vocab.has(w.replace(/s$/, '')) || (/^un/.test(w) && vocab.has(w.slice(2)))))
        return; gaps.push({ kind: 'term', term: t }); });
    let matchedColumns;
    if (aggregateMode) {
        matchedColumns = [...groupSelect, ...aggregates.map((a) => (a.entry && !a.distinct)
                ? { id: makeId('col'), table: a.entry.table, column: a.entry.column.name, alias: a.alias, useDecode: false, aggregate: a.agg, displayMode: 'raw' }
                : { id: makeId('col'), table: a.entry?.table || primary() || '', column: a.alias, alias: a.alias, useDecode: false, aggregate: null, manualExpr: `${a.expr} AS ${a.alias}` })];
        if (groupBy.length)
            notes.push('Aggregation detected: the column list contains the grouping column(s) and aggregate(s) only, so the GROUP BY is valid.');
    }
    else {
        const seen = new Set();
        matchedColumns = resolvedHits.filter((h) => inScope(h.entry.table)).filter((h) => { const k = q(h.entry.table, h.entry.column.name); if (seen.has(k))
            return false; seen.add(k); return true; })
            .map((h) => ({ id: makeId('col'), table: h.entry.table, column: h.entry.column.name, alias: '', useDecode: false, aggregate: null, displayMode: 'raw' }));
        if (matchedColumns.length > 0 && matchedColumns.every((c) => filters.some((f) => f.table === c.table && f.column === c.column) || sorts.some((s) => s.table === c.table && s.column === c.column)))
            matchedColumns = [];
        if (matchedColumns.length && tables.length > 1 && !matchedColumns.some((c) => c.table === primary())) {
            const pt = ctx.tableUpper.get(primary().toUpperCase());
            [pt?.pk, pt?.nameColumn].filter((c) => !!c).forEach((c) => matchedColumns.unshift({ id: makeId('col'), table: primary(), column: c.name, alias: '', useDecode: false, aggregate: null, displayMode: 'raw' }));
        }
    }
    ['=', '<>'].forEach((op) => {
        const groups = new Map();
        filters.filter((f) => f.operator === op).forEach((f) => { const k = q(f.table, f.column); const l = groups.get(k) || []; l.push(f); groups.set(k, l); });
        groups.forEach((list) => { const values = Array.from(new Set(list.map((f) => f.value))); if (values.length < 2)
            return; const first = list[0]; list.slice(1).forEach((f) => filters.splice(filters.indexOf(f), 1)); first.operator = op === '=' ? 'IN' : 'NOT IN'; first.value = values.join(','); add('filter', `${q(first.table, first.column)} ${first.operator} (${values.join(', ')}) — values for one column combined into a list.`, 0.8); });
    });
    const orBetween = /\bor\b/.test(soft) && !/\band\b/.test(soft) && filters.length > 1 && new Set(filters.map((f) => q(f.table, f.column))).size > 1;
    if (orBetween)
        filters.forEach((f, i) => { if (i > 0)
            f.combinator = 'OR'; });
    if (tables.length)
        plan.push(`Identified table(s) in Active Schema "${schema.name}": ${tables.join(', ')}.`);
    if (matchedColumns.length)
        plan.push(`Selected column(s): ${matchedColumns.map((c) => c.manualExpr ? c.alias : c.aggregate ? `${c.aggregate}(${q(c.table, c.column)})` : q(c.table, c.column)).join(', ')}.`);
    if (filters.length)
        plan.push(`Built ${filters.length} condition(s).`);
    if (groupBy.length)
        plan.push(`Grouping by ${groupBy.join(', ')}.`);
    if (having)
        plan.push(`HAVING ${having}.`);
    if (sorts.length)
        plan.push(`Sorting by ${sorts.map((s) => `${s.expression || q(s.table, s.column)} ${s.direction}`).join(', ')}.`);
    if (limit)
        plan.push(`Limiting to ${limit} row(s).`);
    if (!tables.length)
        notes.push('The offline model could not identify any table from the Active Schema in this description — mention a table or business term (e.g. "invoices", "vendors").');
    const confidence = !tables.length ? 0.1 : Math.min(1, 0.4 + (matchedColumns.length || aggregateMode ? 0.15 : 0) + (filters.length ? 0.15 : 0) + (sorts.length || limit ? 0.1 : 0) + (gaps.length ? -0.2 : 0.1) + (learnedIds.length ? 0.05 : 0));
    return {
        rawText, matchedTables: tables, matchedColumns, matchedFilters: filters, matchedSorts: sorts, limit, distinct, confidence: Math.max(0, confidence),
        notes: [...notes], queryPlan: plan, clarifications: [...clarifications, ...base.clarifications.filter((c) => !/Multiple date columns/.test(c.question) || !dateFilters.length)],
        unresolvedTerms: gaps.map((g) => g.term), groupBy, having, aggregateMode, autoOptions: auto, schemaGaps: gaps, learnedPatternIds: learnedIds,
        schemaFingerprint: ctx.fingerprint, schemaId: schema.id, engine: 'v17-offline-nlu', tableAliases, joinType, dateLogic
    };
}
//# sourceMappingURL=nluEngine.js.map