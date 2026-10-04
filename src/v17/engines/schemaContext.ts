/**
 * Active-schema context for the offline NLU. Derived ONLY from the schema object passed in and cached by
 * a content fingerprint, so any edit, deletion, import or sync rebuilds it automatically.
 */
import type { SchemaModel, TableDef, ColumnDef } from '../../types';
import { deriveFkRelationships, isResolvableRelationship } from './joinGraph';
export interface ColumnEntry { table: string; column: ColumnDef; phrases: string[]; tokens: Set<string>; }
export interface TableEntry { table: TableDef; phrases: string[]; tokens: Set<string>; displayColumn: ColumnDef | null; nameColumn: ColumnDef | null; pk: ColumnDef | null; core: string; }
export interface SchemaContext { fingerprint: string; schemaId: string; schemaName: string; tables: TableEntry[]; columns: ColumnEntry[]; tableUpper: Map<string, TableEntry>; adjacency: Map<string, Set<string>>; }
const GENERIC = new Set(['header', 'line', 'lines', 'history', 'data', 'table', 'master', 'detail', 'details', 'app', 'info', 'record', 'records']);
const EXTRA_TABLE_SYNONYMS: Record<string, string[]> = {
  INVOICE_HEADER: ['invoice', 'invoices', 'bill', 'bills'], INVOICE_LINE: ['invoice line', 'invoice lines', 'invoice line items'],
  PO_HEADER: ['purchase order', 'purchase orders', 'po', 'pos'], PO_LINE: ['po line', 'po lines', 'purchase order line', 'purchase order lines'],
  VENDOR: ['vendor', 'vendors', 'supplier', 'suppliers'], ORGANIZATION: ['organization', 'organizations', 'organisation', 'organisations', 'org', 'orgs'],
  GL_ACCOUNT: ['gl account', 'gl accounts', 'account', 'accounts', 'ledger account'], APP_USER: ['user', 'users', 'employee', 'employees', 'approver', 'approvers', 'buyer', 'buyers'],
  APPROVAL_HISTORY: ['approval', 'approvals', 'approval history']
};
export function normalizeWords(s: string): string { return String(s ?? '').toLowerCase().replace(/_/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
export function wordTokens(s: string): string[] { return normalizeWords(s).split(' ').filter((t) => t.length > 1); }
export function isNumericType(t: string): boolean { return /NUMBER|NUMERIC|INT|DEC|FLOAT|DOUBLE|REAL|MONEY/i.test(t || ''); }
export function isDateType(t: string): boolean { return /DATE|TIME/i.test(t || ''); }
export function isStringType(t: string): boolean { return /CHAR|TEXT|CLOB|STRING|FLAG/i.test(t || '') || (!isNumericType(t) && !isDateType(t)); }
function fnv1a(str: string): string { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
export function schemaFingerprint(schema: SchemaModel): string {
  const canon = JSON.stringify({ id: schema.id, t: schema.tables.map((t) => [t.name, t.module, t.description, t.objectType || 'TABLE', t.columns.map((c) => [c.name, c.label, c.type, c.description, !!c.isPrimaryKey, !!c.isForeignKey, c.references?.table || '', c.references?.column || '', (c.decode || []).map((d) => `${d.rawValue}=${d.label}`).join('|')])]), r: schema.relationships.map((r) => [r.fromTable, r.fromColumn, r.toTable, r.toColumn]) });
  return `${fnv1a(canon)}-${canon.length.toString(36)}`;
}
function singular(w: string): string { return w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w; }
function plural(w: string): string { return w.endsWith('y') ? `${w.slice(0, -1)}ies` : w.endsWith('s') ? w : `${w}s`; }
function buildTableEntry(t: TableDef): TableEntry {
  const spaced = normalizeWords(t.name); const words = spaced.split(' ');
  const phrases = new Set<string>([spaced, singular(spaced), plural(spaced)]);
  const meaningful = words.filter((w) => !GENERIC.has(w));
  if (meaningful.length && meaningful.length < words.length) { const core = meaningful.join(' '); phrases.add(core); phrases.add(plural(core)); phrases.add(singular(core)); }
  (EXTRA_TABLE_SYNONYMS[t.name.toUpperCase()] || []).forEach((p) => phrases.add(p));
  const tokens = new Set<string>([...wordTokens(t.name), ...wordTokens(t.description), ...wordTokens(t.module)]);
  const pk = t.columns.find((c) => c.isPrimaryKey) || null;
  const displayColumn = t.columns.find((c) => /(^|_)(NAME|FULL_NAME|TITLE)$/i.test(c.name)) || t.columns.find((c) => /name/i.test(c.label || '') && isStringType(c.type)) || t.columns.find((c) => !c.isPrimaryKey && !c.isForeignKey && isStringType(c.type) && !c.decode?.length) || null;
  const nameColumn = t.columns.find((c) => /(^|_)(NAME|FULL_NAME|TITLE)$/i.test(c.name)) || null;
  const core = (meaningful.length ? meaningful : words).join('_').toUpperCase();
  return { table: t, phrases: Array.from(phrases).filter((p) => p.length > 1), tokens, displayColumn, nameColumn, pk, core };
}
function buildColumnEntry(table: string, c: ColumnDef): ColumnEntry {
  const nameSpaced = normalizeWords(c.name); const label = normalizeWords(c.label || c.name);
  const phrases = new Set<string>([nameSpaced, label]);
  const tableWords = new Set(wordTokens(table));
  const stripped = nameSpaced.split(' ').filter((w) => !tableWords.has(w)).join(' ');
  if (stripped && stripped !== nameSpaced && stripped.length > 2) phrases.add(stripped);
  Array.from(phrases).forEach((p) => { const parts = p.split(' '); const last = parts.pop() || ''; if (last.length > 2 && !/^(id|no)$/.test(last)) phrases.add([...parts, plural(last)].join(' ')); });
  return { table, column: c, phrases: Array.from(phrases).filter((p) => p.length > 1), tokens: new Set([...wordTokens(c.name), ...wordTokens(c.label || ''), ...wordTokens(c.description || '')]) };
}
const cache = new Map<string, SchemaContext>();
export function invalidateSchemaContext(): void { cache.clear(); }
export function getSchemaContext(schema: SchemaModel): SchemaContext {
  const fp = schemaFingerprint(schema);
  const hit = cache.get(schema.id);
  if (hit && hit.fingerprint === fp) return hit;
  const tables = schema.tables.map(buildTableEntry);
  const columns = schema.tables.flatMap((t) => t.columns.map((c) => buildColumnEntry(t.name, c)));
  const tableUpper = new Map(tables.map((e) => [e.table.name.toUpperCase(), e] as [string, TableEntry]));
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => { if (!adjacency.has(a)) adjacency.set(a, new Set()); adjacency.get(a)!.add(b); };
  [...schema.relationships.filter((r) => isResolvableRelationship(schema, r)), ...deriveFkRelationships(schema)].forEach((r) => { if (tableUpper.has(r.fromTable.toUpperCase()) && tableUpper.has(r.toTable.toUpperCase())) { link(r.fromTable, r.toTable); link(r.toTable, r.fromTable); } });
  const ctx: SchemaContext = { fingerprint: fp, schemaId: schema.id, schemaName: schema.name, tables, columns, tableUpper, adjacency };
  cache.set(schema.id, ctx);
  return ctx;
}
export function relationshipDistance(ctx: SchemaContext, a: string, b: string): number {
  if (a === b) return 0; const seen = new Set([a]); let frontier = [a]; let depth = 0;
  while (frontier.length && depth < 6) { depth += 1; const next: string[] = []; for (const n of frontier) for (const m of ctx.adjacency.get(n) || []) { if (m === b) return depth; if (!seen.has(m)) { seen.add(m); next.push(m); } } frontier = next; }
  return Infinity;
}
export function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export function softNormalize(text: string): string { return text.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim(); }
export function findPhrase(soft: string, phrase: string): { start: number; end: number }[] {
  if (!phrase) return [];
  const re = new RegExp(`(^|[^a-z0-9])(${escapeRe(phrase).replace(/ /g, '\\s+')})(?=[^a-z0-9]|$)`, 'g');
  const out: { start: number; end: number }[] = []; let m: RegExpExecArray | null;
  while ((m = re.exec(soft))) { const start = m.index + m[1].length; out.push({ start, end: start + m[2].length }); if (re.lastIndex === m.index) re.lastIndex += 1; }
  return out;
}
