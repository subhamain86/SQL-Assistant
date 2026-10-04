import type { SchemaModel, SqlSchemaValidationResult } from '../types';
const KW = new Set(['select','from','where','group','by','having','order','join','inner','left','right','full','outer','on','and','or','not','null','as','distinct','case','when','then','else','end','with','recursive','union','all','top','limit','fetch','first','rows','only','is','in','between','like','asc','desc','count','sum','avg','min','max','current_date','sysdate','interval','day','week','month','year','trunc','add_months','date_trunc']);
const clean = (s: string) => s.replace(/--.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:[^']|'')*'/g, "''");
export function validateSqlAgainstSchema(sql: string, s: SchemaModel): SqlSchemaValidationResult {
  const t = sql.trim(); if (!t || t.startsWith('--')) return { valid: true, unknownTables: [], unknownColumnRefs: [], warnings: [] };
  const c = clean(sql); const known = new Map(s.tables.map((x) => [x.name.toUpperCase(), new Set(x.columns.map((k) => k.name.toUpperCase()))]));
  const ctes = new Set(['DUAL', ...[...c.matchAll(/(?:\bWITH\s+(?:RECURSIVE\s+)?|,\s*)([A-Za-z_]\w*)\s+AS\s*\(/gi)].map((m) => m[1].toUpperCase())]);
  const aliases = new Map<string, string>(); [...c.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][\w$#]*)(?:\s+(?:AS\s+)?([A-Za-z_][\w$#]*))?/gi)].forEach((m) => { if (m[2] && !KW.has(m[2].toLowerCase())) aliases.set(m[2].toUpperCase(), m[1].toUpperCase()); });
  const unknownTables = Array.from(new Set([...c.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][\w$#]*)/gi)].map((m) => m[1]))).filter((x) => !known.has(x.toUpperCase()) && !ctes.has(x.toUpperCase()));
  const bad: string[] = []; (c.match(/\b([A-Za-z_][\w$#]*)\.([A-Za-z_][\w$#]*)\b/g) || []).forEach((p) => { const [tb, col] = p.split('.'); const r = (aliases.get(tb.toUpperCase()) || tb).toUpperCase(); const cols = known.get(r); if (cols && !cols.has(col.toUpperCase())) bad.push(p); });
  const w: string[] = []; if (unknownTables.length) w.push(`Table(s) not found in the Active Schema: ${unknownTables.join(', ')}.`); if (bad.length) w.push(`Column reference(s) not found in the Active Schema: ${Array.from(new Set(bad)).join(', ')}.`);
  return { valid: !unknownTables.length && !bad.length, unknownTables, unknownColumnRefs: Array.from(new Set(bad)), warnings: w };
}
