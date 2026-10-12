import { test } from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; import http from 'node:http';
import { imp } from './helpers.mjs';
const { memoryStore, KEYS } = await imp('services/storage.js'); const V = await imp('v17/services/secretVault.js'); const C = await imp('v17/services/cryptoBox.js'); const GH = await imp('v17/services/githubClient.js');
const R = await imp('v17/services/vaultRetrieval.js'); const BA = await imp('v17/services/bootstrapAuth.js'); const D = await imp('v17/services/repositoryDefaults.js'); const F = await imp('v17/sync/schemaFormat.js');
const { createRelay } = await import(new URL('../scripts/github-device-relay.mjs', import.meta.url));
const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'; const TOKEN2 = 'github_pat_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4'; const SIGNIN = 'ghu_' + 'S1g2N3i4N5t6O7k8E9n0Q1w2E3r4T5y6U7i8'; const AI = 'sk-test-' + 'abcdefghijklmnopqrstuvwxyz0123456789';
const PASS = 'xG71lfp1NHZVZ4WVWCPe'; const OWN = 'my-own-vault-passphrase-1'; const CLIENT = 'Iv1.0123456789abcdef'; const DEVICE = 'dc_' + 'abcdefghijklmnopqrstuvwxyz012345'; const USERCODE = 'WDJB-MJHT';
const LOC = { owner: 'basware', repo: 'sk-ap-sql-assistant', branch: 'main' }; const VP = V.EMPTY_SECRETS.vaultPath;
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const vault = (store = memoryStore(), keys = C.memoryKeyProvider()) => new V.SecretVault(store, keys);
const makeFile = async (secrets, pass = PASS) => { const v = vault(); await v.save({ ...V.EMPTY_SECRETS, ...secrets }); return v.exportEncrypted(pass); };
const err = (kind) => new GH.RepositoryError(`${kind} failure`, kind, 0);
const fake = (script) => { const log = []; const make = (token) => ({ describe: 'fake', async read(p) { log.push({ who: token ? 'auth' : 'anon', p, token }); const r = script(token ? 'auth' : 'anon', p, token); if (r instanceof Error) throw r; return r; }, async write() { throw new Error('a retrieval must never write'); } }); return { make, log }; };
const base = (o = {}) => ({ location: LOC, vaultPath: VP, defaultPath: VP, savedToken: '', override: null, ...o });
const state = (st, canWrite = null) => async () => ({ state: st, canWrite, message: canWrite === false ? 'GitHub accepted the token, but it has READ-ONLY access: it can pull but cannot publish.' : `GitHub check: ${st}` });
const snapshot = (store) => JSON.stringify([...store.keys()].sort().map((k) => [k, store.get(k)]));
const CFG = { clientId: CLIENT, relayUrl: 'https://relay.example.org/github' };

test('V17.6.1 version is stamped everywhere (package.json = APP_VERSION = writer label)', () => { const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))); assert.match(pkg.version, /^17\.6\.[1-9]\d*$/, 'V17.6.1 or a later 17.6.x patch (V17.6.2 keeps every V17.6.1 behaviour tested below)'); assert.equal(F.APP_VERSION, pkg.version); assert.equal(F.WRITER_LABEL, `SQL Assistant ${pkg.version}`); });

// ───────────────────────────── the sign-in configuration (administrator-controlled, public values only) ─────────────────────────────
test('V17.6.1 sign-in configuration: off by default; enabled only with a valid public client ID and an https relay (http only for localhost); everything else is off or reported', () => {
  const ok = (o) => BA.parseBootstrapConfig(JSON.stringify({ githubSignIn: { enabled: true, clientId: CLIENT, relayUrl: 'https://relay.example.org/github/', ...o } }));
  assert.deepEqual(ok({}), { state: 'enabled', config: { clientId: CLIENT, relayUrl: 'https://relay.example.org/github' } }, 'a trailing slash is removed');
  for (const t of ['', '   ', '{}', '{"githubSignIn":null}', '{"githubSignIn":{"enabled":false}}', '{"githubSignIn":{}}', '\uFEFF']) assert.equal(BA.parseBootstrapConfig(t).state, 'disabled', JSON.stringify(t));
  for (const t of ['not json', '[]', '"x"', '{"githubSignIn":[]}', '{"githubSignIn":{"enabled":"yes"}}']) assert.equal(BA.parseBootstrapConfig(t).state, 'invalid', t);
  for (const o of [{ clientId: '' }, { clientId: 'short' }, { clientId: 'has space in it' }, { clientId: undefined }, { relayUrl: 'http://relay.example.org' }, { relayUrl: 'ftp://relay.example.org' }, { relayUrl: 'https://user:pw@relay.example.org' }, { relayUrl: 'https://relay.example.org/?x=1' }, { relayUrl: 'https://relay.example.org/#h' }, { relayUrl: '' }, { relayUrl: undefined }, { relayUrl: 42 }]) assert.equal(ok(o).state, 'invalid', JSON.stringify(o));
  assert.equal(ok({ relayUrl: 'http://127.0.0.1:8787' }).state, 'enabled'); assert.equal(ok({ relayUrl: 'http://localhost:8787/gh' }).state, 'enabled');
  for (const t of ['{"githubSignIn":{"enabled":true,"clientId":"x"}}']) { const r = BA.parseBootstrapConfig(t); assert.equal(r.state, 'invalid'); assert.ok(!JSON.stringify(r).includes('x"'), 'messages carry no value'); }
  assert.ok(!JSON.stringify(ok({ clientId: 'bad id' })).includes('bad id'));
});
test('V17.6.1 the configuration file is looked up next to index.html (root, sub-path, hash / query ignored); a page opened from disk has none; a missing file / the SPA fallback page / an error mean "off"', async () => {
  const P = BA.BOOTSTRAP_CONFIG_RELATIVE_PATH; assert.equal(P, 'sql-assistant-data/vault-bootstrap.config.json');
  for (const [page, want] of [['https://h.example/', `https://h.example/${P}`], ['https://h.example/index.html', `https://h.example/${P}`], ['https://h.example/tools/sql/', `https://h.example/tools/sql/${P}`], ['https://h.example/tools/sql/index.html?e2e=1#schema-used/pull', `https://h.example/tools/sql/${P}`], ['https://h.example/tools/sql', `https://h.example/tools/sql/${P}`], ['http://127.0.0.1:8080/SQL-Assistant/', `http://127.0.0.1:8080/SQL-Assistant/${P}`]]) assert.equal(BA.bootstrapConfigUrl(page), want, page);
  for (const bad of ['file:///C:/app/index.html', 'data:text/html,x', 'not a url', '']) assert.equal(BA.bootstrapConfigUrl(bad), null, bad);
  const resp = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => body }); const good = JSON.stringify({ githubSignIn: { enabled: true, clientId: CLIENT, relayUrl: CFG.relayUrl } });
  assert.equal((await BA.fetchBootstrapConfig({ pageUrl: 'https://h.example/', fetchFn: resp(200, good) })).state, 'enabled');
  for (const f of [resp(404, 'nf'), resp(200, '<!doctype html><title>SQL Assistant</title>'), resp(500, ''), resp(200, 'x'.repeat(20000)), async () => { throw new Error('offline'); }]) assert.equal((await BA.fetchBootstrapConfig({ pageUrl: 'https://h.example/', fetchFn: f })).state, 'disabled');
  assert.equal((await BA.fetchBootstrapConfig({ pageUrl: 'file:///x/index.html', fetchFn: async () => { throw new Error('must not be called'); } })).state, 'disabled');
  assert.equal((await BA.fetchBootstrapConfig({ pageUrl: 'https://h.example/', fetchFn: resp(200, '{ bad') })).state, 'invalid', 'an invalid file is reported to the user, not ignored');
  let init; await BA.fetchBootstrapConfig({ pageUrl: 'https://h.example/', fetchFn: async (u, i) => { init = i; return resp(404, '')(); } }); assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store');
});

// ───────────────────────────── the device flow (RFC 8628) ─────────────────────────────
/** a scripted relay: each POST gets the next answer; every request is recorded */
const relay = (answers) => { const calls = []; let n = 0; const f = async (url, init = {}) => { calls.push({ url: String(url), init, body: JSON.parse(init.body || '{}') }); const a = answers[Math.min(n++, answers.length - 1)]; if (a instanceof Error) throw a; const body = typeof a.body === 'string' ? a.body : JSON.stringify(a.body); return { ok: (a.status || 200) < 400, status: a.status || 200, text: async () => body }; }; f.calls = calls; return f; };
const CODE = { body: { device_code: DEVICE, user_code: USERCODE, verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 } };
const instant = { sleep: async () => {}, now: (() => { let t = 0; return () => (t += 1000); })() };
test('V17.6.1 device flow: asks for a code, shows the user code and the github.com address, polls while pending / slow_down, returns the short-lived token — and only talks to the relay, with no credential', async () => {
  const f = relay([CODE, { body: { error: 'authorization_pending' } }, { body: { error: 'slow_down', interval: 10 } }, { body: { access_token: SIGNIN, token_type: 'bearer' } }]); let shown = null; const sleeps = [];
  const r = await BA.runDeviceFlow(CFG, (c) => { shown = c; }, { fetchFn: f, sleep: async (ms) => { sleeps.push(ms); }, now: instant.now });
  assert.deepEqual(r, { ok: true, token: SIGNIN }); assert.deepEqual(shown, { userCode: USERCODE, verificationUri: 'https://github.com/login/device', expiresInSec: 900, intervalSec: 5 }); assert.ok(!JSON.stringify(shown).includes(DEVICE), 'the device code is never handed to the UI');
  assert.deepEqual(sleeps, [5000, 5000, 10000], 'the interval is honoured and slow_down widens it');
  assert.deepEqual(f.calls.map((c) => c.url), [`${CFG.relayUrl}/device/code`, `${CFG.relayUrl}/device/token`, `${CFG.relayUrl}/device/token`, `${CFG.relayUrl}/device/token`], 'nothing but the relay is contacted');
  assert.deepEqual(f.calls[0].body, { client_id: CLIENT }); assert.deepEqual(f.calls[1].body, { client_id: CLIENT, device_code: DEVICE }); assert.ok(f.calls.every((c) => c.init.credentials === 'omit' && !('Authorization' in (c.init.headers || {})) && c.init.method === 'POST' && c.init.cache === 'no-store'));
});
test('V17.6.1 device flow failures are each classified with an actionable message that contains no code, token, client ID or address — and never a token', async () => {
  const cases = [['denied', [CODE, { body: { error: 'access_denied' } }]], ['expired', [CODE, { body: { error: 'expired_token' } }]], ['not-enabled', [{ body: { error: 'device_flow_disabled' } }]], ['client-rejected', [{ body: { error: 'incorrect_client_credentials' } }]], ['client-rejected', [{ status: 403, body: { error: 'client_not_allowed' } }]],
    ['relay-invalid', [{ body: '<!doctype html><html>login</html>' }]], ['relay-invalid', [{ body: 'not json at all' }]], ['relay-invalid', [{ body: '[]' }]], ['relay-invalid', [{ status: 500, body: '{}' }]], ['relay-unreachable', [new Error('connect ECONNREFUSED relay.example.org')]],
    ['rate-limited', [{ status: 429, body: '{}' }]], ['rate-limited', [CODE, { body: { error: 'rate_limited' } }]], ['unexpected', [CODE, { body: { error: 'something_new' } }]],
    ['relay-invalid', [{ body: { device_code: 'x', user_code: USERCODE, verification_uri: 'https://github.com/login/device' } }]], ['relay-invalid', [CODE, { body: { access_token: 'short' } }]], ['relay-invalid', [{ body: { device_code: DEVICE, user_code: USERCODE, verification_uri: 'https://evil.example/login/device' } }]]];
  for (const [kind, answers] of cases) { const r = await BA.runDeviceFlow(CFG, () => {}, { fetchFn: relay(answers), ...instant }); assert.equal(r.ok, false, kind); assert.equal(r.kind, kind, JSON.stringify(answers).slice(0, 80)); assert.match(r.message, /Nothing on this device was changed/);
    for (const s of [TOKEN, SIGNIN, DEVICE, CLIENT, 'relay.example.org', 'ECONNREFUSED']) assert.ok(!r.message.includes(s), `${kind} leaks ${s}`); }
  for (const k of Object.keys(BA.DEVICE_FLOW_MESSAGES)) assert.match(BA.DEVICE_FLOW_MESSAGES[k], /Nothing on this device was changed/);
});
test('V17.6.1 device flow: the code expires, the user cancels, the page is left, a polling hiccup is retried, a relay that never answers times out — and the verification address is always the real github.com', async () => {
  let t = 0; const slow = { sleep: async () => {}, now: () => (t += 400_000) }; assert.equal((await BA.runDeviceFlow(CFG, () => {}, { fetchFn: relay([CODE, { body: { error: 'authorization_pending' } }]), ...slow })).kind, 'expired', 'the code lifetime is enforced locally too');
  const ctl = new AbortController(); const r = await BA.runDeviceFlow(CFG, () => ctl.abort(), { fetchFn: relay([CODE, { body: { error: 'authorization_pending' } }]), signal: ctl.signal, ...instant }); assert.equal(r.kind, 'cancelled'); assert.match(r.message, /cancelled/);
  const pre = new AbortController(); pre.abort(); const f0 = relay([CODE]); assert.equal((await BA.runDeviceFlow(CFG, () => {}, { fetchFn: f0, signal: pre.signal })).kind, 'cancelled'); assert.equal(f0.calls.length, 0, 'nothing is requested after a cancel');
  const hic = relay([CODE, new Error('blip'), { body: { access_token: SIGNIN } }]); assert.deepEqual(await BA.runDeviceFlow(CFG, () => {}, { fetchFn: hic, ...instant }), { ok: true, token: SIGNIN });
  const hang = (u, i) => new Promise((_, rej) => i.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))); assert.equal((await BA.runDeviceFlow(CFG, () => {}, { fetchFn: hang, requestTimeoutMs: 30 })).kind, 'timeout');
  for (const [v, want] of [['https://github.com/login/device', 'https://github.com/login/device'], ['https://github.com/login/device?user_code=ABCD-EFGH', 'https://github.com/login/device'], ['http://github.com/login/device', null], ['https://github.com.evil.example/login/device', null], ['https://evil.example/login/device', null], ['https://github.com:8443/login/device', null], ['https://u:p@github.com/login/device', null], ['https://github.com/other', null], ['javascript:alert(1)', null], [undefined, null], [42, null]]) assert.equal(BA.safeVerificationUri(v), want, String(v));
});

// ───────────────────────────── repository retrieval: the routes and their order ─────────────────────────────
test('V17.6.1 retrieval order: a saved token GitHub accepts is used; an expired saved token no longer blocks (anonymous read next); with nothing saved a public repository is read anonymously', async () => {
  const file = await makeFile({ githubToken: TOKEN2 }, OWN); const f = fake((who, p) => (who === 'auth' && p === VP ? { text: file, sha: 's' } : null)); const r = await R.retrieveVaultFile(base({ savedToken: TOKEN, makeRepository: f.make })); assert.equal(r.via, 'repository-token'); assert.deepEqual(f.log.map((l) => l.who), ['auth']);
  const g = fake((who, p) => (who === 'auth' ? err('auth') : p === VP ? { text: file, sha: 's' } : null)); const r2 = await R.retrieveVaultFile(base({ savedToken: TOKEN, makeRepository: g.make, checkLocation: async () => ({ ok: false, kind: 'auth', message: 'rejected' }) })); assert.equal(r2.via, 'repository-anonymous'); assert.ok(r2.notes.some((n) => /rejected by GitHub/.test(n)));
  const h = fake((who, p) => (p === VP ? { text: file, sha: 's' } : null)); const r3 = await R.retrieveVaultFile(base({ makeRepository: h.make })); assert.equal(r3.via, 'repository-anonymous'); assert.deepEqual(h.log.map((l) => [l.who, l.p]), [['anon', VP]]);
});
test('V17.6.1 PRIVATE repository + no token: the anonymous read is answered "not found" — reported honestly (no credential invented), and sign-in is offered as a way forward for exactly the failures it can fix', async () => {
  const f = fake(() => null); const r = await R.retrieveVaultFile(base({ makeRepository: f.make })); assert.equal(r.ok, false); assert.equal(r.kind, 'bootstrap-unavailable'); assert.ok(f.log.every((l) => l.who === 'anon'));
  assert.match(r.message, /vault passphrase does not authenticate to GitHub/); assert.match(r.message, /do not have to set the token first[\s\S]*Import encrypted file/); assert.match(r.message, /GitHub sign-in/); assert.match(r.message, /not changed/);
  assert.deepEqual(R.SIGN_IN_CAN_HELP.slice().sort(), ['bootstrap-unavailable', 'denied', 'rate-limit', 'token-rejected']);
  const chk = (o) => async () => o; const run = (script, o = {}) => R.retrieveVaultFile(base({ makeRepository: fake(script).make, ...o }));
  assert.equal((await run(() => null, { savedToken: TOKEN, checkLocation: chk({ ok: true, fileExists: false, message: '' }) })).kind, 'file-not-found'); assert.equal((await run(() => null, { savedToken: TOKEN, checkLocation: chk({ ok: false, kind: 'not-found', message: '' }) })).kind, 'repository-not-found');
  assert.equal((await run(() => null, { savedToken: TOKEN, checkLocation: chk({ ok: false, kind: 'branch', message: '' }) })).kind, 'branch-not-found'); assert.equal((await run(() => err('permission'), { savedToken: TOKEN })).kind, 'denied'); assert.equal((await run(() => err('timeout'), { savedToken: TOKEN })).kind, 'timeout');
  assert.equal((await run(() => err('network'), { savedToken: TOKEN })).kind, 'network'); assert.equal((await run(() => err('config'))).kind, 'config'); assert.equal((await run(() => err('permission'))).kind, 'rate-limit'); assert.equal((await R.retrieveVaultFile(base({ vaultPath: '../x.json', defaultPath: '/abs' }))).kind, 'config');
  for (const [k, m] of Object.entries(R.MESSAGES)) { assert.match(m, /not changed|were not changed/, k); for (const s of [TOKEN, TOKEN2, SIGNIN, PASS, OWN, 'basware', 'sk-ap-sql-assistant', 'sql-assistant-data']) assert.ok(!m.includes(s), `${k} contains ${s}`); }
});
test('V17.6.1 retrieval with the SHORT-LIVED sign-in token: reads the vault; classifies denied / expired / missing / network; never writes; never echoes the token', async () => {
  const file = await makeFile({ githubToken: TOKEN }, OWN); const f = fake((who, p, tok) => (tok === SIGNIN && p === VP ? { text: file, sha: 's' } : null)); const ok = await R.retrieveVaultAuthorized({ location: LOC, vaultPath: VP, defaultPath: VP, token: SIGNIN, makeRepository: f.make });
  assert.equal(ok.ok, true); assert.equal(ok.via, 'repository-signin'); assert.equal(ok.text, file); assert.deepEqual(f.log.map((l) => l.who), ['auth']);
  const run = (script, check) => R.retrieveVaultAuthorized({ location: LOC, vaultPath: VP, defaultPath: VP, token: SIGNIN, makeRepository: fake(script).make, checkLocation: async () => check });
  const cases = [[() => null, { ok: false, kind: 'not-found', message: '' }, 'signin-no-access'], [() => null, { ok: false, kind: 'permission', message: '' }, 'signin-no-access'], [() => null, { ok: false, kind: 'auth', message: '' }, 'signin-expired'], [() => null, { ok: true, fileExists: false, message: '' }, 'file-not-found'], [() => null, { ok: false, kind: 'branch', message: '' }, 'branch-not-found'],
    [() => err('auth'), null, 'signin-expired'], [() => err('permission'), null, 'signin-no-access'], [() => err('network'), null, 'network'], [() => err('timeout'), null, 'timeout'], [() => err('config'), null, 'config']];
  for (const [script, check, kind] of cases) { const r = await run(script, check); assert.equal(r.ok, false); assert.equal(r.kind, kind); assert.ok(!JSON.stringify(r).includes(SIGNIN)); }
  assert.match(R.MESSAGES['signin-no-access'], /cannot read the configured repository[\s\S]*GitHub App is not installed/); assert.match(R.MESSAGES['signin-expired'], /sign in again/);
});

// ───────────────────────────── the vault file is checked before anything is decrypted ─────────────────────────────
test('V17.6.1 vault structure / version check: a real vault passes; an HTML login page, non-JSON, JSON that is not a vault, a newer / unknown version or algorithm, a device-key envelope, an incomplete or implausible envelope are each refused with their own reason', async () => {
  const f = await makeFile({ githubToken: TOKEN }, OWN); assert.deepEqual(R.validateVaultPayload(f), { ok: true }); assert.deepEqual(R.validateVaultPayload('\uFEFF' + f), { ok: true });
  const j = JSON.parse(f); const t = (o) => R.validateVaultPayload(JSON.stringify({ ...j, ...o }));
  const want = [['<!DOCTYPE html><html><body>Sign in to GitHub</body></html>', 'html'], ['  <html>', 'html'], ['', 'not-json'], ['{ nope', 'not-json'], ['[]', 'not-a-vault'], ['"x"', 'not-a-vault'], ['{}', 'not-a-vault'], ['{"schemas":[]}', 'not-a-vault'], [JSON.stringify({ v: 1, alg: 'AES-256-GCM', kdf: 'DEVICE-KEY', iv: 'AAAA', ct: 'AAAA' }), 'not-a-vault']];
  for (const [text, kind] of want) { const r = R.validateVaultPayload(text); assert.equal(r.ok, false, text.slice(0, 30)); assert.equal(r.kind, kind, text.slice(0, 30)); }
  for (const [o, kind] of [[{ v: 2 }, 'unsupported'], [{ alg: 'AES-128-CBC' }, 'unsupported'], [{ kdf: 'SCRYPT' }, 'unsupported'], [{ ct: '' }, 'damaged'], [{ iv: 'not base64!' }, 'damaged'], [{ salt: 5 }, 'damaged'], [{ iter: 5 }, 'damaged'], [{ iter: 999_999_999 }, 'damaged']]) { const r = t(o); assert.equal(r.ok, false, JSON.stringify(o)); assert.equal(r.kind, kind, JSON.stringify(o)); }
  assert.equal(R.validateVaultPayload(JSON.stringify({ format: 'sqla-vault-sync', version: 3, kdf: {}, cipher: {} })).kind, 'unsupported'); assert.equal(R.validateVaultPayload(JSON.stringify({ format: 'sqla-vault-sync', version: 2, kdf: { salt: 'a', iterations: 5 }, cipher: { iv: 'b' }, ciphertext: 'c' })).kind, 'damaged');
  for (const [, r] of [[0, R.validateVaultPayload('<html>')], [1, t({ v: 2 })]]) for (const s of [TOKEN, OWN, PASS, f.slice(10, 40)]) assert.ok(!r.message.includes(s));
});

// ───────────────────────────── restoring the token: validated before it replaces anything ─────────────────────────────
test('V17.6.1 a token GitHub cannot use for the repository is NOT restored; an unconfirmed token never replaces a saved one; rejected is refused; read-only is restored with a warning; verified replaces — whole storage compared on every refusal', async () => {
  const file = await makeFile({ githubToken: TOKEN2 }, OWN); const store = memoryStore(); const dev = vault(store); await dev.save({ ...V.EMPTY_SECRETS, githubToken: TOKEN }); const before = snapshot(store);
  await assert.rejects(dev.importSecrets(file, OWN, { verifyToken: state('no-access') }), (e) => { assert.match(e.message, /cannot use the configured repository/); assert.match(e.message, /already saved was kept/); assert.ok(![TOKEN, TOKEN2, OWN].some((x) => e.message.includes(x))); return true; });
  await assert.rejects(dev.importSecrets(file, OWN, { verifyToken: state('unverified') }), /could not be reached[\s\S]*already saved on this device, which was kept/); await assert.rejects(dev.importSecrets(file, OWN, { verifyToken: state('rejected') }), /rejected the access token[\s\S]*Nothing was changed/); assert.equal(snapshot(store), before);
  const blank = vault(); await assert.rejects(blank.importSecrets(file, OWN, { verifyToken: state('no-access') }), /cannot use the configured repository/); assert.equal((await blank.load()).githubToken, '');
  const fresh = vault(); const u = await fresh.importSecrets(file, OWN, { verifyToken: state('unverified') }); assert.equal(u.secrets.githubToken, TOKEN2); assert.ok(u.report.warnings.some((w) => /saved anyway/.test(w)), 'nothing to lose, so it is restored — with a warning');
  const both = await makeFile({ githubToken: TOKEN2, aiApiKey: AI }, OWN); const d3 = vault(); await d3.save({ ...V.EMPTY_SECRETS, githubToken: TOKEN }); const r = await d3.importSecrets(both, OWN, { verifyToken: state('no-access') }); assert.equal(r.report.tokenImported, false); assert.equal(r.report.tokenKept, true); assert.equal(r.report.aiKeyImported, true); assert.equal(r.secrets.githubToken, TOKEN); assert.ok(!JSON.stringify(r.report).includes(TOKEN2));
  const ro = await vault().importSecrets(file, OWN, { verifyToken: state('ok', false) }); assert.match(ro.report.warnings[0], /READ-ONLY/); const ok = await dev.importSecrets(file, OWN, { verifyToken: state('ok', true) }); assert.equal(ok.secrets.githubToken, TOKEN2); assert.equal(ok.report.tokenReplaced, true);
});
test('V17.6.1 a wrong passphrase, a corrupted / tampered / empty vault, a vault without a usable token: each refused, nothing changes (whole storage byte-identical), no secret in the message', async () => {
  const file = await makeFile({ githubToken: TOKEN }, OWN); const store = memoryStore(); const dev = vault(store); await dev.save({ ...V.EMPTY_SECRETS, githubToken: TOKEN2 }); const before = snapshot(store); const flipped = JSON.parse(file); flipped.ct = flipped.ct.slice(0, -6) + (flipped.ct.endsWith('AAAAAA') ? 'BBBBBB' : 'AAAAAA');
  for (const [text, pass, re] of [[JSON.stringify(flipped), OWN, /wrong or the data was modified/], [file, 'wrong-passphrase-123', /passphrase is wrong/], [file, 'short', /at least 10 characters/], ['<html>', OWN, /not valid JSON/], ['', OWN, /not valid JSON/], ['{"v":1,"kdf":"PBKDF2-SHA256"}', OWN, /no vault envelope/], [await makeFile({}, OWN), OWN, /contains no GitHub access token/], [await makeFile({ githubToken: 'bad token with spaces 1234567890' }, OWN), OWN, /not valid/]])
    await assert.rejects(dev.importSecrets(text, pass, { verifyToken: state('ok', true) }), (e) => { assert.match(e.message, re); assert.ok(![TOKEN, TOKEN2, OWN, PASS, 'wrong-passphrase-123'].some((x) => e.message.includes(x))); return true; });
  assert.equal(snapshot(store), before, 'every failure left the vault, the saved token and every setting byte-identical');
});

// ───────────────────────────── the whole chain with the real vault code ─────────────────────────────
test('V17.6.1 cross-device chain with NO token on device B: A pushes (own passphrase) → B: anonymous read fails (private) → GitHub sign-in → short-lived token reads the vault → decrypt with the passphrase → token restored (validated) → the sign-in token is nowhere', async () => {
  const hub = GH.memoryRepository(); const A = vault(); await A.save({ ...V.EMPTY_SECRETS, githubToken: TOKEN }); const pushed = await A.exportEncrypted(OWN); await hub.write(VP, pushed, null, 'push');
  assert.ok(!JSON.stringify([...hub.files.values()]).includes(TOKEN) && !pushed.includes(OWN) && !pushed.includes(PASS) && R.validateVaultPayload(pushed).ok, 'only ciphertext in the repository');
  const privateRepo = (who, p, tok) => (tok === SIGNIN && p === VP ? hub.files.get(VP) : null); const gh = fake(privateRepo);
  const first = await R.retrieveVaultFile(base({ makeRepository: gh.make })); assert.equal(first.kind, 'bootstrap-unavailable'); assert.ok(R.SIGN_IN_CAN_HELP.includes(first.kind));
  const f = relay([CODE, { body: { error: 'authorization_pending' } }, { body: { access_token: SIGNIN } }]); const flow = await BA.runDeviceFlow(CFG, () => {}, { fetchFn: f, ...instant }); assert.equal(flow.ok, true);
  const store = memoryStore(); const B = vault(store); assert.equal((await B.load()).githubToken, ''); const before = snapshot(store);
  const got = await R.retrieveVaultAuthorized({ location: LOC, vaultPath: VP, defaultPath: VP, token: flow.token, makeRepository: gh.make }); assert.equal(got.ok, true); assert.equal(R.validateVaultPayload(got.text).ok, true);
  await assert.rejects(B.importSecrets(got.text, PASS, { verifyToken: state('ok', true) }), /passphrase is wrong/); assert.equal(snapshot(store), before, 'the default passphrase does not open a vault pushed with another — nothing saved');
  const checked = []; const r = await B.importSecrets(got.text, OWN, { verifyToken: async (t) => { checked.push(t); return { state: 'ok', canWrite: true, message: 'GitHub accepted the token' }; } }); assert.deepEqual(checked, [TOKEN], 'GitHub is asked about the RESTORED token (not the sign-in token)'); assert.equal(r.secrets.githubToken, TOKEN);
  const all = [...store.keys()].map((k) => store.get(k) || '').join('|'); for (const s of [TOKEN, SIGNIN, OWN, DEVICE]) assert.ok(!all.includes(s), 'browser storage holds only ciphertext — the sign-in token and device code were never stored');
  assert.ok(!JSON.stringify(r.report).includes(SIGNIN) && !JSON.stringify(r.report).includes(TOKEN)); assert.equal(await B.verifyEncrypted(got.text, OWN), true, 'B holds exactly what A pushed');
});

// ───────────────────────────── the relay (real HTTP against a stub of github.com) ─────────────────────────────
async function withRelay(fn, env = {}) {
  const calls = []; const stub = http.createServer((req, res) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { const body = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString())); calls.push({ url: req.url, body, accept: req.headers.accept, ctype: req.headers['content-type'], auth: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/login/device/code') return res.end(JSON.stringify({ device_code: DEVICE, user_code: USERCODE, verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5, extra_field: 'x', nested: { a: 1 } }));
    if (req.url === '/login/oauth/access_token') return res.end(JSON.stringify(body.device_code === DEVICE ? { access_token: SIGNIN, token_type: 'bearer', scope: '', refresh_token: 'ghr_secretrefresh', refresh_token_expires_in: 1, expires_in: 28800 } : { error: 'authorization_pending' }));
    res.end('{}'); }); });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${stub.address().port}`;
  const writes = []; const ow = process.stdout.write.bind(process.stdout), ew = process.stderr.write.bind(process.stderr); process.stdout.write = (c, ...a) => { writes.push(String(c)); return ow(c, ...a); }; process.stderr.write = (c, ...a) => { writes.push(String(c)); return ew(c, ...a); };
  const srv = createRelay({ ALLOWED_CLIENT_IDS: CLIENT, ALLOWED_ORIGINS: 'https://tools.example.org', GITHUB_BASE: base, ...env }); await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${srv.address().port}`;
  const post = (path, body, origin = 'https://tools.example.org', raw) => fetch(`${url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: raw ?? JSON.stringify(body) });
  try { await fn({ url, post, calls, writes }); } finally { process.stdout.write = ow; process.stderr.write = ew; await new Promise((r) => srv.close(r)); await new Promise((r) => stub.close(r)); }
}
test('V17.6.1 relay: forwards ONLY the two device-flow requests, adds the grant type itself, passes on only the whitelisted fields (no refresh token), CORS only for the allowed origin, holds no secret and logs nothing', async () => {
  await withRelay(async ({ url, post, calls, writes }) => {
    let r = await post('/device/code', { client_id: CLIENT }); assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), 'https://tools.example.org'); assert.equal(r.headers.get('cache-control'), 'no-store'); const j = await r.json();
    assert.deepEqual(Object.keys(j).sort(), ['device_code', 'expires_in', 'interval', 'user_code', 'verification_uri'], 'unknown and nested fields are dropped'); assert.deepEqual(calls[0].body, { client_id: CLIENT }); assert.equal(calls[0].url, '/login/device/code'); assert.equal(calls[0].accept, 'application/json'); assert.ok(!calls[0].auth);
    r = await post('/device/token', { client_id: CLIENT, device_code: DEVICE }); const t = await r.json(); assert.deepEqual(Object.keys(t).sort(), ['access_token', 'expires_in', 'scope', 'token_type'], 'the refresh token is NOT passed on'); assert.equal(t.access_token, SIGNIN);
    assert.deepEqual(calls[1].body, { client_id: CLIENT, device_code: DEVICE, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }); assert.equal(calls[1].url, '/login/oauth/access_token'); assert.equal(calls.length, 2);
    r = await post('/device/token', { client_id: CLIENT, device_code: 'dc_otherotherotherother' }); assert.equal((await r.json()).error, 'authorization_pending');
    r = await fetch(`${url}/device/code`, { method: 'OPTIONS', headers: { Origin: 'https://tools.example.org', 'Access-Control-Request-Method': 'POST' } }); assert.equal(r.status, 204); assert.match(r.headers.get('access-control-allow-headers'), /Content-Type/); assert.equal(r.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
    r = await fetch(`${url}/healthz`); assert.deepEqual(await r.json(), { ok: true });
    for (const s of [SIGNIN, DEVICE, CLIENT, USERCODE, 'ghr_secretrefresh']) assert.ok(!writes.join('').includes(s), 'the relay printed nothing about the exchange'); assert.ok(!/client_secret/i.test(readFileSync(new URL('../scripts/github-device-relay.mjs', import.meta.url), 'utf8').replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')), 'no client secret anywhere in the relay');
  });
});
test('V17.6.1 relay refuses: an origin that is not allow-listed (no CORS header), a missing origin, an unknown client ID, a malformed device code, other paths and methods, oversized or invalid bodies, and floods — and answers nothing it was not asked', async () => {
  await withRelay(async ({ url, post, calls }) => {
    for (const [origin, st] of [['https://evil.example', 403], [null, 403], ['http://tools.example.org', 403]]) { const r = await post('/device/code', { client_id: CLIENT }, origin); assert.equal(r.status, st, String(origin)); assert.equal(r.headers.get('access-control-allow-origin'), null); }
    assert.equal((await post('/device/code', { client_id: 'Iv1.someoneelsesapp' })).status, 403); assert.equal((await post('/device/token', { client_id: CLIENT, device_code: 'x' })).status, 400); assert.equal((await post('/device/token', { client_id: CLIENT })).status, 400); assert.equal((await post('/device/token', { client_id: CLIENT, device_code: 'a b c d e f g h i' })).status, 400);
    assert.equal((await post('/device/code', null, undefined, '{ bad json')).status, 400); assert.equal((await post('/device/code', { client_id: CLIENT, pad: 'x'.repeat(5000) })).status, 413);
    assert.equal((await post('/login/oauth/authorize', { client_id: CLIENT })).status, 404); assert.equal((await fetch(`${url}/device/code`, { headers: { Origin: 'https://tools.example.org' } })).status, 404); assert.equal(calls.length, 0, 'none of that reached GitHub');
  });
  await withRelay(async ({ post }) => { const rs = []; for (let i = 0; i < 5; i++) rs.push((await post('/device/code', { client_id: CLIENT })).status); assert.deepEqual(rs, [200, 200, 429, 429, 429]); }, { RATE_LIMIT_PER_MINUTE: '2' });
  assert.throws(() => createRelay({ ALLOWED_ORIGINS: 'https://a.example' }), /ALLOWED_CLIENT_IDS/); assert.throws(() => createRelay({ ALLOWED_CLIENT_IDS: CLIENT }), /ALLOWED_ORIGINS/); assert.throws(() => createRelay({ ALLOWED_CLIENT_IDS: 'x', ALLOWED_ORIGINS: 'https://a.example' }), /ALLOWED_CLIENT_IDS/);
  assert.throws(() => createRelay({ ALLOWED_CLIENT_IDS: CLIENT, ALLOWED_ORIGINS: 'https://a.example', GITHUB_BASE: 'https://evil.example' }), /GITHUB_BASE/); assert.throws(() => createRelay({ ALLOWED_CLIENT_IDS: CLIENT, ALLOWED_ORIGINS: 'https://a.example/path' }), /ALLOWED_ORIGINS/);
});
test('V17.6.1 the browser device flow works end to end against the real relay (relay → stub of github.com): code, pending, approval, token', async () => {
  await withRelay(async ({ url }) => { let n = 0; const f = async (u, i) => { const b = JSON.parse(i.body); if (String(u).endsWith('/device/token') && ++n < 2) b.device_code = 'dc_notyetapprovednotyet'; return fetch(u, { ...i, headers: { ...i.headers, Origin: 'https://tools.example.org' }, body: JSON.stringify(b) }); };
    let shown; const r = await BA.runDeviceFlow({ clientId: CLIENT, relayUrl: url }, (c) => { shown = c; }, { fetchFn: f, sleep: async () => {}, now: () => Date.now() }); assert.deepEqual(r, { ok: true, token: SIGNIN }); assert.equal(shown.userCode, USERCODE); assert.equal(shown.verificationUri, 'https://github.com/login/device'); });
});

// ───────────────────────────── source guarantees ─────────────────────────────
test('V17.6.1 source guarantees: no credential or client ID in source or bundle; the sign-in and retrieval modules hold no crypto / storage / vault code; the card never stores or shows the sign-in token; the default passphrase is defined once; push is untouched', () => {
  const bundle = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8'); assert.ok(!/\bghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|\bghu_[A-Za-z0-9]{20,}/.test(bundle) && ![TOKEN, TOKEN2, SIGNIN, OWN, CLIENT, DEVICE].some((s) => bundle.includes(s))); assert.equal(bundle.split(PASS).length - 1, 1, 'the default passphrase is defined exactly once (preserved, not duplicated)');
  assert.match(bundle, /connect-src 'self' https:/); assert.ok(bundle.includes('vault-bootstrap.config.json') && bundle.includes('/login/'));
  const ba = src('v17/services/bootstrapAuth.ts'); assert.ok(!/cryptoBox|secretVault|decryptWith|encryptWith|localStorage|sessionStorage|indexedDB|console\.|document\./.test(ba), 'no crypto, storage, vault or DOM code in the sign-in module'); assert.ok(!/ghp_|github_pat_|client_secret|Authorization/.test(ba.replace(/^\s*\*.*$/gm, '')));
  const rv = src('v17/services/vaultRetrieval.ts'); assert.ok(!/decryptWithPassphrase|encryptWithPassphrase|from '\.\/cryptoBox'|passwordService|localStorage|store\.set/.test(rv), 'retrieval only returns ciphertext'); assert.ok(!/Authorization|Bearer|ghp_|github_pat_/.test(rv));
  assert.ok(!/from '\.\/githubClient'|vaultRetrieval|bootstrapAuth|fetch\(/.test(src('v17/services/secretVault.ts')), 'the vault holds no network code');
  const card = src('ui/pages/schemaRepoCards.ts'); assert.ok(/runDeviceFlow\(/.test(card) && /retrieveVaultAuthorized\(/.test(card) && /validateVaultPayload\(/.test(card)); assert.ok(!/pushVaultBtn|exportEncrypted|\.write\(/.test(card), 'import never pushes');
  const tail = card.slice(card.indexOf('const signIn =')); assert.ok(!/localStorage|sessionStorage|store\.set|vault\.save|writeJson|console\./.test(tail.slice(0, tail.indexOf('btn.addEventListener'))), 'the sign-in token is only held in a local variable'); assert.ok(/tok = '';\s*transient = \[\]/.test(card), 'and is dropped after the read');
  assert.equal((card.match(/DEFAULT_VAULT_PASSPHRASE/g) || []).length, 3, 'the default is imported, pre-filled (as in V17.5.7) and — V17.6.3, deliberate change — used once by the token auto-population of Card 1 to open a published central vault'); assert.ok(/inp\.value = DEFAULT_VAULT_PASSPHRASE;\s*\/\/ assigned as a property/.test(card)); assert.equal(D.DEFAULT_VAULT_PASSPHRASE, PASS);
  for (const f of ['v17/services/cryptoBox.ts', 'v17/services/githubClient.ts', 'v17/services/repositoryConfig.ts', 'v17/sync/syncService.ts', 'v17/services/repositoryDefaults.ts']) assert.ok(!/17\.6\.1/.test(src(f)), `${f} is untouched`);
  assert.ok(!/console\.(log|info|debug|warn|error)/.test(card + ba + rv));
});
