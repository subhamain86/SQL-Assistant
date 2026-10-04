import type { FilterOperator } from '../types';
import { isSafeDateExpression } from '../v17/engines/dateExpressions';
export const FILTER_OPERATORS: FilterOperator[] = ['=', '<>', '>', '>=', '<', '<=', 'LIKE', 'NOT LIKE', 'IS NULL', 'IS NOT NULL', 'IN', 'NOT IN', 'BETWEEN'];
export function requiresValue(op: FilterOperator): boolean { return op !== 'IS NULL' && op !== 'IS NOT NULL'; }
export function requiresSecondValue(op: FilterOperator): boolean { return op === 'BETWEEN'; }
function quoteIfNeeded(v: string): string {
  const trimmed = v.trim();
  if (trimmed === '') return "''";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (/^(sysdate|getdate\(\)|now\(\)|current_date|current_timestamp)$/i.test(trimmed)) return trimmed.toUpperCase();
  if (isSafeDateExpression(trimmed)) return trimmed;
  return `'${trimmed.replace(/'/g, "''")}'`;
}
export function renderFilterClause(table: string, column: string, operator: FilterOperator, value: string, value2?: string): string {
  const ref = `${table}.${column}`;
  switch (operator) {
    case 'IS NULL': return `${ref} IS NULL`;
    case 'IS NOT NULL': return `${ref} IS NOT NULL`;
    case 'IN': return `${ref} IN (${value.split(',').map((v) => quoteIfNeeded(v)).join(', ')})`;
    case 'NOT IN': return `${ref} NOT IN (${value.split(',').map((v) => quoteIfNeeded(v)).join(', ')})`;
    case 'BETWEEN': return `${ref} BETWEEN ${quoteIfNeeded(value)} AND ${quoteIfNeeded(value2 || '')}`;
    case 'LIKE': return `${ref} LIKE ${quoteIfNeeded(value)}`;
    case 'NOT LIKE': return `${ref} NOT LIKE ${quoteIfNeeded(value)}`;
    default: return `${ref} ${operator} ${quoteIfNeeded(value)}`;
  }
}
