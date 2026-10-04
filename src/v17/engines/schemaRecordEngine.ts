/**
 * V17.0 — Settings → Manual Schema Update: safe, single-record edit / delete.
 *
 * Pure functions: they take a schema, return a NEW schema (or a list of
 * errors) and never mutate the input. Guarantees:
 *  - Editing one row only changes that row (and, when a column is renamed, the
 *    relationships / FK references that point at that exact column — every
 *    such change is reported back explicitly).
 *  - Deleting one row only removes that column. If other records depend on it
 *    (relationships or FK references), the delete is BLOCKED with a list of the
 *    dependents unless the caller explicitly asks to cascade.
 *  - Every result is checked by the existing validateSchemaIntegrity() and
 *    rejected if it would leave the schema invalid.
 */
import type { SchemaModel, SchemaEditorRow, TableDef, ColumnDef, DecodeEntry, RelationshipDef } from '../../types';
import { validateSchemaIntegrity } from '../../engines/schemaIntegrityEngine';
import { makeError, type AppError } from '../errors/appErrors';

export interface RecordChangeResult { ok: boolean; schema?: SchemaModel; changes: string[]; errors: AppError[]; }
export interface Dependency { kind: 'relationship' | 'foreign-key'; description: string; relationshipId?: string; table?: string; column?: string; }

const IDENT = /^[A-Za-z_][A-Za-z0-9_$#]{0,127}$/;
const TYPE_RE = /^[A-Za-z][A-Za-z0-9_ ]{0,40}(\(\s*(\d+|\*)\s*(,\s*\d+\s*)?(\s+(BYTE|CHAR))?\))?(\s+WITH( LOCAL)? TIME ZONE)?$/i;
function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }
const U = (s: string) => s.trim().toUpperCase();
export function parseRowId(rowId: string): { table: string; column: string } | null { const i = rowId.indexOf('::'); if (i <= 0) return null; return { table: rowId.slice(0, i), column: rowId.slice(i + 2) }; }

export function parseDecodeText(text: string): { entries: DecodeEntry[]; problems: string[] } {
  const problems: string[] = []; const seen = new Set<string>();
  const entries = (text || '').split(/[\n;]+/).map((l) => l.trim()).filter(Boolean).map((line) => { const i = line.indexOf('='); return i === -1 ? { rawValue: line, label: line } : { rawValue: line.slice(0, i).trim(), label: line.slice(i + 1).trim() }; });
  entries.forEach((e) => { if (!e.rawValue) problems.push(`Decode line "${e.rawValue}=${e.label}" has an empty raw value.`); const k = U(e.rawValue); if (seen.has(k)) problems.push(`Decode raw value "${e.rawValue}" is listed more than once.`); seen.add(k); if (!e.label) problems.push(`Decode raw value "${e.rawValue}" has an empty label.`); });
  return { entries, problems };
}

/** Field-level validation of a single schema record before it can be saved. */
export function validateRecordFields(row: SchemaEditorRow, schema: SchemaModel): string[] {
  const p: string[] = [];
  const t = (row.tableName || '').trim(); const c = (row.columnName || '').trim(); const dt = String(row.dataType || '').trim();
  if (!t) p.push('Table Name is required.'); else if (!IDENT.test(t)) p.push(`Table Name "${t}" is not a valid identifier (letters, digits, _, $, # — must start with a letter or underscore, no spaces).`);
  if (!c) p.push('Column Name is required.'); else if (!IDENT.test(c)) p.push(`Column Name "${c}" is not a valid identifier (letters, digits, _, $, # — must start with a letter or underscore, no spaces).`);
  if (!dt) p.push('Data Type is required.'); else if (!TYPE_RE.test(dt)) p.push(`Data Type "${dt}" is not a recognisable SQL data type (e.g. VARCHAR2, NUMBER(10,2), DATE, TIMESTAMP(6)).`);
  if (row.length !== null && row.length !== undefined && (!Number.isInteger(row.length) || row.length < 0)) p.push('Length must be a whole number of 0 or more.');
  if (row.precision !== null && row.precision !== undefined && (!Number.isInteger(row.precision) || row.precision < 0)) p.push('Precision must be a whole number of 0 or more.');
  if (row.isForeignKey) {
    if (!row.fkTable?.trim() || !row.fkColumn?.trim()) p.push('Foreign Key requires both a References Table and a References Column.');
    else { const rt = schema.tables.find((x) => U(x.name) === U(row.fkTable)); const sameTable = U(row.fkTable) === U(t); if (!rt && !sameTable) p.push(`References Table "${row.fkTable}" does not exist in this schema.`); else if (rt && !rt.columns.some((x) => U(x.name) === U(row.fkColumn)) && !(sameTable && U(row.fkColumn) === U(c))) p.push(`References Column "${row.fkTable}.${row.fkColumn}" does not exist in this schema.`); }
  }
  p.push(...parseDecodeText(row.decodeText).problems);
  return p;
}

/** Everything in the schema that depends on table.column. */
export function analyzeDependencies(schema: SchemaModel, table: string, column: string): Dependency[] {
  const deps: Dependency[] = [];
  schema.relationships.forEach((r) => { if ((U(r.fromTable) === U(table) && U(r.fromColumn) === U(column)) || (U(r.toTable) === U(table) && U(r.toColumn) === U(column))) deps.push({ kind: 'relationship', relationshipId: r.id, description: `Relationship ${r.fromTable}.${r.fromColumn} → ${r.toTable}.${r.toColumn}` }); });
  schema.tables.forEach((t) => t.columns.forEach((c) => { if (c.isForeignKey && c.references && U(c.references.table) === U(table) && U(c.references.column) === U(column) && !(U(t.name) === U(table) && U(c.name) === U(column))) deps.push({ kind: 'foreign-key', table: t.name, column: c.name, description: `Foreign key ${t.name}.${c.name} references ${table}.${column}` }); }));
  return deps;
}

function buildColumn(row: SchemaEditorRow, decode: DecodeEntry[], previous?: ColumnDef): ColumnDef {
  const name = row.columnName.trim();
  return { ...(previous || {}), name, label: previous && U(previous.name) === U(name) && previous.label ? previous.label : name, description: row.columnDescription ?? '', type: String(row.dataType).trim(), length: row.length ?? undefined, precision: row.precision ?? undefined, nullable: !!row.nullable, alias: row.alias?.trim() || undefined, isPrimaryKey: !!row.isPrimaryKey, isForeignKey: !!row.isForeignKey, references: row.isForeignKey && row.fkTable && row.fkColumn ? { table: row.fkTable.trim(), column: row.fkColumn.trim() } : undefined, decode: decode.length ? decode : undefined } as ColumnDef;
}
function integrityErrors(tables: TableDef[]): AppError[] { const r = validateSchemaIntegrity(tables); const errs = r.issues.filter((i) => i.severity === 'error').map((i) => i.message); return errs.length ? [makeError('INVALID_SCHEMA_RECORD', 'The change would leave the schema in an invalid state and was not saved.', errs)] : []; }

/** Add (originalRowId = null) or edit exactly one schema record. */
export function upsertSchemaRecord(schema: SchemaModel, row: SchemaEditorRow, originalRowId: string | null): RecordChangeResult {
  const fieldProblems = validateRecordFields(row, schema);
  if (fieldProblems.length) return { ok: false, changes: [], errors: [makeError('INVALID_SCHEMA_RECORD', 'The schema record is not valid and was not saved.', fieldProblems)] };
  const next = clone(schema); const changes: string[] = [];
  const decode = parseDecodeText(row.decodeText).entries;
  const newTable = row.tableName.trim(); const newCol = row.columnName.trim();
  const orig = originalRowId ? parseRowId(originalRowId) : null;
  if (originalRowId && !orig) return { ok: false, changes, errors: [makeError('INVALID_SCHEMA_RECORD', `Row id "${originalRowId}" is malformed.`)] };

  if (orig) {
    const ot = next.tables.find((t) => t.name === orig.table);
    const oc = ot?.columns.find((c) => c.name === orig.column);
    if (!ot) return { ok: false, changes, errors: [makeError('TABLE_NOT_FOUND', `Table "${orig.table}" no longer exists in schema "${schema.name}" — reload the editor (it may have been changed on another device).`)] };
    if (!oc) return { ok: false, changes, errors: [makeError('COLUMN_NOT_FOUND', `Column "${orig.table}.${orig.column}" no longer exists in schema "${schema.name}" — reload the editor (it may have been changed on another device).`)] };
    const movedTable = U(ot.name) !== U(newTable); const renamed = U(oc.name) !== U(newCol);
    const deps = analyzeDependencies(schema, orig.table, orig.column);
    if (movedTable && deps.length) return { ok: false, changes, errors: [makeError('SCHEMA_DEPENDENCY_BLOCKED', `"${orig.table}.${orig.column}" cannot be moved to table "${newTable}" because other records depend on it. Remove or re-point these first:`, deps.map((d) => d.description))] };
    if (!movedTable && renamed && ot.columns.some((c) => c !== oc && U(c.name) === U(newCol))) return { ok: false, changes, errors: [makeError('INVALID_SCHEMA_RECORD', `Column "${ot.name}.${newCol}" already exists.`)] };
    if (!movedTable) {
      const idx = ot.columns.indexOf(oc);
      ot.columns[idx] = buildColumn(row, decode, oc);
      if (row.module?.trim() && row.module.trim() !== ot.module) { changes.push(`Table ${ot.name} module changed to "${row.module.trim()}".`); ot.module = row.module.trim(); }
      if ((row.tableDescription ?? '') !== (ot.description ?? '') && row.tableDescription !== undefined) { ot.description = row.tableDescription; changes.push(`Table ${ot.name} description updated.`); }
      changes.push(`Updated ${ot.name}.${newCol}.`);
      if (renamed) {
        next.relationships.forEach((r) => { if (r.fromTable === ot.name && r.fromColumn === oc.name) { r.fromColumn = newCol; changes.push(`Relationship ${r.id} now uses ${ot.name}.${newCol}.`); } if (r.toTable === ot.name && r.toColumn === oc.name) { r.toColumn = newCol; changes.push(`Relationship ${r.id} now points to ${ot.name}.${newCol}.`); } });
        next.tables.forEach((t) => t.columns.forEach((c) => { if (c.isForeignKey && c.references && c.references.table === ot.name && c.references.column === oc.name && !(t === ot && c === ot.columns[idx])) { c.references = { table: ot.name, column: newCol }; changes.push(`Foreign key ${t.name}.${c.name} now references ${ot.name}.${newCol}.`); } }));
      }
    } else {
      ot.columns = ot.columns.filter((c) => c !== oc);
      let target = next.tables.find((t) => U(t.name) === U(newTable));
      if (target?.columns.some((c) => U(c.name) === U(newCol))) return { ok: false, changes: [], errors: [makeError('INVALID_SCHEMA_RECORD', `Column "${target.name}.${newCol}" already exists.`)] };
      if (!target) { target = { name: newTable, module: row.module?.trim() || ot.module || 'General', description: row.tableDescription || '', columns: [] }; next.tables.push(target); changes.push(`Created table ${newTable}.`); }
      target.columns.push(buildColumn(row, decode, oc));
      changes.push(`Moved ${orig.table}.${orig.column} to ${target.name}.${newCol}.`);
      if (ot.columns.length === 0) { const tableDeps = next.relationships.filter((r) => r.fromTable === ot.name || r.toTable === ot.name); if (!tableDeps.length) { next.tables = next.tables.filter((t) => t !== ot); changes.push(`Removed now-empty table ${ot.name}.`); } }
    }
  } else {
    let target = next.tables.find((t) => U(t.name) === U(newTable));
    if (target?.columns.some((c) => U(c.name) === U(newCol))) return { ok: false, changes, errors: [makeError('INVALID_SCHEMA_RECORD', `Column "${target.name}.${newCol}" already exists in this schema.`)] };
    if (!target) { target = { name: newTable, module: row.module?.trim() || 'General', description: row.tableDescription || '', columns: [] }; next.tables.push(target); changes.push(`Created table ${newTable}.`); }
    target.columns.push(buildColumn(row, decode)); changes.push(`Added ${target.name}.${newCol}.`);
  }
  const errors = integrityErrors(next.tables);
  if (errors.length) return { ok: false, changes: [], errors };
  return { ok: true, schema: next, changes, errors: [] };
}

/** Delete exactly one schema record. Blocks when dependents exist unless cascade is explicitly requested. */
export function deleteSchemaRecord(schema: SchemaModel, rowId: string, opts: { cascade?: boolean } = {}): RecordChangeResult & { dependencies: Dependency[] } {
  const id = parseRowId(rowId);
  if (!id) return { ok: false, changes: [], errors: [makeError('INVALID_SCHEMA_RECORD', `Row id "${rowId}" is malformed.`)], dependencies: [] };
  const next = clone(schema);
  const t = next.tables.find((x) => x.name === id.table);
  if (!t) return { ok: false, changes: [], errors: [makeError('TABLE_NOT_FOUND', `Table "${id.table}" was not found in schema "${schema.name}" — it may already have been removed.`)], dependencies: [] };
  if (!t.columns.some((c) => c.name === id.column)) return { ok: false, changes: [], errors: [makeError('COLUMN_NOT_FOUND', `Column "${id.table}.${id.column}" was not found in schema "${schema.name}" — it may already have been removed.`)], dependencies: [] };
  const deps = analyzeDependencies(schema, id.table, id.column);
  const lastColumn = t.columns.length === 1;
  const tableRels: RelationshipDef[] = lastColumn ? schema.relationships.filter((r) => (r.fromTable === t.name || r.toTable === t.name) && !deps.some((d) => d.relationshipId === r.id)) : [];
  const tableFkRefs = lastColumn ? schema.tables.flatMap((x) => x.columns.filter((c) => c.isForeignKey && c.references?.table === t.name && !deps.some((d) => d.table === x.name && d.column === c.name)).map((c) => ({ kind: 'foreign-key' as const, table: x.name, column: c.name, description: `Foreign key ${x.name}.${c.name} references table ${t.name}` }))) : [];
  const allDeps: Dependency[] = [...deps, ...tableRels.map((r) => ({ kind: 'relationship' as const, relationshipId: r.id, description: `Relationship ${r.fromTable}.${r.fromColumn} → ${r.toTable}.${r.toColumn} (table ${t.name} would be removed)` })), ...tableFkRefs];
  if (allDeps.length && !opts.cascade) return { ok: false, changes: [], dependencies: allDeps, errors: [makeError('SCHEMA_DEPENDENCY_BLOCKED', `"${id.table}.${id.column}" cannot be deleted on its own because other schema records depend on it. Confirm the dependent records listed below should also be removed/unlinked, or update them first.`, allDeps.map((d) => d.description))] };
  const changes: string[] = [];
  t.columns = t.columns.filter((c) => c.name !== id.column); changes.push(`Deleted ${id.table}.${id.column}.`);
  if (allDeps.length) {
    const relIds = new Set(allDeps.filter((d) => d.relationshipId).map((d) => d.relationshipId));
    next.relationships = next.relationships.filter((r) => { if (relIds.has(r.id)) { changes.push(`Removed relationship ${r.fromTable}.${r.fromColumn} → ${r.toTable}.${r.toColumn}.`); return false; } return true; });
    allDeps.filter((d) => d.kind === 'foreign-key').forEach((d) => { const c = next.tables.find((x) => x.name === d.table)?.columns.find((x) => x.name === d.column); if (c) { c.isForeignKey = false; c.references = undefined; changes.push(`Unlinked foreign key ${d.table}.${d.column} (column kept).`); } });
  }
  if (t.columns.length === 0) { next.tables = next.tables.filter((x) => x !== t); changes.push(`Removed now-empty table ${t.name}.`); }
  const errors = integrityErrors(next.tables);
  if (errors.length) return { ok: false, changes: [], errors, dependencies: allDeps };
  const isDangling = (sc: SchemaModel, r: RelationshipDef) => !sc.tables.some((x) => x.name === r.fromTable && x.columns.some((c) => c.name === r.fromColumn)) || !sc.tables.some((x) => x.name === r.toTable && x.columns.some((c) => c.name === r.toColumn));
  const preExisting = new Set(schema.relationships.filter((r) => isDangling(schema, r)).map((r) => r.id));
  const dangling = next.relationships.filter((r) => isDangling(next, r) && !preExisting.has(r.id));
  if (dangling.length) return { ok: false, changes: [], dependencies: allDeps, errors: [makeError('SCHEMA_UPDATE_FAILED', 'The delete would leave relationships pointing at columns that no longer exist, so it was not applied.', dangling.map((r) => `${r.fromTable}.${r.fromColumn} → ${r.toTable}.${r.toColumn}`))] };
  return { ok: true, schema: next, changes, errors: [], dependencies: allDeps };
}

/** Option list for the row editor: the 5 standard types plus the record's own real-world type, so editing never silently changes it. */
export function dataTypeOptionValues(current: string, standard: string[]): string[] { const cur = String(current || '').trim(); return cur && !standard.some((s) => U(s) === U(cur)) ? [cur, ...standard] : [...standard]; }
