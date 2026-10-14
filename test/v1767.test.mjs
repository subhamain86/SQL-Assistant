// V17.6.7 — single-defect fix: Settings authentication on a NEW device must use the centralized Admin Password and never the default "admin" while a central password exists —
// including a Settings session that was opened with the default BEFORE the central record was reachable. Several "devices" run in one process; each has its own browser storage.
// Test passwords are synthetic example values, not credentials.
import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync, existsSync } from 'node:fs'; import { join, dirname } from 'node:path'; import { imp } from './helpers.mjs';
const root = join(dirname(new URL(import.meta.url).pathname), '..'); const src = (p) => readFileSync(join(root, p), 'utf8');
const P = await imp('services/passwordService.js'); const CS = await imp('services/cryptoService.js'); const { AdminPasswordService, adminPasswordPathFor } = await imp('v17/services/adminPassword.js');
const { memoryRepository } = await imp('v17/services/githubClient.js'); const { memoryStore } = await imp('services/storage.js');
const PATH = 'sql-assistant-data/security/admin-password.json'; const MARKER = 'sqla-verified-marker-v15'; const KEY = 'sqla.pwvault.v15'; const META = 'sqla.adminpwmeta.v1765';
const CENTRAL = 'MyCentralPassword'; const CENTRAL2 = 'MyCentralPassword-v2'; const OWN = 'SYNTHETIC-local-value-777';
const ls = (m) => ({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: () => null, length: 0 });
/** One browser-storage per device, exactly like the application (browserStore() and the marker both live in localStorage): the service's store writes through to the same map. */
const backed = (mem) => ({ get: (k) => (mem.has(k) ? mem.get(k) : null), set: (k, v) => { mem.set(k, String(v)); return true; }, remove: (k) => { mem.delete(k); }, keys: () => [...mem.keys()] });
function device(name, repo, opts = {}) { const mem = new Map(); const store = backed(mem); const d = { name, mem, store, repo, svc: null, adopted: [] }; d.svc = new AdminPasswordService(store, () => d.repo, () => adminPasswordPathFor('sql-assistant-data/schemas/registry.json'), () => [], { refreshMs: 0, ...opts }); d.svc.onAdopt((e) => d.adopted.push(e)); return d; }
const on = (d) => { globalThis.localStorage = ls(d.mem); P.setPasswordAuthority(d.svc); P.clearSessionBasis(); return d; };
const central = (repo) => JSON.parse(repo.files.get(PATH).text); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slow = (repo, ms) => ({ describe: repo.describe, files: repo.files, read: async (p) => { await sleep(ms); return repo.read(p); }, write: (...a) => repo.write(...a) });
/** Device A: Settings → Security → change "admin" to the central password (the real service), repository write available. */
async function deviceA(pw = CENTRAL) { const repo = memoryRepository(); const a = on(device('A', repo)); const r = await a.svc.change('admin', pw); assert.equal(r.synchronized, true, r.message); return { repo, a }; }
const mark = () => P.authTraceLog().length ? P.authTraceLog()[P.authTraceLog().length - 1].n : 0; const since = (n) => P.authTraceLog().filter((x) => x.n > n).map((x) => x.e);
const snap = (repo) => JSON.stringify([...repo.files.entries()]);

// ───────────────────────── Diagnostics (the seven points of the request)
test('D1/D2/D5/D6 new-device initialization: the central record is downloaded, the encrypted verifier is loaded and imported (marker + meta), and it is exactly the verifier the login check then uses', async () => {
  const { repo } = await deviceA(); const n0 = mark(); const d = on(device('B', repo)); assert.equal(d.mem.has(KEY), false, 'clean device'); const r = await d.svc.synchronize();
  const ev = since(n0); assert.ok(ev.includes('central:downloaded'), 'D1 downloaded'); assert.ok(ev.some((e) => /^central:loaded rev=1 default=false changed=true/.test(e)), 'D2 loaded');
  assert.equal(r.synchronized, true); assert.deepEqual(JSON.parse(d.mem.get(KEY)), central(repo).verifier, 'D5/D6: the marker the login check reads IS the central verifier'); assert.equal(JSON.parse(d.store.get(META)).revision, 1, 'D5 meta imported');
  assert.equal(d.svc.diagnostics().centralKnown, true); assert.equal(await CS.decryptWithSecret(CENTRAL, JSON.parse(d.mem.get(KEY))), MARKER);
});
test('D3/D4 authentication uses the centralized password and the default is disabled: basis "central", "admin" rejected, no local fallback', async () => {
  const { repo } = await deviceA(); const d = on(device('B', repo)); const n0 = mark();
  assert.equal(await P.verifyPassword(CENTRAL), true); assert.equal(P.lastAuthBasis(), 'central', 'the first check on the new device is decided by the central verifier'); assert.equal(await P.verifyPassword('admin'), false); assert.equal(await P.verifyPassword(CENTRAL), true); assert.equal(P.lastAuthBasis(), 'central', 'later checks use the marker now on the device — which IS the central verifier (meta revision recorded)');
  const ev = since(n0); assert.ok(ev.includes('auth:rejected') && ev.includes('auth:accepted basis=central'), ev.join(' | ')); assert.ok(!ev.some((e) => /basis=default/.test(e)), 'the default basis never occurs'); assert.ok(d.mem.has(KEY)); assert.deepEqual(JSON.parse(d.mem.get(KEY)), central(repo).verifier);
});
test('D7 startup synchronization completes before password validation begins (record delayed; validation requested while the start-up synchronization is in flight)', async () => {
  const { repo } = await deviceA(); const d = on(device('B', repo)); d.repo = slow(repo, 300); const n0 = mark(); const startup = d.svc.synchronize(); const attempt = P.verifyPassword('admin'); // the user types before the start-up read returns
  assert.equal(await attempt, false); await startup; const ev = since(n0); const at = (re) => ev.findIndex((e) => re.test(e));
  assert.ok(at(/^sync:start/) >= 0 && at(/^central:downloaded/) > at(/^sync:start/) && at(/^central:loaded/) > at(/^central:downloaded/) && at(/^auth:rejected/) > at(/^central:loaded/), `order: ${ev.join(' | ')}`);
  assert.equal(await P.verifyPassword(CENTRAL), true);
});
test('5. startup synchronization loads the security settings before authentication — also when NO synchronization was started yet (the unlock check itself loads them first)', async () => {
  const { repo } = await deviceA(); const d = on(device('B', repo)); const n0 = mark(); assert.equal(await P.verifyPassword(CENTRAL), true); const ev = since(n0);
  assert.ok(ev.findIndex((e) => /^central:loaded/.test(e)) >= 0 && ev.findIndex((e) => /^central:loaded/.test(e)) < ev.findIndex((e) => /^auth:accepted/.test(e)), ev.join(' | ')); assert.ok(d.mem.has(KEY));
});

// ───────────────────────── The defect: a session opened with the default before the central record was reachable
test('ROOT CAUSE (V17.6.9 policy, replaces the V17.6.8 provisional default): a device with NO repository connection — standalone or managed-but-unreachable — does NOT accept the default (state "error"); there is no "default-unverified" any more', async () => {
  const { repo } = await deviceA(); const d = on(device('B', null)); assert.equal(await P.verifyPassword('admin', 'settings-unlock'), false, 'no connection: nothing proves that no Admin Password exists'); assert.equal(d.svc.bootstrapState(), 'error'); assert.equal(P.takeUnlockTicket(), null, 'no ticket without a successful check'); assert.equal(P.sessionAuthBasis(), null); void repo;
  const m = on(device('M', null, { standalone: () => false })); assert.equal(await P.verifyPassword('admin', 'settings-unlock'), false, 'managed (a central source exists) but not reachable: the default is NOT accepted'); assert.equal(m.svc.bootstrapState(), 'error'); assert.equal(P.takeUnlockTicket(), null, 'no ticket without a successful check');
  const st = src('src/ui/pages/settings.ts'); assert.doesNotMatch(st, /default-unverified/); assert.doesNotMatch(st, /accepted provisionally/);
});
test('FIX: when the connection appears and the central record is applied, the session opened on the default is INVALIDATED (the application re-locks Settings on exactly this event) — then "admin" is rejected and the central password unlocks', async () => {
  const { repo } = await deviceA(); const d = on(device('B', memoryRepository())); /* V17.6.9: the session opens on the CONFIRMED default (the authoritative repository answered "no record") */ assert.equal(await P.verifyPassword('admin', 'settings-unlock'), true); P.takeUnlockTicket(); assert.equal(P.sessionOnDefault(), true); const inv = []; const off = P.onAdminSessionInvalidated((r) => inv.push(r));
  d.repo = repo; const r = await d.svc.synchronize(); assert.equal(r.synchronized, true); assert.equal(d.adopted.length, 1); assert.deepEqual(d.adopted[0], { changed: true, isDefault: false }); assert.deepEqual(inv, ['central-verifier-changed']); assert.equal(P.sessionAuthBasis(), null, 'the session basis was cleared'); off();
  assert.equal(await P.verifyPassword('admin'), false); assert.equal(await P.verifyPassword(CENTRAL), true);
  const m = src('src/main.ts'); assert.match(m, /onAdminSessionInvalidated\(\(\) => \{ if \(!store\.settingsUnlocked\) return; authTrace\('session:relocked'\); store\.lockSettings\(\);/);
});
test('a central RESET record (isDefault) applied by a default session (confirmed by the authoritative repository) does not invalidate it, and the default stays "confirmed"', async () => {
  const { repo, a } = await deviceA(); on(a); assert.equal((await a.svc.reset()).synchronized, true); const d = on(device('B', memoryRepository())); assert.equal(await P.verifyPassword('admin', 'settings-unlock'), true); P.takeUnlockTicket(); const inv = []; const off = P.onAdminSessionInvalidated((r) => inv.push(r)); d.repo = repo; await d.svc.synchronize(); off();
  assert.deepEqual(d.adopted.map((e) => e.isDefault), [true]); assert.deepEqual(inv, []); assert.equal(P.sessionAuthBasis(), 'default-confirmed'); assert.equal(await P.verifyPassword('admin'), true);
});
test('"default-confirmed": the authoritative repository answered and no record exists anywhere — the default is legitimately in force; nothing is written; the session is not invalidated', async () => {
  const repo = memoryRepository(); const d = on(device('B', repo)); assert.equal(await P.verifyPassword('admin', 'settings-unlock'), true); assert.equal(P.lastAuthBasis(), 'default-confirmed'); assert.equal(P.takeUnlockTicket(), 'default-confirmed');
  assert.equal(snap(repo), '[]', 'nothing was written'); assert.equal(d.adopted.length, 0);
});
test('an unreadable / failing central read (managed device): the default is NOT accepted, nothing is overwritten or created, and a later successful read applies the central password', async () => {
  const { repo } = await deviceA(); const before = snap(repo); const d = on(device('B', repo)); const ok = repo.read; d.repo = { describe: 'x', files: repo.files, read: async () => { throw new Error('Network down'); }, write: repo.write };
  assert.equal(await P.verifyPassword('admin'), false); assert.equal(d.svc.bootstrapState(), 'error'); assert.match(d.svc.status().text, /Network down/); assert.equal(d.mem.has(KEY), false); assert.equal(snap(repo), before);
  d.repo = { ...d.repo, read: ok }; assert.equal(await P.verifyPassword('admin'), false); assert.equal(await P.verifyPassword(CENTRAL), true);
});
test('invalid central data (bad format / newer format / not a record) is never applied and never overwritten; the default is NOT enabled (state "error"); no session is invalidated', async () => {
  for (const text of ['not json', '[1,2,3]', '{"format":"sqla-admin-password","formatVersion":9}']) {
    const repo = memoryRepository({ [PATH]: text }); const before = snap(repo); const d = on(device('B', repo)); assert.equal(await P.verifyPassword('admin'), false); assert.equal(d.svc.bootstrapState(), 'error'); const inv = []; const off = P.onAdminSessionInvalidated((r) => inv.push(r));
    await d.svc.synchronize(); off(); assert.equal(d.adopted.length, 0); assert.deepEqual(inv, []); assert.equal(d.mem.has(KEY), false); assert.equal(snap(repo), before); assert.equal(d.svc.status().state, 'unsynchronized');
  }
});
test('recheckSession (Settings shown on a default session): one throttled synchronization when a connection exists, none without a connection or while one runs', async () => {
  const { repo } = await deviceA(); const d = on(device('B', null)); d.svc.recheckSession(0); await sleep(30); assert.equal(d.mem.has(KEY), false, 'no connection → nothing');
  d.repo = slow(repo, 80); const n0 = mark(); d.svc.recheckSession(0); d.svc.recheckSession(0); await sleep(300); const ev = since(n0); assert.equal(ev.filter((e) => e === 'session:recheck').length, 1, 'a running synchronization is not duplicated'); assert.ok(d.mem.has(KEY)); assert.equal(d.adopted.length, 1);
});

// ───────────────────────── Required regression tests
test('R1/R2/R3/R4 a password change on Device A is synchronized; Device B receives it, authenticates with it and cannot authenticate with "admin"', async () => {
  const { repo } = await deviceA(); assert.equal(central(repo).revision, 1); assert.ok(!repo.files.get(PATH).text.includes(CENTRAL), 'R1: encrypted verifier only');
  const b = on(device('B', repo)); assert.equal((await b.svc.synchronize()).synchronized, true); assert.equal(await P.verifyPassword(CENTRAL), true, 'R3'); assert.equal(await P.verifyPassword('admin'), false, 'R4');
});
test('R1b a later change on Device A reaches Device B through Sync with GitHub Now (synchronize) and the old password stops working', async () => {
  const { repo, a } = await deviceA(); const b = on(device('B', repo)); await b.svc.synchronize(); on(a); assert.equal((await a.svc.change(CENTRAL, CENTRAL2)).synchronized, true); on(b);
  assert.equal((await b.svc.synchronize()).changed, true); assert.equal(await P.verifyPassword(CENTRAL2), true); assert.equal(await P.verifyPassword(CENTRAL), false); assert.equal(central(repo).revision, 2);
});
test('R6/R7/R8 existing V17.6.6 users, repositories and encrypted security records stay compatible: marker + meta unchanged by the upgrade, a V17.6.6 central record is applied as before, the format and the paths are unchanged', async () => {
  const { repo } = await deviceA(); const rec = central(repo); assert.deepEqual(Object.keys(rec).sort(), ['appVersion', 'format', 'formatVersion', 'isDefault', 'revision', 'updatedAt', 'updatedByDevice', 'verifier']); assert.equal(rec.format, 'sqla-admin-password'); assert.equal(rec.formatVersion, 1);
  const snapBefore = snap(repo); const b = on(device('V1766', repo)); await b.svc.synchronize(); const marker = b.mem.get(KEY), meta = b.store.get(META);
  const b2 = on(device('V1766-restart', repo)); b2.mem.set(KEY, marker); b2.store.set(META, meta); assert.equal(await P.verifyPassword(CENTRAL), true); assert.equal(await P.verifyPassword('admin'), false); await b2.svc.synchronize(); assert.equal(b2.mem.get(KEY), marker, 'marker unchanged when nothing changed'); assert.equal(JSON.parse(b2.store.get(META)).revision, JSON.parse(meta).revision); assert.equal(snap(repo), snapBefore, 'no write to the repository');
  const old = on(device('V1764-custom', repo)); old.mem.set(KEY, JSON.stringify(await CS.encryptWithSecret(OWN, MARKER))); await old.svc.synchronize(); assert.equal(await P.verifyPassword(CENTRAL), true, 'a legacy local password is replaced by the central one (unchanged V17.6.5 rule)');
  assert.equal(adminPasswordPathFor('sql-assistant-data/schemas/registry.json'), PATH); const cs = src('src/services/cryptoService.ts'); assert.match(cs, /PBKDF2_ITERATIONS = 150000/); assert.match(cs, /name: 'AES-GCM'/);
});
test('the encrypted-marker format, storage key and record format are unchanged: no new storage key, no plaintext anywhere', async () => {
  const { repo } = await deviceA(); const d = on(device('B', repo)); await d.svc.synchronize(); assert.deepEqual(Object.keys(JSON.parse(d.mem.get(KEY))).sort(), ['ciphertext', 'iv', 'salt']); assert.deepEqual([...d.mem.keys()].sort(), [KEY, META].sort(), 'only the two existing keys (marker + V17.6.5 meta) — no new storage key'); assert.deepEqual(d.store.keys().filter((k) => /adminpw/.test(k)), [META]);
  const all = [...d.mem.values(), ...d.store.keys().map((k) => d.store.get(k)), repo.files.get(PATH).text, JSON.stringify(P.authTraceLog())].join('\n'); for (const pw of [CENTRAL, CENTRAL2, OWN]) assert.ok(!all.includes(pw), 'no plaintext (storage, repository record, diagnostics)');
});
test('basis "local": a password set on a device that never synchronized (no central revision) is labelled local, not central', async () => {
  const d = on(device('L', null)); d.mem.set(KEY, JSON.stringify(await CS.encryptWithSecret(OWN, MARKER))); /* an older / own marker on a device without a connection */ assert.equal(await P.verifyPassword(OWN), true); assert.equal(P.lastAuthBasis(), 'local'); void d;
});
test('Existing behaviours that must not change: default works when no record exists anywhere; a local-only password works; Pull Schema / vault / sign-in code is untouched', async () => {
  const none = on(device('N', memoryRepository())); assert.equal(await P.verifyPassword('admin'), true); const loc = on(device('L', memoryRepository())); assert.equal((await P.changePassword('admin', OWN)).ok, true); assert.equal(await P.verifyPassword(OWN), true); assert.equal(await P.verifyPassword('admin'), false); void none; void loc;
  for (const f of ['src/ui/pages/schemaPull.ts', 'src/ui/pages/schemaRepoCards.ts', 'src/ui/repoAccess.ts', 'src/v17/services/secretVault.ts', 'src/v17/services/vaultRetrieval.ts', 'src/v17/services/repoBroker.ts', 'src/v17/services/publishedData.ts', 'src/v17/sync/syncService.ts', 'src/v17/services/githubClient.ts', 'src/v17/engines/nluEngine.ts', 'src/v17/engines/queryValidator.ts', 'src/ui/syncPrefs.ts', 'src/ui/components/navbar.ts']) assert.ok(!/recheckSession|onAdopt|markSessionUnlocked|sessionOnDefault|authTrace/.test(src(f)), `${f}: untouched`);
});
test('wiring: unlock marks the session basis; Settings shown on a default session re-checks; the lock screen asks for the central record and drops the wrong "default is admin" hint when it was applied; e2e diagnostics hook', () => {
  const s = src('src/ui/pages/settings.ts'); assert.match(s, /const basis = store\.unlockSettings\(\)/); assert.match(s, /if \(sessionOnDefault\(\)\) services\(\)\.adminPassword\.recheckSession\(\)/); assert.match(s, /#settingsPwHint/);
  assert.match(src('src/testHooks.ts'), /adminAuth: \{ diagnostics: \(\) => services\(\)\.adminPassword\.diagnostics\(\)/); assert.match(src('src/ui/context.ts'), /setPasswordAuthority\(\{ resolve: \(\) => svc!\.adminPassword\.resolve\(\) \}\)/);
});
test('V17.6.7 history: the About page still lists 17.6.7, 17.6.6 and 17.6.5 (the version stamps are asserted by v1768.test.mjs); the V17.6.7 documents exist', () => {
  assert.match(src('src/ui/pages/other.ts'), /<li><strong>17\.6\.7<\/strong>.*<li><strong>17\.6\.6<\/strong>.*<li><strong>17\.6\.5<\/strong>/s);
  assert.match(src('README.md'), /What was new in V17\.6\.7/); for (const d of ['CHANGELOG_V17.6.7.md', 'TEST_REPORT_V17.6.7.md', 'REGRESSION_BASELINE_V17.6.7.md']) assert.ok(existsSync(join(root, 'docs', d)), d);
});
test('bundle secret scan: no credential-looking string and none of the synthetic test passwords in the production build', () => {
  const html = existsSync(join(root, 'dist/index.html')) ? src('dist/index.html') : ''; if (!html) return; assert.ok(!/\bghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(html));
  for (const pw of [CENTRAL, CENTRAL2, OWN, 'SYNTHETIC-']) assert.ok(!html.includes(pw), 'no test value in the bundle');
});
