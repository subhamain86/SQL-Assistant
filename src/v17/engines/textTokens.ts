/** V17.4 — shared text normalisation for retrieval (learned queries + Admin Query Library). */
const STOP = new Set(['show', 'list', 'get', 'find', 'give', 'the', 'all', 'and', 'with', 'for', 'from', 'me', 'of', 'in', 'on', 'to', 'a', 'an', 'by', 'is', 'are', 'that', 'this', 'their', 'its', 'what', 'which', 'each', 'per', 'please']);
export const stem = (w: string): string => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
export const tokenize = (t: string): string[] => Array.from(new Set(String(t ?? '').toLowerCase().replace(/_/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem)));
export const jaccard = (a: string[], b: string[]): number => { const B = new Set(b); const i = a.filter((x) => B.has(x)).length; const u = new Set([...a, ...b]).size; return u ? i / u : 0; };
/** Share of the REQUEST tokens that are found in the document (documents are longer than requests). */
export const coverage = (req: string[], doc: Set<string> | string[]): number => { const D = doc instanceof Set ? doc : new Set(doc); return req.length ? req.filter((x) => D.has(x)).length / req.length : 0; };
