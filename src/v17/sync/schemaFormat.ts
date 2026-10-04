/**
 * The single schema format authority (V17.1+). EVERY path that reads or writes schema data uses this module:
 * local load, import, Manual Schema Update, push, public discovery, authenticated pull, conflict resolution
 * and the diagnostics CLI.
 *
 * Pipeline:  parseRegistryText → normalizeRegistry (lossless legacy conversions, each one reported)
 *            → validateSchemaModel (exact JSON paths + table/column names) → per-schema verdict.
 * Validation is never relaxed: errors still block. Repairs are only applied by an explicit user action.
 * V17.2: contentHash() (3-way sync merge), stageOf() (failing-stage labels), writer/device provenance,
 *        decode raw values compared exactly (database codes are case-sensitive).
 */
import type { SchemaModel, TableDef, ColumnDef, RelationshipDef, DecodeEntry, SchemaRegistry, SchemaStatus } from '../../types';

export const REGISTRY_FORMAT_VERSION = 2;
export const APP_VERSION = '17.2.0';
export const APP_NAME = 'SQL Assistant';

export type IssueSeverity = 'error' | 'warning';
export type IssueCode =
  | 'NOT_OBJECT' | 'TABLES_MISSING' | 'TABLE_NOT_OBJECT' | 'TABLE_NAME_MISSING' | 'TABLE_NAME_CHARS' | 'TABLE_NAME_UNUSUAL' | 'DUPLICATE_TABLE'
  | 'OBJECT_TYPE_INVALID' | 'COLUMNS_INVALID' | 'NO_COLUMNS' | 'COLUMN_NOT_OBJECT' | 'COLUMN_NAME_MISSING' | 'COLUMN_NAME_CHARS' | 'COLUMN_NAME_UNUSUAL'
  | 'DUPLICATE_COLUMN' | 'TYPE_MISSING' | 'TYPE_INVALID' | 'BOOLEAN_INVALID' | 'NUMBER_INVALID' | 'NEGATIVE_NUMBER'
  | 'FK_REFERENCE_MISSING' | 'FK_TABLE_NOT_FOUND' | 'FK_COLUMN_NOT_FOUND' | 'DECODE_INVALID' | 'DECODE_EMPTY_RAW' | 'DECODE_DUPLICATE_RAW' | 'DECODE_EMPTY_LABEL'
  | 'RELATIONSHIPS_INVALID' | 'RELATIONSHIP_INCOMPLETE' | 'RELATIONSHIP_DANGLING' | 'RELATIONSHIP_DUPLICATE_ID'
  | 'PK_COMPOSITE' | 'PK_MISSING' | 'DUPLICATE_SCHEMA_ID' | 'SCHEMA_NAME_MISSING';
export interface SchemaIssue { severity: IssueSeverity; code: IssueCode; path: string; message: string; repairable?: boolean; }
export type FileProblemCode = 'EMPTY' | 'HTML' | 'LFS_POINTER' | 'MERGE_CONFLICT' | 'INVALID_JSON' | 'NOT_A_REGISTRY' | 'UNSUPPORTED_VERSION';
export interface FileProblem { code: FileProblemCode; message: string; }
export interface SchemaReport { index: number; id: string; name: string; valid: boolean; errors: SchemaIssue[]; warnings: SchemaIssue[]; notes: string[]; schema: SchemaModel | null; allErrorsRepairable: boolean; }
export interface RegistryReport {
  fileProblem: FileProblem | null; detectedFormat: string; formatVersion: number | null; writtenBy: string | null; writtenByDevice: string | null;
  schemas: SchemaReport[]; registryNotes: string[]; activeSchemaId: string | null; activeSchemaUpdatedAt: string | null;
  validSchemas: SchemaModel[]; invalidSchemas: SchemaReport[];
}
/** V17.2 — the synchronisation stage at which a problem was detected (shown in every sync error). */
export type SyncStage = 'Remote file retrieval failed' | 'Remote file could not be parsed' | 'Schema structure is invalid' | 'Required schema property is missing' | 'Invalid table definition' | 'Invalid column definition' | 'Invalid relationship definition' | 'Duplicate schema object' | 'Schema version is unsupported' | 'Schema normalization failed' | 'Schema persistence failed';
export function fileProblemStage(code: FileProblemCode): SyncStage { return code === 'UNSUPPORTED_VERSION' ? 'Schema version is unsupported' : code === 'NOT_A_REGISTRY' ? 'Schema structure is invalid' : 'Remote file could not be parsed'; }
export function stageOf(i: Pick<SchemaIssue, 'code'>): SyncStage {
  const c = i.code;
  if (c.startsWith('DUPLICATE_')) return 'Duplicate schema object';
  if (c === 'TABLES_MISSING' || c === 'NOT_OBJECT' || c === 'SCHEMA_NAME_MISSING') return 'Required schema property is missing';
  if (c.startsWith('RELATIONSHIP')) return 'Invalid relationship definition';
  if (c.startsWith('TABLE_') || c === 'OBJECT_TYPE_INVALID' || c === 'COLUMNS_INVALID' || c === 'NO_COLUMNS' || c.startsWith('PK_')) return 'Invalid table definition';
  return 'Invalid column definition';
}

// ---------------------------------------------------------------- parsing
function describeChar(ch: string | undefined): string {
  if (ch === undefined) return 'end of file';
  const cp = ch.codePointAt(0)!; const hex = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  if (cp < 32) return `control character ${hex}${cp === 9 ? ' (tab)' : cp === 10 ? ' (line feed)' : cp === 13 ? ' (carriage return)' : ''}`;
  if (cp === 0xfeff) return `byte-order mark ${hex}`;
  if ([0x200b, 0x200c, 0x200d, 0x2060, 0x00a0].includes(cp)) return `invisible character ${hex}`;
  if ([0x201c, 0x201d, 0x2018, 0x2019].includes(cp)) return `typographic quote "${ch}" ${hex} (JSON requires straight double quotes)`;
  return `"${ch}" (${hex})`;
}
/** Finds the offset of the first JSON syntax error (V8 does not always report one). Returns -1 when none is found. */
export function locateJsonError(t: string): number {
  let i = 0; const n = t.length;
  const ws = () => { while (i < n && ' \t\n\r'.includes(t[i])) i++; };
  const fail = (): never => { throw i; };
  const str = () => { if (t[i] !== '"') fail(); i++; while (i < n) { const c = t[i]; if (c === '"') { i++; return; } if (c === '\\') { i += 2; continue; } if (c.charCodeAt(0) < 32) fail(); i++; } fail(); };
  const lit = (w: string) => { if (t.startsWith(w, i)) i += w.length; else fail(); };
  const num = () => { const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(t.slice(i)); if (!m || !m[0]) fail(); i += m![0].length; };
  const val = (): void => { ws(); const c = t[i]; if (c === '{') { i++; ws(); if (t[i] === '}') { i++; return; } for (;;) { ws(); str(); ws(); if (t[i] !== ':') fail(); i++; val(); ws(); if (t[i] === ',') { i++; continue; } if (t[i] === '}') { i++; return; } fail(); } } if (c === '[') { i++; ws(); if (t[i] === ']') { i++; return; } for (;;) { val(); ws(); if (t[i] === ',') { i++; continue; } if (t[i] === ']') { i++; return; } fail(); } } if (c === '"') return str(); if (c === 't') return lit('true'); if (c === 'f') return lit('false'); if (c === 'n') return lit('null'); if (c === '-' || (c >= '0' && c <= '9')) return num(); fail(); };
  try { val(); ws(); return i < n ? i : -1; } catch (pos) { return typeof pos === 'number' ? pos : -1; }
}
function lineCol(text: string, pos: number): { line: number; col: number } { const before = text.slice(0, pos); const lines = before.split('\n'); return { line: lines.length, col: lines[lines.length - 1].length + 1 }; }
export interface ParsedText { value?: unknown; problem?: FileProblem; notes: string[]; }
export function parseRegistryText(textRaw: string): ParsedText {
  const notes: string[] = [];
  let text = String(textRaw ?? '');
  if (text.charCodeAt(0) === 0xfeff) { text = text.slice(1); notes.push('Removed a UTF-8 byte-order mark (BOM) at the start of the file (added by some editors; not valid JSON).'); }
  const trimmed = text.trim();
  if (!trimmed) return { notes, problem: { code: 'EMPTY', message: 'The schema file is empty (0 bytes of content). It may have been created but never written, or truncated during an upload.' } };
  if (/^<(!doctype|html|\?xml|head|body)/i.test(trimmed)) return { notes, problem: { code: 'HTML', message: 'The repository returned an HTML page instead of JSON. This usually means a sign-in page, a proxy/firewall page or a wrong URL/path was received instead of the schema file.' } };
  if (/^version https:\/\/git-lfs/i.test(trimmed)) return { notes, problem: { code: 'LFS_POINTER', message: 'The schema file is stored with Git LFS, so the repository returned an LFS pointer instead of the file content. Store sql-assistant-data/schemas/registry.json as a normal Git file.' } };
  const conflictLine = trimmed.split('\n').findIndex((l) => /^(<{7}|={7}|>{7})( |$)/.test(l));
  if (conflictLine >= 0) return { notes, problem: { code: 'MERGE_CONFLICT', message: `The schema file contains unresolved Git merge-conflict markers (<<<<<<< / ======= / >>>>>>>) at line ${conflictLine + 1}. Resolve the conflict in the repository, or publish a valid copy from a device.` } };
  try { return { value: JSON.parse(text), notes }; }
  catch (e) {
    const msg = (e as Error).message || 'parse error';
    const posM = msg.match(/position (\d+)/i); const located = posM ? +posM[1] : locateJsonError(text);
    let where = ''; let hint = '';
    if (located >= 0 && located < text.length) {
      const pos = located; const { line, col } = lineCol(text, pos); const ch = text[pos];
      const snippet = text.slice(Math.max(0, pos - 30), pos + 30).replace(/\n/g, '⏎').replace(/[\u0000-\u001f]/g, '·');
      where = ` at line ${line}, column ${col} (unexpected ${describeChar(ch)}; near "${snippet}")`;
      const prev = text.slice(0, pos).replace(/\s+$/, '').slice(-1);
      if ((ch === '}' || ch === ']') && prev === ',') hint = ' A trailing comma before a closing bracket is not allowed in JSON.';
      else if (ch === "'") hint = ' JSON strings must use double quotes, not single quotes.';
      else if (ch && ch.charCodeAt(0) < 32) hint = ' A line break or control character appears inside a string; it must be escaped (\\n, \\t).';
      else if (/[\u201c\u201d\u2018\u2019]/.test(ch || '')) hint = ' The file was probably edited in a word processor that replaced quotes.';
    } else if (/unexpected end/i.test(msg) || located >= text.length) { where = ' (the file ends before the JSON is complete — it was probably truncated or only partially written)'; }
    if (/\bNaN\b|\bInfinity\b|\bundefined\b/.test(text) && !hint) hint = ' NaN, Infinity and undefined are not valid JSON values.';
    return { notes, problem: { code: 'INVALID_JSON', message: `The schema file is not valid JSON${where}.${hint}` } };
  }
}

// ---------------------------------------------------------------- normalisation (lossless only)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const pick = (o: Record<string, unknown>, keys: string[]): { key: string; value: unknown } | null => { for (const k of keys) if (k in o && o[k] !== undefined) return { key: k, value: o[k] }; return null; };
class Notes { private counts = new Map<string, number>(); add(msg: string): void { this.counts.set(msg, (this.counts.get(msg) || 0) + 1); } list(): string[] { return Array.from(this.counts.entries()).map(([m, n]) => (n > 1 ? `${m} (${n}×)` : m)); } }
function toBool(v: unknown, def: boolean, path: string, field: string, issues: SchemaIssue[], notes: Notes): boolean {
  if (v === undefined || v === null) return def;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toUpperCase();
  if (['Y', 'YES', 'TRUE', '1', 'T'].includes(s)) { notes.add(`Converted text/number flag "${v}" to true for "${field}"`); return true; }
  if (['N', 'NO', 'FALSE', '0', 'F', ''].includes(s)) { notes.add(`Converted text/number flag "${v}" to false for "${field}"`); return false; }
  issues.push({ severity: 'error', code: 'BOOLEAN_INVALID', path, message: `"${field}" must be true or false, but the file contains ${JSON.stringify(v)}.` });
  return def;
}
function toOptNumber(v: unknown, path: string, field: string, issues: SchemaIssue[], notes: Notes): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) { notes.add(`Converted numeric text to a number for "${field}"`); return Number(v); }
  issues.push({ severity: 'error', code: 'NUMBER_INVALID', path, message: `"${field}" must be a number, but the file contains ${JSON.stringify(v)}.` });
  return undefined;
}
function toText(v: unknown): string { return v === undefined || v === null ? '' : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : ''; }
function normalizeDecode(v: unknown, path: string, issues: SchemaIssue[], notes: Notes): DecodeEntry[] | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  let list: unknown[];
  if (Array.isArray(v)) list = v;
  else if (typeof v === 'string') { notes.add('Converted decode text ("RAW=Label; …") to a decode list'); list = v.split(/[\n;]+/).map((s) => s.trim()).filter(Boolean).map((line) => { const i = line.indexOf('='); return i < 0 ? { rawValue: line, label: line } : { rawValue: line.slice(0, i).trim(), label: line.slice(i + 1).trim() }; }); }
  else if (isObj(v)) { notes.add('Converted decode map {RAW: Label} to a decode list'); list = Object.entries(v).map(([k, l]) => ({ rawValue: k, label: l })); }
  else { issues.push({ severity: 'error', code: 'DECODE_INVALID', path, message: `"decode" must be a list of {rawValue, label} entries, but the file contains ${typeof v}.` }); return undefined; }
  return list.map((d, i) => {
    if (!isObj(d)) { issues.push({ severity: 'error', code: 'DECODE_INVALID', path: `${path}[${i}]`, message: `Decode entry #${i + 1} is not an object (found ${JSON.stringify(d)}).` }); return { rawValue: '', label: '' }; }
    const raw = pick(d, ['rawValue', 'raw', 'value', 'code', 'key']); const lab = pick(d, ['label', 'text', 'description', 'meaning', 'name']);
    if (raw && raw.key !== 'rawValue') notes.add(`Renamed decode property "${raw.key}" to "rawValue"`);
    if (lab && lab.key !== 'label') notes.add(`Renamed decode property "${lab.key}" to "label"`);
    if (raw && typeof raw.value === 'number') notes.add('Converted numeric decode raw value to text');
    return { rawValue: toText(raw?.value).trim(), label: toText(lab?.value).trim() };
  });
}
function normalizeReferences(c: Record<string, unknown>, notes: Notes): { table: string; column: string } | undefined {
  const r = c.references;
  if (isObj(r)) { const t = pick(r, ['table', 'tableName', 'refTable']); const col = pick(r, ['column', 'columnName', 'refColumn']); if (t?.key !== 'table' || col?.key !== 'column') { if (t || col) notes.add('Renamed reference properties to {table, column}'); } return { table: toText(t?.value).trim(), column: toText(col?.value).trim() }; }
  if (typeof r === 'string' && r.trim()) { const i = r.lastIndexOf('.'); notes.add('Converted reference text "TABLE.COLUMN" to {table, column}'); return i > 0 ? { table: r.slice(0, i).trim(), column: r.slice(i + 1).trim() } : { table: r.trim(), column: '' }; }
  const ft = pick(c, ['fkTable', 'referencesTable', 'refTable']); const fc = pick(c, ['fkColumn', 'referencesColumn', 'refColumn']);
  if (ft || fc) { notes.add('Converted fkTable/fkColumn properties to "references"'); return { table: toText(ft?.value).trim(), column: toText(fc?.value).trim() }; }
  return undefined;
}
const KNOWN_COLUMN_KEYS = new Set(['name', 'label', 'type', 'length', 'precision', 'nullable', 'alias', 'isPrimaryKey', 'isForeignKey', 'references', 'decode', 'description']);
function normalizeColumn(raw: unknown, path: string, issues: SchemaIssue[], notes: Notes): ColumnDef | null {
  if (!isObj(raw)) { issues.push({ severity: 'error', code: 'COLUMN_NOT_OBJECT', path, message: `This column entry is not an object (found ${raw === null ? 'null' : typeof raw}).` }); return null; }
  const name = pick(raw, ['name', 'columnName', 'column_name', 'COLUMN_NAME']); const type = pick(raw, ['type', 'dataType', 'data_type', 'datatype', 'DATA_TYPE']);
  if (name && name.key !== 'name') notes.add(`Renamed column property "${name.key}" to "name"`);
  if (type && type.key !== 'type') notes.add(`Renamed column property "${type.key}" to "type" (pre-V16 format)`);
  const nameStr = toText(name?.value); const nameTrim = nameStr.trim(); if (nameStr !== nameTrim) notes.add('Removed leading/trailing spaces from a column name');
  const typeStr = toText(type?.value).trim();
  const desc = pick(raw, ['description', 'columnDescription', 'comment']); if (desc && desc.key !== 'description') notes.add(`Renamed column property "${desc.key}" to "description"`);
  const label = toText(raw.label).trim(); if (!label && nameTrim) notes.add('Added a missing column label (copied from the column name)');
  const nullable = pick(raw, ['nullable', 'isNullable', 'NULLABLE']);
  const isPk = pick(raw, ['isPrimaryKey', 'primaryKey', 'pk', 'PK']); const isFk = pick(raw, ['isForeignKey', 'foreignKey', 'fk', 'FK']);
  const refs = normalizeReferences(raw, notes);
  const col: ColumnDef = {
    ...Object.fromEntries(Object.entries(raw).filter(([k]) => KNOWN_COLUMN_KEYS.has(k))),
    name: nameTrim, label: label || nameTrim, type: typeStr, description: toText(desc?.value),
    nullable: toBool(nullable?.value, true, `${path}.nullable`, 'nullable', issues, notes)
  } as ColumnDef;
  if (!nullable) notes.add('Set a missing "nullable" flag to true');
  // Key flags are only written when present in the source, so normalisation never changes current-format data.
  if (isPk) col.isPrimaryKey = toBool(isPk.value, false, `${path}.isPrimaryKey`, 'isPrimaryKey', issues, notes); else delete col.isPrimaryKey;
  if (isFk) col.isForeignKey = toBool(isFk.value, false, `${path}.isForeignKey`, 'isForeignKey', issues, notes); else delete col.isForeignKey;
  if (refs) col.references = refs; else delete col.references;
  const len = toOptNumber(raw.length, `${path}.length`, 'length', issues, notes); if (len === undefined) delete col.length; else col.length = len;
  const prec = toOptNumber(raw.precision, `${path}.precision`, 'precision', issues, notes); if (prec === undefined) delete col.precision; else col.precision = prec;
  const alias = toText(raw.alias).trim(); if (alias) col.alias = alias; else delete col.alias;
  const dec = normalizeDecode(raw.decode, `${path}.decode`, issues, notes); if (dec && dec.length) col.decode = dec; else delete col.decode;
  if (raw.description === null) notes.add('Replaced a null column description with an empty text');
  return col;
}
function normalizeTable(raw: unknown, path: string, issues: SchemaIssue[], notes: Notes): TableDef | null {
  if (!isObj(raw)) { issues.push({ severity: 'error', code: 'TABLE_NOT_OBJECT', path, message: `This table entry is not an object (found ${raw === null ? 'null' : typeof raw}).` }); return null; }
  const name = pick(raw, ['name', 'tableName', 'table_name', 'TABLE_NAME']); if (name && name.key !== 'name') notes.add(`Renamed table property "${name.key}" to "name"`);
  const nameStr = toText(name?.value); const nameTrim = nameStr.trim(); if (nameStr !== nameTrim) notes.add('Removed leading/trailing spaces from a table name');
  const moduleStr = toText(raw.module).trim(); if (!moduleStr) notes.add('Set a missing table module to "General"');
  let objectType: TableDef['objectType'];
  if (raw.objectType !== undefined && raw.objectType !== null && raw.objectType !== '') {
    const ot = String(raw.objectType).trim().toUpperCase();
    if (ot === 'TABLE' || ot === 'VIEW') { objectType = ot; if (raw.objectType !== ot) notes.add('Normalised objectType to upper case'); }
    else issues.push({ severity: 'error', code: 'OBJECT_TYPE_INVALID', path: `${path}.objectType`, message: `Table "${nameTrim}" has objectType ${JSON.stringify(raw.objectType)}; only "TABLE" or "VIEW" is supported.` });
  }
  let colsRaw: unknown[] = [];
  if (Array.isArray(raw.columns)) colsRaw = raw.columns;
  else if (isObj(raw.columns)) { notes.add('Converted a column map {NAME: {...}} to a column list'); colsRaw = Object.entries(raw.columns).map(([k, v]) => (isObj(v) && !('name' in v) ? { name: k, ...v } : v)); }
  else if (raw.columns === undefined || raw.columns === null) notes.add('Added a missing (empty) column list to a table');
  else issues.push({ severity: 'error', code: 'COLUMNS_INVALID', path: `${path}.columns`, message: `Table "${nameTrim}" has "columns" of type ${typeof raw.columns}; it must be a list.` });
  const columns = colsRaw.map((c, i) => normalizeColumn(c, `${path}.columns[${i}]`, issues, notes)).filter((c): c is ColumnDef => !!c);
  const t: TableDef = { name: nameTrim, module: moduleStr || 'General', description: toText(raw.description), columns };
  if (objectType) t.objectType = objectType;
  return t;
}
function normalizeRelationship(raw: unknown, path: string, index: number, issues: SchemaIssue[], notes: Notes): RelationshipDef | null {
  if (!isObj(raw)) { issues.push({ severity: 'error', code: 'RELATIONSHIP_INCOMPLETE', path, message: `Relationship #${index + 1} is not an object.` }); return null; }
  let ft = toText(raw.fromTable).trim(), fc = toText(raw.fromColumn).trim(), tt = toText(raw.toTable).trim(), tc = toText(raw.toColumn).trim();
  if ((!ft || !fc) && typeof raw.from === 'string' && raw.from.includes('.')) { const i = raw.from.lastIndexOf('.'); ft = raw.from.slice(0, i).trim(); fc = raw.from.slice(i + 1).trim(); notes.add('Converted relationship "from"/"to" text to fromTable/fromColumn/toTable/toColumn'); }
  if ((!tt || !tc) && typeof raw.to === 'string' && raw.to.includes('.')) { const i = raw.to.lastIndexOf('.'); tt = raw.to.slice(0, i).trim(); tc = raw.to.slice(i + 1).trim(); }
  let id = toText(raw.id).trim(); if (!id) { id = `rel-${index + 1}-${ft}.${fc}-${tt}.${tc}`; notes.add('Generated a missing relationship id'); }
  const kinds = ['one-to-many', 'many-to-one', 'one-to-one'];
  let kind = toText(raw.kind).trim().toLowerCase(); if (!kinds.includes(kind)) { if (kind) notes.add(`Relationship kind "${raw.kind}" is not recognised; treated as many-to-one`); else notes.add('Set a missing relationship kind to many-to-one'); kind = 'many-to-one'; }
  return { id, fromTable: ft, fromColumn: fc, toTable: tt, toColumn: tc, kind: kind as RelationshipDef['kind'] };
}
function slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'schema'; }
const KNOWN_SCHEMA_KEYS = new Set(['id', 'name', 'version', 'status', 'updatedAt', 'lastSyncedAt', 'tables', 'relationships', 'versionMeta', 'originalFileName']);
export interface NormalizedSchema { schema: SchemaModel | null; issues: SchemaIssue[]; notes: string[]; }
export function normalizeSchema(raw: unknown, index = 0, pathPrefix = ''): NormalizedSchema {
  const issues: SchemaIssue[] = []; const notes = new Notes(); const p = pathPrefix;
  if (!isObj(raw)) return { schema: null, notes: [], issues: [{ severity: 'error', code: 'NOT_OBJECT', path: p || '$', message: `The schema entry is not an object (found ${raw === null ? 'null' : Array.isArray(raw) ? 'a list' : typeof raw}).` }] };
  let name = toText(raw.name).trim();
  let id = toText(raw.id).trim();
  if (!id) { id = `schema-${slug(name || `imported-${index + 1}`)}`; notes.add(`Generated a missing schema id ("${id}")`); }
  if (!name) { name = id; issues.push({ severity: 'warning', code: 'SCHEMA_NAME_MISSING', path: `${p}.name`, message: `The schema has no name; "${id}" is used as its name.` }); }
  let status = toText(raw.status).trim().toLowerCase() as SchemaStatus; if (!['active', 'default', 'inactive'].includes(status)) { if (raw.status !== undefined) notes.add(`Schema status "${raw.status}" is not recognised; treated as inactive`); status = 'inactive'; }
  let updatedAt = toText(raw.updatedAt); if (!updatedAt || Number.isNaN(Date.parse(updatedAt))) { if (raw.updatedAt !== undefined) notes.add('Replaced an invalid "updatedAt" timestamp'); updatedAt = '1970-01-01T00:00:00.000Z'; }
  let tablesRaw: unknown[] = [];
  const tablesVal = raw.tables;
  if (Array.isArray(tablesVal)) tablesRaw = tablesVal;
  else if (isObj(tablesVal)) { notes.add('Converted a table map {NAME: {...}} to a table list'); tablesRaw = Object.entries(tablesVal).map(([k, v]) => (isObj(v) && !('name' in v) ? { name: k, ...v } : v)); }
  else issues.push({ severity: 'error', code: 'TABLES_MISSING', path: `${p}.tables`, message: tablesVal === undefined ? 'The schema has no "tables" list.' : `The schema's "tables" must be a list, but the file contains ${tablesVal === null ? 'null' : typeof tablesVal}.` });
  const tables = tablesRaw.map((t, i) => normalizeTable(t, `${p}.tables[${i}]`, issues, notes)).filter((t): t is TableDef => !!t);
  let relationships: RelationshipDef[] = [];
  if (Array.isArray(raw.relationships)) relationships = raw.relationships.map((r, i) => normalizeRelationship(r, `${p}.relationships[${i}]`, i, issues, notes)).filter((r): r is RelationshipDef => !!r);
  else if (raw.relationships === undefined || raw.relationships === null) { if (raw.relationships === null || tablesRaw.length) notes.add('Added a missing (empty) relationship list'); }
  else issues.push({ severity: 'error', code: 'RELATIONSHIPS_INVALID', path: `${p}.relationships`, message: `"relationships" must be a list, but the file contains ${typeof raw.relationships}.` });
  const schema: SchemaModel = {
    ...(Object.fromEntries(Object.entries(raw).filter(([k]) => !KNOWN_SCHEMA_KEYS.has(k))) as object),
    id, name, version: toText(raw.version).trim() || '1.0', status, updatedAt,
    lastSyncedAt: typeof raw.lastSyncedAt === 'string' && raw.lastSyncedAt ? raw.lastSyncedAt : null,
    tables, relationships
  } as SchemaModel;
  if (isObj(raw.versionMeta) && typeof raw.versionMeta.version === 'string') schema.versionMeta = raw.versionMeta as unknown as SchemaModel['versionMeta'];
  if (typeof raw.originalFileName === 'string' && raw.originalFileName) schema.originalFileName = raw.originalFileName;
  return { schema, issues, notes: notes.list() };
}

// ---------------------------------------------------------------- validation (single rule set)
const BAD_CHARS = /[\u0000-\u001f\u007f\u200b-\u200d\u2060\ufeff]/;
const PLAIN_IDENT = /^[A-Za-z_][A-Za-z0-9_$#]*(\.[A-Za-z_][A-Za-z0-9_$#]*)?$/;
const U = (s: string | undefined) => String(s ?? '').trim().toUpperCase();
function loc(ti: number, t: string, ci?: number, c?: string): string { return `tables[${ti}] (${t || '?'})${ci !== undefined ? `.columns[${ci}] (${c || '?'})` : ''}`; }
export function validateSchemaModel(schema: Pick<SchemaModel, 'tables' | 'relationships'>, pathPrefix = ''): { valid: boolean; errors: SchemaIssue[]; warnings: SchemaIssue[] } {
  const issues: SchemaIssue[] = []; const P = (s: string) => (pathPrefix ? `${pathPrefix}.${s}` : s);
  const tables = Array.isArray(schema.tables) ? schema.tables : [];
  const byName = new Map<string, TableDef>(); const seenTables = new Map<string, number>();
  tables.forEach((t, ti) => {
    const tn = String(t?.name ?? '').trim();
    if (!tn) { issues.push({ severity: 'error', code: 'TABLE_NAME_MISSING', path: P(loc(ti, tn)), message: `Table #${ti + 1} has no name.` }); return; }
    if (BAD_CHARS.test(tn)) issues.push({ severity: 'error', code: 'TABLE_NAME_CHARS', path: P(`${loc(ti, tn)}.name`), message: `Table name "${tn.replace(BAD_CHARS, '·')}" contains a control or invisible character (${describeChar(tn.match(BAD_CHARS)![0])}).` });
    else if (!PLAIN_IDENT.test(tn)) issues.push({ severity: 'warning', code: 'TABLE_NAME_UNUSUAL', path: P(`${loc(ti, tn)}.name`), message: `Table name "${tn}" is not a plain SQL identifier; it will be used verbatim in generated SQL.` });
    if (seenTables.has(U(tn))) issues.push({ severity: 'error', code: 'DUPLICATE_TABLE', path: P(loc(ti, tn)), message: `Table "${tn}" is defined more than once (also at tables[${seenTables.get(U(tn))}]). Table names must be unique.` });
    else { seenTables.set(U(tn), ti); byName.set(U(tn), t); }
  });
  tables.forEach((t, ti) => {
    const tn = String(t?.name ?? '').trim(); if (!tn) return;
    const cols = Array.isArray(t.columns) ? t.columns : [];
    if (!cols.length) issues.push({ severity: 'warning', code: 'NO_COLUMNS', path: P(loc(ti, tn)), message: `Table "${tn}" has no columns defined.` });
    const seen = new Map<string, number>(); let pk = 0;
    cols.forEach((c, ci) => {
      const cn = String(c?.name ?? '').trim(); const L = P(loc(ti, tn, ci, cn));
      if (!cn) { issues.push({ severity: 'error', code: 'COLUMN_NAME_MISSING', path: L, message: `Table "${tn}" has a column (#${ci + 1}) with no name.` }); return; }
      if (BAD_CHARS.test(cn)) issues.push({ severity: 'error', code: 'COLUMN_NAME_CHARS', path: `${L}.name`, message: `Column "${tn}.${cn.replace(BAD_CHARS, '·')}" contains a control or invisible character (${describeChar(cn.match(BAD_CHARS)![0])}).` });
      else if (!PLAIN_IDENT.test(cn)) issues.push({ severity: 'warning', code: 'COLUMN_NAME_UNUSUAL', path: `${L}.name`, message: `Column name "${tn}.${cn}" is not a plain SQL identifier; it will be used verbatim in generated SQL.` });
      if (seen.has(U(cn))) issues.push({ severity: 'error', code: 'DUPLICATE_COLUMN', path: L, message: `Duplicate column "${tn}.${cn}" (also at columns[${seen.get(U(cn))}]) — each table/column combination must be unique.`, repairable: JSON.stringify(cols[seen.get(U(cn))!]) === JSON.stringify(c) });
      else seen.set(U(cn), ci);
      const type = String(c?.type ?? '').trim();
      if (!type) issues.push({ severity: 'error', code: 'TYPE_MISSING', path: `${L}.type`, message: `Column "${tn}.${cn}" is missing a Data Type.` });
      else if (BAD_CHARS.test(type) || type.length > 80) issues.push({ severity: 'error', code: 'TYPE_INVALID', path: `${L}.type`, message: `Column "${tn}.${cn}" has an invalid Data Type ${JSON.stringify(type.slice(0, 40))}.` });
      (['length', 'precision'] as const).forEach((f) => { const v = (c as ColumnDef)[f]; if (v !== undefined && v !== null) { if (typeof v !== 'number' || !Number.isFinite(v)) issues.push({ severity: 'error', code: 'NUMBER_INVALID', path: `${L}.${f}`, message: `Column "${tn}.${cn}" has a non-numeric ${f} ${JSON.stringify(v)}.` }); else if (v < 0) issues.push({ severity: 'error', code: 'NEGATIVE_NUMBER', path: `${L}.${f}`, message: `Column "${tn}.${cn}" has a negative ${f === 'length' ? 'Length' : 'Precision'}.` }); } });
      if (c.isPrimaryKey) pk += 1;
      if (c.isForeignKey) {
        const rt = String(c.references?.table ?? '').trim(); const rc = String(c.references?.column ?? '').trim();
        if (!rt || !rc) issues.push({ severity: 'error', code: 'FK_REFERENCE_MISSING', path: `${L}.references`, message: `Column "${tn}.${cn}" is marked as a Foreign Key but has no reference table/column.`, repairable: true });
        else if (!byName.has(U(rt))) issues.push({ severity: 'error', code: 'FK_TABLE_NOT_FOUND', path: `${L}.references`, message: `Column "${tn}.${cn}" is a foreign key to "${rt}.${rc}", but table "${rt}" does not exist in this schema (it was probably deleted or renamed).`, repairable: true });
        else if (!byName.get(U(rt))!.columns?.some((x) => U(x?.name) === U(rc))) issues.push({ severity: 'error', code: 'FK_COLUMN_NOT_FOUND', path: `${L}.references`, message: `Column "${tn}.${cn}" is a foreign key to "${rt}.${rc}", but column "${rc}" does not exist in table "${rt}" (it was probably deleted or renamed).`, repairable: true });
      }
      if (Array.isArray(c.decode)) {
        const raws = new Map<string, string>();
        c.decode.forEach((d, di) => {
          const rv = String(d?.rawValue ?? '').trim(); const lb = String(d?.label ?? '').trim();
          if (!rv) issues.push({ severity: 'error', code: 'DECODE_EMPTY_RAW', path: `${L}.decode[${di}]`, message: `Column "${tn}.${cn}" has a decode entry (#${di + 1}) with an empty raw value.` });
          else if (raws.has(rv)) issues.push({ severity: 'error', code: 'DECODE_DUPLICATE_RAW', path: `${L}.decode[${di}]`, message: `Column "${tn}.${cn}" has duplicate decode raw value "${rv}".`, repairable: raws.get(rv) === lb });
          else raws.set(rv, lb);
          if (rv && !lb) issues.push({ severity: 'warning', code: 'DECODE_EMPTY_LABEL', path: `${L}.decode[${di}]`, message: `Column "${tn}.${cn}" decode value "${rv}" has no label.` });
        });
      }
    });
    if (pk > 1) issues.push({ severity: 'warning', code: 'PK_COMPOSITE', path: P(loc(ti, tn)), message: `Table "${tn}" has ${pk} primary-key columns (composite key) — confirm this is intentional.` });
    if (pk === 0 && cols.length > 0 && t.objectType !== 'VIEW') issues.push({ severity: 'warning', code: 'PK_MISSING', path: P(loc(ti, tn)), message: `Table "${tn}" has no primary key defined.` });
  });
  const rels = Array.isArray(schema.relationships) ? schema.relationships : [];
  const relIds = new Map<string, number>();
  const has = (t: string, c: string) => byName.get(U(t))?.columns?.some((x) => U(x?.name) === U(c));
  rels.forEach((r, ri) => {
    const L = P(`relationships[${ri}]`); const label = `${r.fromTable}.${r.fromColumn} → ${r.toTable}.${r.toColumn}`;
    if (!r.fromTable || !r.fromColumn || !r.toTable || !r.toColumn) { issues.push({ severity: 'error', code: 'RELATIONSHIP_INCOMPLETE', path: L, message: `Relationship #${ri + 1} (${label}) is missing a table or column.`, repairable: true }); return; }
    if (relIds.has(r.id)) issues.push({ severity: 'warning', code: 'RELATIONSHIP_DUPLICATE_ID', path: L, message: `Relationship id "${r.id}" is used more than once.` }); else relIds.set(r.id, ri);
    if (!has(r.fromTable, r.fromColumn) || !has(r.toTable, r.toColumn)) issues.push({ severity: 'warning', code: 'RELATIONSHIP_DANGLING', path: L, message: `Relationship ${label} points to a ${!has(r.fromTable, r.fromColumn) ? `missing column ${r.fromTable}.${r.fromColumn}` : `missing column ${r.toTable}.${r.toColumn}`}; it is ignored for JOINs until it is removed or the column is restored.`, repairable: true });
  });
  const errors = issues.filter((i) => i.severity === 'error'); const warnings = issues.filter((i) => i.severity === 'warning');
  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------- content identity (V17.2, 3-way merge)
function fnv(str: string): string { let h1 = 0x811c9dc5, h2 = 0x01000193; for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0; h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0; } return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'); }
function canon(v: unknown): unknown { if (Array.isArray(v)) return v.map(canon); if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, canon(v[k])])); return v; }
/** Hash of the schema CONTENT only (tables + relationships, key-order independent). Metadata and timestamps are ignored. */
export function contentHash(schema: Pick<SchemaModel, 'tables' | 'relationships'>): string { return fnv(JSON.stringify(canon({ t: schema.tables, r: schema.relationships }))); }

// ---------------------------------------------------------------- registry
export function checkRegistry(input: { text?: string; value?: unknown }): RegistryReport {
  const report: RegistryReport = { fileProblem: null, detectedFormat: 'unknown', formatVersion: null, writtenBy: null, writtenByDevice: null, schemas: [], registryNotes: [], activeSchemaId: null, activeSchemaUpdatedAt: null, validSchemas: [], invalidSchemas: [] };
  let value = input.value;
  if (input.text !== undefined) { const p = parseRegistryText(input.text); report.registryNotes.push(...p.notes); if (p.problem) { report.fileProblem = p.problem; return report; } value = p.value; }
  let rawSchemas: unknown[] | null = null;
  if (Array.isArray(value)) { rawSchemas = value; report.detectedFormat = 'bare schema list (pre-V15)'; report.registryNotes.push('The file is a bare list of schemas (pre-V15 format); it was read as a registry.'); }
  else if (isObj(value)) {
    const fv = value.formatVersion;
    if (fv !== undefined) { report.formatVersion = typeof fv === 'number' ? fv : Number(fv); if (!Number.isFinite(report.formatVersion) || report.formatVersion! > REGISTRY_FORMAT_VERSION) { report.fileProblem = { code: 'UNSUPPORTED_VERSION', message: `The schema file was written by a newer ${APP_NAME} (format ${JSON.stringify(fv)}${typeof value.writtenBy === 'string' ? `, ${value.writtenBy}` : ''}); this version understands format ${REGISTRY_FORMAT_VERSION}. Update this device to the latest version before synchronizing.` }; return report; } }
    report.writtenBy = typeof value.writtenBy === 'string' ? value.writtenBy : null;
    report.writtenByDevice = typeof value.writtenByDevice === 'string' ? value.writtenByDevice : null;
    if (Array.isArray(value.schemas)) { rawSchemas = value.schemas; report.detectedFormat = report.formatVersion ? `registry format ${report.formatVersion}` : 'registry (V15–V17.0)'; }
    else if (isObj(value.schemas)) { rawSchemas = Object.values(value.schemas); report.detectedFormat = 'registry with schema map'; report.registryNotes.push('"schemas" was a map keyed by id; it was read as a list.'); }
    else if (isObj(value.registry) && Array.isArray(value.registry.schemas)) { rawSchemas = value.registry.schemas; value = value.registry; report.detectedFormat = 'wrapped registry'; report.registryNotes.push('The registry was wrapped in a "registry" property; it was unwrapped.'); }
    else if ('tables' in value) { rawSchemas = [value]; report.detectedFormat = 'single schema file'; report.registryNotes.push('The file contains a single schema (exported or pre-V15 format); it was read as a registry with one schema.'); }
    if (rawSchemas && isObj(value)) {
      if (typeof value.activeSchemaId === 'string') report.activeSchemaId = value.activeSchemaId;
      if (typeof value.activeSchemaUpdatedAt === 'string' && !Number.isNaN(Date.parse(value.activeSchemaUpdatedAt))) report.activeSchemaUpdatedAt = value.activeSchemaUpdatedAt;
    }
  }
  if (!rawSchemas) { report.fileProblem = { code: 'NOT_A_REGISTRY', message: `The file is valid JSON but is not a schema registry: expected an object with a "schemas" list (found ${Array.isArray(value) ? 'a list' : isObj(value) ? `an object with keys ${Object.keys(value).slice(0, 8).map((k) => `"${k}"`).join(', ') || '(none)'}` : typeof value}).` }; return report; }
  const ids = new Map<string, number>();
  rawSchemas.forEach((raw, i) => {
    const base = `schemas[${i}]`;
    const n = normalizeSchema(raw, i, base);
    const v = n.schema ? validateSchemaModel(n.schema, base) : { valid: false, errors: [], warnings: [] };
    const errors = [...n.issues.filter((x) => x.severity === 'error'), ...v.errors];
    const warnings = [...n.issues.filter((x) => x.severity === 'warning'), ...v.warnings];
    if (n.schema) { if (ids.has(n.schema.id)) errors.push({ severity: 'error', code: 'DUPLICATE_SCHEMA_ID', path: base, message: `Schema id "${n.schema.id}" is used more than once in the file (also schemas[${ids.get(n.schema.id)}]); the second copy cannot be loaded.` }); else ids.set(n.schema.id, i); }
    const rep: SchemaReport = { index: i, id: n.schema?.id ?? `#${i + 1}`, name: n.schema?.name ?? `Schema #${i + 1}`, valid: !!n.schema && errors.length === 0, errors, warnings, notes: n.notes, schema: n.schema, allErrorsRepairable: errors.length > 0 && errors.every((e) => e.repairable) };
    report.schemas.push(rep);
    if (rep.valid && n.schema) report.validSchemas.push(n.schema); else report.invalidSchemas.push(rep);
  });
  if (report.activeSchemaId && !report.schemas.some((s) => s.id === report.activeSchemaId)) report.registryNotes.push(`The file's active schema "${report.activeSchemaId}" is not one of its schemas; the active selection was not changed.`);
  return report;
}
/** Version number written in a registry's writtenBy (e.g. "SQL Assistant 17.2.0" → [17,2,0]); null for files from V17.0 or older. */
export function writerVersion(writtenBy: string | null): number[] | null { const m = String(writtenBy || '').match(/(\d+)\.(\d+)\.(\d+)/); return m ? [+m[1], +m[2], +m[3]] : null; }
export function compareVersions(a: number[], b: number[]): number { for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); return 0; }
export function serializeRegistry(registry: SchemaRegistry, deviceTag?: string): string {
  const out: SchemaRegistry = { formatVersion: REGISTRY_FORMAT_VERSION, writtenBy: `${APP_NAME} ${APP_VERSION}`, ...(deviceTag ? { writtenByDevice: deviceTag } : {}), activeSchemaId: registry.activeSchemaId, activeSchemaUpdatedAt: registry.activeSchemaUpdatedAt ?? null, schemas: registry.schemas };
  return JSON.stringify(out, null, 2);
}

// ---------------------------------------------------------------- explicit repair
export interface RepairResult { schema: SchemaModel; changes: string[]; remainingErrors: SchemaIssue[]; }
export function repairSchema(input: SchemaModel): RepairResult {
  const s: SchemaModel = JSON.parse(JSON.stringify(input)); const changes: string[] = [];
  const byName = new Map(s.tables.map((t) => [U(t.name), t] as const));
  s.tables.forEach((t) => {
    const kept: ColumnDef[] = [];
    t.columns.forEach((c) => { const dup = kept.find((k) => U(k.name) === U(c.name)); if (dup && JSON.stringify(dup) === JSON.stringify(c)) { changes.push(`Removed an exact duplicate copy of column ${t.name}.${c.name}.`); return; } kept.push(c); });
    t.columns = kept;
  });
  s.tables.forEach((t) => t.columns.forEach((c) => {
    if (c.isForeignKey) {
      const rt = c.references?.table ?? ''; const rc = c.references?.column ?? '';
      const target = byName.get(U(rt));
      if (!rt || !rc || !target || !target.columns.some((x) => U(x.name) === U(rc))) { c.isForeignKey = false; delete c.references; changes.push(`Unlinked foreign key ${t.name}.${c.name}${rt ? ` → ${rt}.${rc}` : ''} (target does not exist); the column itself was kept.`); }
    }
    if (Array.isArray(c.decode)) { const seen = new Map<string, string>(); const out: DecodeEntry[] = []; c.decode.forEach((d) => { const k = String(d.rawValue).trim(); if (seen.has(k) && seen.get(k) === d.label.trim()) { changes.push(`Removed a repeated decode entry "${d.rawValue}=${d.label}" from ${t.name}.${c.name}.`); return; } seen.set(k, d.label.trim()); out.push(d); }); c.decode = out; }
  }));
  const has = (tb: string, col: string) => byName.get(U(tb))?.columns.some((x) => U(x.name) === U(col));
  s.relationships = s.relationships.filter((r) => { if (r.fromTable && r.fromColumn && r.toTable && r.toColumn && has(r.fromTable, r.fromColumn) && has(r.toTable, r.toColumn)) return true; changes.push(`Removed relationship ${r.fromTable}.${r.fromColumn} → ${r.toTable}.${r.toColumn} (it points to a column that does not exist).`); return false; });
  return { schema: s, changes, remainingErrors: validateSchemaModel(s).errors };
}

// ---------------------------------------------------------------- presentation helpers
export function describeIssue(i: SchemaIssue): string { return `${i.message} [${i.path}]`; }
export function describeIssueWithStage(i: SchemaIssue): string { return `${stageOf(i)}: ${describeIssue(i)}`; }
export function summarizeSchemaReport(r: SchemaReport, max = 5): string { const shown = r.errors.slice(0, max).map(describeIssue); return `"${r.name}": ${r.errors.length} error(s) — ${shown.join(' ')}${r.errors.length > max ? ` …and ${r.errors.length - max} more.` : ''}`; }
export function formatRegistryReport(r: RegistryReport): string[] {
  if (r.fileProblem) return [`${fileProblemStage(r.fileProblem.code)} (${r.fileProblem.code}): ${r.fileProblem.message}`];
  const out = [`Format detected: ${r.detectedFormat}${r.writtenBy ? ` — written by ${r.writtenBy}` : ' — written by V17.0 or older (no writer stamp)'}${r.writtenByDevice ? ` on ${r.writtenByDevice}` : ''}. ${r.schemas.length} schema(s): ${r.validSchemas.length} valid, ${r.invalidSchemas.length} invalid.`];
  r.registryNotes.forEach((n) => out.push(`Note: ${n}`));
  r.schemas.forEach((s) => { out.push(`${s.valid ? '✔' : '✖'} "${s.name}" (${s.id}) — ${s.errors.length} error(s), ${s.warnings.length} warning(s)${s.notes.length ? `, ${s.notes.length} legacy conversion(s)` : ''}`); s.errors.forEach((e) => out.push(`    ERROR ${describeIssueWithStage(e)}${e.repairable ? ' (repairable)' : ''}`)); s.warnings.slice(0, 10).forEach((w) => out.push(`    warning ${describeIssue(w)}`)); s.notes.forEach((n) => out.push(`    converted: ${n}`)); });
  return out;
}
