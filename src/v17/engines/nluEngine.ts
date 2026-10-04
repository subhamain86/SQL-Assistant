/** Offline self-training NLU for "Describe What You Need" — primary engine, no network. Grounded only in the Active Schema. */
import type { SchemaModel, QueryRequirement, SelectedColumnSpec, FilterCondition, SortSpec, Dialect, FilterOperator, JoinType } from '../../types';
import { parseRequirement } from '../../engines/nlpEngine';
import { makeId } from '../../utils/id';
import { getSchemaContext, softNormalize, findPhrase, isNumericType, isDateType, isStringType, type ColumnEntry, type TableEntry } from './schemaContext';
import { agoExpr, startOfExpr, dateLiteral } from './dateExpressions';
import { countryNameToIso2 } from './countryCodes';
export interface AutoOption { kind: string; description: string; }
export interface LearnedHint { patternId: string; similarity: number; tables: string[]; columns: { table: string; column: string }[]; options: { limit?: number | null; sorts?: { table: string; column: string; direction: 'ASC' | 'DESC' }[] }; }
export interface V17Requirement extends QueryRequirement { groupBy: string[]; having: string; aggregateMode: boolean; autoOptions: AutoOption[]; schemaGaps: string[]; learnedPatternIds: string[]; joinType?: JoinType; }
interface Span { start: number; end: number; }
const NUM = String.raw`-?\d[\d,]*(?:\.\d+)?`;
const STOP = '(?:and|or|with|where|for|in|during|since|from|order|sorted|sort|having|top|limit|last|this|between|over|which|that|by|per|of|on|created|due)';
const CMP: [RegExp, FilterOperator][] = [[/^(?:is\s+)?(?:at least|>=)/, '>='], [/^(?:is\s+)?(?:at most|<=)/, '<='], [/^(?:is\s+)?(?:greater than|more than|above|over|>)/, '>'], [/^(?:is\s+)?(?:less than|below|under|<)/, '<'], [/^(?:is\s+)?(?:equal to|equals|=|is)/, '=']];
const ov = (a: Span, b: Span) => a.start < b.end && b.start < a.end;
const q = (t: string, c: string) => `${t}.${c}`;
const alias = (p: string, c: string) => `${p}_${c}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').slice(0, 30);

export function runOfflineNlu(raw: string, schema: SchemaModel, opts: { dialect: Dialect; hints?: LearnedHint[] }): V17Requirement {
  const ctx = getSchemaContext(schema); const base = parseRequirement(raw, schema); const text = raw.trim(); const d = opts.dialect;
  const out: V17Requirement = { ...base, groupBy: [], having: '', aggregateMode: false, autoOptions: [], schemaGaps: [], learnedPatternIds: [] };
  if (!text) return out;
  const soft = softNormalize(text); const auto: AutoOption[] = []; const add = (kind: string, description: string) => auto.push({ kind, description }); const notes: string[] = [];
  const known = new Set([...schema.tables.map((t) => t.name.toUpperCase()), ...schema.tables.flatMap((t) => t.columns.map((c) => c.name.toUpperCase()))]);
  const gaps = (text.match(/\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/g) || []).filter((x) => !known.has(x.toUpperCase()));
  let masked = soft; gaps.forEach((g) => { const p = softNormalize(g); masked = masked.split(p).join(' '.repeat(p.length)); });
  type Cand = { k: 't'; e: TableEntry; s: Span } | { k: 'c'; e: ColumnEntry; s: Span };
  const cands: Cand[] = [];
  ctx.tables.forEach((e) => e.phrases.forEach((p) => findPhrase(masked, p).forEach((s) => cands.push({ k: 't', e, s }))));
  ctx.columns.forEach((e) => e.phrases.forEach((p) => { if (/^(id|no|name|code)$/.test(p)) return; findPhrase(masked, p).forEach((s) => cands.push({ k: 'c', e, s })); }));
  cands.sort((a, b) => (b.s.end - b.s.start) - (a.s.end - a.s.start) || (a.k === b.k ? 0 : a.k === 't' ? -1 : 1));
  const acc: Cand[] = []; for (const c of cands) { const cl = acc.find((a) => ov(a.s, c.s)); if (!cl || (c.k === 'c' && cl.k === 'c' && cl.s.start === c.s.start && cl.s.end === c.s.end)) acc.push(c); }
  const colHits = acc.filter((a): a is Extract<Cand, { k: 'c' }> => a.k === 'c');
  const tblHits = acc.filter((a): a is Extract<Cand, { k: 't' }> => a.k === 't').filter((t) => { const w = soft.slice(t.s.start, t.s.end); return !colHits.some((h) => h.s.end <= t.s.start && t.s.start - h.s.end <= 14 && (h.e.column.decode || []).some((x) => { const l = softNormalize(x.label); return l === w || `${l}s` === w; })); });
  const tables: string[] = []; tblHits.sort((a, b) => a.s.start - b.s.start).forEach((h) => { if (!tables.includes(h.e.table.name)) tables.push(h.e.table.name); });
  if (!tables.length) base.matchedTables.forEach((t) => tables.push(t));
  const inScope = (t: string) => tables.includes(t); const primary = () => tables[0]; const ensure = (t: string) => { if (!inScope(t)) tables.push(t); };
  const resolved: { e: ColumnEntry; s: Span }[] = []; const seen = new Set<string>();
  colHits.forEach((h) => { const k = `${h.s.start}:${h.s.end}`; if (seen.has(k)) return; seen.add(k);
    const same = colHits.filter((o) => o.s.start === h.s.start && o.s.end === h.s.end).map((o) => o.e);
    const best = same.find((c) => c.table === primary()) || same.find((c) => inScope(c.table)) || (same.length === 1 ? same[0] : null); if (!best) return;
    if (!inScope(best.table) && !(/\s/.test(soft.slice(h.s.start, h.s.end)) || !tables.length)) return; ensure(best.table); resolved.push({ e: best, s: h.s }); });
  const colByWords = (w: string, pred: (c: ColumnEntry) => boolean = () => true): ColumnEntry | null => { const n = softNormalize(w).trim(); const c = ctx.columns.filter((x) => pred(x) && inScope(x.table) && x.phrases.some((p) => p === n || findPhrase(n, p).length > 0)); return c.find((x) => x.table === primary()) || c[0] || null; };
  const tableByWords = (w: string): TableEntry | null => { const n = softNormalize(w).trim(); return ctx.tables.find((t) => t.phrases.includes(n)) || null; };

  // decode-value filters
  const filters: FilterCondition[] = []; const dec = new Map<string, { t: string; c: string; raws: string[]; neg: boolean }>();
  ctx.columns.filter((c) => inScope(c.table) && c.column.decode?.length).forEach((e) => e.column.decode!.forEach((x) => { const l = softNormalize(x.label || ''); if (l.length < 2) return;
    [...findPhrase(soft, l), ...findPhrase(soft, `un${l}`).map((s) => ({ ...s, un: true }))].forEach((s: Span & { un?: boolean }) => {
      if (resolved.some((h) => ov(h.s, s)) || tblHits.some((t) => ov(t.s, s))) return;
      const k = q(e.table, e.column.name); const cur = dec.get(k) || { t: e.table, c: e.column.name, raws: [], neg: true }; if (!cur.raws.includes(x.rawValue)) cur.raws.push(x.rawValue);
      cur.neg = cur.neg && (!!s.un || /\b(not|non|excluding)\s*$/.test(soft.slice(Math.max(0, s.start - 12), s.start))); dec.set(k, cur); }); }));
  const decs = [...dec.values()]; const prim = decs.filter((x) => x.t === primary());
  (prim.length ? prim : decs.slice(0, 1)).forEach((x) => { const op: FilterOperator = x.raws.length > 1 ? (x.neg ? 'NOT IN' : 'IN') : x.neg ? '<>' : '='; filters.push({ id: makeId('f'), table: x.t, column: x.c, operator: op, value: x.raws.join(','), combinator: 'AND' }); add('filter', `${q(x.t, x.c)} ${op} ${x.raws.join(', ')}`); });

  // aggregation
  let aggMode = false; const aggs: { agg: string; e: ColumnEntry | null; al: string; expr: string }[] = [];
  const AGG: [string, RegExp][] = [['COUNT', /\b(?:count(?:\s+of)?|number of|how many)\s+(distinct\s+)?([a-z0-9 ]{2,40})/g], ['AVG', /\b(?:average|avg)\s+(?:of\s+)?()([a-z0-9 ]{2,40})/g], ['SUM', /\b(?:total|sum of|sum)\s+(?:of\s+)?(?:the\s+)?()(?!number\b|count\b)([a-z0-9 ]{2,40})/g], ['MAX', /\b(?:max|maximum)\s+()([a-z0-9 ]{2,40})/g], ['MIN', /\b(?:min|minimum)\s+()([a-z0-9 ]{2,40})/g]];
  const taken: Span[] = [];
  AGG.forEach(([agg, re]) => { re.lastIndex = 0; let m: RegExpExecArray | null; while ((m = re.exec(soft))) {
    const sp = { start: m.index, end: m.index + m[0].length }; if (taken.some((s) => ov(s, sp))) continue;
    if (resolved.some((h) => h.s.start <= m!.index && m!.index < h.s.end && !/^(total|sum|count|average|max|min)\b/.test(soft.slice(h.s.start, h.s.end)))) continue;
    const ph = m[2].split(new RegExp(`\\s${STOP}(\\s|$)`))[0].trim();
    if (agg === 'COUNT') { const t = tableByWords(ph) || tableByWords(ph.split(' ')[0]) || ctx.tableUpper.get((primary() || '').toUpperCase()) || null; if (!t) continue; ensure(t.table.name); const pk = t.pk || t.table.columns[0]; const dd = t.table.name !== primary() || !!m[1]; aggs.push({ agg, e: null, al: alias(t.table.name.split('_').slice(-1)[0], 'COUNT'), expr: `COUNT(${dd ? 'DISTINCT ' : ''}${q(t.table.name, pk.name)})` }); taken.push(sp); aggMode = true; continue; }
    let col = colByWords(ph, (c) => isNumericType(c.column.type) && !c.column.isPrimaryKey && !c.column.isForeignKey);
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
    if (!groupBy.length) { const tm = soft.match(/\b(?:top|bottom|highest|lowest)\s+(?:\d{1,6}\s+)?([a-z ]{2,30}?)\s+by\b/); const t = tm ? tableByWords(tm[1].trim()) : hn ? ctx.tableUpper.get(primary().toUpperCase()) || null : null; const dc = t ? t.displayColumn || t.pk : null; if (t && dc) addG(t.table.name, dc.name); }
  }

  // numeric / string / country / null conditions
  let having = '';
  resolved.filter((h) => isNumericType(h.e.column.type)).forEach((h) => { const af = soft.slice(h.s.end, h.s.end + 60).replace(/^\s+/, '');
    const bw = af.match(new RegExp(`^(?:is\\s+)?between\\s+(${NUM})\\s+and\\s+(${NUM})`)); if (bw) { filters.push({ id: makeId('f'), table: h.e.table, column: h.e.column.name, operator: 'BETWEEN', value: bw[1].replace(/,/g, ''), value2: bw[2].replace(/,/g, ''), combinator: 'AND' }); return; }
    for (const [re, op] of CMP) { const cm = af.match(re); if (!cm) continue; const n = af.slice(cm[0].length).match(new RegExp(`^\\s*(${NUM})\\b`)); if (!n) continue; filters.push({ id: makeId('f'), table: h.e.table, column: h.e.column.name, operator: op, value: n[1].replace(/,/g, ''), combinator: 'AND' }); add('filter', `${q(h.e.table, h.e.column.name)} ${op} ${n[1]}`); break; } });
  if (aggMode && hn) { const op = /more|over/.test(hn[1]) ? '>' : /least/.test(hn[1]) ? '>=' : '<'; having = `${aggs[aggs.length - 1].expr} ${op} ${hn[2]}`; add('having', `HAVING ${having}`); }
  resolved.filter((h) => isStringType(h.e.column.type) && !h.e.column.decode?.length).forEach((h) => { const af = soft.slice(h.s.end, h.s.end + 80).replace(/^\s+/, ''); const rw = text.replace(/_/g, ' ').replace(/\s+/g, ' ').slice(h.s.end, h.s.end + 80).replace(/^\s+/, '');
    const val = (o: number) => { const r = rw.slice(o).trim(); const qm = r.match(/^['"]([^'"]{1,80})['"]/); if (qm) return qm[1]; const w = r.match(/^([A-Za-z0-9@._\-/]+)/); return w ? w[1] : null; };
    const pf = (op: FilterOperator, v: string) => { filters.push({ id: makeId('f'), table: h.e.table, column: h.e.column.name, operator: op, value: v, combinator: 'AND' }); add('filter', `${q(h.e.table, h.e.column.name)} ${op} ${v}`); };
    let m: RegExpMatchArray | null;
    if (af.match(/^(?:is\s+)?(?:empty|null|missing|blank)\b/)) return pf('IS NULL', ''); if (af.match(/^(?:is\s+)?not\s+(?:empty|null|blank)\b/)) return pf('IS NOT NULL', '');
    if ((m = af.match(/^(?:that\s+)?(?:contains?|containing|like)\s+/))) { const v = val(m[0].length); if (v) pf('LIKE', `%${v}%`); return; }
    if ((m = af.match(/^(?:is|=|equals?|named)\s+/))) { const v = val(m[0].length); if (v && !/^(the|a|an|not|null|in|of)$/i.test(v) && !tableByWords(v.toLowerCase())) pf('=', countryNameToIso2(v) || v); } });
  const ctry = ctx.columns.find((c) => inScope(c.table) && /country/i.test(c.column.name) && Number(c.column.length) <= 3);
  if (ctry && !filters.some((f) => f.column === ctry.column.name)) { const w = soft.replace(/[^a-z ]/g, ' ').split(/\s+/); const iso: string[] = []; for (let i = 0; i < w.length; i++) for (const n of [2, 1]) { const c = countryNameToIso2(w.slice(i, i + n).join(' ')); if (c && !iso.includes(c) && (n > 1 || w[i].length > 3 || ['uk', 'usa'].includes(w[i]))) { iso.push(c); i += n - 1; break; } }
    if (iso.length) { filters.push({ id: makeId('f'), table: ctry.table, column: ctry.column.name, operator: iso.length > 1 ? 'IN' : '=', value: iso.join(','), combinator: 'AND' }); add('filter', `${q(ctry.table, ctry.column.name)} in ${iso.join(', ')} (country names → ISO codes)`); } }

  // date conditions
  const dcols = ctx.columns.filter((c) => isDateType(c.column.type) && inScope(c.table) && !/^\s*obsolete/i.test(c.column.description || ''));
  const pickDate = (): ColumnEntry | null => { if (/\bdue\b/.test(soft)) { const x = dcols.find((c) => /DUE/i.test(c.column.name)); if (x) return x; } const nm = resolved.find((r) => isDateType(r.e.column.type)); if (nm) return nm.e; for (const re of [/INVOICE_DATE/i, /^(CREATION_TIME|CREATED(_DATE|_AT)?|CREATION_DATE)$/i, /_DATE$/i]) { const x = dcols.find((c) => c.table === primary() && re.test(c.column.name)); if (x) return x; } return dcols.find((c) => c.table === primary()) || dcols[0] || null; };
  const dc = /\b(today|this|current|last|past|previous|between|since|in \d{4})\b/.test(soft) ? pickDate() : null;
  if (dc) { const f = (op: FilterOperator, v: string, v2?: string) => filters.push({ id: makeId('f'), table: dc.table, column: dc.column.name, operator: op, value: v, value2: v2, combinator: 'AND' }); let m: RegExpMatchArray | null; let s = '';
    if ((m = soft.match(/\bbetween\s+(\d{4}-\d{2}-\d{2})\s+and\s+(\d{4}-\d{2}-\d{2})/))) { f('BETWEEN', dateLiteral(m[1], d), dateLiteral(m[2], d)); s = 'between'; }
    else if ((m = soft.match(/\bin\s+((?:19|20)\d{2})\b/))) { f('>=', dateLiteral(`${m[1]}-01-01`, d)); f('<', dateLiteral(`${+m[1] + 1}-01-01`, d)); s = `in ${m[1]}`; }
    else if ((m = soft.match(/\b(?:last|past|previous)\s+(\d+)\s*(days?|weeks?|months?|years?)\b/))) { f('>=', agoExpr(+m[1], (m[2].startsWith('day') ? 'DAY' : m[2].startsWith('week') ? 'WEEK' : m[2].startsWith('month') ? 'MONTH' : 'YEAR'), d)); s = `last ${m[1]} ${m[2]}`; }
    else if ((m = soft.match(/\b(?:this|current)\s+(week|month|year)\b/))) { f('>=', startOfExpr(m[1].toUpperCase() as 'WEEK', d)); s = `this ${m[1]}`; }
    if (s) add('date-filter', `${q(dc.table, dc.column.name)} ${s}`); }

  // sorting, limit, distinct, join type
  const sorts: SortSpec[] = []; let limit: number | null = null; let m2: RegExpMatchArray | null;
  if ((m2 = soft.match(/\b(?:top|first|limit(?:ed)? to|latest|highest|lowest)\s+(\d{1,6})\b(?!\s*(?:days?|weeks?|months?|years?))/))) { limit = +m2[1]; add('limit', `Limit ${limit}`); }
  const aggSort = (desc: boolean) => { const a = aggs.find((x) => x.agg !== 'COUNT') || aggs[0]; if (!a) return; sorts.push({ id: makeId('s'), table: '', column: a.al, direction: desc ? 'DESC' : 'ASC', expression: a.expr }); };
  const es = soft.match(/\b(?:sort|sorted|order|ordered)\s+(?:them\s+)?by\s+([a-z0-9 ]{2,40}?)(?:\s+(asc|ascending|desc|descending))?(?=\s+(?:and|with|where|limit|top)\b|[,.;]|$)/);
  if (es) { const desc = /desc/.test(es[2] || ''); const col = colByWords(es[1]) || ctx.columns.find((c) => c.phrases.includes(softNormalize(es[1]))) || null; if (col) { ensure(col.table); sorts.push({ id: makeId('s'), table: col.table, column: col.column.name, direction: desc ? 'DESC' : 'ASC' }); add('sort', `ORDER BY ${q(col.table, col.column.name)}`); } else if (aggMode) aggSort(desc); }
  else if (aggMode && limit) aggSort(!/\b(bottom|lowest)\b/.test(soft));
  const distinct = !aggMode && /\b(distinct|unique)\b/.test(soft);
  const joinType: JoinType | undefined = /\b(left join|including (?:those|ones) without|with or without)\b/.test(soft) ? 'LEFT JOIN' : undefined;

  // learned patterns (hints only; Active Schema wins)
  const learned: string[] = [];
  (opts.hints || []).filter((h) => h.similarity >= 0.6).slice(0, 1).forEach((h) => {
    if (!h.tables.every((t) => ctx.tableUpper.has(t.toUpperCase())) || !h.columns.every((c) => ctx.columns.some((e) => e.table === c.table && e.column.name === c.column))) { notes.push('A learned pattern referenced schema elements that no longer exist in the Active Schema and was ignored.'); return; }
    if (!tables.length) h.tables.forEach(ensure); if (limit === null && h.options.limit) limit = h.options.limit;
    if (!sorts.length) (h.options.sorts || []).filter((s) => inScope(s.table)).forEach((s) => sorts.push({ id: makeId('s'), ...s })); learned.push(h.patternId); add('learned', 'Applied learned pattern.'); });

  let cols: SelectedColumnSpec[];
  if (aggMode) cols = [...groupSel, ...aggs.map((a) => (a.e && a.agg !== 'COUNT' ? { id: makeId('col'), table: a.e.table, column: a.e.column.name, alias: a.al, useDecode: false, aggregate: a.agg as 'SUM' } : { id: makeId('col'), table: primary(), column: a.al, alias: a.al, useDecode: false, aggregate: null, manualExpr: `${a.expr} AS ${a.al}` }))];
  else { const s2 = new Set<string>(); cols = resolved.filter((h) => inScope(h.e.table)).filter((h) => { const k = q(h.e.table, h.e.column.name); if (s2.has(k)) return false; s2.add(k); return true; }).map((h) => ({ id: makeId('col'), table: h.e.table, column: h.e.column.name, alias: '', useDecode: false, aggregate: null }));
    if (cols.length && cols.every((c) => filters.some((f) => f.table === c.table && f.column === c.column) || sorts.some((s) => s.table === c.table && s.column === c.column))) cols = []; }
  if (!tables.length) notes.push('The offline model could not identify any table from the Active Schema in this description.');
  return { ...out, matchedTables: tables, matchedColumns: cols, matchedFilters: filters, matchedSorts: sorts, limit, distinct, confidence: tables.length ? 0.7 : 0.1, notes, unresolvedTerms: gaps, groupBy, having, aggregateMode: aggMode, autoOptions: auto, schemaGaps: gaps, learnedPatternIds: learned, joinType };
}
