const test = require('node:test'); const assert = require('node:assert/strict');
const M = require(require('node:path').join(process.env.V17_BUILD || require('node:path').join(__dirname, '..', '.test-build'), 'v1721', 'index.js'));
const { SRC, clone, v170Published, currentSchema, TOTAL_DECODES } = require('./fixtures.cjs');
const decodes = (s) => s.tables.flatMap((t) => t.columns.flatMap((c) => c.decode || []));

test('Baseline reproduction: unmigrated AP schema 77 fails exactly like the V17.1+ report (#1..#3 …and 434 more)', () => {
  assert.equal(TOTAL_DECODES, 437);
  const errs = M.errorsOnly(M.validateSchemaDeep(v170Published(), 'schemas[2]'));
  assert.equal(errs.length, 437);
  assert.match(errs[0].path, /^schemas\[2\] › tables\[0\] \(IA_ACTION_LOG\) › columns\[2\] \(ROOT_DOCUMENT_TYPE\) › decode\[0\]$/);
  assert.equal(errs[0].reason, 'Column "IA_ACTION_LOG.ROOT_DOCUMENT_TYPE" has a decode entry (#1) with an empty raw value.');
  assert.equal(errs.length - 3, 434);
});

test('Test 1 — legacy schema without writer stamp → detected as legacy → migration → validation → success', () => {
  const s = v170Published();
  assert.equal(M.readStamp(s).present, false);
  assert.equal(M.detectFormat(s), 'legacy-unstamped');
  const r = M.migrateSchema(s, 'schemas[2]');
  assert.equal(r.status, 'migrated'); assert.equal(r.errors.length, 0);
  assert.equal(M.errorsOnly(M.validateSchemaDeep(r.schema)).length, 0);
  assert.equal(r.schema.schemaFormat.appVersion, '17.2.1'); assert.equal(r.schema.schemaFormat.formatVersion, 3);
  assert.equal(r.schema.schemaFormat.migratedFrom, 'legacy-unstamped');
});

test('Test 2 — empty decode raw values are restored from the legacy "code" field (R1), values preserved exactly', () => {
  const r = M.migrateSchema(v170Published());
  const col = r.schema.tables[0].columns[2];
  assert.equal(col.name, 'ROOT_DOCUMENT_TYPE');
  assert.deepEqual(col.decode, SRC.tables[0].columns[2].decode.map((d) => ({ rawValue: d.code, label: d.label })));
  assert.ok(decodes(r.schema).every((d) => !('code' in d)));
});

test('Test 3 — all 437 decode entries processed, no partial migration, nothing deleted', () => {
  const r = M.migrateSchema(v170Published());
  assert.equal(r.ruleCounts.R1, 437);
  const after = decodes(r.schema); assert.equal(after.length, 437);
  const before = SRC.tables.flatMap((t) => t.columns.flatMap((c) => c.decode || []));
  after.forEach((d, i) => { assert.equal(d.rawValue, before[i].code); assert.equal(d.label, before[i].label); });
  assert.equal(r.schema.tables.length, 77);
  assert.equal(r.schema.tables.reduce((n, t) => n + t.columns.length, 0), 1561);
});

test('Test 3b — variants: { code, label } without rawValue, and the original document format', () => {
  const a = M.migrateSchema(v170Published('code-only')); assert.equal(a.status, 'migrated'); assert.equal(a.ruleCounts.R1, 437);
  const doc = clone(SRC); doc.name = 'AP schema 77';
  const b = M.migrateSchema(doc); assert.equal(b.detectedFormat, 'legacy-document'); assert.equal(b.status, 'migrated', JSON.stringify(b.errors.slice(0, 2)));
  const c = b.schema.tables[0].columns[0]; assert.equal(c.isForeignKey, true); assert.deepEqual(c.references, { table: 'ADM_USER_DATA', column: 'FULLNAME'.replace('FULLNAME', 'ID') });
  assert.ok(!('primary_key' in c) && !('foreign_key' in c) && !('decode' in c) && !('alias' in c));
  assert.equal(b.schema.tables.find((t) => t.name === 'IA_INVOICE_ROW').columns.find((x) => x.name === 'DELIVERY_NOTE_NUMBER_ROW').alias, 'DELIVERY_NOTE_NUMBER');
});

test('Test 4 — invalid decode structure fails safely with exact location (no guessing NULL vs empty string)', () => {
  const r = M.migrateSchema(v170Published('stripped'), 'schemas[2]');
  assert.equal(r.status, 'rejected'); assert.equal(r.schema, null);
  assert.equal(r.errors.length, 437);
  assert.equal(r.errors[0].location, 'IA_ACTION_LOG.ROOT_DOCUMENT_TYPE');
  assert.match(r.errors[0].reason, /no legacy code to recover it from/);
  const msg = M.describeResult(r); assert.match(msg, /Legacy schema migration could not be completed/); assert.match(msg, /Schema: AP schema 77/); assert.match(msg, /…and 434 more\./); assert.match(msg, /existing valid local schema was preserved/);
  const s = v170Published(); s.tables[0].columns[2].decode[1] = { rawValue: 'X', code: 'Y', label: 'l' };
  const r2 = M.migrateSchema(s); assert.equal(r2.status, 'rejected'); assert.match(r2.errors[0].reason, /conflicts with legacy code/);
  const s3 = v170Published(); s3.tables[0].columns[2].decode.push({ code: 'AC', label: 'dup' });
  assert.equal(M.migrateSchema(s3).status, 'rejected');
  const s4 = v170Published(); s4.tables[0].columns[2].decode[0] = [1];
  assert.equal(M.migrateSchema(s4).status, 'rejected');
});

test('Test 5 — valid current schema: no migration, normal validation succeeds, output identical', () => {
  const s = currentSchema(); const r = M.migrateSchema(s);
  assert.equal(r.detectedFormat, 'current'); assert.equal(r.status, 'current'); assert.equal(r.changes.length, 0); assert.deepEqual(r.schema, s);
});

test('Valid legacy schema with no data problems is not rejected for the missing stamp — it is only stamped', () => {
  const s = currentSchema(); delete s.schemaFormat;
  const r = M.migrateSchema(s); assert.equal(r.status, 'migrated'); assert.ok(M.isStampOnly(r));
  const { schemaFormat, ...rest } = r.schema; assert.deepEqual(rest, s);
});

test('Test 6 — multiple schemas processed independently (current + legacy + unrecoverable)', () => {
  const file = { schemas: [currentSchema('Core'), (() => { const x = currentSchema('Extended'); delete x.schemaFormat; return x; })(), v170Published(), v170Published('stripped')] };
  file.schemas[3].name = 'Broken';
  const brokenBefore = JSON.stringify(file.schemas[3]);
  const rep = M.migrateRegistryFileInPlace(file);
  assert.deepEqual([rep.total, rep.current, rep.migrated, rep.rejected], [4, 1, 2, 1]);
  assert.equal(file.schemas[2].tables[0].columns[2].decode[0].rawValue, 'Invoice.Domain.Invoice');
  assert.equal(JSON.stringify(file.schemas[3]), brokenBefore, 'rejected schema left untouched for the existing validator');
  assert.deepEqual(rep.results[3].errors.length, 437);
  assert.match(M.summarizeReport(rep), /1 could not be migrated — local copies kept unchanged/);
  assert.deepEqual(M.badgesFor(rep.results[2]), ['Legacy schema', 'Migration successful', 'Migrated schema']);
  assert.deepEqual(M.badgesFor(rep.results[3]), ['Legacy schema', 'Migration required', 'Migration failed']);
  assert.deepEqual(M.badgesFor(rep.results[0]), ['Current schema']);
});

test('Test 7 — migration repeat: migrated schema needs no migration again (no loop), deterministic', () => {
  const r1 = M.migrateSchema(v170Published()); const r2 = M.migrateSchema(r1.schema);
  assert.equal(r2.detectedFormat, 'current'); assert.equal(r2.status, 'current'); assert.equal(r2.changes.length, 0);
  const ra = M.migrateSchema(v170Published()), rb = M.migrateSchema(v170Published());
  const strip = (s) => { const c = clone(s); delete c.schemaFormat.generatedAt; return c; };
  assert.deepEqual(strip(ra.schema), strip(rb.schema));
});

test('Cross-version: V17.0 publishes → V17.2.1 migrates → publishes → another V17.2.1 device downloads clean', () => {
  const repo = { schemas: [currentSchema('Core'), v170Published()] };            // older device published
  const devA = JSON.parse(JSON.stringify(repo)); M.migrateRegistryFileInPlace(devA); // new device A downloads + migrates
  const pub = M.prepareForPublish(devA.schemas); assert.equal(pub.ok, true);          // A publishes validated schemas
  const repo2 = JSON.parse(JSON.stringify({ schemas: pub.schemas }));
  const devB = JSON.parse(JSON.stringify(repo2)); const rep = M.migrateRegistryFileInPlace(devB); // device B downloads
  assert.deepEqual([rep.current, rep.migrated, rep.rejected], [2, 0, 0]);
  assert.ok(devB.schemas.every((s) => s.schemaFormat.formatVersion === 3));
  // V17.1/V17.2-style stamped (older format) schema is accepted and upgraded
  const v172 = currentSchema('V17.2'); v172.schemaFormat = undefined; v172.writerStamp = { version: '17.2.0' };
  const r = M.migrateSchema(v172); assert.equal(r.detectedFormat, 'stamped-older'); assert.equal(r.status, 'migrated');
});

test('Publish protection: an invalid schema is never published', () => {
  const res = M.prepareForPublish([currentSchema(), v170Published('stripped')]);
  assert.equal(res.ok, false); assert.equal(res.blocked.length, 1); assert.equal(res.blocked[0].schemaName, 'AP schema 77');
});

test('Validator is not weakened: relationships, identifiers, nullable, duplicate columns, decode label types', () => {
  const s = currentSchema(); s.relationships.push({ id: 'x', fromTable: 'NOPE', fromColumn: 'A', toTable: 'VENDOR', toColumn: 'MISSING' });
  s.tables[0].columns.push({ name: 'BAD NAME', label: 'x', type: 'X', nullable: true });
  s.tables[1].columns.push({ name: 'INVOICE_ID', label: 'dup', type: 'NUMBER', nullable: 'maybe' });
  s.tables[0].columns[1].decode.push({ rawValue: 'Z', label: 5 });
  const e = M.errorsOnly(M.validateSchemaDeep(s)).map((x) => x.reason).join('\n');
  for (const p of [/Table "NOPE" does not exist/, /Column "VENDOR.MISSING" does not exist/, /not a valid identifier/, /Duplicate column "INVOICE_ID"/, /"nullable" must be true or false/, /Decode label must be a string/]) assert.match(e, p);
});

test('Generic, not special-cased: rule applies to any column/table name', () => {
  const s = currentSchema(); delete s.schemaFormat; s.tables[0].columns[1].decode = [{ rawValue: '', code: 'A', label: 'Active' }, { value: 7, label: 'Seven' }, 'X=Ten'];
  const r = M.migrateSchema(s); assert.equal(r.status, 'migrated');
  assert.deepEqual(r.schema.tables[0].columns[1].decode, [{ rawValue: 'A', label: 'Active' }, { rawValue: '7', label: 'Seven' }, { rawValue: 'X', label: 'Ten' }]);
});

test('Diagnostics never expose secrets', () => {
  const s = v170Published('stripped'); s.name = 'leak ghp_A1b2C3d4E5f6G7h8I9j0';
  assert.doesNotMatch(M.describeResult(M.migrateSchema(s)), /ghp_A1b2/);
});
