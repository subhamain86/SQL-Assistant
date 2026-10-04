/**
 * Schema file format, legacy migration and strict validation (single source of truth for load, import, pull, push).
 * Rules (see docs/V17.3-ROOT-CAUSE.md):
 *   L1 decode code/value/raw/key → rawValue: first NON-empty alias wins. Lossless → applied to every file.
 *   Legacy files only (no writer stamp = V17.0 or older):
 *   L2 empty raw + empty label → removed     L3 empty raw + label → kept in unmappedDecodeLabels (never invented)
 *   L4 exact duplicate decode → de-duplicated L5 primary_key/foreign_key/schema_name → current names
 *   L6 FK to a table/column outside the schema → unresolvedReference (documentation, not used for joins)
 * Anything else stays an error with an exact path; validation is never relaxed.
 */
import type { SchemaModel, SchemaRegistry, TableDef, ColumnDef, DecodeEntry, RelationshipDef, SchemaMigrationInfo } from '../../types';
export const APP_VERSION = '17.3.0';
export const APP_NAME = 'SQL Assistant';
export const SCHEMA_FORMAT_VERSION = 2;
export const WRITER_LABEL = `${APP_NAME} ${APP_VERSION}`;
export const LEGACY_FORMAT_LABEL = 'SQL Assistant V17.0 or older (no writer stamp)';
export interface SchemaIssue { severity: 'error' | 'warning'; code: string; message: string; path: string; table?: string; column?: string; property?: string; }
export interface MigrationNote { rule: 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6'; path: string; message: string; }
export const describeIssue = (i: SchemaIssue) => `${i.message} (at ${i.path})`;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
const ts = (v: unknown) => str(v).trim();
function first(o: Record<string, unknown>, k: string[]): unknown { for (const x of k) if (o[x] !== undefined && o[x] !== null) return o[x]; return undefined; }
function firstNonEmpty(o: Record<string, unknown>, k: string[]): { key: string | null; value: string } { for (const x of k) { const v = ts(o[x]); if (v) return { key: x, value: v }; } return { key: null, value: '' }; }
function bool(v: unknown, fb = false): boolean { if (typeof v === 'boolean') return v; if ([1, '1', 'true', 'Y', 'y', 'yes'].includes(v as never)) return true; if ([0, '0', 'false', 'N', 'n', 'no'].includes(v as never)) return false; return fb; }
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? +v : undefined);
const U = (s: string) => s.trim().toUpperCase();
export interface WriterInfo { stamped: boolean; formatVersion: number | null; writtenBy: string | null; legacy: boolean; label: string; }
export function detectWriter(reg: unknown): WriterInfo { const o = isObj(reg) ? reg : {}; const wb = ts(o.writtenBy) || null; const fv = typeof o.formatVersion === 'number' ? o.formatVersion : null; const st = !!wb || fv !== null; return { stamped: st, formatVersion: fv, writtenBy: wb, legacy: !st, label: st ? wb || `format ${fv}` : LEGACY_FORMAT_LABEL }; }
interface Ctx { legacy: boolean; issues: SchemaIssue[]; notes: MigrationNote[]; }
function normDecode(raw: unknown, path: string, t: string, col: string, c: Ctx): { decode?: DecodeEntry[]; unmapped: string[] } {
  const um: string[] = []; if (raw === undefined || raw === null) return { unmapped: um };
  let list: unknown[]; if (Array.isArray(raw)) list = raw; else if (isObj(raw)) { list = Object.entries(raw).map(([k, v]) => ({ rawValue: k, label: str(v) })); c.notes.push({ rule: 'L1', path, message: `${t}.${col}: decode map converted to a list.` }); }
  else { c.issues.push({ severity: 'error', code: 'DECODE_NOT_ARRAY', message: `Invalid column definition: Column "${t}.${col}" has a decode value that is not a list.`, path, table: t, column: col, property: 'decode' }); return { unmapped: um }; }
  const out: DecodeEntry[] = []; const seen = new Set<string>();
  list.forEach((e, i) => { const p = `${path}[${i}]`;
    if (!isObj(e)) { c.issues.push({ severity: 'error', code: 'DECODE_ENTRY_INVALID', message: `Invalid column definition: Column "${t}.${col}" has a decode entry (#${i + 1}) that is not an object.`, path: p, table: t, column: col, property: 'decode' }); return; }
    const rp = firstNonEmpty(e, ['rawValue', 'raw', 'value', 'code', 'key', 'id']); const label = ts(first(e, ['label', 'description', 'name', 'text']));
    if (rp.key && rp.key !== 'rawValue') c.notes.push({ rule: 'L1', path: `${p}.${rp.key}`, message: `${t}.${col} decode #${i + 1}: raw value read from "${rp.key}".` });
    if (!rp.value) { if (c.legacy && !label) { c.notes.push({ rule: 'L2', path: p, message: `${t}.${col} decode #${i + 1}: empty placeholder removed.` }); return; }
      if (c.legacy) { um.push(label); c.notes.push({ rule: 'L3', path: p, message: `${t}.${col} decode #${i + 1}: label "${label}" has no raw code — preserved as unmapped.` }); return; }
      out.push({ rawValue: '', label }); return; }
    const k = `${rp.value}\u0000${label}`; if (c.legacy && seen.has(k)) { c.notes.push({ rule: 'L4', path: p, message: `${t}.${col} decode #${i + 1}: exact duplicate removed.` }); return; } seen.add(k); out.push({ rawValue: rp.value, label }); });
  return { decode: out.length ? out : undefined, unmapped: um };
}
function normColumn(raw: unknown, path: string, t: string, c: Ctx): ColumnDef | null {
  if (!isObj(raw)) { c.issues.push({ severity: 'error', code: 'COLUMN_NOT_OBJECT', message: `Invalid column definition in table "${t}": entry is not an object.`, path, table: t }); return null; }
  const name = ts(first(raw, ['name', 'columnName', 'column_name'])); const fkObj = isObj(raw.foreign_key) ? raw.foreign_key : isObj(raw.foreignKey) ? raw.foreignKey : null;
  if (fkObj || 'primary_key' in raw) c.notes.push({ rule: 'L5', path, message: `${t}.${name}: legacy key names mapped.` });
  const refs = isObj(raw.references) ? raw.references : fkObj; const isFk = bool(raw.isForeignKey) || raw.foreignKey === true || !!fkObj;
  const { decode, unmapped } = normDecode(raw.decode ?? raw.values, `${path}.decode`, t, name || '?', c);
  const col: ColumnDef = { name, label: ts(raw.label) || name, type: ts(first(raw, ['type', 'dataType', 'data_type'])), nullable: bool(raw.nullable, true), description: str(first(raw, ['description', 'comment'])) };
  if (bool(first(raw, ['isPrimaryKey', 'primaryKey', 'primary_key', 'pk']))) col.isPrimaryKey = true;
  const l = num(raw.length); if (l !== undefined) col.length = l; const pr = num(raw.precision); if (pr !== undefined) col.precision = pr; if (ts(raw.alias)) col.alias = ts(raw.alias);
  if (isFk) { col.isForeignKey = true; col.references = { table: ts(refs ? first(refs, ['table', 'toTable']) : raw.fkTable), column: ts(refs ? first(refs, ['column', 'toColumn']) : raw.fkColumn) }; }
  if (decode) col.decode = decode; const prev = Array.isArray(raw.unmappedDecodeLabels) ? raw.unmappedDecodeLabels.map(ts).filter(Boolean) : []; const all = Array.from(new Set([...prev, ...unmapped])); if (all.length) col.unmappedDecodeLabels = all;
  if (isObj(raw.unresolvedReference)) col.unresolvedReference = { table: ts(raw.unresolvedReference.table), column: ts(raw.unresolvedReference.column) };
  return col;
}
export function normalizeSchema(raw: unknown, o: { index?: number; legacy?: boolean; basePath?: string } = {}): { schema: SchemaModel | null; issues: SchemaIssue[]; notes: MigrationNote[] } {
  const bp = o.basePath ?? (o.index !== undefined ? `schemas[${o.index}]` : 'schema'); const c: Ctx = { legacy: !!o.legacy, issues: [], notes: [] };
  if (!isObj(raw)) { c.issues.push({ severity: 'error', code: 'SCHEMA_NOT_OBJECT', message: 'Invalid schema: entry is not an object.', path: bp }); return { schema: null, ...c }; }
  const name = ts(first(raw, ['name', 'schemaName', 'schema_name'])); const tables: TableDef[] = [];
  if (raw.tables !== undefined && !Array.isArray(raw.tables)) c.issues.push({ severity: 'error', code: 'TABLES_NOT_ARRAY', message: 'Invalid schema: "tables" is not a list.', path: `${bp}.tables` });
  else ((raw.tables as unknown[]) || []).forEach((t, i) => { const p = `${bp}.tables[${i}]`; if (!isObj(t)) { c.issues.push({ severity: 'error', code: 'TABLE_NOT_OBJECT', message: 'Invalid table definition: entry is not an object.', path: p }); return; }
    const tn = ts(first(t, ['name', 'tableName', 'table_name'])); const cols: ColumnDef[] = [];
    if (t.columns !== undefined && !Array.isArray(t.columns)) c.issues.push({ severity: 'error', code: 'COLUMNS_NOT_ARRAY', message: `Invalid table definition: "${tn}" has columns that are not a list.`, path: `${p}.columns`, table: tn });
    else ((t.columns as unknown[]) || []).forEach((col, j) => { const n = normColumn(col, `${p}.columns[${j}]`, tn || '?', c); if (n) cols.push(n); });
    const td: TableDef = { name: tn, module: ts(t.module) || 'General', description: str(t.description), columns: cols }; const ot = ts(t.objectType).toUpperCase(); if (ot === 'VIEW' || ot === 'TABLE') td.objectType = ot; tables.push(td); });
  const rels: RelationshipDef[] = []; ((Array.isArray(raw.relationships) ? raw.relationships : []) as unknown[]).forEach((r, i) => { if (isObj(r)) rels.push({ id: ts(r.id) || `rel-${i + 1}`, fromTable: ts(r.fromTable), fromColumn: ts(r.fromColumn), toTable: ts(r.toTable), toColumn: ts(r.toColumn), kind: (['one-to-many', 'many-to-one', 'one-to-one'].includes(ts(r.kind)) ? ts(r.kind) : 'many-to-one') as RelationshipDef['kind'] }); });
  if (raw.relationships !== undefined && raw.relationships !== null && !Array.isArray(raw.relationships)) c.issues.push({ severity: 'error', code: 'RELATIONSHIPS_NOT_ARRAY', message: 'Invalid schema: "relationships" is not a list.', path: `${bp}.relationships` });
  const st = ts(raw.status);
  const schema: SchemaModel = { id: ts(raw.id) || `schema-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'imported'}`, name, version: ts(first(raw, ['version', 'schema_version'])) || '1.0', status: (['active', 'default', 'inactive'].includes(st) ? st : 'inactive') as SchemaModel['status'], updatedAt: ts(raw.updatedAt) || new Date(0).toISOString(), lastSyncedAt: ts(raw.lastSyncedAt) || null, tables, relationships: rels };
  if (isObj(raw.migration)) schema.migration = raw.migration as unknown as SchemaMigrationInfo;
  if (c.legacy) { const byName = new Map(tables.map((t) => [U(t.name), t])); tables.forEach((t, ti) => t.columns.forEach((col, ci) => { if (!col.isForeignKey || !col.references) return; const tg = byName.get(U(col.references.table)); if (tg && tg.columns.some((x) => U(x.name) === U(col.references!.column))) return; col.unresolvedReference = { ...col.references }; delete col.isForeignKey; delete col.references; c.notes.push({ rule: 'L6', path: `${bp}.tables[${ti}].columns[${ci}].foreign_key`, message: `${t.name}.${col.name}: reference outside this schema kept as documentation.` }); })); }
  return { schema, ...c };
}
export interface ValidationOutcome { valid: boolean; errors: SchemaIssue[]; warnings: SchemaIssue[]; }
export function validateSchemaModel(s: Pick<SchemaModel, 'tables' | 'relationships'> & Partial<SchemaModel>, bp = 'schema'): ValidationOutcome {
  const errors: SchemaIssue[] = []; const warnings: SchemaIssue[] = []; const E = (i: Omit<SchemaIssue, 'severity'>) => errors.push({ severity: 'error', ...i });
  if (s.name !== undefined && !ts(s.name)) E({ code: 'SCHEMA_NAME_EMPTY', message: 'Invalid schema: name is empty.', path: `${bp}.name`, property: 'name' });
  if (!Array.isArray(s.tables)) { E({ code: 'TABLES_NOT_ARRAY', message: 'Invalid schema: "tables" is not a list.', path: `${bp}.tables` }); return { valid: false, errors, warnings }; }
  if (!s.tables.length) E({ code: 'SCHEMA_NO_TABLES', message: 'Invalid schema: it contains no tables.', path: `${bp}.tables` });
  const names = new Set<string>(); const find = (n: string) => s.tables.find((x) => isObj(x) && U(ts(x.name)) === U(n));
  s.tables.forEach((t, ti) => { const tp = `${bp}.tables[${ti}]`; const tn = ts(t?.name);
    if (!tn) E({ code: 'TABLE_NAME_EMPTY', message: `Invalid table definition: table #${ti + 1} has an empty name.`, path: `${tp}.name`, property: 'name' }); else if (names.has(U(tn))) E({ code: 'TABLE_DUPLICATE', message: `Invalid table definition: table "${tn}" is defined more than once.`, path: `${tp}.name`, table: tn }); else names.add(U(tn));
    if (!Array.isArray(t?.columns)) { E({ code: 'COLUMNS_NOT_ARRAY', message: `Invalid table definition: "${tn}" has columns that are not a list.`, path: `${tp}.columns`, table: tn }); return; }
    if (!t.columns.length) E({ code: 'TABLE_NO_COLUMNS', message: `Invalid table definition: table "${tn}" has no columns.`, path: `${tp}.columns`, table: tn });
    const cn = new Set<string>();
    t.columns.forEach((col, ci) => { const cp = `${tp}.columns[${ci}]`; const n = ts(col?.name);
      if (!n) E({ code: 'COLUMN_NAME_EMPTY', message: `Invalid column definition: table "${tn}" has a column (#${ci + 1}) with an empty name.`, path: `${cp}.name`, table: tn, property: 'name' }); else if (cn.has(U(n))) E({ code: 'COLUMN_DUPLICATE', message: `Invalid column definition: Column "${tn}.${n}" is defined more than once.`, path: `${cp}.name`, table: tn, column: n }); else cn.add(U(n));
      if (!ts(col?.type)) E({ code: 'COLUMN_TYPE_EMPTY', message: `Invalid column definition: Column "${tn}.${n}" has no data type.`, path: `${cp}.type`, table: tn, column: n, property: 'type' });
      if (typeof col?.nullable !== 'boolean') E({ code: 'COLUMN_PROPERTY_INVALID', message: `Invalid column definition: Column "${tn}.${n}" has a non-boolean "nullable".`, path: `${cp}.nullable`, table: tn, column: n, property: 'nullable' });
      (['length', 'precision'] as const).forEach((k) => { const v = col?.[k]; if (v !== undefined && v !== null && (typeof v !== 'number' || v < 0)) E({ code: 'COLUMN_PROPERTY_INVALID', message: `Invalid column definition: Column "${tn}.${n}" has an invalid "${k}".`, path: `${cp}.${k}`, table: tn, column: n, property: k }); });
      if (col?.decode !== undefined) { if (!Array.isArray(col.decode)) E({ code: 'DECODE_NOT_ARRAY', message: `Invalid column definition: Column "${tn}.${n}" has a decode value that is not a list.`, path: `${cp}.decode`, table: tn, column: n, property: 'decode' });
        else { const seen = new Map<string, string>(); col.decode.forEach((d, di) => { const dp = `${cp}.decode[${di}]`; const rv = ts(d?.rawValue);
          if (!rv) { E({ code: 'DECODE_RAW_EMPTY', message: `Invalid column definition: Column "${tn}.${n}" has a decode entry (#${di + 1}) with an empty raw value.`, path: `${dp}.rawValue`, table: tn, column: n, property: 'rawValue' }); return; }
          if (seen.has(rv) && seen.get(rv) !== ts(d.label)) E({ code: 'DECODE_DUPLICATE', message: `Invalid column definition: Column "${tn}.${n}" maps raw value "${rv}" to two different labels.`, path: `${dp}.rawValue`, table: tn, column: n, property: 'rawValue' }); seen.set(rv, ts(d.label)); }); } }
      if (col?.unmappedDecodeLabels?.length) warnings.push({ severity: 'warning', code: 'LEGACY_UNMAPPED_DECODE', message: `Column "${tn}.${n}" has ${col.unmappedDecodeLabels.length} legacy decode label(s) without a raw code.`, path: `${cp}.unmappedDecodeLabels`, table: tn, column: n });
      if (col?.isForeignKey) { const rt = ts(col.references?.table), rc = ts(col.references?.column); const tg = rt ? find(rt) : undefined;
        if (!rt || !rc) E({ code: 'FK_INCOMPLETE', message: `Invalid column definition: Column "${tn}.${n}" is a foreign key without a complete reference.`, path: `${cp}.references`, table: tn, column: n, property: 'references' });
        else if (!tg) E({ code: 'FK_TABLE_NOT_FOUND', message: `Invalid column definition: Column "${tn}.${n}" references table "${rt}", which is not in this schema.`, path: `${cp}.references.table`, table: tn, column: n, property: 'references.table' });
        else if (!tg.columns.some((x) => U(ts(x?.name)) === U(rc))) E({ code: 'FK_COLUMN_NOT_FOUND', message: `Invalid column definition: Column "${tn}.${n}" references "${rt}.${rc}", which does not exist.`, path: `${cp}.references.column`, table: tn, column: n, property: 'references.column' }); } }); });
  (s.relationships || []).forEach((r, ri) => { ([['fromTable', 'fromColumn'], ['toTable', 'toColumn']] as const).forEach(([tk, ck]) => { const tb = find(ts(r[tk])); if (!tb) E({ code: 'REL_TABLE_NOT_FOUND', message: `Invalid relationship: table "${r[tk]}" is not in this schema.`, path: `${bp}.relationships[${ri}].${tk}` }); else if (!tb.columns.some((x) => U(ts(x.name)) === U(ts(r[ck])))) E({ code: 'REL_COLUMN_NOT_FOUND', message: `Invalid relationship: column "${r[tk]}.${r[ck]}" does not exist.`, path: `${bp}.relationships[${ri}].${ck}` }); }); });
  return { valid: !errors.length, errors, warnings };
}
export type MigrationStatus = 'current' | 'legacy-clean' | 'migrated' | 'migration-failed' | 'invalid';
export interface SchemaReport { index: number; name: string; id: string; schema: SchemaModel | null; valid: boolean; errors: SchemaIssue[]; warnings: SchemaIssue[]; legacy: boolean; migrationStatus: MigrationStatus; migrationNotes: MigrationNote[]; }
export interface RegistryReport { fileProblem: SchemaIssue | null; writer: WriterInfo; schemas: SchemaReport[]; validSchemas: SchemaModel[]; invalidSchemas: SchemaReport[]; migratedSchemas: SchemaReport[]; activeSchemaId: string | null; activeSchemaUpdatedAt: string | null; }
export function checkRegistry(input: { text?: string; value?: unknown }, now: () => string = () => new Date().toISOString()): RegistryReport {
  const bad = (p: SchemaIssue, w = detectWriter(null)): RegistryReport => ({ fileProblem: p, writer: w, schemas: [], validSchemas: [], invalidSchemas: [], migratedSchemas: [], activeSchemaId: null, activeSchemaUpdatedAt: null });
  let v = input.value; let text = input.text;
  if (text !== undefined) { if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); if (!text.trim()) return bad({ severity: 'error', code: 'FILE_EMPTY', message: 'The schema file is empty.', path: '$' }); if (/^\s*</.test(text)) return bad({ severity: 'error', code: 'FILE_HTML', message: 'The repository returned an HTML page instead of the schema file (wrong path, sign-in or proxy page).', path: '$' }); try { v = JSON.parse(text); } catch (e) { return bad({ severity: 'error', code: 'FILE_NOT_JSON', message: `The schema file is not valid JSON (${(e as Error).message}).`, path: '$' }); } }
  const reg: Record<string, unknown> = Array.isArray(v) ? { schemas: v } : isObj(v) && !Array.isArray(v.schemas) && Array.isArray(v.tables) ? { schemas: [v] } : isObj(v) && isObj(v.registry) && Array.isArray(v.registry.schemas) ? v.registry : isObj(v) ? v : {};
  if (!Array.isArray(reg.schemas)) return bad({ severity: 'error', code: 'FILE_NOT_REGISTRY', message: 'The schema file has no "schemas" list.', path: '$.schemas' });
  const w = detectWriter(isObj(v) ? v : reg);
  if (w.formatVersion !== null && w.formatVersion > SCHEMA_FORMAT_VERSION) return bad({ severity: 'error', code: 'FILE_NEWER_FORMAT', message: `The schema file uses format ${w.formatVersion} (${w.writtenBy || 'a newer version'}). Update SQL Assistant to read it.`, path: '$.formatVersion' }, w);
  const schemas = (reg.schemas as unknown[]).map((raw, i): SchemaReport => {
    const n = normalizeSchema(raw, { index: i, legacy: w.legacy }); const name = n.schema?.name || `schema #${i + 1}`;
    if (!n.schema) return { index: i, name, id: '', schema: null, valid: false, errors: n.issues, warnings: [], legacy: w.legacy, migrationStatus: w.legacy ? 'migration-failed' : 'invalid', migrationNotes: n.notes };
    const val = validateSchemaModel(n.schema, `schemas[${i}]`); const errors = [...n.issues.filter((x) => x.severity === 'error'), ...val.errors]; const valid = !errors.length;
    let st: MigrationStatus = valid ? (n.notes.length ? 'migrated' : 'current') : 'invalid'; if (w.legacy) st = !valid ? 'migration-failed' : n.notes.length ? 'migrated' : 'legacy-clean';
    if (st === 'migrated' && !n.schema.migration) n.schema.migration = { fromFormat: w.label, migratedAt: now(), migratedBy: WRITER_LABEL, changes: n.notes.length, warnings: n.notes.some((x) => x.rule === 'L3') ? [`${n.notes.filter((x) => x.rule === 'L3').length} decode label(s) had no raw code and are kept as unmapped labels.`] : [] };
    return { index: i, name, id: n.schema.id, schema: n.schema, valid, errors, warnings: val.warnings, legacy: w.legacy, migrationStatus: st, migrationNotes: n.notes };
  });
  return { fileProblem: null, writer: w, schemas, validSchemas: schemas.filter((s) => s.valid).map((s) => s.schema!), invalidSchemas: schemas.filter((s) => !s.valid), migratedSchemas: schemas.filter((s) => s.migrationStatus === 'migrated'), activeSchemaId: ts(reg.activeSchemaId) || null, activeSchemaUpdatedAt: ts(reg.activeSchemaUpdatedAt) || null };
}
export function summarizeMigration(notes: MigrationNote[]): string[] {
  const n = (r: MigrationNote['rule']) => notes.filter((x) => x.rule === r).length; const o: string[] = [];
  if (n('L1')) o.push(`${n('L1')} decode raw value(s) read from legacy keys (e.g. "code").`); if (n('L5')) o.push(`${n('L5')} legacy property name(s) mapped.`); if (n('L2')) o.push(`${n('L2')} empty placeholder decode entries removed.`);
  if (n('L4')) o.push(`${n('L4')} exact duplicate decode entries removed.`); if (n('L3')) o.push(`${n('L3')} decode label(s) without a raw code preserved as unmapped labels.`); if (n('L6')) o.push(`${n('L6')} reference(s) outside this schema kept as documentation.`); return o;
}
export function serializeRegistry(reg: SchemaRegistry, device = '', now: () => string = () => new Date().toISOString()): { ok: boolean; text: string; problems: { name: string; errors: SchemaIssue[] }[] } {
  const problems = reg.schemas.map((s, i) => ({ name: s.name, errors: validateSchemaModel(s, `schemas[${i}]`).errors })).filter((p) => p.errors.length);
  if (problems.length) return { ok: false, text: '', problems };
  return { ok: true, text: JSON.stringify({ formatVersion: SCHEMA_FORMAT_VERSION, writtenBy: WRITER_LABEL, writtenByDevice: device, writtenAt: now(), activeSchemaId: reg.activeSchemaId, activeSchemaUpdatedAt: reg.activeSchemaUpdatedAt ?? null, schemas: reg.schemas }, null, 2), problems };
}
export function recoverDecodeFromSource(target: SchemaModel, src: unknown): { schema: SchemaModel; restored: number; stillUnmapped: number } {
  const s = normalizeSchema(Array.isArray((src as { schemas?: unknown[] })?.schemas) ? (src as { schemas: unknown[] }).schemas[0] : src, { legacy: true }).schema;
  const next: SchemaModel = JSON.parse(JSON.stringify(target)); let r = 0, st = 0;
  next.tables.forEach((t) => t.columns.forEach((c) => { if (!c.unmappedDecodeLabels?.length) return; const sc = s?.tables.find((x) => U(x.name) === U(t.name))?.columns.find((x) => U(x.name) === U(c.name)); const rem: string[] = [];
    c.unmappedDecodeLabels.forEach((l) => { const h = sc?.decode?.find((d) => U(d.label) === U(l) && d.rawValue); if (h) { (c.decode = c.decode || []).push({ ...h }); r++; } else rem.push(l); }); if (rem.length) { c.unmappedDecodeLabels = rem; st += rem.length; } else delete c.unmappedDecodeLabels; }));
  return { schema: next, restored: r, stillUnmapped: st };
}
export function legacyLeftovers(s: SchemaModel): { unmappedLabels: number; unresolvedRefs: number } { let a = 0, b = 0; s.tables.forEach((t) => t.columns.forEach((c) => { a += c.unmappedDecodeLabels?.length || 0; if (c.unresolvedReference) b++; })); return { unmappedLabels: a, unresolvedRefs: b }; }
