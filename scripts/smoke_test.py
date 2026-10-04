"""Real-browser end-to-end smoke test for dist/index.html (V17.0) — headless Chromium via Playwright.
Usage: python3 scripts/smoke_test.py   (set CHROMIUM_PATH to use a specific Chromium binary)."""
import os, sys, json, tempfile, re
from playwright.sync_api import sync_playwright
DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'dist', 'index.html')
URL = 'file://' + DIST
TOKEN = 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
fails, passes = [], []
def check(cond, msg):
    (passes if cond else fails).append(msg); print(('PASS ' if cond else 'FAIL ') + msg)
def go(pg, route):
    pg.evaluate(f"window.location.hash = '{route}'"); pg.wait_for_timeout(250)
with sync_playwright() as p:
    kw = {'executable_path': os.environ['CHROMIUM_PATH']} if os.environ.get('CHROMIUM_PATH') else {}
    b = p.chromium.launch(args=['--no-sandbox'], **kw)
    ctx = b.new_context(viewport={'width': 1366, 'height': 900})
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('dialog', lambda d: d.accept())
    pg.goto(URL); pg.wait_for_timeout(600)
    check(pg.locator('.navbar').count() == 1, 'App shell renders from file:// (single self-contained file)')
    check('V17' in pg.inner_text('.navbar') and 'Version 17.0.0' in pg.inner_text('.app-footer'), 'Version V17 shown in navbar and footer')
    # navigation
    for route, marker in [('readonly', 'Read Only Query Builder'), ('cr', 'Query Builder for CR'), ('schema-used', 'Tables & Views in Active Schema'), ('error-rectifier', 'Error Rectifier'), ('about', 'V17.0'), ('quickstart', 'Welcome')]:
        go(pg, route); check(marker in pg.inner_text('main'), f'Page renders: {route}')
    pg.click('#navToggle'); pg.wait_for_timeout(150); check(pg.locator('.hamburger-panel').count() == 1, 'Hamburger navigation opens')
    pg.click('.hb-group-toggle'); pg.wait_for_timeout(100); pg.click('[data-route="readonly"]'); pg.wait_for_timeout(300)
    check('Read Only Query Builder' in pg.inner_text('main') and pg.locator('.hamburger-panel').count() == 0, 'Navigation via hamburger works and closes the menu')
    # equal card widths (V16.1)
    boxes = [pg.locator('.builder-grid-top .builder-panel').nth(i).bounding_box() for i in range(2)]
    check(abs(boxes[0]['width'] - boxes[1]['width']) < 4, 'Top cards on Read Only builder have equal widths (V16.1)')
    # manual selectors
    pg.click('#tablePickerMount .picker-row[data-table="VENDOR"]'); pg.wait_for_timeout(150)
    check('FROM VENDOR' in pg.inner_text('#sqlBlockMount .sql-output'), 'Manual table selection generates SQL')
    pg.locator('#columnPickerMount .column-row[data-column="VENDOR_NAME"] .column-checkbox').click(); pg.wait_for_timeout(150)
    check('VENDOR.VENDOR_NAME' in pg.inner_text('#sqlBlockMount .sql-output'), 'Manual column selection generates SQL')
    pg.click('#btnClearSql'); pg.wait_for_timeout(200)
    # Describe what you need (offline NLU)
    pg.fill('#nlDesc', 'top 5 vendors by total invoice amount for approved invoices in 2025'); pg.select_option('#dialectSelect', 'Oracle'); pg.wait_for_timeout(100)
    pg.click('#nlBuildBtn'); pg.wait_for_timeout(700)
    sql = pg.inner_text('#sqlBlockMount .sql-output')
    for frag in ['SUM(INVOICE_HEADER.INVOICE_AMOUNT)', "INVOICE_HEADER.STATUS = 'A'", "DATE '2025-01-01'", 'GROUP BY VENDOR.VENDOR_NAME', 'ORDER BY SUM(INVOICE_HEADER.INVOICE_AMOUNT) DESC', 'FETCH FIRST 5 ROWS ONLY']:
        check(frag in sql, f'Describe → SQL contains {frag}')
    check('Offline NLU' in pg.inner_text('#nlNotes'), 'Engine badge shows Offline NLU (no AI/LLM configured)')
    check(pg.locator('#roIssues .issue-box:not(.warn)').count() == 0, 'No error box when there is no error (Read Only)')
    pg.fill('#nlDesc', 'show invoices with VENDOR_CODE'); pg.click('#nlBuildBtn'); pg.wait_for_timeout(500)
    check('Column not found in the Active Schema' in pg.inner_text('#nlNotes') and 'VENDOR_CODE' not in pg.inner_text('#sqlBlockMount .sql-output'), 'Unknown column reported clearly and not added to SQL')
    pg.click('#btnClearSql'); pg.wait_for_timeout(150)
    pg.fill('#nlDesc', 'approved invoices with vendor name'); pg.click('#nlBuildBtn'); pg.wait_for_timeout(500)
    # Advanced options auto/manual
    pg.click('[data-tour="tab-advanced"]'); pg.wait_for_timeout(200)
    check(pg.locator('[data-v17-auto-options]').count() == 1, 'Advanced Options shows the automatic/manual strip')
    for el in ['#advDistinct', '#advGroupBy', '#advHaving', '#advLimit', '#advRecursive', '#addCteBtn', '#addManualCaseBtn', '#addManualDecodeBtn']:
        check(pg.locator(el).count() == 1, f'Existing Advanced Option present: {el}')
    pg.fill('#advLimit', '25'); pg.wait_for_timeout(150)
    check('FETCH FIRST 25 ROWS ONLY' in pg.inner_text('#sqlBlockMount .sql-output'), 'Manual LIMIT reflected in SQL')
    check('Under manual control' in pg.inner_text('[data-v17-auto-options]'), 'Editing LIMIT marks it as manual')
    pg.click('#addCteBtn'); pg.wait_for_timeout(100); pg.fill('.cte-body-input', 'SELECT 1 FROM DUAL'); pg.wait_for_timeout(150)
    check(pg.inner_text('#sqlBlockMount .sql-output').startswith('WITH cte_1 AS'), 'CTE option still works')
    pg.click('#addManualCaseBtn'); pg.wait_for_timeout(150); pg.fill('.when-expr', "INVOICE_HEADER.STATUS = 'A'"); pg.fill('.when-then', 'Yes'); pg.fill('#caseAlias', 'IS_APPROVED'); pg.click('#caseSave'); pg.wait_for_timeout(200)
    check('AS IS_APPROVED' in pg.inner_text('#sqlBlockMount .sql-output'), 'Manual CASE column still works')
    # Accept & learn
    pg.click('#btnAcceptLearn'); pg.wait_for_timeout(200)
    check(pg.inner_html('#v17AcceptErrors').strip() == '', 'Accept & Learn opens with no error box')
    pg.click('#v17AcceptOk'); pg.wait_for_timeout(300)
    check(pg.evaluate("() => JSON.parse(localStorage.getItem('sqla.learning.v17')||'{\"records\":[]}').records.length") >= 1, 'Accepted query stored as learned knowledge')
    # CR builder
    go(pg, 'cr'); pg.select_option('#crTableSelect', 'INVOICE_HEADER'); pg.wait_for_timeout(150); pg.click('.seg-btn:has-text("DELETE")'); pg.wait_for_timeout(150)
    check('WHERE condition is required' in pg.inner_text('#crSqlMount .sql-output'), 'CR builder: DELETE without WHERE blocked')
    pg.fill('#crNlDesc', 'Update invoice 1234 status to Approved'); pg.click('#crNlBuildBtn'); pg.wait_for_timeout(400)
    crsql = pg.inner_text('#crSqlMount .sql-output'); check("SET STATUS = 'A'" in crsql and 'INVOICE_ID = 1234' in crsql, 'CR builder: description interpreted into UPDATE … WHERE')
    # Error rectifier
    go(pg, 'error-rectifier'); pg.fill('#errSqlText', 'SELECT INVOICE_AMMOUNT FROM INVOICE_HEADER'); pg.fill('#errText', 'ORA-00904: "INVOICE_AMMOUNT": invalid identifier'); pg.click('#rectifyBtn'); pg.wait_for_timeout(150)
    check('Review' in pg.inner_text('#rectifiedOutput'), 'Error Rectifier works')
    # Settings lock screen (V16.2)
    go(pg, 'settings')
    check(pg.eval_on_selector('#settingsPwError', 'e => e.innerHTML').strip() == '', 'Settings password error box is empty on load (V16.2)')
    pg.fill('#settingsPwInput', 'wrong'); pg.click('#settingsUnlockBtn'); pg.wait_for_timeout(500)
    check('Incorrect password' in pg.inner_text('#settingsPwError'), 'Wrong password shows an error')
    pg.fill('#settingsPwInput', ''); check(pg.eval_on_selector('#settingsPwError', 'e => e.innerHTML').strip() == '', 'Error clears when editing')
    pg.fill('#settingsPwInput', 'admin'); pg.click('#settingsUnlockBtn')
    pg.wait_for_selector('#settingsTabsMount', timeout=20000); pg.wait_for_timeout(300)
    tabs = pg.locator('.tab-btn').all_inner_texts()
    check(tabs == ['Security', 'Manual Schema Update', 'Schema Management', 'Secret Vault', 'Synchronization', 'AI / LLM Model', 'Danger Zone'], 'All Settings tabs present; "AI / NLP Engine" replaced by "AI / LLM Model"')
    # Manual Schema Update: edit + delete one row
    pg.click('.tab-btn:has-text("Manual Schema Update")'); pg.wait_for_timeout(200)
    pg.select_option('#editorModuleSelect', 'Vendors'); pg.wait_for_timeout(100); pg.select_option('#editorTableSelect', 'VENDOR'); pg.wait_for_timeout(200)
    pg.click('tr[data-row-id="VENDOR::COUNTRY"]'); pg.wait_for_timeout(100); pg.click('#editRowBtn'); pg.wait_for_timeout(200)
    pg.fill('#f_columnDescription', 'ISO 3166 alpha-2 country (edited in V17 smoke test)'); pg.click('#rowFormSave'); pg.wait_for_timeout(500)
    reg = pg.evaluate("() => JSON.parse(localStorage.getItem('sqla.registry.v15'))")
    core = [s for s in reg['schemas'] if s['id'] == reg['activeSchemaId']][0]; ven = [t for t in core['tables'] if t['name'] == 'VENDOR'][0]
    check([c for c in ven['columns'] if c['name'] == 'COUNTRY'][0]['description'].startswith('ISO 3166'), 'Edit row persisted to centralized schema registry')
    other = [s for s in reg['schemas'] if s['id'] != reg['activeSchemaId']][0]
    check([c for c in [t for t in other['tables'] if t['name'] == 'VENDOR'][0]['columns'] if c['name'] == 'COUNTRY'][0]['description'] == 'ISO country code.', 'Edit did not touch unrelated schema')
    pg.click('tr[data-row-id="VENDOR::COUNTRY"]'); pg.click('#editRowBtn'); pg.wait_for_timeout(150); pg.fill('#f_columnName', 'BAD NAME'); pg.click('#rowFormSave'); pg.wait_for_timeout(300)
    check('not a valid identifier' in pg.inner_text('#rowFormIssues'), 'Malformed record rejected with a specific message'); pg.click('#rowFormCancel'); pg.wait_for_timeout(100)
    pg.click('tr[data-row-id="VENDOR::DUNS_NUMBER"]'); pg.click('#deleteRowBtn'); pg.wait_for_timeout(150); pg.click('#c1Continue'); pg.wait_for_timeout(150); pg.click('#c2Continue'); pg.wait_for_timeout(150)
    check(pg.eval_on_selector('#c3Error', 'e => e.innerHTML').strip() == '', 'Delete confirmation error box empty on open (V16.2)')
    pg.fill('#c3Password', 'admin'); pg.click('#c3Delete'); pg.wait_for_timeout(600)
    check(pg.locator('tr[data-row-id="VENDOR::DUNS_NUMBER"]').count() == 0 and pg.locator('tr[data-row-id="VENDOR::COUNTRY"]').count() == 1, 'Delete removed only the selected row')
    pg.click('tr[data-row-id="VENDOR::VENDOR_ID"]'); pg.click('#deleteRowBtn'); pg.wait_for_timeout(150); pg.click('#c1Continue'); pg.wait_for_timeout(150); pg.click('#c2Continue'); pg.wait_for_timeout(150); pg.fill('#c3Password', 'admin'); pg.click('#c3Delete'); pg.wait_for_timeout(600)
    check(pg.locator('#v17DepContinue').count() == 1 and 'Relationship' in pg.inner_text('.modal-body'), 'Deleting a referenced column asks about dependent records')
    pg.click('#v17DepCancel'); pg.wait_for_timeout(300)
    check(pg.locator('tr[data-row-id="VENDOR::VENDOR_ID"]').count() == 1, 'Cancelled dependent delete leaves schema unchanged')
    # Schema management: import
    pg.click('.tab-btn:has-text("Schema Management")'); pg.wait_for_timeout(200)
    check(pg.inner_html('#syncErrorMount').strip() == '', 'Sync error indicator empty with no sync error')
    imp = {'id': 'schema-smoke', 'name': 'Smoke Import', 'version': '1.0', 'tables': [{'name': 'EXT_ORDERS', 'module': 'External', 'description': 'x', 'columns': [{'name': 'ORDER_ID', 'label': 'Order ID', 'type': 'INTEGER', 'nullable': False, 'isPrimaryKey': True, 'description': 'PK'}, {'name': 'CUSTOMER', 'label': 'Customer', 'type': 'VARCHAR2', 'nullable': False, 'description': 'c'}]}], 'relationships': []}
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f: json.dump(imp, f); tmp = f.name
    pg.set_input_files('#importSchemaFile', tmp); pg.wait_for_selector('#schemaNameConfirm'); check(pg.eval_on_selector('#schemaNameError', 'e => e.innerHTML').strip() == '', 'Schema-name error box empty by default (V16.2)')
    pg.click('#schemaNameConfirm'); pg.wait_for_timeout(400); check('Imported as' in pg.inner_text('#importSchemaPreview'), 'Schema import with real-world data types succeeds'); os.remove(tmp)
    # Secret vault: token masked; V17 push -> repository unreachable in sandbox -> specific error, no token leak
    pg.click('.tab-btn:has-text("Secret Vault")'); pg.wait_for_timeout(200)
    pg.click('#changeTokenBtn'); pg.fill('#newTokenInput', TOKEN); pg.click('#saveTokenBtn'); pg.wait_for_timeout(800)
    check(TOKEN not in pg.inner_text('body') and 'Q7r8' in pg.inner_text('#maskedToken'), 'GitHub token saved and shown masked only')
    check(TOKEN not in pg.evaluate("() => JSON.stringify(localStorage)"), 'Token not stored in plain text in browser storage')
    check(pg.locator('[data-v17-vault-sync]').count() == 1, 'V17 encrypted vault sync section present')
    pg.fill('#v17VaultPass', 'Correct-Horse-42-Battery'); pg.fill('#v17VaultPass2', 'Correct-Horse-42-Battery'); pg.click('#pushVaultBtn')
    pg.wait_for_function("() => document.querySelector('#v17VaultResult').innerText.length > 0", timeout=30000)
    vt = pg.inner_text('#v17VaultResult'); check(('Repository synchronization failed' in vt or 'pushed to the repository' in vt) and TOKEN not in vt, 'Push gives specific feedback without exposing the token')
    # AI/LLM tab
    pg.click('.tab-btn:has-text("AI / LLM Model")'); pg.wait_for_timeout(200)
    check('Offline NLU (V17): always active' in pg.inner_text('#tabPanel'), 'AI / LLM tab shows offline engine as primary')
    pg.check('#v17LlmEnabled'); pg.fill('#v17LlmEndpoint', 'http://remote.example.com'); pg.click('#v17LlmSave'); pg.wait_for_timeout(200)
    check('AI/LLM configuration invalid' in pg.inner_text('#v17LlmResult'), 'Invalid AI/LLM configuration gives a clear error')
    # other settings tabs render
    for t in ['Security', 'Synchronization', 'Danger Zone']:
        pg.click(f'.tab-btn:has-text("{t}")'); pg.wait_for_timeout(200); check(pg.locator('#tabPanel').inner_text().strip() != '', f'Settings tab renders: {t}')
    # reload persistence
    pg.reload(); pg.wait_for_timeout(700); go(pg, 'schema-used')
    _t = pg.inner_text('#tablesReadOnlyList')
    _desc = pg.evaluate("() => { const r = JSON.parse(localStorage.getItem('sqla.registry.v15')); const s = r.schemas.find(x => x.id === r.activeSchemaId); return s.tables.find(t => t.name === 'VENDOR').columns.find(c => c.name === 'COUNTRY').description; }")
    check(_desc.startswith('ISO 3166') and 'DUNS_NUMBER' not in _t and 'COUNTRY' in _t, 'Schema edits/deletes survive reload and appear on Schema page')
    check('Smoke Import' in pg.inner_text('main'), 'Imported schema survives reload')
    # generate after delete uses modified schema
    go(pg, 'readonly'); pg.fill('#nlDesc', 'vendors with duns number'); pg.click('#nlBuildBtn'); pg.wait_for_timeout(500)
    check('DUNS_NUMBER' not in pg.inner_text('#sqlBlockMount .sql-output'), 'SQL generation respects deleted schema record')
    # theme, tour, responsive
    pg.click('#themeBtn'); pg.click('[data-theme-choice="dark"]'); pg.wait_for_timeout(100); check(pg.evaluate("() => document.documentElement.getAttribute('data-theme')") == 'dark', 'Theme switch works')
    pg.screenshot(path=os.path.join(os.path.dirname(DIST), '..', 'docs', 'screenshot-readonly-dark.png'), full_page=False)
    pg.click('#themeBtn'); pg.click('[data-theme-choice="light"]')
    pg.click('#tourBtnNav'); pg.wait_for_timeout(400); check(pg.locator('.tour-popup').count() == 1, 'Guided walkthrough starts'); pg.click('#tourExit')
    pg.set_viewport_size({'width': 390, 'height': 800}); go(pg, 'readonly'); pg.wait_for_timeout(200)
    check(pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), 'Responsive: no horizontal overflow on mobile width')
    pg.set_viewport_size({'width': 1366, 'height': 900}); go(pg, 'readonly'); pg.wait_for_timeout(200)
    pg.screenshot(path=os.path.join(os.path.dirname(DIST), '..', 'docs', 'screenshot-readonly.png'), full_page=True)
    b.close()
benign = re.compile(r'(api\.github\.com|Failed to load resource|ERR_|net::|CORS|Access to fetch)', re.I)
real = [e for e in errs if not benign.search(e)]
check(not real, 'No unexpected console errors' + (': ' + ' | '.join(real[:5]) if real else ''))
print(f'\n{len(passes)} passed, {len(fails)} failed'); sys.exit(1 if fails else 0)
