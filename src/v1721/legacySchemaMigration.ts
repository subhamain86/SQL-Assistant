/**
 * SQL Assistant V17.2.1 — legacy schema detection, normalization and migration.
 *
 * ROOT CAUSE (AP schema 77): the source file stores decode entries as { "code": "...", "label": "..." }.
 * SQL Assistant's model is { rawValue, label }. A V17.0 device imported/published the schema without
 * mapping `code` → `rawValue`, so every decode entry (437 in AP schema 77) reached the repository with
 * an empty raw value. The value was never "empty" — it sits under the legacy key. V17.1+ correctly
 * rejects { rawValue: "" }, which is why the schema failed permanently.
 *
 * Pipeline: Detect format → Normalize legacy structure → Repair known legacy representations →
 *           Validate complete schema (unchanged rules) → stamp writer metadata.
 * Anything not covered by an explicit rule is NOT guessed: the migration fails with the exact location.
 *
 * Migration rules (ids are recorded in schemaFormat.migrationRules):
 *  R1  decode raw value from legacy alias key (code | raw | value | raw_value | rawvalue | key) when rawValue is empty/missing.
 *      Aliases that disagree with each other → fail (ambiguous).
 *  R2  numeric/boolean decode raw values → string ("0" stays "0").
 *  R3  decode given as "RAW=Label" strings or as an object map { RAW: "Label" } → entries.
 *  R4  legacy decode label aliases (description | name | text | meaning) when label is missing.
 *  R5  `decode: null` / `alias: null` → property removed (means "no decode / no alias").
 *  R6  document format column keys: primary_key → isPrimaryKey, foreign_key{table,column} → isForeignKey+references,
 *      missing label → column name (deterministic, same as importer).
 *  R7  document format schema/table keys: schema_name → name, schema_version → version, notes → description,
 *      missing relationships → [].
 *  R8  string booleans "true"/"false"/"Y"/"N" for nullable/isPrimaryKey/isForeignKey → booleans.
 * NOT repaired (fails with location): decode entry whose raw value is empty and has no alias — the file
 * does not say whether NULL or '' was meant; entries that are not objects/strings; duplicate raw values.
 */
import { validateSchemaDeep, errorsOnly, type SchemaIssue } from './schemaValidator';
import { makeStamp, readStamp, SCHEMA_FORMAT_VERSION } from './schemaFormat';

export type DetectedFormat = 'current' | 'stamped-older' | 'legacy-unstamped' | 'legacy-document' | 'unknown';
export type MigrationStatus = 'current' | 'migrated' | 'rejected';

export interface MigrationChange { rule: string; path: string; detail: string; }
export interface SchemaMigrationResult {
  status: MigrationStatus;
  detectedFormat: DetectedFormat;
  schemaName: string;
  schema: any | null;              // migrated + stamped schema (null when rejected)
  changes: MigrationChange[];
  ruleCounts: Record<string, number>;
  errors: SchemaIssue[];
  warnings: SchemaIssue[];
}

const RAW_ALIASES = ['code', 'raw', 'value', 'raw_value', 'rawvalue', 'key'];
const LABEL_ALIASES = ['description', 'name', 'text', 'meaning'];
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const nonEmpty = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
const scalarToString = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'boolean' ? (v ? '1' : '0') : null);

export function detectFormat(schema: any): DetectedFormat {
  if (!schema || typeof schema !== 'object' || !Array.isArray(schema.tables)) return 'unknown';
  const st = readStamp(schema);
  const cols = schema.tables.flatMap((t: any) => (Array.isArray(t?.columns) ? t.columns : []));
  const docMarkers = 'schema_name' in schema || cols.some((c: any) => c && ('primary_key' in c || 'foreign_key' in c));
  if (docMarkers) return 'legacy-document';
  if (st.present) return st.formatVersion >= SCHEMA_FORMAT_VERSION ? 'current' : 'stamped-older';
  return 'legacy-unstamped';
}

function toBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') { const s = v.trim().toLowerCase(); if (['true', 'y', 'yes', '1'].includes(s)) return true; if (['false', 'n', 'no', '0'].includes(s)) return false; }
  if (v === 1) return true; if (v === 0) return false;
  return undefined;
}

export function migrateSchema(input: any, schemaPath = 'schema'): SchemaMigrationResult {
  const detectedFormat = detectFormat(input);
  const name = String(input?.name ?? input?.schema_name ?? '(unnamed schema)');
  const changes: MigrationChange[] = [];
  const fail: SchemaIssue[] = [];
  const rec = (rule: string, path: string, detail: string) => changes.push({ rule, path, detail });

  if (detectedFormat === 'unknown') {
    return { status: 'rejected', detectedFormat, schemaName: name, schema: null, changes, ruleCounts: {}, errors: [{ severity: 'error', path: schemaPath, location: '(schema)', property: 'tables', reason: 'Not a recognisable schema: "tables" array is missing.' }], warnings: [] };
  }
  const s = clone(input);

  // R7 schema level
  if (!nonEmpty(s.name) && nonEmpty(s.schema_name)) { s.name = s.schema_name; rec('R7', schemaPath, 'schema_name → name'); }
  if (s.version === undefined && s.schema_version !== undefined) { s.version = String(s.schema_version); rec('R7', schemaPath, 'schema_version → version'); }
  if (s.relationships === undefined) { s.relationships = []; rec('R7', schemaPath, 'relationships added (empty)'); }

  s.tables.forEach((t: any, ti: number) => {
    if (!t || typeof t !== 'object') return;
    const tp = `${schemaPath} › tables[${ti}]${nonEmpty(t.name) ? ` (${t.name})` : ''}`;
    if (t.description === undefined && typeof t.notes === 'string') { t.description = t.notes; rec('R7', tp, 'notes → description'); }
    if (!Array.isArray(t.columns)) return;
    t.columns.forEach((c: any, ci: number) => {
      if (!c || typeof c !== 'object') return;
      const cp = `${tp} › columns[${ci}]${nonEmpty(c.name) ? ` (${c.name})` : ''}`;
      const loc = `${t.name}.${c.name}`;
      // R6 document-format keys
      if ('primary_key' in c) { const b = toBool(c.primary_key); if (b !== undefined) { if (c.isPrimaryKey === undefined) c.isPrimaryKey = b; delete c.primary_key; rec('R6', cp, 'primary_key → isPrimaryKey'); } }
      if ('foreign_key' in c) {
        const fk = c.foreign_key;
        if (fk === null || fk === false) { delete c.foreign_key; rec('R6', cp, 'foreign_key: null removed'); }
        else if (fk && typeof fk === 'object' && nonEmpty(fk.table) && nonEmpty(fk.column)) {
          if (!c.references) { c.isForeignKey = true; c.references = { table: fk.table, column: fk.column }; }
          delete c.foreign_key; rec('R6', cp, `foreign_key → references ${fk.table}.${fk.column}`);
        } else fail.push({ severity: 'error', path: cp, location: loc, property: 'foreign_key', reason: 'Legacy foreign_key is neither null nor { table, column } — cannot be migrated safely.' });
      }
      if (!nonEmpty(c.label) && nonEmpty(c.name) && (detectedFormat === 'legacy-document' || c.label === undefined)) { c.label = c.name; rec('R6', cp, 'label ← column name'); }
      // R8
      for (const k of ['nullable', 'isPrimaryKey', 'isForeignKey']) if (c[k] !== undefined && typeof c[k] !== 'boolean') { const b = toBool(c[k]); if (b !== undefined) { c[k] = b; rec('R8', cp, `${k} → ${b}`); } }
      // R5
      if (c.alias === null) { delete c.alias; rec('R5', cp, 'alias: null removed'); }
      if (c.decode === null) { delete c.decode; rec('R5', cp, 'decode: null removed'); return; }
      if (c.decode === undefined) return;
      // R3 container forms
      if (!Array.isArray(c.decode)) {
        if (typeof c.decode === 'object') { c.decode = Object.entries(c.decode).map(([k, v]) => ({ rawValue: k, label: String(v) })); rec('R3', cp, 'decode map → entries'); }
        else { fail.push({ severity: 'error', path: cp, location: loc, property: 'decode', reason: '"decode" is neither an array nor a map — cannot be migrated safely.' }); return; }
      }
      c.decode = c.decode.map((d: any, di: number) => {
        const dp = `${cp} › decode[${di}]`;
        if (typeof d === 'string') {
          const m = d.match(/^\s*([^=]+?)\s*=\s*(.*)$/);
          if (m) { rec('R3', dp, `"${d}" → entry`); return { rawValue: m[1], label: m[2] }; }
          fail.push({ severity: 'error', path: dp, location: loc, property: `decode[${di}]`, reason: `Decode entry #${di + 1} "${d}" is not in RAW=Label form.` }); return d;
        }
        if (!d || typeof d !== 'object') { fail.push({ severity: 'error', path: dp, location: loc, property: `decode[${di}]`, reason: `Decode entry #${di + 1} is not an object.` }); return d; }
        const e: any = { ...d };
        // R2
        if (e.rawValue !== undefined && typeof e.rawValue !== 'string') { const sv = scalarToString(e.rawValue); if (sv !== null) { e.rawValue = sv; rec('R2', dp, `rawValue → "${sv}"`); } }
        // R1
        if (!nonEmpty(e.rawValue)) {
          const found = RAW_ALIASES.filter((k) => k in e).map((k) => ({ k, v: scalarToString(e[k]) })).filter((x) => x.v !== null && x.v.trim() !== '');
          const distinct = Array.from(new Set(found.map((x) => x.v)));
          if (distinct.length === 1) {
            e.rawValue = distinct[0]; found.forEach((x) => delete e[x.k]);
            rec('R1', dp, `rawValue ← ${found.map((x) => x.k).join('/')} "${distinct[0]}"`);
          } else if (distinct.length > 1) {
            fail.push({ severity: 'error', path: dp, location: loc, property: `decode[${di}].rawValue`, reason: `Decode entry #${di + 1} has conflicting legacy raw values (${found.map((x) => `${x.k}="${x.v}"`).join(', ')}).` });
          } else {
            fail.push({ severity: 'error', path: dp, location: loc, property: `decode[${di}].rawValue`, reason: `Decode entry #${di + 1} has an empty raw value and no legacy code to recover it from — the file does not say whether NULL or an empty string was intended.` });
          }
        } else {
          // rawValue present: a disagreeing alias is ambiguous, an identical one is redundant
          for (const k of RAW_ALIASES) if (k in e) { const v = scalarToString(e[k]); if (v !== null && v !== '' && v !== e.rawValue) fail.push({ severity: 'error', path: dp, location: loc, property: `decode[${di}].${k}`, reason: `Decode entry #${di + 1}: rawValue "${e.rawValue}" conflicts with legacy ${k} "${v}".` }); else { delete e[k]; rec('R1', dp, `redundant ${k} removed`); } }
        }
        // R4
        if (e.label === undefined) { const k = LABEL_ALIASES.find((x) => typeof e[x] === 'string'); if (k) { e.label = e[k]; delete e[k]; rec('R4', dp, `label ← ${k}`); } }
        return e;
      });
    });
  });

  // drop document-only bookkeeping that is not part of the model (kept in migratedFrom audit)
  if (detectedFormat === 'legacy-document') for (const k of ['schema_name', 'schema_version']) if (k in s) delete s[k];

  const issues = validateSchemaDeep(s, schemaPath);
  const failedPaths = new Set(fail.map((f) => f.path));
  const errors = [...fail, ...errorsOnly(issues).filter((i) => !failedPaths.has(i.path))];
  const warnings = issues.filter((i) => i.severity === 'warning');
  const ruleCounts = changes.reduce<Record<string, number>>((a, c) => ((a[c.rule] = (a[c.rule] || 0) + 1), a), {});
  if (errors.length) return { status: 'rejected', detectedFormat, schemaName: name, schema: null, changes, ruleCounts, errors, warnings };

  const dataChanged = changes.length > 0;
  const needsStamp = detectedFormat !== 'current';
  if (!dataChanged && !needsStamp) return { status: 'current', detectedFormat, schemaName: name, schema: s, changes, ruleCounts, errors, warnings };
  s.schemaFormat = makeStamp(dataChanged || detectedFormat !== 'stamped-older' ? { migratedFrom: detectedFormat, migrationRules: Object.keys(ruleCounts).sort() } : {});
  return { status: 'migrated', detectedFormat, schemaName: name, schema: s, changes, ruleCounts, errors, warnings };
}

/** True when `result.schema` differs from the input only by the writer stamp (no data change). */
export const isStampOnly = (r: SchemaMigrationResult) => r.status === 'migrated' && r.changes.length === 0;

export interface RegistryMigrationReport { total: number; current: number; migrated: number; rejected: number; results: (SchemaMigrationResult & { index: number })[]; }

/**
 * Processes every schema of an incoming repository registry file independently.
 * Successful schemas are replaced IN PLACE (so the existing loader keeps working with migrated data);
 * rejected schemas are left untouched so the existing validator rejects them and local copies stay protected.
 */
export function migrateRegistryFileInPlace(file: any): RegistryMigrationReport {
  const report: RegistryMigrationReport = { total: 0, current: 0, migrated: 0, rejected: 0, results: [] };
  if (!file || typeof file !== 'object' || !Array.isArray(file.schemas)) return report;
  file.schemas.forEach((sch: any, i: number) => {
    const r = migrateSchema(sch, `schemas[${i}]`);
    report.total += 1; report[r.status] += 1; report.results.push({ ...r, index: i });
    if (r.status === 'migrated' && r.schema) file.schemas[i] = r.schema;
  });
  return report;
}

/** Publish guard: returns schemas that are safe to publish (normalized, validated, stamped) or blocks. */
export function prepareForPublish(schemas: any[]): { ok: true; schemas: any[] } | { ok: false; blocked: SchemaMigrationResult[] } {
  const results = schemas.map((s, i) => migrateSchema(s, `schemas[${i}]`));
  const blocked = results.filter((r) => r.status === 'rejected');
  if (blocked.length) return { ok: false, blocked };
  return { ok: true, schemas: results.map((r) => { const out = r.schema; if (!out.schemaFormat || r.status === 'current') out.schemaFormat = { ...makeStamp(), ...(out.schemaFormat?.migratedFrom ? { migratedFrom: out.schemaFormat.migratedFrom, migrationRules: out.schemaFormat.migrationRules } : {}), generatedAt: new Date().toISOString() }; return out; }) };
}
