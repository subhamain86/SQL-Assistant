/** Offline self-training NLU for "Describe What You Need" — primary engine, no network. Grounded only in the Active Schema. */
import type { SchemaModel, QueryRequirement, SelectedColumnSpec, FilterCondition, SortSpec, Dialect, FilterOperator, JoinType, DecodeStyle } from '../../types';
import { parseRequirement } from '../../engines/nlpEngine';
import { makeId } from '../../utils/id';
import { getSchemaContext, softNormalize, findPhrase, isNumericType, isDateType, isStringType, relationshipDistance, type ColumnEntry, type TableEntry } from './schemaContext';
import { agoExpr, startOfExpr, todayExpr, dateLiteral } from './dateExpressions';
import { countryNameToIso2 } from './countryCodes';
import { tokenize } from './textTokens';
export const NLU_ENGINE_VERSION = 'offline-nlu-17.5.1';
export interface AutoOption { kind: string; description: string; }
export interface LearnedHint {
  patternId: string; similarity: number; tables: string[]; columns: { table: string; column: string }[]; options: { limit?: number | null; sorts?: { table: string; column: string; direction: 'ASC' | 'DESC' }[] };
  /** V17.4: where the pattern comes from ('admin' = Admin Query Library, trust 1.0; 'learned' = centrally learned, trust by tier). */
  source?: 'admin' | 'learned'; trust?: number; tier?: string; label?: string; stale?: boolean;
  aggregates?: { agg: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'; table: string; column: string; distinct: boolean }[]; groupBy?: { table: string; column: string }[]; distinct?: boolean; joinType?: JoinType | null;
  sortOnAggregate?: 'ASC' | 'DESC' | null; filterShapes?: { table: string; column: string; operator: string }[];
  /** V17.5: columns the pattern showed through a schema CASE/DECODE. */
  decodes?: { table: string; column: string; style: 'case' | 'decode' }[];
}
export interface V17Requirement extends QueryRequirement { groupBy: string[]; having: string; aggregateMode: boolean; autoOptions: AutoOption[]; schemaGaps: string[]; learnedPatternIds: string[]; patternUsed?: { source: 'admin' | 'learned'; label: string; similarity: number; id: string; tier?: string; adopted: string[] }; joinType?: JoinType; tableAliases?: boolean; }
interface Span { start: number; end: number; }
const NUM = String.raw`-?\d[\d,]*(?:\.\d+)?`;
const STOP = '(?:and|or|with|where|for|in|during|since|from|order|sorted|sort|having|top|limit|last|this|between|over|which|that|by|per|of|on|created|due|using|including)';
const CMP: [RegExp, FilterOperator][] = [[/^(?:is\s+)?(?:at least|>=)/, '>='], [/^(?:is\s+)?(?:at most|<=)/, '<='], [/^(?:is\s+)?(?:greater than|more than|above|over|>)/, '>'], [/^(?:is\s+)?(?:less than|below|under|<)/, '<'], [/^(?:is\s+)?(?:equal to|equals|=|is)/, '=']];
const ov = (a: Span, b: Span) => a.start < b.end && b.start < a.end;
const q = (t: string, c: string) => `${t}.${c}`;
const alias = (p: string, c: string) => `${p}_${c}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').slice(0, 30);

export function runOfflineNlu(raw: string, schema: SchemaModel, opts: { dialect: Dialect; hints?: LearnedHint[]; contextTables?: string[] }): V17Requirement {
  const ctx = getSchemaContext(schema); const base = parseRequirement(raw, schema); const text = raw.trim(); const d = opts.dialect;
  const out: V17Requirement = { ...base, groupBy: [], having: '', aggregateMode: false, autoOptions: [], schemaGaps: [], learnedPatternIds: [] };
  if (!text) return out;
  const soft = softNormalize(text); const auto: AutoOption[] = []; const add = (kind: string, description: string) => auto.push({ kind, description }); const notes: string[] = [];
  const known = new Set([...schema.tables.map((t) => t.name.toUpperCase()), ...schema.tables.flatMap((t) => t.columns.map((c) => c.name.toUpperCase()))]);
  const gaps = (text.match(/\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/g) || []).filter((x) => !known.has(x.toUpperCase()));
  let masked = soft.replace(/\b(?:with|using|use)\s+(?:short\s+)?(?:table\s+)?alias(?:es)?\b/g, (m) => ' '.repeat(m.length));
  gaps.forEach((g) => { const p = softNormalize(g); masked = masked.split(p).join(' '.repeat(p.length)); });
  type Cand = { k: 't'; e: TableEntry; s: Span } | { k: 'c'; e: ColumnEntry; s: Span };
  const cands: Cand[] = [];
  ctx.tables.forEach((e) => e.phrases.forEach((p) => findPhrase(masked, p).forEach((s) => cands.push({ k: 't', e, s }))));
  ctx.columns.forEach((e) => e.phrases.forEach((p) => { if (/^(id|no|name|code)$/.test(p)) return; findPhrase(masked, p).forEach((s) => cands.push({ k: 'c', e, s })); }));
  cands.sort((a, b) => (b.s.end - b.s.start) - (a.s.end - a.s.start) || (a.k === b.k ? 0 : a.k === 't' ? -1 : 1));
  const acc: Cand[] = []; for (const c of cands) { const cl = acc.find((a) => ov(a.s, c.s)); if (!cl || (c.k === 'c' && cl.k === 'c' && cl.s.start === c.s.start && cl.s.end === c.s.end)) acc.push(c); }
  const colHits = acc.filter((a): a is Extract<Cand, { k: 'c' }> => a.k === 'c');
  // a word that is a decode label of the column just mentioned is a value, not a table ("root document type is Invoice")
  const tblHits = acc.filter((a): a is Extract<Cand, { k: 't' }> => a.k === 't').filter((t) => { const w = soft.slice(t.s.start, t.s.end); return !colHits.some((h) => h.s.end <= t.s.start && t.s.start - h.s.end <= 14 && (h.e.column.decode || []).some((x) => { const l = softNormalize(x.label); return l === w || `${l}s` === w; })); });
  const tables: string[] = []; tblHits.sort((a, b) => a.s.start - b.s.start).forEach((h) => { if (!tables.includes(h.e.table.name)) tables.push(h.e.table.name); });
  // tables the user already selected in Manual Selectors are the context for a description that names no table
  if (!tables.length) (opts.contextTables || []).filter((t) => ctx.tableUpper.has(t.toUpperCase())).forEach((t) => tables.push(t));
  if (!tables.length) base.matchedTables.forEach((t) => tables.push(t));
  const inScope = (t: string) => tables.includes(t); const primary = () => tables[0]; const ensure = (t: string) => { if (!inScope(t)) { tables.push(t); add('table', `Added ${t}`); } };
  const resolved: { e: ColumnEntry; s: Span }[] = []; const seen = new Set<string>();
  colHits.forEach((h) => { const k = `${h.s.start}:${h.s.end}`; if (seen.has(k)) return; seen.add(k);
    const same = colHits.filter((o) => o.s.start === h.s.start && o.s.end === h.s.end).map((o) => o.e);
    const best = same.find((c) => c.table === primary()) || same.find((c) => inScope(c.table)) || (same.length === 1 ? same[0] : null); if (!best) return;
    if (!inScope(best.table) && !(/\s/.test(soft.slice(h.s.start, h.s.end)) || !tables.length)) return; ensure(best.table); resolved.push({ e: best, s: h.s }); });
  const colByWords = (w: string, pred: (c: ColumnEntry) => boolean = () => true): ColumnEntry | null => { const n = softNormalize(w).trim(); const c = ctx.columns.filter((x) => pred(x) && inScope(x.table) && x.phrases.some((p) => p === n || findPhrase(n, p).length > 0)); return c.find((x) => x.table === primary()) || c[0] || null; };
  const tableByWords = (w: string): TableEntry | null => { const n = softNormalize(w).trim(); return ctx.tables.find((t) => t.phrases.includes(n)) || null; };

  // decode-value filters (negation, multiple values → IN)
  const filters: FilterCondition[] = []; const dec = new Map<string, { t: string; c: string; raws: string[]; labels: string[]; neg: boolean }>();
  ctx.columns.filter((c) => inScope(c.table) && c.column.decode?.length).forEach((e) => e.column.decode!.forEach((x) => { const l = softNormalize(x.label || ''); if (l.length < 2) return;
    [...findPhrase(soft, l), ...findPhrase(soft, `un${l}`).map((s) => ({ ...s, un: true }))].forEach((s: Span & { un?: boolean }) => {
      if (resolved.some((h) => ov(h.s, s)) || tblHits.some((t) => ov(t.s, s))) return;
      const k = q(e.table, e.column.name); const cur = dec.get(k) || { t: e.table, c: e.column.name, raws: [], labels: [], neg: true }; if (!cur.raws.includes(x.rawValue)) { cur.raws.push(x.rawValue); cur.labels.push(x.label); }
      cur.neg = cur.neg && (!!s.un || /\b(not|non|excluding)\s*$/.test(soft.slice(Math.max(0, s.start - 12), s.start))); dec.set(k, cur); }); }));
  const decs = [...dec.values()]; const near = decs.filter((x) => resolved.some((r) => r.e.table === x.t && r.e.column.name === x.c)); const prim = near.length ? near : decs.filter((x) => x.t === primary());
  (prim.length ? prim : decs.slice(0, 1)).forEach((x) => { const op: FilterOperator = x.raws.length > 1 ? (x.neg ? 'NOT IN' : 'IN') : x.neg ? '<>' : '='; filters.push({ id: makeId('f'), table: x.t, column: x.c, operator: op, value: x.raws.join(','), combinator: 'AND' }); add('filter', `${q(x.t, x.c)} ${op} ${x.raws.join(', ')} (${x.labels.join(', ')})`); });

  // aggregation
  let aggMode = false; const aggs: { agg: string; e: ColumnEntry | null; al: string; expr: string }[] = [];
  // V17.4: a measure named by the user ("total invoice value") may live in a table that is not mentioned yet — find it in the whole Active Schema,
  // scored by entity words, measure synonyms, whether its table is already in scope and how close it is to the primary table through relationships
  const MEASURE = new Set(['amount', 'sum', 'value', 'total', 'cost', 'price', 'spend', 'gross', 'net', 'revenue']);
  const findMeasure = (phrase: string): ColumnEntry | null => {
    const pt = tokenize(phrase); if (!pt.length) return null; const ent = pt.filter((x) => !MEASURE.has(x)); let best: { e: ColumnEntry; sc: number } | null = null;
    ctx.columns.forEach((c) => { if (!isNumericType(c.column.type) || c.column.isPrimaryKey || c.column.isForeignKey) return; const t = ctx.tableUpper.get(c.table.toUpperCase()); const ct = new Set(tokenize(`${c.column.name} ${c.column.label || ''} ${c.column.description || ''} ${c.table} ${t?.table.description || ''}`)); const own = new Set(tokenize(`${c.column.name} ${c.column.label || ''}`));
      const entHit = ent.filter((x) => ct.has(x)).length; if (ent.length && !entHit) return; const meas = pt.some((x) => MEASURE.has(x)) && [...own].some((x) => MEASURE.has(x)); if (!meas && !entHit) return;
      const sc = entHit * 2 + (meas ? 2 : 0) + (inScope(c.table) ? 2 : 0) + (primary() && relationshipDistance(ctx, primary(), c.table) <= 2 ? 1 : 0) + (ent.length && ent.every((x) => own.has(x)) ? 1 : 0); if (sc >= 3 && (!best || sc > best.sc)) best = { e: c, sc }; });
    return best ? (best as { e: ColumnEntry }).e : null; };
  const AGG: [string, RegExp][] = [['COUNT', /\b(?:count(?:\s+of)?|number of|how many)\s+(distinct\s+)?([a-z0-9 ]{2,40})/g], ['AVG', /\b(?:average|avg)\s+(?:of\s+)?()([a-z0-9 ]{2,40})/g], ['SUM', /\b(?:total|sum of|sum)\s+(?:of\s+)?(?:the\s+)?()(?!number\b|count\b)([a-z0-9 ]{2,40})/g], ['MAX', /\b(?:max|maximum)\s+()([a-z0-9 ]{2,40})/g], ['MIN', /\b(?:min|minimum)\s+()([a-z0-9 ]{2,40})/g]];
  const taken: Span[] = [];
  AGG.forEach(([agg, re]) => { re.lastIndex = 0; let m: RegExpExecArray | null; while ((m = re.exec(soft))) {
    const sp = { start: m.index, end: m.index + m[0].length }; if (taken.some((s) => ov(s, sp))) continue;
    if (resolved.some((h) => h.s.start <= m!.index && m!.index < h.s.end && !/^(total|sum|count|average|max|min)\b/.test(soft.slice(h.s.start, h.s.end)))) continue;
    const ph = m[2].split(new RegExp(`\\s${STOP}(\\s|$)`))[0].trim();
    if (agg === 'COUNT') { const t = tableByWords(ph) || tableByWords(ph.split(' ')[0]) || ctx.tableUpper.get((primary() || '').toUpperCase()) || null; if (!t) continue; ensure(t.table.name); const pk = t.pk || t.table.columns[0]; const dd = t.table.name !== primary() || !!m[1]; aggs.push({ agg, e: null, al: alias(t.table.name.split('_').slice(-1)[0], 'COUNT'), expr: `COUNT(${dd ? 'DISTINCT ' : ''}${q(t.table.name, pk.name)})` }); taken.push(sp); aggMode = true; continue; }
    let col = colByWords(ph, (c) => isNumericType(c.column.type) && !c.column.isPrimaryKey && !c.column.isForeignKey);
    if (!col) { col = findMeasure(ph); if (col) ensure(col.table); }
    if (!col && /amount|value|sum|cost/.test(ph)) { const pt = ctx.tableUpper.get((primary() || '').toUpperCase()); const g = pt?.table.columns.find((c) => isNumericType(c.type) && /AMOUNT|TOTAL|VALUE|SUM/i.test(c.name) && !c.isPrimaryKey); if (g) col = ctx.columns.find((x) => x.table === pt!.table.name && x.column.name === g.name) || null; }
    if (!col) continue; aggs.push({ agg, e: col, al: alias(agg === 'SUM' ? 'TOTAL' : agg, col.column.name), expr: `${agg}(${q(col.table, col.column.name)})` }); taken.push(sp); aggMode = true; } });
  const hn = soft.match(new RegExp(`\\bhaving\\s+(more than|over|at least|fewer than|less than)\\s+(${NUM})\\s+([a-z ]{2,30})`));
  if (!aggMode && hn && primary()) { const nt = tableByWords(hn[3].trim().split(' ')[0]); if (nt && nt.table.name !== primary()) { ensure(nt.table.name); const pk = nt.pk || nt.table.columns[0]; aggs.push({ agg: 'COUNT', e: null, al: alias(nt.table.name.split('_').slice(-1)[0], 'COUNT'), expr: `COUNT(DISTINCT ${q(nt.table.name, pk.name)})` }); aggMode = true; } }
  aggs.forEach((a) => add('aggregation', a.expr));

  // grouping
  const groupBy: string[] = []; const groupSel: SelectedColumnSpec[] = [];
  const addG = (t: string, c: string) => { const r = q(t, c); if (groupBy.includes(r)) return; ensure(t); groupBy.push(r); groupSel.push({ id: makeId('col'), table: t, column: c, alias: '', useDecode: false, aggregate: null }); add('group-by', `GROUP BY ${r}`); };
  if (aggMode) {
    const gre = new RegExp(`\\b(?:grouped by|group by|for each|per|by)\\s+(?:each\\s+|the\\s+)?([a-z0-9 ]{2,40}?)(?=\\s${STOP}\\b|[,.;]|$)`, 'g'); let m: RegExpExecArray | null;
    while ((m = gre.exec(soft))) { if (/(sort|sorted|order|ordered)\s*$/.test(soft.slice(Math.max(0, m.index - 10), m.index))) continue; const ph = m[1].trim(); const t = tableByWords(ph);
      const col = ctx.columns.find((x) => (inScope(x.table) || !t) && x.phrases.includes(softNormalize(ph)) && !isNumericType(x.column.type)); if (col) addG(col.table, col.column.name); else if (t) { const dc = t.displayColumn || t.pk; if (dc) addG(t.table.name, dc.name); } }
    if (!groupBy.length) { const tm = soft.match(/\b(?:top|bottom|highest|lowest)\s+(?:\d{1,6}\s+)?([a-z ]{2,30}?)\s+by\b/); const t = tm ? tableByWords(tm[1].trim()) : hn ? ctx.tableUpper.get(primary().toUpperCase()) || null : null; const dc = t ? t.displayColumn || t.pk : null; if (t && dc) addG(t.table.name, dc.name); else if (tm) { const nc = softNormalize(tm[1].trim()); const col = ctx.columns.find((x) => isStringType(x.column.type) && !x.column.decode?.length && x.phrases.includes(nc)); if (col) addG(col.table, col.column.name); } }
  }

  // numeric / string / country conditions
  let having = '';
  resolved.filter((h) => isNumericType(h.e.column.type)).forEach((h) => { const af = soft.slice(h.s.end, h.s.end + 60).replace(/^\s+/, '');
    const bw = af.match(new RegExp(`^(?:is\\s+)?between\\s+(${NUM})\\s+and\\s+(${NUM})`)); if (bw) { filters.push({ id: makeId('f'), table: h.e.table, column: h.e.column.name, operator: 'BETWEEN', value: bw[1].replace(/,/g, ''), value2: bw[2].replace(/,/g, ''), combinator: 'AND' }); add('filter', `${q(h.e.table, h.e.column.name)} BETWEEN`); return; }
    const one = af.match(/^(?:is\s+)?(not\s+)?one of\s+([\d,\s]+)/); if (one) { filters.push({ id: makeId('f'), table: h.e.table, column: h.e.column.name, operator: one[1] ? 'NOT IN' : 'IN', value: one[2].split(/[\s,]+/).filter(Boolean).join(','), combinator: 'AND' }); add('filter', `${q(h.e.table, h.e.column.name)} ${one[1] ? 'NOT IN' : 'IN'}`); return; }
    for (const [re, op] of CMP) { const cm = af.match(re); if (!cm) continue; const n = af.slice(cm[0].length).match(new RegExp(`^\\s*(${NUM})\\b`)); if (!n) continue; filters.push({ id: makeId('f'), table: h.e.table, column: h.e.column.name, operator: op, value: n[1].replace(/,/g, ''), combinator: 'AND' }); add('filter', `${q(h.e.table, h.e.column.name)} ${op} ${n[1]}`); break; } });
  if (aggMode && hn) { const op = /more|over/.test(hn[1]) ? '>' : /least/.test(hn[1]) ? '>=' : '<'; having = `${aggs[aggs.length - 1].expr} ${op} ${hn[2]}`; add('having', `HAVING ${having}`); }
  resolved.filter((h) => isStringType(h.e.column.type) && !h.e.column.decode?.length).forEach((h) => { const af = soft.slice(h.s.end, h.s.end + 80).replace(/^\s+/, ''); const rw = text.replace(/_/g, ' ').replace(/\s+/g, ' ').slice(h.s.end, h.s.end + 80).replace(/^\s+/, '');
    const val = (o: number) => { const r = rw.slice(o).trim(); const qm = r.match(/^['"]([^'"]{1,80})['"]/); if (qm) return qm[1]; const w = r.match(/^([A-Za-z0-9@._\-/]+)/); return w ? w[1] : null; };
    const pf = (op: FilterOperator, v: string) => { filters.push({ id: makeId('f'), table: h.e.table, column: h.e.column.name, operator: op, value: v, combinator: 'AND' }); add('filter', `${q(h.e.table, h.e.column.name)} ${op} ${v}`); };
    let m: RegExpMatchArray | null;
    if (af.match(/^(?:is\s+)?(?:empty|null|missing|blank)\b/)) return pf('IS NULL', ''); if (af.match(/^(?:is\s+)?not\s+(?:empty|null|blank)\b/)) return pf('IS NOT NULL', '');
    if ((m = af.match(/^(?:that\s+)?(?:does\s+not|doesn't)\s+contain\s+/))) { const v = val(m[0].length); if (v) pf('NOT LIKE', `%${v}%`); return; }
    if ((m = af.match(/^(?:that\s+)?(?:contains?|containing|like)\s+/))) { const v = val(m[0].length); if (v) pf('LIKE', `%${v}%`); return; }
    if ((m = af.match(/^(?:starts?|starting)\s+with\s+/))) { const v = val(m[0].length); if (v) pf('LIKE', `${v}%`); return; }
    if ((m = af.match(/^(?:is|=|equals?|named)\s+/))) { const v = val(m[0].length); if (v && !/^(the|a|an|not|null|in|of|one)$/i.test(v) && !tableByWords(v.toLowerCase())) pf('=', countryNameToIso2(v) || v); } });
  // V17.4: "supplier ABC" / "vendor Acme Corp" — a proper name right after an entity word is a filter on that entity's name column (never invented: it is the user's literal)
  const BAD_WORD = /^(and|or|with|for|in|on|the|a|an|from|created|show|list|during|where|that|which|their|its|sorted|ordered|top|last|this|between|since|by|per|of|to|is|are|has|have|all|each|using|including|due|older|newer|than|over|under)$/i;
  const decodeLabels = new Set(ctx.columns.flatMap((c) => (c.column.decode || []).map((d) => softNormalize(d.label))));
  const proper = (r: string): string | null => { const m = r.match(/^((?:[A-Z][\w&.\-]*)(?:\s+[A-Z][\w&.\-]*){0,2}|\d[\w.\-]*)(?=\s|[,.;]|$)/); if (!m) return null; const v = m[1].trim(); const lo = v.toLowerCase(); if (BAD_WORD.test(v.split(/\s+/)[0]) || countryNameToIso2(v) || decodeLabels.has(lo) || ctx.tables.some((t) => t.phrases.includes(lo)) || ctx.columns.some((c) => c.phrases.includes(lo))) return null; return v; };
  const rawAfter = (end: number) => text.replace(/_/g, ' ').replace(/\s+/g, ' ').slice(end, end + 80).replace(/^\s+/, '');
  const nameFilter = (t: string, c: string, v: string) => { if (filters.some((f) => f.table === t && f.column === c)) return; ensure(t); filters.push({ id: makeId('f'), table: t, column: c, operator: '=', value: v, combinator: 'AND' }); add('filter', `${q(t, c)} = ${v}`); };
  resolved.filter((h) => h.s.start > 0 && /NAME$/i.test(h.e.column.name) && isStringType(h.e.column.type) && !h.e.column.decode?.length).forEach((h) => { if (/^(?:is|=|equals?|named|contains?|containing|like|starts?|starting|that|does|doesn't)\b/.test(soft.slice(h.s.end).replace(/^\s+/, ''))) return; const v = proper(rawAfter(h.s.end)); if (v) nameFilter(h.e.table, h.e.column.name, v); });
  tblHits.filter((t) => t.s.start > 0 && t.e.displayColumn && isStringType(t.e.displayColumn.type)).forEach((t) => { if (/^(?:is|=|equals?|named|contains?|containing|like|starts?|starting|that|does|doesn't)\b/.test(soft.slice(t.s.end).replace(/^\s+/, ''))) return; const v = proper(rawAfter(t.s.end)); if (v) nameFilter(t.e.table.name, t.e.displayColumn!.name, v); });
  const ctry = ctx.columns.find((c) => inScope(c.table) && /country/i.test(c.column.name) && Number(c.column.length) <= 3);
  if (ctry && !filters.some((f) => f.column === ctry.column.name)) { const w = soft.replace(/[^a-z ]/g, ' ').split(/\s+/); const iso: string[] = []; for (let i = 0; i < w.length; i++) for (const n of [2, 1]) { const c = countryNameToIso2(w.slice(i, i + n).join(' ')); if (c && !iso.includes(c) && (n > 1 || w[i].length > 3 || ['uk', 'usa'].includes(w[i]))) { iso.push(c); i += n - 1; break; } }
    if (iso.length) { filters.push({ id: makeId('f'), table: ctry.table, column: ctry.column.name, operator: iso.length > 1 ? 'IN' : '=', value: iso.join(','), combinator: 'AND' }); add('filter', `${q(ctry.table, ctry.column.name)} in ${iso.join(', ')} (country names → ISO codes)`); } }

  // date conditions (dialect-aware)
  const dcols = ctx.columns.filter((c) => isDateType(c.column.type) && inScope(c.table) && !/^\s*obsolete/i.test(c.column.description || ''));
  const pickDate = (): ColumnEntry | null => { if (/\bdue\b/.test(soft)) { const x = dcols.find((c) => /DUE/i.test(c.column.name)); if (x) return x; } const nm = resolved.find((r) => isDateType(r.e.column.type)); if (nm) return nm.e; for (const re of [/INVOICE_DATE/i, /^(CREATION_TIME|CREATED(_DATE|_AT)?|CREATION_DATE)$/i, /_DATE$/i]) { const x = dcols.find((c) => c.table === primary() && re.test(c.column.name)); if (x) return x; } return dcols.find((c) => c.table === primary()) || dcols[0] || null; };
  const dc = /\b(today|yesterday|this|current|last|past|previous|between|since|in \d{4})\b/.test(soft) ? pickDate() : null;
  if (dc) { const f = (op: FilterOperator, v: string, v2?: string) => filters.push({ id: makeId('f'), table: dc.table, column: dc.column.name, operator: op, value: v, value2: v2, combinator: 'AND' }); let m: RegExpMatchArray | null; let s = '';
    if ((m = soft.match(/\bbetween\s+(\d{4}-\d{2}-\d{2})\s+and\s+(\d{4}-\d{2}-\d{2})/))) { f('BETWEEN', dateLiteral(m[1], d), dateLiteral(m[2], d)); s = 'between'; }
    else if ((m = soft.match(/\bsince\s+(\d{4}-\d{2}-\d{2})/))) { f('>=', dateLiteral(m[1], d)); s = `since ${m[1]}`; }
    else if ((m = soft.match(/\bin\s+((?:19|20)\d{2})\b/))) { f('>=', dateLiteral(`${m[1]}-01-01`, d)); f('<', dateLiteral(`${+m[1] + 1}-01-01`, d)); s = `in ${m[1]}`; }
    else if ((m = soft.match(/\b(?:last|past|previous)\s+(\d+)\s*(days?|weeks?|months?|years?)\b/))) { f('>=', agoExpr(+m[1], (m[2].startsWith('day') ? 'DAY' : m[2].startsWith('week') ? 'WEEK' : m[2].startsWith('month') ? 'MONTH' : 'YEAR'), d)); s = `last ${m[1]} ${m[2]}`; }
    else if (/\btoday\b/.test(soft)) { f('>=', todayExpr(d)); s = 'today'; }
    else if ((m = soft.match(/\b(?:this|current)\s+(week|month|year)\b/))) { f('>=', startOfExpr(m[1].toUpperCase() as 'WEEK', 0, d)); s = `this ${m[1]}`; }
    else if ((m = soft.match(/\b(?:last|previous)\s+(week|month|year)\b/))) { const u = m[1].toUpperCase() as 'WEEK'; f('>=', startOfExpr(u, 1, d)); f('<', startOfExpr(u, 0, d)); s = `previous ${m[1]}`; }
    if (s) add('date-filter', `${q(dc.table, dc.column.name)} ${s}`); }

  // sorting, limit, distinct, aliases, join type
  const sorts: SortSpec[] = []; let limit: number | null = null; let m2: RegExpMatchArray | null;
  if ((m2 = soft.match(/\b(?:top|first|limit(?:ed)? to|latest|highest|lowest)\s+(\d{1,6})\b(?!\s*(?:days?|weeks?|months?|years?))/))) { limit = +m2[1]; add('limit', `Limit ${limit}`); }
  const aggSort = (desc: boolean) => { const a = aggs.find((x) => x.agg !== 'COUNT') || aggs[0]; if (!a) return; sorts.push({ id: makeId('s'), table: '', column: a.al, direction: desc ? 'DESC' : 'ASC', expression: a.expr }); add('sort', `ORDER BY ${a.expr} ${desc ? 'DESC' : 'ASC'}`); };
  const es = soft.match(/\b(?:sort|sorted|order|ordered)\s+(?:them\s+)?by\s+([a-z0-9 ]{2,40}?)(?:\s+(asc|ascending|desc|descending))?(?=\s+(?:and|with|where|limit|top|using)\b|[,.;]|$)/);
  if (es) { const desc = /desc/.test(es[2] || ''); const col = colByWords(es[1]) || ctx.columns.find((c) => c.phrases.includes(softNormalize(es[1]))) || null; if (col) { ensure(col.table); sorts.push({ id: makeId('s'), table: col.table, column: col.column.name, direction: desc ? 'DESC' : 'ASC' }); add('sort', `ORDER BY ${q(col.table, col.column.name)} ${desc ? 'DESC' : 'ASC'}`); } else if (aggMode) aggSort(desc); }
  else if (aggMode && limit) aggSort(!/\b(bottom|lowest)\b/.test(soft));
  let distinct = !aggMode && /\b(distinct|unique|remove duplicates)\b/.test(soft); if (distinct) add('distinct', 'Remove duplicates (DISTINCT)');
  const tableAliases = /\b(?:with|using|use)\s+(?:short\s+)?(?:table\s+)?alias(?:es)?\b/.test(soft) ? true : undefined; if (tableAliases) add('alias', 'Use table aliases');
  let joinType: JoinType | undefined = /\b(left join|including (?:those|ones|records) without|with or without)\b/.test(soft) ? 'LEFT JOIN' : undefined; if (joinType) add('join', 'Also show records that don\'t have a match (LEFT JOIN)');

  // V17.5 — CASE/DECODE: "status description", "decoded status", "status as text", "… using decode / case". The definition is NEVER written here: the engine
  // reads it from the Active Schema when the SQL is built. A column without a definition is reported, not given an invented one.
  const decodeCols = new Map<string, DecodeStyle>(); const decodeNotes: string[] = [];
  { const wantWord = soft.match(/\b(?:with|using|use|via|through)\s+(?:a\s+|the\s+|schema\s+)?(decode|case)\b/) || soft.match(/\b(decode|decoded)\b/); const globalStyle: DecodeStyle = wantWord && /decode/.test(wantWord[1]) && d === 'Oracle' ? 'decode' : 'case'; let wholeRequestIntent = !!wantWord;
    if (wantWord && wantWord.index !== undefined) taken.push({ start: wantWord.index, end: wantWord.index + wantWord[0].length });
    resolved.filter((h) => h.s.start >= 0).forEach((h) => { const after = soft.slice(h.s.end, h.s.end + 40); const before = soft.slice(Math.max(0, h.s.start - 24), h.s.start);
      const am = after.match(/^\s+(as\s+(?:readable\s+)?(?:text|label|labels|description|descriptions|name|words)|descriptions?|labels?|text|meaning|in\s+words|decoded|readable)\b/); const bm = before.match(/\b(decoded|readable|translated|textual)\s+$/);
      const intent = !!am || !!bm || (wholeRequestIntent && !filters.some((f) => f.table === h.e.table && f.column === h.e.column.name)); if (!intent) return;
      if (am) taken.push({ start: h.s.end + (am.index || 0), end: h.s.end + (am.index || 0) + am[0].length }); if (bm) taken.push({ start: h.s.start - bm[0].length, end: h.s.start });
      const key = q(h.e.table, h.e.column.name); if (h.e.column.decode?.length) decodeCols.set(key, globalStyle); else if (am || bm) decodeNotes.push(`No CASE/DECODE definition is available for ${key} in the active schema — the plain column is shown (nothing was invented).`); }); }
  // learned / Admin Query Library patterns — used as PATTERNS (what to select, group, sort, limit …), never copied; the Active Schema always wins
  const learned: string[] = []; let patternUsed: V17Requirement['patternUsed'];
  const colOk = (c: { table: string; column: string }) => ctx.columns.some((e) => e.table === c.table && e.column.name === c.column);
  const ranked = (opts.hints || []).filter((h) => h.similarity >= 0.6).sort((a, b) => b.similarity * (b.trust ?? 0.5) - a.similarity * (a.trust ?? 0.5) || (b.source === 'admin' ? 1 : 0) - (a.source === 'admin' ? 1 : 0));
  ranked.slice(0, 1).forEach((h) => {
    if (!h.tables.every((t) => ctx.tableUpper.has(t.toUpperCase())) || !h.columns.every(colOk) || !(h.aggregates || []).every(colOk) || !(h.groupBy || []).every(colOk)) { notes.push(`${h.source === 'admin' ? 'An Admin Query Library entry' : 'A learned pattern'} referenced schema elements that no longer exist in the Active Schema and was ignored.`); return; }
    const adopted: string[] = []; const src = h.source === 'admin' ? `Admin query "${h.label}"` : `Learned query "${h.label}"`;
    if (!tables.length) { h.tables.forEach(ensure); adopted.push('tables'); }
    if (!resolved.length && !aggMode && h.columns.some((c) => inScope(c.table))) { h.columns.filter((c) => inScope(c.table)).forEach((c) => { const e = ctx.columns.find((x) => x.table === c.table && x.column.name === c.column); if (e) resolved.push({ e, s: { start: -1, end: -1 } }); }); adopted.push('columns'); }
    const aggWord = /\b(total|sum|count|number of|how many|average|avg|max|maximum|min|minimum)\b/.test(soft);
    // a very similar request to a TRUSTED pattern shares its business concept: bring in the tables the pattern needs (the engine joins them from the schema)
    const strong = h.similarity >= 0.85 && (h.trust ?? 0) >= 0.65;
    if (strong && tables.length && h.tables.some((t) => !inScope(t))) { h.tables.filter((t) => !inScope(t)).forEach(ensure); adopted.push('tables'); }
    if (!aggMode && (aggWord && h.similarity >= 0.7 || strong) && (h.aggregates || []).some((a) => inScope(a.table))) {
      (h.aggregates || []).filter((a) => inScope(a.table)).forEach((a) => { const e = ctx.columns.find((x) => x.table === a.table && x.column.name === a.column);
        if (a.agg === 'COUNT' || !e) aggs.push({ agg: 'COUNT', e: null, al: alias(a.table.split('_').slice(-1)[0], 'COUNT'), expr: `COUNT(${a.distinct ? 'DISTINCT ' : ''}${q(a.table, a.column)})` });
        else aggs.push({ agg: a.agg, e, al: alias(a.agg === 'SUM' ? 'TOTAL' : a.agg, a.column), expr: `${a.agg}(${q(a.table, a.column)})` }); });
      aggMode = true; aggs.forEach((a) => add('aggregation', a.expr)); (h.groupBy || []).filter((g) => inScope(g.table)).forEach((g) => addG(g.table, g.column));
      if (h.sortOnAggregate && !sorts.length) aggSort(h.sortOnAggregate === 'DESC'); adopted.push('aggregation', 'grouping'); }
    if (aggMode && !groupBy.length && h.similarity >= 0.7 && (h.groupBy || []).some((g) => inScope(g.table))) { (h.groupBy || []).filter((g) => inScope(g.table)).forEach((g) => addG(g.table, g.column)); adopted.push('grouping'); if (h.sortOnAggregate && !sorts.length) { aggSort(h.sortOnAggregate === 'DESC'); adopted.push('sorting'); } }
    // V17.5: columns the pattern showed through a schema CASE/DECODE — adopted only when the Active Schema STILL defines that decode
    (h.decodes || []).filter((x) => inScope(x.table) && resolved.some((r) => r.e.table === x.table && r.e.column.name === x.column) && (h.similarity >= 0.8 || adopted.includes('columns'))).forEach((x) => { const e0 = ctx.columns.find((c) => c.table === x.table && c.column.name === x.column); const key = q(x.table, x.column); if (e0?.column.decode?.length) { if (!decodeCols.has(key)) { decodeCols.set(key, x.style === 'decode' && d === 'Oracle' ? 'decode' : 'case'); adopted.push('CASE/DECODE'); } } else notes.push(`${src} showed ${key} through a CASE/DECODE, but the Active Schema has no definition for it — the plain column is shown.`); });
    if (limit === null && h.options.limit) { limit = h.options.limit; adopted.push('row limit'); }
    if (!sorts.length && (h.options.sorts || []).some((s) => inScope(s.table))) { (h.options.sorts || []).filter((s) => inScope(s.table)).forEach((s) => sorts.push({ id: makeId('s'), ...s })); adopted.push('sorting'); }
    if (!aggMode && !distinct && h.distinct && h.similarity >= 0.8) { distinct = true; adopted.push('DISTINCT'); }
    if (!joinType && h.joinType && h.similarity >= 0.8 && tables.length > 1) { joinType = h.joinType; adopted.push(`${h.joinType}`); }
    const fs = (h.filterShapes || []).filter((f) => inScope(f.table) && !filters.some((x) => x.table === f.table && x.column === f.column));
    if (fs.length) notes.push(`${src} also filters on ${fs.slice(0, 3).map((f) => `${f.table}.${f.column}`).join(', ')} — add a filter in Manual Selectors if you need it.`);
    learned.push(h.patternId); patternUsed = { source: h.source || 'learned', label: h.label || '', similarity: h.similarity, id: h.patternId, tier: h.tier, adopted }; add('learned', `Adapted ${src} (${adopted.join(', ') || 'matched — nothing needed to be adapted'})`); });
  tables.slice(1).forEach((t) => { if (relationshipDistance(ctx, primary(), t) === Infinity) notes.push(`No relationship path was found between ${primary()} and ${t} in the Active Schema.`); });

  let cols: SelectedColumnSpec[];
  if (aggMode) cols = [...groupSel, ...aggs.map((a) => (a.e && a.agg !== 'COUNT' ? { id: makeId('col'), table: a.e.table, column: a.e.column.name, alias: a.al, useDecode: false, aggregate: a.agg as 'SUM' } : { id: makeId('col'), table: primary(), column: a.al, alias: a.al, useDecode: false, aggregate: null, manualExpr: `${a.expr} AS ${a.al}` }))];
  else { const s2 = new Set<string>(); cols = resolved.filter((h) => inScope(h.e.table)).filter((h) => { const k = q(h.e.table, h.e.column.name); if (s2.has(k)) return false; s2.add(k); return true; }).map((h) => { const dk = decodeCols.get(q(h.e.table, h.e.column.name)); return { id: makeId('col'), table: h.e.table, column: h.e.column.name, alias: '', useDecode: !!dk, aggregate: null, ...(dk ? { displayMode: 'schema-decode' as const, decodeStyle: dk } : {}) }; });
      if (decodeCols.size) add('decode', `CASE/DECODE from the schema: ${[...decodeCols.keys()].join(', ')}`);
    if (cols.length && cols.every((c) => filters.some((f) => f.table === c.table && f.column === c.column) || sorts.some((s) => s.table === c.table && s.column === c.column))) cols = []; }
  // V17.4: output the user asked for in words ("with their invoice number, gross amount and status") that matches no column of the Active Schema is REPORTED, never invented
  { const lre = /\b(?:with their|with its|with the|including their|including the|including|showing their|showing|displaying|display|returning|return)\s+([a-z][a-z0-9 ,]{2,90}?)(?=\s+(?:for|where|in|during|sorted|ordered|order|from|since|between|last|this|per|by|limit|top|created|due|that|which|using|from)\b|[.;]|$)/g; let lm: RegExpExecArray | null;
    const wordCovered = (a: number, b: number, w: string) => resolved.some((h) => h.s.start < b && a < h.s.end) || taken.some((s) => s.start < b && a < s.end) || tblHits.some((t) => t.s.start < b && a < t.s.end) || decodeLabels.has(w) || /^(of|the|and|a|an|their|its|all)$/.test(w);
    while ((lm = lre.exec(soft))) { const start = lm.index + lm[0].length - lm[1].length; const seg = lm[1]; const parts: { t: string; a: number }[] = []; const sre = /\s*(?:,|\band\b)\s*/g; let sm: RegExpExecArray | null; let last = 0; while ((sm = sre.exec(seg))) { parts.push({ t: seg.slice(last, sm.index), a: last }); last = sm.index + sm[0].length; } parts.push({ t: seg.slice(last), a: last });
      parts.forEach((p) => { const item = p.t.replace(/^(?:the|their|its|a|an)\s+/, '').trim(); if (!item || item.split(' ').length > 4 || /\d|^(?:more|less|at least|at most|over|under|fewer|greater|only|each|every|no)\b|\b(?:alias|aliases|table|tables|column|columns|details|information|info|data|everything)\b/.test(item) || gaps.some((g) => softNormalize(g) === item)) return;
        let off = start + p.a; const unresolvedWord = item.split(' ').some((w) => { const a = soft.indexOf(w, off); const b = a + w.length; off = b; return !wordCovered(a, b, w); }); if (unresolvedWord && !gaps.includes(item)) gaps.push(item); }); } }
  decodeNotes.forEach((n) => notes.push(n));
  if (!tables.length) notes.push('The offline model could not identify any table from the Active Schema in this description — mention a table or business term.');
  if (gaps.length) notes.push(`Not found in the Active Schema (not invented): ${gaps.join(', ')}.`);
  return { ...out, matchedTables: tables, matchedColumns: cols, matchedFilters: filters, matchedSorts: sorts, limit, distinct, confidence: tables.length ? (gaps.length ? 0.5 : 0.75) : 0.1, notes, unresolvedTerms: gaps, groupBy, having, aggregateMode: aggMode, autoOptions: auto, schemaGaps: gaps, learnedPatternIds: learned, patternUsed, joinType, tableAliases };
}
