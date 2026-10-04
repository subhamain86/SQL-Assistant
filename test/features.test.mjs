import { test } from 'node:test'; import assert from 'node:assert/strict';
import { imp, v170File } from './helpers.mjs';
const F = await imp('v17/sync/schemaFormat.js'); const { runOfflineNlu } = await imp('v17/engines/nluEngine.js'); const { applyV17ToState } = await imp('v17/engines/advancedOptionsResolver.js');
const { buildSelectSQL } = await imp('engines/sqlEngine.js'); const { validateSqlAgainstSchema } = await imp('engines/sqlSchemaValidator.js'); const { CORE_SCHEMA } = await imp('data/defaultSchemas.js');
const { SchemaService } = await imp('services/schemaService.js'); const { memoryStore } = await imp('services/storage.js'); const C = await imp('v17/services/cryptoBox.js'); const { SecretVault } = await imp('v17/services/secretVault.js'); const AI = await imp('v17/services/aiLlmService.js');
const { LearningStore } = await imp('v17/services/learningStore.js'); const { generateFromDescription } = await imp('v17/services/queryOrchestrator.js'); const { buildCrSQL, parseCrDescription } = await imp('engines/crEngine.js'); const { rectify } = await imp('engines/errorRectifierEngine.js');
const empty = () => ({ dialect: 'Oracle', naturalLanguageText: '', selectedTables: [], selectedColumns: [], filters: [], sorts: [], advanced: { distinct: false, groupByColumns: [], havingClause: '', limit: null, viewName: '', tableAliases: false, joinType: 'INNER JOIN' }, generatedSql: '' });
const gen = (t, s = CORE_SCHEMA, ov = () => false, cur = empty()) => buildSelectSQL(applyV17ToState(cur, runOfflineNlu(t, s, { dialect: 'Oracle' }), { isManual: ov }).state, s);
const AP = F.checkRegistry({ text: v170File() }).validSchemas[2];
test('offline NLU: tables, joins, decode filter, aggregation, grouping, sort, limit, dates, distinct, country', () => {
  const sql = gen('total invoice amount per vendor for approved invoices in the last 30 days, top 10');
  for (const x of ['SUM(INVOICE_HEADER.INVOICE_AMOUNT)', "INVOICE_HEADER.STATUS = 'A'", 'GROUP BY VENDOR.VENDOR_NAME', 'TRUNC(SYSDATE) - 30', 'ORDER BY SUM(INVOICE_HEADER.INVOICE_AMOUNT) DESC', 'FETCH FIRST 10 ROWS ONLY']) assert.ok(sql.includes(x), sql);
  assert.match(sql, /JOIN (VENDOR|INVOICE_HEADER) ON INVOICE_HEADER\.VENDOR_ID = VENDOR\.VENDOR_ID/); assert.equal(validateSqlAgainstSchema(sql, CORE_SCHEMA).valid, true);
  assert.match(gen('distinct vendor name for vendors in Finland or Sweden'), /SELECT DISTINCT VENDOR\.VENDOR_NAME[\s\S]*VENDOR\.COUNTRY IN \('FI', 'SE'\)/);
  assert.match(gen('show invoices with vendor name using table aliases'), /FROM INVOICE_HEADER ih/);
  assert.match(gen('show open purchase orders sorted by po date desc'), /PO_HEADER\.STATUS = 'O'[\s\S]*ORDER BY PO_HEADER\.PO_DATE DESC/);
});
test('NLU uses the active (migrated) AP schema 77 and never invents names', () => { assert.match(gen('show action log entries where root document type is Invoice', AP), /IA_ACTION_LOG\.ROOT_DOCUMENT_TYPE = 'Invoice\.Domain\.Invoice'/); assert.match(gen('total gross sum per supplier name for invoices', AP), /GROUP BY IA_INVOICE\.SUPPLIER_NAME/); const r = runOfflineNlu('show invoices with PAYMENT_CHANNEL_CODE', CORE_SCHEMA, { dialect: 'Oracle' }); assert.deepEqual(r.schemaGaps, ['PAYMENT_CHANNEL_CODE']); });
test('Advanced Options: manual settings win over inferred ones', () => { const cur = empty(); cur.advanced.limit = 50; assert.match(gen('vendor name top 5', CORE_SCHEMA, (k) => k === 'limit', cur), /FETCH FIRST 50 ROWS ONLY/); });
test('Manual Schema Update: row-wise edit/delete; unrelated rows untouched; referenced row protected', () => {
  const s = new SchemaService(memoryStore()); const id = s.active().id; const before = JSON.parse(JSON.stringify(s.active())); const VI = s.active().tables.findIndex((x) => x.name === 'VENDOR'); const t = s.active().tables[VI]; const c = t.columns[1];
  const row = { rowId: `VENDOR::${c.name}`, module: t.module, tableName: 'VENDOR', tableDescription: t.description, columnName: c.name, columnDescription: 'Edited', dataType: c.type, length: c.length ?? null, precision: null, nullable: c.nullable, alias: '', decodeText: '', isPrimaryKey: false, isForeignKey: false, fkTable: '', fkColumn: '' };
  assert.equal(s.upsertRow(id, row, row.rowId).ok, true); const a = s.byId(id); a.tables.forEach((x, i) => { if (i !== VI) assert.deepEqual(x, before.tables[i]); }); a.tables[VI].columns.forEach((x, i) => { if (i !== 1) assert.deepEqual(x, before.tables[VI].columns[i]); });
  assert.equal(s.deleteRow(id, 'VENDOR::COUNTRY').ok, true); assert.ok(!s.byId(id).tables[VI].columns.some((x) => x.name === 'COUNTRY')); assert.equal(s.deleteRow(id, 'VENDOR::VENDOR_ID').ok, false);
  const bad = s.upsertRow(id, { ...row, rowId: 'VENDOR::VENDOR_NAME', columnName: 'VENDOR_NAME', decodeText: '=x' }, 'VENDOR::VENDOR_NAME'); assert.equal(bad.ok, false, 'invalid decode rejected by validation');
});
test('CR builder: INSERT/UPDATE/DELETE with WHERE safeguard; description parsing', () => {
  assert.match(buildCrSQL({ queryType: 'DELETE', table: 'VENDOR', values: [], filters: [], confirmNoWhere: false }), /WHERE condition is required/);
  const r = parseCrDescription('update the invoice status to Approved where invoice id is one of 100, 101', CORE_SCHEMA); assert.equal(r.table, 'INVOICE_HEADER'); assert.equal(r.values[0].value, 'A');
  assert.equal(buildCrSQL({ queryType: 'UPDATE', table: r.table, values: r.values, filters: r.filters, confirmNoWhere: false }), "UPDATE INVOICE_HEADER\nSET STATUS = 'A'\nWHERE INVOICE_HEADER.INVOICE_ID IN (100, 101);");
});
test('Error Rectifier', () => { const r = rectify('ORA-00932: inconsistent datatypes', "SELECT CASE WHEN LOGIN_TYPE = 0 THEN 'Forms' ELSE LOGIN_TYPE END AS LT FROM ADM_USER_DATA"); assert.match(r.correctedSql, /ELSE TO_CHAR\(LOGIN_TYPE\) END/); assert.equal(r.dialect, 'Oracle'); });
test('Secret Vault: encrypted locally and in repository; cross-device; wrong passphrase rejected', async () => {
  const T = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'; const st = memoryStore(); const v = new SecretVault(st, C.memoryKeyProvider());
  await v.save({ githubOwner: 'o', githubRepo: 'r', githubBranch: 'main', schemaPath: '', vaultPath: '', githubToken: T, aiApiKey: '' }); assert.ok(!st.get('sqla.vault.local.v17').includes(T)); assert.equal((await v.load()).schemaPath, 'sql-assistant-data/schemas/registry.json');
  const out = await v.exportEncrypted('correct horse battery'); assert.ok(!out.includes(T)); const v2 = new SecretVault(memoryStore(), C.memoryKeyProvider()); assert.equal((await v2.importEncrypted(out, 'correct horse battery')).githubToken, T); await assert.rejects(v2.importEncrypted(out, 'wrong passphrase!!'), /wrong or the data was modified/);
});
test('AI/LLM Model: validation, V17.2 settings migrated, offline fallback', async () => {
  assert.ok(AI.validateAiConfig({ ...AI.DEFAULT_AI_CONFIG, enabled: true }, '').length >= 2);
  assert.equal(AI.loadAiConfig(memoryStore({ 'sqla.llmconfig.v17': JSON.stringify({ enabled: true, provider: 'openai', model: 'gpt-x', endpoint: 'https://api.openai.com/v1/chat/completions' }) })).model, 'gpt-x');
  const r = await generateFromDescription('xyzzy plugh', empty(), CORE_SCHEMA, 'Oracle', new LearningStore(memoryStore()), { config: { ...AI.DEFAULT_AI_CONFIG, enabled: true, model: 'm', endpoint: 'https://127.0.0.1:9/x', timeoutMs: 400 }, apiKey: 'k-1234567890' });
  assert.equal(r.engine, 'offline'); assert.match(r.onlineNote, /offline NLU result is used/);
});
test('learning: schema-scoped, credentials refused, obsolete patterns ignored', () => { const l = new LearningStore(memoryStore()); assert.equal(l.record({ schema: CORE_SCHEMA, requestText: 'token ghp_' + 'x'.repeat(30), generatedSql: '', modifiedSql: null, finalSql: null, tables: [], columns: [], sorts: [], limit: null }), false);
  const r = runOfflineNlu('open purchase orders', CORE_SCHEMA, { dialect: 'Oracle', hints: [{ patternId: 'x', similarity: 1, tables: ['GONE'], columns: [], options: {} }] }); assert.ok(r.notes.some((n) => /no longer exist/.test(n))); });
test('routing: root, empty, aliases, unknown, deep links (V17.2 routes)', async () => { const { parseRoute } = await imp('main.js'); assert.equal(parseRoute(''), 'quickstart'); assert.equal(parseRoute('#/'), 'quickstart'); assert.equal(parseRoute('#/nope'), 'quickstart'); for (const r of ['quickstart', 'readonly', 'cr', 'schema-used', 'error-rectifier', 'settings', 'about']) assert.equal(parseRoute(`#${r}`), r); assert.equal(parseRoute('#builder'), 'readonly'); assert.equal(parseRoute('#crbuilder'), 'cr'); assert.equal(parseRoute('#settings/vault'), 'settings'); });
