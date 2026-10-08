import { test } from 'node:test'; import assert from 'node:assert/strict';
import { imp, tiny } from './helpers.mjs';
const { memoryStore, KEYS } = await imp('services/storage.js'); const { memoryRepository } = await imp('v17/services/githubClient.js'); const M = await imp('v17/services/adminMessage.js'); const { SchemaService } = await imp('services/schemaService.js');
const SY = await imp('v17/sync/syncService.js'); const V = await imp('v17/services/secretVault.js'); const F = await imp('v17/sync/schemaFormat.js');
const PATH = M.adminMessagePathFor('sql-assistant-data/schemas/registry.json'); const TOKEN = 'ghp_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2';
const dev = (repo) => { const store = memoryStore(); return { store, svc: new M.AdminMessageService(store, () => repo, () => PATH, () => [TOKEN]) }; };
const tick = () => new Promise((r) => setTimeout(r, 6));

test('V17.5.1 path + text rules: sibling file in the same repository folder; one line; control characters removed; 140-character limit counts characters; credentials refused', () => {
  assert.equal(PATH, 'sql-assistant-data/messages/admin-message.json'); assert.equal(M.adminMessagePathFor('x/y/schemas/registry.json'), 'x/y/messages/admin-message.json'); assert.equal(M.adminMessagePathFor('custom/reg.json'), 'custom/admin-message.json'); assert.equal(M.adminMessagePathFor(''), 'sql-assistant-data/messages/admin-message.json');
  assert.deepEqual(M.checkMessageText('  Hello\n\n  world\t\u0007!  '), { text: 'Hello world !', problem: null }); assert.match(M.checkMessageText('   ').problem, /Enter the message/);
  assert.equal(M.checkMessageText('x'.repeat(140)).problem, null); assert.match(M.checkMessageText('x'.repeat(141)).problem, /141 characters.*limit is 140/); assert.equal(M.checkMessageText('é'.repeat(140)).problem, null, 'characters, not bytes'); assert.equal(M.checkMessageText('😀'.repeat(140)).problem, null, 'an emoji is one character');
  for (const bad of [`use token ${TOKEN}`, 'password: hunter2hunter2', 'the passphrase = correct horse']) assert.match(M.checkMessageText(bad).problem, /credential/, bad);
  assert.equal(M.checkMessageText('Maintenance at 22:00 — sync may be unavailable (planned)').problem, null, 'ordinary text with colons / dashes is fine');
});
test('V17.5.1 untrusted input: the repository file is validated field by field; hostile or malformed records are ignored, HTML stays text', () => {
  const ok = { format: M.ADMIN_MESSAGE_FORMAT, formatVersion: 1, id: 'm1', active: true, text: 'Hi', level: 'warning', updatedAt: '2026-10-08T10:00:00.000Z', updatedByDevice: 'd', appVersion: '17.5.1' };
  assert.equal(M.sanitizeMessage(ok).level, 'warning'); assert.equal(M.sanitizeMessage({ ...ok, level: 'critical<script>' }).level, 'info', 'unknown level → info');
  for (const bad of [null, [], 'x', { ...ok, format: 'other' }, { ...ok, formatVersion: 9 }, { ...ok, id: '../../x' }, { ...ok, id: '' }, { ...ok, updatedAt: 'not a date' }, { ...ok, active: 'yes' }, { ...ok, text: 'x'.repeat(500) }, { ...ok, text: `leak ${TOKEN}` }, { ...ok, text: '   ' }]) assert.equal(M.sanitizeMessage(bad), null, JSON.stringify(bad)?.slice(0, 60));
  const html = M.sanitizeMessage({ ...ok, text: '<img src=x onerror=alert(1)> hello' }); assert.equal(html.text, '<img src=x onerror=alert(1)> hello', 'kept as plain text — the UI escapes it'); assert.equal(M.sanitizeMessage({ ...ok, active: false, text: 'ignored' }).text, '', 'a clearing record carries no text');
});
test('V17.5.1 cross-device: A publishes, B receives it; dismissal is per device and a NEW message shows again; clearing reaches every device (also one that was offline)', async () => {
  const repo = memoryRepository(); const A = dev(repo); const B = dev(repo); const C = dev(repo);
  const p = await A.svc.publish('  Planned maintenance tonight 22:00 CET  ', 'warning'); assert.deepEqual([p.ok, p.published], [true, true]); assert.equal(A.svc.current().text, 'Planned maintenance tonight 22:00 CET'); assert.ok(repo.files.has(PATH)); assert.ok(!A.svc.pendingPublish());
  const file = JSON.parse(repo.files.get(PATH).text); assert.deepEqual([file.format, file.formatVersion, file.active, file.level, file.appVersion], ['sqla-admin-message', 1, true, 'warning', F.APP_VERSION]); assert.ok(file.updatedByDevice && file.updatedAt && file.id);
  assert.equal(B.svc.current(), null); const r = await B.svc.pull(); assert.deepEqual([r.ok, r.changed], [true, true]); assert.equal(B.svc.current().text, 'Planned maintenance tonight 22:00 CET'); assert.equal(B.svc.current().level, 'warning');
  let seen = 0; B.svc.subscribe(() => seen++); B.svc.dismiss(); assert.equal(B.svc.current(), null, 'hidden on B'); assert.equal(A.svc.current().text.length > 0, true, 'still visible on A'); assert.ok(seen >= 1);
  assert.equal((await B.svc.pull()).changed, false, 'pulling the same message again does not bring it back'); assert.equal(B.svc.current(), null);
  await tick(); await A.svc.publish('Maintenance finished', 'info'); await B.svc.pull(); assert.equal(B.svc.current().text, 'Maintenance finished', 'a new message appears again after a dismissal');
  await tick(); const c = await A.svc.clear(); assert.deepEqual([c.ok, c.published], [true, true]); assert.equal(A.svc.current(), null); assert.equal(JSON.parse(repo.files.get(PATH).text).active, false);
  await B.svc.pull(); assert.equal(B.svc.current(), null, 'cleared on B'); assert.equal(B.svc.record().active, false);
  const late = await C.svc.pull(); assert.equal(late.ok, true); assert.equal(C.svc.current(), null, 'a device that never saw the message shows nothing'); assert.equal(C.svc.record().active, false, 'it adopted the clearing record, so an older copy can never bring the message back');
});
test('V17.5.1 last writer wins: an older repository record never replaces a newer local one; the same record twice is a no-op', async () => {
  const repo = memoryRepository(); const A = dev(repo); await A.svc.publish('first', 'info'); const old = repo.files.get(PATH).text; await tick(); await A.svc.publish('second', 'info');
  const B = dev(memoryRepository({ [PATH]: old })); await B.svc.pull(); assert.equal(B.svc.current().text, 'first'); B.svc['store'].set(KEYS.adminMessage, JSON.stringify(A.svc.record())); assert.equal((await B.svc.pull()).changed, false); assert.equal(B.svc.current().text, 'second', 'stale remote ignored');
  await tick(); const other = dev(repo); await other.svc.pull(); await tick(); await other.svc.publish('from a second administrator', 'info'); await A.svc.pull(); assert.equal(A.svc.current().text, 'from a second administrator', 'the newer record wins');
});
test('V17.5.1 failures are quiet and safe: no repository, download error, damaged file — the message already shown stays; nothing throws', async () => {
  const repo = memoryRepository(); const A = dev(repo); await A.svc.publish('Keep me', 'info'); const B = dev(repo); await B.svc.pull(); assert.equal(B.svc.current().text, 'Keep me');
  const none = new M.AdminMessageService(B.store, () => null, () => PATH); let o = await none.pull(); assert.deepEqual([o.ok, o.stage], [false, 'Configuration']); assert.equal(none.current().text, 'Keep me');
  const down = new M.AdminMessageService(B.store, () => ({ ...repo, async read() { throw new Error(`Could not reach GitHub (network down) token ${TOKEN}`); } }), () => PATH, () => [TOKEN]); o = await down.pull(); assert.deepEqual([o.ok, o.stage], [false, 'Download']); assert.ok(!o.message.includes(TOKEN), 'tokens are redacted from errors'); assert.equal(down.current().text, 'Keep me');
  for (const junk of ['<html>sign in</html>', '{broken', JSON.stringify({ format: 'x' }), JSON.stringify({ format: M.ADMIN_MESSAGE_FORMAT, formatVersion: 1, id: 'q', active: true, text: `leak ${TOKEN}`, level: 'info', updatedAt: new Date().toISOString() })]) { const s = new M.AdminMessageService(B.store, () => memoryRepository({ [PATH]: junk }), () => PATH); o = await s.pull(); assert.deepEqual([o.ok, o.stage], [false, 'Parse'], junk.slice(0, 20)); assert.equal(s.current().text, 'Keep me'); }
  const empty = await new M.AdminMessageService(B.store, () => memoryRepository(), () => PATH).pull(); assert.equal(empty.ok, true); assert.equal(B.svc.current().text, 'Keep me', 'a missing file does not erase a message that is still showing');
});
test('V17.5.1 publishing while the repository is unavailable: saved on this device, reported honestly, published automatically at the next synchronization', async () => {
  const repo = memoryRepository(); let down = true; const flaky = { ...repo, read: async (p) => { if (down) throw new Error('Could not reach GitHub (offline).'); return repo.read(p); }, write: async (...a) => { if (down) throw new Error('Could not reach GitHub (offline).'); return repo.write(...a); } };
  const store = memoryStore(); const A = new M.AdminMessageService(store, () => flaky, () => PATH); const r = await A.publish('Offline notice', 'info');
  assert.deepEqual([r.ok, r.published], [true, false]); assert.match(r.message, /saved on this device but could not be published/); assert.equal(A.current().text, 'Offline notice'); assert.equal(A.pendingPublish(), true); assert.ok(!repo.files.has(PATH));
  assert.equal((await A.pull()).ok, false); assert.equal(A.current().text, 'Offline notice', 'a failed pull never removes the local message');
  down = false; const s = await A.synchronize(); assert.equal(s.published, true); assert.equal(A.pendingPublish(), false); assert.equal(JSON.parse(repo.files.get(PATH).text).text, 'Offline notice'); const B = dev(repo); await B.svc.pull(); assert.equal(B.svc.current().text, 'Offline notice');
  const nocfg = new M.AdminMessageService(memoryStore(), () => null, () => PATH); const p2 = await nocfg.publish('Local only', 'info'); assert.deepEqual([p2.ok, p2.published, p2.stage], [true, false, 'Configuration']); assert.match(p2.message, /Secret Vault|repository connection/);
});
test('V17.5.1 publish validation: empty, too long and credential-like texts are refused before anything is written; a concurrent write is retried', async () => {
  const repo = memoryRepository(); const A = dev(repo); for (const t of ['', '  ', 'x'.repeat(141), `token ${TOKEN}`, 'password: abc12345']) { const r = await A.svc.publish(t, 'info'); assert.deepEqual([r.ok, r.stage], [false, 'Validation'], t.slice(0, 20)); } assert.equal(A.svc.record(), null); assert.ok(!repo.files.has(PATH));
  let n = 0; const racy = { ...repo, write: async (p, t, s, m) => { if (n++ === 0) throw new Error('Writing failed: the file changed on the server — synchronize again.'); return repo.write(p, t, s, m); } }; const R = new M.AdminMessageService(memoryStore(), () => racy, () => PATH); const r = await R.publish('Retried', 'info'); assert.deepEqual([r.ok, r.published], [true, true]); assert.equal(JSON.parse(repo.files.get(PATH).text).text, 'Retried');
  const other = await dev(repo); assert.ok(other);
});
test('V17.5.1 isolation: the admin message never touches schema synchronization, the schema registry or the sync settings (separate file, separate keys)', async () => {
  const repo = memoryRepository(); const store = memoryStore(); const schemas = new SchemaService(store); const sync = new SY.SyncService(schemas, () => repo, store, () => V.CANONICAL_SCHEMA_PATH);
  const s = tiny('Core A'); const reg = schemas.registry(); schemas.replaceRegistry({ ...reg, schemas: [...reg.schemas, s], activeSchemaId: s.id }); assert.equal((await sync.push()).ok, true); const before = repo.files.get(V.CANONICAL_SCHEMA_PATH).text; const regBefore = JSON.stringify(schemas.registry()); const metaBefore = store.get(KEYS.syncMeta);
  const msg = new M.AdminMessageService(store, () => repo, () => PATH); await msg.publish('Hello everyone', 'info'); await msg.clear(); await msg.pull();
  assert.equal(repo.files.get(V.CANONICAL_SCHEMA_PATH).text, before, 'the schema file is byte-identical'); assert.equal(JSON.stringify(schemas.registry()), regBefore); assert.equal(store.get(KEYS.syncMeta), metaBefore, 'sync metadata untouched'); assert.deepEqual([...repo.files.keys()].sort(), [PATH, V.CANONICAL_SCHEMA_PATH].sort());
  assert.ok(![KEYS.registry, KEYS.syncMeta, KEYS.syncBase, KEYS.vaultLocal, KEYS.schemaPassphrase].includes(KEYS.adminMessage)); assert.equal((await sync.synchronize()).pull.ok, true, 'schema sync still works');
});
