/* V17.0 automated tests — run: npm test (compiles to ./build then node --test) */
const test = require('node:test');
const assert = require('node:assert/strict');
// ---- browser globals for Node ----
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), clear: () => mem.clear() };
const B = process.env.V17_BUILD || require('node:path').join(__dirname, '..', 'build');
const { CORE_SCHEMA } = require(`${B}/data/defaultSchemas`);
const { buildSelectSQL } = require(`${B}/engines/sqlEngine`);
const { validateReadOnlySql } = require(`${B}/engines/validationEngine`);
const { validateSchemaIntegrity } = require(`${B}/engines/schemaIntegrityEngine`);
const { parseRequirement, filterToKnownTables } = require(`${B}/engines/nlpEngine`);
const { runOfflineNlu } = require(`${B}/v17/engines/nluEngine`);
const { getSchemaContext, schemaFingerprint } = require(`${B}/v17/engines/schemaContext`);
const { isSafeDateExpression } = require(`${B}/v17/engines/dateExpressions`);
const { renderFilterClause } = require(`${B}/engines/filterEngine`);
const { applyV17ToState, validateAdvancedConsistency } = require(`${B}/v17/engines/advancedOptionsResolver`);
const { upsertSchemaRecord, deleteSchemaRecord, analyzeDependencies, dataTypeOptionValues } = require(`${B}/v17/engines/schemaRecordEngine`);
const { LearningStore, statusOf, pushLearning, pullLearning } = require(`${B}/v17/services/learningStore`);
const vault = require(`${B}/v17/services/vaultSyncService`);
const llm = require(`${B}/v17/services/llmService`);
const { describeWhatYouNeed, isResultStale, validateLlmSql } = require(`${B}/v17/services/v17Orchestrator`);
const { redactSecrets, renderErrorListHtml, escapeHtmlV17 } = require(`${B}/v17/errors/appErrors`);

const clone = (v) => JSON.parse(JSON.stringify(v));
const empty = (dialect = 'Generic') => ({ dialect, naturalLanguageText: '', selectedTables: [], selectedColumns: [], joins: [], filters: [], sorts: [], advanced: { distinct: false, groupByColumns: [], havingClause: '', limit: null, recursive: false, saveAsView: null, caseExpressions: [], decodeExpressions: [], ctes: [] }, generatedSql: '', lastGeneratedAt: null, joinPathChoices: {} });
const gen = async (text, opts = {}) => describeWhatYouNeed(text, opts.schema || CORE_SCHEMA, opts.state || empty(opts.dialect || 'Generic'), opts.deps || {});
const memStorage = () => { const m = new Map(); return { get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v), _m: m }; };
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const assertValid = (sql, schema = CORE_SCHEMA) => { assert.equal(validateReadOnlySql(sql).valid, true, sql); assert.ok(/^(SELECT|WITH)\b/.test(sql), sql); };

// ======================= V16.5 BASELINE REGRESSION =======================
test('V16 baseline: buildSelectSQL join + filter unchanged', () => {
  const s = { ...empty(), selectedTables: ['INVOICE_HEADER', 'VENDOR'], selectedColumns: [{ id: 'c1', table: 'INVOICE_HEADER', column: 'INVOICE_ID', alias: '', useDecode: false, aggregate: null }], filters: [{ id: 'f', table: 'INVOICE_HEADER', column: 'STATUS', operator: '=', value: 'P', combinator: 'AND' }] };
  const sql = buildSelectSQL(s, CORE_SCHEMA);
  assert.match(sql, /INNER JOIN VENDOR/); assert.match(sql, /WHERE INVOICE_HEADER.STATUS = 'P'/);
});
test('V16 baseline: destructive SQL still rejected by read-only validator', () => { assert.equal(validateReadOnlySql('DELETE FROM VENDOR').valid, false); });
test('V16 baseline: fabricated AI table is discarded by filterToKnownTables', () => { assert.deepEqual(filterToKnownTables(['INVOICE_HEADER', 'X'], CORE_SCHEMA).unknown, ['X']); });
test('V16 baseline: parseRequirement still works (kept as the NLU starting point)', () => { assert.ok(parseRequirement('approved invoices', CORE_SCHEMA).matchedTables.includes('INVOICE_HEADER')); });
test('V16.1 fix preserved: real-world data types remain valid', () => { assert.equal(validateSchemaIntegrity([{ name: 'T', module: 'M', description: '', columns: [{ name: 'ID', label: 'ID', type: 'INTEGER', nullable: false, isPrimaryKey: true, description: '' }] }]).valid, true); });
test('Filter quoting: user text is still quoted; only whitelisted generated date expressions pass through', () => {
  assert.equal(renderFilterClause('T', 'C', '=', "x' OR 1=1 --"), "T.C = 'x'' OR 1=1 --'");
  assert.equal(renderFilterClause('T', 'D', '>=', 'TRUNC(SYSDATE) - 30'), 'T.D >= TRUNC(SYSDATE) - 30');
  assert.equal(isSafeDateExpression("TRUNC(SYSDATE) - 30; DROP TABLE X"), false);
  assert.equal(isSafeDateExpression("DATE '2025-01-01'"), true);
});

// ======================= SQL GENERATION (offline NLU) =======================
test('1. simple SELECT', async () => { const r = await gen('show all vendors'); assert.equal(norm(r.sql), 'SELECT * FROM VENDOR;'); assert.equal(r.errors.length, 0); });
test('2. multiple tables + 3. JOIN (direct)', async () => { const r = await gen('show invoices with vendor name'); assert.match(r.sql, /FROM INVOICE_HEADER\nINNER JOIN VENDOR ON INVOICE_HEADER.VENDOR_ID = VENDOR.VENDOR_ID/); assert.match(r.sql, /VENDOR.VENDOR_NAME/); assertValid(r.sql); });
test('3. JOIN via bridge table', async () => { const r = await gen('invoices with organization name'); assert.match(r.sql, /INNER JOIN VENDOR/); assert.match(r.sql, /INNER JOIN ORGANIZATION ON VENDOR.ORG_ID = ORGANIZATION.ORG_ID/); assert.equal(r.errors.length, 0); });
test('3b. JOIN derived from foreign-key metadata (no explicit relationship row)', async () => { const r = await gen('invoice lines with gl account name for po 1234'); assert.match(r.sql, /INNER JOIN GL_ACCOUNT ON INVOICE_LINE.GL_ACCOUNT_ID = GL_ACCOUNT.ACCOUNT_ID/); assert.match(r.sql, /PO_HEADER.PO_ID = 1234/); assert.equal(CORE_SCHEMA.relationships.some((x) => x.fromTable === 'INVOICE_LINE' && x.toTable === 'GL_ACCOUNT'), false, 'schema not modified'); });
test('4. WHERE condition from business value (decode label)', async () => { const r = await gen('approved invoices'); assert.match(r.sql, /WHERE INVOICE_HEADER.STATUS = 'A'/); });
test('5. multiple conditions', async () => { const r = await gen('approved invoices with invoice amount over 5000 and currency is EUR'); assert.match(r.sql, /STATUS = 'A'/); assert.match(r.sql, /INVOICE_AMOUNT > 5000/); assert.match(r.sql, /CURRENCY = 'EUR'/); });
test('5b. negation and OR lists are correct (no contradictory AND)', async () => {
  assert.match((await gen('invoices that are not paid')).sql, /STATUS <> 'D'/);
  assert.match((await gen('unpaid invoices')).sql, /STATUS <> 'D'/);
  assert.match((await gen('approved or rejected invoices')).sql, /STATUS IN \('A', 'R'\)/);
  assert.match((await gen('invoices where currency is EUR or currency is USD')).sql, /CURRENCY IN \('(USD|EUR)', '(USD|EUR)'\)/);
});
test('5c. string conditions: contains / ends with / is empty', async () => {
  assert.match((await gen('vendor name containing acme')).sql, /VENDOR.VENDOR_NAME LIKE '%acme%'/);
  assert.match((await gen('users with email ending with basware.com')).sql, /APP_USER.EMAIL LIKE '%basware.com'/);
  assert.match((await gen('vendors where payment terms is empty')).sql, /VENDOR.PAYMENT_TERMS IS NULL/);
});
test('6. date filtering — explicit year, range, relative (Generic / Oracle / SQL Server / MySQL)', async () => {
  assert.match((await gen('invoices in 2025')).sql, /INVOICE_DATE >= DATE '2025-01-01'\n  AND INVOICE_HEADER.INVOICE_DATE < DATE '2026-01-01'/);
  assert.match((await gen('invoices with due date between 2025-01-01 and 2025-03-31')).sql, /DUE_DATE BETWEEN DATE '2025-01-01' AND DATE '2025-03-31'/);
  assert.match((await gen('invoices from the last 30 days', { dialect: 'Oracle' })).sql, /INVOICE_DATE >= TRUNC\(SYSDATE\) - 30/);
  assert.match((await gen('invoices from the last 30 days', { dialect: 'SQL Server' })).sql, /DATEADD\(DAY, -30, CAST\(GETDATE\(\) AS DATE\)\)/);
  assert.match((await gen('invoices from the last 30 days', { dialect: 'MySQL' })).sql, /DATE_SUB\(CURDATE\(\), INTERVAL 30 DAY\)/);
  const lm = (await gen('invoices last month', { dialect: 'Oracle' })).sql; assert.match(lm, />= ADD_MONTHS\(TRUNC\(SYSDATE, 'MM'\), -1\)/); assert.match(lm, /< TRUNC\(SYSDATE, 'MM'\)/);
  assert.match((await gen('invoices posted in March 2025')).sql, /POSTING_DATE >= DATE '2025-03-01'\n  AND INVOICE_HEADER.POSTING_DATE < DATE '2025-04-01'/);
});
test('7. ORDER BY (explicit and "latest N")', async () => {
  assert.match((await gen('vendors sorted by vendor name descending')).sql, /ORDER BY VENDOR.VENDOR_NAME DESC/);
  const r = await gen('latest 10 invoices'); assert.match(r.sql, /ORDER BY INVOICE_HEADER.INVOICE_DATE DESC/); assert.match(r.sql, /LIMIT 10/);
});
test('8. GROUP BY + 9. aggregation (SUM / COUNT / AVG)', async () => {
  const a = await gen('total invoice amount by vendor'); assert.match(a.sql, /SELECT VENDOR.VENDOR_NAME,\n  SUM\(INVOICE_HEADER.INVOICE_AMOUNT\) AS TOTAL_INVOICE_AMOUNT/); assert.match(a.sql, /GROUP BY VENDOR.VENDOR_NAME/); assert.equal(validateAdvancedConsistency(a.state).filter((i) => i.severity === 'error').length, 0);
  const b = await gen('how many invoices per status'); assert.match(b.sql, /COUNT\(INVOICE_HEADER.INVOICE_ID\) AS INVOICE_COUNT/); assert.match(b.sql, /GROUP BY INVOICE_HEADER.STATUS/);
  const c = await gen('average invoice amount per currency this year'); assert.match(c.sql, /AVG\(INVOICE_HEADER.INVOICE_AMOUNT\)/); assert.match(c.sql, /GROUP BY INVOICE_HEADER.CURRENCY/);
  const d = await gen('count of invoices per vendor having more than 5'); assert.match(d.sql, /HAVING COUNT\(INVOICE_HEADER.INVOICE_ID\) > 5/);
  const e = await gen('invoice count by month in 2025', { dialect: 'Oracle' }); assert.match(e.sql, /GROUP BY TO_CHAR\(INVOICE_HEADER.INVOICE_DATE, 'YYYY-MM'\)/);
});
test('10. DISTINCT', async () => { assert.equal(norm((await gen('unique countries of vendors')).sql), 'SELECT DISTINCT VENDOR.COUNTRY FROM VENDOR;'); });
test('11. complex SELECT (ranking + aggregate + join + conditions + dates + limit)', async () => {
  const r = await gen('top 5 vendors by total invoice amount for approved invoices in 2025', { dialect: 'Oracle' });
  for (const re of [/SUM\(INVOICE_HEADER.INVOICE_AMOUNT\)/, /INNER JOIN INVOICE_HEADER/, /STATUS = 'A'/, /DATE '2025-01-01'/, /GROUP BY VENDOR.VENDOR_NAME/, /ORDER BY SUM\(INVOICE_HEADER.INVOICE_AMOUNT\) DESC/, /FETCH FIRST 5 ROWS ONLY/]) assert.match(r.sql, re);
  assertValid(r.sql); assert.equal(r.errors.length, 0);
});
test('Active schema awareness: unknown identifier is reported, never silently added', async () => {
  const r = await gen('show invoices with VENDOR_CODE');
  assert.ok(r.errors.some((e) => e.code === 'COLUMN_NOT_FOUND' && /VENDOR_CODE/.test(e.message))); assert.doesNotMatch(r.sql, /VENDOR_CODE/);
  const t = await gen('select everything from table CONTRACT'); assert.ok(t.errors.some((e) => e.code === 'TABLE_NOT_FOUND' || e.code === 'OFFLINE_MODEL_UNABLE'));
});
test('Active schema awareness: no false table from substrings (e.g. "PO" inside "posting")', async () => { const r = await gen('invoices by posting date'); assert.doesNotMatch(r.sql, /PO_HEADER/); });
test('Error handling: empty active schema → ACTIVE_SCHEMA_UNAVAILABLE; unknown text → OFFLINE_MODEL_UNABLE', async () => {
  const r = await gen('show invoices', { schema: { ...clone(CORE_SCHEMA), tables: [], relationships: [] } }); assert.equal(r.errors[0].code, 'ACTIVE_SCHEMA_UNAVAILABLE');
  const u = await gen('weather forecast for tomorrow'); assert.ok(u.errors.some((e) => e.code === 'OFFLINE_MODEL_UNABLE'));
  assert.equal(renderErrorListHtml([], escapeHtmlV17), '', 'no error component when there is no error');
});

// ======================= ADVANCED OPTIONS: AUTO vs MANUAL =======================
test('Advanced Options: manual settings are never overwritten by the description engine', async () => {
  const st = empty(); st.advanced.limit = 50; st.advanced.groupByColumns = ['VENDOR.COUNTRY'];
  const req = runOfflineNlu('top 5 vendors by total invoice amount', CORE_SCHEMA, { dialect: 'Generic' });
  const r = applyV17ToState(st, req, { isManual: (k) => k === 'limit' || k === 'groupBy' });
  assert.equal(r.state.advanced.limit, 50); assert.ok(r.state.advanced.groupByColumns.includes('VENDOR.COUNTRY')); assert.ok(r.keptManual.includes('LIMIT'));
});
test('Advanced Options: all existing options still render in SQL (DISTINCT, GROUP BY, HAVING, LIMIT, CTE, RECURSIVE, manual CASE)', () => {
  const s = { ...empty('PostgreSQL'), selectedTables: ['VENDOR'], selectedColumns: [{ id: 'a', table: 'VENDOR', column: 'COUNTRY', alias: '', useDecode: false, aggregate: null }, { id: 'b', table: 'VENDOR', column: 'VENDOR_ID', alias: 'N', useDecode: false, aggregate: 'COUNT' }, { id: 'm', table: '', column: 'X', alias: 'X', useDecode: false, aggregate: null, manualExpr: "CASE WHEN 1=1 THEN 'Y' END AS X" }] };
  s.advanced = { ...s.advanced, distinct: true, groupByColumns: ['VENDOR.COUNTRY'], havingClause: 'COUNT(VENDOR.VENDOR_ID) > 1', limit: 3, recursive: true, ctes: [{ id: 'c', name: 'c1', body: 'SELECT 1' }] };
  const sql = buildSelectSQL(s, CORE_SCHEMA);
  for (const re of [/^WITH RECURSIVE c1 AS/, /SELECT DISTINCT/, /COUNT\(VENDOR.VENDOR_ID\) AS N/, /CASE WHEN 1=1/, /GROUP BY VENDOR.COUNTRY/, /HAVING COUNT/, /LIMIT 3/]) assert.match(sql, re);
});
test('Advanced Options: consistency check flags a GROUP BY that does not cover selected columns', () => {
  const s = { ...empty(), selectedTables: ['VENDOR'], selectedColumns: [{ id: 'a', table: 'VENDOR', column: 'COUNTRY', alias: '', useDecode: false, aggregate: null }, { id: 'b', table: 'VENDOR', column: 'VENDOR_ID', alias: '', useDecode: false, aggregate: 'COUNT' }] };
  assert.ok(validateAdvancedConsistency(s).some((i) => i.severity === 'error' && /GROUP BY/.test(i.message)));
});

// ======================= LEARNING =======================
test('Learning: records queries; one-off is NOT used; repeated is used; accepted is confirmed', async () => {
  const ls = new LearningStore(memStorage(), () => 'devA');
  const schemaBefore = JSON.stringify(CORE_SCHEMA);
  await gen('weather forecast for tomorrow', { deps: { learning: ls } }); // no table → nothing recorded
  assert.equal(ls.stats().total, 0);
  const r1 = await gen('open purchase orders with vendor name', { deps: { learning: ls } });
  assert.equal(ls.stats().total, 1); assert.equal(statusOf(ls.get(r1.learningId)), 'observed');
  assert.equal(ls.findHints('open purchase orders with vendor name', CORE_SCHEMA).length, 0, 'one-off query is not used');
  await gen('open purchase orders with vendor name', { deps: { learning: ls } });
  assert.equal(statusOf(ls.get(r1.learningId)), 'repeated'); assert.equal(ls.findHints('open purchase orders with vendor name', CORE_SCHEMA).length, 1);
  const modified = r1.sql.replace('SELECT ', 'SELECT PO_HEADER.PO_DATE,\n  ').replace(';', '\nORDER BY PO_HEADER.PO_DATE DESC;');
  const acc = ls.recordAcceptance(r1.learningId, modified, CORE_SCHEMA);
  assert.equal(acc.ok, true); assert.equal(acc.status, 'confirmed'); assert.equal(ls.get(r1.learningId).modifiedSql, modified);
  assert.equal(JSON.stringify(CORE_SCHEMA), schemaBefore, 'learning never modifies the schema');
});
test('12. user-modified SQL: valid edits are accepted, unsafe or schema-invalid edits are rejected', async () => {
  const ls = new LearningStore(memStorage(), () => 'devA');
  const r = await gen('approved invoices', { deps: { learning: ls } });
  assert.equal(ls.recordAcceptance(r.learningId, 'DELETE FROM INVOICE_HEADER;', CORE_SCHEMA).error.code, 'SQL_VALIDATION_FAILED');
  assert.equal(ls.recordAcceptance(r.learningId, 'SELECT INVOICE_HEADER.NOT_A_COLUMN FROM INVOICE_HEADER;', CORE_SCHEMA).ok, false);
  assert.equal(ls.recordAcceptance(r.learningId, "SELECT INVOICE_HEADER.INVOICE_ID FROM INVOICE_HEADER WHERE INVOICE_HEADER.STATUS = 'A';", CORE_SCHEMA).ok, true);
});
test('Learning: accepted pattern influences a similar later request', async () => {
  const ls = new LearningStore(memStorage(), () => 'devA');
  const r = await gen('vendor payment terms report', { deps: { learning: ls } });
  ls.recordAcceptance(r.learningId, 'SELECT VENDOR.VENDOR_NAME, VENDOR.PAYMENT_TERMS FROM VENDOR ORDER BY VENDOR.VENDOR_NAME ASC;', CORE_SCHEMA, { sorts: [{ table: 'VENDOR', column: 'VENDOR_NAME', direction: 'ASC' }] });
  const later = await gen('vendor payment terms report please', { deps: { learning: ls } });
  assert.ok(later.requirement.learnedPatternIds.length === 1); assert.match(later.sql, /ORDER BY VENDOR.VENDOR_NAME ASC/);
});
test('Learning survives restart (same storage, new instance) and is skipped when the schema no longer has its columns', async () => {
  const storage = memStorage();
  const ls = new LearningStore(storage, () => 'devA');
  const r = await gen('vendor payment terms report', { deps: { learning: ls } });
  ls.recordAcceptance(r.learningId, 'SELECT VENDOR.VENDOR_NAME, VENDOR.PAYMENT_TERMS FROM VENDOR;', CORE_SCHEMA);
  const restarted = new LearningStore(storage, () => 'devA');
  assert.equal(restarted.stats().confirmed, 1);
  const reduced = deleteSchemaRecord(CORE_SCHEMA, 'VENDOR::PAYMENT_TERMS').schema;
  assert.equal(restarted.findHints('vendor payment terms report', reduced).length, 0, 'stale pattern ignored after schema change');
});
test('Learning sync: per-device counters merge idempotently; literals are masked for the repository', async () => {
  const a = new LearningStore(memStorage(), () => 'devA'); const b = new LearningStore(memStorage(), () => 'devB');
  const ra = await gen("vendors named 'Acme Ltd'", { deps: { learning: a } });
  a.recordAcceptance(ra.learningId, "SELECT * FROM VENDOR WHERE VENDOR.VENDOR_NAME = 'Acme Ltd';", CORE_SCHEMA);
  const files = new Map(); const api = { getFile: async (r, br, p) => files.get(p) || null, putFile: async (r, br, p, t, c) => { files.set(p, { content: c, sha: 'x' }); return { sha: 'x' }; } };
  assert.equal((await pushLearning(a, api, 'o/r', 'main', 'tok_123456', true)).ok, true);
  const repoText = [...files.values()][0].content; assert.doesNotMatch(repoText, /Acme Ltd/); assert.match(repoText, /'\?'/);
  await pullLearning(b, api, 'o/r', 'main', ''); await pullLearning(b, api, 'o/r', 'main', '');
  assert.equal(b.stats().confirmed, 1); const rec = b.all()[0]; assert.equal(rec.counters.devA.accepted, 1, 'merge is idempotent');
});

// ======================= SCHEMA MANAGEMENT =======================
const rowOf = (schema, t, c) => { const tb = schema.tables.find((x) => x.name === t); const col = tb.columns.find((x) => x.name === c); return { rowId: `${t}::${c}`, module: tb.module, tableName: t, tableDescription: tb.description, columnName: col.name, columnDescription: col.description, dataType: col.type, length: col.length ?? null, precision: col.precision ?? null, nullable: col.nullable, alias: col.alias ?? '', decodeText: (col.decode || []).map((d) => `${d.rawValue}=${d.label}`).join('\n'), isPrimaryKey: !!col.isPrimaryKey, isForeignKey: !!col.isForeignKey, fkTable: col.references?.table ?? '', fkColumn: col.references?.column ?? '' }; };
test('Edit row: only the selected record changes', () => {
  const row = { ...rowOf(CORE_SCHEMA, 'VENDOR', 'COUNTRY'), columnDescription: 'ISO-3166 alpha-2 country' };
  const r = upsertSchemaRecord(CORE_SCHEMA, row, 'VENDOR::COUNTRY'); assert.equal(r.ok, true);
  const before = clone(CORE_SCHEMA); const after = r.schema;
  after.tables.forEach((t) => { if (t.name !== 'VENDOR') assert.deepEqual(t, before.tables.find((x) => x.name === t.name)); });
  const v0 = before.tables.find((t) => t.name === 'VENDOR'); const v1 = after.tables.find((t) => t.name === 'VENDOR');
  v1.columns.forEach((c, i) => { if (c.name !== 'COUNTRY') assert.deepEqual(c, v0.columns[i]); });
  assert.equal(v1.columns.find((c) => c.name === 'COUNTRY').description, 'ISO-3166 alpha-2 country');
  assert.deepEqual(after.relationships, before.relationships);
});
test('Edit row: renaming a referenced column updates its relationships and FK references explicitly', () => {
  const row = { ...rowOf(CORE_SCHEMA, 'VENDOR', 'VENDOR_ID'), columnName: 'SUPPLIER_ID' };
  const r = upsertSchemaRecord(CORE_SCHEMA, row, 'VENDOR::VENDOR_ID'); assert.equal(r.ok, true);
  assert.ok(r.schema.relationships.filter((x) => x.toTable === 'VENDOR').every((x) => x.toColumn === 'SUPPLIER_ID'));
  assert.equal(r.schema.tables.find((t) => t.name === 'INVOICE_HEADER').columns.find((c) => c.name === 'VENDOR_ID').references.column, 'SUPPLIER_ID');
  assert.ok(r.changes.some((c) => /Relationship/.test(c))); assert.equal(validateSchemaIntegrity(r.schema.tables).valid, true);
});
test('Invalid / malformed records are rejected before saving', () => {
  const base = rowOf(CORE_SCHEMA, 'VENDOR', 'COUNTRY');
  assert.equal(upsertSchemaRecord(CORE_SCHEMA, { ...base, columnName: 'BAD NAME' }, base.rowId).errors[0].code, 'INVALID_SCHEMA_RECORD');
  assert.equal(upsertSchemaRecord(CORE_SCHEMA, { ...base, dataType: 'VARCHAR2(; DROP' }, base.rowId).ok, false);
  assert.equal(upsertSchemaRecord(CORE_SCHEMA, { ...base, isForeignKey: true, fkTable: 'NOPE', fkColumn: 'X' }, base.rowId).ok, false);
  assert.equal(upsertSchemaRecord(CORE_SCHEMA, { ...base, columnName: 'VENDOR_NAME' }, base.rowId).ok, false, 'duplicate column');
  assert.equal(upsertSchemaRecord(CORE_SCHEMA, { ...base, decodeText: 'A=One\nA=Two' }, base.rowId).ok, false, 'duplicate decode');
});
test('Real-world data types are preserved when editing (no silent change to VARCHAR)', () => { assert.deepEqual(dataTypeOptionValues('VARCHAR2', ['VARCHAR', 'NUMBER']), ['VARCHAR2', 'VARCHAR', 'NUMBER']); });
test('Delete row: leaf column removes only that record', () => {
  const r = deleteSchemaRecord(CORE_SCHEMA, 'VENDOR::DUNS_NUMBER'); assert.equal(r.ok, true);
  assert.equal(r.schema.tables.find((t) => t.name === 'VENDOR').columns.length, CORE_SCHEMA.tables.find((t) => t.name === 'VENDOR').columns.length - 1);
  assert.equal(r.schema.tables.length, CORE_SCHEMA.tables.length); assert.deepEqual(r.schema.relationships, CORE_SCHEMA.relationships);
});
test('Delete row: referenced column is blocked (no silent invalid state); cascade is explicit and leaves a valid schema', () => {
  const blocked = deleteSchemaRecord(CORE_SCHEMA, 'VENDOR::VENDOR_ID');
  assert.equal(blocked.ok, false); assert.equal(blocked.errors[0].code, 'SCHEMA_DEPENDENCY_BLOCKED'); assert.ok(blocked.dependencies.length >= 3);
  const cascade = deleteSchemaRecord(CORE_SCHEMA, 'VENDOR::VENDOR_ID', { cascade: true });
  assert.equal(cascade.ok, true); assert.equal(cascade.schema.relationships.some((r) => r.toTable === 'VENDOR' && r.toColumn === 'VENDOR_ID'), false);
  assert.equal(validateSchemaIntegrity(cascade.schema.tables).valid, true);
  assert.ok(cascade.schema.tables.find((t) => t.name === 'INVOICE_HEADER').columns.some((c) => c.name === 'VENDOR_ID' && !c.isForeignKey), 'referencing column kept, FK unlinked');
});
test('Schema service: edit/delete persist to the centralized registry, survive reload, and do not touch other schemas', async () => {
  localStorage.clear();
  let { schemaService } = require(`${B}/services/schemaService`);
  const otherSchema = schemaService.getAllSchemas().find((x) => x.id !== schemaService.getActiveSchema().id);
  const other = JSON.stringify(otherSchema ?? null);
  const row = { ...rowOf(schemaService.getActiveSchema(), 'VENDOR', 'COUNTRY'), columnDescription: 'Edited' };
  assert.deepEqual(await schemaService.upsertRow(CORE_SCHEMA.id, row, 'VENDOR::COUNTRY'), []);
  assert.equal((await schemaService.deleteRow(CORE_SCHEMA.id, 'VENDOR::DUNS_NUMBER')).ok, true);
  const dep = await schemaService.deleteRow(CORE_SCHEMA.id, 'VENDOR::VENDOR_ID'); assert.equal(dep.ok, false); assert.equal(dep.requiresCascade, true);
  // "restart": fresh service instance reading the same storage
  const { SchemaService } = require(`${B}/services/schemaService`); const reloaded = new SchemaService();
  const v = reloaded.getActiveSchema().tables.find((t) => t.name === 'VENDOR');
  assert.equal(v.columns.find((c) => c.name === 'COUNTRY').description, 'Edited'); assert.equal(v.columns.some((c) => c.name === 'DUNS_NUMBER'), false);
  if (otherSchema) assert.equal(JSON.stringify(reloaded.getSchemaById(otherSchema.id)), other, 'unrelated schema untouched');
  assert.ok(reloaded.getActiveSchema().versionMeta.version, 'version stamped');
});
test('SQL generation uses the modified schema immediately (rename) and after a delete', async () => {
  const renamed = upsertSchemaRecord(CORE_SCHEMA, { ...rowOf(CORE_SCHEMA, 'INVOICE_HEADER', 'INVOICE_AMOUNT'), columnName: 'GROSS_AMOUNT' }, 'INVOICE_HEADER::INVOICE_AMOUNT').schema;
  assert.notEqual(schemaFingerprint(renamed), schemaFingerprint(CORE_SCHEMA));
  const r = await gen('total gross amount by vendor', { schema: renamed }); assert.match(r.sql, /SUM\(INVOICE_HEADER.GROSS_AMOUNT\)/); assert.doesNotMatch(r.sql, /INVOICE_AMOUNT/);
  const deleted = deleteSchemaRecord(CORE_SCHEMA, 'VENDOR::PAYMENT_TERMS').schema;
  const d = await gen('vendors where payment terms is empty', { schema: deleted }); assert.doesNotMatch(d.sql, /PAYMENT_TERMS/);
  const ctx1 = getSchemaContext(CORE_SCHEMA); const ctx2 = getSchemaContext({ ...deleted, id: CORE_SCHEMA.id }); assert.notEqual(ctx1.fingerprint, ctx2.fingerprint, 'context refreshes after update');
  assert.equal(isResultStale(r, CORE_SCHEMA), true);
});

// ======================= SECRET VAULT SYNC =======================
const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const payload = { githubToken: TOKEN, githubRepo: 'owner/repo', githubBranch: 'main', githubSchemaPath: 'sql-assistant-data/schemas/registry.json', llmApiKey: 'sk-test-0123456789abcdefghij' };
const PASS = 'Correct-Horse-42-Battery';
test('Vault: secret is encrypted; repository content never contains the token (plain or base64)', async () => {
  const { envelope } = await vault.encryptPayload(payload, PASS, 'devA', 100000);
  const text = JSON.stringify(envelope);
  assert.doesNotMatch(text, new RegExp(TOKEN)); assert.equal(text.includes(Buffer.from(TOKEN).toString('base64')), false); assert.doesNotMatch(text, /sk-test/); assert.doesNotMatch(text, /Correct-Horse/);
  assert.equal(envelope.cipher.name, 'AES-GCM'); assert.equal(envelope.kdf.name, 'PBKDF2');
});
test('Vault: push works and pull/decrypt works on another device; wrong passphrase / tampering / downgrade are handled safely', async () => {
  const files = new Map(); const api = { getFile: async (r, b, p, t) => files.get(p) || null, putFile: async (r, b, p, t, c) => { files.set(p, { content: c, sha: 's' }); return { sha: 's' }; } };
  const pushed = await vault.pushVaultSync({ payload, passphrase: PASS, deviceTag: 'devA', api, iterations: 100000 });
  assert.equal(pushed.ok, true); const stored = files.get(vault.VAULT_SYNC_PATH).content; assert.doesNotMatch(stored, /ghp_/);
  const pulled = await vault.pullVaultSync({ repo: 'owner/repo', branch: 'main', readToken: '', passphrase: PASS, api });
  assert.equal(pulled.ok, true); assert.equal(pulled.payload.githubToken, TOKEN);
  const wrong = await vault.pullVaultSync({ repo: 'owner/repo', branch: 'main', readToken: '', passphrase: 'Wrong-Horse-42-Battery', api });
  assert.equal(wrong.error.code, 'DECRYPTION_FAILED'); assert.doesNotMatch(JSON.stringify(wrong), /ghp_/);
  const env = JSON.parse(stored); env.ciphertext = env.ciphertext.slice(0, -4) + 'AAAA'; files.set(vault.VAULT_SYNC_PATH, { content: JSON.stringify(env), sha: 's' });
  assert.equal((await vault.pullVaultSync({ repo: 'o/r', branch: 'main', readToken: '', passphrase: PASS, api })).error.code, 'DECRYPTION_FAILED');
  const down = JSON.parse(stored); down.kdf.iterations = 1000; assert.equal(vault.parseEnvelope(JSON.stringify(down)).error.code, 'DECRYPTION_FAILED');
  files.delete(vault.VAULT_SYNC_PATH); assert.match((await vault.pullVaultSync({ repo: 'o/r', branch: 'main', readToken: '', passphrase: PASS, api })).error.message, /Import encrypted file/);
});
test('Vault: weak passphrase rejected; repository errors never expose the token', async () => {
  assert.ok(vault.validatePassphrase('admin').length > 0); assert.ok(vault.validatePassphrase('Same-As-Admin-99', 'Same-As-Admin-99').length > 0);
  const api = { getFile: async () => null, putFile: async (r, b, p, t) => { throw { status: 401, message: `Bad credentials for token ${t}` }; } };
  const r = await vault.pushVaultSync({ payload, passphrase: PASS, deviceTag: 'devA', api, iterations: 100000 });
  assert.equal(r.error.code, 'REPOSITORY_SYNC_FAILED'); assert.doesNotMatch(r.error.message, /ghp_/);
  assert.doesNotMatch(redactSecrets(`Authorization: Bearer ${TOKEN}`), /ghp_A1/);
});

// ======================= AI / LLM MODEL =======================
const llmCfg = (o = {}) => ({ ...llm.defaultLlmConfig(), enabled: true, provider: 'openai-compatible', endpoint: 'https://llm.example.com/v1', model: 'my-model', ...o });
const okFetch = (content) => async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });
test('No AI/LLM configured → offline NLU still works', async () => { const r = await gen('approved invoices', { deps: { llm: null } }); assert.equal(r.engineUsed, 'offline'); assert.match(r.sql, /STATUS = 'A'/); assert.equal(r.llmStatus, 'not configured'); });
test('AI/LLM enabled → model is used; its SQL is validated against the Active Schema', async () => {
  const sql = "SELECT VENDOR.VENDOR_NAME, SUM(INVOICE_HEADER.INVOICE_AMOUNT) AS T FROM INVOICE_HEADER INNER JOIN VENDOR ON INVOICE_HEADER.VENDOR_ID = VENDOR.VENDOR_ID GROUP BY VENDOR.VENDOR_NAME";
  const r = await gen('total invoice amount by vendor', { deps: { llm: { config: llmCfg(), apiKey: 'sk-test-0123456789abcdefghij', vaultLocked: false, fetchImpl: okFetch(JSON.stringify({ sql, tables: ['INVOICE_HEADER', 'VENDOR'], explanation: 'sum' })) } } });
  assert.equal(r.llmAttempted, true); assert.equal(r.engineUsed, 'offline+llm'); assert.ok(r.llmSql.startsWith('SELECT VENDOR.VENDOR_NAME')); assert.match(r.sql, /SUM/);
});
test('AI/LLM returning unsafe or non-schema SQL is rejected; offline result kept', async () => {
  const r = await gen('approved invoices', { deps: { llm: { config: llmCfg(), apiKey: 'sk-x-0123456789abcdef', vaultLocked: false, fetchImpl: okFetch('{"sql":"DELETE FROM INVOICE_HEADER"}') } } });
  assert.ok(r.errors.some((e) => e.code === 'AI_LLM_RESPONSE_REJECTED')); assert.equal(r.llmSql, null); assert.match(r.sql, /STATUS = 'A'/);
  assert.ok(validateLlmSql('SELECT FAKE.X FROM FAKE', CORE_SCHEMA).length > 0);
});
test('Invalid AI/LLM configuration → clear error, offline still works', async () => {
  const r = await gen('approved invoices', { deps: { llm: { config: llmCfg({ endpoint: 'http://remote.example.com', model: '' }), apiKey: 'k-0123456789', vaultLocked: false } } });
  const e = r.errors.find((x) => x.code === 'AI_LLM_CONFIG_INVALID'); assert.ok(e); assert.ok(e.details.some((d) => /HTTPS/.test(d))); assert.ok(e.details.some((d) => /Model name/.test(d))); assert.match(r.sql, /STATUS = 'A'/);
});
test('AI/LLM unavailable (network error / timeout / 401) → app stays functional; key never in messages', async () => {
  const net = await gen('approved invoices', { deps: { llm: { config: llmCfg(), apiKey: 'sk-secret-0123456789abcdef', vaultLocked: false, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } } } });
  assert.ok(net.errors.some((e) => e.code === 'AI_LLM_REQUEST_FAILED')); assert.match(net.sql, /STATUS = 'A'/);
  const to = await gen('approved invoices', { deps: { llm: { config: llmCfg({ timeoutMs: 2000 }), apiKey: 'sk-secret-0123456789abcdef', vaultLocked: false, fetchImpl: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } } } });
  assert.ok(to.errors.some((e) => /did not respond/.test(e.message)));
  const unauth = await gen('approved invoices', { deps: { llm: { config: llmCfg(), apiKey: 'sk-secret-0123456789abcdef', vaultLocked: false, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Incorrect API key provided: sk-secret-0123456789abcdef' } }) }) } } });
  const msg = unauth.errors.map((e) => e.message).join(' '); assert.match(msg, /HTTP 401/); assert.doesNotMatch(msg, /sk-secret-0123456789abcdef/);
  const locked = await gen('approved invoices', { deps: { llm: { config: llmCfg(), apiKey: null, vaultLocked: true } } }); assert.match(locked.llmStatus, /Secret Vault is locked/);
});
test('Migration: V16 Online AI/NLP Endpoint becomes an AI / LLM Model (custom endpoint) once', () => {
  const m = new Map(); const kv = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  const r = llm.migrateFromV16Endpoint(kv, 'https://nlp.example.com/parse'); assert.equal(r.migrated, true); assert.equal(r.config.provider, 'custom-endpoint'); assert.equal(r.config.enabled, true);
  assert.equal(llm.migrateFromV16Endpoint(kv, 'https://other').migrated, false); assert.equal(llm.validateLlmConfig(r.config, false).length, 0);
  assert.ok(!m.get(llm.LLM_CONFIG_KEY).includes('apiKey'), 'no API key in localStorage');
});
test('Provider request shapes (OpenAI-compatible, Azure, Anthropic, custom)', () => {
  const p = { system: 's', user: 'u' };
  assert.equal(llm.buildLlmRequest(llmCfg(), 'k', p, '').url, 'https://llm.example.com/v1/chat/completions');
  const az = llm.buildLlmRequest(llmCfg({ provider: 'azure-openai', endpoint: 'https://r.openai.azure.com', deployment: 'd1', apiVersion: '2024-06-01' }), 'k', p, ''); assert.match(az.url, /openai\/deployments\/d1\/chat\/completions\?api-version=2024-06-01/); assert.equal(az.init.headers['api-key'], 'k');
  const an = llm.buildLlmRequest(llmCfg({ provider: 'anthropic', endpoint: 'https://api.anthropic.com' }), 'k', p, ''); assert.equal(an.url, 'https://api.anthropic.com/v1/messages'); assert.equal(an.init.headers['x-api-key'], 'k');
  assert.deepEqual(llm.parseLlmResponse('anthropic', { content: [{ type: 'text', text: '```json\n{"sql":"SELECT 1"}\n```' }] }).sql, 'SELECT 1');
  assert.deepEqual(llm.parseLlmResponse('custom-endpoint', { tables: ['VENDOR'], columns: [] }).tables, ['VENDOR']);
});
