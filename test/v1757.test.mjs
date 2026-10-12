import { test } from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
import { imp } from './helpers.mjs';
const { memoryStore, KEYS } = await imp('services/storage.js'); const V = await imp('v17/services/secretVault.js'); const C = await imp('v17/services/cryptoBox.js'); const GH = await imp('v17/services/githubClient.js');
const RC = await imp('v17/services/repositoryConfig.js'); const D = await imp('v17/services/repositoryDefaults.js'); const F = await imp('v17/sync/schemaFormat.js');
const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'; const TOKEN2 = 'github_pat_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4'; const AI = 'sk-test-' + 'abcdefghijklmnopqrstuvwxyz0123456789'; const PASS = 'xG71lfp1NHZVZ4WVWCPe';
const vault = (store = memoryStore(), keys = C.memoryKeyProvider()) => new V.SecretVault(store, keys);
const exportFrom = async (secrets, pass = PASS) => { const v = vault(); await v.save({ ...V.EMPTY_SECRETS, ...secrets }); return v.exportEncrypted(pass); };
const GOOD = { owner: 'acme', repo: 'sql-assistant', branch: 'release/2026', schemaPath: 'data/schemas/registry.json' };
const ok = (canWrite = true) => async () => ({ state: 'ok', canWrite, message: 'GitHub accepted the token.' }); const state = (s) => async () => ({ state: s, canWrite: null, message: `state ${s}` });

test('V17.5.7 (kept) the application version is stamped consistently: package.json = APP_VERSION', () => { assert.equal(F.APP_VERSION, JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version); });

test('V17.5.7 centralized repository configuration: defaults, validation, authorization in the service, persistence, tamper handling', async () => {
  assert.deepEqual(RC.DEFAULT_REPOSITORY, { owner: 'basware', repo: 'sk-ap-sql-assistant', branch: 'main', schemaPath: 'sql-assistant-data/schemas/registry.json' }); assert.deepEqual(RC.loadRepositoryConfig(memoryStore()), { config: RC.DEFAULT_REPOSITORY, custom: false, problem: null });
  const bad = (over, re) => { const p = RC.validateRepositoryConfig({ ...GOOD, ...over }); assert.ok(p.some((x) => re.test(x)), `${JSON.stringify(over)} → ${p.join(' | ')}`); };
  bad({ owner: '' }, /Repository/); bad({ owner: '-a' }, /owner/); bad({ repo: 'x.git' }, /name/); bad({ repo: 'a b' }, /name/); for (const b of ['', 'a b', 'a..b', '/x', 'x/', '.x', 'x.lock', 'a~b', 'a:b', 'a*b', '@', 'a@{b', '-x']) bad({ branch: b }, /Branch/);
  for (const p of ['', '/abs/r.json', 'a/../r.json', 'a//r.json', 'r.txt', 'folder/', 'a b/r.json', './r.json', 'x/registry.enc.json']) bad({ schemaPath: p }, /Schema file path/); assert.deepEqual(RC.validateRepositoryConfig(GOOD), []);
  const st = memoryStore(); for (const pw of ['', 'wrong', undefined, null]) { const r = await RC.saveRepositoryConfig(st, GOOD, pw); assert.equal(r.ok, false); assert.equal(r.kind, 'unauthorized'); } assert.equal(st.get(KEYS.repoConfig), null);
  assert.equal((await RC.saveRepositoryConfig(st, GOOD, 'x', { verify: async () => { throw new Error('boom'); } })).ok, false, 'a failing verifier denies');
  const r = await RC.saveRepositoryConfig(st, { ...GOOD, owner: ' acme ' }, 'admin'); assert.equal(r.ok, true); assert.deepEqual(RC.loadRepositoryConfig(st).config, GOOD); const raw = st.get(KEYS.repoConfig); assert.ok(!/token|ghp_|password/i.test(raw));
  const kept = raw; assert.equal((await RC.saveRepositoryConfig(st, { ...GOOD, repo: 'o' }, 'admin', { liveCheck: async () => ({ refuse: 'not found', notes: [] }) })).kind, 'unverified'); assert.equal(st.get(KEYS.repoConfig), kept);
  assert.equal((await RC.saveRepositoryConfig(st, RC.DEFAULT_REPOSITORY, 'admin')).custom, false); assert.equal(st.get(KEYS.repoConfig), null);
  for (const junk of ['not json', '{"owner":"a b"}', '[]', '{"owner":"x","repo":"y","branch":"main","schemaPath":"../../etc/passwd"}']) { const l = RC.loadRepositoryConfig(memoryStore({ [KEYS.repoConfig]: junk })); assert.deepEqual(l.config, RC.DEFAULT_REPOSITORY); assert.equal(l.custom, false); }
});

test('V17.5.7 ONE configuration: the vault applies it on every read, so push validation, export and verification can never disagree with schema synchronization', async () => {
  const v = vault(); await v.save({ ...V.EMPTY_SECRETS, githubOwner: 'stale', githubRepo: 'old', githubBranch: 'old', schemaPath: 'old/registry.json', githubToken: TOKEN }); let cfg = { ...GOOD }; v.setLocator((s) => RC.applyRepositoryConfig(s, cfg));
  let s = await v.load(); assert.deepEqual([s.githubOwner, s.githubRepo, s.githubBranch, s.schemaPath, s.githubToken], ['acme', 'sql-assistant', 'release/2026', 'data/schemas/registry.json', TOKEN]);
  cfg = { ...cfg, branch: 'changed' }; assert.equal((await v.load()).githubBranch, 'changed'); assert.deepEqual(await v.validateForPush(PASS, PASS), []); cfg = { ...cfg, branch: ' ' }; assert.ok((await v.validateForPush(PASS, PASS)).some((x) => /Branch is required/.test(x)));
});

test('V17.5.7 token validation (separate from crypto and authentication): ok / read-only / unknown permission / rejected / no access / unreachable — never echoes the token', async () => {
  const real = globalThis.fetch; const seen = []; const j = (st, b = {}) => new Response(JSON.stringify(b), { status: st }); const cfg = { owner: 'acme', repo: 'x', token: TOKEN };
  try {
    const run = async (handler) => { globalThis.fetch = async (u, i = {}) => { seen.push({ u: String(u), h: i.headers }); return handler(String(u)); }; return GH.validateTokenAccess(cfg); };
    let r = await run(() => j(200, { permissions: { push: true } })); assert.deepEqual([r.state, r.canWrite], ['ok', true]); assert.match(r.message, /read and write/); assert.equal(seen.at(-1).u, 'https://api.github.com/repos/acme/x'); assert.equal(seen.at(-1).h.Authorization, `Bearer ${TOKEN}`);
    r = await run(() => j(200, { permissions: { push: false, pull: true } })); assert.deepEqual([r.state, r.canWrite], ['ok', false]); assert.match(r.message, /READ-ONLY/);
    r = await run(() => j(200, { permissions: { admin: true } })); assert.equal(r.canWrite, true); r = await run(() => j(200, {})); assert.deepEqual([r.state, r.canWrite], ['ok', null]); assert.match(r.message, /could not be determined/);
    r = await run(() => j(401)); assert.equal(r.state, 'rejected'); for (const st of [403, 404, 429]) { r = await run(() => j(st)); assert.equal(r.state, 'no-access'); } r = await run(() => j(500)); assert.equal(r.state, 'unverified');
    r = await run(() => { throw new Error(`socket closed for ${TOKEN}`); }); assert.equal(r.state, 'unverified'); assert.ok(!r.message.includes(TOKEN), 'redacted');
    globalThis.fetch = (u, i) => new Promise((_, rej) => i.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))); GH.setRepositoryTimeoutMs(60); r = await GH.validateTokenAccess(cfg); assert.equal(r.state, 'unverified'); assert.match(r.message, /did not answer/); GH.setRepositoryTimeoutMs(20000);
    assert.equal((await GH.validateTokenAccess({ owner: 'a b', repo: 'x', token: TOKEN })).state, 'unverified'); assert.equal((await GH.validateTokenAccess({ owner: 'a', repo: 'x', token: '' })).state, 'unverified');
  } finally { globalThis.fetch = real; }
});

test('V17.5.7 Device B: importing a Secret Vault restores the GitHub token with NO token set first; it is persisted encrypted, never in a report; import never writes to a repository', async () => {
  const file = await exportFrom({ githubToken: TOKEN, aiApiKey: AI }); const dev = vault(); assert.equal((await dev.load()).githubToken, '');
  const { secrets, report } = await dev.importSecrets(file, PASS, { verifyToken: ok(true) }); assert.equal(secrets.githubToken, TOKEN); assert.equal(secrets.aiApiKey, AI); assert.equal(report.tokenImported, true); assert.equal(report.access.state, 'ok'); assert.deepEqual(report.warnings, []);
  assert.ok(!JSON.stringify(report).includes(TOKEN) && !JSON.stringify(report).includes(AI)); assert.deepEqual(dev.knownSecrets().sort(), [AI, TOKEN].sort());
  const store2 = memoryStore(); const keys = C.memoryKeyProvider(); await vault(store2, keys).importEncrypted(file, PASS); assert.ok(!JSON.stringify(store2.keys().map((k) => store2.get(k))).includes(TOKEN), 'encrypted at rest'); assert.equal((await vault(store2, keys).load()).githubToken, TOKEN, 'a restart reads it back');
});

test('V17.5.7 a token that is empty, invalid, or REJECTED BY GITHUB never replaces a saved token; unusable vaults are refused with a clear message and change nothing', async () => {
  const dev = vault(); await dev.save({ ...V.EMPTY_SECRETS, githubToken: TOKEN }); const snap = async () => JSON.stringify(await dev.load());
  const noTok = await exportFrom({ aiApiKey: AI }); const r1 = await dev.importSecrets(noTok, PASS); assert.equal(r1.secrets.githubToken, TOKEN); assert.equal(r1.report.tokenKept, true); assert.match(r1.report.warnings.join(' '), /no GitHub access token/);
  const was = await snap(); await assert.rejects(dev.importSecrets(await exportFrom({}), PASS), /no GitHub access token and no AI\/LLM API key\. Nothing was changed/);
  await assert.rejects(dev.importSecrets(await exportFrom({ githubToken: 'ghp_ with spaces inside the token value 123456' }), PASS), /not valid[\s\S]*Nothing was changed/); await assert.rejects(dev.importSecrets(await exportFrom({ githubToken: 'short' }), PASS), /not valid/);
  const rej = await exportFrom({ githubToken: TOKEN2 }); await assert.rejects(dev.importSecrets(rej, PASS, { verifyToken: state('rejected') }), /GitHub rejected the access token[\s\S]*recovery is not possible[\s\S]*already saved was kept/); assert.equal((await dev.load()).githubToken, TOKEN); assert.ok(!(await snap()).includes(TOKEN2));
  const rejAi = await exportFrom({ githubToken: TOKEN2, aiApiKey: AI }); const r2 = await dev.importSecrets(rejAi, PASS, { verifyToken: state('rejected') }); assert.equal(r2.secrets.githubToken, TOKEN); assert.equal(r2.report.tokenRejected, true); assert.equal(r2.secrets.aiApiKey, AI); assert.match(r2.report.warnings.join(' '), /rejected/); assert.ok(!r2.report.warnings.join(' ').includes(TOKEN2));
  const fresh = vault(); await assert.rejects(fresh.importSecrets(rej, PASS, { verifyToken: state('rejected') }), /recovery is not possible/); assert.equal((await fresh.load()).githubToken, '', 'nothing stored on a device that had no token');
  { const f2 = vault(); const r = await f2.importSecrets(rej, PASS, { verifyToken: state('unverified') }); assert.equal(r.secrets.githubToken, TOKEN2, 'unverified: saved when nothing is saved yet'); assert.ok(r.report.warnings.some((w) => w.includes('state unverified'))); }
  // V17.6.1 (deliberate change — "insufficiently privileged tokens are rejected safely"): a token GitHub accepts but that cannot use the repository is NOT restored (V17.5.7 saved it with a warning).
  { const f3 = vault(); await assert.rejects(f3.importSecrets(rej, PASS, { verifyToken: state('no-access') }), /cannot use the configured repository/); assert.equal((await f3.load()).githubToken, '', 'no-access: nothing restored'); }
  const ro = vault(); const rr = await ro.importSecrets(rej, PASS, { verifyToken: ok(false) }); assert.equal(rr.secrets.githubToken, TOKEN2); assert.ok(rr.report.warnings.length === 1, 'a read-only token is saved with a warning');
  const throwing = await vault().importSecrets(rej, PASS, { verifyToken: async () => { throw new Error('boom'); } }); assert.equal(throwing.secrets.githubToken, TOKEN2, 'a failing check does not block the import');
  const replaced = await dev.importSecrets(await exportFrom({ githubToken: TOKEN2 }), PASS, { verifyToken: ok() }); assert.equal(replaced.secrets.githubToken, TOKEN2); assert.equal(replaced.report.tokenReplaced, true);
});

test('V17.5.7 invalid encrypted files fail gracefully with specific messages that contain no secret and leave the device vault untouched', async () => {
  const file = await exportFrom({ githubToken: TOKEN }); const dev = vault(); await dev.save({ ...V.EMPTY_SECRETS, githubToken: TOKEN2 }); const was = JSON.stringify(await dev.load()); const msgs = [];
  for (const [text, pass, re] of [['not json at all', PASS, /not valid JSON/], ['[]', PASS, /not an encrypted SQL Assistant Secret Vault/], ['{"schemas":[]}', PASS, /no vault envelope/], [file, 'wrong-passphrase-123', /wrong or the data was modified/], ['', PASS, /not valid JSON/]]) { try { await dev.importSecrets(text, pass); assert.fail('accepted'); } catch (e) { if (e.code === 'ERR_ASSERTION') throw e; assert.match(e.message, re); msgs.push(e.message); } }
  assert.ok(msgs.every((m) => !m.includes(TOKEN) && !m.includes(TOKEN2) && !m.includes(PASS))); assert.equal(JSON.stringify(await dev.load()), was);
  const flipped = JSON.parse(file); flipped.ct = flipped.ct.slice(0, -4) + (flipped.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA'); await assert.rejects(dev.importSecrets(JSON.stringify(flipped), PASS), /wrong or the data was modified/); assert.equal(JSON.stringify(await dev.load()), was, 'a tampered ciphertext is rejected');
  assert.equal((await dev.importSecrets(file, PASS)).secrets.githubToken, TOKEN, 'a good file still imports afterwards');
});

test('V17.5.7 a vault from a device whose key is gone is backed up, not destroyed; V17.2 vaults import through the same merge', async () => {
  const store = memoryStore(); await vault(store, C.memoryKeyProvider()).save({ ...V.EMPTY_SECRETS, githubToken: TOKEN2 }); const B = vault(store, C.memoryKeyProvider()); await assert.rejects(B.load(), /device key/);
  const r = await B.importSecrets(await exportFrom({ githubToken: TOKEN }), PASS); assert.equal(r.secrets.githubToken, TOKEN); assert.equal(r.report.deviceVaultWasUnreadable, true); assert.ok(store.keys().some((k) => k.includes('unreadable-')));
  const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12)); const b = (u) => btoa(String.fromCharCode(...u)); const aad = 'sqla-vault-sync|v2'; const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASS), 'PBKDF2', false, ['deriveKey']); const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310000 }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad), tagLength: 128 }, key, new TextEncoder().encode(JSON.stringify({ githubRepo: 'acme/x', githubBranch: 'main', githubToken: TOKEN, llmApiKey: AI })))); const env = { format: 'sqla-vault-sync', version: 2, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 310000, salt: b(salt) }, cipher: { name: 'AES-GCM', iv: b(iv) }, aad, ciphertext: b(ct) };
  const r2 = await vault().importSecrets(JSON.stringify(env), PASS); assert.equal(r2.secrets.githubToken, TOKEN); assert.equal(r2.secrets.aiApiKey, AI);
});

test('V17.5.7 a crafted vault cannot redirect a later push: its vault path is ignored, and the push refuses a vault path that would overwrite another synchronized file', async () => {
  const evil = await exportFrom({ githubToken: TOKEN, vaultPath: 'sql-assistant-data/schemas/registry.json' }); const dev = vault(); const r = await dev.importSecrets(evil, PASS); assert.equal(r.secrets.vaultPath, V.EMPTY_SECRETS.vaultPath, 'the device keeps its own vault path');
  const v = vault(); v.setLocator((s) => RC.applyRepositoryConfig(s, RC.DEFAULT_REPOSITORY));
  for (const vp of ['sql-assistant-data/schemas/registry.json', 'sql-assistant-data/schemas/registry.enc.json', 'sql-assistant-data/schemas/other.json', 'sql-assistant-data/knowledge/knowledge.json', 'sql-assistant-data/messages/admin-message.json', 'sql-assistant-data/vault/vault.txt']) { await v.save({ ...V.EMPTY_SECRETS, githubToken: TOKEN, vaultPath: vp }); assert.ok((await v.validateForPush(PASS, PASS)).some((x) => /can never overwrite another synchronized file/.test(x)), vp); }
  await v.save({ ...V.EMPTY_SECRETS, githubToken: TOKEN }); assert.deepEqual(await v.validateForPush(PASS, PASS), [], 'the default vault path is fine'); await v.save({ ...V.EMPTY_SECRETS, githubToken: TOKEN, vaultPath: 'ops/vault/my-vault.json' }); assert.deepEqual(await v.validateForPush(PASS, PASS), []);
});

test('V17.5.7 push safety and passphrase honesty: compareWithRemote, the default passphrase is recognised, a vault is ciphertext only', async () => {
  const remote = await exportFrom({ githubToken: TOKEN, aiApiKey: AI }); const dev = vault(); await dev.save({ ...V.EMPTY_SECRETS, githubToken: TOKEN });
  assert.deepEqual(await dev.compareWithRemote(remote, PASS), { readable: true, wouldRemove: ['AI/LLM API key'] }); assert.deepEqual(await dev.compareWithRemote(remote, 'another-passphrase-1'), { readable: false, wouldRemove: [] }); assert.deepEqual(await dev.compareWithRemote('garbage', PASS), { readable: false, wouldRemove: [] });
  assert.equal(D.isDefaultVaultPassphrase(PASS), true); assert.equal(D.isDefaultVaultPassphrase(PASS + 'x'), false); assert.equal(D.DEFAULT_VAULT_PASSPHRASE, 'xG71lfp1NHZVZ4WVWCPe');
  const out = await dev.exportEncrypted(PASS); assert.ok(!out.includes(TOKEN) && !out.includes(Buffer.from(TOKEN).toString('base64')) && !out.includes(PASS)); assert.deepEqual(Object.keys(JSON.parse(out)).sort(), ['alg', 'ct', 'iter', 'iv', 'kdf', 'salt', 'v']);
});

test('V17.5.7 full two-device recovery through an emulated repository: A pushes the encrypted vault, B (no token) imports it, B pulls with the restored token; the repository never holds the token or the passphrase in clear', async () => {
  const repo = GH.memoryRepository(); const A = vault(); await A.save({ ...V.EMPTY_SECRETS, githubToken: TOKEN }); const text = await A.exportEncrypted('my-own-vault-passphrase-1'); await repo.write(V.EMPTY_SECRETS.vaultPath, text, null, 'push');
  const stored = JSON.stringify([...repo.files.values()]); assert.ok(!stored.includes(TOKEN) && !stored.includes('my-own-vault-passphrase-1'));
  const B = vault(); assert.equal((await B.load()).githubToken, ''); const f = await repo.read(V.EMPTY_SECRETS.vaultPath);
  await assert.rejects(B.importSecrets(f.text, PASS), /wrong or the data was modified/, 'the default passphrase does not open a vault pushed with another one'); assert.equal((await B.load()).githubToken, '');
  const r = await B.importSecrets(f.text, 'my-own-vault-passphrase-1', { verifyToken: ok(true) }); assert.equal(r.secrets.githubToken, TOKEN); assert.equal(await B.verifyEncrypted(f.text, 'my-own-vault-passphrase-1'), true, 'B now holds exactly what A pushed');
  const calls = []; const spy = { ...repo, read: async (p) => { calls.push(p); return repo.read(p); } }; await spy.read('x'); assert.equal(calls.length, 1);
});

const withFetch = async (handler, fn) => { const real = globalThis.fetch; const seen = []; globalThis.fetch = async (url, init = {}) => { seen.push({ url: String(url), headers: init.headers || {} }); return handler(String(url), init); }; try { return await fn(seen); } finally { globalThis.fetch = real; } };
const json = (status, body = {}) => new Response(JSON.stringify(body), { status });
test('V17.5.7 live location check and anonymous read', async () => {
  const cfg = { owner: 'acme', repo: 'x', branch: 'release/2026', token: TOKEN, path: 'data/registry.json' };
  await withFetch((u) => (u.endsWith('/repos/acme/x') ? json(200) : u.includes('/branches/release/2026') ? json(200) : json(200, { sha: 's' })), async (seen) => { const r = await GH.checkRepositoryLocation(cfg); assert.equal(r.ok, true); assert.equal(seen.length, 3); });
  await withFetch((u) => (u.includes('/contents/') ? json(404) : json(200)), async () => { const r = await GH.checkRepositoryLocation(cfg); assert.equal(r.ok, true); assert.equal(r.fileExists, false); });
  await withFetch((u) => (u.endsWith('/repos/acme/x') ? json(404) : json(200)), async () => assert.match((await GH.checkRepositoryLocation(cfg)).message, /repository was not found/)); await withFetch((u) => (u.includes('/branches/') ? json(404) : json(200)), async () => assert.equal((await GH.checkRepositoryLocation(cfg)).kind, 'branch'));
  for (const st of [401, 403, 429, 500]) await withFetch(() => json(st), async () => { const r = await GH.checkRepositoryLocation(cfg); assert.equal(r.ok, false); assert.ok(!r.message.includes(TOKEN)); });
  const body = { content: btoa('{}'), sha: 'abc', encoding: 'base64' };
  await withFetch(() => json(200, body), async (seen) => { await GH.githubRepository({ owner: 'acme', repo: 'x', branch: 'main', token: '' }).read('a/b.json'); assert.equal('Authorization' in seen[0].headers, false); }); await withFetch(() => json(200, body), async (seen) => { await GH.githubRepository({ owner: 'acme', repo: 'x', branch: 'main', token: TOKEN }).read('a/b.json'); assert.equal(seen[0].headers.Authorization, `Bearer ${TOKEN}`); });
});

test('V17.5.7 source guarantees: no credential in the bundle, no passphrase UI in the Pull Schema card, push only in Settings, no hard-wired repository in UI code, admin check only through the service', () => {
  const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8'); const bundle = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.ok(!bundle.includes('Set the GitHub access token (card above) first')); assert.ok(bundle.includes('You do not have to set the token first')); assert.ok(!/\bghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/.test(bundle) && !bundle.includes(TOKEN) && !bundle.includes(TOKEN2));
  const pull = read('ui/pages/schemaPull.ts'); const card = pull.slice(pull.indexOf('function renderPullPanel'), pull.indexOf('/** Schema → Pull Schema = the repository card')); assert.ok(!/<input|passphrase|syncStatusHtml|pull-help/i.test(card)); assert.equal((card.match(/<button/g) || []).length, 1);
  const cards = read('ui/pages/schemaRepoCards.ts'); assert.ok(!/pushVaultBtn|exportEncrypted|\.write\(/.test(cards)); const set = read('ui/pages/settings.ts'); assert.equal((set.match(/exportEncrypted/g) || []).length, 1);
  for (const f of ['ui/pages/settings.ts', 'ui/pages/schemaRepoCards.ts', 'ui/pages/schemaPull.ts', 'ui/context.ts']) assert.ok(!/LOCKED_REPOSITORY|withLockedLocation/.test(read(f)), f);
  assert.ok(/saveRepositoryConfig\(/.test(cards) && !/store\.set\(KEYS\.repoConfig|writeJson\([^)]*repoConfig/.test(cards));
  assert.ok(!/from '\.\/githubClient'|fetch\(/.test(read('v17/services/secretVault.ts')), 'the vault holds no network code'); assert.ok(!/from '\.\/cryptoBox'|from '\.\.\/\.\.\/services\/passwordService'|verifyPassword\(/.test(read('v17/services/githubClient.ts')), 'the client holds no crypto or authentication');
});
