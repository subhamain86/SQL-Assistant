import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imp, tiny, legacyRepoFile, countDecode } from './helpers.mjs';
const { SchemaService } = await imp('services/schemaService.js');
const { memoryStore } = await imp('services/storage.js');
const { SyncService } = await imp('v17/sync/syncService.js');
const { memoryRepository } = await imp('v17/services/githubClient.js');
const { checkRegistry } = await imp('v17/sync/schemaFormat.js');
const PATH = 'schemas/schema-registry.json';
function device(repo, store = memoryStore()) { const schemas = new SchemaService(store); const sync = new SyncService(schemas, () => repo, store, () => PATH); return { schemas, sync, store }; }

test('Cross-device: V17.0 publishes → V17.2.1 migrates, saves, republishes → another device reads clean data (no loop)', async () => {
  const repo = memoryRepository({ [PATH]: legacyRepoFile() });
  const b = device(repo);
  const r1 = await b.sync.synchronize();
  assert.equal(r1.pull.ok, true); assert.equal(r1.pull.rejected.length, 0);
  assert.deepEqual(r1.pull.migrated.map((m) => m.name), ['AP schema 77']);
  assert.match(r1.pull.messages[0], /^Legacy schema detected\./);
  assert.equal(r1.push.ok, true, 'migrated schema published');
  const remote = JSON.parse(repo.files.get(PATH).text);
  assert.equal(remote.writtenBy, 'SQL Assistant 17.2.1'); assert.equal(remote.formatVersion, 2);
  assert.equal(countDecode(remote.schemas.find((s) => s.name === 'AP schema 77')), 437);
  // the same device synchronizes again: nothing to migrate, nothing to publish
  const r2 = await b.sync.synchronize();
  assert.equal(r2.pull.migrated.length, 0); assert.equal(r2.pull.needsPublish, false); assert.equal(r2.push, null);
  assert.ok(r2.pull.unchanged.includes('AP schema 77'));
  // device C downloads the corrected file
  const c = device(repo);
  const r3 = await c.sync.pull();
  assert.equal(r3.remoteLegacy, false); assert.equal(r3.migrated.length, 0); assert.equal(r3.rejected.length, 0);
  assert.equal(countDecode(c.schemas.schemas().find((s) => s.name === 'AP schema 77')), 437);
});

test('Restart: migrated schema persists; re-sync does not fail again', async () => {
  const repo = memoryRepository({ [PATH]: legacyRepoFile() });
  const store = memoryStore(); const a = device(repo, store);
  await a.sync.pull();
  const restarted = device(repo, store);
  const ap = restarted.schemas.schemas().find((s) => s.name === 'AP schema 77');
  assert.ok(ap.migration, 'migration record persisted'); assert.equal(restarted.schemas.loadDiagnostics.migrated.length, 0, 'not re-migrated on start');
  const again = await restarted.sync.pull();
  assert.equal(again.rejected.length, 0); assert.ok(again.unchanged.includes('AP schema 77'));
});

test('Invalid remote schema: valid ones load, local copy is preserved, publishing is postponed', async () => {
  const local = device(memoryRepository());
  local.schemas.replaceRegistry({ schemas: [tiny('Shared'), tiny('Mine')], activeSchemaId: 's-shared' });
  const broken = { ...tiny('Shared'), tables: [{ name: 'T1', columns: [{ name: 'ID', type: 'NUMBER', nullable: false, decode: [{ rawValue: '', label: 'x' }] }] }] };
  const repo = memoryRepository({ [PATH]: JSON.stringify({ formatVersion: 2, writtenBy: 'SQL Assistant 17.2', schemas: [broken, tiny('Other')] }) });
  const d = device(repo, local.store);
  const before = JSON.stringify(d.schemas.byId('s-shared').tables);
  const r = await d.sync.synchronize();
  assert.equal(r.pull.rejected.length, 1); assert.match(r.pull.messages.join('\n'), /1 of 2 schema\(s\) in the repository failed validation and were not loaded — your local copies were kept unchanged/);
  assert.equal(JSON.stringify(d.schemas.byId('s-shared').tables), before, 'local copy kept unchanged');
  assert.ok(d.schemas.schemas().some((s) => s.name === 'Other'));
  assert.equal(r.push.ok, false); assert.equal(r.push.skipped, 'remote-invalid');
});

test('Multiple legacy schemas + mixture with current schemas in one repository', async () => {
  const file = JSON.stringify({ schemas: [{ name: 'L1', tables: [{ name: 'A', columns: [{ name: 'ID', type: 'NUMBER', nullable: false, primary_key: true, decode: [{ code: '1', label: 'One' }] }] }] }, { name: 'L2', tables: [{ name: 'B', columns: [{ name: 'ID', type: 'NUMBER', nullable: false, primary_key: true, decode: [{ value: 'X', label: 'Ex' }] }] }] }, tiny('Plain')] });
  const d = device(memoryRepository({ [PATH]: file }));
  const r = await d.sync.pull();
  assert.deepEqual(r.migrated.map((m) => m.name).sort(), ['L1', 'L2']); assert.equal(r.rejected.length, 0); assert.equal(r.added.length, 3);
});

test('Manual Schema Update + synchronization + restart (edit and delete are row-wise)', async () => {
  const repo = memoryRepository({ [PATH]: legacyRepoFile() });
  const store = memoryStore(); const a = device(repo, store);
  await a.sync.synchronize();
  const ap = a.schemas.schemas().find((s) => s.name === 'AP schema 77');
  const before = JSON.parse(JSON.stringify(ap));
  const t = ap.tables[0]; const c = t.columns[2];
  const row = { rowId: `${t.name}::${c.name}`, module: t.module, tableName: t.name, tableDescription: t.description, columnName: c.name, columnDescription: c.description, dataType: c.type, length: null, precision: null, nullable: c.nullable, alias: '', decodeText: c.decode.map((d) => `${d.rawValue}=${d.label}`).join('\n'), isPrimaryKey: false, isForeignKey: false, fkTable: '', fkColumn: '' };
  const edited = { ...row, columnDescription: 'Edited on device A', decodeText: `${row.decodeText}\nXX=Extra` };
  const up = a.schemas.upsertRow(ap.id, edited, row.rowId, row);
  assert.equal(up.ok, true, JSON.stringify(up.errors));
  const after = a.schemas.byId(ap.id);
  // only the selected row changed
  after.tables.forEach((tt, i) => { if (i !== 0) assert.deepEqual(tt, before.tables[i]); });
  after.tables[0].columns.forEach((cc, i) => { if (i !== 2) assert.deepEqual(cc, before.tables[0].columns[i]); });
  assert.equal(after.tables[0].columns[2].decode.length, 5);
  const push = await a.sync.synchronize(); assert.equal(push.push.ok, true);
  const b = device(repo); await b.sync.pull();
  const bAp = b.schemas.schemas().find((s) => s.name === 'AP schema 77');
  assert.equal(bAp.tables[0].columns[2].description, 'Edited on device A');
  // restart A and synchronize again
  const a2 = device(repo, store); const again = await a2.sync.synchronize();
  assert.ok(again.pull.unchanged.includes('AP schema 77')); assert.equal(a2.schemas.byId(ap.id).tables[0].columns[2].description, 'Edited on device A');
  // row deletion (column without dependants)
  const del = a2.schemas.deleteRow(ap.id, 'IA_ACTION_LOG::PARENT_ID');
  assert.equal(del.ok, true); assert.ok(!a2.schemas.byId(ap.id).tables[0].columns.some((x) => x.name === 'PARENT_ID'));
  await a2.sync.synchronize(); const b2 = device(repo); await b2.sync.pull();
  assert.ok(!b2.schemas.schemas().find((s) => s.name === 'AP schema 77').tables[0].columns.some((x) => x.name === 'PARENT_ID'));
  // dependency-protected delete is blocked unless cascaded
  const blocked = a2.schemas.deleteRow(ap.id, 'ADM_USER_DATA::ID');
  assert.equal(blocked.ok, false); assert.ok(blocked.dependencies.length > 10);
});

test('Local storage written by an older version is migrated once on load', () => {
  const store = memoryStore({ 'sqla.schemaRegistry.v15': legacyRepoFile() });
  const s = new SchemaService(store);
  assert.equal(s.loadDiagnostics.migrated.length, 1); assert.equal(s.schemas().length, 3);
  assert.equal(JSON.parse(store.get('sqla.schemaRegistry.v15')).writtenBy, 'SQL Assistant 17.2.1');
  const s2 = new SchemaService(store); assert.equal(s2.loadDiagnostics.migrated.length, 0);
});

test('Conflicting edits are detected and resolvable; repository corruption never overwrites local data', async () => {
  const repo = memoryRepository({ [PATH]: JSON.stringify({ formatVersion: 2, writtenBy: 'SQL Assistant 17.2.1', schemas: [tiny('Shared')] }) });
  const a = device(repo); const b = device(repo); await a.sync.pull(); await b.sync.pull();
  const sa = a.schemas.schemas().find((s) => s.name === 'Shared'); a.schemas.saveSchema({ ...sa, tables: [{ ...sa.tables[0], description: 'A' }] }); await a.sync.push();
  const sb = b.schemas.schemas().find((s) => s.name === 'Shared'); b.schemas.saveSchema({ ...sb, tables: [{ ...sb.tables[0], description: 'B' }] });
  const r = await b.sync.pull(); assert.equal(r.conflicts.length, 1);
  assert.equal(b.sync.resolveConflict(r.conflicts[0].id, 'take-remote'), true); assert.equal(b.schemas.schemas().find((s) => s.name === 'Shared').tables[0].description, 'A');
  repo.files.set(PATH, { text: '{broken', sha: 'zzz' });
  const bad = await b.sync.pull(); assert.equal(bad.ok, false); assert.match(bad.fileProblem, /not valid JSON.*kept unchanged/);
  assert.equal(b.schemas.schemas().find((s) => s.name === 'Shared').tables[0].description, 'A');
});

test('Empty repository: first publish creates a stamped file', async () => {
  const repo = memoryRepository(); const d = device(repo);
  const r = await d.sync.synchronize(); assert.equal(r.pull.remoteMissing, true); assert.equal(r.push.ok, true);
  assert.equal(checkRegistry({ text: repo.files.get(PATH).text }).writer.legacy, false);
});
