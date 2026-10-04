/** Describe What You Need → offline NLU (primary) → optional AI/LLM fallback → schema validation. */
import type { SchemaModel, ReadOnlyQueryState, Dialect } from '../../types';
import { runOfflineNlu, type V17Requirement } from '../engines/nluEngine';
import { applyV17ToState, advancedOverrides } from '../engines/advancedOptionsResolver';
import { buildSelectSQL } from '../../engines/sqlEngine';
import { validateSqlAgainstSchema } from '../../engines/sqlSchemaValidator';
import { validateReadOnlySql, validateSqlStructure } from '../../engines/validationEngine';
import type { LearningStore } from './learningStore';
import { requestSqlFromModel, type AiLlmConfig } from './aiLlmService';
import { formatAppError } from '../errors/appErrors';
export interface OrchestratedResult { state: ReadOnlyQueryState; requirement: V17Requirement; engine: 'offline' | 'online'; applied: string[]; keptManual: string[]; schemaWarnings: string[]; onlineNote: string | null; }
export function schemaSummary(schema: SchemaModel): string { return schema.tables.map((t) => `${t.name}(${t.columns.map((c) => c.name).join(', ')})`).join('\n').slice(0, 12000); }
export async function generateFromDescription(text: string, current: ReadOnlyQueryState, schema: SchemaModel, dialect: Dialect, learning: LearningStore | null, ai: { config: AiLlmConfig; apiKey: string } | null): Promise<OrchestratedResult> {
  const req = runOfflineNlu(text, schema, { dialect, hints: learning ? learning.hints(text, schema) : [] });
  const merged = applyV17ToState({ ...current, naturalLanguageText: text, dialect }, req, advancedOverrides);
  merged.state.generatedSql = buildSelectSQL(merged.state, schema); merged.state.lastGeneratedAt = new Date().toISOString();
  const v = validateSqlAgainstSchema(merged.state.generatedSql, schema);
  let result: OrchestratedResult = { state: merged.state, requirement: req, engine: 'offline', applied: merged.applied, keptManual: merged.keptManual, schemaWarnings: v.warnings, onlineNote: null };
  if (ai?.config.enabled && (req.confidence < 0.5 || !req.matchedTables.length)) {
    const r = await requestSqlFromModel(ai.config, ai.apiKey, text, schemaSummary(schema));
    if ('error' in r) result.onlineNote = `${formatAppError(r.error)} — the offline NLU result is used.`;
    else {
      const sv = validateSqlAgainstSchema(r.sql, schema); const ro = validateReadOnlySql(r.sql); const st = validateSqlStructure(r.sql).filter((i) => i.severity === 'error');
      if (sv.valid && ro.valid && !st.length) { result = { ...result, state: { ...result.state, generatedSql: r.sql }, engine: 'online', schemaWarnings: [], onlineNote: 'SQL produced by the AI/LLM Model and validated against the Active Schema.' }; }
      else result.onlineNote = `The AI/LLM Model's SQL was rejected (${[...sv.warnings, ...ro.issues.map((i) => i.message), ...st.map((i) => i.message)].join(' ')}) — the offline NLU result is used.`;
    }
  }
  if (learning && result.state.selectedTables.length) learning.record({ schema, requestText: text, generatedSql: result.state.generatedSql, modifiedSql: null, finalSql: null, tables: result.state.selectedTables, columns: result.state.selectedColumns.filter((c) => !c.manualExpr).map((c) => ({ table: c.table, column: c.column })), filters: result.state.filters.map((f) => `${f.table}.${f.column} ${f.operator} ${f.value}`), joins: result.state.selectedTables.slice(1), sorts: result.state.sorts.filter((s) => !s.expression).map((s) => ({ table: s.table, column: s.column, direction: s.direction })), groupBy: result.state.advanced.groupByColumns, aggregation: result.state.selectedColumns.filter((c) => c.aggregate || /\(/.test(c.manualExpr || '')).map((c) => c.manualExpr || `${c.aggregate}(${c.table}.${c.column})`), distinct: result.state.advanced.distinct, limit: result.state.advanced.limit });
  return result;
}
