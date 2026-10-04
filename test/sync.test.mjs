import { test } from 'node:test'; import assert from 'node:assert/strict';
import { imp, tiny, AP77, v170File, v170MangledFile, v170LossyFile, stamped, countDecode } from './helpers.mjs';
const F = await imp('v17/sync/schemaFormat.js'); const SY = await imp('v17/sync/syncService.js');
const { SchemaService } = await imp('services/schemaService.js'); const { memoryStore, KEYS } = await imp('services/storage.js'); const { memoryRepository } = await imp('v17/services/githubClient.js');
const V = await imp('v17/services/secretVault.js');
const PATH = V.CANONICAL_SCHEMA_PATH;
const dev = (repo, store = memoryStore(), path = PATH) => { const schemas = new SchemaService(store); return { store, schemas, sync: new SY.SyncService(schemas, () => repo, store, () => path) }; };
const ap = (d) => d.schemas.schemas().find((s) => s.name === 'AP schema 77');

test('1 current valid schema: no migration, loads', () => { const r = F.checkRegistry({ text: stamped('SQL Assistant 17.3.0', [tiny('A')]) }); assert.equal(r.schemas[0].migrationStatus, 'current'); assert.equal(r.validSchemas.length, 1); });
test('2 V17.1 / V17.2 / V17.2.1 stamped schemas read as current', () => { for (const w of ['SQL Assistant 17.1.0', 'SQL Assistant 17.2.0', 'SQL Assistant 17.2.1', 'SQL Assistant 17.2.2']) { const r = F.checkRegistry({ text: stamped(w, [tiny('A'), tiny('B')]) }); assert.equal(r.invalidSchemas.length, 0, w); assert.equal(r.writer.legacy, false); } });
test('3/4 V17.0 file without writer stamp → legacy → migrated → valid; all 437 decode entries kept', () => {
  for (const f of [v170File(), v170MangledFile()]) { const r = F.checkRegistry({ text: f }); assert.equal(r.writer.legacy, true); assert.equal(r.invalidSchemas.length, 0); const s = r.schemas[2]; assert.equal(s.migrationStatus, 'migrated'); assert.equal(countDecode(s.schema), 437); assert.equal(s.migrationNotes.filter((n) => n.rule === 'L1').length, 437); assert.equal(s.schema.tables.length, 77);
    assert.deepEqual(s.schema.tables[0].columns[2].decode.map((x) => x.rawValue), ['Invoice.Domain.Invoice', 'PP.Domain.PayPlan', 'AC', 'PP.BusinessLogic.Workflow.PayPlanDocument']); }
});
test('5 empty decode values: semantic rules, validator not weakened', () => {
  const s = F.checkRegistry({ text: v170LossyFile() }).validSchemas[0]; assert.equal(countDecode(s), 0); assert.equal(F.legacyLeftovers(s).unmappedLabels, 437, 'labels preserved, no codes invented');
  const rec = F.recoverDecodeFromSource(s, AP77); assert.equal(rec.restored, 437);
  const bad = tiny('X'); bad.tables[0].columns[1].decode = [{ rawValue: '', label: 'oops' }];
  const r = F.checkRegistry({ text: stamped('SQL Assistant 17.2.1', [bad]) }); assert.equal(r.invalidSchemas[0].errors[0].path, 'schemas[0].tables[0].columns[1].decode[0].rawValue');
  // L1 is lossless and also applies to stamped files (a V17.1/V17.2 device could relay rawValue:"" next to code)
  const relay = tiny('Y'); relay.tables[0].columns[1].decode = [{ rawValue: '', code: 'A', label: 'Active' }]; assert.equal(F.checkRegistry({ text: stamped('SQL Assistant 17.2.0', [relay]) }).invalidSchemas.length, 0);
});
test('6 large number of decode entries (1 200) in one schema all processed', () => { const cols = Array.from({ length: 100 }, (_, i) => ({ name: `C${i}`, type: 'NUMBER', nullable: true, decode: Array.from({ length: 12 }, (_, j) => ({ rawValue: '', code: `${j}`, label: `L${j}` })) })); const r = F.checkRegistry({ value: { schemas: [{ name: 'Big', tables: [{ name: 'T', columns: [{ name: 'ID', type: 'NUMBER', nullable: false, primary_key: true }, ...cols] }] }] } }); assert.equal(countDecode(r.validSchemas[0]), 1200); });
test('7/8 multi-schema cases 1–5 processed independently', () => {
  const invalid = { name: 'Broken', tables: [{ name: 'T', columns: [{ name: '', type: 'NUMBER', nullable: true }] }] };
  const legacyB = { name: 'Legacy B', tables: [{ name: 'B', columns: [{ name: 'ID', type: 'NUMBER', nullable: false, primary_key: true, decode: [{ value: 'X', label: 'Ex' }] }] }] };
  const cases = [[stamped('SQL Assistant 17.3.0', [tiny('A'), tiny('B'), tiny('C')]), 3, 0, 0], [JSON.stringify({ schemas: [tiny('A'), tiny('B'), { ...AP77, name: 'AP schema 77' }] }), 3, 1, 0], [JSON.stringify({ schemas: [tiny('A'), tiny('B'), invalid] }), 2, 0, 1], [JSON.stringify({ schemas: [{ ...AP77, name: 'AP schema 77' }, legacyB] }), 2, 2, 0], [v170MangledFile(), 3, 1, 0]];
  cases.forEach(([f, valid, migrated, rejected], i) => { const r = F.checkRegistry({ text: f }); assert.equal(r.validSchemas.length, valid, `case ${i + 1}`); assert.equal(r.migratedSchemas.length, migrated, `case ${i + 1}`); assert.equal(r.invalidSchemas.length, rejected, `case ${i + 1}`); });
});
test('9/10/13 sync #1, #2, #3, restart, sync after restart — stable; other device reads clean data', async () => {
  const repo = memoryRepository({ [PATH]: v170MangledFile() }); const st = memoryStore(); const a = dev(repo, st);
  const r1 = await a.sync.synchronize(); assert.equal(r1.pull.ok, true); assert.equal(r1.pull.migrated.length, 1); assert.equal(r1.push.ok, true);
  const pub = JSON.parse(repo.files.get(PATH).text); assert.equal(pub.writtenBy, 'SQL Assistant 17.3.0'); assert.equal(countDecode(pub.schemas.find((s) => s.name === 'AP schema 77')), 437);
  for (let i = 2; i <= 3; i++) { const r = await a.sync.synchronize(); assert.equal(r.pull.ok, true); assert.equal(r.pull.migrated.length, 0); assert.equal(r.pull.rejected.length, 0); assert.equal(r.push, null, `sync #${i} publishes nothing`); }
  const restarted = dev(repo, st); assert.equal(countDecode(ap(restarted)), 437); const r4 = await restarted.sync.synchronize(); assert.equal(r4.pull.ok, true); assert.equal(r4.push, null); assert.ok(r4.pull.unchanged.includes('AP schema 77'));
  const b = dev(repo); const rb = await b.sync.pull(); assert.equal(rb.remoteLegacy, false); assert.equal(rb.migrated.length, 0); assert.equal(countDecode(ap(b)), 437);
});
test('11/12 failed migration and local schema protection', async () => {
  const bad = { name: 'Core A', tables: [{ name: 'T1', columns: [{ name: 'ID', type: 'NUMBER', nullable: false, decode: 7 }] }] };
  const d = dev(memoryRepository({ [PATH]: JSON.stringify({ schemas: [bad, tiny('Fresh')] }) })); d.schemas.replaceRegistry({ schemas: [tiny('Core A')], activeSchemaId: 's-core-a' }); const before = JSON.stringify(d.schemas.schemas()[0].tables);
  const r = await d.sync.synchronize(); assert.equal(r.pull.rejected.length, 1); assert.match(SY.rejectionMessage(r.pull.rejected[0]), /^Legacy schema migration could not be completed\.\nSchema: Core A\nLocation: T1\.ID\nReason: .*decode value that is not a list/);
  assert.equal(JSON.stringify(d.schemas.schemas().find((s) => s.name === 'Core A').tables), before); assert.equal(d.schemas.registry().activeSchemaId, 's-core-a'); assert.ok(d.schemas.schemas().some((s) => s.name === 'Fresh')); assert.notEqual(r.push && r.push.ok, true);
  const bad2 = memoryRepository({ [PATH]: '<html>Sign in</html>' }); const e = dev(bad2, d.store); const r2 = await e.sync.pull(); assert.equal(r2.ok, false); assert.equal(r2.stage, 'Remote file could not be parsed'); assert.equal(SY.contentHash(e.schemas.schemas().find((s) => s.name === 'Core A')), SY.contentHash({ tables: JSON.parse(before), relationships: [] }));
});
test('publish protection: invalid local schema never reaches the repository', async () => {
  const repo = memoryRepository(); const d = dev(repo); const s = tiny('Bad'); s.tables[0].columns[1].decode = [{ rawValue: '', label: 'x' }];
  d.schemas['reg'].schemas.push(s); const r = await d.sync.push(); assert.equal(r.ok, false); assert.equal(repo.files.size, 0);
});
test('ROOT CAUSE A: V17.2 local schemas (sqla.registry.v15) are used again; V17.2.1 key is merged', () => {
  const v172 = memoryStore({ 'sqla.registry.v15': stamped('SQL Assistant 17.2.0', [tiny('From V17.2')]) }); assert.deepEqual(new SchemaService(v172).schemas().map((s) => s.name), ['From V17.2']);
  const both = memoryStore({ 'sqla.registry.v15': stamped('SQL Assistant 17.2.0', [tiny('From V17.2')]), 'sqla.schemaRegistry.v15': stamped('SQL Assistant 17.2.1', [tiny('From V17.2.1')]) });
  const s = new SchemaService(both); assert.deepEqual(s.schemas().map((x) => x.name).sort(), ['From V17.2', 'From V17.2.1']); assert.equal(both.get('sqla.schemaRegistry.v15'), null); assert.ok(both.get(KEYS.registry).includes('From V17.2.1'));
});
test('ROOT CAUSE B: wrong repository path from V17.2.1 is corrected; a mismatch is reported, not silently re-created', async () => {
  assert.equal(V.normalizeLocation({ ...V.EMPTY_SECRETS, schemaPath: 'schemas/schema-registry.json' }, null).schemaPath, 'sql-assistant-data/schemas/registry.json');
  const repo = memoryRepository({ [PATH]: v170File() }); const d = dev(repo, memoryStore(), 'custom/other.json'); const r = await d.sync.synchronize();
  assert.equal(r.pull.ok, false); assert.equal(r.pull.stage, 'Remote file location'); assert.match(r.pull.fileProblem, /exists at "sql-assistant-data\/schemas\/registry.json"/); assert.equal(repo.files.size, 1);
});
test('corrupt stored data never prevents start-up', () => { const st = memoryStore({ 'sqla.registry.v15': '{bad' }); const s = new SchemaService(st); assert.equal(s.schemas().length, 1); assert.ok(s.loadDiagnostics.unreadable); assert.equal(st.get('sqla.registry.v15.backup'), '{bad'); });
