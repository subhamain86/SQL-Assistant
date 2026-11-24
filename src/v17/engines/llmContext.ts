/**
 * V17.7.2 — the schema context handed to the optional AI/LLM Model.
 *
 * Root cause fixed here: the V17.7.1 prompt was `tables.map(name(columns)).join('\n').slice(0, 12000)` — for a large schema (AP schema: 77 tables, 356 in the full version) the text was cut in the
 * middle of a table, the tables the question is about were often NOT in the first 12 000 characters, no relationships were given (so the model invented joins), column types and decode values were
 * missing (so it invented literals) and the SQL dialect was not stated. The context is now built per request: the tables most relevant to the description first, their relationships, types,
 * keys and decode values; a table is included whole or not at all; the result says how many tables are shown. Only objects of the imported schema appear in it.
 */
import type { SchemaModel, TableDef, Dialect } from '../../types';
import { withFkRelationships } from './joinGraph';
import { tokenize } from './textTokens';
export interface LlmContext { summary: string; shownTables: number; totalTables: number; truncated: boolean; relationships: number; }
const line = (t: TableDef): string => `${t.name}${t.objectType === 'VIEW' ? ' [VIEW]' : ''}${t.description ? ` — ${String(t.description).replace(/\s+/g, ' ').slice(0, 80)}` : ''}: ${t.columns.map((c) => `${c.name} ${c.type}${c.isPrimaryKey ? ' PK' : ''}${c.references ? ` FK→${c.references.table}.${c.references.column}` : ''}${c.decode?.length ? ` {${c.decode.slice(0, 8).map((d) => `${d.rawValue}=${String(d.label).slice(0, 24)}`).join(', ')}${c.decode.length > 8 ? ', …' : ''}}` : ''}`).join('; ')}`;
export function buildLlmSchemaContext(schema: SchemaModel, request: string, dialect: Dialect | string, budget = 12000): LlmContext {
  const all = schema.tables; const lines = all.map(line); const total = lines.reduce((n, l) => n + l.length + 1, 0); const g = withFkRelationships(schema);
  const rel = (inc: Set<string>) => g.relationships.filter((r) => inc.has(r.fromTable) && inc.has(r.toTable)).map((r) => `${r.fromTable}.${r.fromColumn} = ${r.toTable}.${r.toColumn}`);
  const head = `SQL dialect: ${dialect}\nTABLES (name — description: column type, PK, FK→target, {decode value=label}):\n`;
  let chosen: number[]; let truncated = false;
  if (total + head.length + 1500 <= budget) chosen = all.map((_, i) => i);
  else {
    truncated = true; const req = tokenize(request); const score = all.map((t, i) => { const doc = new Set(tokenize(`${t.name} ${t.description || ''} ${t.columns.map((c) => `${c.name} ${c.label || ''} ${(c.decode || []).map((d) => d.label).join(' ')}`).join(' ')}`)); const own = new Set(tokenize(`${t.name} ${t.description || ''}`)); return { i, s: req.filter((w) => doc.has(w)).length + 2 * req.filter((w) => own.has(w)).length }; });
    const ranked = score.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.i); const adj = new Map<string, Set<string>>(); g.relationships.forEach((r) => { (adj.get(r.fromTable) || adj.set(r.fromTable, new Set()).get(r.fromTable)!).add(r.toTable); (adj.get(r.toTable) || adj.set(r.toTable, new Set()).get(r.toTable)!).add(r.fromTable); });
    const order: number[] = []; const add = (i: number) => { if (!order.includes(i)) order.push(i); }; ranked.slice(0, 6).forEach(add); ranked.slice(0, 6).forEach((i) => [...(adj.get(all[i].name) || [])].forEach((n) => { const j = all.findIndex((t) => t.name === n); if (j >= 0) add(j); })); ranked.forEach(add); all.forEach((_, i) => add(i));
    chosen = []; let used = head.length + 1500; for (const i of order) { if (used + lines[i].length + 1 > budget) continue; chosen.push(i); used += lines[i].length + 1; }
    if (!chosen.length && order.length) chosen = [order[0]];
  }
  const inc = new Set(chosen.map((i) => all[i].name)); const rels = rel(inc); const body = chosen.sort((a, b) => a - b).map((i) => lines[i]).join('\n');
  const note = truncated ? `\n(${chosen.length} of ${all.length} tables are shown — the ones most relevant to the request. Do not use any table that is not listed.)` : '';
  return { summary: `${head}${body}${note}\nRELATIONSHIPS (the only allowed joins):\n${rels.length ? rels.slice(0, 400).join('\n') : '(none are defined for these tables — do not join them)'}`, shownTables: chosen.length, totalTables: all.length, truncated, relationships: rels.length };
}
