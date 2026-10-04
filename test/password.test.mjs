import { test } from 'node:test'; import assert from 'node:assert/strict'; import { imp } from './helpers.mjs';
const mem = new Map(); globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: () => null, length: 0 };
const P = await imp('services/passwordService.js'); const CS = await imp('services/cryptoService.js');
const { SecretVault } = await imp('v17/services/secretVault.js'); const { memoryKeyProvider } = await imp('v17/services/cryptoBox.js'); const { memoryStore } = await imp('services/storage.js');
test('Admin Password: default "admin" until changed; wrong password rejected; change; reset (V17.2 storage key sqla.pwvault.v15)', async () => {
  mem.clear(); assert.equal(P.isUsingDefaultPassword(), true); assert.equal(await P.verifyPassword('admin'), true); assert.equal(await P.verifyPassword('nope'), false);
  assert.equal((await P.changePassword('wrong', 'Secret-2026')).ok, false); assert.equal((await P.changePassword('admin', 'abc')).ok, false, 'too short'); assert.equal((await P.changePassword('admin', 'admin')).ok, false, 'default not allowed');
  assert.equal((await P.changePassword('admin', 'Secret-2026')).ok, true); assert.equal(P.isUsingDefaultPassword(), false); assert.equal(await P.verifyPassword('Secret-2026'), true); assert.equal(await P.verifyPassword('admin'), false);
  assert.ok(!mem.get('sqla.pwvault.v15').includes('Secret-2026'), 'password never stored'); P.resetPasswordToDefault(); assert.equal(await P.verifyPassword('admin'), true);
});
test('A V17.2 Admin Password stored by V17.2 still unlocks (same marker format)', async () => {
  mem.clear(); mem.set('sqla.pwvault.v15', JSON.stringify(await CS.encryptWithSecret('MyV172Pass', 'sqla-verified-marker-v15'))); assert.equal(await P.verifyPassword('MyV172Pass'), true);
});
test('Secret Vault: V17.2 local vault (encrypted with the Admin Password) is imported on unlock', async () => {
  mem.clear(); const TOKEN = 'ghp_' + 'A'.repeat(36);
  mem.set('sqla.secretvault.v15', JSON.stringify({ blob: await CS.encryptWithSecret('admin', JSON.stringify({ githubRepo: 'acme/sql-data', githubBranch: 'main', githubSchemaPath: 'sql-assistant-data/schemas/registry.json', githubToken: TOKEN, llmApiKey: 'sk-test-key-1234567890' })), meta: {} }));
  const v = new SecretVault(memoryStore(), memoryKeyProvider()); assert.equal(await v.migrateFromV172('wrong'), false); assert.equal(await v.migrateFromV172('admin'), true);
  const s = await v.load(); assert.equal(s.githubOwner, 'acme'); assert.equal(s.githubRepo, 'sql-data'); assert.equal(s.githubToken, TOKEN); assert.equal(s.aiApiKey, 'sk-test-key-1234567890'); assert.equal(await v.migrateFromV172('admin'), false, 'only once');
});
test('Secret Vault: a vault pushed by V17.2 (sqla-vault-sync v2) can be retrieved; wrong passphrase / tampering rejected', async () => {
  const pass = 'Correct-Horse-42-Battery'; const payload = { githubToken: 'ghp_' + 'B'.repeat(36), githubRepo: 'acme/sql-data', githubBranch: 'main', githubSchemaPath: 'sql-assistant-data/schemas/registry.json' };
  const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12)); const b64 = (u) => Buffer.from(u).toString('base64');
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']); const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('sqla-vault-sync:v2'), tagLength: 128 }, key, new TextEncoder().encode(JSON.stringify(payload))));
  const env = { format: 'sqla-vault-sync', version: 2, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt: b64(salt) }, cipher: { name: 'AES-GCM', iv: b64(iv), tagLength: 128 }, aad: 'sqla-vault-sync:v2', ciphertext: b64(ct), meta: {} };
  const v = new SecretVault(memoryStore(), memoryKeyProvider());
  await assert.rejects(v.importEncrypted(JSON.stringify(env), 'wrong passphrase!!'), /wrong or the data was modified/);
  await assert.rejects(v.importEncrypted(JSON.stringify({ ...env, kdf: { ...env.kdf, iterations: 10 } }), pass), /unsupported or modified/);
  const s = await v.importEncrypted(JSON.stringify(env), pass); assert.equal(s.githubToken, payload.githubToken); assert.equal(s.githubOwner, 'acme');
});
test('Join paths: ambiguous bridges require a choice; the chosen path is used (V17.2 behaviour)', async () => {
  const { computeAutoJoinPlan } = await imp('engines/joinAutoEngine.js'); const { CORE_SCHEMA } = await imp('data/defaultSchemas.js');
  const p = computeAutoJoinPlan(CORE_SCHEMA, 'INVOICE_HEADER', ['VENDOR']); assert.equal(p.joinLines.length, 1); assert.match(p.joinLines[0], /JOIN VENDOR ON/);
  const q = computeAutoJoinPlan(CORE_SCHEMA, 'APPROVAL_HISTORY', ['VENDOR']); assert.ok(q.joinLines.some((l) => /INVOICE_HEADER/.test(l)), 'bridged through INVOICE_HEADER');
});
test('CTE + Recursive render in the generated SQL', async () => {
  const { buildSelectSQL } = await imp('engines/sqlEngine.js'); const { CORE_SCHEMA } = await imp('data/defaultSchemas.js');
  const sql = buildSelectSQL({ dialect: 'Generic', naturalLanguageText: '', selectedTables: ['VENDOR'], selectedColumns: [], filters: [], sorts: [], advanced: { distinct: false, groupByColumns: [], havingClause: '', limit: null, viewName: '', tableAliases: false, joinType: 'INNER JOIN', recursive: true, ctes: [{ id: 'c', name: 'tree', body: 'SELECT 1' }] }, generatedSql: '', joinPathChoices: {} }, CORE_SCHEMA);
  assert.match(sql, /^WITH RECURSIVE tree AS \(\n  SELECT 1\n\)\nSELECT \*\nFROM VENDOR;$/);
});
