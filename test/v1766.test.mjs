// V17.6.6 — single-defect fix: a NEW device must retrieve and use the centralized Admin Password (and must not accept the default "admin" while a valid central password exists).
// Several "devices" run in one process; each has its own browser storage. All passwords below are synthetic test values, not real credentials.
import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync, existsSync } from 'node:fs'; import { join, dirname } from 'node:path'; import { imp } from './helpers.mjs';
const root = join(dirname(new URL(import.meta.url).pathname), '..'); const src = (p) => readFileSync(join(root, p), 'utf8');
const P = await imp('services/passwordService.js'); const CS = await imp('services/cryptoService.js'); const { AdminPasswordService, adminPasswordPathFor } = await imp('v17/services/adminPassword.js');
const { memoryRepository } = await imp('v17/services/githubClient.js'); const { memoryStore } = await imp('services/storage.js');
const PATH = 'sql-assistant-data/security/admin-password.json'; const MARKER = 'sqla-verified-marker-v15'; const KEY = 'sqla.pwvault.v15'; const META = 'sqla.adminpwmeta.v1765';
const PW1 = 'SYNTHETIC-central-value-001'; const PW2 = 'SYNTHETIC-central-value-002'; const OTHER = 'SYNTHETIC-local-value-777';
const ls = (m) => ({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: () => null, length: 0 });
function device(name, repo) { const mem = new Map(); const store = memoryStore(); const d = { name, mem, store, repo, svc: null }; d.svc = new AdminPasswordService(store, () => d.repo, () => adminPasswordPathFor('sql-assistant-data/schemas/registry.json')); return d; }
const on = (d) => { globalThis.localStorage = ls(d.mem); P.setPasswordAuthority(d.svc); return d; };
const central = (repo) => JSON.parse(repo.files.get(PATH).text); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slow = (repo, ms) => ({ describe: repo.describe, files: repo.files, read: async (p) => { await sleep(ms); return repo.read(p); }, write: (...a) => repo.write(...a) });
/** Device A saves a non-default central Admin Password (revision 1) through the real service. */
async function seeded(pw = PW1) { const repo = memoryRepository(); const a = on(device('A', repo)); const r = await a.svc.change('admin', pw); assert.equal(r.synchronized, true, r.message); return { repo, a }; }
const snapshot = (repo) => JSON.stringify([...repo.files.entries()]);

test('1. a centralized non-default Admin Password is saved (revision 1, encrypted verifier only, no plaintext)', async () => {
  const { repo } = await seeded(); const rec = central(repo); assert.equal(rec.revision, 1); assert.equal(rec.isDefault, false); assert.equal(await CS.decryptWithSecret(PW1, rec.verifier), MARKER); assert.ok(!repo.files.get(PATH).text.includes(PW1));
});
test('2./3./4./5. a clean device has no marker; at its first unlock the default is rejected and the central password unlocks — the central record is not overwritten', async () => {
  const { repo } = await seeded(); const before = snapshot(repo); const d = on(device('NEW', repo));
  assert.equal(d.mem.has(KEY), false, 'clean device: no local marker'); assert.equal(d.store.get(META), null); assert.equal(P.isUsingDefaultPassword(), true);
  assert.equal(await P.verifyPassword('admin'), false, 'the default is rejected although this device never synchronized'); assert.equal(await P.verifyPassword(PW1), true, 'the saved central password unlocks');
  assert.equal(P.isUsingDefaultPassword(), false); assert.ok(d.mem.has(KEY), 'the central verifier was applied locally'); assert.equal(snapshot(repo), before, 'the central record was not touched (no write, same sha)');
});
test('start-up race: the unlock check waits for the start-up synchronization that is still running instead of accepting the default', async () => {
  const { repo } = await seeded(); const d = on(device('NEW', repo)); d.repo = slow(repo, 250); const startup = d.svc.synchronize(); // start-up synchronization in flight
  assert.equal(await P.verifyPassword('admin'), false, 'admin is rejected even though the start-up synchronization had not finished'); const r = await startup; assert.equal(r.synchronized, true); assert.equal(await P.verifyPassword(PW1), true);
});
test('the first unlock check with NO prior synchronization at all (no start-up call) asks the central record before deciding', async () => {
  const { repo } = await seeded(); const d = on(device('NEW', repo)); assert.equal(await P.verifyPassword(PW1), true); assert.equal(await P.verifyPassword('admin'), false);
});
test('the old defect, stated: V17.6.5 accepted "admin" here — V17.6.8: the gate is the authority (verifyPassword asks the authority first and obeys defaultAllowed; the service waits for a running synchronization)', () => {
  const p = src('src/services/passwordService.ts'); assert.match(p, /r = authority \? await authority\.resolve\(\) : FAIL_CLOSED/); assert.match(p, /else if \(r\.defaultAllowed && r\.state === 'confirmed-default'\) \{ ok = await verifyDefault\(candidate\)/); const a = src('src/v17/services/adminPassword.ts'); assert.match(a, /while \(this\.busy\) \{ try \{ await this\.busy; \}/);
});
test('6./7. manual synchronization (the Sync with GitHub Now call) refreshes the Admin Password record on a new device', async () => {
  const { repo } = await seeded(); const d = on(device('NEW', repo)); const r = await d.svc.synchronize(); assert.equal(r.synchronized, true); assert.equal(r.changed, true); assert.ok(d.mem.has(KEY)); assert.equal(d.svc.status().state, 'synchronized');
  assert.equal(await P.verifyPassword('admin'), false); assert.equal(await P.verifyPassword(PW1), true);
  assert.match(src('src/ui/pages/settings.ts'), /void services\(\)\.adminPassword\.synchronize\(\)\.catch\(\(\) => undefined\); const r = await sync\.synchronize\(\)/);
});
test('8. a password changed on one device becomes valid on another after synchronization (and at its unlock check); the previous one stops working', async () => {
  const { repo, a } = await seeded(); const b = on(device('B', repo)); await b.svc.synchronize(); assert.equal(await P.verifyPassword(PW1), true);
  on(a); assert.equal((await a.svc.change(PW1, PW2)).synchronized, true); on(b); b.svc.lastPullMs = 0; assert.equal(await P.verifyPassword(PW2), true); assert.equal(await P.verifyPassword(PW1), false); assert.equal(central(repo).revision, 2);
});
test('a central reset (isDefault) is applied by a new device: then — and only then — "admin" is valid', async () => {
  const { repo, a } = await seeded(); on(a); assert.equal((await a.svc.reset()).synchronized, true); const d = on(device('NEW', repo)); assert.equal(await P.verifyPassword('admin'), true); assert.equal(await P.verifyPassword(PW1), false);
});
test('9. invalid, tampered or unreadable central data: nothing is overwritten, no claim that the default is synchronized, the central file is not touched — V17.6.8: the DEFAULT is not accepted (state "error"), a valid local marker keeps working', async () => {
  for (const text of ['not json', '{"format":"sqla-admin-password","formatVersion":1,"revision":1,"isDefault":false,"verifier":{"salt":"x","iv":"y","ciphertext":"z"},"updatedAt":"2026-01-01T00:00:00.000Z"}', '{"format":"sqla-admin-password","formatVersion":9}']) {
    const repo = memoryRepository({ [PATH]: text }); const before = snapshot(repo);
    const d = on(device('NEW', repo)); const r = await d.svc.synchronize(); assert.equal(r.synchronized, false); assert.equal(r.stage, 'Parse'); assert.notEqual(d.svc.status().state, 'synchronized'); assert.match(d.svc.status().text, /could not be read/);
    assert.equal(await P.verifyPassword('admin'), false, 'an invalid central record never enables the default'); assert.equal(d.svc.bootstrapState(), 'error'); assert.equal(d.mem.has(KEY), false, 'no local data created or removed'); assert.equal(d.store.get(META), null); assert.equal(snapshot(repo), before, 'the central file is untouched');
    const e = on(device('EXISTING', repo)); e.mem.set(KEY, JSON.stringify(await CS.encryptWithSecret(OTHER, MARKER))); const keep = e.mem.get(KEY); await e.svc.synchronize(); assert.equal(e.mem.get(KEY), keep, 'a valid local marker is not overwritten by unreadable central data'); assert.equal(await P.verifyPassword(OTHER), true); assert.equal(await P.verifyPassword('admin'), false); assert.equal(snapshot(repo), before);
  }
});
test('a failing repository read: V17.6.8 — the DEFAULT is not accepted on a managed device whose central record cannot be read (state "default-unverified"); the retry through the existing synchronization applies the central password; nothing is claimed in between', async () => {
  const { repo } = await seeded(); const d = on(device('NEW', repo)); const ok = repo.read; d.repo = { describe: 'x', files: repo.files, read: async () => { throw new Error('Network down'); }, write: repo.write };
  assert.equal(await P.verifyPassword('admin'), false, 'central unavailable: the default is not accepted'); assert.equal(d.svc.bootstrapState(), 'error'); assert.match(P.authBlockedMessage() || '', /could not be read/); assert.equal(d.svc.status().state, 'unsynchronized'); assert.match(d.svc.status().text, /Network down/); assert.ok(!d.mem.has(KEY));
  d.repo = { ...d.repo, read: ok }; const r = await d.svc.synchronize(); assert.equal(r.synchronized, true); assert.equal(await P.verifyPassword('admin'), false); assert.equal(await P.verifyPassword(PW1), true);
});
test('"no central record yet" is not reported as synchronized, and nothing is published by a new device (the default is never written over anything)', async () => {
  const repo = memoryRepository(); const d = on(device('NEW', repo)); const r = await d.svc.synchronize(); assert.equal(r.ok, true); assert.equal(r.synchronized, false); assert.match(r.message, /uses the default password; nothing is synchronized/); assert.equal(repo.files.size, 0); assert.notEqual(d.svc.status().state, 'synchronized');
  assert.equal(await P.verifyPassword('admin'), true);
});
test('precedence: central record > valid compatible local record > default (only when neither exists)', async () => {
  const { repo } = await seeded(); const local = on(device('LOCAL', repo)); local.mem.set(KEY, JSON.stringify(await CS.encryptWithSecret(OTHER, MARKER))); // a valid compatible local record (as an older install left it)
  await local.svc.synchronize(); assert.equal(await P.verifyPassword(PW1), true, 'central beats the local record'); assert.equal(await P.verifyPassword(OTHER), false);
  const none = on(device('NONE', memoryRepository())); assert.equal(await P.verifyPassword('admin'), true, 'default only when no central and no local record exist');
  const localOnly = on(device('LOCALONLY', memoryRepository())); assert.equal((await P.changePassword('admin', OTHER)).ok, true); await localOnly.svc.synchronize(); assert.equal(await P.verifyPassword(OTHER), true); assert.equal(await P.verifyPassword('admin'), false, 'a local record beats the default');
});
test('10. existing V17.6.5 installations stay compatible: a device that synchronized before keeps its marker/meta, unlocks with its password and keeps converging', async () => {
  const { repo, a } = await seeded(); const b = on(device('V1765', repo)); await b.svc.synchronize(); const marker = b.mem.get(KEY); const meta = b.store.get(META); assert.equal(JSON.parse(meta).revision, 1);
  const b2 = on(device('V1765-restart', repo)); b2.mem.set(KEY, marker); b2.store.set(META, meta); // same storage after the upgrade, new process
  assert.equal(await P.verifyPassword(PW1), true); assert.equal(await P.verifyPassword('admin'), false); assert.equal((await b2.svc.synchronize()).ok, true); assert.equal(b2.mem.get(KEY), marker, 'marker unchanged when nothing changed');
  on(a); await a.svc.change(PW1, PW2); on(b2); await b2.svc.synchronize(); assert.equal(await P.verifyPassword(PW2), true);
});
test('a V17.6.4-style device (custom marker, no meta) keeps working and seeds the centre when there is none; with a central record it adopts it', async () => {
  const repo = memoryRepository(); const l = on(device('LEGACY', repo)); assert.equal((await P.changePassword('admin', OTHER)).ok, true); assert.equal((await l.svc.synchronize()).synchronized, true); assert.equal(central(repo).revision, 1); assert.equal(await P.verifyPassword(OTHER), true);
  const n = on(device('NEW', repo)); assert.equal(await P.verifyPassword('admin'), false); assert.equal(await P.verifyPassword(OTHER), true);
});
test('the marker format, key and PBKDF2 / AES-GCM behaviour are unchanged (V17.6.5 blob opens with the same primitive; no plaintext in any store)', async () => {
  const { repo } = await seeded(); const d = on(device('NEW', repo)); await d.svc.synchronize(); const blob = JSON.parse(d.mem.get(KEY)); assert.deepEqual(Object.keys(blob).sort(), ['ciphertext', 'iv', 'salt']); assert.equal(await CS.decryptWithSecret(PW1, blob), MARKER);
  const all = [...d.mem.values(), ...d.store.keys().map((k) => d.store.get(k)), repo.files.get(PATH).text].join('\n'); for (const pw of [PW1, PW2, OTHER]) assert.ok(!all.includes(pw), 'no plaintext password anywhere');
  assert.match(src('src/services/cryptoService.ts'), /PBKDF2_ITERATIONS = 150000/); assert.match(src('src/services/cryptoService.ts'), /hash: 'SHA-256'/); assert.match(src('src/services/cryptoService.ts'), /name: 'AES-GCM'/);
});
test('a repository connection that appears AFTER start-up (sign-in, token / vault restore): the next unlock check asks the central record — no extra repository request is made by those operations', async () => {
  const { repo } = await seeded(); const d = on(device('NEW', null)); assert.equal(await P.verifyPassword('admin'), false, 'no connection yet → V17.6.9: nothing proves that no Admin Password exists, the default is not accepted'); assert.equal(d.mem.has(KEY), false);
  d.repo = repo; assert.equal(await P.verifyPassword('admin'), false, 'connection available → the central record is asked first, the default is rejected'); assert.ok(d.mem.has(KEY)); assert.equal(await P.verifyPassword(PW1), true);
  for (const f of ['src/ui/pages/schemaPull.ts', 'src/ui/pages/schemaRepoCards.ts', 'src/ui/repoAccess.ts']) assert.ok(!/adminPassword/.test(src(f)), `${f}: Pull Schema / vault / sign-in make no Admin Password request (their own contracts count every request)`);
  const c = src('src/ui/context.ts'); assert.ok(!/kickAdminPassword|\.kick\(/.test(c));
});
test('published-copy devices: the Admin Password file is read through a repository that re-reads the publication marker (so a record published after the page was opened is seen by Sync with GitHub Now and the unlock check); the shared published state is not touched', () => {
  const c = src('src/ui/context.ts'); const f = c.slice(c.indexOf('function passwordRepository'), c.indexOf('export function initServices')); assert.match(f, /await fetchPublishedMarker\(\)/); assert.match(f, /publishedRepository\(st\.marker\)/); assert.ok(!/publishedState\s*=/.test(f), 'no write to the shared published state'); assert.match(c, /new AdminPasswordService\(store, passwordRepository,/);
});
test('start-up, scheduled synchronization, tab-visible and Sync with GitHub Now still synchronize the Admin Password (V17.6.5 wiring unchanged)', () => {
  const m = src('src/main.ts'); assert.equal((m.match(/adminPassword\.(synchronize|pullIfStale|bootstrap)/g) || []).length, 3); assert.match(src('src/ui/context.ts'), /setPasswordAuthority\(\{ resolve: \(\) => svc!\.adminPassword\.resolve\(\) \}\)/);
});
test('V17.6.6 history: the About page still lists 17.6.6, 17.6.5 and 17.6.4 (the version stamps are asserted by v1767.test.mjs); the V17.6.6 documents exist', () => {
  assert.match(src('src/ui/pages/other.ts'), /<li><strong>17\.6\.6<\/strong>.*<li><strong>17\.6\.5<\/strong>.*<li><strong>17\.6\.4<\/strong>/s); assert.match(src('README.md'), /What was new in V17\.6\.6|What is new in V17\.6\.6/); for (const d of ['CHANGELOG_V17.6.6.md', 'TEST_REPORT_V17.6.6.md', 'REGRESSION_BASELINE_V17.6.6.md']) assert.ok(existsSync(join(root, 'docs', d)), d);
});
test('single-defect release: the modules that must not change do not mention the fix; UI source of Security / lock screen is untouched', () => {
  for (const f of ['src/v17/services/secretVault.ts', 'src/v17/services/vaultRetrieval.ts', 'src/v17/services/repoBroker.ts', 'src/v17/services/publishedData.ts', 'src/v17/sync/syncService.ts', 'src/v17/services/githubClient.ts', 'src/v17/engines/nluEngine.ts', 'src/v17/engines/queryValidator.ts', 'src/ui/syncPrefs.ts', 'src/ui/pages/schemaPull.ts', 'src/ui/pages/schemaRepoCards.ts']) assert.ok(!/kick\(|kickAdminPassword|refreshForLogin/.test(src(f)), f);
});
test('13. generated-bundle secret scan: no credential-looking string and none of the synthetic test passwords in the production build', () => {
  const html = existsSync(join(root, 'dist/index.html')) ? src('dist/index.html') : ''; if (!html) return; assert.ok(!/\bghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(html));
  for (const pw of [PW1, PW2, OTHER, 'SYNTHETIC-']) assert.ok(!html.includes(pw), 'no test value in the bundle');
});
