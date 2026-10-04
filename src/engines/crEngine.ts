import type { CrQueryState } from '../types';
const fv = (r: string) => { const t = r.trim(); if (!t) return 'NULL'; if (/^-?\d+(\.\d+)?$/.test(t)) return t; return `'${t.replace(/'/g, "''")}'`; };
export function buildCrSQL(s: CrQueryState): string {
  if (!s.table) return '-- Choose a table for this Change Request.';
  const w = s.filters.map((f, i) => `${i ? `${f.combinator} ` : ''}${f.table}.${f.column} ${f.operator} ${fv(f.value)}`).join('\n  ');
  if (s.queryType !== 'INSERT' && !w && !s.confirmNoWhere) return '-- A WHERE condition is required to identify which records should be updated or deleted.';
  const tail = w ? `\nWHERE ${w};` : ';\n-- No WHERE condition (explicitly confirmed) — this will affect ALL rows.';
  if (s.queryType === 'INSERT') return s.values.length ? `INSERT INTO ${s.table} (${s.values.map((v) => v.column).join(', ')})\nVALUES (${s.values.map((v) => fv(v.value)).join(', ')});` : '-- Add at least one column/value pair.';
  if (s.queryType === 'UPDATE') return s.values.length ? `UPDATE ${s.table}\nSET ${s.values.map((v) => `${v.column} = ${fv(v.value)}`).join(',\n  ')}${tail}` : '-- Add at least one column/value pair.';
  return `DELETE FROM ${s.table}${tail}`;
}
export function parseCr(text: string, tables: string[]): { queryType: CrQueryState['queryType'] | null; table: string | null } {
  const l = text.toLowerCase(); const qt = /\b(update|change|set)\b/.test(l) ? 'UPDATE' : /\b(insert|add)\b/.test(l) ? 'INSERT' : /\b(delete|remove)\b/.test(l) ? 'DELETE' : null;
  const u = text.toUpperCase(); return { queryType: qt, table: tables.find((t) => u.includes(t) || u.includes(t.replace(/_/g, ' '))) || null };
}
