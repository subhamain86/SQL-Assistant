/* V17.1 — schema synchronisation investigation & regression suite.
 * Every "device" is a fresh copy of the app modules with its own localStorage; all devices talk to one fake GitHub. */
const test = require('node:test'); const assert = require('node:assert/strict');
const { loadDevice, fakeGitHub, REPO, PATH, unlock, emptyState, B } = require('./helpers.cjs');
const clone = (v) => JSON.parse(JSON.stringify(v));
const { CORE_SCHEMA, EXTENDED_SCHEMA } = require(`${B}/data/defaultSchemas`);
const TOKEN = 'ghp_TestToken000000000000000000000000';

/** Exactly what the V16.2 Manual Schema Update "Delete" did: remove the column (and an emptied table) with NO dependency check. */
function v16LegacyDeleteRow(schema, table, column) { const t = schema.tables.find((x) => x.name === table); t.columns = t.columns.filter((c) => c.name !== column); if (!t.columns.length) schema.tables = schema.tables.filter((x) => x.name !== table); return schema; }
/** A registry as a V16.x device stored and published it after deleting VENDOR.VENDOR_ID in Manual Schema Update. */
function legacyBrokenRegistry() { const core = v16LegacyDeleteRow(clone(CORE_SCHEMA), 'VENDOR', 'VENDOR_ID'); core.updatedAt = '2026-09-01T10:00:00.000Z'; return { schemas: [core, clone(EXTENDED_SCHEMA)], activeSchemaId: core.id }; }

// ------------------------------------------------------------------------------------------- root cause
test('ROOT CAUSE reproduced: a V16-style delete leaves dangling foreign keys that the pull validator rejects', () => {
  const { fmt } = loadDevice();
  const report = fmt.checkRegistry({ text: JSON.stringify(legacyBrokenRegistry()) });
  assert.equal(report.fileProblem, null, 'the file itself is fine');
  assert.equal(report.invalidSchemas.length, 1); assert.equal(report.validSchemas.length, 1, 'the other schema is valid');
  const errs = report.invalidSchemas[0].errors; assert.ok(errs.length >= 2);
  assert.ok(errs.every((e) => e.code === 'FK_COLUMN_NOT_FOUND' && e.repairable));
  const msgs = errs.map(fmt.describeIssue).join('\n');
  assert.match(msgs, /INVOICE_HEADER\.VENDOR_ID" is a foreign key to "VENDOR\.VENDOR_ID", but column "VENDOR_ID" does not exist in table "VENDOR"/);
  assert.match(msgs, /\[schemas\[0\]\.tables\[2\] \(INVOICE_HEADER\)\.columns\[1\] \(VENDOR_ID\)\.references\]/, 'exact JSON path is reported');
  assert.ok(report.invalidSchemas[0].warnings.some((w) => w.code === 'RELATIONSHIP_DANGLING'), 'dangling relationships are reported too');
});
test('ROOT CAUSE fixed (publish gate): invalid local data is never pushed; the exact record is named; the remote file is untouched', async () => {
  const gh = fakeGitHub(); const good = JSON.stringify({ schemas: [clone(CORE_SCHEMA)], activeSchemaId: CORE_SCHEMA.id }); gh.put(REPO, PATH, good);
  const storage = new Map([['sqla.registry.v15', JSON.stringify(legacyBrokenRegistry())]]);
  const A = loadDevice(storage); await unlock(A);
  const health = A.schemaService.getLocalHealth(); assert.equal(health.filter((h) => !h.valid).length, 1, 'legacy local data is loaded (not dropped) and flagged');
  await A.syncService.pullRegistryFromGitHub(); // obtain sha
  const r = await A.syncService.pushRegistryToGitHub();
  assert.equal(r.ok, false); assert.equal(r.blockedByValidation, true);
  assert.match(r.error, /Not published: 1 local schema\(s\) do not pass validation/); assert.match(r.error, /INVOICE_HEADER\.VENDOR_ID/); assert.match(r.error, /Repair/);
  assert.equal(gh.get(REPO, PATH).content, good, 'repository content unchanged');
  assert.doesNotMatch(r.error, new RegExp(TOKEN));
});
test('per-schema verdict: an invalid remote schema is rejected with reasons, valid ones still load, and the valid local copy is preserved', async () => {
  const gh = fakeGitHub(); const remote = legacyBrokenRegistry(); remote.schemas.push({ ...clone(CORE_SCHEMA), id: 'schema-new-remote', name: 'New Remote Schema', status: 'inactive' }); gh.put(REPO, PATH, JSON.stringify(remote));
  const Bdev = loadDevice(); await unlock(Bdev);
  const before = JSON.stringify(Bdev.schemaService.getSchemaById(CORE_SCHEMA.id));
  const r = await Bdev.syncService.pullRegistryFromGitHub();
  assert.equal(r.ok, true); assert.equal(r.rejected.length, 1); assert.equal(r.rejected[0].schemaName, 'AP / P2P Core'); assert.equal(r.rejected[0].localExists, true); assert.equal(r.rejected[0].localValid, true);
  assert.match(r.warning, /1 of 3 schema\(s\) in the repository failed validation and were not loaded — your local copies were kept unchanged/);
  assert.match(r.warning, /VENDOR\.VENDOR_ID/); assert.doesNotMatch(r.warning, /^Schema synchronization failed: the remote schema file failed validation$/);
  assert.equal(JSON.stringify(Bdev.schemaService.getSchemaById(CORE_SCHEMA.id)), before, 'local copy untouched');
  assert.ok(Bdev.schemaService.getSchemaById('schema-new-remote'), 'valid schema from the same file was loaded');
  assert.equal(Bdev.syncService.getLastError(), r.warning, 'the indicator shows the real reason');
});
test('recovery: explicit local repair → publish → the other device synchronises cleanly and generates SQL from the synced schema', async () => {
  const gh = fakeGitHub(); gh.put(REPO, PATH, JSON.stringify(legacyBrokenRegistry()));
  const A = loadDevice(new Map([['sqla.registry.v15', JSON.stringify(legacyBrokenRegistry())]])); await unlock(A);
  await A.syncService.pullRegistryFromGitHub();
  const rep = await A.schemaService.repairLocalSchema(CORE_SCHEMA.id);
  assert.equal(rep.ok, true); assert.ok(rep.changes.some((c) => /Unlinked foreign key INVOICE_HEADER\.VENDOR_ID → VENDOR\.VENDOR_ID/.test(c))); assert.ok(rep.changes.some((c) => /Removed relationship/.test(c)));
  const repaired = A.schemaService.getSchemaById(CORE_SCHEMA.id); assert.equal(repaired.tables.length, CORE_SCHEMA.tables.length, 'no table removed'); assert.ok(repaired.tables.find((t) => t.name === 'INVOICE_HEADER').columns.some((c) => c.name === 'VENDOR_ID'), 'column kept');
  const push = await A.syncService.pushRegistryToGitHub(); assert.equal(push.ok, true, push.error);
  const pushed = JSON.parse(gh.get(REPO, PATH).content); assert.equal(pushed.formatVersion, 2); assert.match(pushed.writtenBy, /17\.1\.0/);
  const Bdev = loadDevice(); await unlock(Bdev);
  const r = await Bdev.syncService.pullRegistryFromGitHub(); assert.equal(r.ok, true); assert.equal((r.rejected || []).length, 0); assert.equal(Bdev.syncService.getLastError(), null);
  const disc = await Bdev.syncService.discoverPublicRegistry('test'); assert.equal(disc.ok, true); assert.equal((disc.rejected || []).length, 0);
});
test('recovery: local invalid + remote valid → "Restore from repository" offers the valid copy; choosing it restores a valid local schema', async () => {
  const gh = fakeGitHub(); gh.put(REPO, PATH, JSON.stringify({ schemas: [clone(CORE_SCHEMA)], activeSchemaId: CORE_SCHEMA.id }));
  const A = loadDevice(new Map([['sqla.registry.v15', JSON.stringify(legacyBrokenRegistry())]])); await unlock(A);
  const res = await A.syncService.restoreFromRepository(CORE_SCHEMA.id); assert.equal(res.ok, true, res.message);
  const c = A.syncService.getPendingConflicts().find((x) => x.schemaId === CORE_SCHEMA.id); assert.ok(c);
  assert.equal(A.syncService.resolvePendingConflict(c.id, 'remote').ok, true);
  assert.equal(A.schemaService.getLocalHealth().every((h) => h.valid), true);
});
test('recovery: both copies invalid → neither is changed and both reasons are reported', async () => {
  const gh = fakeGitHub(); gh.put(REPO, PATH, JSON.stringify(legacyBrokenRegistry()));
  const storage = new Map([['sqla.registry.v15', JSON.stringify(legacyBrokenRegistry())]]); const A = loadDevice(storage); await unlock(A);
  const before = A.storage.get('sqla.registry.v15');
  const res = await A.syncService.restoreFromRepository(CORE_SCHEMA.id); assert.equal(res.ok, false); assert.match(res.message, /also invalid, so neither copy was changed/);
  const pull = await A.syncService.pullRegistryFromGitHub(); assert.equal(pull.rejected[0].localValid, false);
  assert.equal(JSON.stringify(JSON.parse(A.storage.get('sqla.registry.v15')).schemas[0].tables), JSON.stringify(JSON.parse(before).schemas[0].tables));
});
test('recovery: rejected remote copy can be explicitly repaired and reviewed as a pending conflict', async () => {
  const gh = fakeGitHub(); gh.put(REPO, PATH, JSON.stringify(legacyBrokenRegistry()));
  const Bdev = loadDevice(); await unlock(Bdev); await Bdev.syncService.pullRegistryFromGitHub();
  const r = Bdev.syncService.loadRepairedRemoteSchema(CORE_SCHEMA.id); assert.equal(r.ok, true); assert.ok(r.changes.length >= 2);
  assert.ok(Bdev.syncService.getPendingConflicts().some((c) => c.schemaId === CORE_SCHEMA.id && /repaired/.test(c.remoteVersion)));
  assert.equal(Bdev.syncService.getRemoteRejections().length, 0);
});

// ------------------------------------------------------------------------------------------- file-level problems
test('remote file problems produce specific messages (never the bare generic text)', () => {
  const { fmt } = loadDevice(); const chk = (t) => fmt.checkRegistry({ text: t }).fileProblem;
  assert.equal(chk('').code, 'EMPTY'); assert.equal(chk('   \n').code, 'EMPTY');
  assert.equal(chk('<!DOCTYPE html><html>Sign in</html>').code, 'HTML');
  assert.equal(chk('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12').code, 'LFS_POINTER');
  assert.match(chk('{\n<<<<<<< HEAD\n"schemas": []\n=======\n>>>>>>> other\n}').message, /merge-conflict markers .* line 2/);
  const tc = chk('{\n  "schemas": [\n    {"id": "a",},\n  ]\n}'); assert.equal(tc.code, 'INVALID_JSON'); assert.match(tc.message, /line 3, column \d+/); assert.match(tc.message, /trailing comma/);
  assert.match(chk("{'schemas': []}").message, /double quotes/);
  assert.match(chk('{"schemas": [').message, /truncated|line 1/);
  assert.match(chk('{"schemas": [{"id": "a", "name": “x”}]}').message, /typographic quote/);
  assert.equal(chk('{"formatVersion": 9, "schemas": []}').code, 'UNSUPPORTED_VERSION');
  assert.match(chk('{"hello": 1}').message, /not a schema registry.*"hello"/);
  assert.equal(chk('\uFEFF{"schemas": [], "activeSchemaId": ""}'), null, 'a byte-order mark is accepted');
});

// ------------------------------------------------------------------------------------------- compatibility
test('legacy formats normalise LOSSLESSLY and validate: V15 bare list, single schema, pre-V16 property names, maps, text flags', () => {
  const { fmt } = loadDevice();
  const legacySchema = { name: 'Legacy ERP', tables: { ORDERS: { columns: { ORDER_ID: { dataType: 'NUMBER(10)', isPrimaryKey: 'Y', nullable: 'N' }, STATUS: { dataType: 'VARCHAR2(1)', decode: { O: 'Open', C: 'Closed' }, length: '1' }, CUSTOMER_ID: { data_type: 'NUMBER', isForeignKey: 'true', references: 'CUSTOMER.CUSTOMER_ID' } } }, CUSTOMER: { module: 'Sales', columns: [{ columnName: 'CUSTOMER_ID', type: 'NUMBER', primaryKey: true }, { name: 'NAME', type: 'VARCHAR2(100)', description: null, decode: 'A=Active;I=Inactive' }] } } };
  for (const shape of [[legacySchema], legacySchema, { schemas: [legacySchema] }, { registry: { schemas: [legacySchema] } }]) {
    const r = fmt.checkRegistry({ value: clone(shape) }); assert.equal(r.fileProblem, null); assert.equal(r.invalidSchemas.length, 0, JSON.stringify(r.invalidSchemas[0]?.errors));
    const s = r.validSchemas[0]; const orders = s.tables.find((t) => t.name === 'ORDERS'); const cust = s.tables.find((t) => t.name === 'CUSTOMER');
    assert.equal(orders.module, 'General'); assert.equal(cust.module, 'Sales');
    const st = orders.columns.find((c) => c.name === 'STATUS'); assert.deepEqual(st.decode, [{ rawValue: 'O', label: 'Open' }, { rawValue: 'C', label: 'Closed' }]); assert.equal(st.length, 1); assert.equal(st.type, 'VARCHAR2(1)');
    const fk = orders.columns.find((c) => c.name === 'CUSTOMER_ID'); assert.equal(fk.isForeignKey, true); assert.deepEqual(fk.references, { table: 'CUSTOMER', column: 'CUSTOMER_ID' });
    const pk = orders.columns.find((c) => c.name === 'ORDER_ID'); assert.equal(pk.isPrimaryKey, true); assert.equal(pk.nullable, false); assert.equal(pk.label, 'ORDER_ID');
    assert.equal(cust.columns[1].description, ''); assert.equal(cust.columns[1].decode.length, 2);
    assert.ok(r.schemas[0].notes.length > 3, 'every conversion is reported');
  }
});
test('current-format data (V16.x / V17.0 / V17.1) round-trips with zero conversions and zero changes', () => {
  const { fmt } = loadDevice();
  const v17 = { schemas: [clone(CORE_SCHEMA), clone(EXTENDED_SCHEMA)], activeSchemaId: CORE_SCHEMA.id, activeSchemaUpdatedAt: '2026-09-30T00:00:00.000Z' };
  for (const text of [JSON.stringify(v17), fmt.serializeRegistry(v17)]) {
    const r = fmt.checkRegistry({ text }); assert.equal(r.invalidSchemas.length, 0); assert.deepEqual(r.schemas.flatMap((s) => s.notes), []);
    assert.deepEqual(r.validSchemas.map((s) => s.tables), v17.schemas.map((s) => s.tables)); assert.equal(r.activeSchemaUpdatedAt, v17.activeSchemaUpdatedAt);
  }
  const out = JSON.parse(fmt.serializeRegistry(v17)); assert.deepEqual(Object.keys(out).sort(), ['activeSchemaId', 'activeSchemaUpdatedAt', 'formatVersion', 'schemas', 'writtenBy']); assert.ok(Array.isArray(out.schemas), 'still readable by V17.0 (same "schemas" list)');
});
test('validation stays strict: malformed records are rejected with paths (nothing is silently dropped)', () => {
  const { fmt } = loadDevice();
  const bad = { schemas: [{ id: 's', name: 'Bad', tables: [{ name: 'T', columns: [{ name: 'A', type: 'NUMBER', isPrimaryKey: true }, { name: 'A', type: 'NUMBER' }, { name: '', type: 'X' }, { name: 'B' }, { name: 'C\u200bD', type: 'NUMBER' }, { name: 'E', type: 'NUMBER', length: -1 }, { name: 'F', type: 'NUMBER', isPrimaryKey: 'maybe' }, 'oops', { name: 'G', type: 'VARCHAR', decode: [{ rawValue: '', label: 'x' }, { rawValue: 'Q', label: 'q' }, { rawValue: 'q', label: 'Q2' }] }] }, { name: 't', columns: [] }, { name: 'V', objectType: 'MATERIALIZED', columns: [] }], relationships: [{ id: 'r', fromTable: 'T', toTable: 'X' }] }] };
  const r = fmt.checkRegistry({ value: bad }); const codes = r.invalidSchemas[0].errors.map((e) => e.code);
  for (const c of ['DUPLICATE_COLUMN', 'COLUMN_NAME_MISSING', 'TYPE_MISSING', 'COLUMN_NAME_CHARS', 'NEGATIVE_NUMBER', 'BOOLEAN_INVALID', 'COLUMN_NOT_OBJECT', 'DECODE_EMPTY_RAW', 'DECODE_DUPLICATE_RAW', 'DUPLICATE_TABLE', 'OBJECT_TYPE_INVALID', 'RELATIONSHIP_INCOMPLETE']) assert.ok(codes.includes(c), `missing ${c} in ${codes}`);
  assert.ok(r.invalidSchemas[0].errors.every((e) => e.path.startsWith('schemas[0]')));
  assert.equal(fmt.checkRegistry({ value: { schemas: [{ id: 'x', name: 'x', tables: 'nope' }] } }).invalidSchemas[0].errors[0].code, 'TABLES_MISSING');
  assert.equal(fmt.checkRegistry({ value: { schemas: [clone(CORE_SCHEMA), clone(CORE_SCHEMA)] } }).invalidSchemas[0].errors[0].code, 'DUPLICATE_SCHEMA_ID');
  const rep = fmt.repairSchema(r.invalidSchemas[0].schema); assert.ok(rep.remainingErrors.length > 0, 'non-referential problems are never "repaired" away');
});

// ------------------------------------------------------------------------------------------- Manual Schema Update ↔ sync
test('Manual Schema Update output always passes the repository validator (edit, add, rename, cascade delete) and syncs to another device', async () => {
  const gh = fakeGitHub(); const A = loadDevice(); await unlock(A);
  const svc = A.schemaService; const id = CORE_SCHEMA.id;
  const row = (t, c) => svc.getFlattenedRows(id, null, t).find((r) => r.columnName === c);
  assert.deepEqual(await svc.upsertRow(id, { ...row('VENDOR', 'COUNTRY'), columnDescription: 'ISO 3166 «country» — "two letters" \\ ✓' }, 'VENDOR::COUNTRY', row('VENDOR', 'COUNTRY')), []);
  assert.deepEqual(await svc.upsertRow(id, { ...row('VENDOR', 'COUNTRY'), rowId: '', columnName: 'TAX_ID', columnDescription: '', dataType: 'VARCHAR2(30 CHAR)', length: null, alias: '', decodeText: '' }, null), []);
  assert.deepEqual(await svc.upsertRow(id, { ...row('INVOICE_HEADER', 'INVOICE_AMOUNT'), columnName: 'GROSS_AMOUNT' }, 'INVOICE_HEADER::INVOICE_AMOUNT'), []);
  assert.equal((await svc.deleteRow(id, 'VENDOR::VENDOR_ID')).requiresCascade, true);
  assert.equal((await svc.deleteRow(id, 'ORGANIZATION::ORG_ID', { cascade: true })).ok, true);
  assert.equal((await svc.deleteRow(id, 'VENDOR::DUNS_NUMBER')).ok, true);
  const report = A.fmt.checkRegistry({ text: A.fmt.serializeRegistry(svc.getRegistry()) }); assert.equal(report.invalidSchemas.length, 0, JSON.stringify(report.invalidSchemas.map((s) => s.errors)));
  const push = await A.syncService.pushRegistryToGitHub(); assert.equal(push.ok, true, push.error);
  const Bdev = loadDevice(); await unlock(Bdev); const pull = await Bdev.syncService.pullRegistryFromGitHub(); assert.equal(pull.ok, true); assert.equal((pull.rejected || []).length, 0);
  // device B had the untouched default copy (never synchronised) → the change arrives as a conflict to confirm
  const c = Bdev.syncService.getPendingConflicts().find((x) => x.schemaId === id); assert.ok(c); assert.equal(Bdev.syncService.resolvePendingConflict(c.id, 'remote').ok, true);
  const v = Bdev.schemaService.getSchemaById(id).tables.find((t) => t.name === 'VENDOR');
  assert.equal(v.columns.find((x) => x.name === 'COUNTRY').description, 'ISO 3166 «country» — "two letters" \\ ✓'); assert.ok(v.columns.some((x) => x.name === 'TAX_ID')); assert.equal(v.columns.some((x) => x.name === 'DUNS_NUMBER'), false);
  // later edits on A fast-forward on B (B has no unsynced edits) — no conflict needed
  assert.deepEqual(await svc.upsertRow(id, { ...svc.getFlattenedRows(id, null, 'VENDOR').find((r) => r.columnName === 'TAX_ID'), columnDescription: 'Tax registration' }, 'VENDOR::TAX_ID'), []);
  await A.syncService.pullRegistryFromGitHub(); assert.equal((await A.syncService.pushRegistryToGitHub()).ok, true);
  const pull2 = await Bdev.syncService.pullRegistryFromGitHub(); assert.deepEqual(pull2.conflicts, []); assert.ok(pull2.updatedSchemas.includes('AP / P2P Core'));
  assert.equal(Bdev.schemaService.getSchemaById(id).tables.find((t) => t.name === 'VENDOR').columns.find((x) => x.name === 'TAX_ID').description, 'Tax registration');
});
test('Manual Schema Update: legacy problems elsewhere no longer block unrelated edits; new errors still do; legacy names stay editable', () => {
  const { r } = loadDevice(); const { upsertSchemaRecord } = r('v17/engines/schemaRecordEngine');
  const legacy = legacyBrokenRegistry().schemas[0]; legacy.tables.push({ name: 'OLD TABLE', module: 'Legacy', description: '', columns: [{ name: 'ID', label: 'ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: '' }, { name: 'MY COL', label: 'x', type: 'VARCHAR', nullable: true, description: '' }] });
  const rowFor = (t, c) => { const col = legacy.tables.find((x) => x.name === t).columns.find((x) => x.name === c); return { rowId: `${t}::${c}`, module: 'Legacy', tableName: t, tableDescription: '', columnName: c, columnDescription: col.description, dataType: col.type, length: null, precision: null, nullable: col.nullable, alias: '', decodeText: '', isPrimaryKey: !!col.isPrimaryKey, isForeignKey: false, fkTable: '', fkColumn: '' }; };
  assert.equal(upsertSchemaRecord(legacy, { ...rowFor('OLD TABLE', 'MY COL'), columnDescription: 'now documented' }, 'OLD TABLE::MY COL').ok, true, 'legacy name with a space is still editable');
  const vrow = { rowId: 'VENDOR::COUNTRY', module: 'Vendors', tableName: 'VENDOR', tableDescription: 'Supplier / vendor master data.', columnName: 'COUNTRY', columnDescription: 'edited', dataType: 'VARCHAR', length: 2, precision: null, nullable: false, alias: '', decodeText: '', isPrimaryKey: false, isForeignKey: false, fkTable: '', fkColumn: '' };
  assert.equal(upsertSchemaRecord(legacy, vrow, 'VENDOR::COUNTRY').ok, true, 'pre-existing dangling FK elsewhere does not block an unrelated edit');
  assert.equal(upsertSchemaRecord(legacy, { ...vrow, isForeignKey: true, fkTable: 'VENDOR', fkColumn: 'NOPE' }, 'VENDOR::COUNTRY').ok, false, 'a NEW error is still blocked');
});

// ------------------------------------------------------------------------------------------- GitHub failure modes
test('GitHub failures each produce an understandable message and never expose the token', async () => {
  const gh = fakeGitHub(); gh.put(REPO, PATH, JSON.stringify({ schemas: [clone(CORE_SCHEMA)], activeSchemaId: CORE_SCHEMA.id }));
  const A = loadDevice(); await unlock(A, TOKEN);
  const expect = async (mode, re, op = 'pull') => { gh.mode = mode; const r = op === 'pull' ? await A.syncService.pullRegistryFromGitHub() : await A.syncService.pushRegistryToGitHub(); gh.mode = null; assert.equal(r.ok, false, mode); assert.match(r.error, re, mode); assert.doesNotMatch(r.error, /ghp_TestToken/); };
  await expect('401', /invalid, expired or revoked/); await expect('403', /does not have read permission/); await expect('ratelimit', /rate limit/);
  await expect('network', /could not reach GitHub/); await expect('timeout', /did not respond within 8 s/); await expect('500', /temporarily unavailable \(HTTP 502\)/); await expect('html', /not JSON \(possibly a proxy/);
  await A.syncService.pullRegistryFromGitHub(); await expect('readonly', /does not have write permission/, 'push');
  gh.files.clear(); const miss = await A.syncService.pullRegistryFromGitHub(); assert.match(miss.error, /No schema file found yet/);
  await A.vault.saveConfig({ githubRepo: 'not-a-repo' }); const cfg = await A.syncService.pullRegistryFromGitHub(); assert.match(cfg.error, /owner\/repo/);
  await A.vault.saveConfig({ githubRepo: REPO, githubToken: '' }); const tok = await A.syncService.pushRegistryToGitHub(); assert.match(tok.error, /Missing: Access Token/);
});
test('stale-copy protection: pushing over a newer remote asks for a pull first', async () => {
  const gh = fakeGitHub(); gh.put(REPO, PATH, JSON.stringify({ schemas: [clone(CORE_SCHEMA)], activeSchemaId: CORE_SCHEMA.id }));
  const A = loadDevice(); await unlock(A); await A.syncService.pullRegistryFromGitHub();
  gh.put(REPO, PATH, JSON.stringify({ schemas: [clone(CORE_SCHEMA), clone(EXTENDED_SCHEMA)], activeSchemaId: CORE_SCHEMA.id }));
  const r = await A.syncService.pushRegistryToGitHub(); assert.equal(r.ok, false); assert.equal(r.requiresPullFirst, true);
});
test('large schema (> 1 MB, 400 tables) with special characters synchronises through the raw-content path', async () => {
  const gh = fakeGitHub(); const big = { id: 'schema-big', name: 'Big ERP', version: '1.0', status: 'inactive', updatedAt: '2026-09-01T00:00:00.000Z', lastSyncedAt: null, relationships: [], tables: [] };
  for (let t = 0; t < 400; t++) big.tables.push({ name: `T_${t}`, module: `Module ${t % 12}`, description: `Ünïcode ✓ "quoted" \\ back\\slash\nnew line ${'x'.repeat(40)}`, columns: Array.from({ length: 18 }, (_, c) => ({ name: c === 0 ? 'ID' : `C_${c}`, label: `Col ${c}`, type: c % 3 ? 'VARCHAR2(200 CHAR)' : 'NUMBER(18,2)', nullable: c !== 0, isPrimaryKey: c === 0, description: `Beschreibung ${c} — €£¥ 漢字 😀` })) });
  const text = JSON.stringify({ schemas: [clone(CORE_SCHEMA), big], activeSchemaId: CORE_SCHEMA.id }); assert.ok(Buffer.byteLength(text) > 1024 * 1024);
  gh.put(REPO, PATH, text);
  const A = loadDevice(); await unlock(A); const r = await A.syncService.pullRegistryFromGitHub(); assert.equal(r.ok, true, r.error); assert.ok(r.newSchemasAdded.includes('Big ERP'));
  assert.deepEqual(A.schemaService.getSchemaById('schema-big').tables[7], big.tables[7], 'content identical after round trip');
  assert.equal((await A.syncService.pushRegistryToGitHub()).ok, true);
});

// ------------------------------------------------------------------------------------------- active schema, SQL, NLU after sync
test('active schema refresh + SQL generation use the synchronised schema (no stale cache)', async () => {
  const gh = fakeGitHub(); const A = loadDevice(); await unlock(A);
  const id = CORE_SCHEMA.id; const rowA = A.schemaService.getFlattenedRows(id, null, 'INVOICE_HEADER').find((r) => r.columnName === 'INVOICE_AMOUNT');
  assert.deepEqual(await A.schemaService.upsertRow(id, { ...rowA, columnName: 'GROSS_AMOUNT' }, rowA.rowId), []);
  assert.equal((await A.syncService.pushRegistryToGitHub()).ok, true);
  const Bdev = loadDevice(); await unlock(Bdev); const integ = Bdev.integ();
  const before = await integ.orchestrateReadOnlyNlpV17('total invoice amount by vendor', Bdev.schemaService.getActiveSchema()); integ.applyV17ResultToStore(before.result);
  assert.match(Bdev.store.readOnly.generatedSql, /SUM\(INVOICE_HEADER\.INVOICE_AMOUNT\)/);
  await Bdev.syncService.pullRegistryFromGitHub(); const c = Bdev.syncService.getPendingConflicts()[0]; Bdev.syncService.resolvePendingConflict(c.id, 'remote');
  assert.doesNotMatch(Bdev.store.readOnly.generatedSql, /INVOICE_AMOUNT/, 'selections on the deleted column were dropped and SQL regenerated');
  Bdev.store.resetReadOnly();
  const after = await integ.orchestrateReadOnlyNlpV17('total gross amount by vendor', Bdev.schemaService.getActiveSchema()); integ.applyV17ResultToStore(after.result);
  assert.match(Bdev.store.readOnly.generatedSql, /SUM\(INVOICE_HEADER\.GROSS_AMOUNT\)/);
  // A switches the active schema; B follows (last selection wins) and generation follows the new active schema
  A.schemaService.switchActiveSchema(EXTENDED_SCHEMA.id); await A.syncService.pullRegistryFromGitHub(); assert.equal((await A.syncService.pushRegistryToGitHub()).ok, true);
  const p = await Bdev.syncService.pullRegistryFromGitHub(); assert.equal(p.activeSchemaChanged, true); assert.equal(Bdev.schemaService.getActiveSchema().id, EXTENDED_SCHEMA.id);
  Bdev.store.resetReadOnly(); const contract = await integ.orchestrateReadOnlyNlpV17('active contracts with vendor name', null); integ.applyV17ResultToStore(contract.result); assert.match(Bdev.store.readOnly.generatedSql, /FROM CONTRACT/); assert.match(Bdev.store.readOnly.generatedSql, /CONTRACT\.STATUS = 'A'/); assert.doesNotMatch(Bdev.store.readOnly.generatedSql, /APP_USER/);
});
test('discovery requests are de-duplicated (concurrent page mounts share one download)', async () => {
  const gh = fakeGitHub(); gh.put(REPO, PATH, JSON.stringify({ schemas: [clone(CORE_SCHEMA)], activeSchemaId: CORE_SCHEMA.id }));
  const A = loadDevice(); gh.requests.length = 0;
  await Promise.all([A.syncService.discoverPublicRegistry('a'), A.syncService.discoverPublicRegistry('b'), A.syncService.discoverPublicRegistry('c')]);
  assert.equal(gh.requests.filter((r) => r.url.includes('registry.json')).length, 1);
});
test('a corrupted local registry is preserved under a backup key instead of being silently overwritten', () => {
  const storage = new Map([['sqla.registry.v15', '{"schemas": [ {"id": "x", ']]); const A = loadDevice(storage);
  const backupKey = [...storage.keys()].find((k) => k.startsWith('sqla.registry.v15.corrupt-')); assert.ok(backupKey); assert.equal(storage.get(backupKey), '{"schemas": [ {"id": "x", ');
  assert.match(A.schemaService.getLoadMessages()[0], /preserved under/); assert.ok(A.schemaService.getActiveSchema().tables.length > 0);
});
test('corrupted local Secret Vault data does not crash unlocking', async () => {
  const A = loadDevice(new Map([['sqla.secretvault.v15', '{not json']])); const r = await A.vault.tryAutoUnlock('admin'); assert.equal(r.ok, false); assert.match(r.error, /corrupted/);
  const B2 = loadDevice(new Map([['sqla.secretvault.v15', JSON.stringify({ blob: { salt: 'x', iv: 'y', ciphertext: 'z' } })]])); const r2 = await B2.vault.tryAutoUnlock('admin'); assert.equal(r2.ok, false); assert.match(r2.error, /Decryption failed/);
});
test('relationships that point at deleted columns are ignored for JOINs (never produce SQL on a missing column)', async () => {
  const { r } = loadDevice(); const { buildSelectSQL } = r('engines/sqlEngine');
  const broken = legacyBrokenRegistry().schemas[0];
  const sql = buildSelectSQL({ ...emptyState(), selectedTables: ['INVOICE_HEADER', 'VENDOR'] }, broken);
  assert.doesNotMatch(sql, /VENDOR\.VENDOR_ID/);
});
