/**
 * Centralized, controlled self-training ("learned query knowledge") for the offline NLU.
 *  - Deterministic: requests are normalised (literals/numbers/dates → placeholders, stop-words removed,
 *    tokens sorted); the record id is a hash of schema + normalised request, so duplicates merge.
 *  - Only REPEATED or CONFIRMED patterns become hints; every hint is re-validated against the CURRENT
 *    Active Schema and is ignored if it references a deleted table/column (the Active Schema always wins).
 *  - Accepted SQL must pass the read-only, structural and Active Schema checks before it is learned.
 *  - Secrets, credentials and tokens are never learned (requests/SQL containing them are refused).
 *  - Cross-device merge uses per-device counters (G-counter), so merging is idempotent.
 */
import type { SchemaModel } from '../../types';
import { validateReadOnlySql, validateSqlStructure } from '../../engines/validationEngine';
import { validateSqlAgainstSchema, parseTableAliases } from '../../engines/sqlSchemaValidator';
import type { LearnedHint } from '../engines/nluEngine';
import { NLU_ENGINE_VERSION } from '../engines/nluEngine';
import { schemaFingerprint } from '../engines/schemaContext';
import { makeError, containsSecret, type AppError } from '../errors/appErrors';
export const LEARNING_STORAGE_KEY = 'sqla.learning.v17';
export const LEARNING_REPO_PATH = 'sql-assistant-data/learning/query-knowledge.json';
const MAX_RECORDS = 400;
export interface EventCounters { generated: number; modified: number; accepted: number; used: number; }
export interface LearningOptions { distinct?: boolean; limit?: number | null; groupBy?: string[]; having?: string; sorts?: { table: string; column: string; direction: 'ASC' | 'DESC' }[]; dialect?: string; }
/** V17.2 — structural features of an example, extracted deterministically from the SQL. */
export interface SqlFeatures { joins: string[]; filters: string[]; sorts: string[]; groupBy: string[]; aggregates: string[]; dateLogic: string[]; distinct: boolean; limit: boolean; }
export type LearningOutcome = 'generated' | 'modified' | 'accepted';
export interface LearningRecord {
  id: string; schemaKey: string; schemaName: string; nlText: string; tokens: string[]; generatedSql: string; modifiedSql: string | null; finalSql: string | null;
  tables: string[]; columns: { table: string; column: string }[]; options: LearningOptions; counters: Record<string, EventCounters>; schemaValid: boolean; firstSeen: string; lastSeen: string;
  schemaFingerprint?: string; schemaVersion?: string; engineVersion?: string; features?: SqlFeatures; outcome?: LearningOutcome; corrections?: string[];
}
export interface LearningFile { format: 'sqla-learning'; version: 1; updatedAt: string; records: LearningRecord[]; }
export type LearningStatus = 'observed' | 'repeated' | 'confirmed';
export interface StorageAdapter { get(key: string): string | null; set(key: string, value: string): void; }
const STOP = new Set(['the', 'a', 'an', 'show', 'me', 'all', 'get', 'find', 'list', 'give', 'please', 'with', 'and', 'or', 'for', 'of', 'in', 'on', 'to', 'from', 'that', 'this', 'is', 'are', 'was', 'were', 'by', 'who', 'which', 'each', 'their', 'its', 'i', 'need', 'want', 'what', 'display', 'fetch', 'return', 'them']);
export function normalizeRequest(text: string): { normalized: string; tokens: string[] } {
  const t = text.toLowerCase()
    .replace(/(['"“‘])[^'"”’]{0,80}\1|['"“‘][^'"”’]{0,80}['"”’]/g, ' <str> ')
    .replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\b/g, ' <date> ')
    .replace(/\b\d+(?:[.,]\d+)*\b/g, ' <num> ').replace(/_/g, ' ').replace(/[^a-z0-9<> ]+/g, ' ');
  const tokens = Array.from(new Set(t.split(/\s+/).filter((w) => w && !STOP.has(w)).map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)))).sort();
  return { normalized: tokens.join(' '), tokens };
}
function hash(s: string): string { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); }
export function schemaKeyOf(schema: Pick<SchemaModel, 'name'>): string { return schema.name.trim().toLowerCase(); }
function total(r: LearningRecord): EventCounters { return Object.values(r.counters).reduce((a, c) => ({ generated: a.generated + c.generated, modified: a.modified + c.modified, accepted: a.accepted + c.accepted, used: a.used + c.used }), { generated: 0, modified: 0, accepted: 0, used: 0 }); }
export function statusOf(r: LearningRecord): LearningStatus { const t = total(r); if (t.accepted >= 1 && r.schemaValid) return 'confirmed'; if (t.generated + t.used + t.modified >= 2 && r.schemaValid) return 'repeated'; return 'observed'; }
export function weightOf(r: LearningRecord): number { const t = total(r); return t.accepted * 3 + t.modified + t.used + t.generated; }
function jaccard(a: string[], b: string[]): number { if (!a.length || !b.length) return 0; const A = new Set(a); const inter = b.filter((x) => A.has(x)).length; return inter / (A.size + b.length - inter); }
const clean = (sql: string) => sql.replace(/--.*$/gm, ' ').replace(/'(?:[^']|'')*'/g, "''");
/** Deterministic feature extraction (no SQL execution). */
export function extractSqlFeatures(sql: string): SqlFeatures {
  const c = clean(sql); const U = c.toUpperCase();
  const clause = (kw: string, stops: string[]) => { const m = U.match(new RegExp(`\\b${kw}\\b([\\s\\S]*?)(?=\\b(?:${stops.join('|')})\\b|;|$)`)); return m ? m[1].trim() : ''; };
  const where = clause('WHERE', ['GROUP\\s+BY', 'HAVING', 'ORDER\\s+BY', 'FETCH', 'LIMIT']);
  const filters = where ? where.split(/\s+(?:AND|OR)\s+(?![^(]*\))/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 20) : [];
  return {
    joins: [...U.matchAll(/\b((?:INNER|LEFT|RIGHT|FULL)?\s*JOIN)\s+([A-Z_][A-Z0-9_$#]*)/g)].map((m) => `${m[1].trim()} ${m[2]}`),
    filters, sorts: clause('ORDER\\s+BY', ['FETCH', 'LIMIT']).split(',').map((s) => s.trim()).filter(Boolean),
    groupBy: clause('GROUP\\s+BY', ['HAVING', 'ORDER\\s+BY', 'FETCH', 'LIMIT']).split(',').map((s) => s.trim()).filter(Boolean),
    aggregates: [...U.matchAll(/\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/g)].map((m) => m[1]),
    dateLogic: filters.filter((f) => /DATE|SYSDATE|GETDATE|CURDATE|INTERVAL|TRUNC|DATEADD/.test(f)),
    distinct: /\bSELECT\s+(?:TOP\s+\d+\s+)?DISTINCT\b/.test(U), limit: /\b(LIMIT|FETCH\s+FIRST|TOP)\b/.test(U)
  };
}
export function analyzeSqlAgainstSchema(sql: string, schema: SchemaModel): { tables: string[]; columns: { table: string; column: string }[]; valid: boolean; problems: string[] } {
  const problems: string[] = [];
  validateReadOnlySql(sql).issues.filter((i) => i.severity === 'error').forEach((i) => problems.push(i.message));
  validateSqlStructure(sql).filter((i) => i.severity === 'error').forEach((i) => problems.push(i.message));
  problems.push(...validateSqlAgainstSchema(sql, schema).warnings.filter((w) => !/^Unknown table or alias/.test(w)));
  const cleaned = clean(sql);
  const known = new Map(schema.tables.map((t) => [t.name.toUpperCase(), t] as const));
  const { aliases } = parseTableAliases(sql);
  const tables = Array.from(new Set([...cleaned.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)/gi)].map((m) => m[1].toUpperCase()).filter((t) => known.has(t)).map((t) => known.get(t)!.name)));
  const columns: { table: string; column: string }[] = [];
  [...cleaned.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g)].forEach((m) => { const t = known.get((aliases.get(m[1].toUpperCase()) || m[1]).toUpperCase()); const c = t?.columns.find((x) => x.name.toUpperCase() === m[2].toUpperCase()); if (t && c && !columns.some((k) => k.table === t.name && k.column === c.name)) columns.push({ table: t.name, column: c.name }); });
  return { tables, columns, valid: problems.length === 0 && tables.length > 0, problems };
}
export function maskSqlLiterals(sql: string | null): string | null { return sql === null ? null : sql.replace(/'(?:[^']|'')*'/g, "'?'"); }
const memoryStorage = (): StorageAdapter => { const m = new Map<string, string>(); return { get: (k) => m.get(k) ?? null, set: (k, v) => { m.set(k, v); } }; };
const defaultStorage = (): StorageAdapter => (typeof localStorage !== 'undefined' ? { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) } : memoryStorage());
/** Reusable options learned from the user's FINAL SQL (sort order, DISTINCT, limit), resolved through table aliases. */
export function deriveOptionsFromSql(sql: string, schema: SchemaModel, dialect?: string): LearningOptions {
  const c = clean(sql); const { aliases } = parseTableAliases(sql); const known = new Map(schema.tables.map((t) => [t.name.toUpperCase(), t] as const));
  const order = c.match(/\bORDER\s+BY\s+([\s\S]*?)(?=\bFETCH\b|\bLIMIT\b|;|$)/i);
  const sorts: { table: string; column: string; direction: 'ASC' | 'DESC' }[] = [];
  (order ? order[1].split(',') : []).forEach((part) => { const m = part.trim().match(/^([A-Za-z_][A-Za-z0-9_$#]*)\.([A-Za-z_][A-Za-z0-9_$#]*)(?:\s+(ASC|DESC))?$/i); if (!m) return; const t = known.get((aliases.get(m[1].toUpperCase()) || m[1]).toUpperCase()); const col = t?.columns.find((x) => x.name.toUpperCase() === m[2].toUpperCase()); if (t && col) sorts.push({ table: t.name, column: col.name, direction: (m[3] || 'ASC').toUpperCase() as 'ASC' | 'DESC' }); });
  const lim = c.match(/\bLIMIT\s+(\d+)|\bFETCH\s+FIRST\s+(\d+)|\bTOP\s+(\d+)/i);
  return { sorts, distinct: extractSqlFeatures(sql).distinct, limit: lim ? Number(lim[1] || lim[2] || lim[3]) : null, ...(dialect ? { dialect } : {}) };
}
function diffSummary(a: string, b: string): string[] {
  const fa = extractSqlFeatures(a); const fb = extractSqlFeatures(b); const out: string[] = [];
  (['joins', 'filters', 'sorts', 'groupBy', 'aggregates'] as const).forEach((k) => { const add = fb[k].filter((x) => !fa[k].includes(x)); const rem = fa[k].filter((x) => !fb[k].includes(x)); add.forEach((x) => out.push(`added ${k}: ${x}`)); rem.forEach((x) => out.push(`removed ${k}: ${x}`)); });
  if (fa.distinct !== fb.distinct) out.push(fb.distinct ? 'added DISTINCT' : 'removed DISTINCT');
  return out.slice(0, 20);
}
export class LearningStore {
  private records: LearningRecord[] = []; private listeners = new Set<() => void>(); private lastError: AppError | null = null;
  constructor(private storage: StorageAdapter = defaultStorage(), private deviceTag: () => string = () => 'device-local') { this.load(); }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  getLastError(): AppError | null { return this.lastError; }
  private load(): void {
    try { const raw = this.storage.get(LEARNING_STORAGE_KEY); if (!raw) return; const parsed = JSON.parse(raw) as LearningFile; if (parsed?.format === 'sqla-learning' && Array.isArray(parsed.records)) this.records = parsed.records.filter(isValidRecord).filter((r) => !recordHasSecret(r)); }
    catch { this.lastError = makeError('LEARNING_STORE_FAILED', 'Stored learned query knowledge was unreadable and has been ignored (the schema and application data are unaffected).'); this.records = []; }
  }
  private persist(): AppError | null {
    this.prune();
    try { this.storage.set(LEARNING_STORAGE_KEY, JSON.stringify(this.toFile(false))); this.lastError = null; }
    catch (e) { this.lastError = makeError('LEARNING_STORE_FAILED', `Learned query knowledge could not be written to browser storage: ${(e as Error)?.message || 'storage write rejected'}. SQL generation is unaffected.`); }
    this.listeners.forEach((l) => l()); return this.lastError;
  }
  private prune(): void { if (this.records.length <= MAX_RECORDS) return; this.records.sort((a, b) => weightOf(b) - weightOf(a) || b.lastSeen.localeCompare(a.lastSeen)); this.records = this.records.slice(0, MAX_RECORDS); }
  private bump(r: LearningRecord, field: keyof EventCounters): void { const d = this.deviceTag(); const c = r.counters[d] || (r.counters[d] = { generated: 0, modified: 0, accepted: 0, used: 0 }); c[field] += 1; r.lastSeen = new Date().toISOString(); }
  all(): LearningRecord[] { return this.records.map((r) => ({ ...r })); }
  get(id: string): LearningRecord | undefined { return this.records.find((r) => r.id === id); }
  stats(): { total: number; confirmed: number; repeated: number; observed: number } { const s = { total: this.records.length, confirmed: 0, repeated: 0, observed: 0 }; this.records.forEach((r) => { s[statusOf(r)] += 1; }); return s; }
  recordGeneration(input: { nlText: string; schema: SchemaModel; generatedSql: string; options?: LearningOptions }): { id: string | null; error: AppError | null } {
    if (containsSecret(input.nlText) || containsSecret(input.generatedSql)) return { id: null, error: makeError('LEARNING_STORE_FAILED', 'This request was not recorded as learning material because it appears to contain a credential, token or password.') };
    const { normalized, tokens } = normalizeRequest(input.nlText);
    if (!tokens.length || !input.generatedSql.trim() || (input.generatedSql.trim().startsWith('--') && !/\bSELECT\b/i.test(input.generatedSql))) return { id: null, error: null };
    if (!validateReadOnlySql(input.generatedSql).valid) return { id: null, error: null };
    const key = schemaKeyOf(input.schema); const id = `lp_${hash(`${key}|${normalized}`)}`;
    const analysis = analyzeSqlAgainstSchema(input.generatedSql, input.schema);
    let r = this.records.find((x) => x.id === id); const now = new Date().toISOString();
    const meta = { schemaFingerprint: schemaFingerprint(input.schema), schemaVersion: String(input.schema.versionMeta?.version ?? input.schema.version), engineVersion: NLU_ENGINE_VERSION };
    if (!r) { r = { id, schemaKey: key, schemaName: input.schema.name, nlText: input.nlText.trim().slice(0, 500), tokens, generatedSql: input.generatedSql, modifiedSql: null, finalSql: null, tables: analysis.tables, columns: analysis.columns, options: input.options || {}, counters: {}, schemaValid: analysis.valid, firstSeen: now, lastSeen: now, ...meta, features: extractSqlFeatures(input.generatedSql), outcome: 'generated' }; this.records.push(r); }
    else if (!r.finalSql) { Object.assign(r, meta); r.generatedSql = input.generatedSql; r.tables = analysis.tables; r.columns = analysis.columns; r.options = input.options || r.options; r.schemaValid = analysis.valid; r.features = extractSqlFeatures(input.generatedSql); }
    this.bump(r, 'generated');
    return { id, error: this.persist() };
  }
  recordAcceptance(id: string, finalSql: string, schema: SchemaModel, options?: LearningOptions): { ok: boolean; error: AppError | null; status?: LearningStatus } {
    const r = this.get(id);
    if (!r) return { ok: false, error: makeError('LEARNING_STORE_FAILED', 'This query was not generated from a description in this session, so there is no request to learn it against. Use "Build from Description" first.') };
    if (containsSecret(finalSql)) return { ok: false, error: makeError('LEARNING_STORE_FAILED', 'The accepted SQL appears to contain a credential, token or password, so it was not stored as learned knowledge.') };
    const analysis = analyzeSqlAgainstSchema(finalSql, schema);
    if (!analysis.valid) return { ok: false, error: makeError('SQL_VALIDATION_FAILED', 'The accepted SQL was not stored as learned knowledge because it did not pass validation against the Active Schema.', analysis.problems.length ? analysis.problems : ['No table from the Active Schema was found in the SQL.']) };
    if (normalizeSql(finalSql) !== normalizeSql(r.generatedSql)) { r.modifiedSql = finalSql; r.corrections = diffSummary(r.generatedSql, finalSql); r.outcome = 'modified'; this.bump(r, 'modified'); } else r.outcome = 'accepted';
    r.finalSql = finalSql; r.tables = analysis.tables; r.columns = analysis.columns; r.schemaValid = true; r.schemaKey = schemaKeyOf(schema); r.schemaName = schema.name; r.options = options ?? { ...r.options, ...deriveOptionsFromSql(finalSql, schema, r.options.dialect) };
    r.features = extractSqlFeatures(finalSql); r.schemaFingerprint = schemaFingerprint(schema); r.schemaVersion = String(schema.versionMeta?.version ?? schema.version); r.engineVersion = NLU_ENGINE_VERSION;
    this.bump(r, 'accepted');
    const error = this.persist();
    return { ok: !error, error, status: statusOf(r) };
  }
  recordUse(sql: string): void { const n = normalizeSql(sql); const r = this.records.slice().sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)).find((x) => normalizeSql(x.finalSql || x.generatedSql) === n); if (r) { this.bump(r, 'used'); this.persist(); } }
  remove(id: string): void { this.records = this.records.filter((r) => r.id !== id); this.persist(); }
  clear(): void { this.records = []; this.persist(); }
  /** Hints for the CURRENT Active Schema only; patterns that reference deleted tables/columns are skipped (the request is then re-evaluated from the schema alone). */
  findHints(nlText: string, schema: SchemaModel, minSimilarity = 0.6): LearnedHint[] {
    const { tokens } = normalizeRequest(nlText); const key = schemaKeyOf(schema);
    const tableSet = new Set(schema.tables.map((t) => t.name));
    return this.records.filter((r) => r.schemaKey === key && statusOf(r) !== 'observed')
      .filter((r) => r.tables.every((t) => tableSet.has(t)) && r.columns.every((c) => schema.tables.find((t) => t.name === c.table)?.columns.some((x) => x.name === c.column)))
      .map((r) => ({ r, sim: jaccard(r.tokens, tokens) })).filter((x) => x.sim >= minSimilarity)
      .sort((a, b) => b.sim * weightOf(b.r) - a.sim * weightOf(a.r)).slice(0, 3)
      .map(({ r, sim }) => ({ patternId: r.id, similarity: sim, status: statusOf(r) as 'repeated' | 'confirmed', weight: weightOf(r), tables: [...r.tables], columns: r.columns.map((c) => ({ ...c })), options: { distinct: r.options.distinct, limit: r.options.limit ?? null, sorts: r.options.sorts } }));
  }
  toFile(maskLiterals: boolean): LearningFile {
    return { format: 'sqla-learning', version: 1, updatedAt: new Date().toISOString(), records: this.records.map((r) => maskLiterals ? { ...r, nlText: r.nlText.replace(/(['"“‘])[^'"”’]*\1/g, '<value>').replace(/\b\d{4,}\b/g, '<value>'), generatedSql: maskSqlLiterals(r.generatedSql)!, modifiedSql: maskSqlLiterals(r.modifiedSql), finalSql: maskSqlLiterals(r.finalSql) } : r) };
  }
  merge(file: unknown): { added: number; updated: number; error: AppError | null } {
    if (!file || typeof file !== 'object' || (file as LearningFile).format !== 'sqla-learning' || !Array.isArray((file as LearningFile).records)) return { added: 0, updated: 0, error: makeError('REPOSITORY_SYNC_FAILED', 'The learned query knowledge file in the repository is not in the expected format and was ignored.') };
    let added = 0, updated = 0;
    (file as LearningFile).records.filter(isValidRecord).filter((r) => !recordHasSecret(r)).forEach((inc) => {
      const local = this.records.find((r) => r.id === inc.id);
      if (!local) { this.records.push(JSON.parse(JSON.stringify(inc))); added += 1; return; }
      let changed = false;
      Object.entries(inc.counters).forEach(([dev, c]) => { const l = local.counters[dev] || (local.counters[dev] = { generated: 0, modified: 0, accepted: 0, used: 0 }); (Object.keys(c) as (keyof EventCounters)[]).forEach((k) => { if ((c[k] || 0) > l[k]) { l[k] = c[k]; changed = true; } }); });
      if (inc.lastSeen > local.lastSeen && inc.finalSql && !/'\?'/.test(inc.finalSql)) { local.finalSql = inc.finalSql; local.tables = inc.tables; local.columns = inc.columns; local.options = inc.options; local.schemaValid = inc.schemaValid; local.features = inc.features; changed = true; }
      if (inc.lastSeen > local.lastSeen) local.lastSeen = inc.lastSeen;
      if (changed) updated += 1;
    });
    return { added, updated, error: this.persist() };
  }
}
function normalizeSql(s: string): string { return s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').replace(/;\s*$/, '').trim().toUpperCase(); }
function recordHasSecret(r: LearningRecord): boolean { return containsSecret(`${r.nlText}\n${r.generatedSql}\n${r.modifiedSql ?? ''}\n${r.finalSql ?? ''}`); }
function isValidRecord(r: unknown): r is LearningRecord { const x = r as LearningRecord; return !!x && typeof x.id === 'string' && Array.isArray(x.tokens) && Array.isArray(x.tables) && Array.isArray(x.columns) && typeof x.counters === 'object' && typeof x.schemaKey === 'string'; }
export interface RepoFileApi { getFile(repo: string, branch: string, path: string, token: string): Promise<{ content: string; sha: string } | null>; putFile(repo: string, branch: string, path: string, token: string, content: string, message: string, sha: string | null): Promise<{ sha: string }>; }
export async function pullLearning(store: LearningStore, api: RepoFileApi, repo: string, branch: string, token: string): Promise<{ added: number; updated: number; error: AppError | null }> {
  try { const f = await api.getFile(repo, branch, LEARNING_REPO_PATH, token); if (!f) return { added: 0, updated: 0, error: null }; let parsed: unknown; try { parsed = JSON.parse(f.content.replace(/^\uFEFF/, '')); } catch { return { added: 0, updated: 0, error: makeError('REPOSITORY_SYNC_FAILED', 'The learned query knowledge file in the repository is not valid JSON and was ignored (local knowledge kept).') }; } return store.merge(parsed); }
  catch (e) { return { added: 0, updated: 0, error: makeError('REPOSITORY_SYNC_FAILED', `Learned query knowledge could not be read from the repository: ${(e as { message?: string })?.message || 'request failed'}.`, undefined, [token]) }; }
}
export async function pushLearning(store: LearningStore, api: RepoFileApi, repo: string, branch: string, token: string, maskLiterals = true): Promise<{ ok: boolean; error: AppError | null }> {
  try {
    const remote = await api.getFile(repo, branch, LEARNING_REPO_PATH, token);
    if (remote) { try { store.merge(JSON.parse(remote.content.replace(/^\uFEFF/, ''))); } catch { /* unreadable remote file is replaced by a valid one */ } }
    await api.putFile(repo, branch, LEARNING_REPO_PATH, token, JSON.stringify(store.toFile(maskLiterals), null, 2), `Update learned query knowledge (${new Date().toISOString()})`, remote?.sha ?? null);
    return { ok: true, error: null };
  } catch (e) { return { ok: false, error: makeError('REPOSITORY_SYNC_FAILED', `Learned query knowledge could not be pushed to the repository: ${(e as { message?: string })?.message || 'request failed'}.`, undefined, [token]) }; }
}
