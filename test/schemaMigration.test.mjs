import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imp, AP77_SOURCE, tiny, legacyRepoFile, legacyMangledFile, legacyLossyFile, countDecode } from './helpers.mjs';
const F = await imp('v17/sync/schemaFormat.js');
const SYNC = await imp('v17/sync/syncService.js');

test('Test 1 — legacy schema without writer stamp → detected as legacy → migration → validation → success', () => {
  const r = F.checkRegistry({ text: legacyRepoFile() });
  assert.equal(r.writer.legacy, true);
  assert.match(r.writer.label, /V17\.0 or older/);
  assert.equal(r.invalidSchemas.length, 0, '0 of 3 schemas fail (was 1 of 3)');
  const ap = r.schemas[2];
  assert.equal(ap.name, 'AP schema 77'); assert.equal(ap.migrationStatus, 'migrated'); assert.equal(ap.valid, true);
  assert.equal(ap.schema.migration.migratedBy, 'SQL Assistant 17.2.1');
  assert.equal(r.schemas[0].migrationStatus, 'legacy-clean');
});

test('Test 2 — empty decode raw values follow the defined legacy rules', () => {
  const col = (decode) => ({ schemas: [{ name: 'S', tables: [{ name: 'T', columns: [{ name: 'ID', type: 'NUMBER', nullable: false, isPrimaryKey: true }, { name: 'C', type: 'VARCHAR', nullable: true, decode }] }] }] });
  // L1: empty rawValue written beside the real code → code recovered
  let r = F.checkRegistry({ value: col([{ rawValue: '', code: 'X', label: 'Ex' }]) });
  assert.deepEqual(r.validSchemas[0].tables[0].columns[1].decode, [{ rawValue: 'X', label: 'Ex' }]);
  // L2: empty raw + empty label → placeholder removed
  r = F.checkRegistry({ value: col([{ rawValue: '', label: '' }, { code: 'A', label: 'Active' }]) });
  assert.deepEqual(r.validSchemas[0].tables[0].columns[1].decode, [{ rawValue: 'A', label: 'Active' }]);
  // L3: code lost, label kept → preserved as unmapped label (schema valid, warning reported)
  r = F.checkRegistry({ value: col([{ rawValue: '', label: 'Invoice' }, { code: 'A', label: 'Active' }]) });
  const c = r.validSchemas[0].tables[0].columns[1];
  assert.deepEqual(c.unmappedDecodeLabels, ['Invoice']); assert.equal(c.decode.length, 1);
  assert.ok(r.schemas[0].warnings.some((w) => w.code === 'LEGACY_UNMAPPED_DECODE'));
  // Validator NOT weakened: the same data in a current (stamped) file is still rejected with the exact path
  r = F.checkRegistry({ value: { formatVersion: 2, writtenBy: 'SQL Assistant 17.2', ...col([{ rawValue: '', label: 'Invoice' }]) } });
  assert.equal(r.invalidSchemas.length, 1);
  const e = r.invalidSchemas[0].errors[0];
  assert.equal(e.code, 'DECODE_RAW_EMPTY'); assert.equal(e.path, 'schemas[0].tables[0].columns[1].decode[0].rawValue');
  assert.match(e.message, /Column "T\.C" has a decode entry \(#1\) with an empty raw value/);
});

test('Test 3 — AP schema 77: all 437 decode entries processed (no partial migration)', () => {
  assert.equal(countDecode({ tables: AP77_SOURCE.tables.map((t) => ({ columns: t.columns })) }), 437);
  for (const file of [legacyRepoFile(), legacyMangledFile()]) {
    const ap = F.checkRegistry({ text: file }).schemas[2];
    assert.equal(ap.valid, true);
    assert.equal(countDecode(ap.schema), 437, 'every decode entry kept');
    assert.equal(ap.migrationNotes.filter((n) => n.rule === 'L1').length, 437, 'all entries migrated, not only #1–#3');
    assert.equal(ap.schema.tables.length, 77); assert.equal(ap.schema.tables.reduce((n, t) => n + t.columns.length, 0), 1561);
    const rdt = ap.schema.tables[0].columns[2];
    assert.equal(`${ap.schema.tables[0].name}.${rdt.name}`, 'IA_ACTION_LOG.ROOT_DOCUMENT_TYPE');
    assert.deepEqual(rdt.decode.map((d) => d.rawValue), ['Invoice.Domain.Invoice', 'PP.Domain.PayPlan', 'AC', 'PP.BusinessLogic.Workflow.PayPlanDocument']);
  }
});

test('Test 3b — hundreds of synthetic decode entries in many columns', () => {
  const cols = Array.from({ length: 60 }, (_, i) => ({ name: `C${i}`, type: 'NUMBER', nullable: true, decode: Array.from({ length: 12 }, (_, j) => ({ rawValue: '', code: String(j), label: `L${j}` })) }));
  const r = F.checkRegistry({ value: { schemas: [{ name: 'Big', tables: [{ name: 'T', columns: [{ name: 'ID', type: 'NUMBER', nullable: false, primary_key: true }, ...cols] }] }] } });
  assert.equal(r.schemas[0].valid, true); assert.equal(countDecode(r.validSchemas[0]), 720);
});

test('Test 4 — invalid decode structure fails safely with exact location', () => {
  const bad = { schemas: [{ name: 'Bad', tables: [{ name: 'T', columns: [{ name: 'ID', type: 'NUMBER', nullable: false, primary_key: true }, { name: 'S', type: 'VARCHAR', nullable: true, decode: 5 }] }] }] };
  const r = F.checkRegistry({ value: bad });
  assert.equal(r.schemas[0].migrationStatus, 'migration-failed'); assert.equal(r.schemas[0].valid, false);
  assert.equal(r.schemas[0].errors[0].path, 'schemas[0].tables[0].columns[1].decode');
  const msg = SYNC.rejectionMessage(SYNC.rejectedFromReport(r.schemas[0]));
  assert.match(msg, /^Legacy schema migration could not be completed\.\nSchema: Bad\nLocation: T\.S\nReason: /); assert.match(msg, /existing valid local schema was preserved/);
  // conflicting duplicate codes are not "repaired"
  const dup = { schemas: [{ name: 'Dup', tables: [{ name: 'T', columns: [{ name: 'ID', type: 'NUMBER', nullable: false, primary_key: true, decode: [{ code: '1', label: 'A' }, { code: '1', label: 'B' }] }] }] }] };
  assert.equal(F.checkRegistry({ value: dup }).schemas[0].valid, false);
});

test('Test 5 — valid current schema: no migration required', () => {
  const r = F.checkRegistry({ value: { formatVersion: 2, writtenBy: 'SQL Assistant 17.2.1', schemas: [tiny('Cur')] } });
  assert.equal(r.writer.legacy, false); assert.equal(r.schemas[0].migrationStatus, 'current'); assert.equal(r.schemas[0].migrationNotes.length, 0); assert.equal(r.validSchemas[0].migration, undefined);
});

test('Test 6 — multiple schemas processed independently', () => {
  const bad = { name: 'Broken', tables: [{ name: 'T', columns: [{ name: '', type: 'NUMBER', nullable: true }] }] };
  const r = F.checkRegistry({ value: { schemas: [tiny('Valid One'), { ...structuredClone(AP77_SOURCE), name: 'AP schema 77' }, bad, tiny('Valid Two')] } });
  assert.deepEqual(r.validSchemas.map((s) => s.name), ['Valid One', 'AP schema 77', 'Valid Two']);
  assert.deepEqual(r.invalidSchemas.map((s) => s.name), ['Broken']);
  assert.equal(r.migratedSchemas.length, 1);
});

test('Test 7 — a migrated schema does not require migration again (idempotent, stable hash)', () => {
  const first = F.checkRegistry({ text: legacyRepoFile() });
  const ser = F.serializeRegistry({ schemas: first.validSchemas, activeSchemaId: first.validSchemas[0].id }, 'dev-1');
  assert.equal(ser.ok, true);
  const out = JSON.parse(ser.text); assert.equal(out.formatVersion, 2); assert.equal(out.writtenBy, 'SQL Assistant 17.2.1'); assert.ok(out.writtenAt); assert.equal(out.writtenByDevice, 'dev-1');
  const second = F.checkRegistry({ text: ser.text });
  assert.equal(second.writer.legacy, false);
  second.schemas.forEach((s) => { assert.equal(s.migrationStatus, 'current'); assert.equal(s.migrationNotes.length, 0); });
  assert.equal(SYNC.contentHash(second.validSchemas[2]), SYNC.contentHash(first.validSchemas[2]));
  // re-reading the same legacy file later gives the same content hash (no migration loop)
  const again = F.checkRegistry({ text: legacyRepoFile() }, () => '2030-01-01T00:00:00Z');
  assert.equal(SYNC.contentHash(again.validSchemas[2]), SYNC.contentHash(first.validSchemas[2]));
});

test('Publish protection: an invalid schema is never serialized', () => {
  const s = tiny('X'); s.tables[0].columns[1].decode = [{ rawValue: '', label: 'oops' }];
  const r = F.serializeRegistry({ schemas: [s], activeSchemaId: s.id });
  assert.equal(r.ok, false); assert.equal(r.text, '');
});

test('Legacy references outside the schema are preserved as documentation (L6)', () => {
  const ap = F.checkRegistry({ text: legacyRepoFile() }).schemas[2].schema;
  const inv = ap.tables.find((t) => t.name === 'IA_INVOICE').columns.find((c) => c.name === 'INVOICE_TYPE_CODE');
  assert.deepEqual(inv.unresolvedReference, { table: 'ADM_INVOICE_TYPE', column: 'CODE' }); assert.ok(!inv.isForeignKey); assert.equal(inv.references, undefined);
  const ok = ap.tables.find((t) => t.name === 'IA_ACTION_LOG').columns.find((c) => c.name === 'USER_ID');
  assert.deepEqual(ok.references, { table: 'ADM_USER_DATA', column: 'ID' }); assert.equal(ok.isForeignKey, true);
  assert.equal(ap.tables.flatMap((t) => t.columns).filter((c) => c.isPrimaryKey).length >= 75, true, 'primary_key mapped');
});

test('Lossy V17.0 file: labels preserved, codes restored from the original source file', () => {
  const r = F.checkRegistry({ text: legacyLossyFile() });
  const s = r.validSchemas[0]; assert.equal(r.schemas[0].migrationStatus, 'migrated');
  assert.equal(countDecode(s), 0); assert.equal(F.legacyLeftovers(s).unmappedLabels, 437);
  assert.ok(s.migration.warnings[0].includes('437'));
  const rec = F.recoverDecodeFromSource(s, AP77_SOURCE);
  assert.equal(rec.restored, 437); assert.equal(rec.stillUnmapped, 0); assert.equal(countDecode(rec.schema), 437);
  assert.equal(F.validateSchemaModel(rec.schema).valid, true);
});

test('File-level problems: newer format and broken JSON are rejected without touching schemas', () => {
  assert.equal(F.checkRegistry({ value: { formatVersion: 3, writtenBy: 'SQL Assistant 18.0', schemas: [] } }).fileProblem.code, 'FILE_NEWER_FORMAT');
  assert.equal(F.checkRegistry({ text: '{"schemas": [' }).fileProblem.code, 'FILE_NOT_JSON');
});

test('Cross-version files: V17.1 and V17.2 stamped registries read as current', () => {
  for (const w of ['SQL Assistant 17.1.0', 'SQL Assistant 17.2']) { const r = F.checkRegistry({ value: { formatVersion: 2, writtenBy: w, schemas: [tiny('A')] } }); assert.equal(r.schemas[0].migrationStatus, 'current'); }
});

test('Recursive validator reports exact schema/table/column/index/property', () => {
  const v = F.validateSchemaModel({ name: 'S', tables: [{ name: 'T', columns: [{ name: 'A', type: 'X', nullable: 'yes', length: -1 }] }], relationships: [{ fromTable: 'T', fromColumn: 'Z', toTable: 'Q', toColumn: 'ID' }] }, 'schemas[4]');
  const paths = v.errors.map((e) => e.path);
  assert.ok(paths.includes('schemas[4].tables[0].columns[0].nullable')); assert.ok(paths.includes('schemas[4].tables[0].columns[0].length'));
  assert.ok(paths.includes('schemas[4].relationships[0].fromColumn')); assert.ok(paths.includes('schemas[4].relationships[0].toTable'));
});
