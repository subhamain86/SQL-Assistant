import { test } from 'node:test'; import assert from 'node:assert/strict';
import { imp } from './helpers.mjs';
const { memoryStore, KEYS } = await imp('services/storage.js'); const D = await imp('v17/services/repositoryDefaults.js'); const V = await imp('v17/services/secretVault.js'); const C = await imp('v17/services/cryptoBox.js');
const GH = await imp('v17/services/githubClient.js'); const SC = await imp('v17/services/schemaCrypto.js'); const F = await imp('v17/sync/schemaFormat.js'); const KS = await imp('v17/services/knowledgeSync.js'); const AM = await imp('v17/services/adminMessage.js');
const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const secrets = (x = {}) => ({ ...V.EMPTY_SECRETS, githubToken: TOKEN, ...x });
test('V17.5.4 the repository location is fixed: basware/sk-ap-sql-assistant · main · sql-assistant-data/schemas/registry.json', () => {
  assert.deepEqual(D.LOCKED_REPOSITORY, { owner: 'basware', repo: 'sk-ap-sql-assistant', branch: 'main', schemaPath: 'sql-assistant-data/schemas/registry.json' }); assert.equal(D.LOCKED_REPOSITORY_LABEL, 'basware/sk-ap-sql-assistant'); assert.equal(D.LOCKED_REPOSITORY.schemaPath, V.CANONICAL_SCHEMA_PATH);
  for (const stored of [{}, { githubOwner: 'acme', githubRepo: 'other', githubBranch: 'dev', schemaPath: 'x/y.json' }, { githubOwner: '', githubRepo: 'a/b', schemaPath: 'schemas/schema-registry.json' }]) {
    const l = D.withLockedLocation(secrets(stored)); assert.deepEqual([l.githubOwner, l.githubRepo, l.githubBranch, l.schemaPath], ['basware', 'sk-ap-sql-assistant', 'main', 'sql-assistant-data/schemas/registry.json']); assert.equal(l.githubToken, TOKEN, 'the token is untouched'); assert.equal(l.vaultPath, V.EMPTY_SECRETS.vaultPath, 'the vault file path is untouched'); }
  const own = secrets({ githubOwner: 'acme' }); D.withLockedLocation(own); assert.equal(own.githubOwner, 'acme', 'the input object is not mutated (stored data is never rewritten)');
});
test('V17.5.4 every synchronization derives its paths from the one locked schema path (schema, encrypted schema, knowledge, admin message)', () => {
  const p = D.withLockedLocation(secrets()).schemaPath; assert.equal(SC.encryptedPathFor(p), 'sql-assistant-data/schemas/registry.enc.json'); assert.equal(KS.knowledgePathFor(p), 'sql-assistant-data/knowledge/knowledge.json'); assert.equal(AM.adminMessagePathFor(p), 'sql-assistant-data/messages/admin-message.json');
});
test('V17.5.4 the stored repository location of an existing device is kept as data but ignored — and a retrieved vault cannot move the location', async () => {
  const st = memoryStore(); const v = new V.SecretVault(st, C.memoryKeyProvider()); await v.save(secrets({ githubOwner: 'acme', githubRepo: 'legacy', githubBranch: 'dev', schemaPath: 'legacy/reg.json' }));
  const raw = await v.load(); assert.deepEqual([raw.githubOwner, raw.githubRepo, raw.githubBranch, raw.schemaPath], ['acme', 'legacy', 'dev', 'legacy/reg.json'], 'nothing stored was changed or deleted'); const eff = D.withLockedLocation(raw); assert.deepEqual([eff.githubOwner, eff.githubRepo, eff.githubBranch, eff.schemaPath], ['basware', 'sk-ap-sql-assistant', 'main', 'sql-assistant-data/schemas/registry.json']);
  const out = await v.exportEncrypted('a long enough passphrase'); const other = new V.SecretVault(memoryStore(), C.memoryKeyProvider()); const got = D.withLockedLocation(await other.importEncrypted(out, 'a long enough passphrase')); assert.equal(got.githubRepo, 'sk-ap-sql-assistant'); assert.equal(got.githubToken, TOKEN, 'the token still comes from the vault');
});
test('V17.5.4 the pre-filled Vault Sync Passphrase is a usable passphrase, is not a repository secret pattern, and round-trips a vault (push → pull)', async () => {
  const P = D.DEFAULT_VAULT_PASSPHRASE; assert.ok(P.length >= 10 && !/\s/.test(P)); assert.equal(SC.checkPassphrase(P), null);
  const A = new V.SecretVault(memoryStore(), C.memoryKeyProvider()); await A.save(secrets()); assert.deepEqual(await A.validateForPush(P, P), [], 'accepted by the push validation'); const file = await A.exportEncrypted(P); assert.ok(!file.includes(TOKEN) && !file.includes(P), 'neither the token nor the passphrase is in the repository file');
  const B = new V.SecretVault(memoryStore(), C.memoryKeyProvider()); assert.equal((await B.importEncrypted(file, P)).githubToken, TOKEN); await assert.rejects(B.importEncrypted(file, P + 'x'), /wrong or the data was modified/);
});
test('V17.5.4 Pull Secret Vault only READS the repository: no write, no other file touched; a wrong passphrase / missing file changes nothing', async () => {
  const P = D.DEFAULT_VAULT_PASSPHRASE; const A = new V.SecretVault(memoryStore(), C.memoryKeyProvider()); await A.save(secrets()); const file = await A.exportEncrypted(P);
  const repo = GH.memoryRepository({ [V.EMPTY_SECRETS.vaultPath]: file, 'sql-assistant-data/schemas/registry.json': '{"keep":1}', 'README.md': 'x' }); const writes = []; const spy = { ...repo, async write(...a) { writes.push(a[0]); return repo.write(...a); } };
  const before = JSON.stringify([...repo.files]); const dev = new V.SecretVault(memoryStore(), C.memoryKeyProvider()); const f = await spy.read(V.EMPTY_SECRETS.vaultPath); await dev.importEncrypted(f.text, P);
  assert.deepEqual(writes, [], 'no repository write'); assert.equal(JSON.stringify([...repo.files]), before, 'no repository content changed'); assert.equal((await dev.load()).githubToken, TOKEN);
  const dev2 = new V.SecretVault(memoryStore(), C.memoryKeyProvider()); await assert.rejects(dev2.importEncrypted(f.text, 'not the passphrase!'), /wrong or the data was modified/); assert.equal((await dev2.load()).githubToken, '', 'a failed pull leaves the device vault untouched');
  assert.equal(await spy.read('sql-assistant-data/vault/missing.json'), null);
});
test('V17.5.4 removed UI leaves the shared logic intact: SyncService.push (options, read-back), publishPlan and the encrypted pull are still exported and working', async () => {
  const SY = await imp('v17/sync/syncService.js'); assert.equal(typeof SY.SyncService.prototype.push, 'function'); assert.equal(typeof SY.SyncService.prototype.publishPlan, 'function'); assert.equal(typeof SY.SyncService.prototype.previewEncryptedPull, 'function'); assert.equal(typeof SC.encryptSchemaRegistry, 'function');
  assert.match(F.APP_VERSION, /^17\.[56]\.\d+$/);
});
