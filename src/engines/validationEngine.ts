import type { ReadOnlyQueryState, CrQueryState, ValidationResult, ValidationIssue } from '../types';
import { validateAdvancedConsistency } from '../v17/engines/advancedOptionsResolver';
const DESTRUCTIVE_KEYWORDS = ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'DROP', 'ALTER', 'TRUNCATE', 'GRANT', 'REVOKE', 'CREATE'];
function stripCommentsAndStrings(sql: string): string { let out = sql.replace(/--.*$/gm, ' '); out = out.replace(/\/\*[\s\S]*?\*\//g, ' '); out = out.replace(/'(?:[^']|'')*'/g, "''"); return out; }
export function validateReadOnlySql(sql: string): ValidationResult {
  const issues: ValidationIssue[] = []; const cleaned = stripCommentsAndStrings(sql).toUpperCase();
  for (const kw of DESTRUCTIVE_KEYWORDS) { const re = new RegExp(`(^|[^A-Z_])${kw}([^A-Z_]|$)`); if (re.test(cleaned)) issues.push({ severity: 'error', message: `Destructive statement detected: "${kw}" is not permitted in the Read Only Query Builder. Use the Query Builder for CR instead.` }); }
  if (!/\bSELECT\b/.test(cleaned) && !/\bWITH\b/.test(cleaned)) issues.push({ severity: 'warning', message: 'No SELECT / WITH statement detected yet.' });
  return { valid: issues.filter((i) => i.severity === 'error').length === 0, issues };
}
export function validateReadOnlyState(state: ReadOnlyQueryState): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (state.selectedTables.length === 0) issues.push({ severity: 'warning', message: 'Select at least one table, or describe your requirement above.' });
  if (state.advanced.limit !== null && state.advanced.limit <= 0) issues.push({ severity: 'error', message: 'Result limit must be a positive number.' });
  const seen = new Set<string>(); state.selectedColumns.forEach((c) => { if (c.alias) { if (seen.has(c.alias)) issues.push({ severity: 'error', message: `Duplicate alias "${c.alias}" — aliases must be unique.` }); seen.add(c.alias); } });
  state.filters.forEach((f, idx) => { if (!['IS NULL', 'IS NOT NULL'].includes(f.operator) && f.value.trim() === '') issues.push({ severity: 'error', message: `Filter #${idx + 1} on ${f.table}.${f.column} needs a value.` }); });
  issues.push(...validateAdvancedConsistency(state));
  return issues;
}
export function validateCrState(state: CrQueryState): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!state.table) issues.push({ severity: 'error', message: 'Select a table for this Change Request.' });
  if (state.queryType !== 'DELETE' && state.values.length === 0) issues.push({ severity: 'error', message: 'Add at least one column/value pair.' });
  if ((state.queryType === 'UPDATE' || state.queryType === 'DELETE') && state.filters.length === 0 && !state.confirmNoWhere) issues.push({ severity: 'error', message: 'A WHERE condition is required — add a filter or explicitly confirm no WHERE condition.' });
  return issues;
}
export function validateFullReadOnly(state: ReadOnlyQueryState): ValidationResult { const issues = [...validateReadOnlyState(state), ...validateReadOnlySql(state.generatedSql).issues]; return { valid: issues.filter((i) => i.severity === 'error').length === 0, issues }; }
