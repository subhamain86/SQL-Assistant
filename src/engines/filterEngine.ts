import type { FilterOperator } from '../types';
import { isSafeDateExpression } from '../v17/engines/dateExpressions';
export const FILTER_OPERATORS: { op: FilterOperator; label: string }[] = [
  { op: '=', label: 'Equals' }, { op: '<>', label: 'Not equal to' }, { op: '>', label: 'Greater than' }, { op: '>=', label: 'Greater than or equal' }, { op: '<', label: 'Less than' }, { op: '<=', label: 'Less than or equal' },
  { op: 'LIKE', label: 'Contains / Like' }, { op: 'NOT LIKE', label: 'Not like' }, { op: 'IS NULL', label: 'Is empty' }, { op: 'IS NOT NULL', label: 'Is not empty' },
  { op: 'IN', label: 'Is one of' }, { op: 'NOT IN', label: 'Is not one of' }, { op: 'BETWEEN', label: 'Between' }];
export const requiresValue = (op: FilterOperator) => op !== 'IS NULL' && op !== 'IS NOT NULL';
function q(v: string): string { const t = v.trim(); if (t === '') return "''"; if (/^-?\d+(\.\d+)?$/.test(t)) return t; if (/^(sysdate|current_date|current_timestamp)$/i.test(t)) return t.toUpperCase(); if (isSafeDateExpression(t)) return t; return `'${t.replace(/'/g, "''")}'`; }
export function renderFilterClause(table: string, column: string, op: FilterOperator, value: string, value2?: string): string {
  const r = `${table}.${column}`;
  switch (op) { case 'IS NULL': case 'IS NOT NULL': return `${r} ${op}`; case 'IN': case 'NOT IN': return `${r} ${op} (${value.split(',').map(q).join(', ')})`; case 'BETWEEN': return `${r} BETWEEN ${q(value)} AND ${q(value2 || '')}`;
    case 'LIKE': case 'NOT LIKE': return `${r} ${op} ${q(/[%_]/.test(value) ? value : `%${value}%`)}`; default: return `${r} ${op} ${q(value)}`; }
}
