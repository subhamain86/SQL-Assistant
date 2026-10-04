import type { SchemaModel, QueryRequirement } from '../types';
const STOP = new Set(['the','show','me','all','get','find','list','with','and','for','of','in','on','to','from','that','this','is','are','by','which','each']);
const tok = (t: string) => (t.toLowerCase().match(/[a-z0-9]+/g) || []).filter((x) => x.length > 2 && !STOP.has(x));
export function parseRequirement(raw: string, s: SchemaModel): QueryRequirement {
  const base: QueryRequirement = { rawText: raw, matchedTables: [], matchedColumns: [], matchedFilters: [], matchedSorts: [], limit: null, distinct: false, confidence: 0, notes: [], unresolvedTerms: [] };
  const u = raw.toUpperCase(); let found = s.tables.filter((t) => u.includes(t.name) || u.includes(t.name.replace(/_/g, ' '))).map((t) => t.name);
  if (!found.length) { const ph = tok(raw); const best = s.tables.map((t) => ({ t, n: tok(`${t.name} ${t.module} ${t.description}`).filter((x) => ph.includes(x)).length })).filter((x) => x.n).sort((a, b) => b.n - a.n)[0]; if (best) found = [best.t.name]; }
  return { ...base, matchedTables: found, confidence: found.length ? 0.5 : 0.1 };
}
