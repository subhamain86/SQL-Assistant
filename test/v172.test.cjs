/* V17.2 — synchronisation root causes (stale copies, wrong location, missing merge base, races), scenarios A–H,
 * error stages/provenance, NLU additions, Advanced Options additions, structural validation, learning, row-wise editing. */
const test = require('node:test'); const assert = require('node:assert/strict');
const { loadDevice, fakeGitHub, REPO, PATH, unlock, emptyState, installStorage, B } = require('./helpers.cjs');
const clone = (v) => JSON.parse(JSON.stringify(v));
const { CORE_SCHEMA, EXTENDED_SCHEMA } = require(`${B}/data/defaultSchemas`);
const use = (dev) => installStorage(dev.storage);
function brokenCore() { const core = clone(CORE_SCHEMA); const v = core.tables.find((t) => t.name === 'VENDOR'); v.columns = v.columns.filter((c) => c.name !== 'VENDOR_ID'); return core; }
const reg = (...schemas) => JSON.stringify({ schemas, activeSchemaId: schemas[0].id });
const rowOf = (svc, id, t, c) => svc.getFlattenedRows(id, null, t).find((r) => r.columnName === c);

// ------------------------------------------------------------------------------------------- ROOT CAUSE 1: stale copies
test('ROOT CAUSE 1 reproduced and fixed: an outdated (cached) copy of the repository file is never applied again', async () => {
  const gh = fakeGitHub(); gh.put(REPO, PATH, reg(brokenCore(), clone(EXTENDED_SCHEMA)));
  const A = loadDevice(new Map([['sqla.registry.v15', reg(brokenCore(), clone(EXTENDED_SCHEMA))]])); await unlock(A);
  await A.syncService.pullRegistryFromGitHub();
  assert.equal((await A.schemaService.repairLocalSchema(CORE_SCHEMA.id)).ok, true);
  assert.equal((await A.syncService.pushRegistryToGitHub()).ok, true);
  // The next read is served the PRE-repair file (what a browser/CDN cache returned for up to 60 s in V17.1).
  gh.serveStale = 1;
  const pulled = await A.syncService.pullRegistryFromGitHub();
  assert.equal(pulled.ok, true); assert.equal(pulled.stale, true, 'stale copy recognised');
  assert.equal((pulled.rejected || []).length, 0, 'no "failed validation" from the outdated copy');
  assert.equal(A.syncService.getLastError(), null);
  assert.equal(A.schemaService.getLocalHealth().every((h) => h.valid), true, 'local repaired schema NOT reverted to the old copy');
  gh.serveStale = 1; const disc = await A.syncService.discoverPublicRegistry('page-mount', true); assert.equal(disc.stale, true); assert.equal(A.syncService.getRemoteRejections().length, 0);
  assert.ok(gh.requests.every((r) => r.cache === 'no-store'), 'every GitHub request bypasses the HTTP cache');
});
// ------------------------------------------------------------------------------------------- ROOT CAUSE 2: location
test('ROOT CAUSE 2 reproduced and fixed: discovery reads the configured location, not a stale file at the default path', async () => {
  const gh = fakeGitHub(); const CUSTOM = 'team/schemas/registry.json';
  gh.put(REPO, PATH, reg(brokenCore()));                            // old invalid file left at the default path
  const A = loadDevice(); await unlock(A, undefined, { githubSchemaPath: CUSTOM, githubBranch: 'prod' });
  assert.equal((await A.syncService.pushRegistryToGitHub()).ok, true);
  assert.ok(gh.get(REPO, CUSTOM), 'push wrote the configured location');
  A.vault.lock(); gh.requests.length = 0;                               // locked device (app start before unlocking Settings)
  const d = await A.syncService.discoverPublicRegistry('app-load', true);
  assert.equal(d.ok, true); assert.equal((d.rejected || []).length, 0, 'the stale default-path file is no longer validated');
  assert.ok(gh.requests.some((r) => r.url.includes('team/schemas/registry.json') && r.url.includes('ref=prod')), 'discovery used the remembered configured location');
  assert.ok(!gh.requests.some((r) => r.url.includes('sql-assistant-data/schemas/registry.json')));
  // a brand-new device without configuration still uses the default location
  const fresh = loadDevice(); assert.equal(fresh.syncService.currentLocation().path, PATH);
});
// ------------------------------------------------------------------------------------------- ROOT CAUSE 3: merge base
test('ROOT CAUSE 3 fixed — scenario B: a local manual change is preserved and published; no false conflict on pull', async () => {
  const gh = fakeGitHub(); const A = loadDevice(); await unlock(A);
  assert.equal((await A.syncService.pushRegistryToGitHub()).ok, true);
  const r0 = rowOf(A.schemaService, CORE_SCHEMA.id, 'VENDOR', 'COUNTRY');
  assert.deepEqual(await A.schemaService.upsertRow(CORE_SCHEMA.id, { ...r0, columnDescription: 'Changed on A' }, r0.rowId, r0), []);
  const p = await A.syncService.pullRegistryFromGitHub();                 // pull happens before the debounced push
  assert.deepEqual(p.conflicts, []); assert.deepEqual(p.localAhead, ['AP / P2P Core']);
  assert.equal(rowOf(A.schemaService, CORE_SCHEMA.id, 'VENDOR', 'COUNTRY').columnDescription, 'Changed on A', 'local edit kept');
  assert.equal((await A.syncService.pushRegistryToGitHub()).ok, true);
  assert.match(gh.get(REPO, PATH).content, /Changed on A/);
});
test('3-way merge: remote-only change fast-forwards; changes on both sides become a conflict (never silently overwritten)', async () => {
  const gh = fakeGitHub(); const A = loadDevice(); await unlock(A); assert.equal((await A.syncService.pushRegistryToGitHub()).ok, true);
  const Bd = loadDevice(); await unlock(Bd); await Bd.syncService.pullRegistryFromGitHub(); // B: local == remote → base recorded
  use(A); const ra = rowOf(A.schemaService, CORE_SCHEMA.id, 'VENDOR', 'COUNTRY'); await A.schemaService.upsertRow(CORE_SCHEMA.id, { ...ra, columnDescription: 'From A' }, ra.rowId, ra); assert.equal((await A.syncService.pushRegistryToGitHub()).ok, true);
  use(Bd); const ff = await Bd.syncService.pullRegistryFromGitHub(); assert.deepEqual(ff.updatedSchemas, ['AP / P2P Core']); assert.equal(rowOf(Bd.schemaService, CORE_SCHEMA.id, 'VENDOR', 'COUNTRY').columnDescription, 'From A');
  const rb = rowOf(Bd.schemaService, CORE_SCHEMA.id, 'VENDOR', 'COUNTRY'); await Bd.schemaService.upsertRow(CORE_SCHEMA.id, { ...rb, columnDescription: 'From B' }, rb.rowId, rb);
  use(A); const ra2 = rowOf(A.schemaService, CORE_SCHEMA.id, 'VENDOR', 'COUNTRY'); await A.schemaService.upsertRow(CORE_SCHEMA.id, { ...ra2, columnDescription: 'From A again' }, ra2.rowId, ra2); assert.equal((await A.syncService.pushRegistryToGitHub()).ok, true);
  use(Bd); const both = await Bd.syncService.pullRegistryFromGitHub(); assert.equal(both.conflicts.length, 1); assert.equal(rowOf(Bd.schemaService, CORE_SCHEMA.id, 'VENDOR', 'COUNTRY').columnDescription, 'From B', 'local edit not overwritten');
  const c = Bd.syncService.getPendingConflicts()[0]; assert.equal(Bd.syncService.resolvePendingConflict(c.id, 'local').ok, true);
  const again = await Bd.syncService.pullRegistryFromGitHub(); assert.deepEqual(again.conflicts, []); assert.deepEqual(again.localAhead, ['AP / P2P Core'], '"Use Local" makes the local copy the one to publish');
});
// ------------------------------------------------------------------------------------------- ROOT CAUSE 4: races
test('ROOT CAUSE 4 fixed: a push that races another device recovers automatically (pull → merge → push)', async () => {
  const gh = fakeGitHub(); const A = loadDevice(); await unlock(A); assert.equal((await A.syncService.pushRegistryToGitHub()).ok, true);
  const Bd = loadDevice(); await unlock(Bd); await Bd.syncService.pullRegistryFromGitHub();
  const rb = rowOf(Bd.schemaService, EXTENDED_SCHEMA.id, 'CONTRACT', 'END_DATE'); await Bd.schemaService.upsertRow(EXTENDED_SCHEMA.id, { ...rb, columnDescription: 'B edited contracts' }, rb.rowId, rb); assert.equal((await Bd.syncService.pushRegistryToGitHub()).ok, true);
  use(A); const ra = rowOf(A.schemaService, CORE_SCHEMA.id, 'VENDOR', 'COUNTRY'); await A.schemaService.upsertRow(CORE_SCHEMA.id, { ...ra, columnDescription: 'A edited vendors' }, ra.rowId, ra);
  const r = await A.syncService.pushWithRecovery('test'); assert.equal(r.ok, true, r.error); assert.equal(r.recovered, true);
  const final = gh.get(REPO, PATH).content; assert.match(final, /B edited contracts/); assert.match(final, /A edited vendors/);
});
test('sync operations are serialised: concurrent pull / push / pull never interleave or 409', async () => {
  const gh = fakeGitHub(); const A = loadDevice(); await unlock(A); await A.syncService.pushRegistryToGitHub();
  const ra = rowOf(A.schemaService, CORE_SCHEMA.id, 'VENDOR', 'COUNTRY'); await A.schemaService.upsertRow(CORE_SCHEMA.id, { ...ra, columnDescription: 'concurrent' }, ra.rowId, ra);
  const [p1, push, p2] = await Promise.all([A.syncService.pullRegistryFromGitHub(), A.syncService.pushRegistryToGitHub(), A.syncService.pullRegistryFromGitHub()]);
  assert.equal(p1.ok && push.ok && p2.ok, true); assert.deepEqual(p2.conflicts, []); assert.equal(p2.unchanged, 2);
});
// ------------------------------------------------------------------------------------------- Scenarios A, C–H
test('scenarios A, C, D, E, F, G, H end-to-end', async () => {
  const gh = fakeGitHub(); const storage = new Map(); let A = loadDevice(storage); await unlock(A);
  // A — valid remote → normal synchronisation succeeds
  assert.equal((await A.syncService.pushRegistryToGitHub()).ok, true); const a = await A.syncService.pullRegistryFromGitHub(); assert.equal(a.ok, true); assert.equal(a.warning, undefined);
  // C — one row updated → only that row changes
  const before = clone(A.schemaService.getSchemaById(CORE_SCHEMA.id)); const r0 = rowOf(A.schemaService, CORE_SCHEMA.id, 'VENDOR', 'PAYMENT_TERMS');
  assert.deepEqual(await A.schemaService.upsertRow(CORE_SCHEMA.id, { ...r0, columnDescription: 'Row C updated' }, r0.rowId, r0), []);
  const after = A.schemaService.getSchemaById(CORE_SCHEMA.id);
  after.tables.forEach((t, ti) => t.columns.forEach((c, ci) => { if (!(t.name === 'VENDOR' && c.name === 'PAYMENT_TERMS')) assert.deepEqual(c, before.tables[ti].columns[ci]); }));
  // D — one row deleted → only that row is deleted
  const count = after.tables.reduce((n, t) => n + t.columns.length, 0); assert.equal((await A.schemaService.deleteRow(CORE_SCHEMA.id, 'VENDOR::DUNS_NUMBER')).ok, true);
  const afterDel = A.schemaService.getSchemaById(CORE_SCHEMA.id); assert.equal(afterDel.tables.reduce((n, t) => n + t.columns.length, 0), count - 1); assert.ok(!afterDel.tables.find((t) => t.name === 'VENDOR').columns.some((c) => c.name === 'DUNS_NUMBER'));
  // E — invalid manual modification → rejected with a meaningful error, nothing saved
  const r1 = rowOf(A.schemaService, CORE_SCHEMA.id, 'VENDOR', 'COUNTRY'); const errs = await A.schemaService.upsertRow(CORE_SCHEMA.id, { ...r1, isForeignKey: true, fkTable: 'NOPE', fkColumn: 'X' }, r1.rowId, r1);
  assert.match(errs.join(' '), /References Table "NOPE" does not exist/); assert.equal(rowOf(A.schemaService, CORE_SCHEMA.id, 'VENDOR', 'COUNTRY').isForeignKey, false);
  assert.equal((await A.syncService.pushRegistryToGitHub()).ok, true);
  // F — remote becomes invalid → the existing valid local schema is protected
  const goodLocal = JSON.stringify(A.schemaService.getSchemaById(CORE_SCHEMA.id)); gh.put(REPO, PATH, reg(brokenCore(), clone(EXTENDED_SCHEMA)));
  const f = await A.syncService.pullRegistryFromGitHub(); assert.equal(f.rejected.length, 1); assert.equal(JSON.stringify(A.schemaService.getSchemaById(CORE_SCHEMA.id)), goodLocal);
  // G — remote valid again after the failure → synchronisation recovers and the error clears
  gh.put(REPO, PATH, reg(JSON.parse(goodLocal), clone(EXTENDED_SCHEMA))); const g = await A.syncService.pullRegistryFromGitHub(); assert.equal(g.ok, true); assert.equal((g.rejected || []).length, 0); assert.equal(A.syncService.getLastError(), null); assert.equal(A.syncService.getRemoteRejections().length, 0);
  // H — application restarted → saved schema (with the manual changes) is still there and still used by SQL generation
  A = loadDevice(storage); const restored = A.schemaService.getSchemaById(CORE_SCHEMA.id);
  assert.equal(restored.tables.find((t) => t.name === 'VENDOR').columns.find((c) => c.name === 'PAYMENT_TERMS').description, 'Row C updated'); assert.ok(!restored.tables.find((t) => t.name === 'VENDOR').columns.some((c) => c.name === 'DUNS_NUMBER'));
  const integ = A.integ(); const out = await integ.orchestrateReadOnlyNlpV17('vendors with duns number', null); integ.applyV17ResultToStore(out.result); assert.doesNotMatch(A.store.readOnly.generatedSql, /DUNS_NUMBER/);
});
// ------------------------------------------------------------------------------------------- stages, provenance, notices
test('every sync error names its failing stage; rejected data names the device/version that wrote it', async () => {
  const gh = fakeGitHub(); const A = loadDevice(); await unlock(A);
  gh.put(REPO, PATH, '{"schemas": [');   let r = await A.syncService.pullRegistryFromGitHub(); assert.match(r.error, /Remote file could not be parsed/);
  gh.put(REPO, PATH, '{"formatVersion": 7, "schemas": []}'); r = await A.syncService.pullRegistryFromGitHub(); assert.match(r.error, /Schema version is unsupported/);
  gh.put(REPO, PATH, '{"hello": 1}'); r = await A.syncService.pullRegistryFromGitHub(); assert.match(r.error, /Schema structure is invalid/);
  gh.mode = 'network'; r = await A.syncService.pullRegistryFromGitHub(); gh.mode = null; assert.match(r.error, /Remote file retrieval failed/);
  gh.put(REPO, PATH, reg(brokenCore())); r = await A.syncService.pullRegistryFromGitHub(); assert.match(r.warning, /Invalid column definition/); assert.match(r.warning, /V17\.0 or older/); assert.match(r.rejected[0].origin, /has not been updated/);
  const bad = brokenCore(); bad.versionMeta = { version: '1.0.4', schemaId: bad.id, lastUpdated: '2026-10-01T09:00:00.000Z', updatedByDevice: 'device-oldpc', source: 'local', checksum: 'x' };
  gh.put(REPO, PATH, JSON.stringify({ formatVersion: 2, writtenBy: 'SQL Assistant 17.1.0', writtenByDevice: 'device-laptop', schemas: [bad], activeSchemaId: bad.id })); r = await A.syncService.pullRegistryFromGitHub();
  assert.match(r.rejected[0].origin, /SQL Assistant 17\.1\.0 on device-laptop/); assert.match(r.rejected[0].origin, /device-oldpc/);
  const dup = clone(CORE_SCHEMA); dup.tables.push(clone(dup.tables[0])); gh.put(REPO, PATH, reg(dup)); r = await A.syncService.pullRegistryFromGitHub(); assert.match(r.warning, /Duplicate schema object/);
  gh.put(REPO, PATH, JSON.stringify({ formatVersion: 2, writtenBy: 'SQL Assistant 17.9.0', schemas: [clone(CORE_SCHEMA)], activeSchemaId: CORE_SCHEMA.id })); r = await A.syncService.pullRegistryFromGitHub(); assert.match(r.notice, /newer than this copy/);
});
test('schema persistence failure during sync is reported as such and leaves the registry consistent', async () => {
  const gh = fakeGitHub(); gh.put(REPO, PATH, reg(clone(CORE_SCHEMA), { ...clone(EXTENDED_SCHEMA), id: 'schema-new', name: 'Brand New' }));
  const storage = new Map(); const A = loadDevice(storage); await unlock(A);
  installStorage(storage, { failKey: (k) => k === 'sqla.registry.v15' });
  const r = await A.syncService.pullRegistryFromGitHub(); assert.match(r.warning, /Schema persistence failed: Brand New could not be saved/); assert.equal(A.schemaService.getSchemaById('schema-new'), undefined);
});
test('validation stays strict, but database codes are case-sensitive: decode raw values "a" and "A" are different', () => {
  const { fmt } = loadDevice(); const s = clone(CORE_SCHEMA); s.tables[0].columns.find((c) => c.name === 'STATUS').decode = [{ rawValue: 'o', label: 'open (legacy)' }, { rawValue: 'O', label: 'Open' }];
  assert.equal(fmt.validateSchemaModel(s).valid, true);
  s.tables[0].columns.find((c) => c.name === 'STATUS').decode.push({ rawValue: 'O', label: 'Again' }); assert.equal(fmt.validateSchemaModel(s).valid, false);
});
// ------------------------------------------------------------------------------------------- NLU
const gen = async (text, o = {}) => { const { describeWhatYouNeed } = require(`${B}/v17/services/v17Orchestrator`); return describeWhatYouNeed(text, o.schema || CORE_SCHEMA, o.state || emptyState(o.dialect || 'Generic'), o.deps || {}); };
test('NLU: the specification example generates the expected SQL from the active schema', async () => {
  const r = await gen('Show all invoices created in the last 30 days where the supplier country is Finland and sort them by invoice date descending.');
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  for (const re of [/FROM INVOICE_HEADER/, /INNER JOIN VENDOR ON INVOICE_HEADER\.VENDOR_ID = VENDOR\.VENDOR_ID/, /INVOICE_HEADER\.INVOICE_DATE >= CURRENT_DATE - INTERVAL '30 DAY'/, /VENDOR\.COUNTRY = 'FI'/, /ORDER BY INVOICE_HEADER\.INVOICE_DATE DESC/]) assert.match(r.sql, re);
  assert.ok(r.requirement.notes.some((n) => /Finland" was mapped to the ISO country code 'FI'/.test(n)));
  const ora = await gen('Show all invoices created in the last 30 days where the supplier country is Finland and sort them by invoice date descending.', { dialect: 'Oracle' }); assert.match(ora.sql, /TRUNC\(SYSDATE\) - 30/);
});
test('NLU: relative dates — today, yesterday, last 7 days, this month, previous month, current year', async () => {
  const cases = [['invoices created today', /INVOICE_DATE >= CURRENT_DATE[\s\S]*INVOICE_DATE < CURRENT_DATE \+ INTERVAL '1 DAY'/], ['invoices created yesterday', /INVOICE_DATE >= CURRENT_DATE - INTERVAL '1 DAY'[\s\S]*< CURRENT_DATE/], ['invoices from the last 7 days', /CURRENT_DATE - INTERVAL '7 DAY'/], ['invoices this month', /DATE_TRUNC\('MONTH', CURRENT_DATE\)/], ['invoices from the previous month', />= DATE_TRUNC\('MONTH', CURRENT_DATE\) - INTERVAL '1 MONTH'[\s\S]*< DATE_TRUNC\('MONTH', CURRENT_DATE\)/], ['invoices in the current year', /DATE_TRUNC\('YEAR', CURRENT_DATE\)/]];
  for (const [t, re] of cases) { const r = await gen(t); assert.match(r.sql, re, t); }
});
test('NLU: aliases and LEFT JOIN are detected; manual settings still win', async () => {
  const al = await gen('approved invoices with vendor name using table aliases'); assert.match(al.sql, /FROM INVOICE_HEADER ih/); assert.match(al.sql, /INNER JOIN VENDOR v ON ih\.VENDOR_ID = v\.VENDOR_ID/); assert.match(al.sql, /ih\.STATUS = 'A'/); assert.equal(al.errors.length, 0);
  const lj = await gen('invoices with vendor name including those without a vendor'); assert.match(lj.sql, /LEFT JOIN VENDOR/);
  const manual = await gen('approved invoices with vendor name using table aliases', { deps: { overrides: { isManual: (k) => k === 'tableAliases' } } }); assert.doesNotMatch(manual.sql, /INVOICE_HEADER ih/);
});
// ------------------------------------------------------------------------------------------- Advanced Options + validation
test('Advanced Options: table aliases, join type, join-path choice, NOT LIKE / NOT IN / BETWEEN / IS NOT NULL all build valid SQL', () => {
  const { buildSelectSQL } = require(`${B}/engines/sqlEngine`); const { validateFullReadOnly } = require(`${B}/engines/validationEngine`); const { validateSqlAgainstSchema } = require(`${B}/engines/sqlSchemaValidator`);
  const s = { ...emptyState('SQL Server'), selectedTables: ['INVOICE_HEADER', 'VENDOR', 'ORGANIZATION'], selectedColumns: [{ id: 'a', table: 'VENDOR', column: 'VENDOR_NAME', alias: 'SUPPLIER', useDecode: false, aggregate: null }, { id: 'b', table: 'INVOICE_HEADER', column: 'INVOICE_AMOUNT', alias: 'TOTAL', useDecode: false, aggregate: 'SUM' }],
    filters: [{ id: '1', table: 'VENDOR', column: 'VENDOR_NAME', operator: 'NOT LIKE', value: '%test%', combinator: 'AND' }, { id: '2', table: 'INVOICE_HEADER', column: 'STATUS', operator: 'NOT IN', value: 'R,D', combinator: 'AND' }, { id: '3', table: 'INVOICE_HEADER', column: 'INVOICE_AMOUNT', operator: 'BETWEEN', value: '10', value2: '500', combinator: 'OR' }, { id: '4', table: 'INVOICE_HEADER', column: 'DUE_DATE', operator: 'IS NOT NULL', value: '', combinator: 'AND' }], sorts: [{ id: 's', table: 'VENDOR', column: 'VENDOR_NAME', direction: 'DESC' }] };
  s.advanced = { ...s.advanced, distinct: true, groupByColumns: ['VENDOR.VENDOR_NAME'], havingClause: 'SUM(INVOICE_HEADER.INVOICE_AMOUNT) > 100', limit: 10, tableAliases: true, joinType: 'LEFT JOIN' };
  const sql = buildSelectSQL(s, CORE_SCHEMA); s.generatedSql = sql;
  for (const re of [/^SELECT DISTINCT TOP 10 v\.VENDOR_NAME AS SUPPLIER,\s+SUM\(ih\.INVOICE_AMOUNT\) AS TOTAL/m, /FROM INVOICE_HEADER ih/, /LEFT JOIN VENDOR v ON ih\.VENDOR_ID = v\.VENDOR_ID/, /LEFT JOIN ORGANIZATION o ON v\.ORG_ID = o\.ORG_ID/, /v\.VENDOR_NAME NOT LIKE '%test%'/, /ih\.STATUS NOT IN \('R', 'D'\)/, /OR ih\.INVOICE_AMOUNT BETWEEN 10 AND 500/, /ih\.DUE_DATE IS NOT NULL/, /GROUP BY v\.VENDOR_NAME/, /HAVING SUM\(ih\.INVOICE_AMOUNT\) > 100/, /ORDER BY v\.VENDOR_NAME DESC/]) assert.match(sql, re);
  assert.equal(validateFullReadOnly(s).valid, true, JSON.stringify(validateFullReadOnly(s).issues)); assert.equal(validateSqlAgainstSchema(sql, CORE_SCHEMA).valid, true);
  assert.match(validateSqlAgainstSchema('SELECT ih.NOPE FROM INVOICE_HEADER ih', CORE_SCHEMA).warnings.join(' '), /ih\.NOPE/, 'aliased columns are still checked against the schema');
  const lit = buildSelectSQL({ ...s, filters: [{ id: 'x', table: 'VENDOR', column: 'VENDOR_NAME', operator: '=', value: 'VENDOR.X INVOICE_HEADER.Y', combinator: 'AND' }] }, CORE_SCHEMA); assert.match(lit, /'VENDOR\.X INVOICE_HEADER\.Y'/, 'string literals are never aliased');
  // join-path chooser: two direct relationships between INVOICE_HEADER and PO_HEADER? (only one) — use a bridge choice scenario
  const { computeAutoJoinPlan } = require(`${B}/engines/joinAutoEngine`); const { withFkRelationships } = require(`${B}/v17/engines/joinGraph`);
  const amb = clone(CORE_SCHEMA); amb.relationships.push({ id: 'rx', fromTable: 'APPROVAL_HISTORY', fromColumn: 'APPROVER_ID', toTable: 'APP_USER', toColumn: 'USER_ID', kind: 'many-to-one' }, { id: 'ry', fromTable: 'PO_HEADER', fromColumn: 'BUYER_ID', toTable: 'APP_USER', toColumn: 'USER_ID', kind: 'many-to-one' });
  const plan = computeAutoJoinPlan(withFkRelationships(amb), 'INVOICE_HEADER', ['APP_USER'], {}); assert.equal(plan.resolutions[0].isAmbiguous, true); assert.equal(plan.joinLines.length, 0);
  const chosen = computeAutoJoinPlan(withFkRelationships(amb), 'INVOICE_HEADER', ['APP_USER'], { [plan.resolutions[0].pairKey]: plan.resolutions[0].options[1].id }); assert.equal(chosen.joinLines.length, 2);
});
test('structural SQL validation: parentheses, quotes, clause order, trailing comma, duplicate output aliases, duplicate table aliases', () => {
  const { validateSqlStructure } = require(`${B}/engines/validationEngine`); const { validateSqlAgainstSchema } = require(`${B}/engines/sqlSchemaValidator`);
  const m = (s) => validateSqlStructure(s).filter((i) => i.severity === 'error').map((i) => i.message).join(' | ');
  assert.match(m('SELECT COUNT(VENDOR.VENDOR_ID FROM VENDOR'), /Unbalanced parentheses/); assert.match(m("SELECT * FROM VENDOR WHERE VENDOR.COUNTRY = 'FI"), /Unterminated string/);
  assert.match(m('SELECT * FROM VENDOR ORDER BY VENDOR.VENDOR_NAME WHERE VENDOR.COUNTRY = 1'), /Clause order is invalid/); assert.match(m('SELECT VENDOR.VENDOR_NAME, FROM VENDOR'), /trailing comma/);
  assert.match(m('SELECT VENDOR.VENDOR_NAME AS X, VENDOR.COUNTRY AS X FROM VENDOR'), /Duplicate output column alias/); assert.match(m('SELECT VENDOR.VENDOR_NAME'), /no FROM clause/);
  assert.equal(m("SELECT v.VENDOR_NAME FROM VENDOR v WHERE v.VENDOR_NAME = 'a (b'"), '', 'parentheses and keywords inside literals are ignored');
  assert.equal(validateSqlAgainstSchema('SELECT x.VENDOR_NAME FROM VENDOR x JOIN INVOICE_HEADER x ON x.VENDOR_ID = x.VENDOR_ID', CORE_SCHEMA).valid, false);
});
// ------------------------------------------------------------------------------------------- learning
test('learning: full example recorded (features, schema & engine version, outcome, corrections); duplicates merge; credentials never learned', async () => {
  const { LearningStore } = require(`${B}/v17/services/learningStore`); const mem = () => { const m = new Map(); return { get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v) }; };
  const ls = new LearningStore(mem(), () => 'devA');
  const r = await gen('total invoice amount by vendor for approved invoices in the last 30 days', { deps: { learning: ls } });
  await gen('Total invoice amount by vendor for approved invoices in the last 45 days!', { deps: { learning: ls } }); // same normalised request
  assert.equal(ls.all().length, 1, 'duplicate example merged');
  const rec = ls.get(r.learningId); assert.equal(rec.engineVersion, 'offline-nlu-17.2'); assert.ok(rec.schemaFingerprint); assert.equal(rec.schemaVersion, '1.0'); assert.equal(rec.outcome, 'generated');
  assert.ok(rec.features.aggregates.includes('SUM')); assert.ok(rec.features.joins.some((j) => /JOIN VENDOR/.test(j))); assert.ok(rec.features.groupBy.length); assert.ok(rec.features.dateLogic.length); assert.ok(rec.features.filters.some((f) => /STATUS/.test(f)));
  const modified = r.sql.replace('ORDER BY', 'ORDER BY VENDOR.VENDOR_NAME ASC, ').replace(/,\s*SUM/, ', SUM');
  const acc = ls.recordAcceptance(r.learningId, r.sql.replace(/;$/, '').replace(/\n(GROUP BY)/, '\n  AND INVOICE_HEADER.CURRENCY = \'EUR\'\n$1') + ';', CORE_SCHEMA); assert.equal(acc.ok, true, acc.error && acc.error.message); void modified;
  assert.equal(ls.get(r.learningId).outcome, 'modified');
  const ls2 = new LearningStore(mem(), () => 'devB'); const g2 = await gen('vendor country list', { deps: { learning: ls2 } });
  ls2.recordAcceptance(g2.learningId, 'SELECT v.VENDOR_NAME, v.COUNTRY FROM VENDOR v ORDER BY v.COUNTRY DESC, v.VENDOR_NAME ASC;', CORE_SCHEMA);
  assert.deepEqual(ls2.get(g2.learningId).options.sorts, [{ table: 'VENDOR', column: 'COUNTRY', direction: 'DESC' }, { table: 'VENDOR', column: 'VENDOR_NAME', direction: 'ASC' }], 'corrections (sort order) learned from the final SQL, through aliases');
  assert.match((await gen('vendor country list please', { deps: { learning: ls2 } })).sql, /ORDER BY VENDOR\.COUNTRY DESC, VENDOR\.VENDOR_NAME ASC/); assert.ok(ls.get(r.learningId).corrections.some((c) => /added filters/.test(c)));
  const secret = ls.recordGeneration({ nlText: 'invoices for token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', schema: CORE_SCHEMA, generatedSql: 'SELECT * FROM INVOICE_HEADER;' }); assert.equal(secret.id, null); assert.match(secret.error.message, /credential/);
  assert.equal(ls.recordAcceptance(r.learningId, "SELECT * FROM INVOICE_HEADER WHERE INVOICE_HEADER.CURRENCY = 'sk-abcdefghijklmnopqrstuvwxyz0123'", CORE_SCHEMA).ok, false);
});
test('learning: a learned pattern that references a deleted column is ignored and the request is re-evaluated against the active schema', async () => {
  const { LearningStore } = require(`${B}/v17/services/learningStore`); const { upsertSchemaRecord } = require(`${B}/v17/engines/schemaRecordEngine`); const mem = () => { const m = new Map(); return { get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v) }; };
  const ls = new LearningStore(mem(), () => 'devA'); const r = await gen('vendor payment terms report', { deps: { learning: ls } });
  ls.recordAcceptance(r.learningId, 'SELECT VENDOR.VENDOR_NAME, VENDOR.PAYMENT_TERMS FROM VENDOR ORDER BY VENDOR.PAYMENT_TERMS ASC;', CORE_SCHEMA, { sorts: [{ table: 'VENDOR', column: 'PAYMENT_TERMS', direction: 'ASC' }] });
  const used = await gen('vendor payment terms report please', { deps: { learning: ls } }); assert.equal(used.requirement.learnedPatternIds.length, 1);
  const vt = CORE_SCHEMA.tables.find((t) => t.name === 'VENDOR'); const c = vt.columns.find((x) => x.name === 'PAYMENT_TERMS');
  const renamed = upsertSchemaRecord(CORE_SCHEMA, { rowId: 'VENDOR::PAYMENT_TERMS', module: vt.module, tableName: 'VENDOR', tableDescription: vt.description, columnName: 'TERMS_CODE', columnDescription: c.description, dataType: c.type, length: c.length, precision: null, nullable: c.nullable, alias: '', decodeText: '', isPrimaryKey: false, isForeignKey: false, fkTable: '', fkColumn: '' }, 'VENDOR::PAYMENT_TERMS').schema;
  const re = await gen('vendor payment terms report please', { schema: renamed, deps: { learning: ls } });
  assert.equal(re.requirement.learnedPatternIds.length, 0); assert.doesNotMatch(re.sql, /PAYMENT_TERMS/); assert.match(re.sql, /FROM VENDOR/);
});
// ------------------------------------------------------------------------------------------- row-wise editing
test('Manual Schema Update: diffRows lists exactly the modified fields (row vs table scope); no change → no diff', () => {
  const { diffRows } = require(`${B}/v17/engines/schemaRecordEngine`);
  const row = { rowId: 'VENDOR::COUNTRY', module: 'Vendors', tableName: 'VENDOR', tableDescription: 'd', columnName: 'COUNTRY', columnDescription: 'ISO', dataType: 'VARCHAR', length: 2, precision: null, nullable: false, alias: '', decodeText: '', isPrimaryKey: false, isForeignKey: false, fkTable: '', fkColumn: '' };
  assert.deepEqual(diffRows(row, { ...row }), []);
  const d = diffRows(row, { ...row, columnDescription: 'ISO 3166', length: 3, module: 'Suppliers' });
  assert.deepEqual(d.map((x) => [x.label, x.from, x.to, x.scope]), [['Module', 'Vendors', 'Suppliers', 'table'], ['Column Description', 'ISO', 'ISO 3166', 'row'], ['Length', '2', '3', 'row']]);
});
// ------------------------------------------------------------------------------------------- AI/LLM fallback
test('AI/LLM: offline browser / locked vault / provider error → offline engine result, never blocked', async () => {
  const llm = require(`${B}/v17/services/llmService`); const cfg = { ...llm.defaultLlmConfig(), enabled: true, endpoint: 'https://llm.example.com/v1', model: 'm' };
  const off = await gen('approved invoices', { deps: { online: false, llm: { config: cfg, apiKey: 'sk-abcdefghijklmnop', vaultLocked: false } } }); assert.match(off.llmStatus, /browser is offline/); assert.match(off.sql, /STATUS = 'A'/);
  const locked = await gen('approved invoices', { deps: { llm: { config: cfg, apiKey: null, vaultLocked: true } } }); assert.match(locked.llmStatus, /Secret Vault is locked/); assert.match(locked.sql, /STATUS = 'A'/);
  const err = await gen('approved invoices', { deps: { llm: { config: cfg, apiKey: 'sk-abcdefghijklmnop', vaultLocked: false, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) } } }); assert.match(err.llmStatus, /request failed/); assert.match(err.sql, /STATUS = 'A'/);
});
test('product name is "SQL Assistant" in source, registry metadata and build output', () => {
  const fs = require('node:fs'); const path = require('node:path'); const root = path.join(__dirname, '..');
  const { APP_NAME, serializeRegistry } = require(`${B}/v17/sync/schemaFormat`); assert.equal(APP_NAME, 'SQL Assistant'); assert.match(JSON.parse(serializeRegistry({ schemas: [], activeSchemaId: '' })).writtenBy, /^SQL Assistant 17\.2\.0$/);
  assert.match(fs.readFileSync(path.join(root, 'src/components/hamburgerNav.ts'), 'utf8'), /<span class="builder-heading">SQL Assistant<\/span>/);
  assert.match(fs.readFileSync(path.join(root, 'scripts/build.mjs'), 'utf8'), /<title>SQL Assistant<\/title>/);
});
