"""Real-browser end-to-end test of the built dist/index.html (V17.1) — headless Chromium via Playwright.
GitHub is simulated at the network layer (page.route), so the full UI → GitHub → UI synchronisation path is exercised.
Usage: python3 scripts/smoke_test.py [--http]   (CHROMIUM_PATH selects a Chromium binary; --http serves dist over http://)"""
import os, sys, json, base64, re, tempfile, threading, functools, http.server, socketserver
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); DIST = os.path.join(ROOT, 'dist')
REPO = 'subhamain86/Basware-AP-SQL-Assistant'; PATH = 'sql-assistant-data/schemas/registry.json'
TOKEN = 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
fails, passes = [], []
def check(cond, msg): (passes if cond else fails).append(msg); print(('PASS ' if cond else 'FAIL ') + msg)
URL = 'file://' + os.path.join(DIST, 'index.html')
if '--http' in sys.argv:
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIST); handler.log_message = lambda *a: None
    srv = socketserver.TCPServer(('127.0.0.1', 0), handler); threading.Thread(target=srv.serve_forever, daemon=True).start()
    URL = f'http://127.0.0.1:{srv.server_address[1]}/index.html'
# ---------------------------------------------------------------- fake GitHub
files = {}; sha_n = [0]; mode = {'v': None}
def gh_put(path, text): sha_n[0] += 1; files[path] = {'content': text, 'sha': f'sha{sha_n[0]}'}
def gh_route(route):
    req = route.request; cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS'}
    if req.method == 'OPTIONS': return route.fulfill(status=204, headers=cors)
    if mode['v'] == '401': return route.fulfill(status=401, headers=cors, json={'message': 'Bad credentials'})
    m = re.match(r'https://api\.github\.com/repos/[^/]+/[^/]+/contents/([^?]+)', req.url)
    p = '/'.join(map(lambda s: __import__('urllib.parse').parse.unquote(s), m.group(1).split('/')))
    f = files.get(p)
    if req.method == 'GET':
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
CORE_IDX = None
with sync_playwright() as p:
    kw = {'executable_path': os.environ['CHROMIUM_PATH']} if os.environ.get('CHROMIUM_PATH') else {}
    b = p.chromium.launch(args=['--no-sandbox'], **kw)
    ctx = b.new_context(viewport={'width': 1366, 'height': 900}); ctx.route('https://api.github.com/**', gh_route)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None); pg.on('dialog', lambda d: d.accept())
    pg.goto(URL); pg.wait_for_timeout(700)
    print(f'--- Testing {URL}')
    check(pg.locator('.navbar').count() == 1, 'App starts (single self-contained file)')
    check('V17' in pg.inner_text('.navbar') and 'Version 17.1.0' in pg.inner_text('.app-footer'), 'Version 17.1.0 shown; navbar unchanged ("V17")')
    for route, marker in [('readonly', 'Read Only Query Builder'), ('cr', 'Query Builder for CR'), ('schema-used', 'Tables & Views in Active Schema'), ('error-rectifier', 'Error Rectifier'), ('about', 'V17.1'), ('quickstart', 'Welcome')]:
        go(pg, route); check(marker in pg.inner_text('main'), f'Page renders: {route}')
    pg.click('#navToggle'); pg.wait_for_timeout(150); pg.click('.hb-group-toggle'); pg.wait_for_timeout(100); pg.click('[data-route="readonly"]'); pg.wait_for_timeout(300)
    check('Read Only Query Builder' in pg.inner_text('main') and pg.locator('.hamburger-panel').count() == 0, 'Hamburger navigation works')
    boxes = [pg.locator('.builder-grid-top .builder-panel').nth(i).bounding_box() for i in range(2)]
    check(abs(boxes[0]['width'] - boxes[1]['width']) < 4, 'Layout unchanged: equal top-card widths')
    pg.click('#tablePickerMount .picker-row[data-table="VENDOR"]'); pg.wait_for_timeout(150)
    pg.locator('#columnPickerMount .column-row[data-column="VENDOR_NAME"] .column-checkbox').click(); pg.wait_for_timeout(150)
    check('VENDOR.VENDOR_NAME' in pg.inner_text('#sqlBlockMount .sql-output'), 'Manual Selectors generate SQL')
    pg.click('#btnClearSql'); pg.wait_for_timeout(200)
    pg.fill('#nlDesc', 'top 5 vendors by total invoice amount for approved invoices in 2025'); pg.select_option('#dialectSelect', 'Oracle'); pg.click('#nlBuildBtn'); pg.wait_for_timeout(700)
    sql = pg.inner_text('#sqlBlockMount .sql-output')
    check(all(f in sql for f in ['SUM(INVOICE_HEADER.INVOICE_AMOUNT)', "INVOICE_HEADER.STATUS = 'A'", "DATE '2025-01-01'", 'GROUP BY VENDOR.VENDOR_NAME', 'FETCH FIRST 5 ROWS ONLY']), 'Describe What You Need → complex SQL (offline NLU)')
    check(pg.locator('#roIssues .issue-box:not(.warn)').count() == 0, 'No error box when there is no error')
    pg.click('[data-tour="tab-advanced"]'); pg.wait_for_timeout(200)
    check(all(pg.locator(x).count() == 1 for x in ['#advDistinct', '#advGroupBy', '#advHaving', '#advLimit', '#advRecursive', '#addCteBtn', '#addManualCaseBtn', '#addManualDecodeBtn']) and pg.locator('[data-v17-auto-options]').count() == 1, 'All Advanced Options present + auto/manual strip')
    pg.fill('#advLimit', '25'); pg.wait_for_timeout(150); check('FETCH FIRST 25 ROWS ONLY' in pg.inner_text('#sqlBlockMount .sql-output'), 'Manual Advanced Option reflected in SQL')
    pg.click('#btnAcceptLearn'); pg.wait_for_timeout(200); pg.click('#v17AcceptOk'); pg.wait_for_timeout(300)
    check(pg.evaluate("() => JSON.parse(localStorage.getItem('sqla.learning.v17')||'{\"records\":[]}').records.length") >= 1, 'Accept & Learn stores learned knowledge')
    go(pg, 'cr'); pg.fill('#crNlDesc', 'Update invoice 1234 status to Approved'); pg.click('#crNlBuildBtn'); pg.wait_for_timeout(400)
    check("INVOICE_ID = 1234" in pg.inner_text('#crSqlMount .sql-output'), 'CR builder works')
    # ------------------------------------------------ Settings, Manual Schema Update, GitHub sync
    go(pg, 'settings'); check(pg.eval_on_selector('#settingsPwError', 'e => e.innerHTML').strip() == '', 'Settings password error box empty on load')
    unlock(pg)
    check(pg.locator('.tab-btn').all_inner_texts() == ['Security', 'Manual Schema Update', 'Schema Management', 'Secret Vault', 'Synchronization', 'AI / LLM Model', 'Danger Zone'], 'Settings tabs unchanged')
    set_token(pg); check(TOKEN not in pg.inner_text('body') and TOKEN not in pg.evaluate('() => JSON.stringify(localStorage)'), 'Token masked and never stored in plain text')
    schema_mgmt(pg); check(pg.inner_html('#schemaHealthMount').strip() == '', 'Schema health panel renders nothing when everything is valid')
    pg.click('.advanced-sync-details summary'); pg.click('#pushRegistryBtn'); pg.wait_for_timeout(1200)
    check('pushed to GitHub successfully' in pg.inner_text('#registrySyncResult'), 'Push All Schemas → repository (Local → Repository)')
    pushed = json.loads(files[PATH]['content']); check(pushed.get('formatVersion') == 2 and len(pushed['schemas']) == 2, 'Repository file written in format 2 with all schemas')
    pg.click('.tab-btn:has-text("Manual Schema Update")'); pg.wait_for_timeout(200)
    pg.select_option('#editorModuleSelect', 'Vendors'); pg.wait_for_timeout(100); pg.select_option('#editorTableSelect', 'VENDOR'); pg.wait_for_timeout(200)
    pg.click('tr[data-row-id="VENDOR::COUNTRY"]'); pg.click('#editRowBtn'); pg.wait_for_timeout(200); pg.fill('#f_columnDescription', 'ISO «country» — "2 letters" ✓'); pg.click('#rowFormCancel'); pg.wait_for_timeout(150)
    check('ISO «country»' not in pg.evaluate("() => localStorage.getItem('sqla.registry.v15')"), 'Cancel edit changes nothing')
    pg.click('tr[data-row-id="VENDOR::COUNTRY"]'); pg.click('#editRowBtn'); pg.wait_for_timeout(200); pg.fill('#f_columnDescription', 'ISO «country» — "2 letters" ✓'); pg.click('#rowFormSave'); pg.wait_for_timeout(2600)
    check('ISO «country» — \\"2 letters\\" ✓' in files[PATH]['content'] or 'ISO «country» — "2 letters" ✓' in json.dumps(json.loads(files[PATH]['content']), ensure_ascii=False), 'Manual edit saved and auto-synchronised to the repository')
    pg.click('tr[data-row-id="VENDOR::DUNS_NUMBER"]'); pg.click('#deleteRowBtn'); pg.wait_for_timeout(150); pg.click('#c1Continue'); pg.wait_for_timeout(150); pg.click('#c2Continue'); pg.wait_for_timeout(150)
    check(pg.eval_on_selector('#c3Error', 'e => e.innerHTML').strip() == '', 'Delete confirmation error box empty')
    pg.fill('#c3Password', 'admin'); pg.click('#c3Delete'); pg.wait_for_timeout(2600)
    check(pg.locator('tr[data-row-id="VENDOR::DUNS_NUMBER"]').count() == 0 and 'DUNS_NUMBER' not in json.dumps([t for t in json.loads(files[PATH]['content'])['schemas'][0]['tables'] if t['name'] == 'VENDOR']), 'Delete removes one row and the deletion is synchronised')
    rep = json.loads(files[PATH]['content'])
    # ------------------------------------------------ remote broken by an older device (the reported error)
    broken = json.loads(json.dumps(rep)); core = broken['schemas'][0]; core['tables'] = [t if t['name'] != 'VENDOR' else {**t, 'columns': [c for c in t['columns'] if c['name'] != 'VENDOR_ID']} for t in core['tables']]
    broken['schemas'].append({**json.loads(json.dumps(rep['schemas'][0])), 'id': 'schema-other-device', 'name': 'Other Device Schema', 'status': 'inactive'})
    gh_put(PATH, json.dumps(broken))
    schema_mgmt(pg); pg.click('#simpleSyncBtn'); pg.wait_for_timeout(1200)
    res = pg.inner_text('#simpleSyncResult')
    check('failed validation and were not loaded' in res and 'INVOICE_HEADER.VENDOR_ID' in res and 'your local copies were kept unchanged' in res, 'Invalid remote schema → specific reason (table/column/path) instead of the generic message')
    check('Other Device Schema' in pg.inner_text('.schema-list'), 'Valid schemas in the same remote file still load')
    local_core = [s for s in json.loads(pg.evaluate("() => localStorage.getItem('sqla.registry.v15')"))['schemas'] if s['id'] == core['id']][0]
    check(any(c['name'] == 'VENDOR_ID' for t in local_core['tables'] if t['name'] == 'VENDOR' for c in t['columns']), 'Valid local schema NOT overwritten by invalid remote data')
    health = pg.inner_text('#schemaHealthMount')
    check('Repository copy of "AP / P2P Core" failed validation' in health and pg.locator('[data-health="publish"]').count() == 1 and pg.locator('[data-health="repair-remote"]').count() == 1, 'Recovery options shown (publish local / review repaired copy / download)')
    pg.click('.advanced-sync-details summary'); pg.click('#validateRepoBtn'); pg.wait_for_timeout(900)
    vr = pg.inner_text('#registrySyncResult'); check('3 schema(s): 2 valid, 1 invalid' in vr and 'repairable' in vr, '"Validate repository file" gives a full diagnostic report')
    pg.click('[data-health="publish"]'); pg.wait_for_timeout(1200)
    check('published to the repository' in pg.inner_text('#schemaHealthMount') or 'published to the repository' in pg.inner_text('main'), 'Publish my local copies repairs the repository')
    fixed = json.loads(files[PATH]['content']); check(any(c['name'] == 'VENDOR_ID' for t in fixed['schemas'][0]['tables'] if t['name'] == 'VENDOR' for c in t['columns']), 'Repository now holds the valid copy')
    pg.click('#simpleSyncBtn'); pg.wait_for_timeout(1000)
    check('failed validation' not in pg.inner_text('#simpleSyncResult') and pg.inner_html('#syncErrorMount').strip() == '' and pg.inner_html('#schemaHealthMount').strip() == '', 'After recovery: sync is clean and no stale error is shown')
    # ------------------------------------------------ file-level problem
    gh_put(PATH, '{\n  "schemas": [\n    {"id": "a",},\n  ]\n}'); pg.click('#simpleSyncBtn'); pg.wait_for_timeout(900)
    t = pg.inner_text('#simpleSyncResult'); check('not valid JSON at line 3' in t and 'trailing comma' in t, 'Corrupted remote JSON → line/column + cause')
    gh_put(PATH, json.dumps(fixed))
    mode['v'] = '401'; pg.click('#simpleSyncBtn'); pg.wait_for_timeout(900); mode['v'] = None
    t = pg.inner_text('#simpleSyncResult'); check('invalid, expired or revoked' in t and TOKEN not in t, 'Invalid/expired token → specific message, token not exposed')
    pg.click('#simpleSyncBtn'); pg.wait_for_timeout(900); check('invalid, expired' not in pg.inner_text('#simpleSyncResult') and pg.inner_html('#syncErrorMount').strip() == '', 'Successful sync clears the previous error')
    # ------------------------------------------------ AI/LLM, vault, other tabs
    pg.click('.tab-btn:has-text("AI / LLM Model")'); pg.wait_for_timeout(200)
    pg.check('#v17LlmEnabled'); pg.fill('#v17LlmEndpoint', 'http://remote.example.com'); pg.click('#v17LlmSave'); pg.wait_for_timeout(200)
    check('AI/LLM configuration invalid' in pg.inner_text('#v17LlmResult'), 'Invalid AI/LLM configuration → clear error')
    pg.click('.tab-btn:has-text("Secret Vault")'); pg.wait_for_timeout(200)
    pg.fill('#v17VaultPass', 'Correct-Horse-42-Battery'); pg.fill('#v17VaultPass2', 'Correct-Horse-42-Battery'); pg.click('#pushVaultBtn')
    pg.wait_for_function("() => document.querySelector('#v17VaultResult').innerText.length > 0", timeout=30000)
    vf = files.get('sql-assistant-data/vault/secret-vault.v17.enc.json', {}).get('content', '')
    check('pushed to the repository' in pg.inner_text('#v17VaultResult') and vf and TOKEN not in vf and base64.b64encode(TOKEN.encode()).decode() not in vf, 'Secret Vault push works; repository holds ciphertext only')
    for tname in ['Security', 'Synchronization', 'Danger Zone']: pg.click(f'.tab-btn:has-text("{tname}")'); pg.wait_for_timeout(200); check(pg.locator('#tabPanel').inner_text().strip() != '', f'Settings tab renders: {tname}')
    # ------------------------------------------------ persistence + SQL after sync
    pg.reload(); pg.wait_for_timeout(800); go(pg, 'schema-used')
    check('DUNS_NUMBER' not in pg.inner_text('#tablesReadOnlyList') and 'Other Device Schema' in pg.inner_text('main'), 'Schema data persists across reload')
    go(pg, 'readonly'); pg.fill('#nlDesc', 'vendors with duns number'); pg.click('#nlBuildBtn'); pg.wait_for_timeout(500)
    check('DUNS_NUMBER' not in pg.inner_text('#sqlBlockMount .sql-output'), 'SQL generation uses the current (synchronised) schema')
    pg.set_viewport_size({'width': 390, 'height': 800}); go(pg, 'settings'); pg.wait_for_timeout(200)
    check(pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), 'Responsive: no horizontal overflow on mobile')
    pg.set_viewport_size({'width': 1366, 'height': 900})
    # ------------------------------------------------ device whose LOCAL data was broken by an older version
    legacy = json.loads(json.dumps(fixed)); lc = legacy['schemas'][0]
    lc['updatedAt'] = '2030-01-01T00:00:00.000Z'  # edited locally by the old version after its last sync
    lc['tables'] = [t for t in lc['tables'] if t['name'] != 'ORGANIZATION']  # V16 deleted the last ORGANIZATION column → table gone, FK + relationship left behind
    ctx2 = b.new_context(viewport={'width': 1366, 'height': 900}); ctx2.route('https://api.github.com/**', gh_route)
    ctx2.add_init_script("localStorage.getItem('sqla.registry.v15') || localStorage.setItem('sqla.registry.v15', %s);" % json.dumps(json.dumps(legacy)))
    pg2 = ctx2.new_page(); pg2.on('dialog', lambda d: d.accept()); pg2.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg2.goto(URL); pg2.wait_for_timeout(700)
    go(pg2, 'readonly'); pg2.fill('#nlDesc', 'invoices with vendor name'); pg2.click('#nlBuildBtn'); pg2.wait_for_timeout(500)
    check('INNER JOIN VENDOR' in pg2.inner_text('#sqlBlockMount .sql-output'), 'Legacy-invalid local schema still loads and generates SQL (nothing dropped)')
    unlock(pg2); set_token(pg2); schema_mgmt(pg2); pg2.click('#simpleSyncBtn'); pg2.wait_for_timeout(1000)
    check(any(s['id'] == lc['id'] and any(t['name'] == 'ORGANIZATION' for t in s['tables']) for s in json.loads(files[PATH]['content'])['schemas']) and not any(t['name'] == 'ORGANIZATION' for s in json.loads(pg2.evaluate("() => localStorage.getItem('sqla.registry.v15')"))['schemas'] if s['id'] == lc['id'] for t in s['tables']), 'Locally edited data is not silently replaced by the remote copy')
    h = pg2.inner_text('#schemaHealthMount')
    check('does not pass validation' in h and 'ORGANIZATION' in h and pg2.locator('[data-health="repair-local"]').count() == 1, 'Invalid local schema is reported with the exact record and a Repair option')
    pg2.click('.advanced-sync-details summary'); pg2.click('#pushRegistryBtn'); pg2.wait_for_timeout(1000)
    check('Not published' in pg2.inner_text('#registrySyncResult') and 'VENDOR.ORG_ID' in pg2.inner_text('#registrySyncResult'), 'Publishing invalid local data is refused with the reason (root-cause fix)')
    check(json.loads(files[PATH]['content'])['schemas'][0]['tables'][-1]['name'] != '' and any(t['name'] == 'ORGANIZATION' for t in json.loads(files[PATH]['content'])['schemas'][0]['tables']), 'Repository not overwritten with invalid data')
    pg2.click('[data-health="repair-local"]'); pg2.wait_for_timeout(300)
    mt = pg2.inner_text('.modal-body'); check('Unlinked foreign key VENDOR.ORG_ID' in mt and 'Removed relationship' in mt, 'Repair preview lists every change before anything is applied')
    pg2.click('#repairApply'); pg2.wait_for_timeout(2600)
    check(pg2.inner_html('#schemaHealthMount').strip() == '', 'After repair the schema validates (health panel gone)')
    check(not any(c.get('isForeignKey') and c.get('references', {}).get('table') == 'ORGANIZATION' for t in json.loads(files[PATH]['content'])['schemas'][0]['tables'] for c in t['columns']), 'Repaired schema auto-published; repository is valid again')
    ctx2.close()
    b.close()
benign = re.compile(r'(Failed to load resource|ERR_|net::|remote\.example\.com)', re.I)
real = [e for e in errs if not benign.search(e)]
check(not real, 'No unexpected console errors' + (': ' + ' | '.join(real[:5]) if real else ''))
print(f'\n{len(passes)} passed, {len(fails)} failed'); sys.exit(1 if fails else 0)
