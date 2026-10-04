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
/** Interprets a CR description against the Active Schema: command, table, SET values (incl. decode labels) and WHERE (incl. "is one of"). */
export function parseCrDescription(text: string, schema: SchemaModel): { queryType: CrQueryState['queryType'] | null; table: string | null; values: CrValuePair[]; filters: FilterCondition[]; notes: string[] } {
  const l = text.toLowerCase(); const notes: string[] = [];
  const queryType = /\b(update|change|set|mark)\b/.test(l) ? 'UPDATE' : /\b(insert|add|create)\b/.test(l) ? 'INSERT' : /\b(delete|remove)\b/.test(l) ? 'DELETE' : null;
  const u = text.toUpperCase(); const norm = (x: string) => x.toLowerCase().replace(/_/g, ' ');
  let t = schema.tables.find((x) => u.includes(x.name)) || schema.tables.find((x) => l.includes(norm(x.name))) || schema.tables.find((x) => { const w = norm(x.name).split(' ').filter((y) => !['header', 'line', 'ia', 'pp', 'adm'].includes(y)); return w.length > 0 && w.every((y) => l.includes(y.replace(/s$/, ''))); }) || null;
  const values: CrValuePair[] = []; const filters: FilterCondition[] = [];
  if (t) {
    const [setPart, wherePart] = l.split(/\bwhere\b/);
    for (const c of t.columns) {
      const cn = norm(c.name); const re = new RegExp(`\\b${cn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\\s+(?:to|=)\\s+([\\w.\\-]+)`);
      const m = setPart.match(re); if (m && queryType !== 'DELETE') { const d = c.decode?.find((x) => x.label.toLowerCase() === m[1]); values.push({ id: makeId('v'), column: c.name, value: d ? d.rawValue : m[1] }); }
      if (wherePart) { const wm = wherePart.match(new RegExp(`\\b${cn.replace(/ /g, '\\s+')}\\s+(is one of|in|is not one of|=|is)\\s+([\\w.,\\s\\-]+?)(?=\\s+and\\b|$)`)); if (wm) { const multi = /one of|^in$/.test(wm[1]); filters.push({ id: makeId('f'), table: t.name, column: c.name, operator: wm[1].startsWith('is not') ? 'NOT IN' : multi ? 'IN' : '=', value: wm[2].split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean).join(','), combinator: 'AND' }); } }
    }
    if (!filters.length) { const pk = t.columns.find((c) => c.isPrimaryKey); const m = (wherePart || l).match(/\b(?:id|number|no\.?|#)\s*(\d{1,18})\b/) || (wherePart || l).match(/#\s*(\d{1,18})\b/) || l.match(/\b[a-z_]+\s+(\d{1,18})\b(?!\s*(?:days?|weeks?|months?|years?|%))/); if (pk && m) filters.push({ id: makeId('f'), table: t.name, column: pk.name, operator: '=', value: m[1], combinator: 'AND' }); }
  }
  notes.push(queryType ? `Detected ${queryType}${t ? ` on ${t.name}` : ' — no table identified from the Active Schema'}.` : 'Could not determine INSERT, UPDATE or DELETE.');
  return { queryType, table: t ? t.name : null, values, filters, notes };
}
