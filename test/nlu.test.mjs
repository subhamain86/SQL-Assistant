import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imp, legacyRepoFile } from './helpers.mjs';
const { runOfflineNlu } = await imp('v17/engines/nluEngine.js');
const { applyV17ToState, advancedOverrides } = await imp('v17/engines/advancedOptionsResolver.js');
const { buildSelectSQL } = await imp('engines/sqlEngine.js');
const { validateSqlAgainstSchema } = await imp('engines/sqlSchemaValidator.js');
const { validateFullReadOnly } = await imp('engines/validationEngine.js');
const { CORE_SCHEMA } = await imp('data/defaultSchemas.js');
const { checkRegistry } = await imp('v17/sync/schemaFormat.js');
const { emptyReadOnly } = await imp('state/store.js');
const { LearningStore } = await imp('v17/services/learningStore.js');
const { memoryStore } = await imp('services/storage.js');
const { generateFromDescription } = await imp('v17/services/queryOrchestrator.js');
function gen(text, schema = CORE_SCHEMA, dialect = 'Oracle') { const req = runOfflineNlu(text, schema, { dialect }); const r = applyV17ToState({ ...emptyReadOnly(), dialect }, req, { isManual: () => false }); const sql = buildSelectSQL(r.state, schema); return { req, state: r.state, sql }; }
const AP77 = checkRegistry({ text: legacyRepoFile() }).validSchemas[2];

test('SQL generation using the migrated AP schema 77 (decode filter uses the recovered code)', () => {
  const { sql, state } = gen('show action log entries where root document type is Invoice', AP77);
  assert.match(sql, /FROM IA_ACTION_LOG/); assert.match(sql, /IA_ACTION_LOG\.ROOT_DOCUMENT_TYPE = 'Invoice\.Domain\.Invoice'/);
  assert.equal(validateSqlAgainstSchema(sql, AP77).valid, true); assert.equal(validateFullReadOnly({ ...state, generatedSql: sql }).valid, true);
});
test('AP schema 77: aggregation, joins via mapped foreign keys, date filter', () => {
  const { sql } = gen('total gross sum per supplier name for invoices in the last 30 days', AP77);
  assert.match(sql, /SUM\(IA_INVOICE\.GROSS_SUM\)/); assert.match(sql, /GROUP BY/); assert.match(sql, /INVOICE_DATE >= TRUNC\(SYSDATE\) - 30/);
  assert.equal(validateSqlAgainstSchema(sql, AP77).valid, true);
  const j = gen('show invoices with their coding rows', AP77).sql;
  assert.match(j, /JOIN IA_CODING_ROW ON IA_CODING_ROW\.INVOICE_ID = IA_INVOICE\.ID|JOIN IA_INVOICE ON/);
});
test('Core NLU: filters, joins, grouping, having, sorting, distinct, limit, dates', () => {
  let r = gen('total invoice amount per vendor for approved invoices in the last 30 days, top 10');
  assert.match(r.sql, /SUM\(INVOICE_HEADER\.INVOICE_AMOUNT\)/); assert.match(r.sql, /INNER JOIN VENDOR/); assert.match(r.sql, /INVOICE_HEADER\.STATUS = 'A'/);
  assert.match(r.sql, /GROUP BY VENDOR\.VENDOR_NAME/); assert.match(r.sql, /ORDER BY SUM\(INVOICE_HEADER\.INVOICE_AMOUNT\) DESC/); assert.match(r.sql, /FETCH FIRST 10 ROWS ONLY/);
  r = gen('vendors having more than 5 invoices'); assert.match(r.sql, /HAVING COUNT\(DISTINCT INVOICE_HEADER\.INVOICE_ID\) > 5/);
  r = gen('distinct vendor country'); assert.match(r.sql, /SELECT DISTINCT VENDOR\.COUNTRY/);
  r = gen('invoices between 2026-01-01 and 2026-03-31 sorted by invoice amount desc', CORE_SCHEMA, 'PostgreSQL'); assert.match(r.sql, /BETWEEN DATE '2026-01-01' AND DATE '2026-03-31'/); assert.match(r.sql, /ORDER BY INVOICE_HEADER\.INVOICE_AMOUNT DESC/);
  r = gen('vendors in Germany or France'); assert.match(r.sql, /VENDOR\.COUNTRY IN \('DE', 'FR'\)/);
  r = gen('invoices with vendor name, with table aliases'); assert.match(r.sql, /FROM INVOICE_HEADER ih/);
});
test('Unknown schema elements are reported, never invented', () => {
  const r = gen('show invoices with PAYMENT_CHANNEL_CODE');
  assert.ok(r.req.schemaGaps.some((g) => g.term === 'PAYMENT_CHANNEL_CODE')); assert.doesNotMatch(r.sql, /PAYMENT_CHANNEL_CODE/);
});
test('Advanced Options: manual selections take precedence over inference', () => {
  const req = runOfflineNlu('distinct vendor country top 5', CORE_SCHEMA, { dialect: 'Oracle' });
  const cur = { ...emptyReadOnly(), advanced: { ...emptyReadOnly().advanced, distinct: false, limit: 50 } };
  const r = applyV17ToState(cur, req, { isManual: (k) => k === 'distinct' || k === 'limit' });
  assert.equal(r.state.advanced.distinct, false); assert.equal(r.state.advanced.limit, 50); assert.ok(r.keptManual.includes('DISTINCT')); assert.ok(r.keptManual.includes('LIMIT'));
  advancedOverrides.clear();
});
test('Learning: accepted queries become schema-scoped hints; obsolete patterns are ignored', async () => {
  const ls = new LearningStore(memoryStore());
  const first = await generateFromDescription('open purchase orders for buyer', emptyReadOnly(), CORE_SCHEMA, 'Oracle', ls, null);
  assert.equal(first.engine, 'offline');
  assert.equal(ls.confirm('open purchase orders for buyer', CORE_SCHEMA, first.state.generatedSql, null), true);
  assert.equal(ls.all()[0].status, 'confirmed');
  const hints = ls.hints('open purchase orders for the buyer', CORE_SCHEMA); assert.equal(hints.length, 1);
  assert.equal(ls.hints('open purchase orders for buyer', AP77).length, 0, 'scoped to the schema it was learned on');
  const obsolete = [{ ...hints[0], tables: ['NO_SUCH_TABLE'] }];
  const r = runOfflineNlu('open purchase orders for buyer', CORE_SCHEMA, { dialect: 'Oracle', hints: obsolete });
  assert.ok(r.notes.some((n) => /no longer exist/.test(n))); assert.ok(!r.matchedTables.includes('NO_SUCH_TABLE'));
});
