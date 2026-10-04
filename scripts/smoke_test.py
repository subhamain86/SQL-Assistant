"""Real-browser end-to-end test of SQL Assistant (V17.2) — headless Chromium via Playwright.
GitHub is simulated at the network layer (page.route), so the full UI → GitHub → UI synchronisation path is exercised,
including a stale (pre-push) copy of the repository file being served after a push.
Usage: python3 scripts/smoke_test.py [--http] [--target dev]
   --http        serve the build over http:// instead of opening it from disk (file://)
   --target dev  test the development build (dev-dist/index.html) instead of the production build (dist/index.html)
   CHROMIUM_PATH selects a Chromium binary."""
import os, sys, json, base64, re, threading, functools, http.server, socketserver, urllib.parse
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = 'dev-dist' if '--target' in sys.argv and sys.argv[sys.argv.index('--target') + 1] == 'dev' else 'dist'
DIST = os.path.join(ROOT, TARGET)
REPO = 'subhamain86/Basware-AP-SQL-Assistant'; PATH = 'sql-assistant-data/schemas/registry.json'
TOKEN = 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'; PASSPHRASE = 'Correct-Horse-42-Battery'
fails, passes = [], []
def check(cond, msg): (passes if cond else fails).append(msg); print(('PASS ' if cond else 'FAIL ') + msg)
URL = 'file://' + os.path.join(DIST, 'index.html')
if '--http' in sys.argv:
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIST); handler.log_message = lambda *a: None
    srv = socketserver.TCPServer(('127.0.0.1', 0), handler); threading.Thread(target=srv.serve_forever, daemon=True).start()
    URL = f'http://127.0.0.1:{srv.server_address[1]}/index.html'
# ---------------------------------------------------------------- fake GitHub (with history for stale-copy simulation)
files, history = {}, {}; sha_n = [0]; mode = {'v': None, 'stale': 0}
def gh_put(path, text):
    if path in files: history[path] = files[path]
    sha_n[0] += 1; files[path] = {'content': text, 'sha': f'sha{sha_n[0]}'}
def gh_route(route):
    req = route.request; cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS'}
    if req.method == 'OPTIONS': return route.fulfill(status=204, headers=cors)
    if mode['v'] == '401': return route.fulfill(status=401, headers=cors, json={'message': 'Bad credentials'})
    m = re.match(r'https://api\.github\.com/repos/[^/]+/[^/]+/contents/([^?]+)', req.url)
    p = '/'.join(urllib.parse.unquote(s) for s in m.group(1).split('/'))
    f = files.get(p)
    if req.method == 'GET':
        if mode['stale'] > 0 and p in history: mode['stale'] -= 1; f = history[p]
        if not f: return route.fulfill(status=404, headers=cors, json={'message': 'Not Found'})
        return route.fulfill(status=200, headers=cors, json={'type': 'file', 'sha': f['sha'], 'size': len(f['content'].encode()), 'encoding': 'base64', 'content': base64.b64encode(f['content'].encode()).decode()})
    if req.method == 'PUT':
        body = json.loads(req.post_data)
        if f and body.get('sha') != f['sha']: return route.fulfill(status=409, headers=cors, json={'message': 'sha mismatch'})
        gh_put(p, base64.b64decode(body['content']).decode()); return route.fulfill(status=200, headers=cors, json={'content': {'sha': files[p]['sha']}})
    return route.fulfill(status=405, headers=cors)
def go(pg, route): pg.evaluate(f"window.location.hash = '{route}'"); pg.wait_for_timeout(250)
def unlock(pg):
    go(pg, 'settings'); pg.fill('#settingsPwInput', 'admin'); pg.click('#settingsUnlockBtn'); pg.wait_for_selector('#settingsTabsMount', timeout=20000); pg.wait_for_timeout(300)
def set_token(pg):
    pg.click('.tab-btn:has-text("Secret Vault")'); pg.wait_for_timeout(200); pg.click('#changeTokenBtn'); pg.fill('#newTokenInput', TOKEN); pg.click('#saveTokenBtn'); pg.wait_for_timeout(700)
def schema_mgmt(pg): pg.click('.tab-btn:has-text("Schema Management")'); pg.wait_for_timeout(300)
def sql(pg): return pg.inner_text('#sqlBlockMount .sql-output')
def describe(pg, text, dialect=None):
    pg.click('#btnClearSql'); pg.wait_for_timeout(150); pg.fill('#nlDesc', text)
    if dialect: pg.select_option('#dialectSelect', dialect)
    pg.click('#nlBuildBtn'); pg.wait_for_timeout(600)
console_all = []
with sync_playwright() as p:
    kw = {'executable_path': os.environ['CHROMIUM_PATH']} if os.environ.get('CHROMIUM_PATH') else {}
    b = p.chromium.launch(args=['--no-sandbox'], **kw)
    ctx = b.new_context(viewport={'width': 1366, 'height': 900}); ctx.route('https://api.github.com/**', gh_route)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e))); pg.on('console', lambda m: (console_all.append(m.text), errs.append(m.text) if m.type == 'error' else None)); pg.on('dialog', lambda d: d.accept())
    pg.goto(URL); pg.wait_for_timeout(700)
    print(f'--- Testing {URL}')
    check(pg.locator('.navbar').count() == 1 and pg.inner_text('main').strip() != '', 'App starts — no blank screen')
    nav = pg.inner_text('.navbar')
    check(pg.title() == 'SQL Assistant' and 'SQL Assistant' in nav and 'AP-SQL' not in nav and 'AP SQL' not in pg.content(), 'Application name is "SQL Assistant" (title, navbar, no old name)')
    check('Version 17.2.0' in pg.inner_text('.app-footer'), 'Version 17.2.0 shown in footer metadata')
    for route, marker in [('readonly', 'Read Only Query Builder'), ('cr', 'Query Builder for CR'), ('schema-used', 'Tables & Views in Active Schema'), ('error-rectifier', 'Error Rectifier'), ('about', 'About SQL Assistant'), ('quickstart', 'Welcome')]:
        go(pg, route); check(marker in pg.inner_text('main'), f'Page renders: {route}')
    pg.click('#navToggle'); pg.wait_for_timeout(150); pg.click('.hb-group-toggle'); pg.wait_for_timeout(100); pg.click('[data-route="readonly"]'); pg.wait_for_timeout(300)
    check('Read Only Query Builder' in pg.inner_text('main') and pg.locator('.hamburger-panel').count() == 0, 'Hamburger navigation works')
    boxes = [pg.locator('.builder-grid-top .builder-panel').nth(i).bounding_box() for i in range(2)]
    check(abs(boxes[0]['width'] - boxes[1]['width']) < 4, 'Layout unchanged: equal top-card widths')
    # ---------------- Manual Selectors
    pg.click('#tablePickerMount .picker-row[data-table="VENDOR"]'); pg.wait_for_timeout(150)
    pg.locator('#columnPickerMount .column-row[data-column="VENDOR_NAME"] .column-checkbox').click(); pg.wait_for_timeout(150)
    check('VENDOR.VENDOR_NAME' in sql(pg), 'Manual Selectors: tables + columns generate SQL')
    pg.click('#filterBuilderMount .add-filter-btn'); pg.wait_for_timeout(100); pg.select_option('#filterBuilderMount .op-select', 'NOT LIKE'); pg.fill('#filterBuilderMount .val-input', '%test%'); pg.wait_for_timeout(150)
    check("NOT LIKE '%test%'" in sql(pg), 'Manual Selectors: filters (NOT LIKE)')
    # ---------------- Describe What You Need (offline NLU)
    describe(pg, 'Show all invoices created in the last 30 days where the supplier country is Finland and sort them by invoice date descending.', 'Generic')
    s = sql(pg)
    check(all(f in s for f in ['FROM INVOICE_HEADER', 'INNER JOIN VENDOR', "VENDOR.COUNTRY = 'FI'", "INVOICE_DATE >= CURRENT_DATE - INTERVAL '30 DAY'", 'ORDER BY INVOICE_HEADER.INVOICE_DATE DESC']), 'Specification example → correct SQL (join, ISO country mapping, relative date, sort)')
    check('Offline NLU' in pg.inner_text('#nlNotes') and 'Active Schema used: AP / P2P Core' in pg.inner_text('#nlNotes'), 'Offline NLU badge + active schema audit line')
    describe(pg, 'top 5 vendors by total invoice amount for approved invoices in 2025', 'Oracle')
    s = sql(pg)
    check(all(f in s for f in ['SUM(INVOICE_HEADER.INVOICE_AMOUNT)', "INVOICE_HEADER.STATUS = 'A'", "DATE '2025-01-01'", 'GROUP BY VENDOR.VENDOR_NAME', 'FETCH FIRST 5 ROWS ONLY']), 'Complex request → aggregation, grouping, date range, limit')
    check(pg.locator('#roIssues .issue-box:not(.warn)').count() == 0, 'No error box when there is no error')
    describe(pg, 'show invoices with VENDOR_CODE', 'Generic')
    check('VENDOR_CODE' not in sql(pg) and 'could not be identified as a column' in pg.inner_text('#nlNotes'), 'Unknown field reported, never added to SQL')
    # ---------------- Advanced Options
    describe(pg, 'approved invoices with vendor name')
    pg.click('[data-tour="tab-advanced"]'); pg.wait_for_timeout(200)
    check(all(pg.locator(x).count() == 1 for x in ['#advDistinct', '#advGroupBy', '#advHaving', '#advLimit', '#advRecursive', '#addCteBtn', '#addManualCaseBtn', '#addManualDecodeBtn', '#advTableAliases', '#advJoinType', '#joinPathList']) and pg.locator('[data-v17-auto-options]').count() == 1, 'All Advanced Options present (incl. table aliases, join type, join paths) + auto/manual strip')
    pg.check('#advTableAliases'); pg.wait_for_timeout(150); s = sql(pg)
    check('FROM INVOICE_HEADER ih' in s and 'INNER JOIN VENDOR v ON ih.VENDOR_ID = v.VENDOR_ID' in s and "ih.STATUS = 'A'" in s, 'Advanced Options: table aliases')
    pg.select_option('#advJoinType', 'LEFT JOIN'); pg.wait_for_timeout(150)
    check('LEFT JOIN VENDOR v' in sql(pg), 'Advanced Options: join type (LEFT JOIN)')
    check('INVOICE_HEADER' in pg.inner_text('#joinPathList') and 'VENDOR' in pg.inner_text('#joinPathList'), 'Advanced Options: join paths listed')
    check('Table aliases' in pg.inner_text('[data-v17-auto-options]') and 'Join type' in pg.inner_text('[data-v17-auto-options]'), 'Manual changes take manual control (shown in strip)')
    pg.check('#advDistinct'); pg.fill('#advLimit', '25'); pg.wait_for_timeout(150); s = sql(pg)
    check('SELECT DISTINCT' in s and 'LIMIT 25' in s, 'Advanced Options: DISTINCT + LIMIT')
    pg.click('#btnValidateSql'); pg.wait_for_timeout(150)
    check('passed validation' in pg.inner_text('#validationMount'), 'Generated aliased SQL passes validation (alias-aware)')
    # ---------------- learning from a corrected query
    pg.click('#btnClearSql'); pg.wait_for_timeout(150)
    describe(pg, 'vendor country list')
    pg.click('#btnAcceptLearn'); pg.wait_for_timeout(200)
    pg.fill('#v17AcceptSql', 'SELECT VENDOR.VENDOR_NAME, VENDOR.COUNTRY FROM VENDOR ORDER BY VENDOR.COUNTRY DESC;'); pg.click('#v17AcceptOk'); pg.wait_for_timeout(300)
    rec = pg.evaluate("() => JSON.parse(localStorage.getItem('sqla.learning.v17')||'{\"records\":[]}').records")
    check(any(r.get('outcome') == 'modified' and r.get('engineVersion') == 'offline-nlu-17.2' and r.get('features') for r in rec), 'Accept & Learn stores the corrected example with features, outcome and engine version')
    describe(pg, 'vendor country list please')
    check('ORDER BY VENDOR.COUNTRY DESC' in sql(pg) and pg.locator('[data-v17-learned]').count() == 1, 'Learned correction reused for a similar request (and shown as learned)')
    go(pg, 'cr'); pg.fill('#crNlDesc', 'Update invoice 1234 status to Approved'); pg.click('#crNlBuildBtn'); pg.wait_for_timeout(400)
    check("INVOICE_ID = 1234" in pg.inner_text('#crSqlMount .sql-output'), 'CR builder works')
    # ---------------- Settings
    go(pg, 'settings'); check(pg.eval_on_selector('#settingsPwError', 'e => e.innerHTML').strip() == '', 'Settings password error box empty on load')
    unlock(pg)
    check(pg.locator('.tab-btn').all_inner_texts() == ['Security', 'Manual Schema Update', 'Schema Management', 'Secret Vault', 'Synchronization', 'AI/LLM Model', 'Danger Zone'], 'Settings tabs unchanged; "AI/LLM Model" replaces Online AI/NLP Endpoint')
    set_token(pg); check(TOKEN not in pg.inner_text('body') and TOKEN not in pg.evaluate('() => JSON.stringify(localStorage)'), 'Token masked and never stored in plain text')
    schema_mgmt(pg); check(pg.inner_html('#schemaHealthMount').strip() == '', 'Schema health panel renders nothing when everything is valid')
    pg.click('.advanced-sync-details summary'); pg.click('#pushRegistryBtn'); pg.wait_for_timeout(1200)
    check('pushed to GitHub successfully' in pg.inner_text('#registrySyncResult'), 'Push All Schemas → repository (Local → Repository)')
    pushed = json.loads(files[PATH]['content']); check(pushed.get('formatVersion') == 2 and pushed.get('writtenBy') == 'SQL Assistant 17.2.0' and pushed.get('writtenByDevice'), 'Repository file stamped with writer version and device')
    # ---------------- Manual Schema Update (row-wise)
    pg.click('.tab-btn:has-text("Manual Schema Update")'); pg.wait_for_timeout(200)
    pg.select_option('#editorModuleSelect', 'Vendors'); pg.wait_for_timeout(100); pg.select_option('#editorTableSelect', 'VENDOR'); pg.wait_for_timeout(200)
    pg.click('tr[data-row-id="VENDOR::COUNTRY"]'); pg.wait_for_timeout(100)
    check('Selected row: VENDOR.COUNTRY' in pg.inner_text('#selectedRowLabel') and pg.locator('tr.is-selected[data-row-id="VENDOR::COUNTRY"]').count() == 1, 'Row selection: selected row highlighted and identified')
    pg.click('#editRowBtn'); pg.wait_for_timeout(200)
    check('VENDOR' in pg.inner_text('[data-v172-selected-row]') and 'COUNTRY' in pg.inner_text('[data-v172-selected-row]') and pg.is_disabled('#rowFormSave'), 'Edit dialog identifies the selected row; Save disabled until something changes')
    pg.fill('#f_columnDescription', 'ISO «country» — "2 letters" ✓'); pg.wait_for_timeout(100)
    ch = pg.inner_text('[data-v172-row-changes]')
    check('Column Description' in ch and 'ISO country code.' in ch and '→' in ch and not pg.is_disabled('#rowFormSave'), 'Current → modified values shown before saving')
    pg.click('#rowFormReset'); pg.wait_for_timeout(100)
    check(pg.input_value('#f_columnDescription') == 'ISO country code.' and pg.is_disabled('#rowFormSave'), 'Reset restores the current values')
    pg.click('#rowFormCancel'); pg.wait_for_timeout(150)
    check('ISO «country»' not in pg.evaluate("() => localStorage.getItem('sqla.registry.v15')"), 'Cancel changes nothing')
    before_rows = pg.evaluate("() => JSON.stringify(JSON.parse(localStorage.getItem('sqla.registry.v15')).schemas[0].tables.find(t=>t.name==='VENDOR').columns.filter(c=>c.name!=='COUNTRY'))")
    pg.click('#editRowBtn'); pg.wait_for_timeout(200); pg.fill('#f_columnDescription', 'ISO «country» — "2 letters" ✓'); pg.click('#rowFormSave'); pg.wait_for_timeout(2800)
    after_rows = pg.evaluate("() => JSON.stringify(JSON.parse(localStorage.getItem('sqla.registry.v15')).schemas[0].tables.find(t=>t.name==='VENDOR').columns.filter(c=>c.name!=='COUNTRY'))")
    check(before_rows == after_rows, 'Saving updates the selected row only (other rows unchanged)')
    check([c['description'] for t in json.loads(files[PATH]['content'])['schemas'][0]['tables'] if t['name'] == 'VENDOR' for c in t['columns'] if c['name'] == 'COUNTRY'] == ['ISO «country» — "2 letters" ✓'], 'Row change saved centrally and auto-synchronised to the repository')
    check(pg.locator('tr.is-selected[data-row-id="VENDOR::COUNTRY"]').count() == 1, 'Selected row stays selected after saving')
    pg.click('tr[data-row-id="VENDOR::DUNS_NUMBER"]'); pg.click('#deleteRowBtn'); pg.wait_for_timeout(150); pg.click('#c1Continue'); pg.wait_for_timeout(150); pg.click('#c2Continue'); pg.wait_for_timeout(150)
    check(pg.eval_on_selector('#c3Error', 'e => e.innerHTML').strip() == '', 'Delete confirmation error box empty')
    pg.fill('#c3Password', 'admin'); pg.click('#c3Delete'); pg.wait_for_timeout(2800)
    check(pg.locator('tr[data-row-id="VENDOR::DUNS_NUMBER"]').count() == 0 and 'DUNS_NUMBER' not in json.dumps([t for t in json.loads(files[PATH]['content'])['schemas'][0]['tables'] if t['name'] == 'VENDOR']), 'Delete removes the selected row only and the deletion is synchronised')
    pg.click('tr[data-row-id="VENDOR::COUNTRY"]'); pg.click('#editRowBtn'); pg.wait_for_timeout(200); pg.check('#f_isForeignKey'); pg.fill('#f_fkTable', 'NOPE'); pg.fill('#f_fkColumn', 'X'); pg.click('#rowFormSave'); pg.wait_for_timeout(300)
    check('does not exist in this schema' in pg.inner_text('#rowFormIssues'), 'Invalid manual change rejected with a meaningful error'); pg.click('#rowFormCancel'); pg.wait_for_timeout(150)
    rep = json.loads(files[PATH]['content'])
    # ---------------- remote broken by an out-of-date device
    broken = json.loads(json.dumps(rep)); core = broken['schemas'][0]; core['tables'] = [t if t['name'] != 'VENDOR' else {**t, 'columns': [c for c in t['columns'] if c['name'] != 'VENDOR_ID']} for t in core['tables']]
    broken['schemas'].append({**json.loads(json.dumps(rep['schemas'][0])), 'id': 'schema-other-device', 'name': 'Other Device Schema', 'status': 'inactive'})
    broken.pop('writtenBy', None); broken.pop('writtenByDevice', None); broken.pop('formatVersion', None)
    gh_put(PATH, json.dumps(broken))
    schema_mgmt(pg); pg.click('#simpleSyncBtn'); pg.wait_for_timeout(1200)
    res = pg.inner_text('#simpleSyncResult')
    check('failed validation and were not loaded' in res and 'INVOICE_HEADER.VENDOR_ID' in res and 'Invalid column definition' in res and 'your local copies were kept unchanged' in res, 'Invalid remote schema → failing stage + exact record instead of the generic message')
    check('V17.0 or older' in pg.inner_text('[data-v172-origin]') and 'This device: device-' in pg.inner_text('[data-v172-origin]'), 'Rejected data names its source (out-of-date writer) and this device')
    check('Other Device Schema' in pg.inner_text('.schema-list'), 'Valid schemas in the same remote file still load')
    local_core = [x for x in json.loads(pg.evaluate("() => localStorage.getItem('sqla.registry.v15')"))['schemas'] if x['id'] == core['id']][0]
    check(any(c['name'] == 'VENDOR_ID' for t in local_core['tables'] if t['name'] == 'VENDOR' for c in t['columns']), 'Valid local schema NOT overwritten by invalid remote data')
    pg.click('.advanced-sync-details summary'); pg.click('#validateRepoBtn'); pg.wait_for_timeout(900)
    vr = pg.inner_text('#registrySyncResult'); check('3 schema(s): 2 valid, 1 invalid' in vr and 'repairable' in vr and 'This device:' in vr, '"Validate repository file" gives a full diagnostic report')
    pg.click('[data-health="publish"]'); pg.wait_for_timeout(1400)
    check('published to the repository' in pg.inner_text('main'), 'Publish my local copies repairs the repository')
    fixed = json.loads(files[PATH]['content']); check(any(c['name'] == 'VENDOR_ID' for t in fixed['schemas'][0]['tables'] if t['name'] == 'VENDOR' for c in t['columns']), 'Repository now holds the valid copy')
    # ---------------- ROOT CAUSE 1: the pre-repair file is served again (stale cache)
    mode['stale'] = 1; pg.click('#simpleSyncBtn'); pg.wait_for_timeout(1000)
    st = pg.inner_text('#simpleSyncResult')
    check('outdated copy' in st and 'failed validation' not in st and pg.inner_html('#schemaHealthMount').strip() == '', 'Stale copy of the old invalid file is ignored — the error does NOT come back')
    pg.click('#simpleSyncBtn'); pg.wait_for_timeout(1000)
    check('failed validation' not in pg.inner_text('#simpleSyncResult') and pg.inner_html('#syncErrorMount').strip() == '' and pg.inner_html('#schemaHealthMount').strip() == '', 'Normal sync afterwards is clean; no stale error shown')
    gh_put(PATH, '{\n  "schemas": [\n    {"id": "a",},\n  ]\n}'); pg.click('#simpleSyncBtn'); pg.wait_for_timeout(900)
    t = pg.inner_text('#simpleSyncResult'); check('Remote file could not be parsed' in t and 'not valid JSON at line 3' in t and 'trailing comma' in t, 'Corrupted remote JSON → stage + line/column + cause')
    gh_put(PATH, json.dumps(fixed))
    mode['v'] = '401'; pg.click('#simpleSyncBtn'); pg.wait_for_timeout(900); mode['v'] = None
    t = pg.inner_text('#simpleSyncResult'); check('Remote file retrieval failed' in t and 'invalid, expired or revoked' in t and TOKEN not in t, 'Invalid/expired token → stage + specific message, token not exposed')
    pg.click('#simpleSyncBtn'); pg.wait_for_timeout(900); check('invalid, expired' not in pg.inner_text('#simpleSyncResult') and pg.inner_html('#syncErrorMount').strip() == '', 'Successful sync clears the previous error (recovery)')
    # ---------------- AI/LLM, Secret Vault
    pg.click('.tab-btn:has-text("AI/LLM Model")'); pg.wait_for_timeout(200)
    check('Offline NLU: always active (primary/default engine)' in pg.inner_text('#tabPanel') and pg.locator('#v17LlmProvider').count() == 1 and pg.locator('#v17LlmModel').count() == 1 and pg.locator('#v17LlmKey').count() == 1, 'AI/LLM Model tab: provider/model/endpoint/key; offline stays primary')
    pg.check('#v17LlmEnabled'); pg.fill('#v17LlmEndpoint', 'http://remote.example.com'); pg.click('#v17LlmSave'); pg.wait_for_timeout(200)
    check('AI/LLM configuration invalid' in pg.inner_text('#v17LlmResult'), 'Invalid AI/LLM configuration → clear error')
    pg.click('.tab-btn:has-text("Secret Vault")'); pg.wait_for_timeout(200)
    check('not equivalent to a server-side secret vault' in pg.inner_text('[data-v17-vault-sync]'), 'Secret Vault documents its security model honestly')
    pg.fill('#v17VaultPass', PASSPHRASE); pg.fill('#v17VaultPass2', PASSPHRASE); pg.click('#pushVaultBtn')
    pg.wait_for_function("() => document.querySelector('#v17VaultResult').innerText.length > 0", timeout=30000)
    vf = files.get('sql-assistant-data/vault/secret-vault.v17.enc.json', {}).get('content', '')
    check('pushed to the repository' in pg.inner_text('#v17VaultResult') and vf and TOKEN not in vf and base64.b64encode(TOKEN.encode()).decode() not in vf and PASSPHRASE not in vf, 'Push Secret Vault: repository holds AES-GCM ciphertext only (no token, no base64 token, no passphrase)')
    for tname in ['Security', 'Synchronization', 'Danger Zone']: pg.click(f'.tab-btn:has-text("{tname}")'); pg.wait_for_timeout(200); check(pg.locator('#tabPanel').inner_text().strip() != '', f'Settings tab renders: {tname}')
    # ---------------- reload / restart
    pg.reload(); pg.wait_for_timeout(800); go(pg, 'schema-used')
    check('DUNS_NUMBER' not in pg.inner_text('#tablesReadOnlyList') and 'Other Device Schema' in pg.inner_text('main'), 'Schema data persists across reload')
    go(pg, 'readonly'); pg.fill('#nlDesc', 'vendors with duns number'); pg.click('#nlBuildBtn'); pg.wait_for_timeout(500)
    check('DUNS_NUMBER' not in sql(pg), 'SQL generation uses the current (synchronised) schema after restart')
    pg.set_viewport_size({'width': 390, 'height': 800}); go(pg, 'settings'); pg.wait_for_timeout(200)
    check(pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), 'Responsive: no horizontal overflow on mobile')
    pg.set_viewport_size({'width': 1366, 'height': 900})
    # ---------------- device whose LOCAL data was broken by an older version
    legacy = json.loads(json.dumps(fixed)); lc = legacy['schemas'][0]; lc['updatedAt'] = '2030-01-01T00:00:00.000Z'
    lc['tables'] = [t for t in lc['tables'] if t['name'] != 'ORGANIZATION']
    ctx2 = b.new_context(viewport={'width': 1366, 'height': 900}); ctx2.route('https://api.github.com/**', gh_route)
    ctx2.add_init_script("localStorage.getItem('sqla.registry.v15') || localStorage.setItem('sqla.registry.v15', %s);" % json.dumps(json.dumps(legacy)))
    pg2 = ctx2.new_page(); pg2.on('dialog', lambda d: d.accept()); pg2.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e))); pg2.on('console', lambda m: console_all.append(m.text))
    pg2.goto(URL); pg2.wait_for_timeout(700)
    go(pg2, 'readonly'); pg2.fill('#nlDesc', 'invoices with vendor name'); pg2.click('#nlBuildBtn'); pg2.wait_for_timeout(500)
    check('INNER JOIN VENDOR' in pg2.inner_text('#sqlBlockMount .sql-output'), 'Legacy-invalid local schema still loads and generates SQL (nothing dropped)')
    unlock(pg2); set_token(pg2); schema_mgmt(pg2); pg2.click('#simpleSyncBtn'); pg2.wait_for_timeout(1000)
    check(any(x['id'] == lc['id'] and any(t['name'] == 'ORGANIZATION' for t in x['tables']) for x in json.loads(files[PATH]['content'])['schemas']) and not any(t['name'] == 'ORGANIZATION' for x in json.loads(pg2.evaluate("() => localStorage.getItem('sqla.registry.v15')"))['schemas'] if x['id'] == lc['id'] for t in x['tables']), 'Locally edited data is not silently replaced by the remote copy (conflict instead)')
    h = pg2.inner_text('#schemaHealthMount')
    check('does not pass validation' in h and 'ORGANIZATION' in h and pg2.locator('[data-health="repair-local"]').count() == 1, 'Invalid local schema reported with the exact record and a Repair option')
    pg2.click('.advanced-sync-details summary'); pg2.click('#pushRegistryBtn'); pg2.wait_for_timeout(1000)
    check('Not published' in pg2.inner_text('#registrySyncResult') and 'VENDOR.ORG_ID' in pg2.inner_text('#registrySyncResult'), 'Publishing invalid local data is refused with the reason')
    pg2.click('[data-health="repair-local"]'); pg2.wait_for_timeout(300)
    mt = pg2.inner_text('.modal-body'); check('Unlinked foreign key VENDOR.ORG_ID' in mt and 'Removed relationship' in mt, 'Repair preview lists every change before anything is applied')
    pg2.click('#repairApply'); pg2.wait_for_timeout(2800)
    check(pg2.inner_html('#schemaHealthMount').strip() == '', 'After repair the schema validates (health panel gone)')
    ctx2.close()
    # ---------------- secrets never exposed
    pages_text = pg.content()
    check(all(TOKEN not in m and PASSPHRASE not in m for m in console_all) and TOKEN not in pages_text and all(TOKEN not in f['content'] for f in files.values()), 'No secret in browser console, page, or any repository file')
    b.close()
benign = re.compile(r'(Failed to load resource|ERR_|net::|remote\.example\.com)', re.I)
real = [e for e in errs if not benign.search(e)]
check(not real, 'No unexpected console errors or uncaught exceptions' + (': ' + ' | '.join(real[:5]) if real else ''))
build_file = open(os.path.join(DIST, 'index.html'), encoding='utf8').read()
check(not re.search(r'\b(gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{30,})', build_file), 'No credential in the build file')
print(f'\n[{TARGET}] {len(passes)} passed, {len(fails)} failed'); sys.exit(1 if fails else 0)
