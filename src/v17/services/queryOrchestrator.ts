import type { SchemaModel, ReadOnlyQueryState, Dialect } from '../../types';
import { runOfflineNlu, type V17Requirement } from '../engines/nluEngine';
import { applyV17ToState, advancedOverrides } from '../engines/advancedOptionsResolver';
import { buildSelect, type BuildResult } from '../../engines/sqlEngine';
import { validateSqlAgainstSchema } from '../../engines/sqlSchemaValidator';
import { validateReadOnlySql } from '../../engines/validationEngine';
import type { LearningStore } from './learningStore';
import { requestSqlFromModel, type AiLlmConfig } from './aiLlmService';
export interface OrchestratedResult { state: ReadOnlyQueryState; build: BuildResult; requirement: V17Requirement; engine: 'offline' | 'online'; keptManual: string[]; onlineNote: string | null; }
/** Describe What You Need → offline NLU (primary) → optional AI/LLM fallback (validated) → result. */
export async function generateFromDescription(text: string, cur: ReadOnlyQueryState, s: SchemaModel, d: Dialect, learning: LearningStore | null, ai: { config: AiLlmConfig; apiKey: string } | null): Promise<OrchestratedResult> {
  const req = runOfflineNlu(text, s, { dialect: d, hints: learning ? learning.hints(text, s) : [] }); const m = applyV17ToState({ ...cur, naturalLanguageText: text, dialect: d }, req, advancedOverrides);
  const b = buildSelect(m.state, s); m.state.generatedSql = b.sql; let r: OrchestratedResult = { state: m.state, build: b, requirement: req, engine: 'offline', keptManual: m.keptManual, onlineNote: null };
  if (ai?.config.enabled && (req.confidence < 0.5 || !req.matchedTables.length)) { const x = await requestSqlFromModel(ai.config, ai.apiKey, text, s.tables.map((t) => `${t.name}(${t.columns.map((c) => c.name).join(', ')})`).join('\n').slice(0, 12000));
    if ('error' in x) r.onlineNote = `${x.error.message} The offline NLU result is used.`; else if (validateSqlAgainstSchema(x.sql, s).valid && validateReadOnlySql(x.sql).valid) r = { ...r, state: { ...r.state, generatedSql: x.sql }, build: { ...b, sql: x.sql }, engine: 'online', onlineNote: 'SQL produced by the AI/LLM Model and validated against the Active Schema.' }; else r.onlineNote = "The AI/LLM Model's SQL was rejected by validation — the offline NLU result is used."; }
  if (learning && r.state.selectedTables.length && validateSqlAgainstSchema(r.state.generatedSql, s).valid) learning.record({ schema: s, requestText: text, generatedSql: r.state.generatedSql, modifiedSql: null, finalSql: null, tables: r.state.selectedTables, columns: r.state.selectedColumns.filter((c) => !c.manualExpr).map((c) => ({ table: c.table, column: c.column })), sorts: r.state.sorts.filter((x) => !x.expression).map((x) => ({ table: x.table, column: x.column, direction: x.direction })), limit: r.state.advanced.limit });
  return r;
}
