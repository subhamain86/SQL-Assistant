/** V17.4 — concise "Explain generated SQL": tables, columns, joins, filters, aggregations, sorting, limit and the pattern used. */
import type { ReadOnlyQueryState, SchemaModel } from '../../types';
import type { BuildResult } from '../../engines/sqlEngine';
import type { V17Requirement } from './nluEngine';
export interface Explanation { tables: string[]; columns: string[]; joins: string[]; filters: string[]; aggregations: string[]; grouping: string[]; sorting: string[]; limit: string; options: string[]; pattern: string; unresolved: string[]; }
const strip = (p: string, a: string[]) => a.filter((x) => x.startsWith(p)).map((x) => x.slice(p.length).trim());
export function explainQuery(b: BuildResult, st: ReadOnlyQueryState, s: SchemaModel, req?: V17Requirement | null): Explanation {
  const desc = new Map(s.tables.map((t) => [t.name, t.description]));
  const pu = req?.patternUsed; const adopted = pu ? (pu.adopted.length ? `adapted ${pu.adopted.join(', ')}` : 'matched; nothing needed adapting') : '';
  return {
    tables: b.tablesUsed.map((t) => (desc.get(t) ? `${t} — ${desc.get(t)}` : t)),
    columns: b.columnsUsed.filter((c) => !/\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(c)).length || !b.columnsUsed.length ? (b.columnsUsed.length ? b.columnsUsed.filter((c) => !/\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(c)) : ['All columns (SELECT *)']) : [],
    joins: strip('Join:', b.applied), filters: strip('Filter:', b.applied),
    aggregations: b.columnsUsed.filter((c) => /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(c)),
    grouping: [...strip('Group by:', b.applied).map((g) => `GROUP BY ${g}`), ...strip('Having:', b.applied).map((g) => `HAVING ${g}`)],
    sorting: strip('Sort:', b.applied), limit: strip('Limit:', b.applied)[0] || '', options: [...(st.advanced.distinct ? ['DISTINCT'] : []), ...strip('Join type:', b.applied).map((j) => j), ...strip('CASE/DECODE:', b.applied).map((j) => `CASE/DECODE ${j}`), ...(st.advanced.tableAliases ? ['table aliases'] : [])],
    pattern: pu ? `${pu.source === 'admin' ? 'Admin Query Library' : 'Learned query'} "${pu.label}" (${Math.round(pu.similarity * 100)}% similar) — ${adopted}` : '', unresolved: req?.unresolvedTerms || [],
  };
}
