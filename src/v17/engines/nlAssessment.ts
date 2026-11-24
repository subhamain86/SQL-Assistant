/**
 * V17.7.2 — HONEST RESULT ASSESSMENT for "Describe What You Need" (Read Only and CR).
 *
 * Root cause of "not sufficiently accurate or useful" results (verified against the 77-table AP schema, see docs/NL_SQL_ROOT_CAUSE_V17.7.2.md):
 *   · a request that names something the engine cannot use was silently turned into a SMALLER query and shown as a success
 *     ("invoices over 1000 …" lost the amount filter, "invoices with payment terms and cost center" became SELECT *);
 *   · a table that WAS recognised but has no relationship path to the others was dropped from the SQL without a word;
 *   · "delete all invoices" came back as a plain SELECT; a description with no table came back as a placeholder comment shown as if it were SQL.
 * This module compares the description with the SQL that was actually built and decides: success | review | error.
 * It never changes the SQL and never invents a schema object — it only reports what the SQL does not reflect. Pure logic, no UI, no storage.
 */
import type { SchemaModel, ReadOnlyQueryState, CrQueryState } from '../../types';
import { getSchemaContext } from './schemaContext';
import { tokenize, stem } from './textTokens';
import { countryNameToIso2 } from './countryCodes';
import type { V17Requirement } from './nluEngine';
import { sanitize, type FullValidation } from './queryValidator';
export type NlStatus = 'success' | 'review' | 'error';
export interface NlAssessment { status: NlStatus; /** one sentence for the Result card */ headline: string; errors: string[]; warnings: string[]; /** words of the description that the SQL does not reflect */ unreflected: string[]; /** tables that were recognised but are not part of the SQL */ droppedTables: string[]; /** real tables of the Active Schema that look related to the description (only when nothing was recognised) */ suggestions: string[]; }
/** Words that carry no schema meaning: request verbs, articles, ordering / limiting / date words that the engine expresses as SQL clauses, number words. */
const NOISE = new Set(('show list give get find display select fetch return provide retrieve see view tell want need would could can please me my our us i we you the a an of for in on at to by per with without and or not no from into onto that which whose who whom where when whenever while is are was were be been being has have had do does did their its it this these those than then also only just all any every each both either other another same such some many much more most less least few fewer top bottom first last highest lowest largest smallest biggest greatest best worst higher lower greater bigger smaller over under above below between within during since before after until till ago past previous current next latest recent newest oldest earliest ordered order sorted sort ordering ascending descending asc desc group grouped grouping count counts number numbers total totals sum sums average avg mean max maximum min minimum distinct unique different how what why entries entry records record rows row data details detail information info along including include includes included plus using use used based like contain contains containing containing starts start starting begins named called equal equals equal exactly about related regarding concerning respective respectively day days week weeks month months year years today yesterday tomorrow now date dates time quarter hour hours minute minutes one two three four five six seven eight nine ten hundred thousand million percent').split(/\s+/));
const NUMWORD: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
/** A leading verb (or a clear statement form) that asks for a data change. The Read Only builder produces SELECT / WITH only. */
const WRITE_LEAD = /^\s*(?:please\s+|kindly\s+|can you\s+|could you\s+|i\s+(?:want|need)\s+to\s+|let'?s\s+)?(delete|remove|drop|truncate|update|insert|alter|create|modify|rename|grant|revoke|merge|upsert|change|set)\b/i;
const WRITE_ANY = /\b(delete\s+from|drop\s+(?:table|view|schema)|truncate\s+table|insert\s+into|update\s+[a-z_][\w$#]*\s+set|alter\s+table)\b/i;
/** The verb that makes the description a data-change request, or null. */
export function detectWriteIntent(text: string): string | null { const m = String(text ?? '').match(WRITE_LEAD); if (m) return m[1].toLowerCase(); const a = String(text ?? '').match(WRITE_ANY); return a ? a[1].toLowerCase().split(/\s+/)[0] : null; }
const words = (t: string): string[] => String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
const withStems = (ws: string[]): Set<string> => { const s = new Set<string>(); ws.forEach((w) => { s.add(w); s.add(stem(w)); }); return s; };
/** Real tables of the Active Schema whose name / description / column names share words with the description (never an invented name). */
export function suggestTables(text: string, schema: SchemaModel, n = 3): string[] {
  const req = tokenize(text).filter((w) => !NOISE.has(w)); if (!req.length) return [];
  return schema.tables.map((t) => { const doc = new Set(tokenize(`${t.name} ${t.description || ''} ${t.columns.map((c) => `${c.name} ${c.label || ''}`).join(' ')}`)); const own = new Set(tokenize(`${t.name} ${t.description || ''}`)); return { t: t.name, s: req.filter((w) => doc.has(w)).length + req.filter((w) => own.has(w)).length }; })
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.t.localeCompare(b.t)).slice(0, n).map((x) => x.t);
}
/** Content words of the description that the built SQL does not reflect (see NOISE for what is deliberately ignored). */
export function unreflectedWords(text: string, sql: string, notes: string[], tableNames: string[], schema: SchemaModel): string[] {
  const ctx = getSchemaContext(schema); const cover = withStems([...words(sql), ...words(notes.join(' '))]);
  tableNames.forEach((t) => { const e = ctx.tableUpper.get(t.toUpperCase()); if (e) e.phrases.forEach((p) => withStems(words(p)).forEach((w) => cover.add(w))); });
  // a column that is part of the SQL also covers the other names the user may call it (GROSS_SUM = "gross amount" / "gross value" / "gross total" — schemaContext phrases)
  const flat = sql.replace(/'(?:[^']|'')*'/g, "''"); ctx.columns.forEach((c) => { if (inSql(flat, `${c.table}.${c.column.name}`)) c.phrases.forEach((p) => withStems(words(p)).forEach((w) => cover.add(w))); });
  const out: string[] = []; const seen = new Set<string>();
  for (const w of words(text)) {
    if (seen.has(w)) continue; seen.add(w); const isNum = /^\d+$/.test(w); if (NOISE.has(w) || NOISE.has(stem(w))) continue; if (!isNum && w.length < 3) continue;
    if (cover.has(w) || cover.has(stem(w))) continue; if (NUMWORD[w] && cover.has(NUMWORD[w])) continue;
    const iso = !isNum ? countryNameToIso2(w) : null; if (iso && cover.has(iso.toLowerCase())) continue; out.push(w);
  }
  return out;
}
const inSql = (sql: string, t: string) => new RegExp(`(^|[^A-Za-z0-9_$#])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_$#])`, 'i').test(sql.replace(/'(?:[^']|'')*'/g, "''"));
/**
 * Qualifiers (X in X.Y) of a statement that are neither a table / view of the schema nor an alias / CTE / sub-select alias defined in the statement. V17.7.2: validateFinalQuery accepted
 * "SELECT FOO.BAR FROM IA_INVOICE" — a reference to something that does not exist in the statement — so SQL from the AI/LLM Model (and any description result) is also checked here.
 */
export function unknownQualifiers(sql: string, schema: SchemaModel): string[] {
  const t = sanitize(String(sql ?? '')); const known = new Set<string>(schema.tables.map((x) => x.name.toUpperCase()));
  for (const m of t.matchAll(/\b(?:FROM|JOIN)\s+(?:ONLY\s+)?(?:[A-Za-z_][\w$#]*\.)?([A-Za-z_][\w$#]*)(?:\s+(?:AS\s+)?([A-Za-z_][\w$#]*))?/gi)) { known.add(m[1].toUpperCase()); if (m[2] && !/^(WHERE|ON|INNER|LEFT|RIGHT|FULL|CROSS|NATURAL|JOIN|GROUP|ORDER|HAVING|UNION|LIMIT|FETCH|OFFSET|USING|SET|SELECT|AND|OR|WINDOW|OUTER)$/i.test(m[2])) known.add(m[2].toUpperCase()); }
  for (const m of t.matchAll(/\b([A-Za-z_][\w$#]*)\s*(?:\([^()]*\))?\s+AS\s*\(/gi)) known.add(m[1].toUpperCase()); // WITH name AS (
  for (const m of t.matchAll(/\)\s*(?:AS\s+)?([A-Za-z_][\w$#]*)(?=\s*(?:,|\bON\b|\bWHERE\b|\bJOIN\b|\bINNER\b|\bLEFT\b|\bRIGHT\b|\bFULL\b|\bCROSS\b|\bGROUP\b|\bORDER\b|\bUNION\b|\)|;|$))/gi)) known.add(m[1].toUpperCase()); // (SELECT …) alias
  const bad = new Set<string>(); const fromTail = (i: number) => /\b(?:FROM|JOIN)\s+(?:ONLY\s+)?$/i.test(t.slice(Math.max(0, i - 20), i));
  for (const m of t.matchAll(/(?<![A-Za-z0-9_$#.])([A-Za-z_][\w$#]*)\.([A-Za-z_*][\w$#]*)/g)) { if (fromTail(m.index || 0)) continue; if (!known.has(m[1].toUpperCase())) bad.add(m[1]); }
  return [...bad];
}
/** Read Only: description + what the engine produced → success | review | error. `sql` is the SQL that would be shown. */
export function assessReadOnly(text: string, schema: SchemaModel, req: V17Requirement, state: ReadOnlyQueryState, sql: string, validation: FullValidation, buildWarnings: string[] = []): NlAssessment {
  const errors: string[] = []; const warnings: string[] = []; let suggestions: string[] = []; const t = String(text ?? '').trim();
  const verb = detectWriteIntent(t);
  if (!t) errors.push('Enter a description of the data you need.');
  else if (verb) errors.push(`This reads like a data-change request ("${verb} …"). The Read Only Query Builder generates SELECT statements only — use Describe What You Need – Query Builder for CR for INSERT / UPDATE / DELETE.`);
  else if (!state.selectedTables.length) { errors.push(`No table or view of the Active Schema "${schema.name}" could be identified from the description, so no SQL was built.`); suggestions = suggestTables(t, schema); }
  else if (!/^\s*(WITH|SELECT)\b/i.test(sql)) errors.push('The engine did not produce a SELECT statement for this description.');
  else if (!validation.valid) errors.push(...validation.errors.slice(0, 4));
  else { const uq = unknownQualifiers(sql, schema); if (uq.length) errors.push(`The SQL refers to ${uq.map((x) => `"${x}"`).join(', ')}, which is neither a table of the Active Schema nor defined in the statement.`); }
  let dropped: string[] = []; let unreflected: string[] = [];
  if (!errors.length) {
    dropped = Array.from(new Set([...req.matchedTables, ...state.selectedTables])).filter((x) => !inSql(sql, x));
    dropped.forEach((x) => warnings.push(`${x} was recognised but is not part of the SQL: the imported schema has no relationship that joins it to the other table(s), and no join was assumed.`));
    if (req.unresolvedTerms.length) warnings.push(`Not found in the Active Schema (not added to the SQL): ${req.unresolvedTerms.join(', ')}.`);
    unreflected = unreflectedWords(t, sql, req.autoOptions.map((a) => a.description), [...state.selectedTables], schema).filter((w) => !req.unresolvedTerms.some((g) => words(g).includes(w)));
    if (unreflected.length) warnings.push(`Parts of the description are not reflected in the SQL: ${unreflected.slice(0, 8).join(', ')}${unreflected.length > 8 ? ', …' : ''}. Check the SQL before using it, or rephrase with table / column names from the Active Schema.`);
    buildWarnings.forEach((w) => { if (!warnings.includes(w)) warnings.push(w); });
    // the validator repeats the unresolved terms in its own words — say it once
    validation.warnings.filter((w) => !req.unresolvedTerms.some((g) => w.toLowerCase().includes(g.toLowerCase()))).slice(0, 3).forEach((w) => { if (!warnings.includes(w)) warnings.push(w); });
  }
  const status: NlStatus = errors.length ? 'error' : (dropped.length || unreflected.length || req.unresolvedTerms.length) ? 'review' : 'success';
  const headline = status === 'success' ? 'SQL generated and validated against the Active Schema.' : status === 'review' ? 'SQL generated, but it does not cover everything you described — review it before use.' : errors[0];
  return { status, headline, errors, warnings, unreflected, droppedTables: dropped, suggestions };
}
export interface CrParse { queryType: CrQueryState['queryType'] | null; table: string | null; values: CrQueryState['values']; filters: CrQueryState['filters']; notes: string[]; /** assignments / conditions that name a column the chosen table does not have */ unknownColumns?: string[]; /** a typed value that is not one of the column's defined decode values (used as typed) */ valueWarnings?: string[]; /** the description names a view (DML on a view is not offered) */ viewRejected?: string | null; }
/** CR: description + parse + generated SQL → success | review | error. A comment such as "-- A WHERE condition is required" is never shown as a successful result. */
export function assessCr(text: string, schema: SchemaModel, p: CrParse, sql: string): NlAssessment {
  const errors: string[] = []; const warnings: string[] = []; let suggestions: string[] = []; const t = String(text ?? '').trim();
  if (!t) errors.push('Enter a description of the change you need.');
  else if (!p.queryType) errors.push('Could not tell whether this is an INSERT, UPDATE or DELETE. Start with the action, for example "Update invoice 1234 set status to Approved". For SELECT statements use Describe What You Need – Read Only Query Builder.');
  else if (p.viewRejected) errors.push(`${p.viewRejected} is a view in the Active Schema; INSERT / UPDATE / DELETE statements are only generated for tables.`);
  else if (!p.table) { errors.push(`No table of the Active Schema "${schema.name}" could be identified from the description, so no SQL was built.`); suggestions = suggestTables(t, schema).filter((x) => schema.tables.find((y) => y.name === x)?.objectType !== 'VIEW'); }
  else {
    if (p.queryType !== 'DELETE' && !p.values.length) errors.push(`No column value was found for ${p.table}. Write it as "<column> to <value>" or "<column> = <value>" using a column of ${p.table}.`);
    if (p.queryType !== 'INSERT' && !p.filters.length) errors.push(`${p.queryType} needs a WHERE condition to identify the records (for example "where STATUS = 'A'" or "invoice 1234"). SQL Assistant never generates an unrestricted ${p.queryType} from a description.`);
    if (!errors.length && !/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) errors.push(sql.replace(/^--\s*/, '').split('\n')[0] || 'The engine did not produce a statement for this description.');
  }
  (p.unknownColumns || []).forEach((c) => warnings.push(`"${c}" is not a column of ${p.table || 'the table'} and was not used.`)); (p.valueWarnings || []).forEach((w) => warnings.push(w));
  const status: NlStatus = errors.length ? 'error' : warnings.length ? 'review' : 'success';
  const headline = status === 'success' ? `${p.queryType} statement generated from the Active Schema.` : status === 'review' ? 'Statement generated, but part of the description was not used — review it before use.' : errors[0];
  return { status, headline, errors, warnings, unreflected: [], droppedTables: [], suggestions };
}
