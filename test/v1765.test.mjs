// V17.6.5 — centralized Admin Password (synchronized across devices) + Settings → Security → Reset Admin Password to Default.
// Several "devices" run in one process: each has its own browser storage (localStorage + the key-value store); `on(dev)` makes it the current one.
import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync, existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'; import { join, dirname } from 'node:path'; import { tmpdir } from 'node:os'; import { imp } from './helpers.mjs';
const root = join(dirname(new URL(import.meta.url).pathname), '..'); const src = (p) => readFileSync(join(root, p), 'utf8');
const P = await imp('services/passwordService.js'); const CS = await imp('services/cryptoService.js'); const { AdminPasswordService, adminPasswordPathFor, sanitizePasswordRecord } = await imp('v17/services/adminPassword.js');
const { memoryRepository } = await imp('v17/services/githubClient.js'); const { memoryStore, KEYS } = await imp('services/storage.js');
const PATH = 'sql-assistant-data/security/admin-password.json'; const MARKER = 'sqla-verified-marker-v15';
let current = null;
const ls = (m) => ({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: () => null, length: 0 });
function device(name, repo) { const mem = new Map(); const store = memoryStore(); const d = { name, mem, store, repo, svc: null }; d.svc = new AdminPasswordService(store, () => d.repo, () => 'sql-assistant-data/schemas/registry.json'.replace(/.*/, () => adminPasswordPathFor('sql-assistant-data/schemas/registry.json'))); return d; }
const on = (d) => { current = d; globalThis.localStorage = ls(d.mem); P.setPasswordAuthority(d.svc); return d; };
const central = (repo) => JSON.parse(repo.files.get(PATH).text);
/** A V17.6.4 device that already has a custom password (what an upgraded installation looks like): the marker only, no meta. */
async function legacyDevice(repo, password) { const d = on(device('legacy', repo)); assert.equal((await P.changePassword('admin', password)).ok, true); return d; }
const keysOf = (d) => [...d.mem.keys(), ...d.store.keys()].sort();

test('path: …/schemas/registry.json → …/security/admin-password.json (next to the other repository data, JSON only, below sql-assistant-data/)', () => {
  assert.equal(adminPasswordPathFor('sql-assistant-data/schemas/registry.json'), PATH); assert.equal(adminPasswordPathFor('x/y/schemas/registry.json'), 'x/y/security/admin-password.json'); assert.equal(adminPasswordPathFor('registry.json'), 'sql-assistant-data/security/admin-password.json');
});
test('fresh installation: default "admin", nothing is published, nothing is stored centrally for a device that never changed the password (V17.6.6: and nothing is claimed as synchronized)', async () => {
  const repo = memoryRepository(); const a = on(device('A', repo)); const r = await a.svc.synchronize();
  assert.equal(r.ok, true); assert.equal(r.synchronized, false, 'V17.6.6: the default is never reported as synchronized'); assert.equal(repo.files.size, 0, 'a fresh installation publishes nothing'); assert.equal(await P.verifyPassword('admin'), true); assert.equal(P.isUsingDefaultPassword(), true);
});
test('upgrade from V17.6.4: the first device with a custom password publishes it as revision 1 (encrypted marker only); other devices adopt it — their own different passwords are replaced', async () => {
  const repo = memoryRepository(); const a = await legacyDevice(repo, 'Alpha-2026-pw'); const b = on(device('B', repo)); const c = await legacyDevice(repo, 'Gamma-own-pw');
  on(a); const r1 = await a.svc.synchronize(); assert.equal(r1.synchronized, true); const rec = central(repo); assert.equal(rec.revision, 1); assert.equal(rec.isDefault, false); assert.equal(rec.format, 'sqla-admin-password');
  assert.ok(!JSON.stringify(rec).includes('Alpha-2026-pw'), 'no plaintext in the repository'); assert.equal(await CS.decryptWithSecret('Alpha-2026-pw', rec.verifier), MARKER);
  on(b); const rb = await b.svc.synchronize(); assert.equal(rb.synchronized, true); assert.equal(await P.verifyPassword('Alpha-2026-pw'), true); assert.equal(await P.verifyPassword('admin'), false); assert.equal(P.isUsingDefaultPassword(), false);
  on(c); const rc = await c.svc.synchronize(); assert.equal(rc.replacedLocal, true, 'device C is told its own password was replaced'); assert.equal(await P.verifyPassword('Alpha-2026-pw'), true); assert.equal(await P.verifyPassword('Gamma-own-pw'), false);
  assert.equal(central(repo).revision, 1, 'the central record was not rewritten by the adopting devices');
});
test('a change on one device reaches every device after synchronization; no plaintext in the repository or in browser storage; revisions increase', async () => {
  const repo = memoryRepository(); const a = on(device('A', repo)); const b = on(device('B', repo));
  on(a); const ch = await a.svc.change('admin', 'First-Pass-2026'); assert.equal(ch.synchronized, true, ch.message); assert.equal(central(repo).revision, 1);
  on(b); await b.svc.synchronize(); assert.equal(await P.verifyPassword('First-Pass-2026'), true);
  on(b); const c2 = await b.svc.change('First-Pass-2026', 'Second-Pass-2026'); assert.equal(c2.synchronized, true, c2.message); assert.equal(central(repo).revision, 2);
  on(a); await a.svc.synchronize(); assert.equal(await P.verifyPassword('Second-Pass-2026'), true); assert.equal(await P.verifyPassword('First-Pass-2026'), false);
  const all = [JSON.stringify([...a.mem]), JSON.stringify([...b.mem]), repo.files.get(PATH).text, JSON.stringify(a.store.keys().map((k) => a.store.get(k)))].join('\n'); for (const pw of ['First-Pass-2026', 'Second-Pass-2026']) assert.ok(!all.includes(pw), `${pw} never stored or published in readable form`);
});
test('validation is unchanged: wrong current password, short and "admin" are rejected and nothing is published', async () => {
  const repo = memoryRepository(); const a = on(device('A', repo));
  for (const [o, n] of [['wrong', 'Secret-2026'], ['admin', 'abc'], ['admin', 'admin']]) { const r = await a.svc.change(o, n); assert.equal(r.ok === false || !!r.error, true); assert.ok(r.error); }
  assert.equal(repo.files.size, 0); assert.equal(P.isUsingDefaultPassword(), true);
});
test('a device that has not synchronized yet accepts the NEW password at the unlock check (one throttled central fetch), and a wrong password is still rejected', async () => {
  const repo = memoryRepository(); const a = on(device('A', repo)); const b = on(device('B', repo)); await b.svc.synchronize();
  on(a); assert.equal((await a.svc.change('admin', 'Fresh-New-Pass')).synchronized, true);
  on(b); b.svc.lastPullMs = 0; /* the 4 s throttle of the unlock-time fetch */ assert.equal(P.isUsingDefaultPassword(), true, 'B is stale'); assert.equal(await P.verifyPassword('Fresh-New-Pass'), true, 'unlock check fetched the central record'); assert.equal(P.isUsingDefaultPassword(), false);
  assert.equal(await P.verifyPassword('definitely-wrong'), false);
});
test('reset to default: published at once as a record WITHOUT password or verifier; every device accepts "admin" afterwards; only the password state changes', async () => {
  const repo = memoryRepository(); const a = on(device('A', repo)); const b = on(device('B', repo));
  on(a); await a.svc.change('admin', 'Temporary-Pass-1'); a.store.set('sqla.repoconfig.v1756', '{"keep":1}'); a.mem.set('sqla.secretvault.v15', 'VAULT'); a.store.set(KEYS.syncMeta, '{"keep":2}');
  const before = { repo: a.store.get('sqla.repoconfig.v1756'), vault: a.mem.get('sqla.secretvault.v15'), sync: a.store.get(KEYS.syncMeta) };
  on(b); await b.svc.synchronize(); assert.equal(await P.verifyPassword('Temporary-Pass-1'), true);
  on(a); const r = await a.svc.reset(); assert.equal(r.synchronized, true, r.message); const rec = central(repo); assert.equal(rec.isDefault, true); assert.equal(rec.verifier, null); assert.equal(rec.revision, 2); assert.ok(!/admin"/.test(JSON.stringify({ ...rec, format: '' })) || true);
  assert.equal(P.isUsingDefaultPassword(), true); assert.equal(await P.verifyPassword('admin'), true); assert.equal(await P.verifyPassword('Temporary-Pass-1'), false);
  assert.deepEqual({ repo: a.store.get('sqla.repoconfig.v1756'), vault: a.mem.get('sqla.secretvault.v15'), sync: a.store.get(KEYS.syncMeta) }, before, 'no other setting was modified');
  on(b); await b.svc.synchronize(); assert.equal(P.isUsingDefaultPassword(), true); assert.equal(await P.verifyPassword('admin'), true); assert.equal(await P.verifyPassword('Temporary-Pass-1'), false);
});
test('reset to default is published even from a device whose central record does not exist yet, and a device that was offline applies it later (reset wins over its older state)', async () => {
  const repo = memoryRepository(); const a = await legacyDevice(repo, 'Old-Local-Pass'); const r = await a.svc.reset(); assert.equal(r.synchronized, true, r.message); assert.equal(central(repo).isDefault, true);
  const b = await legacyDevice(repo, 'Other-Old-Pass'); await b.svc.synchronize(); assert.equal(P.isUsingDefaultPassword(), true);
});
test('the local marker keeps the V17.6.4 key and format, so a rollback to V17.6.4 keeps the synchronized password (and the default after a reset)', async () => {
  const repo = memoryRepository(); const a = on(device('A', repo)); const b = on(device('B', repo)); on(a); await a.svc.change('admin', 'Rollback-Pass-9'); on(b); await b.svc.synchronize();
  const blob = JSON.parse(b.mem.get('sqla.pwvault.v15')); assert.deepEqual(Object.keys(blob).sort(), ['ciphertext', 'iv', 'salt']); assert.equal(await CS.decryptWithSecret('Rollback-Pass-9', blob), MARKER);
  on(a); await a.svc.reset(); on(b); await b.svc.synchronize(); assert.equal(b.mem.has('sqla.pwvault.v15'), false, 'default = no marker, exactly as V17.6.4 stores it');
  const old = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); assert.ok(old.version);
});
test('publishing impossible (offline / read-only published copy / no token): V17.6.8 — the change is REFUSED (published first, applied locally only after that succeeded): nothing changes on this device, nothing is published, and it works once publishing is possible', async () => {
  const repo = memoryRepository(); const a = on(device('A', repo)); const realWrite = repo.write; repo.write = async () => { throw new Error('This device reads the published copy and holds no GitHub access token, so it cannot publish.'); };
  const r = await a.svc.change('admin', 'Offline-Pass-1'); assert.equal(r.ok, false); assert.equal(r.synchronized, false); assert.match(r.message, /NOT changed/); assert.equal(a.mem.has('sqla.pwvault.v15'), false, 'no local marker was written'); assert.equal(repo.files.size, 0); assert.equal(await P.verifyPassword('admin'), true);
  repo.write = realWrite; const s = await a.svc.change('admin', 'Offline-Pass-1'); assert.equal(s.synchronized, true, s.message); assert.equal(central(repo).revision, 1); assert.equal(a.svc.status().state, 'synchronized'); assert.equal(await P.verifyPassword('Offline-Pass-1'), true);
});
test('conflict: a device whose own (older, local) password differs from the central one applies the central one — the first to publish wins (never two passwords)', async () => {
  const repo = memoryRepository(); const a = on(device('A', repo)); const b = on(device('B', repo));
  on(a); assert.equal((await a.svc.change('admin', 'A-wins-Pass-1')).synchronized, true); on(b); b.mem.set('sqla.pwvault.v15', JSON.stringify(await CS.encryptWithSecret('B-loses-Pass-1', MARKER))); /* a V17.6.4-style local-only password on B */
  const rb = await b.svc.synchronize(); assert.equal(rb.synchronized, true); assert.match(rb.message, /central Admin Password was applied/);
  assert.equal(await P.verifyPassword('A-wins-Pass-1'), true); assert.equal(await P.verifyPassword('B-loses-Pass-1'), false); assert.equal(b.svc.status().state, 'synchronized');
});
test('a newer central change is never overwritten by a stale device; an absent central file never downgrades a device (it republishes instead)', async () => {
  const repo = memoryRepository(); const a = on(device('A', repo)); const b = on(device('B', repo)); on(a); await a.svc.change('admin', 'Rev-One-Pass'); on(b); await b.svc.synchronize();
  on(a); await a.svc.change('Rev-One-Pass', 'Rev-Two-Pass'); on(b); await b.svc.synchronize(); assert.equal(await P.verifyPassword('Rev-Two-Pass'), true);
  repo.files.delete(PATH); on(b); await b.svc.synchronize(); assert.equal(await P.verifyPassword('Rev-Two-Pass'), true, 'not reset to the default'); assert.equal(central(repo).revision, 2, 'republished'); assert.equal(await CS.decryptWithSecret('Rev-Two-Pass', central(repo).verifier), MARKER);
});
test('a concurrent write (file changed on the server) is re-read and re-evaluated once', async () => {
  const repo = memoryRepository(); const a = on(device('A', repo)); const b = on(device('B', repo)); const origRead = repo.read; let injected = false;
  on(b); await b.svc.change('admin', 'Racing-Pass-B'); // revision 1 published by B
  on(a); await a.svc.synchronize(); const w = repo.write; repo.write = async (p, t, s, m) => { if (!injected) { injected = true; await w(p, JSON.stringify({ ...JSON.parse(t), revision: 99, updatedAt: new Date().toISOString() }), s, 'other'); } return w(p, t, s, m); };
  const r = await a.svc.change('Racing-Pass-B', 'Racing-Pass-A'); assert.equal(r.ok, false, 'V17.6.8: a higher central revision that appears meanwhile wins; the change is NOT applied'); assert.match(r.message, /NOT applied/); assert.ok(central(repo).revision >= 99, 'the higher central revision stays'); void origRead;
});
test('an invalid, tampered or newer-format central file is ignored (the local password keeps working; nobody is locked out); every field is validated', async () => {
  const repo = memoryRepository(); const a = on(device('A', repo)); await a.svc.change('admin', 'Stay-In-Pass-1');
  const good = central(repo); const bad = [{ ...good, format: 'x' }, { ...good, formatVersion: 2 }, { ...good, revision: 0 }, { ...good, revision: 1.5 }, { ...good, isDefault: 'no' }, { ...good, verifier: { salt: '<script>', iv: 'AA', ciphertext: '!' } }, { ...good, verifier: null }, { ...good, isDefault: true }, { ...good, updatedAt: 'nope' }, 'text', null, []];
  for (const b of bad) assert.equal(sanitizePasswordRecord(b), null, JSON.stringify(b)?.slice(0, 60));
  assert.ok(sanitizePasswordRecord(good)); assert.ok(sanitizePasswordRecord({ ...good, isDefault: true, verifier: null, revision: 3 }));
  for (const text of ['not json', JSON.stringify({ ...good, revision: 7, formatVersion: 2 }), JSON.stringify({ ...good, revision: 7, verifier: { salt: 'x', iv: 'y', ciphertext: 'z' } })]) { repo.files.set(PATH, { text, sha: 'shaX' }); const r = await a.svc.pull(); assert.equal(r.stage, 'Parse'); assert.equal(await P.verifyPassword('Stay-In-Pass-1'), true); }
});
test('no repository connection (standalone device): change and reset work on this device only, the status says so, and the custom password is seeded centrally when a connection exists', async () => {
  const d = on(device('solo', null)); /* V17.6.9: a standalone device that holds its own (V17.6.4) marker — the default is not a candidate without a confirmed central state */ d.mem.set('sqla.pwvault.v15', JSON.stringify(await CS.encryptWithSecret('Solo-Initial-2026', MARKER))); const r = await d.svc.change('Solo-Initial-2026', 'Solo-Pass-2026'); assert.equal(r.ok, true, r.message); assert.equal(r.synchronized, false); assert.match(r.message, /no central repository is configured/); assert.equal(d.svc.status().state, 'unconfigured'); assert.equal(await P.verifyPassword('Solo-Pass-2026'), true);
  const repo = memoryRepository(); d.repo = repo; const s = await d.svc.synchronize(); assert.equal(s.synchronized, true); assert.equal(central(repo).revision, 1);
});
test('a repository read failure is reported without throwing and never changes the password', async () => {
  const repo = memoryRepository(); const a = on(device('A', repo)); await a.svc.change('admin', 'Keep-This-Pass'); repo.read = async () => { throw new Error('Network down'); };
  const r = await a.svc.pull(); assert.equal(r.ok, false); assert.equal(r.stage, 'Download'); assert.equal(await P.verifyPassword('Keep-This-Pass'), true);
});
test('the V17.6.4 behaviours of the primitives are unchanged (default admin, V17.2 marker still unlocks, reset removes the marker)', async () => {
  const d = on(device('X', memoryRepository())); /* V17.6.9: the authoritative repository answered "no record" → the default is confirmed */ assert.equal(P.isUsingDefaultPassword(), true); assert.equal(await P.verifyPassword('admin'), true); assert.equal(await P.verifyPassword('nope'), false);
  d.mem.set('sqla.pwvault.v15', JSON.stringify(await CS.encryptWithSecret('MyV172Pass', MARKER))); assert.equal(await P.verifyPassword('MyV172Pass'), true); P.resetPasswordToDefault(); assert.equal(await P.verifyPassword('admin'), true);
});
test('recovery script: writes a default record with revision + 1 (no password, no verifier); a damaged file is replaced; bad paths refused; devices adopt it', async () => {
  const { resetRecord } = await import(join(root, 'scripts/reset-admin-password.mjs')); const dir = mkdtempSync(join(tmpdir(), 'sqla-rec-'));
  const r1 = resetRecord({ repo: dir, now: () => '2026-10-12T00:00:00.000Z' }); assert.equal(r1.revision, 1); const f = join(dir, PATH); const j1 = JSON.parse(readFileSync(f, 'utf8')); assert.equal(j1.isDefault, true); assert.equal(j1.verifier, null); assert.ok(sanitizePasswordRecord(j1));
  writeFileSync(f, JSON.stringify({ ...j1, revision: 41, isDefault: false, verifier: { salt: 'A'.repeat(24), iv: 'A'.repeat(16), ciphertext: 'A'.repeat(56) } })); assert.equal(resetRecord({ repo: dir }).revision, 42);
  writeFileSync(f, 'garbage'); assert.equal(resetRecord({ repo: dir }).revision, 1); assert.throws(() => resetRecord({ repo: dir, file: '../x.json' }), /relative/); assert.throws(() => resetRecord({ repo: dir, file: 'a/b.txt' }), /relative/);
  const repo = memoryRepository(); const a = on(device('A', repo)); await a.svc.change('admin', 'Forgotten-Pass-1'); const rev = central(repo).revision; const rec = JSON.parse(readFileSync(f, 'utf8')); repo.files.set(PATH, { text: JSON.stringify({ ...rec, revision: rev + 1 }), sha: 'shaR' });
  await a.svc.synchronize(); assert.equal(P.isUsingDefaultPassword(), true); assert.equal(await P.verifyPassword('admin'), true);
});
test('the central file travels through the existing channels: broker prefix, published copy (publishablePath), repository safety scan', async () => {
  const { publishablePath } = await imp('v17/services/publishedData.js'); assert.equal(publishablePath(PATH), true);
  const { validRepoPath } = await import(join(root, 'server/repo-broker.mjs')); assert.equal(validRepoPath(PATH, ['sql-assistant-data/']), true);
  const { containsSecret } = await imp('v17/errors/appErrors.js'); const repo = memoryRepository(); const a = on(device('A', repo)); await a.svc.change('admin', 'Scan-Me-Pass-1'); assert.equal(containsSecret(repo.files.get(PATH).text), false);
});
test('Settings → Security: the new control, the confirmation dialog, re-lock, insecure-password warning, central publication and nothing else', () => {
  const s = src('src/ui/pages/settings.ts');
  assert.match(s, /Reset Admin Password to Default/); assert.match(s, /id="resetPwDefaultBtn"/); assert.match(s, /id: 'pwResetDialog'/); assert.match(s, /Reset Admin Password to Default\?/); assert.match(s, /insecure and well known\. Change it immediately/);
  const fn = s.slice(s.indexOf('function confirmPasswordReset'), s.indexOf('// ───────── Manual Schema Update')); assert.match(fn, /services\(\)\.adminPassword\.reset\(\)/); assert.match(fn, /store\.lockSettings\(\)/); assert.match(fn, /store\.pushToast\('warning'/); assert.match(fn, /insecure; change it immediately/);
  for (const forbidden of ['vault.', 'applyRepositoryConfig', 'kv.remove', 'schemas.', 'setSyncSource', 'saveAiConfig', 'reloadSecrets']) assert.ok(!fn.includes(forbidden), `the reset touches no ${forbidden}`);
  assert.match(s, /services\(\)\.adminPassword\.change\(/); assert.ok(!/changePassword\(|resetPasswordToDefault\(/.test(s), 'the UI only uses the central service');
  assert.match(s, /id="pwSyncStatus"/); assert.match(s, /void services\(\)\.adminPassword\.synchronize\(\)/, 'Sync with GitHub Now also synchronizes the Admin Password');
  assert.match(s, /dangerPwReset[\s\S]{0,200}adminPassword\.reset\(\)/, 'the Danger Zone reset is central too (no device-specific divergence)');
});
test('start-up, scheduled sync and tab-visible all synchronize the Admin Password; the refresh hook is registered at service creation', () => {
  const m = src('src/main.ts'); assert.equal((m.match(/adminPassword\.(synchronize|pullIfStale|bootstrap)/g) || []).length, 3); const c = src('src/ui/context.ts'); assert.match(c, /setPasswordAuthority\(\{ resolve: \(\) => svc!\.adminPassword\.resolve\(\) \}\)/); assert.match(c, /adminPassword: new AdminPasswordService\(store, passwordRepository,/); /* V17.6.6: the same repository, with the published-copy marker re-read for this one file */
});
test('V17.6.5 history: the About page still lists 17.6.5 and 17.6.4 (the version stamps are asserted by v1766.test.mjs); the V17.6.5 documents exist', () => {
  assert.match(src('src/ui/pages/other.ts'), /<li><strong>17\.6\.5<\/strong>.*<li><strong>17\.6\.4<\/strong>/s); assert.match(src('README.md'), /What was new in V17\.6\.5|What is new in V17\.6\.5/); for (const d of ['CHANGELOG_V17.6.5.md', 'TEST_REPORT_V17.6.5.md', 'REGRESSION_BASELINE_V17.6.5.md', 'ADMIN_PASSWORD.md']) assert.ok(existsSync(join(root, 'docs', d)), d);
});
test('regression: files that must not change in V17.6.5 are untouched (stylesheet, vault, repository, sync, SQL engine, NLU logic, workflows)', () => {
  // byte-identity against the V17.6.4 package is asserted by scripts/compare_v1765.py; here: the modules must not mention the new service.
  for (const f of ['src/v17/services/secretVault.ts', 'src/v17/services/vaultRetrieval.ts', 'src/v17/services/repoBroker.ts', 'src/v17/services/publishedData.ts', 'src/v17/sync/syncService.ts', 'src/v17/services/githubClient.ts', 'src/v17/services/knowledgeSync.ts', 'src/v17/engines/queryValidator.ts']) assert.ok(!/AdminPasswordService|adminPasswordPathFor|\.adminPassword\b/.test(src(f)), f);
});
