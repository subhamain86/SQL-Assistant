/**
 * V17.0 — "Describe What You Need" processing pipeline.
 *  1. User enters a requirement.
 *  2. Offline NLU processes it against the CURRENT Active Schema.
 *  3. Confirmed / repeated learned patterns are considered (hints only).
 *  4. If an AI / LLM Model is configured AND enabled, it is consulted as an additional layer.
 *  5. All SQL is validated (read-only safety + Active Schema).
 *  6. The final SQL is presented; 7. user acceptance feeds controlled learning.
 * The offline path never depends on the network and always produces the base result.
 */
import type { SchemaModel, ReadOnlyQueryState, TableDef } from '../../types';
import { buildSelectSQL } from '../../engines/sqlEngine';
import { validateReadOnlySql } from '../../engines/validationEngine';
import { validateSqlAgainstSchema } from '../../engines/sqlSchemaValidator';
import { runOfflineNlu, type V17Requirement } from '../engines/nluEngine';
import { applyV17ToState, validateAdvancedConsistency, advancedOverrides } from '../engines/advancedOptionsResolver';
import { schemaFingerprint } from '../engines/schemaContext';
import { withFkRelationships } from '../engines/joinGraph';
import { computeAutoJoinPlan } from '../../engines/joinAutoEngine';
import { callLlm, buildLlmPrompt, validateLlmConfig, type LlmModelConfig } from './llmService';
import type { LearningStore } from './learningStore';
import { makeError, type AppError } from '../errors/appErrors';

export interface DescribeDeps {
  learning?: LearningStore | null;
  llm?: { config: LlmModelConfig; apiKey: string | null; vaultLocked: boolean; fetchImpl?: typeof fetch } | null;
  online?: boolean;
  overrides?: Pick<typeof advancedOverrides, 'isManual'>;
}
export type V17EngineUsed = 'offline' | 'offline+llm';
export interface DescribeResult {
  requirement: V17Requirement; state: ReadOnlyQueryState; sql: string; llmSql: string | null; llmExplanation: string | null; usedLlmSql: boolean;
  engineUsed: V17EngineUsed; llmAttempted: boolean; llmStatus: string; errors: AppError[]; warnings: string[];
  applied: string[]; keptManual: string[]; learningId: string | null; schemaId: string; schemaFingerprint: string;
}

export function validateActiveSchema(schema: SchemaModel | null | undefined): AppError | null {
  if (!schema) return makeError('ACTIVE_SCHEMA_UNAVAILABLE', 'No Active Schema is set. Choose one in Schema → Stored Schemas (or Settings → Schema Management).');
  if (!Array.isArray(schema.tables) || schema.tables.length === 0) return makeError('ACTIVE_SCHEMA_UNAVAILABLE', `The Active Schema "${schema.name}" has no tables. Import or add tables before generating SQL.`);
  return null;
}

/** Compact, relevant slice of the Active Schema for an AI / LLM prompt. */
export function buildLlmSchemaContext(schema: SchemaModel, focusTables: string[], maxChars = 12000): string {
  const focus = new Set(focusTables);
  schema.relationships.forEach((r) => { if (focus.has(r.fromTable)) focus.add(r.toTable); if (focus.has(r.toTable)) focus.add(r.fromTable); });
  const ordered: TableDef[] = [...schema.tables.filter((t) => focusTables.includes(t.name)), ...schema.tables.filter((t) => focus.has(t.name) && !focusTables.includes(t.name)), ...schema.tables.filter((t) => !focus.has(t.name))];
  const lines: string[] = [`SCHEMA "${schema.name}" (${schema.versionMeta?.version ?? schema.version})`];
  for (const t of ordered) {
    const cols = t.columns.map((c) => `${c.name} ${c.type}${c.isPrimaryKey ? ' PK' : ''}${c.isForeignKey && c.references ? ` FK->${c.references.table}.${c.references.column}` : ''}${c.decode?.length ? ` [${c.decode.map((d) => `${d.rawValue}=${d.label}`).join(', ')}]` : ''}${c.description ? ` -- ${c.description}` : ''}`).join('; ');
    const line = `${t.objectType === 'VIEW' ? 'VIEW' : 'TABLE'} ${t.name}: ${t.description || ''} | ${cols}`;
    if (lines.join('\n').length + line.length > maxChars) { lines.push('(remaining tables omitted for size)'); break; }
    lines.push(line);
  }
  const rels = schema.relationships.filter((r) => focus.has(r.fromTable) || focus.has(r.toTable)).map((r) => `${r.fromTable}.${r.fromColumn} = ${r.toTable}.${r.toColumn}`);
  if (rels.length) lines.push(`RELATIONSHIPS: ${rels.join('; ')}`);
  return lines.join('\n');
}

/** Validates model SQL: single read-only statement, only Active Schema tables/columns. */
export function validateLlmSql(sql: string, schema: SchemaModel): string[] {
  const problems: string[] = []; const s = sql.trim();
  if (!s) return ['The model returned no SQL.'];
  if (!/^(WITH|SELECT)\b/i.test(s)) problems.push('The model SQL does not start with SELECT or WITH.');
  if (/;\s*\S/.test(s.replace(/'(?:[^']|'')*'/g, "''").replace(/--.*$/gm, ''))) problems.push('The model SQL contains more than one statement.');
  validateReadOnlySql(s).issues.filter((i) => i.severity === 'error').forEach((i) => problems.push(i.message));
  problems.push(...validateSqlAgainstSchema(s, schema).warnings);
  return problems;
}

export async function describeWhatYouNeed(text: string, schema: SchemaModel, current: ReadOnlyQueryState, deps: DescribeDeps = {}): Promise<DescribeResult> {
  const errors: AppError[] = []; const warnings: string[] = [];
  const schemaErr = validateActiveSchema(schema);
  const fp = schema ? schemaFingerprint(schema) : '';
  if (schemaErr) {
    const req = runOfflineNlu('', schema ?? ({ id: '', name: '', version: '', status: 'active', updatedAt: '', lastSyncedAt: null, tables: [], relationships: [] } as SchemaModel), { dialect: current.dialect });
    return { requirement: req, state: current, sql: current.generatedSql, llmSql: null, llmExplanation: null, usedLlmSql: false, engineUsed: 'offline', llmAttempted: false, llmStatus: 'not used', errors: [schemaErr], warnings, applied: [], keptManual: [], learningId: null, schemaId: schema?.id ?? '', schemaFingerprint: fp };
  }
  // 2–3. offline NLU + learned hints (hints are re-validated against this schema inside both modules)
  let hints = [] as ReturnType<LearningStore['findHints']>;
  try { hints = deps.learning ? deps.learning.findHints(text, schema) : []; } catch { warnings.push('Learned query knowledge could not be read; continuing with the offline engine only.'); }
  let requirement: V17Requirement;
  try { requirement = runOfflineNlu(text, schema, { dialect: current.dialect, hints }); }
  catch (e) { errors.push(makeError('OFFLINE_MODEL_UNABLE', `The offline model could not process this description (${(e as Error)?.message || 'internal parsing error'}). Use Manual Selectors, or rephrase the request.`)); requirement = runOfflineNlu('', schema, { dialect: current.dialect }); }
  if (text.trim() && !requirement.matchedTables.length) errors.push(makeError('OFFLINE_MODEL_UNABLE', 'The offline model could not identify any table from the Active Schema in this description. Mention a table or business term (e.g. "invoices", "vendors"), or pick tables in Manual Selectors.'));
  requirement.schemaGaps.forEach((g) => errors.push(makeError(g.kind === 'table' ? 'TABLE_NOT_FOUND' : 'COLUMN_NOT_FOUND', g.kind === 'table' ? `"${g.term}" is not a table in the Active Schema "${schema.name}". No SQL was generated for it.` : `"${g.term}" could not be identified as a column in the Active Schema "${schema.name}". It was not added to the SQL.`)));

  const applied = applyV17ToState(current, requirement, deps.overrides ?? advancedOverrides);
  const state = applied.state;
  let sql = buildSelectSQL(state, schema);
  if (state.selectedTables.length > 1) {
    const explicit = new Set(state.joins.map((j) => j.table));
    const plan = computeAutoJoinPlan(withFkRelationships(schema), state.selectedTables[0], state.selectedTables.slice(1).filter((t) => !explicit.has(t)), state.joinPathChoices);
    plan.unresolvedWarnings.forEach((w) => errors.push(makeError('JOIN_PATH_NOT_FOUND', w.replace(/ — no JOIN was generated for it\.?/, '') + ' — no JOIN was generated for it. Add a relationship in Settings → Manual Schema Update, or add an explicit join.')));
    plan.resolutions.filter((r) => r.isAmbiguous && !r.chosenOptionId).forEach((r) => warnings.push(`More than one join path exists between ${r.tableA} and ${r.tableB}; choose one in Manual Selectors so the JOIN can be generated.`));
  }
  const safety = validateReadOnlySql(sql);
  if (!safety.valid) { errors.push(makeError('SQL_VALIDATION_FAILED', 'The generated statement was blocked by the read-only safety check.', safety.issues.map((i) => i.message))); sql = '-- Generated statement blocked by the read-only safety check. Refine the request or use Manual Selectors.'; }
  const schemaCheck = validateSqlAgainstSchema(sql, schema);
  if (!schemaCheck.valid) errors.push(makeError('SQL_VALIDATION_FAILED', 'The generated SQL references elements that are not in the Active Schema.', schemaCheck.warnings));
  validateAdvancedConsistency(state).forEach((i) => (i.severity === 'error' ? errors.push(makeError('SQL_VALIDATION_FAILED', i.message)) : warnings.push(i.message)));
  if (requirement.confidence < 0.5 && requirement.matchedTables.length) warnings.push('Low-confidence interpretation — review Manual Selectors before relying on this SQL.');

  // 4. optional AI / LLM layer
  let llmSql: string | null = null; let llmExplanation: string | null = null; let usedLlmSql = false; let llmAttempted = false; let llmStatus = 'not configured';
  const llm = deps.llm;
  if (llm?.config.enabled && text.trim()) {
    const needsKey = llm.config.provider !== 'custom-endpoint';
    if (needsKey && !llm.apiKey && llm.vaultLocked) llmStatus = 'configured, but the Secret Vault is locked on this device (API key unavailable) — offline engine used';
    else if (deps.online === false) llmStatus = 'browser is offline — offline engine used';
    else if (llm.config.useWhen === 'low-confidence' && requirement.confidence >= 0.7 && requirement.matchedTables.length) llmStatus = 'skipped — offline confidence was high';
    else {
      const cfgIssues = validateLlmConfig(llm.config, !!llm.apiKey);
      if (cfgIssues.length) { errors.push(makeError('AI_LLM_CONFIG_INVALID', 'The AI / LLM Model is enabled but its configuration is incomplete — the offline engine result is used.', cfgIssues)); llmStatus = 'configuration invalid'; }
      else {
        llmAttempted = true;
        const examples = (deps.learning?.findHints(text, schema, 0.5) || []).filter((h) => h.status === 'confirmed').map((h) => { const r = deps.learning!.get(h.patternId); return r?.finalSql ? { request: r.nlText, sql: r.finalSql } : null; }).filter((x): x is { request: string; sql: string } => !!x);
        const context = buildLlmSchemaContext(schema, requirement.matchedTables);
        const prompt = buildLlmPrompt({ request: text, schemaContext: context, offlineSql: sql, dialect: state.dialect, examples });
        const res = await callLlm(llm.config, llm.apiKey, prompt, context, llm.fetchImpl);
        if (!res.ok) { errors.push(res.error); llmStatus = 'request failed — offline engine used'; }
        else {
          llmExplanation = res.suggestion.explanation ?? null;
          if (res.suggestion.sql) {
            const problems = validateLlmSql(res.suggestion.sql, schema);
            if (problems.length) { errors.push(makeError('AI_LLM_RESPONSE_REJECTED', 'The AI / LLM suggestion was discarded because it failed validation against the Active Schema.', problems)); llmStatus = 'suggestion rejected by validation — offline engine used'; }
            else { llmSql = res.suggestion.sql.replace(/;?\s*$/, ';'); llmStatus = 'suggestion validated'; if (requirement.confidence < 0.5 || !requirement.matchedTables.length) { sql = llmSql; usedLlmSql = true; llmStatus = 'suggestion validated and used (offline confidence was low)'; } }
          } else llmStatus = res.suggestion.explanation ? 'model returned no SQL (see explanation)' : 'model returned no SQL';
          const unknown = (res.suggestion.tables || []).filter((t) => !schema.tables.some((x) => x.name === t));
          if (unknown.length) warnings.push(`The AI / LLM Model mentioned table(s) not in the Active Schema, which were ignored: ${unknown.join(', ')}.`);
        }
      }
    }
  }
  // 7. record for controlled learning (observed only — needs repetition or confirmation to be used)
  let learningId: string | null = null;
  if (deps.learning && text.trim() && requirement.matchedTables.length) {
    const r = deps.learning.recordGeneration({ nlText: text, schema, generatedSql: sql, options: { distinct: state.advanced.distinct, limit: state.advanced.limit, groupBy: state.advanced.groupByColumns, having: state.advanced.havingClause, sorts: state.sorts.filter((s) => !s.expression).map((s) => ({ table: s.table, column: s.column, direction: s.direction })), dialect: state.dialect } });
    learningId = r.id; if (r.error) warnings.push(r.error.message);
  }
  return { requirement, state: { ...state, generatedSql: sql, lastGeneratedAt: new Date().toISOString() }, sql, llmSql, llmExplanation, usedLlmSql, engineUsed: usedLlmSql || llmSql ? 'offline+llm' : 'offline', llmAttempted, llmStatus, errors, warnings, applied: applied.applied, keptManual: applied.keptManual, learningId, schemaId: schema.id, schemaFingerprint: fp };
}

/** True when a cached result was produced from a schema that has since changed (prevents stale reuse). */
export function isResultStale(result: Pick<DescribeResult, 'schemaId' | 'schemaFingerprint'>, active: SchemaModel): boolean { return result.schemaId !== active.id || result.schemaFingerprint !== schemaFingerprint(active); }
