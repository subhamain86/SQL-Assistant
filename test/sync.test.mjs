import { test } from 'node:test'; import assert from 'node:assert/strict';
import { imp, tiny, AP77, v170File, v170MangledFile, v170LossyFile, stampedMangledFile, stamped, countDecode } from './helpers.mjs';
const F = await imp('v17/sync/schemaFormat.js'); const SY = await imp('v17/sync/syncService.js');
const { SchemaService } = await imp('services/schemaService.js'); const { memoryStore, KEYS } = await imp('services/storage.js'); const { memoryRepository } = await imp('v17/services/githubClient.js'); const V = await imp('v17/services/secretVault.js');
const PATH = V.CANONICAL_SCHEMA_PATH;
const dev = (repo, store = memoryStore(), path = PATH) => { const schemas = new SchemaService(store); return { store, schemas, sync: new SY.SyncService(schemas, () => repo, store, () => path) }; };
const ap = (d) => d.schemas.schemas().find((s) => s.name === 'AP schema 77');

test('S1 current valid schema: Download → Validate → Save, no migration', () => { const r = F.checkRegistry({ text: stamped('SQL Assistant 17.3.1', [tiny('A')]) }); assert.equal(r.schemas[0].migrationStatus, 'current'); assert.equal(r.validSchemas.length, 1); });
test('S2 V17.1 / V17.2 / V17.2.1 / V17.3 stamped files read as current', () => { for (const w of ['SQL Assistant 17.1.0', 'SQL Assistant 17.2', 'SQL Assistant 17.2.1', 'SQL Assistant 17.3.0']) { const r = F.checkRegistry({ text: stamped(w, [tiny('A'), tiny('B')]) }); assert.equal(r.invalidSchemas.length, 0, w); assert.equal(r.writer.legacy, false); } });
test('S3/S4 V17.0 file (no writer stamp) → legacy → migrated → valid; all 437 decode entries; AP schema 77 structure intact', () => {
  for (const f of [v170File(), v170MangledFile()]) { const r = F.checkRegistry({ text: f }); assert.equal(r.writer.legacy, true); assert.equal(r.invalidSchemas.length, 0, '0 of 3 fail (was 1 of 3)'); const s = r.schemas[2]; assert.equal(s.migrationStatus, 'migrated'); assert.equal(countDecode(s.schema), 437); assert.equal(s.migrationNotes.filter((n) => n.rule === 'L1').length, 437); assert.equal(s.schema.tables.length, 77);
    assert.equal(`${s.schema.tables[0].name}.${s.schema.tables[0].columns[2].name}`, 'IA_ACTION_LOG.ROOT_DOCUMENT_TYPE');
    assert.deepEqual(s.schema.tables[0].columns[2].decode.map((x) => x.rawValue), ['Invoice.Domain.Invoice', 'PP.Domain.PayPlan', 'AC', 'PP.BusinessLogic.Workflow.PayPlanDocument']); }
});
test('ROOT CAUSE C: a V17.1/V17.2 device relaying rawValue:"" beside code in a STAMPED file no longer fails', () => {
  const migrated = F.checkRegistry({ text: v170File() }).validSchemas[2]; const relayed = structuredClone(migrated); relayed.tables.forEach((t) => t.columns.forEach((c) => { if (c.decode) c.decode = c.decode.map((d) => ({ rawValue: '', code: d.rawValue, label: d.label })); }));
  for (const w of ['SQL Assistant 17.1.0', 'SQL Assistant 17.2']) { const r = F.checkRegistry({ text: stamped(w, [tiny('Core A'), relayed]) }); assert.equal(r.invalidSchemas.length, 0, w); assert.equal(countDecode(r.validSchemas[1]), 437); }
  assert.equal(F.checkRegistry({ text: stampedMangledFile('SQL Assistant 17.2') }).invalidSchemas[0].errors.every((e) => e.code === 'FK_TABLE_NOT_FOUND'), true, 'stamped files keep strict FK validation (V17.1 root cause)'); });
test('S5 empty decode values follow the defined rules; validator not weakened', () => {
  const s = F.checkRegistry({ text: v170LossyFile() }).validSchemas[0]; assert.equal(countDecode(s), 0); assert.equal(F.legacyLeftovers(s).unmappedLabels, 437, 'labels preserved, no codes invented'); assert.equal(F.recoverDecodeFromSource(s, AP77).restored, 437);
  const ph = F.checkRegistry({ value: { schemas: [{ name: 'P', tables: [{ name: 'T', columns: [{ name: 'ID', type: 'NUMBER', nullable: false, primary_key: true, decode: [{ rawValue: '', label: '' }, { code: '1', label: 'One' }, { code: '1', label: 'One' }] }] }] }] } }).validSchemas[0];
  assert.deepEqual(ph.tables[0].columns[0].decode, [{ rawValue: '1', label: 'One' }], 'L2 placeholder removed, L4 duplicate removed');
  const bad = tiny('X'); bad.tables[0].columns[1].decode = [{ rawValue: '', label: 'oops' }]; const r = F.checkRegistry({ text: stamped('SQL Assistant 17.2.1', [bad]) });
  assert.equal(r.invalidSchemas[0].errors[0].path, 'schemas[0].tables[0].columns[1].decode[0].rawValue'); assert.match(r.invalidSchemas[0].errors[0].message, /Column "T1.STATUS" has a decode entry \(#1\) with an empty raw value/);
});
test('S6 large number of decode entries (1 200) all processed', () => { const cols = Array.from({ length: 100 }, (_, i) => ({ name: `C${i}`, type: 'NUMBER', nullable: true, decode: Array.from({ length: 12 }, (_, j) => ({ rawValue: '', code: `${j}`, label: `L${j}` })) })); const r = F.checkRegistry({ value: { schemas: [{ name: 'Big', tables: [{ name: 'T', columns: [{ name: 'ID', type: 'NUMBER', nullable: false, primary_key: true }, ...cols] }] }] } }); assert.equal(countDecode(r.validSchemas[0]), 1200); });
test('S7/S8 multi-schema scenarios 1–5 processed independently', () => {
  const invalid = { name: 'Broken', tables: [{ name: 'T', columns: [{ name: '', type: 'NUMBER', nullable: true }] }] }; const legacyB = { name: 'Legacy B', tables: [{ name: 'B', columns: [{ name: 'ID', type: 'NUMBER', nullable: false, primary_key: true, decode: [{ value: 'X', label: 'Ex' }] }] }] };
  [[stamped('SQL Assistant 17.3.1', [tiny('A'), tiny('B'), tiny('C')]), 3, 0, 0], [JSON.stringify({ schemas: [tiny('A'), tiny('B'), { ...AP77, name: 'AP schema 77' }] }), 3, 1, 0], [JSON.stringify({ schemas: [tiny('A'), tiny('B'), invalid] }), 2, 0, 1], [JSON.stringify({ schemas: [{ ...AP77, name: 'AP schema 77' }, legacyB] }), 2, 2, 0], [v170MangledFile(), 3, 1, 0]]
    .forEach(([f, valid, migrated, rejected], i) => { const r = F.checkRegistry({ text: f }); assert.equal(r.validSchemas.length, valid, `scenario ${i + 1}`); assert.equal(r.migratedSchemas.length, migrated, `scenario ${i + 1}`); assert.equal(r.invalidSchemas.length, rejected, `scenario ${i + 1}`); });
});
test('S9/S10/S13 Sync #1 → #2 → #3 → restart → sync: stable; Active Schema refreshed; another device reads clean data', async () => {
  const repo = memoryRepository({ [PATH]: v170MangledFile() }); const st = memoryStore(); const a = dev(repo, st);
  const r1 = await a.sync.synchronize(); assert.equal(r1.pull.ok, true); assert.equal(r1.pull.migrated.length, 1); assert.equal(r1.push.ok, true); assert.equal(r1.pull.activeChanged, true, 'Active Schema refreshed from the repository'); assert.equal(a.schemas.active().name, 'Core A');
  const pub = JSON.parse(repo.files.get(PATH).text); assert.equal(pub.writtenBy, 'SQL Assistant 17.3.1'); assert.equal(pub.formatVersion, 2); assert.equal(countDecode(pub.schemas.find((s) => s.name === 'AP schema 77')), 437);
  assert.ok(!pub.schemas.some((s) => s.name === 'AP / P2P Core'), 'untouched built-in default schema is not pushed into the shared repository');
  for (let i = 2; i <= 3; i++) { const r = await a.sync.synchronize(); assert.equal(r.pull.ok, true); assert.equal(r.pull.migrated.length, 0); assert.equal(r.pull.rejected.length, 0); assert.equal(r.push, null, `sync #${i}`); }
  const restarted = dev(repo, st); assert.equal(countDecode(ap(restarted)), 437); const r4 = await restarted.sync.synchronize(); assert.equal(r4.pull.ok, true); assert.equal(r4.push, null); assert.ok(r4.pull.unchanged.includes('AP schema 77'));
  const b = dev(repo); const rb = await b.sync.pull(); assert.equal(rb.remoteLegacy, false); assert.equal(rb.migrated.length, 0); assert.equal(countDecode(ap(b)), 437);
});
test('S11/S12 failed migration and local schema protection (exact stage, location, writer; Active Schema kept)', async () => {
  const bad = { name: 'Core A', tables: [{ name: 'T1', columns: [{ name: 'ID', type: 'NUMBER', nullable: false, decode: 7 }] }] };
  const d = dev(memoryRepository({ [PATH]: JSON.stringify({ schemas: [bad, tiny('Fresh')] }) })); d.schemas.replaceRegistry({ schemas: [tiny('Core A')], activeSchemaId: 's-core-a' }); const before = SY.contentHash(d.schemas.schemas()[0]);
  const r = await d.sync.synchronize(); assert.equal(r.pull.rejected.length, 1); assert.equal(r.pull.stage, 'Validation');
  assert.match(SY.rejectionMessage(r.pull.rejected[0]), /^Legacy schema migration could not be completed\.\nSchema: Core A\nWritten by: SQL Assistant V17\.0 or older \(no writer stamp\)\nLocation: T1\.ID\nReason: .*decode value that is not a list/);
  assert.equal(SY.contentHash(d.schemas.schemas().find((s) => s.name === 'Core A')), before); assert.equal(d.schemas.registry().activeSchemaId, 's-core-a'); assert.ok(d.schemas.schemas().some((s) => s.name === 'Fresh')); assert.notEqual(r.push && r.push.ok, true);
  for (const [text, stage] of [['<html>Sign in</html>', 'Parse'], ['{broken', 'Parse'], [JSON.stringify({ formatVersion: 3, writtenBy: 'SQL Assistant 18', schemas: [] }), 'Format detection']]) { const e = dev(memoryRepository({ [PATH]: text }), d.store); const x = await e.sync.pull(); assert.equal(x.ok, false); assert.equal(x.stage, stage); assert.equal(SY.contentHash(e.schemas.schemas().find((s) => s.name === 'Core A')), before); }
  const unconf = new SY.SyncService(d.schemas, () => null, d.store, () => PATH); assert.equal((await unconf.pull()).stage, 'Configuration');
});
test('publish gate: invalid local schema never reaches the repository', async () => { const repo = memoryRepository(); const d = dev(repo); const s = tiny('Bad'); s.tables[0].columns[1].decode = [{ rawValue: '', label: 'x' }]; d.schemas['reg'].schemas.push(s); const r = await d.sync.push(); assert.equal(r.ok, false); assert.equal(r.stage, 'Publish gate'); assert.equal(repo.files.size, 0); });
test('ROOT CAUSE A: schemas stored by V17.2 (sqla.registry.v15) load; V17.2.1–V17.3 key merged back', () => {
  assert.deepEqual(new SchemaService(memoryStore({ 'sqla.registry.v15': stamped('SQL Assistant 17.2', [tiny('From V17.2')]) })).schemas().map((s) => s.name), ['From V17.2']);
  const both = memoryStore({ 'sqla.registry.v15': stamped('SQL Assistant 17.2', [tiny('From V17.2')]), 'sqla.schemaRegistry.v15': stamped('SQL Assistant 17.2.1', [tiny('From V17.2.1')]) });
  const s = new SchemaService(both); assert.deepEqual(s.schemas().map((x) => x.name).sort(), ['From V17.2', 'From V17.2.1']); assert.equal(both.get('sqla.schemaRegistry.v15'), null); assert.ok(both.get(KEYS.registry).includes('From V17.2.1'));
});
test('ROOT CAUSE B: repository location — V17.2 owner/repo/path restored; wrong path corrected; mismatch reported, not re-created', async () => {
  assert.equal(V.normalizeLocation({ githubRepo: 'org/data', schemaPath: 'schemas/schema-registry.json' }, null).schemaPath, PATH);
  assert.deepEqual([V.normalizeLocation({ githubRepo: 'org/data' }, null).githubOwner, V.normalizeLocation({ githubRepo: 'org/data' }, null).githubRepo], ['org', 'data']);
  assert.equal(V.normalizeLocation({}, { owner: 'acme', repo: 'store', branch: 'dev', path: 'x/reg.json' }).schemaPath, 'x/reg.json');
  const repo = memoryRepository({ [PATH]: v170File() }); const r = await dev(repo, memoryStore(), 'custom/other.json').sync.synchronize();
  assert.equal(r.pull.ok, false); assert.equal(r.pull.stage, 'Remote file location'); assert.match(r.pull.fileProblem, /exists at "sql-assistant-data\/schemas\/registry.json"/); assert.equal(repo.files.size, 1);
});
test('local load: corrupt registry backed up, never blocks start-up; legacy local data migrated once', () => {
  const st = memoryStore({ 'sqla.registry.v15': '{bad' }); const s = new SchemaService(st); assert.equal(s.schemas().length, 2, 'the two V17.2 default schemas are loaded'); assert.ok(s.loadDiagnostics.unreadable); assert.equal(st.get(s.loadDiagnostics.backupKey), '{bad');
  const st2 = memoryStore({ 'sqla.registry.v15': v170File() }); assert.equal(new SchemaService(st2).loadDiagnostics.migrated.length, 1); assert.equal(new SchemaService(st2).loadDiagnostics.migrated.length, 0);
});
