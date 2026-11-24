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
import { assessReadOnly, unknownQualifiers, type NlAssessment } from '../engines/nlAssessment'; import { buildLlmSchemaContext } from '../engines/llmContext';
export interface OrchestratedResult { state: ReadOnlyQueryState; build: BuildResult; requirement: V17Requirement; engine: 'offline' | 'online'; keptManual: string[]; onlineNote: string | null; validation: FullValidation; trace: string[]; explanation: Explanation; /** V17.7.2: success | review | error — what the SQL does and does not cover (nlAssessment.ts) */ assessment: NlAssessment; }
/** V17.7.2: `independent` = the description is processed on its OWN — no Manual Selector state, no manual-override markers, no context tables (Describe What You Need page). Without it the V17.7.1 behaviour is unchanged. */
export interface GenerateOptions { independent?: boolean; }
const FRESH: Pick<ReadOnlyQueryState, 'selectedTables' | 'selectedColumns' | 'filters' | 'sorts' | 'joinPathChoices'> = { selectedTables: [], selectedColumns: [], filters: [], sorts: [], joinPathChoices: {} };
/**
 * Describe What You Need → (1) Active Schema → (2) Admin Query Library → (3) learned queries → (4) offline NLU → (5) local SQL engine
 * → optional AI/LLM Model (only when the offline result is uncertain; its SQL must pass the same validation) → full validation → learning.
 */
export async function generateFromDescription(text: string, cur0: ReadOnlyQueryState, s: SchemaModel, d: Dialect, learning: LearningStore | null, ai: { config: AiLlmConfig; apiKey: string } | null, admin: AdminQueryLibrary | null = null, opts: GenerateOptions = {}): Promise<OrchestratedResult> {
  const cur: ReadOnlyQueryState = opts.independent ? { ...cur0, ...structuredClone(FRESH), advanced: { distinct: false, groupByColumns: [], havingClause: '', limit: null, viewName: '', tableAliases: false, joinType: 'INNER JOIN', recursive: false, ctes: [], subqueries: [] } } : cur0; const noManual = { isManual: () => false };
  const ret = retrieveKnowledge(text, s, d, learning, admin, cur.selectedTables); const hints: LearnedHint[] = ret.hints; const trace = [...ret.trace];
  const req = runOfflineNlu(text, s, { dialect: d, hints, contextTables: cur.selectedTables }); trace.push(`Offline NLU: ${req.matchedTables.length} table(s), ${req.matchedFilters.length} filter(s)${req.aggregateMode ? ', aggregation' : ''}${req.patternUsed ? `, pattern from ${req.patternUsed.source === 'admin' ? 'Admin Query Library' : 'learned queries'}` : ''}`);
  const m = applyV17ToState({ ...cur, naturalLanguageText: text, dialect: d }, req, opts.independent ? noManual : advancedOverrides);
  const b = buildSelect(m.state, s); m.state.generatedSql = b.sql; trace.push('Local SQL engine: query built from the Active Schema');
  let validation = validateFinalQuery(b.sql, s, d, { state: m.state, unresolvedTerms: req.unresolvedTerms });
  let assessment = assessReadOnly(text, s, req, m.state, b.sql, validation, b.warnings);
  let r: OrchestratedResult = { state: m.state, build: b, requirement: req, engine: 'offline', keptManual: m.keptManual, onlineNote: null, validation, trace, explanation: explainQuery(b, m.state, s, req), assessment };
  // V17.7.2: the model is also consulted when the offline SQL does not cover the description (status review / error) — never for a data-change request, which is refused outright
  if (ai?.config.enabled && (req.confidence < 0.5 || !req.matchedTables.length || (opts.independent && assessment.status !== 'success' && !/data-change request/.test(assessment.errors[0] || '')))) {
    const ctx = buildLlmSchemaContext(s, text, d); trace.push(`AI/LLM context: ${ctx.shownTables} of ${ctx.totalTables} table(s), ${ctx.relationships} relationship(s)${ctx.truncated ? ' — the tables most relevant to the request' : ''}`);
    const x = await requestSqlFromModel(ai.config, ai.apiKey, text, ctx.summary, { dialect: d });
    if ('error' in x) { r.onlineNote = `${x.error.message} The offline NLU result is used.`; trace.push('AI/LLM Model: unavailable — offline result kept'); }
    else { const v = validateFinalQuery(x.sql, s, d); const uq = v.valid ? unknownQualifiers(x.sql, s) : []; if (v.valid && !uq.length) { assessment = { status: 'success', headline: 'SQL produced by the AI/LLM Model and validated against the Active Schema.', errors: [], warnings: [], unreflected: [], droppedTables: [], suggestions: [] }; r = { ...r, state: { ...r.state, generatedSql: x.sql }, build: { ...b, sql: x.sql }, engine: 'online', onlineNote: 'SQL produced by the AI/LLM Model and validated against the Active Schema.', validation: v, assessment }; trace.push('AI/LLM Model: SQL accepted after validation'); } else { r.onlineNote = "The AI/LLM Model's SQL was rejected by validation — the offline NLU result is used."; trace.push('AI/LLM Model: SQL rejected by validation — offline result kept'); } }
  }
  validation = r.validation;
  // only valid SQL is ever recorded — and as "generated" (unconfirmed): it becomes a trusted pattern only through confirmation
  if (learning && validation.valid && r.state.selectedTables.length) learning.record({ schema: s, requestText: text, generatedSql: r.state.generatedSql, modifiedSql: null, finalSql: null, dialect: d, tables: r.state.selectedTables, columns: r.state.selectedColumns.filter((c) => !c.manualExpr).map((c) => ({ table: c.table, column: c.column })), sorts: r.state.sorts.filter((x) => !x.expression).map((x) => ({ table: x.table, column: x.column, direction: x.direction })), limit: r.state.advanced.limit });
  return r;
}
