import { readFileSync } from 'node:fs'; import { fileURLToPath } from 'node:url'; import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
export const imp = (p) => import(join(here, '../build/esm', p));
export const AP77 = JSON.parse(readFileSync(join(here, 'fixtures/ap-schema-77.legacy.json'), 'utf8'));
export const tiny = (name, extra = {}) => ({ id: `s-${name.toLowerCase().replace(/\W+/g, '-')}`, name, version: '1.0', status: 'inactive', updatedAt: '2026-01-01T00:00:00.000Z', lastSyncedAt: null, tables: [{ name: 'T1', module: 'M', description: '', columns: [{ name: 'ID', label: 'ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: '' }, { name: 'STATUS', label: 'STATUS', type: 'VARCHAR', nullable: true, description: '', decode: [{ rawValue: 'A', label: 'Active' }] }] }], relationships: [], ...extra });
const ap = (mut) => { const s = structuredClone(AP77); if (mut) s.tables.forEach((t) => t.columns.forEach((c) => { if (c.decode) c.decode = c.decode.map(mut); })); return { ...s, id: 'schema-ap77', name: 'AP schema 77' }; };
/** V17.0 published the original export ({code,label}) without a writer stamp. */
export const v170File = () => JSON.stringify({ schemas: [tiny('Core A'), tiny('Core B'), ap()], activeSchemaId: 's-core-a' });
/** V17.0 variant that wrote an empty rawValue next to code — the reported "decode entry with an empty raw value … and 434 more". */
export const v170MangledFile = () => JSON.stringify({ schemas: [tiny('Core A'), tiny('Core B'), ap((d) => ({ rawValue: '', code: d.code, label: d.label }))] });
/** Code lost completely (label only). */
export const v170LossyFile = () => JSON.stringify({ schemas: [ap((d) => ({ rawValue: '', label: d.label }))] });
export const stamped = (writer, schemas) => JSON.stringify({ formatVersion: 2, writtenBy: writer, writtenByDevice: 'dev-x', schemas, activeSchemaId: schemas[0].id });
export const countDecode = (s) => s.tables.reduce((n, t) => n + t.columns.reduce((m, c) => m + (c.decode?.length || 0), 0), 0);
