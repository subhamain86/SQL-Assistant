/**
 * Schema integrity API (V16.1+ signatures). Since V17.1 every function delegates to the single shared
 * rule set in v17/sync/schemaFormat.ts, so local import, Manual Schema Update, push and pull can never
 * disagree about what a valid schema is.
 */
import type { SchemaModel, TableDef, SchemaIntegrityResult, SchemaIntegrityIssue } from '../types';
import { safeTrim, safeUpperTrim } from '../utils/validation';
import { validateSchemaModel, normalizeSchema, checkRegistry, describeIssue } from '../v17/sync/schemaFormat';
const toIssues = (list: { severity: 'error' | 'warning'; message: string; path: string }[], withPath = false): SchemaIntegrityIssue[] => list.map((i) => ({ severity: i.severity, message: withPath ? describeIssue(i as any) : i.message }));
export function validateSchemaIntegrity(tables: TableDef[], relationships: SchemaModel['relationships'] = []): SchemaIntegrityResult {
  const r = validateSchemaModel({ tables, relationships });
  return { valid: r.valid, issues: [...toIssues(r.errors), ...toIssues(r.warnings)] };
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
  const n = normalizeSchema(candidate);
  if (!n.schema) return { valid: false, issues: toIssues(n.issues, true) };
  const v = validateSchemaModel(n.schema);
  const errors = [...n.issues.filter((i) => i.severity === 'error'), ...v.errors];
  return { valid: errors.length === 0, issues: [...toIssues(errors, true), ...toIssues([...n.issues.filter((i) => i.severity === 'warning'), ...v.warnings], true)] };
}
export function validateIncomingRegistryFile(candidate: unknown): SchemaIntegrityResult {
  const r = checkRegistry({ value: candidate });
  if (r.fileProblem) return { valid: false, issues: [{ severity: 'error', message: r.fileProblem.message }] };
  const issues: SchemaIntegrityIssue[] = [];
  r.schemas.forEach((s) => { s.errors.forEach((e) => issues.push({ severity: 'error', message: `Schema "${s.name}": ${describeIssue(e)}` })); s.warnings.forEach((w) => issues.push({ severity: 'warning', message: `Schema "${s.name}": ${describeIssue(w)}` })); });
  return { valid: r.invalidSchemas.length === 0, issues };
}
