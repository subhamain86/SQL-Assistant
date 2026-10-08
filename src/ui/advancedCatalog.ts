/** V17.4 — every SQL option the app really supports, with a short plain-language description (requirement 8 + 9). Dialect-aware: unsupported options are not offered. */
import type { Dialect } from '../types';
export interface AdvOption { id: string; label: string; group: 'Query controls' | 'Join controls' | 'SQL structures'; description: string; where: string; dialects?: Dialect[]; }
export const OPT_DESC = {
  distinct: 'Removes duplicate rows from the result.',
  limit: (d: Dialect) => `Limits the number of rows returned by the query. (Written as ${d === 'SQL Server' ? 'TOP n' : d === 'Oracle' ? 'FETCH FIRST n ROWS ONLY' : 'LIMIT n'} for ${d}.)`,
  groupBy: 'Groups rows so aggregate functions such as COUNT or SUM can be applied.',
  having: 'Filters grouped/aggregated results.',
  cte: 'Creates a temporary named query that can be referenced by the main query.',
  recursive: 'Lets a WITH query refer to itself, for tree-like data such as hierarchies.',
  orderBy: 'Controls the sorting order of the returned results. ASC = smallest first, DESC = largest first.',
  aliases: 'Gives each table a short name (e.g. INVOICE_HEADER ih) so the SQL is shorter to read.',
  joinType: 'Decides what happens to rows that have no match in the joined table.',
  joinPaths: 'Shows how the selected tables are connected. If more than one route exists, choose the one you want.',
  caseDecode: 'Turns stored codes into readable labels (CASE / DECODE) for a column that has no decode in the schema.',
  subselect: 'Adds a condition based on a second, read-only SELECT — for example "has at least one approved invoice" (EXISTS) or "is in the result of another query" (IN).',
};
export const ADVANCED_CATALOG: AdvOption[] = [
  { id: 'distinct', label: 'DISTINCT', group: 'Query controls', description: OPT_DESC.distinct, where: 'Advanced Options' },
  { id: 'limit', label: 'LIMIT / TOP', group: 'Query controls', description: 'Limits the number of rows returned by the query.', where: 'Advanced Options (written as TOP, FETCH FIRST or LIMIT for your dialect)' },
  { id: 'orderby', label: 'ORDER BY  ASC / DESC', group: 'Query controls', description: OPT_DESC.orderBy, where: 'Advanced Options → ORDER BY' },
  { id: 'groupby', label: 'GROUP BY', group: 'Query controls', description: OPT_DESC.groupBy, where: 'Advanced Options' },
  { id: 'having', label: 'HAVING', group: 'Query controls', description: OPT_DESC.having, where: 'Advanced Options' },
  { id: 'where', label: 'WHERE', group: 'Query controls', description: 'Keeps only the rows that match your conditions.', where: 'Tables & Columns → Filters' },
  { id: 'andor', label: 'AND / OR', group: 'Query controls', description: 'Combines conditions: AND = all must be true, OR = any one can be true.', where: 'Tables & Columns → Filters' },
  { id: 'between', label: 'BETWEEN', group: 'Query controls', description: 'Matches values inside a range, including both ends.', where: 'Tables & Columns → Filters' },
  { id: 'in', label: 'IN / NOT IN', group: 'Query controls', description: 'Matches a value against a list (a, b, c).', where: 'Tables & Columns → Filters' },
  { id: 'like', label: 'LIKE / NOT LIKE', group: 'Query controls', description: 'Matches text patterns; % stands for any characters.', where: 'Tables & Columns → Filters' },
  { id: 'null', label: 'IS NULL / IS NOT NULL', group: 'Query controls', description: 'Finds empty or filled values.', where: 'Tables & Columns → Filters' },
  { id: 'dates', label: 'Date filtering & date ranges', group: 'Query controls', description: 'Filters by date: pick a date column and use a Date shortcut (today, last 30 days, this month …), or BETWEEN with two dates.', where: 'Tables & Columns → Filters' },
  { id: 'agg', label: 'Aggregation: COUNT, SUM, AVG, MIN, MAX', group: 'Query controls', description: 'Combines many rows into one number (count, total, average, smallest, largest).', where: 'Tables & Columns → Select Columns → Aggregate' },
  { id: 'case', label: 'CASE expressions', group: 'Query controls', description: OPT_DESC.caseDecode, where: 'Advanced Options → Manual CASE / DECODE' },
  { id: 'alias', label: 'Aliases', group: 'Query controls', description: 'Renames a column in the result (column alias) or shortens table names (table aliases).', where: 'Select Columns → Alias · Advanced Options → table aliases' },
  { id: 'inner', label: 'INNER JOIN', group: 'Join controls', description: 'Keeps only rows that have a match in both tables.', where: 'Advanced Options → Join type' },
  { id: 'left', label: 'LEFT JOIN', group: 'Join controls', description: 'Keeps all rows of the first table, even without a match.', where: 'Advanced Options → Join type' },
  { id: 'right', label: 'RIGHT JOIN', group: 'Join controls', description: 'Keeps all rows of the joined table, even without a match.', where: 'Advanced Options → Join type' },
  { id: 'full', label: 'FULL JOIN', group: 'Join controls', description: 'Keeps all rows of both tables, matched or not.', where: 'Advanced Options → Join type', dialects: ['SQL Server', 'Oracle', 'PostgreSQL', 'Generic'] },
  { id: 'joincond', label: 'Join conditions', group: 'Join controls', description: OPT_DESC.joinPaths, where: 'Advanced Options → Join paths (from schema relationships)' },
  { id: 'cte', label: 'WITH / CTE', group: 'SQL structures', description: OPT_DESC.cte, where: 'Advanced Options → CTEs' },
  { id: 'recursive', label: 'Recursive WITH', group: 'SQL structures', description: OPT_DESC.recursive, where: 'Advanced Options → Recursive' },
  { id: 'views', label: 'Views', group: 'SQL structures', description: 'Views of the Active Schema appear in the table list and are used like tables.', where: 'Tables & Columns → Select Tables' },
  { id: 'subq', label: 'Subqueries / nested queries', group: 'SQL structures', description: OPT_DESC.subselect, where: 'Advanced Options → Sub-select filters (or a CTE)' },
  { id: 'exists', label: 'EXISTS / NOT EXISTS', group: 'SQL structures', description: 'True when another SELECT returns (EXISTS) or does not return (NOT EXISTS) any row.', where: 'Advanced Options → Sub-select filters' },
];
export const catalogFor = (d: Dialect): AdvOption[] => ADVANCED_CATALOG.filter((o) => !o.dialects || o.dialects.includes(d));
export const JOIN_TYPE_LABEL: Record<string, string> = { 'INNER JOIN': 'INNER JOIN (matching rows only)', 'LEFT JOIN': 'LEFT JOIN (keep rows without a match)', 'RIGHT JOIN': 'RIGHT JOIN (keep joined rows without a match)', 'FULL JOIN': 'FULL JOIN (keep all rows of both tables)' };
export const joinTypesFor = (d: Dialect): string[] => ['INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', ...(d === 'MySQL' ? [] : ['FULL JOIN'])];
