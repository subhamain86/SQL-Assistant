import type { CrQueryState, SchemaModel, CrValuePair, FilterCondition } from '../types';
import { renderFilterClause } from './filterEngine';
import { makeId } from '../utils/id';
const fv = (r: string) => { const t = r.trim(); if (!t) return 'NULL'; if (/^-?\d+(\.\d+)?$/.test(t)) return t; if (/^(sysdate|current_date|current_timestamp)$/i.test(t)) return t.toUpperCase(); return `'${t.replace(/'/g, "''")}'`; };
export function buildCrSQL(s: CrQueryState): string {
  if (!s.table) return '-- Choose a table for this Change Request.';
  const w = s.filters.map((f, i) => `${i ? `${f.combinator} ` : ''}${renderFilterClause(f.table, f.column, f.operator, f.value, f.value2)}`).join('\n  ');
  if (s.queryType !== 'INSERT' && !w && !s.confirmNoWhere) return '-- A WHERE condition is required to identify which records should be updated or deleted.';
  const tail = w ? `\nWHERE ${w};` : ';\n-- No WHERE condition (explicitly confirmed) — this will affect ALL rows.';
  if (s.queryType === 'INSERT') return s.values.length ? `INSERT INTO ${s.table} (${s.values.map((v) => v.column).join(', ')})\nVALUES (${s.values.map((v) => fv(v.value)).join(', ')});` : '-- Add at least one column/value pair.';
  if (s.queryType === 'UPDATE') return s.values.length ? `UPDATE ${s.table}\nSET ${s.values.map((v) => `${v.column} = ${fv(v.value)}`).join(',\n  ')}${tail}` : '-- Add at least one column/value pair.';
  return `DELETE FROM ${s.table}${tail}`;
}
/**
 * Interprets a CR description against the Active Schema: command, table, SET values (incl. decode labels) and WHERE (incl. "is one of").
 * V17.7.2 root-cause corrections (each verified with a failing example first, test/v1772.test.mjs):
 *   · values were read from the LOWER-CASED description and cut at the first space — "vendor name to Acme Corp" produced 'acme', "status to A" produced 'a', "country = FI" produced 'fi'. Values keep the case the user typed;
 *     'quoted values' and values with spaces are read whole; a decode label (case-insensitive) is turned into its code;
 *   · the command was decided by a fixed priority (any "set" made it an UPDATE) — the FIRST command word of the description decides;
 *   · the table was found with a plain substring test (IA_INVOICE inside IA_INVOICE_LINE) and could be a view — whole names only, longest first, views are reported and never used;
 *   · assignments to a column the table does not have were dropped silently — they are reported (unknownColumns) so the Result card can say so.
 * Nothing here invents a table, column or value: every column comes from the chosen table; every value is the user's literal or a decode code of that column.
 */
const CMD: [CrQueryState['queryType'], RegExp][] = [['UPDATE', /\b(update|change|set|mark|modify)\b/i], ['INSERT', /\b(insert|add|create)\b/i], ['DELETE', /\b(delete|remove)\b/i]];
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unq = (v: string) => { const t = v.trim().replace(/[.;]+$/, '').trim(); const m = t.match(/^(['"])(.*)\1$/s); return m ? m[2] : t; };
export function parseCrDescription(text: string, schema: SchemaModel): { queryType: CrQueryState['queryType'] | null; table: string | null; values: CrValuePair[]; filters: FilterCondition[]; notes: string[]; unknownColumns: string[]; valueWarnings: string[]; viewRejected: string | null } {
  const l = text.toLowerCase(); const notes: string[] = []; const unknownColumns: string[] = []; const valueWarnings: string[] = [];
  let queryType: CrQueryState['queryType'] | null = null; let at = Infinity; for (const [k, re] of CMD) { const m = re.exec(text); if (m && m.index < at) { at = m.index; queryType = k; } }
  const norm = (x: string) => x.toLowerCase().replace(/_/g, ' ');
  const whole = (name: string) => new RegExp(`(?<![A-Za-z0-9_$#])${esc(name)}(?![A-Za-z0-9_$#])`, 'i').test(text);
  const byLen = [...schema.tables].sort((a, b) => b.name.length - a.name.length); const isView = (x: { objectType?: string }) => x.objectType === 'VIEW';
  const pick = (pool: typeof byLen) => pool.find((x) => whole(x.name)) || pool.find((x) => new RegExp(`(?<![a-z0-9])${esc(norm(x.name)).replace(/ /g, '\\s+')}(?![a-z0-9])`).test(l)) || pool.find((x) => { const w = norm(x.name).split(' ').filter((y) => !['header', 'line', 'ia', 'pp', 'adm'].includes(y)); return w.length > 0 && w.every((y) => l.includes(y.replace(/s$/, ''))); }) || null;
  const exact = byLen.find((x) => whole(x.name)); // the user typed a real object name: that object decides — a view is refused, never swapped for a similarly named table
  const t = exact ? (isView(exact) ? null : exact) : pick(byLen.filter((x) => !isView(x))); const v = t ? null : exact && isView(exact) ? exact : pick(byLen.filter(isView)); const viewRejected = v ? v.name : null;
  const values: CrValuePair[] = []; const filters: FilterCondition[] = [];
  if (t) {
    const wi = text.search(/\bwhere\b/i); const setPart = wi >= 0 ? text.slice(0, wi) : text; const wherePart = wi >= 0 ? text.slice(wi + 5) : '';
    const phr = (c: { name: string; label?: string }) => Array.from(new Set([norm(c.name), c.label ? norm(c.label) : ''].filter(Boolean))).sort((a, b) => b.length - a.length);
    const alt = t.columns.flatMap((c) => phr(c).map((p) => `${esc(p).replace(/ /g, '\\s+')}|${esc(p).replace(/ /g, '_')}`)).filter((x, i, a) => a.indexOf(x) === i).join('|') || '(?!)';
    const colOf = (frag: string) => { const f = norm(frag).replace(/\s+/g, ' ').trim(); return t.columns.find((c) => phr(c).includes(f)); };
    const stopAt = `(?=\\s*,\\s*(?:${alt})\\s+(?:to(?![A-Za-z0-9_])|=)|\\s+and\\s+(?:${alt}|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+)\\s+(?:to(?![A-Za-z0-9_])|=)|\\s+(?:where|for|when|with|on|in)\\s|\\s*;|\\s*$)`;
    const asg = new RegExp(`(?<![A-Za-z0-9_])(${alt})\\s+(?:to|=)\\s+('[^']*'|"[^"]*"|.+?)${stopAt}`, 'gi'); let m: RegExpExecArray | null;
    if (queryType !== 'DELETE') while ((m = asg.exec(setPart))) { const c = colOf(m[1]); if (!c || values.some((x) => x.column === c.name)) continue; const raw = unq(m[2]); const d = c.decode?.find((x) => x.label.toLowerCase() === raw.toLowerCase()) || c.decode?.find((x) => String(x.rawValue).toLowerCase() === raw.toLowerCase());
      if (c.decode?.length && !d) valueWarnings.push(`"${raw}" is not one of the defined values of ${c.name} (${c.decode.slice(0, 6).map((x) => `${x.rawValue}=${x.label}`).join(', ')}${c.decode.length > 6 ? ', …' : ''}); it was used as typed.`);
      values.push({ id: makeId('v'), column: c.name, value: d ? String(d.rawValue) : raw }); }
    if (queryType !== 'DELETE') { const known = new Set(t.columns.flatMap((c) => phr(c))); const seen = new Set<string>(); const mark = (raw: string) => { const k = raw.toLowerCase(); if (!seen.has(k)) { seen.add(k); unknownColumns.push(raw); } };
      for (const u of setPart.matchAll(/(?<![A-Za-z0-9_])([A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+)\s+(?:to(?![A-Za-z0-9_])|=)\s+/g)) if (!known.has(norm(u[1])) && !t.columns.some((c) => c.name.toLowerCase() === u[1].toLowerCase())) mark(u[1]);
      for (const u of setPart.matchAll(/\bset\s+([a-z][a-z0-9 ]{1,30}?)\s+to(?![A-Za-z0-9_])/gi)) { const f = norm(u[1]).replace(/\s+/g, ' ').trim(); if (f && !known.has(f) && !/_/.test(u[1])) mark(u[1].trim()); } }
    if (wherePart) {
      const wnext = `(?=\\s+and\\s+(?:${alt})\\s+(?:is not one of|is one of|not in|in|is not|equals|is(?![A-Za-z0-9_]))|\\s+and\\s+(?:${alt})\\s+(?:<>|!=|=)|\\s*;|\\s*$)`;
      const wre = new RegExp(`(?<![A-Za-z0-9_])(${alt})\\s+(is not one of|is one of|not in|in|is not|equals|<>|!=|=|is)\\s+('[^']*'|"[^"]*"|.+?)${wnext}`, 'gi');
      while ((m = wre.exec(wherePart))) { const c = colOf(m[1]); if (!c) continue; const op = m[2].toLowerCase(); const multi = /one of|^in$|not in/.test(op); const neg = /not one of|not in|is not|<>|!=/.test(op);
        const val = multi ? m[3].split(/\s*,\s*/).map(unq).filter(Boolean).join(',') : unq(m[3]); const dm = !multi ? c.decode?.find((x) => x.label.toLowerCase() === val.toLowerCase()) : null;
        filters.push({ id: makeId('f'), table: t.name, column: c.name, operator: multi ? (neg ? 'NOT IN' : 'IN') : neg ? '<>' : '=', value: dm ? String(dm.rawValue) : val, combinator: 'AND' }); }
    }
    if (!filters.length) { const pk = t.columns.find((c) => c.isPrimaryKey); const m2 = (wherePart ? wherePart.toLowerCase() : l).match(/\b(?:id|number|no\.?|#)\s*(\d{1,18})\b/) || (wherePart ? wherePart.toLowerCase() : l).match(/#\s*(\d{1,18})\b/) || l.match(/\b[a-z_]+\s+(\d{1,18})\b(?!\s*(?:days?|weeks?|months?|years?|%))/); if (pk && m2) filters.push({ id: makeId('f'), table: t.name, column: pk.name, operator: '=', value: m2[1], combinator: 'AND' }); }
  }
  notes.push(queryType ? `Detected ${queryType}${t ? ` on ${t.name}` : ' — no table identified from the Active Schema'}.` : 'Could not determine INSERT, UPDATE or DELETE.');
  return { queryType, table: t ? t.name : null, values, filters, notes, unknownColumns, valueWarnings, viewRejected };
}
