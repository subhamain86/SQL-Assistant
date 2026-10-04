import { test } from 'node:test'; import assert from 'node:assert/strict';
import { imp, v170File } from './helpers.mjs';
const F = await imp('v17/sync/schemaFormat.js'); const { runOfflineNlu } = await imp('v17/engines/nluEngine.js'); const { applyV17ToState } = await imp('v17/engines/advancedOptionsResolver.js');
const { buildSelectSQL } = await imp('engines/sqlEngine.js'); const { validateSqlAgainstSchema } = await imp('engines/sqlSchemaValidator.js'); const { emptyReadOnly } = await imp('state/store.js'); const { CORE_SCHEMA } = await imp('data/defaultSchemas.js');
const { SchemaService } = await imp('services/schemaService.js'); const { memoryStore } = await imp('services/storage.js'); const C = await imp('v17/services/cryptoBox.js'); const { SecretVault } = await imp('v17/services/secretVault.js'); const AI = await imp('v17/services/aiLlmService.js');
const { routeFromHash } = await imp('main.js'); const { LearningStore } = await imp('v17/services/learningStore.js'); const { generateFromDescription } = await imp('v17/services/queryOrchestrator.js');
const gen = (t, s = CORE_SCHEMA, ov = () => false, cur = emptyReadOnly()) => buildSelectSQL(applyV17ToState(cur, runOfflineNlu(t, s, { dialect: 'Oracle' }), { isManual: ov }).state, s);
const AP = F.checkRegistry({ text: v170File() }).validSchemas[2];
test('index routing: root, empty, unknown, direct routes', () => { assert.equal(routeFromHash(''), 'quickstart'); assert.equal(routeFromHash('#'), 'quickstart'); assert.equal(routeFromHash('#/nope'), 'quickstart'); assert.equal(routeFromHash('#settings'), 'settings'); assert.equal(routeFromHash('#/readonly'), 'readonly'); });
test('NLU: tables, joins, filters, decode, aggregation, grouping, sort, limit, dates, distinct', () => {
  const sql = gen('total invoice amount per vendor for approved invoices in the last 30 days, top 10');
  for (const x of ['SUM(INVOICE_HEADER.INVOICE_AMOUNT)', "INVOICE_HEADER.STATUS = 'A'", 'GROUP BY VENDOR.VENDOR_NAME', 'TRUNC(SYSDATE) - 30', 'ORDER BY SUM(INVOICE_HEADER.INVOICE_AMOUNT) DESC', 'FETCH FIRST 10 ROWS ONLY']) assert.ok(sql.includes(x), sql);
  assert.match(sql, /JOIN (VENDOR|INVOICE_HEADER) ON INVOICE_HEADER\.VENDOR_ID = VENDOR\.VENDOR_ID/); assert.equal(validateSqlAgainstSchema(sql, CORE_SCHEMA).valid, true);
  assert.match(gen('distinct vendor country'), /SELECT DISTINCT VENDOR\.COUNTRY/); assert.match(gen('vendors in Germany or France'), /VENDOR\.COUNTRY IN \('DE', 'FR'\)/);
});
test('NLU uses the active (migrated) schema', () => { const s = gen('show action log entries where root document type is Invoice', AP); assert.match(s, /IA_ACTION_LOG\.ROOT_DOCUMENT_TYPE = 'Invoice\.Domain\.Invoice'/); assert.match(gen('total gross sum per supplier name for invoices', AP), /GROUP BY IA_INVOICE\.SUPPLIER_NAME/); });
test('Advanced Options: manual takes precedence', () => { const cur = { ...emptyReadOnly(), advanced: { ...emptyReadOnly().advanced, limit: 50 } }; assert.match(gen('vendor country top 5', CORE_SCHEMA, (k) => k === 'limit', cur), /FETCH FIRST 50 ROWS ONLY/); });
test('Manual Schema Update: row-wise edit and delete; unrelated rows untouched', () => {
  const s = new SchemaService(memoryStore()); const id = s.active().id; const before = JSON.parse(JSON.stringify(s.active()));
  const c = s.active().tables[2].columns[1]; const row = { rowId: `VENDOR::${c.name}`, module: 'Vendors', tableName: 'VENDOR', tableDescription: '', columnName: c.name, columnDescription: 'Edited', dataType: c.type, length: null, precision: null, nullable: c.nullable, alias: '', decodeText: '', isPrimaryKey: false, isForeignKey: false, fkTable: '', fkColumn: '' };
  assert.equal(s.upsertRow(id, row, row.rowId).ok, true); const a = s.byId(id); a.tables.forEach((t, i) => { if (i !== 2) assert.deepEqual(t, before.tables[i]); }); assert.deepEqual(a.tables[2].columns[0], before.tables[2].columns[0]);
  assert.equal(s.deleteRow(id, 'VENDOR::COUNTRY').ok, true); assert.ok(!s.byId(id).tables[2].columns.some((x) => x.name === 'COUNTRY'));
  assert.equal(s.deleteRow(id, 'VENDOR::VENDOR_ID').ok, false, 'referenced row is protected');
});
test('Secret Vault: encrypted locally and in repository; cross-device retrieval; wrong passphrase rejected', async () => {
  const T = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'; const st = memoryStore(); const v = new SecretVault(st, C.memoryKeyProvider());
  await v.save({ githubToken: T, githubRepo: 'o/r', githubBranch: 'main', schemaPath: '', vaultPath: '', aiApiKey: '' }); assert.ok(!st.get('sqla.vault.local.v17').includes(T)); assert.equal((await v.load()).schemaPath, 'sql-assistant-data/schemas/registry.json');
  const out = await v.exportEncrypted('correct horse battery'); assert.ok(!out.includes(T)); const v2 = new SecretVault(memoryStore(), C.memoryKeyProvider()); assert.equal((await v2.importEncrypted(out, 'correct horse battery')).githubToken, T); await assert.rejects(v2.importEncrypted(out, 'wrong passphrase!!'));
});
test('AI/LLM Model: validation, V17.2 settings migrated, offline fallback', async () => {
  assert.ok(AI.validateAiConfig({ ...AI.DEFAULT_AI_CONFIG, enabled: true }, '').length >= 2);
  assert.equal(AI.loadAiConfig(memoryStore({ 'sqla.llmconfig.v17': JSON.stringify({ enabled: true, provider: 'openai', model: 'gpt-x', endpoint: 'https://api.openai.com/v1/chat/completions' }) })).model, 'gpt-x');
  const r = await generateFromDescription('xyzzy plugh', emptyReadOnly(), CORE_SCHEMA, 'Oracle', new LearningStore(memoryStore()), { config: { ...AI.DEFAULT_AI_CONFIG, enabled: true, model: 'm', endpoint: 'https://127.0.0.1:9/x', timeoutMs: 400 }, apiKey: 'k-1234567890' });
  assert.equal(r.engine, 'offline'); assert.match(r.onlineNote, /offline NLU result is used/);
});
test('learning is schema-scoped and obsolete patterns are ignored', () => { const r = runOfflineNlu('open purchase orders', CORE_SCHEMA, { dialect: 'Oracle', hints: [{ patternId: 'x', similarity: 1, tables: ['GONE'], columns: [], options: {} }] }); assert.ok(r.notes.some((n) => /no longer exist/.test(n))); });
