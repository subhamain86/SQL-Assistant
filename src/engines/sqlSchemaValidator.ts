/**
 * Validates SQL against the Active Schema. V17.2: understands table aliases (FROM T a / JOIN T a),
 * so aliased SQL is checked column-by-column instead of being skipped, and reports duplicate or
 * unknown aliases.
 */
import type { SchemaModel, SqlSchemaValidationResult } from '../types';
const SQL_KEYWORDS = new Set(['select','from','where','group','by','having','order','join','inner','left','right','full','cross','outer','on','and','or','not','null','as','distinct','case','when','then','else','end','with','recursive','union','all','top','limit','fetch','first','rows','only','is','in','between','like','asc','desc','count','sum','avg','min','max','decode','current_date','current_timestamp','sysdate','getdate','now','date_trunc','interval','day','week','month','year','true','false','offset','using','natural','lateral']);
function clean(sql: string): string { return sql.replace(/--.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:[^']|'')*'/g, "''"); }
/** alias(upper) → table name as written; also maps each table name to itself. */
export function parseTableAliases(sql: string): { aliases: Map<string, string>; duplicates: string[] } {
  const aliases = new Map<string, string>(); const duplicates: string[] = [];
  const re = /\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_$#]*)(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_$#]*))?/gi; let m: RegExpExecArray | null;
  const c = clean(sql);
  while ((m = re.exec(c))) {
    const table = m[1]; const alias = m[2];
    if (alias && !SQL_KEYWORDS.has(alias.toLowerCase())) { const k = alias.toUpperCase(); if (aliases.has(k) && aliases.get(k)!.toUpperCase() !== table.toUpperCase()) duplicates.push(alias); aliases.set(k, table); }
  }
  return { aliases, duplicates: Array.from(new Set(duplicates)) };
}
function extractQualifiedIdentifiers(sql: string): { table: string; column: string }[] {
  const matches = clean(sql).match(/\b([A-Za-z_][A-Za-z0-9_$#]*)\.([A-Za-z_][A-Za-z0-9_$#*]*)\b/g) || [];
  const pairs: { table: string; column: string }[] = [];
  matches.forEach((m) => { const [table, column] = m.split('.'); if (column === '*') return; if (SQL_KEYWORDS.has(table.toLowerCase())) return; pairs.push({ table, column }); });
  return pairs;
}
function extractFromJoinTables(sql: string): string[] {
  const cleaned = clean(sql); const tables: string[] = [];
  (cleaned.match(/\bFROM\s+([A-Za-z_][A-Za-z0-9_$#]*)/gi) || []).forEach((m) => { const parts = m.trim().split(/\s+/); if (parts[1]) tables.push(parts[1]); });
  (cleaned.match(/\bJOIN\s+([A-Za-z_][A-Za-z0-9_$#]*)/gi) || []).forEach((m) => { const parts = m.trim().split(/\s+/); if (parts[1]) tables.push(parts[1]); });
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
  const { aliases, duplicates } = parseTableAliases(sql);
  const unknownColumnRefs: string[] = []; const unknownQualifiers = new Set<string>();
  extractQualifiedIdentifiers(sql).forEach(({ table, column }) => {
    const resolved = (aliases.get(table.toUpperCase()) || table).toUpperCase();
    if (!knownTableNames.has(resolved)) { if (!cteNames.has(resolved) && !aliases.has(table.toUpperCase())) unknownQualifiers.add(table); return; }
    const cols = columnsByTable.get(resolved); if (cols && !cols.has(column.toUpperCase())) unknownColumnRefs.push(`${table}.${column}`);
  });
  const warnings: string[] = [];
  if (unknownTables.length) warnings.push(`Table(s) not found in the Active Schema: ${unknownTables.join(', ')}.`);
  if (unknownColumnRefs.length) warnings.push(`Column reference(s) not found in the Active Schema: ${Array.from(new Set(unknownColumnRefs)).join(', ')}.`);
  if (duplicates.length) warnings.push(`Table alias(es) used for more than one table: ${duplicates.join(', ')}.`);
  if (unknownQualifiers.size) warnings.push(`Unknown table or alias qualifier(s): ${Array.from(unknownQualifiers).join(', ')}.`);
  return { valid: unknownTables.length === 0 && unknownColumnRefs.length === 0 && duplicates.length === 0, unknownTables, unknownColumnRefs: Array.from(new Set(unknownColumnRefs)), warnings };
}
