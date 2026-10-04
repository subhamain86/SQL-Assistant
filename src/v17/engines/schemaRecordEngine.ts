/** Manual Schema Update: strictly row-wise edit/delete. Pure functions. */
import type { SchemaModel, SchemaEditorRow, ColumnDef, DecodeEntry } from '../../types';
import { validateSchemaModel } from '../sync/schemaFormat';
import { makeError, type AppError } from '../errors/appErrors';
export interface RecordChangeResult { ok: boolean; schema?: SchemaModel; changes: string[]; errors: AppError[]; }
export interface Dependency { kind: 'relationship' | 'foreign-key'; description: string; relationshipId?: string; table?: string; column?: string; }
const U = (s: string) => String(s ?? '').trim().toUpperCase(); const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export const parseRowId = (id: string) => { const i = id.indexOf('::'); return i > 0 ? { table: id.slice(0, i), column: id.slice(i + 2) } : null; };
export function parseDecodeText(text: string): { entries: DecodeEntry[]; problems: string[] } {
  const p: string[] = []; const seen = new Set<string>(); const e = (text || '').split(/[\n;]+/).map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf('='); return i < 0 ? { rawValue: l, label: l } : { rawValue: l.slice(0, i).trim(), label: l.slice(i + 1).trim() }; });
  e.forEach((x) => { if (!x.rawValue) p.push(`Decode line "=${x.label}" has an empty raw value.`); if (seen.has(x.rawValue)) p.push(`Decode raw value "${x.rawValue}" is listed more than once.`); seen.add(x.rawValue); }); return { entries: e, problems: p };
}
export function analyzeDependencies(s: SchemaModel, t: string, c: string): Dependency[] {
  const d: Dependency[] = []; s.relationships.forEach((r) => { if ((U(r.fromTable) === U(t) && U(r.fromColumn) === U(c)) || (U(r.toTable) === U(t) && U(r.toColumn) === U(c))) d.push({ kind: 'relationship', relationshipId: r.id, description: `Relationship ${r.fromTable}.${r.fromColumn} → ${r.toTable}.${r.toColumn}` }); });
  s.tables.forEach((x) => x.columns.forEach((k) => { if (k.isForeignKey && k.references && U(k.references.table) === U(t) && U(k.references.column) === U(c) && !(U(x.name) === U(t) && U(k.name) === U(c))) d.push({ kind: 'foreign-key', table: x.name, column: k.name, description: `Foreign key ${x.name}.${k.name} references ${t}.${c}` }); })); return d;
}
const ek = (e: { code: string; message: string }) => `${e.code}|${e.message}`;
function introduced(b: SchemaModel, a: SchemaModel): AppError[] { const prev = new Set(validateSchemaModel(b).errors.map(ek)); const f = validateSchemaModel(a).errors.filter((e) => !prev.has(ek(e))); return f.length ? [makeError('INVALID_SCHEMA_RECORD', 'The change would leave the schema invalid and was not saved.', f.map((e) => e.message))] : []; }
export function upsertSchemaRecord(s: SchemaModel, row: SchemaEditorRow, originalRowId: string | null): RecordChangeResult {
  const p: string[] = []; const nc = row.columnName.trim(); const nt = row.tableName.trim();
  if (!nt) p.push('Table Name is required.'); if (!/^[A-Za-z_][A-Za-z0-9_$#]{0,127}$/.test(nc)) p.push(`Column Name "${nc}" is not a valid identifier.`); if (!String(row.dataType || '').trim()) p.push('Data Type is required.');
  if (row.isForeignKey) { const rt = s.tables.find((t) => U(t.name) === U(row.fkTable)); if (!rt) p.push(`References Table "${row.fkTable}" does not exist in this schema.`); else if (!rt.columns.some((c) => U(c.name) === U(row.fkColumn))) p.push(`References Column "${row.fkTable}.${row.fkColumn}" does not exist in this schema.`); }
  const dec = parseDecodeText(row.decodeText); p.push(...dec.problems);
  if (p.length) return { ok: false, changes: [], errors: [makeError('INVALID_SCHEMA_RECORD', 'The schema record is not valid and was not saved.', p)] };
  const next = clone(s); const build = (prev?: ColumnDef): ColumnDef => { const c: ColumnDef = { ...(prev || {}), name: nc, label: prev && U(prev.name) === U(nc) ? prev.label : nc, description: row.columnDescription ?? '', type: String(row.dataType).trim(), nullable: !!row.nullable } as ColumnDef;
    if (row.isPrimaryKey) c.isPrimaryKey = true; else delete c.isPrimaryKey; if (row.isForeignKey) { c.isForeignKey = true; c.references = { table: row.fkTable.trim(), column: row.fkColumn.trim() }; delete c.unresolvedReference; } else { delete c.isForeignKey; delete c.references; }
    if (dec.entries.length) c.decode = dec.entries; else delete c.decode; if (c.unmappedDecodeLabels) { const have = new Set(dec.entries.map((x) => U(x.label))); c.unmappedDecodeLabels = c.unmappedDecodeLabels.filter((l) => !have.has(U(l))); if (!c.unmappedDecodeLabels.length) delete c.unmappedDecodeLabels; } return c; };
  const o = originalRowId ? parseRowId(originalRowId) : null; const ch: string[] = [];
  if (o) { const t = next.tables.find((x) => x.name === o.table); const c = t?.columns.find((x) => x.name === o.column); if (!t || !c) return { ok: false, changes: [], errors: [makeError('COLUMN_NOT_FOUND', `"${o.table}.${o.column}" no longer exists.`)] };
    if (U(c.name) !== U(nc) && t.columns.some((x) => x !== c && U(x.name) === U(nc))) return { ok: false, changes: [], errors: [makeError('INVALID_SCHEMA_RECORD', `Column "${t.name}.${nc}" already exists.`)] };
    t.columns[t.columns.indexOf(c)] = build(c); if (U(c.name) !== U(nc)) { next.relationships.forEach((r) => { if (r.fromTable === t.name && r.fromColumn === c.name) r.fromColumn = nc; if (r.toTable === t.name && r.toColumn === c.name) r.toColumn = nc; }); next.tables.forEach((x) => x.columns.forEach((y) => { if (y.references?.table === t.name && y.references.column === c.name) y.references.column = nc; })); } ch.push(`Updated ${t.name}.${nc}.`); }
  else { let t = next.tables.find((x) => U(x.name) === U(nt)); if (t?.columns.some((x) => U(x.name) === U(nc))) return { ok: false, changes: [], errors: [makeError('INVALID_SCHEMA_RECORD', `Column "${t.name}.${nc}" already exists.`)] }; if (!t) { t = { name: nt, module: row.module || 'General', description: '', columns: [] }; next.tables.push(t); } t.columns.push(build()); ch.push(`Added ${t.name}.${nc}.`); }
  const e = introduced(s, next); return e.length ? { ok: false, changes: [], errors: e } : { ok: true, schema: next, changes: ch, errors: [] };
}
export function deleteSchemaRecord(s: SchemaModel, rowId: string, cascade = false): RecordChangeResult & { dependencies: Dependency[] } {
  const id = parseRowId(rowId); const next = clone(s); const t = id && next.tables.find((x) => x.name === id.table);
  if (!id || !t || !t.columns.some((c) => c.name === id.column)) return { ok: false, changes: [], errors: [makeError('COLUMN_NOT_FOUND', `"${rowId}" was not found.`)], dependencies: [] };
  const deps = analyzeDependencies(s, id.table, id.column); if (deps.length && !cascade) return { ok: false, changes: [], dependencies: deps, errors: [makeError('SCHEMA_DEPENDENCY_BLOCKED', `"${id.table}.${id.column}" is referenced by other schema records.`, deps.map((d) => d.description))] };
  t.columns = t.columns.filter((c) => c.name !== id.column); const rel = new Set(deps.map((d) => d.relationshipId)); next.relationships = next.relationships.filter((r) => !rel.has(r.id));
  deps.filter((d) => d.kind === 'foreign-key').forEach((d) => { const c = next.tables.find((x) => x.name === d.table)?.columns.find((x) => x.name === d.column); if (c) { delete c.isForeignKey; delete c.references; } }); if (!t.columns.length) next.tables = next.tables.filter((x) => x !== t);
  const e = introduced(s, next); return e.length ? { ok: false, changes: [], errors: e, dependencies: deps } : { ok: true, schema: next, changes: [`Deleted ${id.table}.${id.column}.`], errors: [], dependencies: deps };
}
