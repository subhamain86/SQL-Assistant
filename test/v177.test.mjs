// V17.7 — (1) the Admin Password authority confirms the default by EVIDENCE (four holes of V17.6.9 closed), (2) the production page has no browser-test back door (hooks live only in the separate test build),
// (3) password synchronization has no NPM / Node runtime dependency, (4) the supplied error logs are classified, (5) current-version tests validate V17.7.
// Test passwords are synthetic example values, not credentials. Several "devices" run in one process; each has its own browser storage; Device B is NEVER seeded with the password.
import test from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs'; import { join, dirname } from 'node:path'; import { tmpdir } from 'node:os'; import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { imp, tiny, stamped } from './helpers.mjs'; import { CURRENT_VERSION, PREVIOUS_VERSION } from './support/version.mjs';
const root = join(dirname(new URL(import.meta.url).pathname), '..'); const src = (p) => readFileSync(join(root, p), 'utf8'); const strip = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const P = await imp('services/passwordService.js'); const CS = await imp('services/cryptoService.js'); const { AdminPasswordService, adminPasswordPathFor, sanitizePasswordRecord } = await imp('v17/services/adminPassword.js');
const { memoryRepository } = await imp('v17/services/githubClient.js'); const RC = await imp('v17/services/repositoryConfig.js'); const { memoryStore, KEYS } = await imp('services/storage.js'); const F = await imp('v17/sync/schemaFormat.js');
const NLU = await imp('v17/engines/nluEngine.js'); const R = await imp('v17/services/vaultRetrieval.js'); const PD = await imp('v17/services/publishedData.js'); const V = await imp('v17/services/secretVault.js'); const C = await imp('v17/services/cryptoBox.js');
const { sourceSet, TEST_ONLY } = await import(join(root, 'scripts/source-set.mjs'));
const PATH = 'sql-assistant-data/security/admin-password.json'; const MARKER = 'sqla-verified-marker-v15'; const KEY = 'sqla.pwvault.v15'; const META = 'sqla.adminpwmeta.v1765';
const CENTRAL = 'SYNTHETIC-central-pw-A1'; const CENTRAL2 = 'SYNTHETIC-central-pw-B2';
const ls = (m) => ({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: () => null, length: 0 });
const backed = (mem) => ({ get: (k) => (mem.has(k) ? mem.get(k) : null), set: (k, v) => { mem.set(k, String(v)); return true; }, remove: (k) => { mem.delete(k); }, keys: () => [...mem.keys()] });
function device(name, repo, opts = {}) { const mem = new Map(); const store = backed(mem); const d = { name, mem, store, repo, svc: null, adopted: [] }; d.svc = new AdminPasswordService(store, () => d.repo, () => adminPasswordPathFor('sql-assistant-data/schemas/registry.json'), () => [], { refreshMs: 0, ...opts }); d.svc.onAdopt((e) => d.adopted.push(e)); return d; }
const on = (d) => { globalThis.localStorage = ls(d.mem); P.setPasswordAuthority(d.svc); P.clearSessionBasis(); return d; };
const central = (repo) => JSON.parse(repo.files.get(PATH).text); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rec = (o) => JSON.stringify({ format: 'sqla-admin-password', formatVersion: 1, revision: 1, isDefault: true, verifier: null, updatedAt: '2026-10-13T10:00:00.000Z', updatedByDevice: 'x', appVersion: '17.6.8', ...o });
async function deviceA(pw = CENTRAL) { const repo = memoryRepository(); const a = on(device('A', repo)); const r = await a.svc.change('admin', pw); assert.equal(r.synchronized, true, r.message); return { repo, a }; }
const authMsg = () => P.authBlockedMessage() || '';

// ───────────────────────────────────────── 1. version stamps (the ONLY place the current literal is asserted) and test design
test('V17.7 release is documented and kept in the history: its release documents exist, the README keeps the V17.7 section, About keeps the 17.7.0 entry; the CURRENT version stamps are asserted by test/v1771.test.mjs (the one current-version file)', () => {
  assert.match(src('src/ui/pages/other.ts'), /<li><strong>17\.7\.0<\/strong>.*<li><strong>17\.6\.9<\/strong>.*<li><strong>17\.6\.8<\/strong>/s); assert.match(src('README.md'), /What is new in V17\.7/); assert.match(src('README.md'), /What was new in V17\.6\.9/);
  for (const d of ['CHANGELOG_V17.7.md', 'TEST_REPORT_V17.7.md', 'REGRESSION_BASELINE_V17.7.md', 'VERIFICATION_REPORT_V17.7.md', 'ROLLBACK_V17.7.md', 'RELEASE_NOTES_V17.7.md', 'ERROR_LOG_REVIEW_V17.7.md', 'CHANGED_FILES_V17.7.md', 'STALE_FILES_V17.7.md']) assert.ok(existsSync(join(root, 'docs', d)), d);
  assert.equal(JSON.parse(src('package.json')).devDependencies.typescript, '5.8.3', 'TypeScript stays pinned exactly'); assert.ok(!JSON.parse(src('package.json')).dependencies, 'no runtime dependency at all');
});
test('V17.7 test design: no historical test pins the CURRENT package version or the writer label; the current literal lives in ONE support module', () => {
  const dir = join(root, 'test'); const files = readdirSync(dir).filter((f) => /\.test\.mjs$/.test(f));
  for (const f of files) { if (f === 'v177.test.mjs' || f === 'v1771.test.mjs') continue; const t = readFileSync(join(dir, f), 'utf8'); assert.ok(!/(pkg|package\.json'\)\))\.version, ['"]17\.\d+\.\d+['"]/.test(t), `${f}: a historical test must not pin the package version`); assert.ok(!/APP_VERSION, ['"]17\.\d+\.\d+['"]|WRITER_LABEL, ['"]SQL Assistant 17\./.test(t), `${f}: a historical test must not pin APP_VERSION / the writer label`); assert.ok(!/version is 17\.\d+\.\d+ everywhere it is stamped/.test(t), `${f}: no "version is X everywhere" test outside the current-version file`); assert.ok(!/CURRENT_VERSION = ['"]17\./.test(t), f); }
  assert.match(readFileSync(join(dir, 'support/version.mjs'), 'utf8'), /CURRENT_VERSION = '17\.\d+\.\d+'/);
  for (const f of readdirSync(join(root, 'scripts')).filter((x) => /^browser_test.*\.py$/.test(x))) assert.ok(!/["']Version 17\.\d+\.\d+["']/.test(readFileSync(join(root, 'scripts', f), 'utf8')), `${f}: browser suites derive the version from package.json (VERSION), they do not pin it`);
});

// ───────────────────────────────────────── 2. the authentication boundary: the default is confirmed by EVIDENCE
test('V17.7 an EMPTY or damaged stored marker is never replaced by the default: "admin" is rejected in every central state, including the confirmed first-time default', async () => {
  for (const raw of ['', '   ', 'not-json', '{}', '{"salt":""}']) {
    const d = on(device('E', memoryRepository())); d.mem.set(KEY, raw); assert.equal(await P.verifyPassword('admin', 'settings-unlock'), false, `marker ${JSON.stringify(raw)}`); assert.equal(P.takeUnlockTicket(), null);
  }
  const d = on(device('F', memoryRepository())); assert.equal(await P.verifyPassword('admin', 'settings-unlock'), true, 'control: the confirmed first-time default still works on a device with no marker'); assert.equal(P.takeUnlockTicket(), 'default-confirmed');
});
test('V17.7 a marker that disappears AFTER the central verifier was applied is not a reset: the default stays refused at once (no throttle window) and the verifier is applied again', async () => {
  const { repo } = await deviceA(); const b = on(device('B', repo)); await b.svc.bootstrap(); assert.equal(b.svc.bootstrapState(), 'central-applied'); const verifier = JSON.stringify(central(repo).verifier);
  b.mem.delete(KEY); /* storage damaged / marker removed; the meta record remains */ assert.equal(await P.verifyPassword('admin', 'settings-unlock'), false, 'admin right after the marker vanished'); assert.equal(P.takeUnlockTicket(), null); assert.equal(b.mem.get(KEY) !== undefined && JSON.stringify(JSON.parse(b.mem.get(KEY))), verifier, 'the central verifier was applied again'); assert.equal(await P.verifyPassword(CENTRAL, 'settings-unlock'), true); assert.equal(P.takeUnlockTicket(), 'central');
  const c = on(device('C', repo)); await c.svc.synchronize(); c.mem.delete(KEY); const dead = { describe: 'x', files: new Map(), read: async () => { const e = new Error('network failure'); e.kind = 'network'; throw e; }, write: async () => 'x' }; c.repo = dead; assert.equal(await P.verifyPassword('admin'), false, 'marker gone AND the repository unreachable: still refused'); assert.equal(c.svc.bootstrapState(), 'error');
});
test('V17.7 a central record that VANISHES from the authoritative repository is not an administrator reset: the default stays refused, nothing is republished as a reset', async () => {
  const { repo } = await deviceA(); const b = on(device('B', repo)); await b.svc.synchronize(); const writesBefore = repo.files.size;
  repo.files.delete(PATH); b.mem.delete(KEY); /* the record disappeared (force-push / rollback / deletion) and this device has no verifier */
  const r = await b.svc.synchronize(); assert.equal(repo.files.has(PATH), false, 'a missing marker is never published as a "reset to default"'); assert.equal(repo.files.size, writesBefore - 1); assert.equal(await P.verifyPassword('admin', 'settings-unlock'), false); assert.equal(b.svc.bootstrapState(), 'error'); assert.match(authMsg(), /Settings stay locked/); assert.equal(r.ok, true);
  const fresh = on(device('N', repo)); assert.equal(await P.verifyPassword('admin'), true, 'a device that NEVER knew a central record: the authoritative repository answering "no record" is still the first-time default');
});
test('V17.7 a device without a verifier never keeps the default against a valid NON-default central record, whatever the revision numbers say; a pending unpublished "reset" does not outrank the central password', async () => {
  const { repo } = await deviceA(); const b = on(device('B', repo)); b.mem.set(META, JSON.stringify({ revision: 9, pending: true, sha: null, updatedAt: '2026-10-01T00:00:00.000Z', lastPullAt: null })); /* no marker, a higher local revision, a pending change */
  const r = await b.svc.synchronize(); assert.equal(r.ok, true); assert.equal(JSON.stringify(JSON.parse(b.mem.get(KEY))), JSON.stringify(central(repo).verifier), 'the central verifier is in force'); assert.equal(central(repo).revision, 1, 'the central record was not touched'); assert.equal(await P.verifyPassword('admin'), false); assert.equal(await P.verifyPassword(CENTRAL), true);
});
test('V17.7 synchronization NEVER publishes a reset: only reset() (after the administrator was authenticated and the central state read) writes one', async () => {
  const repo = memoryRepository(); const d = on(device('L', repo)); d.mem.set(META, JSON.stringify({ revision: 2, pending: true, sha: null, updatedAt: '2026-10-01T00:00:00.000Z', lastPullAt: null })); /* legacy: a reset held locally, never published */
  await d.svc.synchronize(); await d.svc.synchronize(); assert.equal(repo.files.has(PATH), false, 'nothing was published by synchronization');
  const a = await deviceA(); const b = on(device('B', a.repo)); await b.svc.synchronize(); on(b); const r = await b.svc.reset(); assert.equal(r.ok, true, r.message); assert.equal(central(a.repo).isDefault, true); assert.equal(central(a.repo).revision, 2);
  const n = on(device('N', a.repo)); assert.equal(await P.verifyPassword('admin', 'settings-unlock'), true, 'an explicit central reset record DOES allow the default'); assert.equal(P.takeUnlockTicket(), 'default-confirmed'); assert.equal(n.svc.bootstrapState(), 'confirmed-default');
  const c = on(device('C', a.repo)); await c.svc.synchronize(); on(c); assert.equal((await c.svc.change('admin', CENTRAL2)).synchronized, true); const x = on(device('X', a.repo)); assert.equal(await P.verifyPassword('admin'), false, 'once a non-default record replaces the reset, admin is refused again'); assert.equal(await P.verifyPassword(CENTRAL2), true);
});
test('V17.7 the evidence model across devices: password change propagates, the previous password stops, "admin" stays rejected, a newer central revision is never downgraded', async () => {
  const { repo, a } = await deviceA(); const b = on(device('B', repo)); await b.svc.synchronize(); assert.equal(await P.verifyPassword(CENTRAL, 'settings-unlock'), true); assert.equal(P.takeUnlockTicket(), 'central');
  on(a); assert.equal((await a.svc.change(CENTRAL, CENTRAL2)).synchronized, true); assert.equal(central(repo).revision, 2);
  on(b); await b.svc.synchronize(); assert.equal(await P.verifyPassword(CENTRAL), false, 'previous password'); assert.equal(await P.verifyPassword('admin'), false, 'default'); assert.equal(await P.verifyPassword(CENTRAL2), true, 'new password');
  const stale = on(device('S', repo)); stale.mem.set(KEY, JSON.stringify(central(repo).verifier)); stale.mem.set(META, JSON.stringify({ revision: 1, pending: true, sha: null, updatedAt: '2026-01-01T00:00:00.000Z', lastPullAt: null })); await stale.svc.synchronize(); assert.equal(central(repo).revision, 2, 'no downgrade');
});

// ───────────────────────────────────────── 3. ONE authentication service: no other module decides about the default
test('V17.7 one authentication service: the default is named only in passwordService.ts; every Admin entry point ends in verifyPassword(); the Settings state is opened only through the ticketed unlock', () => {
  const files = sourceSet(root).files.map((f) => f.slice(root.length + 1).split('\\').join('/')); const text = (f) => strip(src(f));
  for (const f of files) { const t = text(f); if (f !== 'src/services/passwordService.ts') { assert.ok(!/DEFAULT_PASSWORD/.test(t), `${f}: DEFAULT_PASSWORD is private to passwordService.ts`); assert.ok(!/\b(?:password|passwd|pw|candidate|input|value|secret)\w*\s*={2,3}\s*['"]admin['"]|['"]admin['"]\s*={2,3}\s*\w*(?:password|passwd|pw|candidate|input)/i.test(t), `${f}: a UI / service module must never compare a password with "admin"`); }
    assert.ok(!/\bsettingsUnlocked\s*=[^=]/.test(t) || f === 'src/ui/state.ts', `${f}: Settings are unlocked only inside AppStore`); }
  for (const f of files) for (const m of text(f).matchAll(/saveRepositoryConfig\(([^\n]*)\)/g)) if (f !== 'src/v17/services/repositoryConfig.ts') assert.ok(!/\bverify\b/.test(m[1]), `${f}: the test seam "verify" of saveRepositoryConfig is never passed by the application`);
  const p = text('src/services/passwordService.ts'); assert.equal((p.match(/verifyDefault\(/g) || []).length, 2, 'declared once, called once'); assert.match(p, /else if \(r\.defaultAllowed && r\.state === 'confirmed-default'\) \{ ok = await verifyDefault\(candidate\)/); assert.ok(!/storedBlob|verifyLocal/.test(p), 'the V17.6.9 function that served both the stored marker and the default is gone');
  assert.equal((p.match(/defaultBlob\(/g) || []).length, 2, 'the default marker is built in one function used by verifyDefault only');
  for (const f of ['src/ui/pages/settings.ts', 'src/ui/pages/schemaRepoCards.ts', 'src/ui/pages/adminLibrary.ts', 'src/v17/services/repositoryConfig.ts', 'src/v17/services/adminPassword.ts']) assert.match(text(f), /verifyPassword/, `${f} authenticates through verifyPassword`);
  assert.match(text('src/ui/state.ts'), /unlockSettings\(\): AuthBasis \| null \{ const basis = takeUnlockTicket\(\); if \(!basis\) return null;/); assert.match(text('src/ui/context.ts'), /setPasswordAuthority\(\{ resolve: \(\) => svc!\.adminPassword\.resolve\(\) \}\)/);
  const a = text('src/v17/services/adminPassword.ts'); assert.match(a, /this\.obs\.reset !== true && isUsingDefaultPassword\(\)/); assert.match(a, /case 'applied': if \(hasMarker\)/); assert.ok(!/outcome: 'applied'[^}]*\}[^;]*;[^;]*confirmed-default/.test(a)); assert.match(a, /if \(r\.isDefault\) return this\.out\(\{ ok: true, synchronized: false, message: 'Synchronization never publishes a reset/);
});

// ───────────────────────────────────────── 4. the production page has NO test back door; the test build is separate
test('V17.7 no browser-test hook in the production application: main.ts has none, nothing under src/ imports src/testHooks.ts, the build keeps it out of dist/, index.html and release/, hygiene fails when production reaches it', async () => {
  const main = src('src/main.ts'); assert.ok(!/__sqla\b|e2e|setRepositoryOverride|memoryRepository|setBrokerConfig|setPublishedState/.test(strip(main)), 'main.ts carries no hook'); assert.deepEqual(TEST_ONLY, ['src/testHooks.ts']);
  const ss = sourceSet(root); assert.ok(!ss.files.some((f) => f.endsWith('src/testHooks.ts')), 'not in the production graph'); assert.ok(!ss.orphans.some((f) => f.endsWith('src/testHooks.ts')), 'declared test-only, not an orphan'); assert.equal(ss.testOnly.length, 1);
  assert.deepEqual(JSON.parse(src('tsconfig.json')).files, ['src/main.ts'], 'production compiles from the entry point only'); assert.deepEqual(JSON.parse(src('tsconfig.test.json')).files, ['src/main.ts', 'src/testHooks.ts']); assert.equal(JSON.parse(src('tsconfig.json')).compilerOptions.strict, true);
  const th = src('src/testHooks.ts'); assert.match(th, /get\('e2e'\) !== '1'/); assert.match(th, /window as unknown as Record<string, unknown>\)\.__sqla/);
  const HOOK = /\b__sqla\b|__sqlaRequire|installTestHooks|testHooks|BROWSER-TEST BUILD|[?&]e2e=1|get\('e2e'\)|window\.define\s*=/;
  for (const f of ['dist/index.html', 'index.html', 'release/index.html', 'release/404.html']) if (existsSync(join(root, f))) { const h = src(f); assert.ok(!HOOK.test(h), `${f}: no hook trace`); const sc = h.match(/<script>([\s\S]*)<\/script>\s*<\/body>/)[1]; assert.ok(sc.startsWith('(function(){') && sc.trimEnd().endsWith('})();'), `${f}: the script runs in one function scope`); }
  if (existsSync(join(root, 'test-dist/index.html'))) { const h = src('test-dist/index.html'); assert.match(h, /BROWSER-TEST BUILD/); assert.match(h, /installTestHooks/); assert.ok(!/^\s*window\.define/m.test(h)); }
  assert.match(src('scripts/build.mjs'), /testBuild \? 'window\.__sqlaRequire=r;' : ''/); assert.match(src('scripts/build.mjs'), /tsconfig\.test\.json/);
  const t = mkdtempSync(join(tmpdir(), 'sqla-hook-')); try { for (const f of ['src', 'scripts', 'test', 'public', 'package.json', 'tsconfig.json']) cpSync(join(root, f), join(t, f), { recursive: true });
    const clean = (await import(join(root, 'scripts/check-stale.mjs'))).checkStale(t); assert.deepEqual(clean.problems, [], 'the clean tree passes the hygiene check, with the test-only module present');
    writeFileSync(join(t, 'src/main.ts'), `import './testHooks';\n${readFileSync(join(t, 'src/main.ts'), 'utf8')}`); const bad = (await import(join(root, 'scripts/check-stale.mjs'))).checkStale(t); assert.ok(bad.problems.some((p) => p.title === 'Test hook reachable from production' && p.file === 'src/testHooks.ts'), JSON.stringify(bad.problems)); } finally { rmSync(t, { recursive: true, force: true }); }
});
test('V17.7 artifact verification refuses a production page that carries the test hook, a global module loader or an unscoped script', async () => {
  if (!existsSync(join(root, 'release/index.html'))) return; const { verifyArtifact } = await import(join(root, 'scripts/verify-artifact.mjs')); assert.deepEqual(verifyArtifact(root).problems, []);
  const t = mkdtempSync(join(tmpdir(), 'sqla-art-')); try { for (const f of ['index.html', 'dist', 'release', 'package.json']) cpSync(join(root, f), join(t, f), { recursive: true });
    const bad = (mut, title) => { const x = mkdtempSync(join(tmpdir(), 'sqla-art2-')); try { cpSync(t, x, { recursive: true }); mut(x); const r = verifyArtifact(x); assert.ok(r.problems.some((p) => p.title === title), `${title}: ${JSON.stringify(r.problems.map((p) => p.title))}`); } finally { rmSync(x, { recursive: true, force: true }); } };
    const all = (x, fn) => { for (const f of ['index.html', 'dist/index.html', 'release/index.html', 'release/404.html']) writeFileSync(join(x, f), fn(readFileSync(join(x, f), 'utf8'))); };
    bad((x) => all(x, (h) => h.replace('<body>', '<!-- window.__sqla = {} -->\n<body>')), 'Test hook in a production artifact'); bad((x) => all(x, (h) => h.replace('(function(){', '(function(){/* installTestHooks */')), 'Test hook in a production artifact');
    bad((x) => all(x, (h) => h.replace('<script>(function(){', '<script>window.__x=1;(function(){')), 'Script scope'); } finally { rmSync(t, { recursive: true, force: true }); }
});

// ───────────────────────────────────────── 5. no NPM / Node at runtime
test('V17.7 password synchronization has no NPM / Node runtime dependency: the production source and bundle use no Node API and no bare-specifier import; package.json has no runtime dependency; the sync path is repository / broker / published copy only', () => {
  const files = sourceSet(root).files.map((f) => f.slice(root.length + 1).split('\\').join('/'));
  for (const f of files) { const t = strip(src(f)); assert.ok(!/\brequire\(|\bprocess\.(?:env|argv|cwd|platform|exit|versions)|child_process|\b(?:import|export)\b[^;\n]*\bfrom ['"](?:node:|(?!\.))|\bimport\s+['"](?!\.)|\bimport\(['"](?!\.)/.test(t), `${f}: no Node API and no bare-specifier (package) import in the browser application`); }
  const a = strip(src('src/v17/services/adminPassword.ts')); assert.ok(/repo\.read\(this\.path\(\)\)/.test(a) && /repo\.write\(this\.path\(\)/.test(a), 'the central record is read and written through the repository abstraction (central access service, saved token or published copy)');
  const pkg = JSON.parse(src('package.json')); assert.equal(pkg.dependencies, undefined); assert.deepEqual(Object.keys(pkg.devDependencies), ['typescript']); assert.equal(pkg.engines.node, '>=20');
  for (const f of ['dist/index.html', 'release/index.html']) if (existsSync(join(root, f))) { const h = src(f); assert.ok(!/\brequire\(|process\.env|child_process|node_modules|\bnpx\b/.test(h.replace(/<style>[\s\S]*?<\/style>/, '')), `${f}: the shipped page references no Node API`); }
  const docs = src('docs/ADMIN_PASSWORD.md'); assert.match(docs, /No NPM at runtime/);
});

// ───────────────────────────────────────── 6. the supplied error logs: what is application, what is environment
test('V17.7 error-log review: every supplied archive is classified; application defects are tied to a test / script, environment blockers are named as external', () => {
  const d = src('docs/ERROR_LOG_REVIEW_V17.7.md'); for (const id of ['logs_103717775423', 'logs_104050659931', 'logs_104050659931 (1)', 'logs_104050744994', 'logs_104051351287']) assert.ok(d.includes(id), id);
  assert.match(d, /AZURE_CREDENTIALS/); assert.match(d, /AADSTS53003/); assert.match(d, /Conditional Access/); assert.match(d, /external/i); assert.match(d, /SQLA_BROKER_APP_NAME/); assert.match(d, /check:stale/);
  const list = JSON.parse(src('scripts/stale-files.json')).files; assert.equal(list.length, 59, 'the reviewed stale-file list is unchanged (54 orphans + 5 historical tests)');
});
