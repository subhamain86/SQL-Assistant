import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
export const B = join(here, '../build/js');
export const imp = (p) => import(join(B, p));
export const AP77_SOURCE = JSON.parse(readFileSync(join(here, 'fixtures/ap-schema-77.source.json'), 'utf8'));
const tiny = (name, extra = {}) => ({ id: `s-${name.toLowerCase().replace(/\W+/g, '-')}`, name, tables: [{ name: 'T1', module: 'M', description: '', columns: [{ name: 'ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: '' }, { name: 'STATUS', type: 'VARCHAR', nullable: true, description: '', decode: [{ rawValue: 'A', label: 'Active' }] }] }], relationships: [], ...extra });
export { tiny };
/** What a V17.0 device publishes: registry with no writer stamp; AP schema 77 at schemas[2] in its original export shape. */
export function legacyRepoFile() { return JSON.stringify({ schemas: [tiny('Core A'), tiny('Core B'), { ...structuredClone(AP77_SOURCE), id: 'schema-ap77', name: 'AP schema 77' }], activeSchemaId: 's-core-a' }); }
/** V17.0 variant that wrote an empty rawValue next to the original code (the condition that broke V17.1/V17.2). */
export function legacyMangledFile() { const s = structuredClone(AP77_SOURCE); s.tables.forEach((t) => t.columns.forEach((c) => { if (c.decode) c.decode = c.decode.map((d) => ({ rawValue: '', code: d.code, label: d.label })); })); return JSON.stringify({ schemas: [tiny('Core A'), tiny('Core B'), { ...s, id: 'schema-ap77', name: 'AP schema 77' }] }); }
/** V17.0 variant where the code was lost completely (only labels survive). */
export function legacyLossyFile() { const s = structuredClone(AP77_SOURCE); s.tables.forEach((t) => t.columns.forEach((c) => { if (c.decode) c.decode = c.decode.map((d) => ({ rawValue: '', label: d.label })); })); return JSON.stringify({ schemas: [{ ...s, id: 'schema-ap77', name: 'AP schema 77' }] }); }
export const countDecode = (s) => s.tables.reduce((n, t) => n + t.columns.reduce((m, c) => m + (c.decode?.length || 0), 0), 0);
