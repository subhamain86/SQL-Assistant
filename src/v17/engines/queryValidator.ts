/**
 * V17.4 — Query validation before SQL is shown as final (requirement 17).
 * Twelve checks, each reported separately so the UI can say exactly what passed and what needs attention:
 *   tables · columns · joins · syntax · functions · aliases · GROUP BY · aggregates · filters · dialect · unresolved entities · destructive SQL
 * `fail`  = the SQL must not be treated as final / must not be learned.   `warn` = shown to the user, does not block.
 * Pure functions, no I/O. The Active Schema is the only source of truth for tables, columns and relationships.
 */
import type { Dialect, ReadOnlyQueryState, SchemaModel } from '../../types';
import { validateSqlAgainstSchema } from '../../engines/sqlSchemaValidator';
import { validateFullReadOnly } from '../../engines/validationEngine';
import { withFkRelationships } from './joinGraph';
import { isNumericType, isDateType } from './schemaContext';

export type CheckStatus = 'pass' | 'warn' | 'fail';
export interface CheckResult { id: string; label: string; status: CheckStatus; details: string[]; }
export interface FullValidation { valid: boolean; checks: CheckResult[]; errors: string[]; warnings: string[]; unresolved: string[]; }

const AGG = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
const AGG_RE = /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i;
const KW = new Set(['SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'HAVING', 'ORDER', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'ON', 'AND', 'OR', 'NOT', 'NULL', 'AS', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH', 'RECURSIVE', 'UNION', 'ALL', 'TOP', 'LIMIT', 'FETCH', 'FIRST', 'NEXT', 'ROWS', 'ROW', 'ONLY', 'IS', 'IN', 'BETWEEN', 'LIKE', 'ASC', 'DESC', 'EXISTS', 'INTERVAL', 'DAY', 'WEEK', 'MONTH', 'YEAR', 'DATE', 'OVER', 'PARTITION', 'OFFSET', 'USING', 'CAST', 'VARCHAR', 'CHAR', 'NUMBER', 'INT', 'INTEGER', 'DECIMAL', 'TRUE', 'FALSE', 'SYSDATE', 'CURRENT_DATE', 'CURRENT_TIMESTAMP', 'ESCAPE', 'ANY', 'SOME', 'NULLS', 'LAST', 'ROWNUM', 'LEVEL', 'ROWID', 'USER', 'UID', 'SYSTIMESTAMP', 'CURRENT_USER', 'NEXTVAL', 'CURRVAL']);
const COMMON_FN = new Set([...AGG, 'COALESCE', 'NULLIF', 'CAST', 'UPPER', 'LOWER', 'TRIM', 'LTRIM', 'RTRIM', 'LENGTH', 'SUBSTR', 'SUBSTRING', 'ROUND', 'ABS', 'CEIL', 'CEILING', 'FLOOR', 'MOD', 'REPLACE', 'CONCAT', 'EXTRACT', 'DATE', 'CASE', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'OVER']);
const DIALECT_FN: Record<Dialect, Set<string>> = {
  Oracle: new Set(['TRUNC', 'ADD_MONTHS', 'DECODE', 'NVL', 'NVL2', 'TO_CHAR', 'TO_DATE', 'TO_NUMBER', 'LISTAGG', 'INSTR', 'LAST_DAY', 'MONTHS_BETWEEN', 'SYSDATE']),
  'SQL Server': new Set(['DATEADD', 'DATEDIFF', 'GETDATE', 'DATEFROMPARTS', 'ISNULL', 'LEN', 'CONVERT', 'FORMAT', 'STRING_AGG', 'YEAR', 'MONTH', 'DAY', 'EOMONTH', 'CHARINDEX']),
  PostgreSQL: new Set(['DATE_TRUNC', 'TO_CHAR', 'TO_DATE', 'NOW', 'STRING_AGG', 'AGE', 'DATE_PART', 'POSITION', 'GENERATE_SERIES']),
  MySQL: new Set(['WEEKDAY', 'DAYOFMONTH', 'MAKEDATE', 'DATE_SUB', 'DATE_ADD', 'CURDATE', 'NOW', 'IFNULL', 'GROUP_CONCAT', 'DATE_FORMAT', 'DATEDIFF', 'YEAR', 'MONTH', 'DAY', 'LAST_DAY', 'INSTR']),
  Generic: new Set(['DATE_TRUNC', 'NOW', 'POSITION']),
};
const ALL_DIALECT_FN = new Set(Object.values(DIALECT_FN).flatMap((s) => [...s]));
const NOT_A_FUNCTION = new Set(['IN', 'EXISTS', 'AS', 'ON', 'AND', 'OR', 'NOT', 'WHEN', 'THEN', 'ELSE', 'VALUES', 'FROM', 'JOIN', 'WHERE', 'HAVING', 'BY', 'USING', 'ANY', 'ALL', 'SOME', 'UNION', 'SELECT', 'WITH', 'BETWEEN', 'LIKE', 'IS', 'LIMIT', 'FETCH', 'ONLY', 'ROWS', 'ROW', 'END', 'CASE', 'DISTINCT', 'OVER', 'PARTITION', 'TOP', 'INTERVAL', 'VARCHAR', 'CHAR', 'NUMBER', 'INT', 'DECIMAL', 'NVARCHAR2', 'VARCHAR2']);
const DANGEROUS_FN = /\b(DBMS_[A-Z_]+|UTL_[A-Z_]+|XP_[A-Z_]+|SP_[A-Z_]+|OPENROWSET|OPENQUERY|OPENDATASOURCE|LOAD_FILE|PG_SLEEP|PG_READ_FILE|SLEEP|BENCHMARK|WAITFOR|DBLINK|LO_IMPORT|LO_EXPORT)\b/i;
const DESTRUCTIVE = ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'DROP', 'ALTER', 'TRUNCATE', 'GRANT', 'REVOKE', 'CREATE', 'EXEC', 'EXECUTE', 'CALL', 'REPLACE INTO', 'RENAME', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'LOCK', 'ATTACH', 'PRAGMA', 'SHUTDOWN', 'COPY'];

/** Comments removed and string literals replaced by '' (their content is never analysed). */
export const sanitize = (sql: string): string => sql.replace(/--.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:[^']|'')*'/g, "''");
const U = (s: string) => s.trim().toUpperCase();

export function topLevelSplit(text: string, sep: RegExp): string[] {
  const out: string[] = []; let depth = 0; let cur = '';
  for (let i = 0; i < text.length; i++) { const ch = text[i]; if (ch === '(') depth++; if (ch === ')') depth--; if (depth === 0 && sep.test(ch)) { out.push(cur); cur = ''; } else cur += ch; }
  out.push(cur); return out.map((x) => x.trim()).filter(Boolean);
}
const stripSubSelects = (t: string): string => { let out = t; for (let i = 0; i < 20; i++) { const n = out.replace(/\((?:[^()]|\([^()]*\))*\)/g, (m) => (/\bSELECT\b/i.test(m) ? ' ' : m)); if (n === out) break; out = n; } return out; };

export interface ParsedQuery { main: string; select: string; from: string; where: string; groupBy: string; having: string; orderBy: string; tail: string; joins: { type: string; table: string; alias: string; on: string }[]; baseTable: string; }
export function splitClauses(c: string): ParsedQuery {
  // main SELECT: skip a leading WITH … CTE list
  let main = c.trim().replace(/;+\s*$/, '');
  if (/^WITH\b/i.test(main)) { let depth = 0; for (let i = 0; i < main.length; i++) { if (main[i] === '(') depth++; else if (main[i] === ')') { depth--; if (depth === 0 && /^\s*SELECT\b/i.test(main.slice(i + 1))) { main = main.slice(i + 1).trim(); break; } } } }
  const marks: { k: string; i: number }[] = []; let depth = 0;
  const re = /\b(SELECT|FROM|WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|FETCH|OFFSET|UNION)\b/gi;
  const depthAt = (idx: number) => { let d = 0; for (let i = 0; i < idx; i++) { if (main[i] === '(') d++; else if (main[i] === ')') d--; } return d; };
  let m: RegExpExecArray | null; while ((m = re.exec(main))) { depth = depthAt(m.index); if (depth === 0) marks.push({ k: m[1].toUpperCase().replace(/\s+/g, ' '), i: m.index }); }
  const part = (k: string) => { const x = marks.findIndex((y) => y.k === k); if (x < 0) return ''; const s = marks[x].i + k.length + (k.includes(' ') ? (main.slice(marks[x].i).match(/^\S+\s+\S+/)?.[0].length ?? k.length) - k.length : 0); return main.slice(s, marks[x + 1] ? marks[x + 1].i : main.length).trim(); };
  const tailIdx = marks.find((y) => ['LIMIT', 'FETCH', 'OFFSET', 'UNION'].includes(y.k));
  const from = part('FROM'); const joinRe = /\b(INNER|LEFT(?:\s+OUTER)?|RIGHT(?:\s+OUTER)?|FULL(?:\s+OUTER)?|CROSS)?\s*JOIN\b/gi;
  const pieces: { type: string; at: number; end: number }[] = []; let jm: RegExpExecArray | null; while ((jm = joinRe.exec(from))) { let d = 0; for (let i = 0; i < jm.index; i++) { if (from[i] === '(') d++; else if (from[i] === ')') d--; } if (d === 0) pieces.push({ type: (jm[1] || 'INNER').toUpperCase().replace(/\s+OUTER/, ''), at: jm.index, end: jm.index + jm[0].length }); }
  const baseTxt = pieces.length ? from.slice(0, pieces[0].at) : from; const base = baseTxt.trim().match(/^([A-Za-z_][\w$#]*)/);
  const joins = pieces.map((p, i) => { const body = from.slice(p.end, pieces[i + 1] ? pieces[i + 1].at : from.length).trim(); const mm = body.match(/^([A-Za-z_][\w$#]*)(?:\s+(?:AS\s+)?([A-Za-z_][\w$#]*))?\s*(?:ON\b([\s\S]*)|USING\b([\s\S]*))?$/i); const al = mm?.[2] && !KW.has(U(mm[2])) ? mm[2] : ''; return { type: p.type, table: mm?.[1] || '', alias: al, on: (mm?.[3] || mm?.[4] || '').trim() }; });
  return { main, select: part('SELECT'), from, where: part('WHERE'), groupBy: part('GROUP BY'), having: part('HAVING'), orderBy: part('ORDER BY'), tail: tailIdx ? main.slice(tailIdx.i) : '', joins, baseTable: base?.[1] || '' };
}
/** V17.5: CASE / DECODE / CAST … built only from columns that are in GROUP BY is valid next to an aggregate (e.g. a schema decode of the grouped column). */
const exprOnlyOfGroupedColumns = (expr: string, grouped: Set<string>): boolean => { const refs = [...expr.matchAll(/(?<![\w$#.])([A-Za-z_][\w$#]*\.[A-Za-z_][\w$#]*)(?![\w$#(])/g)].map((m) => U(m[1])); return refs.length > 0 && refs.every((r) => grouped.has(r)); };
export const selectItems = (sel: string) => topLevelSplit(sel.replace(/^\s*(DISTINCT|ALL)\s+/i, '').replace(/^\s*TOP\s+\d+\s+/i, ''), /,/);
export const itemBody = (it: string) => it.replace(/\s+AS\s+[A-Za-z_][\w$#]*\s*$/i, '').trim();
const hasOuterAgg = (it: string) => AGG_RE.test(stripSubSelects(it)) && !/\bOVER\s*\(/i.test(it);

export function validateFinalQuery(sql: string, schema: SchemaModel, dialect: Dialect, opts: { state?: ReadOnlyQueryState; unresolvedTerms?: string[] } = {}): FullValidation {
  const checks: CheckResult[] = []; const unresolved: string[] = [...(opts.unresolvedTerms || [])];
  const add = (id: string, label: string, fails: string[], warns: string[] = []) => checks.push({ id, label, status: fails.length ? 'fail' : warns.length ? 'warn' : 'pass', details: [...fails, ...warns] });
  const trimmed = sql.trim(); const c = sanitize(sql).trim();
  if (!trimmed || trimmed.startsWith('--') || /^--/.test(c)) return { valid: false, checks: [{ id: 'syntax', label: 'SQL syntax', status: 'fail', details: ['There is no SQL to validate yet.'] }], errors: ['There is no SQL to validate yet.'], warnings: [], unresolved };
  const q = splitClauses(c); const rel = withFkRelationships(schema).relationships; const tbl = new Map(schema.tables.map((t) => [U(t.name), t]));
  const ctes = new Set([...c.matchAll(/(?:\bWITH\s+(?:RECURSIVE\s+)?|,\s*)([A-Za-z_]\w*)\s+AS\s*\(/gi)].map((m) => U(m[1])));
  const sv = validateSqlAgainstSchema(sql, schema);

  // 1 tables
  add('tables', 'Tables exist in the Active Schema', sv.unknownTables.map((t) => `Table "${t}" is not in the Active Schema "${schema.name}".`));
  sv.unknownTables.forEach((t) => unresolved.push(`table ${t}`));

  // 2 columns (qualified refs are exact; bare identifiers are best-effort warnings)
  const aliasMap = new Map<string, string>(); [...c.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][\w$#]*)(?:\s+(?:AS\s+)?([A-Za-z_][\w$#]*))?/gi)].forEach((m) => { if (m[2] && !KW.has(U(m[2]))) aliasMap.set(U(m[2]), U(m[1])); });
  const outAliases = new Set([...c.matchAll(/\bAS\s+([A-Za-z_][\w$#]*)/gi)].map((m) => U(m[1])));
  const scopeTables = [q.baseTable, ...q.joins.map((j) => j.table)].filter(Boolean).map(U).filter((t) => tbl.has(t));
  const scopeCols = new Set(scopeTables.flatMap((t) => tbl.get(t)!.columns.map((x) => U(x.name))));
  const bare: string[] = [];
  if (scopeTables.length) { const body = stripSubSelects(`${q.select} ${q.where} ${q.groupBy} ${q.having}`).replace(/\b[A-Za-z_][\w$#]*\s*\.\s*[A-Za-z_][\w$#]*/g, ' ').replace(/\b(?:AS|INTERVAL)\s+[A-Za-z_]\w*/gi, ' ');
    [...body.matchAll(/(?<![\w$#.'])([A-Za-z_][\w$#]*)(?!\s*\()(?![\w$#])/g)].forEach((m) => { const w = U(m[1]); if (KW.has(w) || COMMON_FN.has(w) || ALL_DIALECT_FN.has(w) || outAliases.has(w) || ctes.has(w) || scopeCols.has(w) || aliasMap.has(w) || scopeTables.includes(w) || /^\d/.test(w)) return; if (!bare.includes(m[1])) bare.push(m[1]); }); }
  const bareMsg = (b: string) => `"${b}" could not be matched to a column of ${scopeTables.length === 1 ? scopeTables[0] : 'the tables in the query'}.`;
  const bareIsError = scopeTables.length === 1 && !ctes.size;
  add('columns', 'Columns exist in the Active Schema', [...sv.unknownColumnRefs.map((x) => `Column "${x}" is not in the Active Schema.`), ...(bareIsError ? bare.map(bareMsg) : [])], bareIsError ? [] : bare.map(bareMsg));
  sv.unknownColumnRefs.forEach((x) => unresolved.push(`column ${x}`)); bare.forEach((b) => unresolved.push(`name ${b}`));

  // 3 joins
  const jf: string[] = []; const jw: string[] = [];
  q.joins.forEach((j) => {
    if (j.type !== 'CROSS' && !j.on) jf.push(`JOIN ${j.table || '?'} has no ON condition (this would multiply rows).`);
    const refs = [...j.on.matchAll(/([A-Za-z_][\w$#]*)\.([A-Za-z_][\w$#]*)\s*=\s*([A-Za-z_][\w$#]*)\.([A-Za-z_][\w$#]*)/g)];
    if (j.on && !refs.length) jw.push(`The ON condition of JOIN ${j.table} is not a simple column = column comparison.`);
    refs.forEach((r) => { const a = aliasMap.get(U(r[1])) || U(r[1]); const b = aliasMap.get(U(r[3])) || U(r[3]); const ok = rel.some((x) => (U(x.fromTable) === a && U(x.fromColumn) === U(r[2]) && U(x.toTable) === b && U(x.toColumn) === U(r[4])) || (U(x.fromTable) === b && U(x.fromColumn) === U(r[4]) && U(x.toTable) === a && U(x.toColumn) === U(r[2]))); if (tbl.has(a) && tbl.has(b) && !ok) jw.push(`${a}.${U(r[2])} = ${b}.${U(r[4])} is not a relationship declared in the Active Schema.`); });
    if (j.table && !tbl.has(U(j.table)) && !ctes.has(U(j.table))) jf.push(`JOIN target "${j.table}" is not in the Active Schema.`);
  });
  add('joins', 'Joins are complete and match schema relationships', jf, jw);

  // 4 syntax
  const sf: string[] = []; const sw: string[] = []; let d = 0; let broke = false; for (const ch of c) { if (ch === '(') d++; if (ch === ')') { d--; if (d < 0) broke = true; } } if (d !== 0 || broke) sf.push('Parentheses are not balanced.');
  if ((sql.replace(/--.*$/gm, '').match(/'/g) || []).length % 2) sf.push('A quote (\') is not closed.');
  if (!/^\s*(WITH|SELECT)\b/i.test(c)) sf.push('The statement must start with SELECT or WITH.');
  if (!/\bFROM\b/i.test(c) && !/\bDUAL\b/i.test(c) && !/^\s*WITH\b/i.test(c)) sw.push('There is no FROM clause.');
  if (/,\s*(FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING)\b/i.test(c)) sf.push('A trailing comma appears before a clause keyword.');
  if (/\bSELECT\s*(?:DISTINCT\s*)?(?:FROM)\b/i.test(c)) sf.push('SELECT has no column list.');
  if (/\bIN\s*\(\s*\)/i.test(c)) sf.push('IN () has no values.');
  if (/\bBETWEEN\b(?:(?!\bAND\b)[\s\S])*$/i.test(q.where) && /\bBETWEEN\b/i.test(q.where) && !/\bBETWEEN\b[\s\S]+\bAND\b/i.test(q.where)) sf.push('BETWEEN needs "AND".');
  const body = c.replace(/;\s*$/, ''); if (/;\s*\S/.test(body)) sf.push('More than one statement was found — only a single SELECT is allowed.');
  const order = [['SELECT', /\bSELECT\b/i], ['FROM', /\bFROM\b/i], ['WHERE', /\bWHERE\b/i], ['GROUP BY', /\bGROUP\s+BY\b/i], ['HAVING', /\bHAVING\b/i], ['ORDER BY', /\bORDER\s+BY\b/i]] as const;
  const pos = order.map(([n, r]) => ({ n, i: stripSubSelects(q.main).search(r) })).filter((x) => x.i >= 0); for (let i = 1; i < pos.length; i++) if (pos[i].i < pos[i - 1].i) sf.push(`${pos[i].n} appears before ${pos[i - 1].n}.`);
  add('syntax', 'SQL syntax', sf, sw);

  // 5 functions
  const ff: string[] = []; const fw: string[] = []; const seenFn = new Set<string>();
  [...c.matchAll(/(?<![\w$#.])([A-Za-z_][\w$#]*)\s*\(/g)].forEach((m) => { const f = U(m[1]); if (seenFn.has(f) || NOT_A_FUNCTION.has(f) || ctes.has(f) || tbl.has(f)) return; seenFn.add(f);
    if (COMMON_FN.has(f) || DIALECT_FN[dialect].has(f)) return;
    if (ALL_DIALECT_FN.has(f)) ff.push(`${f}() is not available in ${dialect}.`); else if (!DANGEROUS_FN.test(f)) fw.push(`${f}() is not in the list of functions SQL Assistant knows — check it is valid for ${dialect}.`); });
  if (/\bSYSDATE\b/i.test(c) && !DIALECT_FN[dialect].has('SYSDATE') && dialect !== 'MySQL') ff.push(`SYSDATE is not available in ${dialect}.`);
  add('functions', 'Functions are valid for the dialect', ff, fw);

  // 6 aliases
  const af: string[] = []; const aw: string[] = []; const aliasList = [...q.select.matchAll(/\bAS\s+([A-Za-z_][\w$#]*)(?!\s*\()(?![\w$#])/gi)].map((m) => U(m[1])); // `AS VARCHAR(255)` inside CAST(…) is a type, not an alias
  aliasList.forEach((a, i) => { if (aliasList.indexOf(a) !== i) af.push(`The column alias "${a}" is used more than once.`); if (KW.has(a)) af.push(`"${a}" is a reserved word and cannot be an alias.`); });
  const tAliases = [...c.matchAll(/\b(?:FROM|JOIN)\s+[A-Za-z_][\w$#]*\s+(?:AS\s+)?([A-Za-z_][\w$#]*)/gi)].map((m) => U(m[1])).filter((x) => !KW.has(x)); tAliases.forEach((a, i) => { if (tAliases.indexOf(a) !== i) af.push(`The table alias "${a}" is used more than once.`); });
  aliasList.forEach((a) => { if (new RegExp(`(?<![\\w.])${a}(?![\\w(])`, 'i').test(stripSubSelects(q.where))) aw.push(`The alias "${a}" is used in WHERE — most databases do not allow this.`); });
  add('aliases', 'Aliases are valid and unique', af, aw);

  // 7 GROUP BY requirements   8 aggregate usage
  const items = selectItems(q.select); const aggregated = items.some(hasOuterAgg) || (AGG_RE.test(stripSubSelects(q.having)) && !!q.having);
  const gf: string[] = []; const gw: string[] = []; const gnorm = new Set(topLevelSplit(q.groupBy, /,/).map((x) => U(x).replace(/\s+/g, ' ')));
  if (aggregated) { items.forEach((it, idx) => { if (hasOuterAgg(it) || /\bOVER\s*\(/i.test(it)) return; const b = itemBody(it); const key = U(b).replace(/\s+/g, ' '); const ordinal = String(idx + 1); if (b === '*') gf.push('SELECT * cannot be combined with aggregate functions.'); else if (/^[\d'.]+$/.test(b) || /^''$/.test(b)) return; else if (!gnorm.has(key) && !gnorm.has(ordinal) && !gnorm.has(U(b.replace(/^[\w$#]+\./, ''))) && !exprOnlyOfGroupedColumns(b, gnorm)) gf.push(`${b} is selected next to an aggregate but is not in GROUP BY.`); }); }
  else if (q.groupBy && !AGG_RE.test(q.select)) gw.push('GROUP BY is used without an aggregate function — use DISTINCT if you only want unique rows.');
  add('groupby', 'GROUP BY covers every non-aggregated column', gf, gw);
  const agf: string[] = []; const agw: string[] = [];
  if (AGG_RE.test(stripSubSelects(q.where))) agf.push('An aggregate function cannot be used in WHERE — use HAVING.');
  if (/\b(?:COUNT|SUM|AVG|MIN|MAX)\s*\(\s*(?:DISTINCT\s+)?(?:COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(c)) agf.push('Aggregate functions cannot be nested.');
  if (q.having && !aggregated && !q.groupBy) agw.push('HAVING is used without GROUP BY or an aggregate function.');
  if (q.groupBy && AGG_RE.test(q.groupBy)) agf.push('GROUP BY cannot contain an aggregate function.');
  add('aggregates', 'Aggregate functions are used correctly', agf, agw);

  // 9 filters
  const ftf: string[] = []; const ftw: string[] = [];
  [...q.where.matchAll(/([A-Za-z_][\w$#]*)\.([A-Za-z_][\w$#]*)\s*(=|<>|!=|>=|<=|>|<)\s*('(?:[^']|'')*'|[^\s)]+)/g)].forEach((m) => { const t = tbl.get(aliasMap.get(U(m[1])) || U(m[1])); const col = t?.columns.find((x) => U(x.name) === U(m[2])); if (!col) return; const lit = m[4]; const quoted = /^''$/.test(lit) || lit.startsWith("'");
    const rawLit = sql.match(new RegExp(`${m[1]}\\.${m[2]}\\s*(?:=|<>|!=|>=|<=|>|<)\\s*('(?:[^']|'')*')`, 'i'))?.[1];
    if (isNumericType(col.type) && quoted && rawLit && !/^'-?\d+(\.\d+)?'$/.test(rawLit)) ftw.push(`${m[1]}.${m[2]} is numeric but is compared with the text ${rawLit}.`);
    if (isDateType(col.type) && quoted && rawLit && !/^'\d{4}-\d{2}-\d{2}/.test(rawLit)) ftw.push(`${m[1]}.${m[2]} is a date but is compared with the text ${rawLit} — use a date expression.`);
    if (!isNumericType(col.type) && !isDateType(col.type) && !quoted && /^-?\d/.test(lit) && col.decode?.length) ftw.push(`${m[1]}.${m[2]} holds codes (text) — ${lit} is not quoted.`); });
  if (opts.state) validateFullReadOnly(opts.state).issues.forEach((i) => { if (/^Filter #/.test(i.message)) ftf.push(i.message); });
  add('filters', 'Filters are complete and type-compatible', ftf, ftw);

  // 10 dialect
  const df: string[] = []; const dw: string[] = [];
  if (/\bLIMIT\s+\d+/i.test(c) && (dialect === 'Oracle' || dialect === 'SQL Server')) df.push(`LIMIT is not valid in ${dialect} — use ${dialect === 'Oracle' ? 'FETCH FIRST n ROWS ONLY' : 'TOP n'}.`);
  if (/\bFETCH\s+FIRST\b/i.test(c) && (dialect === 'MySQL' || dialect === 'SQL Server')) df.push(`FETCH FIRST … ROWS ONLY is not valid in ${dialect} — use ${dialect === 'MySQL' ? 'LIMIT n' : 'TOP n'}.`);
  if (/\bSELECT\s+(?:DISTINCT\s+)?TOP\s+\d+/i.test(c) && dialect !== 'SQL Server') df.push(`TOP n is only valid in SQL Server — use ${dialect === 'Oracle' ? 'FETCH FIRST n ROWS ONLY' : 'LIMIT n'}.`);
  if (/\bFULL\s+(?:OUTER\s+)?JOIN\b/i.test(c) && dialect === 'MySQL') df.push('FULL JOIN is not supported by MySQL.');
  if (/\bILIKE\b/i.test(c) && dialect !== 'PostgreSQL') df.push(`ILIKE is only valid in PostgreSQL.`);
  if (/\bROWNUM\b/i.test(c) && dialect !== 'Oracle') df.push('ROWNUM is only valid in Oracle.');
  if (/\bWITH\s+RECURSIVE\b/i.test(c) && (dialect === 'Oracle' || dialect === 'SQL Server')) df.push(`${dialect} does not use the RECURSIVE keyword — remove it.`);
  if (/`/.test(c) && dialect !== 'MySQL') dw.push('Back-quoted names are MySQL syntax.'); if (/\[[A-Za-z_][\w ]*\]/.test(c) && dialect !== 'SQL Server') dw.push('[bracketed] names are SQL Server syntax.');
  if (/\bDATE\s+'\d{4}-/i.test(sql) && dialect === 'SQL Server') df.push("DATE 'yyyy-mm-dd' literals are not valid in SQL Server — use CAST('yyyy-mm-dd' AS DATE).");
  if (/\bINTERVAL\s+'\d+\s+\w+'/i.test(sql) && (dialect === 'Oracle' || dialect === 'SQL Server')) dw.push(`INTERVAL 'n UNIT' arithmetic is PostgreSQL syntax — it may not work in ${dialect}.`);
  add('dialect', `Compatible with ${dialect}`, df, dw);

  // 11 unresolved entities
  const uniq = Array.from(new Set(unresolved)); add('unresolved', 'No unresolved entities', [], uniq.map((u) => `Not resolved from the Active Schema: ${u}.`));

  // 12 destructive / unsafe SQL
  const xf: string[] = []; const up = ` ${U(c)} `; DESTRUCTIVE.forEach((k) => { if (new RegExp(`(^|[^A-Z_$#])${k.replace(' ', '\\s+')}([^A-Z_$#]|$)`).test(up)) xf.push(`Destructive or non-SELECT statement detected: ${k}.`); });
  if (/\bINTO\s+(?:OUTFILE|DUMPFILE|TABLE|#?[A-Za-z_])/i.test(c) && /\bSELECT\b[\s\S]*\bINTO\b/i.test(c)) xf.push('SELECT … INTO writes data and is not allowed.');
  if (/\bFOR\s+UPDATE\b/i.test(c)) xf.push('FOR UPDATE locks rows and is not allowed.'); if (DANGEROUS_FN.test(c)) xf.push('A function that reaches outside the query (files, network, OS, sleep) is not allowed.');
  add('destructive', 'Read-only — no destructive SQL', xf);

  const errors = checks.filter((x) => x.status === 'fail').flatMap((x) => x.details); const warnings = checks.filter((x) => x.status === 'warn').flatMap((x) => x.details);
  return { valid: !errors.length, checks, errors, warnings, unresolved: uniq };
}
export const summarizeValidation = (v: FullValidation): string => `${v.checks.filter((c) => c.status === 'pass').length}/${v.checks.length} checks passed${v.errors.length ? `, ${v.errors.length} problem(s)` : ''}${v.warnings.length ? `, ${v.warnings.length} note(s)` : ''}`;
