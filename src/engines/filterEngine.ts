import type { FilterOperator } from '../types';
import { isSafeDateExpression } from '../v17/engines/dateExpressions';
export const FILTER_OPERATORS: FilterOperator[] = ['=', '<>', '>', '>=', '<', '<=', 'LIKE', 'NOT LIKE', 'IS NULL', 'IS NOT NULL', 'IN', 'NOT IN', 'BETWEEN'];
export const requiresValue = (op: FilterOperator) => op !== 'IS NULL' && op !== 'IS NOT NULL';
function q(v: string): string { const t = v.trim(); if (t === '') return "''"; if (/^-?\d+(\.\d+)?$/.test(t)) return t; if (/^(sysdate|current_date|current_timestamp)$/i.test(t)) return t.toUpperCase(); if (isSafeDateExpression(t)) return t; return `'${t.replace(/'/g, "''")}'`; }
export function renderFilterClause(table: string, column: string, op: FilterOperator, value: string, value2?: string): string {
  const r = `${table}.${column}`;
  switch (op) { case 'IS NULL': case 'IS NOT NULL': return `${r} ${op}`; case 'IN': case 'NOT IN': return `${r} ${op} (${value.split(',').map(q).join(', ')})`; case 'BETWEEN': return `${r} BETWEEN ${q(value)} AND ${q(value2 || '')}`; default: return `${r} ${op} ${q(value)}`; }
}
