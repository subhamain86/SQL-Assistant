import type { SchemaModel, SqlSchemaValidationResult } from '../types';
const SQL_KEYWORDS = new Set(['select','from','where','group','by','having','order','join','inner','left','right','outer','on','and','or','not','null','as','distinct','case','when','then','else','end','with','recursive','union','all','top','limit','fetch','first','rows','only','is','in','between','like','asc','desc','count','sum','avg','min','max','decode','current_date','current_timestamp','sysdate','getdate','now','date_trunc','interval','day','week','month','year','true','false']);
function clean(sql: string): string { return sql.replace(/--.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:[^']|'')*'/g, "''"); }
function extractQualifiedIdentifiers(sql: string): { table: string; column: string }[] {
  const matches = clean(sql).match(/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_*]*)\b/g) || [];
  const pairs: { table: string; column: string }[] = [];
  matches.forEach((m) => { const [table, column] = m.split('.'); if (column === '*') return; if (SQL_KEYWORDS.has(table.toLowerCase())) return; pairs.push({ table, column }); });
  return pairs;
}
function extractFromJoinTables(sql: string): string[] {
  const cleaned = clean(sql); const tables: string[] = [];
  (cleaned.match(/\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)/gi) || []).forEach((m) => { const parts = m.trim().split(/\s+/); if (parts[1]) tables.push(parts[1]); });
  (cleaned.match(/\bJOIN\s+([A-Za-z_][A-Za-z0-9_]*)/gi) || []).forEach((m) => { const parts = m.trim().split(/\s+/); if (parts[1]) tables.push(parts[1]); });
  return Array.from(new Set(tables));
}
export function validateSqlAgainstSchema(sql: string, schema: SchemaModel): SqlSchemaValidationResult {
  const trimmed = sql.trim();
  if (!trimmed || trimmed.startsWith('--')) return { valid: true, unknownTables: [], unknownColumnRefs: [], warnings: [] };
  const knownTableNames = new Set(schema.tables.map((t) => t.name.toUpperCase()));
  const columnsByTable = new Map<string, Set<string>>();
  schema.tables.forEach((t) => columnsByTable.set(t.name.toUpperCase(), new Set(t.columns.map((c) => c.name.toUpperCase()))));
  // CTE names and Oracle's DUAL are not schema tables and must not be reported as missing.
  const cteNames = new Set<string>(['DUAL']);
  [...clean(sql).matchAll(/(?:\bWITH\s+(?:RECURSIVE\s+)?|,\s*)([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*\(/gi)].forEach((m) => cteNames.add(m[1].toUpperCase()));
  const unknownTables = extractFromJoinTables(sql).filter((t) => !knownTableNames.has(t.toUpperCase()) && !cteNames.has(t.toUpperCase()) && !SQL_KEYWORDS.has(t.toLowerCase()));
  const unknownColumnRefs: string[] = [];
  extractQualifiedIdentifiers(sql).forEach(({ table, column }) => { const tu = table.toUpperCase(); if (!knownTableNames.has(tu)) return; const cols = columnsByTable.get(tu); if (cols && !cols.has(column.toUpperCase())) unknownColumnRefs.push(`${table}.${column}`); });
  const warnings: string[] = [];
  if (unknownTables.length) warnings.push(`Table(s) not found in the Active Schema: ${unknownTables.join(', ')}.`);
  if (unknownColumnRefs.length) warnings.push(`Column reference(s) not found in the Active Schema: ${Array.from(new Set(unknownColumnRefs)).join(', ')}.`);
  return { valid: unknownTables.length === 0 && unknownColumnRefs.length === 0, unknownTables, unknownColumnRefs: Array.from(new Set(unknownColumnRefs)), warnings };
}
