import type { SchemaModel, ReadOnlyQueryState, Dialect } from '../../types';
import { runOfflineNlu, type V17Requirement, type LearnedHint } from '../engines/nluEngine';
import { applyV17ToState, advancedOverrides } from '../engines/advancedOptionsResolver';
import { buildSelect, type BuildResult } from '../../engines/sqlEngine';
import { validateFinalQuery, type FullValidation } from '../engines/queryValidator';
import { explainQuery, type Explanation } from '../engines/explain';
import type { LearningStore } from './learningStore';
import type { AdminQueryLibrary } from './adminLibrary';
import { retrieveKnowledge } from './retrieval';
import { requestSqlFromModel, type AiLlmConfig } from './aiLlmService';
export interface OrchestratedResult { state: ReadOnlyQueryState; build: BuildResult; requirement: V17Requirement; engine: 'offline' | 'online'; keptManual: string[]; onlineNote: string | null; validation: FullValidation; trace: string[]; explanation: Explanation; }
/**
 * Describe What You Need → (1) Active Schema → (2) Admin Query Library → (3) learned queries → (4) offline NLU → (5) local SQL engine
 * → optional AI/LLM Model (only when the offline result is uncertain; its SQL must pass the same validation) → full validation → learning.
 */
export async function generateFromDescription(text: string, cur: ReadOnlyQueryState, s: SchemaModel, d: Dialect, learning: LearningStore | null, ai: { config: AiLlmConfig; apiKey: string } | null, admin: AdminQueryLibrary | null = null): Promise<OrchestratedResult> {
  const ret = retrieveKnowledge(text, s, d, learning, admin, cur.selectedTables); const hints: LearnedHint[] = ret.hints; const trace = [...ret.trace];
  const req = runOfflineNlu(text, s, { dialect: d, hints, contextTables: cur.selectedTables }); trace.push(`Offline NLU: ${req.matchedTables.length} table(s), ${req.matchedFilters.length} filter(s)${req.aggregateMode ? ', aggregation' : ''}${req.patternUsed ? `, pattern from ${req.patternUsed.source === 'admin' ? 'Admin Query Library' : 'learned queries'}` : ''}`);
  const m = applyV17ToState({ ...cur, naturalLanguageText: text, dialect: d }, req, advancedOverrides);
  const b = buildSelect(m.state, s); m.state.generatedSql = b.sql; trace.push('Local SQL engine: query built from the Active Schema');
  let validation = validateFinalQuery(b.sql, s, d, { state: m.state, unresolvedTerms: req.unresolvedTerms });
  let r: OrchestratedResult = { state: m.state, build: b, requirement: req, engine: 'offline', keptManual: m.keptManual, onlineNote: null, validation, trace, explanation: explainQuery(b, m.state, s, req) };
  if (ai?.config.enabled && (req.confidence < 0.5 || !req.matchedTables.length)) {
    const x = await requestSqlFromModel(ai.config, ai.apiKey, text, s.tables.map((t) => `${t.name}(${t.columns.map((c) => c.name).join(', ')})`).join('\n').slice(0, 12000));
    if ('error' in x) { r.onlineNote = `${x.error.message} The offline NLU result is used.`; trace.push('AI/LLM Model: unavailable — offline result kept'); }
    else { const v = validateFinalQuery(x.sql, s, d); if (v.valid) { r = { ...r, state: { ...r.state, generatedSql: x.sql }, build: { ...b, sql: x.sql }, engine: 'online', onlineNote: 'SQL produced by the AI/LLM Model and validated against the Active Schema.', validation: v }; trace.push('AI/LLM Model: SQL accepted after validation'); } else { r.onlineNote = "The AI/LLM Model's SQL was rejected by validation — the offline NLU result is used."; trace.push('AI/LLM Model: SQL rejected by validation — offline result kept'); } }
  }
  validation = r.validation;
  // only valid SQL is ever recorded — and as "generated" (unconfirmed): it becomes a trusted pattern only through confirmation
  if (learning && validation.valid && r.state.selectedTables.length) learning.record({ schema: s, requestText: text, generatedSql: r.state.generatedSql, modifiedSql: null, finalSql: null, dialect: d, tables: r.state.selectedTables, columns: r.state.selectedColumns.filter((c) => !c.manualExpr).map((c) => ({ table: c.table, column: c.column })), sorts: r.state.sorts.filter((x) => !x.expression).map((x) => ({ table: x.table, column: x.column, direction: x.direction })), limit: r.state.advanced.limit });
  return r;
}
