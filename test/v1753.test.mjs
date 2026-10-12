import { test } from 'node:test'; import assert from 'node:assert/strict';
import { imp, tiny } from './helpers.mjs';
const { memoryStore, KEYS } = await imp('services/storage.js'); const { SchemaService } = await imp('services/schemaService.js');
const SY = await imp('v17/sync/syncService.js'); const GH = await imp('v17/services/githubClient.js'); const V = await imp('v17/services/secretVault.js'); const SC = await imp('v17/services/schemaCrypto.js');
const F = await imp('v17/sync/schemaFormat.js');
const PATH = V.CANONICAL_SCHEMA_PATH; const ENC = SC.encryptedPathFor(PATH); const PASS = 'violet-harbour-2026-lantern'; const NEW = 'amber-meadow-2027-compass'; const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const dev = (repo, pass = { value: null }, store = memoryStore()) => { const schemas = new SchemaService(store); const sync = new SY.SyncService(schemas, () => repo, store, () => PATH, () => (pass.value ? [pass.value, TOKEN] : [TOKEN]), { passphrase: async () => pass.value, path: () => ENC, saved: () => !!pass.value }); return { store, schemas, sync, pass }; };
const withSchema = (d, s) => { const r = d.schemas.registry(); assert.equal(d.schemas.replaceRegistry({ ...r, schemas: [...r.schemas.filter((x) => x.name !== s.name), s], activeSchemaId: s.id }).ok, true); };
const mk = (name, label = 'Open') => { const s = tiny(name); s.updatedAt = '2026-03-01T10:00:00.000Z'; s.tables[0].columns[1].decode = [{ rawValue: '1', label }, { rawValue: '2', label: 'Approved' }]; return s; };
const wrap = (repo, o = {}) => ({ ...repo, describe: repo.describe, writes: [], reads: [], async read(p) { this.reads.push(p); return o.read ? o.read(p, repo) : repo.read(p); }, async write(p, t, s, m) { this.writes.push(p); return o.write ? o.write(p, t, s, m, repo) : repo.write(p, t, s, m); } });
const coreSnap = (d) => JSON.stringify([d.schemas.registry(), d.store.get(KEYS.syncBase)]);

test('V17.5.3 publish: validate → encrypt → write → READ BACK and compare → success; the outcome names every schema that was added; only the registry file is written', async () => {
  const repo = GH.memoryRepository({ 'sql-assistant-data/knowledge/knowledge.json': '{"k":1}', 'sql-assistant-data/messages/admin-message.json': '{"m":1}', 'README.md': '# data repo' }); const before = Object.fromEntries([...repo.files].map(([k, v]) => [k, v.text]));
  const A = dev(repo); withSchema(A, mk('Orders')); withSchema(A, mk('Billing')); const w = wrap(repo); const A2 = new SY.SyncService(A.schemas, () => w, A.store, () => PATH, () => [TOKEN], { passphrase: async () => null, path: () => ENC, saved: () => false });
  const r = await A2.push({ passphrase: PASS, skipIfIdentical: true, protectRemote: true });
  assert.deepEqual([r.ok, r.verified, r.upToDate, r.encrypted, r.path], [true, true, undefined, true, ENC]); assert.deepEqual(r.published.map((x) => [x.name, x.kind]).sort(), [['Billing', 'added'], ['Orders', 'added']]); assert.match(r.messages[0], /as an encrypted file \(AES-256-GCM.*read back from the repository and verified/);
  assert.deepEqual(w.writes, [ENC], 'exactly one file was written'); assert.ok(w.reads.filter((p) => p === ENC).length >= 2, 'the file was read before the write and again after it');
  for (const [k, v] of Object.entries(before)) assert.equal(repo.files.get(k).text, v, `${k} is untouched`); assert.ok(!repo.files.has(PATH), 'no plain schema file was created');
  const enc = repo.files.get(ENC).text; assert.ok(!enc.includes(PASS) && !enc.includes('Orders') && !enc.includes('Approved'), 'nothing readable in the repository'); const dec = JSON.parse((await SC.decryptSchemaRegistry(enc, PASS)).text); assert.deepEqual(dec.schemas.map((s) => s.name).sort(), ['Billing', 'Orders']);
  assert.equal(A.store.get(KEYS.schemaPassphrase), null, 'the push itself did not save the passphrase — the caller does that after verification'); assert.deepEqual(A2.status().pending, [], 'verified publication clears "not yet published"');
});
test('V17.5.3 update: only the changed schema is reported as updated; an identical repository is left alone (no commit); results are idempotent', async () => {
  const repo = GH.memoryRepository(); const A = dev(repo, { value: PASS }); withSchema(A, mk('Orders')); withSchema(A, mk('Billing')); assert.equal((await A.sync.push({ skipIfIdentical: true })).ok, true);
  const s = JSON.parse(JSON.stringify(A.schemas.schemas().find((x) => x.name === 'Orders'))); s.tables[0].columns[1].decode[0].label = 'Opened'; s.updatedAt = '2026-05-01T00:00:00.000Z'; assert.equal(A.schemas.saveSchema(s).ok, true);
  assert.deepEqual(A.sync.publishPlan().schemas.map((x) => [x.name, x.kind]).sort(), [['Billing', 'unchanged'], ['Orders', 'changed']]);
  let r = await A.sync.push({ skipIfIdentical: true }); assert.deepEqual([r.ok, r.verified], [true, true]); assert.deepEqual(r.published.map((x) => [x.name, x.kind]).sort(), [['Billing', 'unchanged'], ['Orders', 'updated']]);
  const w = wrap(repo); const A2 = new SY.SyncService(A.schemas, () => w, A.store, () => PATH, () => [], { passphrase: async () => PASS, path: () => ENC, saved: () => true }); r = await A2.push({ skipIfIdentical: true });
  assert.deepEqual([r.ok, r.upToDate, r.verified], [true, true, true]); assert.match(r.messages[0], /already holds the same 2 schema/); assert.deepEqual(w.writes, [], 'no write when nothing changed'); assert.deepEqual(A2.status().pending, []);
  for (let i = 0; i < 2; i++) { r = await A2.push({ skipIfIdentical: true }); assert.equal(r.upToDate, true); } assert.equal(JSON.parse((await SC.decryptSchemaRegistry(repo.files.get(ENC).text, PASS)).text).schemas.length, 2, 'no duplicate schemas');
  const classic = await A.sync.push(); assert.deepEqual([classic.ok, classic.verified, !!classic.upToDate], [true, true, false], 'the classic push (no new options) still writes and is now verified as well'); assert.match(classic.messages[0], /verified/);
});
test('V17.5.3 an update that cannot be confirmed is NEVER reported as success: read-back missing / different / failing → stage Verify, schemas stay "not yet published"', async () => {
  const cases = { 'file missing after the write': (p, repo) => null, 'content differs': async (p, repo) => { const f = await repo.read(p); return { ...f, text: f.text.replace(/"ct": "(.)/, (m, c) => '"ct": "' + (c === 'Z' ? 'Y' : 'Z')) }; }, 'read-back fails': () => { throw new GH.RepositoryError('Could not reach GitHub (network down).', 'network'); } };
  for (const [name, mkRead] of Object.entries(cases)) {
    const repo = GH.memoryRepository(); let wrote = false; const flaky = { ...repo, async read(p) { return wrote ? mkRead(p, repo) : repo.read(p); }, async write(...a) { wrote = true; return repo.write(...a); } };
    const A = dev(flaky, { value: PASS }); withSchema(A, mk('Orders')); const r = await A.sync.push({ skipIfIdentical: true });
    assert.deepEqual([r.ok, r.stage, r.errorKind, !!r.verified], [false, 'Verify', 'verify', false], name); assert.match(r.problems[0], /did not confirm the update.*NOT reported as successful/); assert.deepEqual(A.sync.status().pending, ['Orders'], `${name}: still pending`); assert.ok(A.sync.status().lastError, 'the failure is logged');
  }
});
test('V17.5.3 failure classes are typed and no false success is produced: no connection, token rejected, no write permission, network, timeout, repository conflict — the repository is unchanged', async () => {
  const mkErr = (kind, msg) => () => { throw new GH.RepositoryError(msg, kind); };
  const none = dev(null, { value: PASS }); withSchema(none, mk('Orders')); let r = await new SY.SyncService(none.schemas, () => null, none.store, () => PATH).push({ passphrase: PASS }); assert.deepEqual([r.ok, r.stage, r.errorKind], [false, 'Configuration', 'config']);
  for (const [kind, where] of [['auth', 'write'], ['permission', 'write'], ['conflict', 'write'], ['network', 'write'], ['timeout', 'write'], ['auth', 'read'], ['permission', 'read'], ['network', 'read'], ['timeout', 'read'], ['not-found', 'write']]) {
    const repo = GH.memoryRepository({ 'other.txt': 'keep' }); const bad = { ...repo, async read(p) { if (where === 'read') mkErr(kind, `Reading failed: ${kind} ${TOKEN}`)(); return repo.read(p); }, async write() { if (where === 'write') mkErr(kind, `Writing failed: ${kind} ${TOKEN}`)(); } };
    const A = dev(bad, { value: PASS }); withSchema(A, mk('Orders')); const before = coreSnap(A); r = await A.sync.push({ passphrase: PASS, skipIfIdentical: true, protectRemote: true });
    assert.deepEqual([r.ok, r.errorKind, !!r.verified], [false, kind, false], `${kind}@${where}`); assert.ok(!r.problems.join().includes(TOKEN), 'the token is redacted'); assert.deepEqual([...repo.files.keys()], ['other.txt']); assert.equal(repo.files.get('other.txt').text, 'keep'); assert.equal(coreSnap(A), before, 'local schemas and sync state unchanged'); assert.deepEqual(A.sync.status().pending, ['Orders']);
  }
});
test('V17.5.3 a typed passphrase is used for one publication only: it is not saved by the push, never appears in any outcome, log or repository file; a weak one is refused before the repository is touched', async () => {
  const repo = GH.memoryRepository(); const w = wrap(repo); const A = dev(repo); withSchema(A, mk('Orders')); const S = new SY.SyncService(A.schemas, () => w, A.store, () => PATH, () => [], { passphrase: async () => null, path: () => ENC, saved: () => false });
  let r = await S.push({ passphrase: 'short' }); assert.equal(r.ok, false); assert.equal(r.errorKind, 'passphrase'); assert.deepEqual(w.writes, [], 'nothing was written with a weak passphrase');
  r = await S.push({ passphrase: PASS, skipIfIdentical: true }); assert.equal(r.ok, true); const everything = JSON.stringify([r, S.log(), [...repo.files.values()].map((f) => f.text), A.store.keys().map((k) => A.store.get(k))]); assert.ok(!everything.includes(PASS), 'the passphrase appears nowhere');
  const B = dev(repo); const pv = await B.sync.previewEncryptedPull(PASS); assert.equal(pv.ok, true); await B.sync.applyPreview(pv); assert.deepEqual(B.schemas.schemas().filter((x) => x.name === 'Orders').length, 1, 'Device B pulled what Device A published');
});
test('V17.5.3 rotation: a different passphrase is refused (repository untouched) unless the replacement is explicit; after rotation the old passphrase no longer opens the file and the new one does', async () => {
  const repo = GH.memoryRepository(); const A = dev(repo); withSchema(A, mk('Orders')); assert.equal((await A.sync.push({ passphrase: PASS })).ok, true); const before = repo.files.get(ENC).text;
  let r = await A.sync.push({ passphrase: NEW, skipIfIdentical: true, protectRemote: true }); assert.deepEqual([r.ok, r.stage, r.errorKind], [false, 'Passphrase', 'passphrase']); assert.match(r.problems[0], /different passphrase/); assert.ok(!r.problems.join().includes(NEW)); assert.equal(repo.files.get(ENC).text, before);
  r = await A.sync.push({ passphrase: NEW, skipIfIdentical: true, protectRemote: true, replaceUndecryptable: true }); assert.deepEqual([r.ok, r.verified], [true, true]);
  await assert.rejects(SC.decryptSchemaRegistry(repo.files.get(ENC).text, PASS), (e) => e.code === 'incorrect-passphrase'); assert.equal(JSON.parse((await SC.decryptSchemaRegistry(repo.files.get(ENC).text, NEW)).text).schemas.length, 1);
  const B = dev(repo); assert.equal((await B.sync.previewEncryptedPull(PASS)).problem.kind, 'incorrect-passphrase'); assert.equal((await B.sync.previewEncryptedPull(NEW)).ok, true);
  const dmg = GH.memoryRepository({ [ENC]: '{not json' }); const C = dev(dmg); withSchema(C, mk('Orders')); r = await C.sync.push({ passphrase: PASS, protectRemote: true }); assert.deepEqual([r.ok, r.errorKind], [false, 'decryption']); assert.equal(dmg.files.get(ENC).text, '{not json'); assert.equal((await C.sync.push({ passphrase: PASS, replaceUndecryptable: true })).ok, true);
});
test('V17.5.3 protection of the repository: publishing never drops a schema that exists only in the repository, never publishes an invalid schema, and pauses on an unresolved conflict', async () => {
  const repo = GH.memoryRepository(); const A = dev(repo, { value: PASS }); withSchema(A, mk('Orders')); withSchema(A, mk('Billing')); assert.equal((await A.sync.push()).ok, true);
  const B = dev(repo, { value: PASS }); await B.sync.applyPreview(await B.sync.previewEncryptedPull(PASS)); assert.equal(B.schemas.schemas().filter((x) => ['Orders', 'Billing'].includes(x.name)).length, 2); assert.equal(B.schemas.deleteSchema(B.schemas.schemas().find((x) => x.name === 'Billing').id).ok, true);
  const before = repo.files.get(ENC).text; let r = await B.sync.push({ skipIfIdentical: true, protectRemote: true }); assert.deepEqual([r.ok, r.errorKind], [false, 'would-remove']); assert.match(r.problems[0], /would remove 1 schema.*"Billing"/); assert.equal(repo.files.get(ENC).text, before, 'the repository still holds both schemas');
  const bad = dev(GH.memoryRepository(), { value: PASS }); const s = mk('Broken'); s.tables[0].columns[1].decode = [{ rawValue: '', label: 'x' }]; bad.schemas['reg'].schemas.push(s); assert.equal(bad.sync.publishPlan().schemas.find((x) => x.name === 'Broken').problem !== null, true); r = await bad.sync.push({ skipIfIdentical: true }); assert.deepEqual([r.ok, r.stage, r.errorKind], [false, 'Publish gate', 'validation']); assert.equal(bad.sync['repo']().files.size, 0);
  const C = dev(repo, { value: PASS }); await C.sync.applyPreview(await C.sync.previewEncryptedPull(PASS)); const edit = (d, label) => { const x = JSON.parse(JSON.stringify(d.schemas.schemas().find((y) => y.name === 'Orders'))); x.tables[0].columns[1].decode[0].label = label; x.updatedAt = new Date(Date.now() + 9000).toISOString(); assert.equal(d.schemas.saveSchema(x).ok, true); };
  edit(A, 'A-side'); assert.equal((await A.sync.push()).ok, true); edit(C, 'C-side'); r = await C.sync.push({ skipIfIdentical: true, protectRemote: true }); assert.deepEqual([r.ok, r.errorKind], [false, 'unresolved-conflict']); assert.equal(C.sync.status().conflicts, 1); assert.equal(C.schemas.schemas().find((y) => y.name === 'Orders').tables[0].columns[1].decode[0].label, 'C-side', 'the local edit was not overwritten');
});
test('V17.5.3 publishPlan: new / changed / unchanged, invalid schemas and the starter schemas that stay local — a pure read', async () => {
  const repo = GH.memoryRepository(); const A = dev(repo, { value: PASS }); let p = A.sync.publishPlan(); assert.deepEqual([p.schemas.length, p.excluded.length > 0, p.path], [0, true, ENC]);
  withSchema(A, mk('Orders')); const snap = coreSnap(A); p = A.sync.publishPlan(); assert.deepEqual(p.schemas.map((x) => [x.name, x.kind, x.tables, x.columns, x.decodeEntries, x.problem]), [['Orders', 'new', 1, 2, 2, null]]); assert.equal(coreSnap(A), snap, 'planning wrote nothing'); assert.equal(repo.files.size, 0);
  await A.sync.push(); assert.equal(A.sync.publishPlan().schemas[0].kind, 'unchanged');
});
test('V17.5.3 compatibility: files written by V17.5.2 (plain and encrypted) are read unchanged, and the files written now keep the same formats', async () => {
  const repo = GH.memoryRepository(); const A = dev(repo); withSchema(A, mk('Orders')); await A.sync.push({ passphrase: PASS }); const h = SC.readHeader(repo.files.get(ENC).text); assert.deepEqual([h.format, h.formatVersion, h.schemaFormatVersion, h.appVersion], ['sqla-schema-sync', 1, 2, F.APP_VERSION]); assert.match(F.APP_VERSION, /^17\.[56]\.\d+$/);
  const old = JSON.stringify({ ...JSON.parse((await SC.decryptSchemaRegistry(repo.files.get(ENC).text, PASS)).text), appVersion: '17.5.2', writtenBy: 'SQL Assistant 17.5.2' }); const enc = await SC.encryptSchemaRegistry(old, PASS, { device: 'old', schemaCount: 1 });
  const B = dev(GH.memoryRepository({ [ENC]: enc })); const pv = await B.sync.previewEncryptedPull(PASS); assert.deepEqual([pv.ok, pv.rows[0].kind], [true, 'add']);
  const P = dev(GH.memoryRepository({ [PATH]: F.serializeRegistry({ schemas: [mk('Plain Old')], activeSchemaId: 's-plain-old' }, 'd').text })); const x = await P.sync.synchronize(); assert.equal(x.pull.ok, true); assert.ok(P.schemas.schemas().some((s) => s.name === 'Plain Old'));
});
test('V17.5.3 read-back tolerates a briefly stale repository (previous version served right after the write) — still verified; a content that never matches is never a success', async () => {
  const repo = GH.memoryRepository(); let wrote = false; let stale = 1; const eventually = { ...repo, async read(p) { if (wrote && p === ENC && stale-- > 0) return null; return repo.read(p); }, async write(...a) { wrote = true; return repo.write(...a); } };
  const A = dev(eventually, { value: PASS }); withSchema(A, mk('Orders')); const r = await A.sync.push({ skipIfIdentical: true }); assert.deepEqual([r.ok, r.verified], [true, true]); assert.deepEqual(A.sync.status().pending, []);
});
