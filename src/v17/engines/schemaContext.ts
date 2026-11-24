import type { SchemaModel, TableDef, ColumnDef } from '../../types';
import { deriveFkRelationships, isResolvableRelationship } from './joinGraph';
export interface ColumnEntry { table: string; column: ColumnDef; phrases: string[]; }
export interface TableEntry { table: TableDef; phrases: string[]; displayColumn: ColumnDef | null; pk: ColumnDef | null; }
export interface SchemaContext { fingerprint: string; tables: TableEntry[]; columns: ColumnEntry[]; tableUpper: Map<string, TableEntry>; adjacency: Map<string, Set<string>>; }
const GENERIC = new Set(['header', 'line', 'lines', 'history', 'data', 'table', 'master', 'detail', 'app']);
const STOP = new Set(['for', 'to', 'by', 'of', 'in', 'on', 'and', 'or', 'the', 'with', 'from', 'per', 'all', 'is', 'as', 'no', 'not', 'type', 'value', 'data']);
const SYN: Record<string, string[]> = { INVOICE_HEADER: ['invoice', 'invoices'], PO_HEADER: ['purchase order', 'purchase orders', 'po'], VENDOR: ['vendor', 'vendors', 'supplier', 'suppliers'] };
export const norm = (s: string) => String(s ?? '').toLowerCase().replace(/_/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const softNormalize = (t: string) => t.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
export const isNumericType = (t: string) => /NUMBER|NUMERIC|INT|DEC|FLOAT|DOUBLE|MONEY/i.test(t || '');
export const isDateType = (t: string) => /DATE|TIME/i.test(t || '');
export const isStringType = (t: string) => !isNumericType(t) && !isDateType(t);
const sing = (w: string) => (w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const plur = (w: string) => (w.endsWith('y') ? `${w.slice(0, -1)}ies` : w.endsWith('s') ? w : `${w}s`);
function fnv(s: string): string { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); }
export function schemaFingerprint(s: SchemaModel): string { const c = JSON.stringify([s.id, s.tables.map((t) => [t.name, t.columns.map((x) => [x.name, x.type, (x.decode || []).map((d) => d.rawValue).join('|')])])]); return `${fnv(c)}-${c.length.toString(36)}`; }
function prefixes(ts: TableDef[]): Set<string> { const n = new Map<string, number>(); ts.forEach((t) => { const w = norm(t.name).split(' '); if (w.length > 1 && w[0].length <= 4) n.set(w[0], (n.get(w[0]) || 0) + 1); }); return new Set([...n].filter(([, k]) => k >= 3).map(([w]) => w)); }
function te(t: TableDef, pre: Set<string>): TableEntry {
  const all = norm(t.name).split(' '); const w = all.length > 1 && pre.has(all[0]) ? all.slice(1) : all; const p = new Set<string>();
  [all.join(' '), w.join(' ')].forEach((x) => { p.add(x); p.add(sing(x)); p.add(plur(x)); }); const m = w.filter((x) => !GENERIC.has(x)); if (m.length && m.length < w.length) { p.add(m.join(' ')); p.add(plur(m.join(' '))); }
  (SYN[t.name] || []).forEach((x) => p.add(x));
  return { table: t, phrases: [...p].filter((x) => !/^\d+$/.test(x)), displayColumn: t.columns.find((c) => /(^|_)(NAME|TITLE)$/i.test(c.name)) || t.columns.find((c) => !c.isPrimaryKey && !c.isForeignKey && isStringType(c.type) && !c.decode) || null, pk: t.columns.find((c) => c.isPrimaryKey) || null };
}
const NAME_STEM_SKIP = new Set(['full', 'first', 'last', 'display', 'user', 'file', 'short', 'long', 'legal', 'middle', 'nick']);
const MEAS = ['amount', 'sum', 'value', 'total'];
function ce(table: string, c: ColumnDef, pre: Set<string>): ColumnEntry {
  const n = norm(c.name); const p = new Set([n, norm(c.label || c.name)]); const tw = new Set(norm(table).split(' ').filter((w) => !pre.has(w)));
  const st = n.split(' ').filter((w) => !tw.has(w)).join(' '); if (st && st !== n && st.length > 2 && !STOP.has(st)) p.add(st);
  // V17.4: "SUPPLIER_NAME" is also what a user calls "supplier"; "GROSS_SUM" is also "gross amount / value / total"
  const nm = n.match(/^(.+) name$/); if (nm && nm[1].length > 2 && !NAME_STEM_SKIP.has(nm[1]) && !/^\d+$/.test(nm[1])) p.add(nm[1]);
  [...p].forEach((x) => { const w = x.split(' '); if (w.length >= 2 && MEAS.includes(w[w.length - 1])) MEAS.filter((t) => t !== w[w.length - 1] && t !== w[w.length - 2]).forEach((t) => p.add([...w.slice(0, -1), t].join(' '))); });
  [...p].forEach((x) => { const a = x.split(' '); const l = a.pop() || ''; if (l.length > 2 && l !== 'id') p.add([...a, plur(l)].join(' ')); });
  return { table, column: c, phrases: [...p].filter((x) => x.length > 1) };
}
const cache = new Map<string, SchemaContext>();
export const invalidateSchemaContext = () => cache.clear();
export function getSchemaContext(s: SchemaModel): SchemaContext {
  const fp = schemaFingerprint(s); const h = cache.get(s.id); if (h && h.fingerprint === fp) return h;
  const pre = prefixes(s.tables); const tables = s.tables.map((t) => te(t, pre)); const columns = s.tables.flatMap((t) => t.columns.map((c) => ce(t.name, c, pre)));
  const adjacency = new Map<string, Set<string>>(); const link = (a: string, b: string) => { if (!adjacency.has(a)) adjacency.set(a, new Set()); adjacency.get(a)!.add(b); };
  [...s.relationships.filter((r) => isResolvableRelationship(s, r)), ...deriveFkRelationships(s)].forEach((r) => { link(r.fromTable, r.toTable); link(r.toTable, r.fromTable); });
  const ctx = { fingerprint: fp, tables, columns, tableUpper: new Map(tables.map((e) => [e.table.name.toUpperCase(), e] as [string, TableEntry])), adjacency }; cache.set(s.id, ctx); return ctx;
}
export function relationshipDistance(ctx: SchemaContext, a: string, b: string): number { if (a === b) return 0; const seen = new Set([a]); let f = [a]; let d = 0; while (f.length && d < 6) { d++; const nx: string[] = []; for (const n of f) for (const m of ctx.adjacency.get(n) || []) { if (m === b) return d; if (!seen.has(m)) { seen.add(m); nx.push(m); } } f = nx; } return Infinity; }
export function findPhrase(soft: string, phrase: string): { start: number; end: number }[] {
  if (!phrase) return []; const re = new RegExp(`(^|[^a-z0-9])(${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')})(?=[^a-z0-9]|$)`, 'g'); const o: { start: number; end: number }[] = []; let m: RegExpExecArray | null;
  while ((m = re.exec(soft))) { const s = m.index + m[1].length; o.push({ start: s, end: s + m[2].length }); if (re.lastIndex === m.index) re.lastIndex++; } return o;
}
