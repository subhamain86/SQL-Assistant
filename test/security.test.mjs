import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imp } from './helpers.mjs';
const C = await imp('v17/services/cryptoBox.js');
const { SecretVault } = await imp('v17/services/secretVault.js');
const { memoryStore } = await imp('services/storage.js');
const { GitHubClient } = await imp('v17/services/githubClient.js');
const AI = await imp('v17/services/aiLlmService.js');
const { redactSecrets } = await imp('v17/errors/appErrors.js');
const { generateFromDescription } = await imp('v17/services/queryOrchestrator.js');
const { CORE_SCHEMA } = await imp('data/defaultSchemas.js');
const { emptyReadOnly } = await imp('state/store.js');
const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
test('Secret Vault: save → encrypt → push → retrieve → decrypt → validate', async () => {
  const store = memoryStore(); const v = new SecretVault(store, C.memoryKeyProvider());
  await v.save({ githubToken: TOKEN, githubRepo: 'org/repo', githubBranch: 'main', schemaPath: 's.json', vaultPath: 'v.json', aiApiKey: 'sk-test-1234567890abcdefgh' });
  const local = store.get('sqla.vault.local.v17'); assert.ok(local); assert.ok(!local.includes(TOKEN)); assert.ok(!local.includes('org/repo'));
  const pushed = await v.exportEncrypted('correct horse battery');
  assert.ok(!pushed.includes(TOKEN)); assert.ok(!/ghp_|sk-test/.test(pushed)); const env = JSON.parse(pushed);
  assert.equal(env.alg, 'AES-256-GCM'); assert.equal(env.kdf, 'PBKDF2-SHA256'); assert.ok(env.iter >= 310000); assert.ok(!('key' in env));
  const other = new SecretVault(memoryStore(), C.memoryKeyProvider());
  const got = await other.importEncrypted(pushed, 'correct horse battery'); assert.equal(got.githubToken, TOKEN);
  await assert.rejects(other.importEncrypted(pushed, 'wrong passphrase!!'), /wrong or the data was modified/);
  const tampered = JSON.parse(pushed); tampered.ct = tampered.ct.slice(0, -4) + (tampered.ct.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
  await assert.rejects(other.importEncrypted(JSON.stringify(tampered), 'correct horse battery'));
  await assert.rejects(C.encryptWithPassphrase('x', 'short'), /at least 10/);
  assert.ok(!v.knownSecrets().length === false);
});
test('Secrets never appear in errors (GitHub client, AI/LLM, redaction)', async () => {
  const gh = new GitHubClient({ token: TOKEN, repo: 'o/r', branch: 'main' }, async () => new Response(`Bad credentials for ${TOKEN}`, { status: 401 }));
  await assert.rejects(gh.get('x.json'), (e) => !e.message.includes(TOKEN) && /invalid or expired/.test(e.message));
  const key = 'sk-live-abcdefghijklmnop1234';
  const r = await AI.requestSqlFromModel({ ...AI.DEFAULT_AI_CONFIG, enabled: true, model: 'm', endpoint: 'https://x.test/v1' }, key, 'q', 's', async () => { throw new Error(`connect failed with ${key}`); });
  assert.ok('error' in r); assert.ok(!JSON.stringify(r).includes(key));
  assert.equal(redactSecrets(`token ${TOKEN} and Bearer abcdefghijklmnopqrstuv`).includes(TOKEN), false);
});
test('AI/LLM Model: configure/validate, unavailable model → offline fallback, unsafe SQL rejected', async () => {
  assert.ok(AI.validateAiConfig({ ...AI.DEFAULT_AI_CONFIG, enabled: true }, '').length >= 2);
  assert.deepEqual(AI.validateAiConfig({ ...AI.DEFAULT_AI_CONFIG, enabled: true, model: 'gpt', endpoint: 'https://api.openai.com/v1/chat/completions' }, 'k'), []);
  const store = memoryStore({ 'sqla.onlineNlp.v15': JSON.stringify({ enabled: true, endpoint: 'https://old.example/nlp' }) });
  const migrated = AI.loadAiConfig(store); assert.equal(migrated.endpoint, 'https://old.example/nlp'); assert.equal(migrated.provider, 'custom');
  AI.saveAiConfig({ ...migrated, model: 'x' }, store); assert.equal(AI.loadAiConfig(store).model, 'x');
  const cfg = { ...AI.DEFAULT_AI_CONFIG, enabled: true, model: 'gpt', endpoint: 'https://127.0.0.1:9/none', timeoutMs: 500 };
  const r = await generateFromDescription('xyzzy plugh', emptyReadOnly(), CORE_SCHEMA, 'Oracle', null, { config: cfg, apiKey: 'k-123456789012' });
  assert.equal(r.engine, 'offline'); assert.match(r.onlineNote, /offline NLU result is used/);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'DELETE FROM SECRET_TABLE' } }] }), { status: 200 });
  try {
    const bad = await generateFromDescription('xyzzy plugh', emptyReadOnly(), CORE_SCHEMA, 'Oracle', null, { config: cfg, apiKey: 'k-123456789012' });
    assert.equal(bad.engine, 'offline'); assert.match(bad.onlineNote, /rejected/);
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'SELECT VENDOR.VENDOR_NAME FROM VENDOR;' } }] }), { status: 200 });
    const good = await generateFromDescription('xyzzy plugh', emptyReadOnly(), CORE_SCHEMA, 'Oracle', null, { config: cfg, apiKey: 'k-123456789012' });
    assert.equal(good.engine, 'online'); assert.match(good.state.generatedSql, /VENDOR_NAME/);
  } finally { globalThis.fetch = realFetch; }
});
