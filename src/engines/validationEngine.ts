import type { ReadOnlyQueryState, CrQueryState, ValidationResult, ValidationIssue } from '../types';
import { validateAdvancedConsistency } from '../v17/engines/advancedOptionsResolver';
const strip = (s: string) => s.replace(/--.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:[^']|'')*'/g, "''");
export function validateReadOnlySql(sql: string): ValidationResult {
  const i: ValidationIssue[] = []; const c = strip(sql).toUpperCase();
  for (const k of ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'DROP', 'ALTER', 'TRUNCATE', 'GRANT', 'REVOKE', 'CREATE']) if (new RegExp(`(^|[^A-Z_])${k}([^A-Z_]|$)`).test(c)) i.push({ severity: 'error', message: `Destructive statement detected: "${k}" is not permitted in the Read Only Query Builder.` });
  return { valid: !i.some((x) => x.severity === 'error'), issues: i };
}
export function validateFullReadOnly(st: ReadOnlyQueryState): ValidationResult {
  const i: ValidationIssue[] = [...validateReadOnlySql(st.generatedSql).issues, ...validateAdvancedConsistency(st)];
  st.filters.forEach((f, n) => { if (!['IS NULL', 'IS NOT NULL'].includes(f.operator) && !f.value.trim()) i.push({ severity: 'error', message: `Filter #${n + 1} on ${f.table}.${f.column} needs a value.` }); });
  return { valid: !i.some((x) => x.severity === 'error'), issues: i };
}
export function validateCrState(s: CrQueryState): ValidationIssue[] {
  const i: ValidationIssue[] = []; if (!s.table) i.push({ severity: 'error', message: 'Select a table for this Change Request.' });
  if (s.queryType !== 'DELETE' && !s.values.length) i.push({ severity: 'error', message: 'Add at least one column/value pair.' });
  if (s.queryType !== 'INSERT' && !s.filters.length && !s.confirmNoWhere) i.push({ severity: 'error', message: 'A WHERE condition is required — add a filter or explicitly confirm no WHERE condition.' });
  return i;
}
