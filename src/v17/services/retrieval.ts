/**
 * V17.4 — Retrieval order for "Describe What You Need" (requirement 16):
 *   1 Active Schema  →  2 Admin Query Library  →  3 centrally learned successful queries  →  (4 offline NLU patterns, 5 local SQL engine run afterwards)
 * Admin patterns have a higher trust level than learned ones and the Active Schema always takes precedence.
 */
import type { Dialect, SchemaModel } from '../../types';
import type { LearnedHint } from '../engines/nluEngine';
import { getSchemaContext, findPhrase, softNormalize } from '../engines/schemaContext';
import type { LearningStore } from './learningStore';
import type { AdminQueryLibrary } from './adminLibrary';
export interface Retrieval { hints: LearnedHint[]; trace: string[]; adminTrusted: number; adminMatches: number; learnedMatches: number; requestTables: string[]; }
export function detectRequestTables(text: string, s: SchemaModel): string[] { const ctx = getSchemaContext(s); const soft = softNormalize(text); return ctx.tables.filter((t) => t.phrases.some((p) => p.length > 2 && findPhrase(soft, p).length)).map((t) => t.table.name); }
export function retrieveKnowledge(text: string, s: SchemaModel, d: Dialect, learning: LearningStore | null, admin: AdminQueryLibrary | null, contextTables: string[] = []): Retrieval {
  const trace = [`Active Schema: ${s.name} (${s.tables.length} tables) — source of truth`]; const rt = Array.from(new Set([...detectRequestTables(text, s), ...contextTables.filter((t) => s.tables.some((x) => x.name === t))]));
  let adminHints: LearnedHint[] = []; let trusted = 0;
  if (admin) { const r = admin.hints(text, s, d, rt); adminHints = r.hints; trusted = r.trusted; trace.push(`Admin Query Library: ${r.trusted} trusted of ${r.considered}; ${adminHints.length ? `best match "${adminHints[0].label}" (${Math.round(adminHints[0].similarity * 100)}%)` : 'no similar query'}`); } else trace.push('Admin Query Library: not available');
  const learnedHints = learning ? learning.hints(text, s, rt) : []; trace.push(`Learned queries: ${learnedHints.length ? `best match "${learnedHints[0].label}" — ${learnedHints[0].tier} (${Math.round(learnedHints[0].similarity * 100)}%)` : 'no similar trusted query'}`);
  return { hints: [...adminHints, ...learnedHints], trace, adminTrusted: trusted, adminMatches: adminHints.length, learnedMatches: learnedHints.length, requestTables: rt };
}
