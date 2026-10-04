import type { SchemaModel, TableDef, SchemaIntegrityResult, SchemaIntegrityIssue } from '../types';
import { safeTrim, safeUpperTrim } from '../utils/validation';
/** V16.1: a data type must be present (non-empty); real-world types such as VARCHAR2/INTEGER are valid. */
export function validateSchemaIntegrity(tables: TableDef[]): SchemaIntegrityResult {
  const issues: SchemaIntegrityIssue[] = []; const seen = new Set<string>();
  const tableNames = new Set(tables.map((t) => safeUpperTrim(t?.name)));
  tables.forEach((t) => {
    const tName = safeTrim(t?.name);
    if (!tName) { issues.push({ severity: 'error', message: 'A table is missing its Table Name.' }); return; }
    if (!Array.isArray(t.columns) || t.columns.length === 0) issues.push({ severity: 'warning', message: `Table "${tName}" has no columns defined.` });
    let pk = 0;
    (t.columns || []).forEach((c) => {
      const cName = safeTrim(c?.name);
      if (!cName) { issues.push({ severity: 'error', message: `Table "${tName}" has a column with a missing Column Name.` }); return; }
      const key = `${safeUpperTrim(tName)}::${safeUpperTrim(cName)}`;
      if (seen.has(key)) issues.push({ severity: 'error', message: `Duplicate column "${tName}.${cName}" — each table/column combination must be unique.` });
      seen.add(key);
      if (!safeTrim(c?.type)) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" is missing a Data Type.` });
      if (c.isPrimaryKey) pk += 1;
      if (c.isForeignKey) {
        const rt = safeTrim(c.references?.table); const rc = safeTrim(c.references?.column);
        if (!rt || !rc) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" is marked as a Foreign Key but has no reference table/column.` });
        else if (!tableNames.has(safeUpperTrim(rt))) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" references table "${rt}", which does not exist in this schema.` });
        else { const o = tables.find((x) => safeUpperTrim(x?.name) === safeUpperTrim(rt)); if (!o?.columns?.some((x) => safeUpperTrim(x?.name) === safeUpperTrim(rc))) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" references "${rt}.${rc}", which does not exist.` }); }
      }
      if (c.decode) { const s = new Set<string>(); c.decode.forEach((d) => { const rv = safeTrim(d?.rawValue); if (!rv) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" has a decode entry with an empty raw value.` }); const k = safeUpperTrim(d?.rawValue); if (k && s.has(k)) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" has duplicate decode raw value "${rv}".` }); s.add(k); }); }
      if (c.length !== undefined && c.length !== null && c.length < 0) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" has a negative Length.` });
      if (c.precision !== undefined && c.precision !== null && c.precision < 0) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" has a negative Precision.` });
    });
    if (pk > 1) issues.push({ severity: 'warning', message: `Table "${tName}" has ${pk} primary-key columns (composite key) — confirm this is intentional.` });
    if (pk === 0 && (t.columns || []).length > 0 && t.objectType !== 'VIEW') issues.push({ severity: 'warning', message: `Table "${tName}" has no primary key defined.` });
  });
  return { valid: issues.filter((i) => i.severity === 'error').length === 0, issues };
}
export function validateSingleRowAgainstSchema(schema: SchemaModel, tableName: unknown, columnName: unknown, originalTableName: unknown, originalColumnName: unknown): SchemaIntegrityIssue[] {
  const issues: SchemaIntegrityIssue[] = []; const t = safeTrim(tableName); const c = safeTrim(columnName);
  if (!t) issues.push({ severity: 'error', message: 'Table Name is required.' }); if (!c) issues.push({ severity: 'error', message: 'Column Name is required.' });
  if (!t || !c) return issues;
  if (safeUpperTrim(originalTableName) === safeUpperTrim(t) && safeUpperTrim(originalColumnName) === safeUpperTrim(c)) return issues;
  const table = schema.tables.find((x) => safeUpperTrim(x?.name) === safeUpperTrim(t));
  if (table?.columns?.some((x) => safeUpperTrim(x?.name) === safeUpperTrim(c))) issues.push({ severity: 'error', message: `Column "${t}.${c}" already exists in this schema.` });
  return issues;
}
export function validateIncomingSchemaFile(candidate: unknown): SchemaIntegrityResult {
  const issues: SchemaIntegrityIssue[] = [];
  if (typeof candidate !== 'object' || candidate === null) return { valid: false, issues: [{ severity: 'error', message: 'File is not a valid JSON object.' }] };
  const obj = candidate as Record<string, unknown>;
  if (!Array.isArray(obj.tables)) return { valid: false, issues: [{ severity: 'error', message: 'Missing required "tables" array.' }] };
  if (!safeTrim(obj.name)) issues.push({ severity: 'warning', message: 'Schema has no name — a default will be used.' });
  issues.push(...validateSchemaIntegrity(obj.tables as TableDef[]).issues);
  return { valid: issues.filter((i) => i.severity === 'error').length === 0, issues };
}
export function validateIncomingRegistryFile(candidate: unknown): SchemaIntegrityResult {
  const issues: SchemaIntegrityIssue[] = [];
  if (typeof candidate !== 'object' || candidate === null) return { valid: false, issues: [{ severity: 'error', message: 'File is not a valid JSON object.' }] };
  const obj = candidate as Record<string, unknown>;
  if (!Array.isArray(obj.schemas)) return { valid: false, issues: [{ severity: 'error', message: 'Missing required "schemas" array.' }] };
  (obj.schemas as unknown[]).forEach((s, idx) => validateIncomingSchemaFile(s).issues.forEach((i) => issues.push({ severity: i.severity, message: `Schema #${idx + 1}: ${i.message}` })));
  return { valid: issues.filter((i) => i.severity === 'error').length === 0, issues };
}
