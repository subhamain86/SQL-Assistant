#!/usr/bin/env python3
"""
SQL Assistant V17.7.2 — Chromium suite (Playwright). Runs against the TEST build (node scripts/build.mjs --test → test-dist/index.html, ?e2e=1), never against production.

  A  hamburger menu: the two new options exist, are clearly labelled, open the right page; every existing item is still there and works
  B  main Query Builders (Read Only + CR): order = Query Builder components → Manual Selectors → Generated SQL (immediately below); no description card; Manual Selectors + SQL generation still work
  C  Describe What You Need – Read Only: two cards; idle / loading / success / needs review / error states; copy, format, regenerate; independent of Manual Selectors; state kept across navigation
  D  Describe What You Need – Query Builder for CR: same, with the CR engine and CR rules (case preserved, WHERE mandatory, views refused)
  E  central repository configuration: an administrator saves it → it is in the repository → a NEW machine adopts it at start-up → an EXISTING machine adopts it with Sync; invalid / failing cases change nothing; no secret appears
  F  responsive layouts (390 / 768 / 1366) + screenshots; no console error or page error anywhere

Environment (this sandbox): Playwright's own Chromium is not installed; the system headless shell is used through SQLA_CHROMIUM (default below). Screenshots go to $SQLA_SHOTS (default test-results-v17.7.2/screenshots).
"""
import json, os, sys, time, pathlib, re
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXE = os.environ.get('SQLA_CHROMIUM') or next((p for p in ['/opt/pw-browsers/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell'] if os.path.exists(p)), None)
URL = (ROOT / 'test-dist' / 'index.html').as_uri() + '?e2e=1'
SHOTS = pathlib.Path(os.environ.get('SQLA_SHOTS') or ROOT / 'test-results-v17.7.2' / 'screenshots'); SHOTS.mkdir(parents=True, exist_ok=True)
PKG = json.loads((ROOT / 'package.json').read_text())
AP = json.loads((ROOT / 'test' / 'fixtures' / 'ap-schema-77.legacy.json').read_text()); AP['id'] = 'schema-ap77'; AP['name'] = 'AP schema 77'
AP_REGISTRY = json.dumps({'schemas': [AP], 'activeSchemaId': 'schema-ap77'})
CENTRAL = 'sql-assistant-data/config/repository-config.json'
results = []; problems = []

def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + ((' — ' + str(detail)) if (detail and not ok) else ''), flush=True)

class Dev:
    """One 'machine': its own browser context (own localStorage), console + page error capture."""
    def __init__(self, browser, width=1366, height=900, schema=None, seed=None):
        self.ctx = browser.new_context(viewport={'width': width, 'height': height}, permissions=['clipboard-read', 'clipboard-write'], accept_downloads=False)
        scripts = []
        if schema == 'ap': scripts.append(f"if(!localStorage.getItem('sqla.registry.v15'))localStorage.setItem('sqla.registry.v15', {json.dumps(AP_REGISTRY)});")
        if seed is not None: scripts.append(f"sessionStorage.setItem('__sqla_seed_repo', {json.dumps(json.dumps(seed))});")
        for s in scripts: self.ctx.add_init_script(s)
        self.page = self.ctx.new_page(); self.errors = []
        self.page.on('console', lambda m: self.errors.append(('console.' + m.type, m.text[:240])) if m.type == 'error' else None)
        self.page.on('pageerror', lambda e: self.errors.append(('pageerror', str(e)[:300])))
    def open(self, route=None):
        self.page.goto(URL); self.page.wait_for_selector('html[data-sqla-ready="1"]', state='attached', timeout=30000)
        if route: self.go(route)
        return self
    def go(self, route):
        self.page.evaluate(f"location.hash='#{route}'"); self.page.wait_for_timeout(350)
    def close(self): self.ctx.close()

def wait_js(pg, expr, timeout=15000):
    """Polls a JS expression through page.evaluate (CDP). Playwright's wait_for_function evaluates a string in the page, which the application's strict CSP (no unsafe-eval) refuses — the CSP is left untouched."""
    end = time.time() + timeout / 1000.0
    while time.time() < end:
        if pg.evaluate(f"(()=>{{try{{return !!({expr})}}catch(e){{return false}}}})()"): return True
        pg.wait_for_timeout(150)
    raise TimeoutError('condition not met: ' + expr[:120])

def titles(pg): return pg.eval_on_selector_all('.page .builder-panel > h2:first-child', 'els=>els.map(e=>e.innerText.trim())')
def status(pg): return pg.eval_on_selector('#nlResult [data-result-status], #crNlResult [data-result-status]', 'e=>e.getAttribute("data-result-status")') if pg.query_selector('#nlResult [data-result-status], #crNlResult [data-result-status]') else None
def shot(pg, name): pg.screenshot(path=str(SHOTS / f'{name}.png'), full_page=True)

def describe_ro(d, text, dialect=None):
    pg = d.page; d.go('describe-readonly'); pg.fill('#nlDesc', text)
    if dialect: pg.select_option('#dialectSelect', dialect)
    pg.click('#nlBuildBtn'); pg.wait_for_selector('#nlResult [data-result-status]:not([data-result-status="loading"]), #nlResult .issue-box[role="alert"]', timeout=15000)
    return pg.inner_text('#nlResult')
def describe_cr(d, text):
    pg = d.page; d.go('describe-cr'); pg.fill('#crNlDesc', text); pg.click('#crNlBuildBtn')
    pg.wait_for_selector('#crNlResult [data-result-status]:not([data-result-status="loading"])', timeout=15000); return pg.inner_text('#crNlResult')
def sql_of(pg, mount): return pg.inner_text(f'{mount} pre.sql-output') if pg.query_selector(f'{mount} pre.sql-output') else None

def main():
    if not EXE or not os.path.exists(EXE): print('No Chromium available (set SQLA_CHROMIUM).'); return 2
    if not (ROOT / 'test-dist' / 'index.html').exists(): print('Run "node scripts/build.mjs --test" first.'); return 2
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path=EXE, args=['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'])
        all_devs = []
        def dev(**kw):
            d = Dev(br, **kw); all_devs.append(d); return d

        # ───────── A  hamburger menu
        d = dev().open(); pg = d.page
        check('start-up: version is stamped in the footer', f"Version {PKG['version']}" in pg.inner_text('footer'))
        pg.click('#navToggle'); pg.wait_for_selector('.hamburger-panel')
        labels = pg.eval_on_selector_all('.hamburger-panel .hb-link, .hamburger-panel .hb-group-toggle', 'els=>els.map(e=>e.innerText.trim())')
        check('A1 existing top-level items are all still in the menu', all(any(l.startswith(x) for l in labels) for x in ['Quick Start', 'Query Builder', 'Query Library', 'Schema', 'GitHub Repository', 'Error Rectifier', 'Settings', 'About']), labels)
        check('A2 the new menu option "Describe What You Need" exists', any(l.startswith('Describe What You Need') for l in labels), labels)
        pg.click('.hb-group-toggle[data-group="describe-group"]'); pg.wait_for_selector('.hb-group-children a[data-route="describe-readonly"]')
        ch = pg.eval_on_selector_all('.hb-group-children a', 'els=>els.map(e=>[e.getAttribute("data-route"), e.innerText.trim()])')
        check('A3 two distinguishable labels: Read Only and CR', ['describe-readonly', 'Describe What You Need – Read Only Query Builder'] in ch and ['describe-cr', 'Describe What You Need – Query Builder for CR'] in ch, ch)
        shot(pg, 'menu-describe-group')
        pg.click('a[data-route="describe-readonly"]'); pg.wait_for_timeout(300)
        check('A4 "Read Only" option opens the Read Only description page', 'Read Only Query Builder' in pg.inner_text('h1.page-title') and 'Describe What You Need' in pg.inner_text('h1.page-title') and not pg.query_selector('.hamburger-panel'))
        pg.click('#navToggle'); pg.click('a[data-route="describe-cr"]'); pg.wait_for_timeout(300)
        check('A5 "CR" option opens the CR description page', 'Query Builder for CR' in pg.inner_text('h1.page-title') and 'Describe What You Need' in pg.inner_text('h1.page-title'))
        for route, text in [('quickstart', 'Welcome'), ('readonly', 'Read Only Query Builder'), ('cr', 'Query Builder for CR'), ('query-add', 'Query'), ('query-library', 'Query Library'), ('schema-used', 'Schema'), ('github', 'GitHub'), ('error-rectifier', 'Error Rectifier'), ('settings', 'Settings'), ('about', 'About')]:
            pg.click('#navToggle')
            if route in ('readonly', 'cr'): pg.click('.hb-group-toggle[data-group="query-builder-group"]') if not pg.query_selector(f'a[data-route="{route}"]') else None
            if route in ('query-add', 'query-library') and not pg.query_selector(f'a[data-route="{route}"]'): pg.click('.hb-group-toggle[data-group="query-library-group"]')
            pg.click(f'a[data-route="{route}"]'); pg.wait_for_timeout(250)
            check(f'A6 existing navigation still works: {route}', text.lower() in (pg.inner_text('h1') + pg.inner_text('.page')[:400]).lower(), pg.inner_text('h1')[:60])
        pg.go_back() if False else None
        d.close()

        # ───────── B  main Query Builder layouts
        d = dev().open(); pg = d.page
        for route, mount, name in [('readonly', '#sqlBlockMount', 'Read Only'), ('cr', '#crSqlMount', 'CR')]:
            d.go(route)
            order = pg.eval_on_selector_all('.page > *', 'els=>els.map(e=>e.className+"|"+(e.querySelector("h2")?e.querySelector("h2").innerText.trim():(e.querySelector("h1")?"h1":e.id)))')
            ms = next(i for i, x in enumerate(order) if 'Manual Selectors' in x); gs = next(i for i, x in enumerate(order) if 'Generated SQL' in x)
            check(f'B1 {name}: Generated SQL card is IMMEDIATELY below Manual Selectors', gs == ms + 1, order)
            check(f'B2 {name}: the description card is gone from the main layout', not pg.query_selector('#nlDesc') and not pg.query_selector('#crNlDesc') and 'Describe What You Need (optional)' not in pg.inner_text('.page') and 'Describe the Change' not in pg.inner_text('.page'))
            check(f'B3 {name}: the SQL dialect selector is still available', bool(pg.query_selector('#dialectSelect, #crDialectSelect')))
            geo = pg.evaluate(f"(()=>{{const a=document.querySelector('.manual-selectors-panel').getBoundingClientRect();const b=document.querySelector('{mount}').closest('.builder-panel').getBoundingClientRect();return [a.bottom,b.top,a.left,b.left,a.width,b.width]}})()")
            check(f'B4 {name}: visually directly below, same width', geo[1] >= geo[0] and geo[1] - geo[0] < 40 and abs(geo[2] - geo[3]) < 2 and abs(geo[4] - geo[5]) < 2, geo)
            shot(pg, f'main-{name.lower().replace(" ", "")}-empty')
        # Manual Selectors still drive the Generated SQL (Read Only)
        d.go('readonly'); pg.wait_for_selector('#tabsMount .table-picker, #tabsMount input[type=checkbox]', timeout=8000)
        first = pg.query_selector('#tabsMount input[type=checkbox]'); first.check(); pg.wait_for_timeout(700)
        sql = sql_of(pg, '#sqlBlockMount'); check('B5 Read Only: ticking a table in Manual Selectors generates SQL in the Generated SQL card below', bool(sql) and re.search(r'\bFROM\b', sql) is not None, sql)
        shot(pg, 'main-readonly-with-sql')
        pg.click('#btnCopySql'); pg.wait_for_timeout(200); clip = pg.evaluate('navigator.clipboard.readText()'); check('B6 Read Only: Copy SQL still copies the generated SQL', clip.strip() == sql.strip(), clip[:80])
        d.go('cr'); pg.select_option('#crTableSelect', index=1); pg.wait_for_timeout(300); pg.click('.seg-btn[data-qt="DELETE"]'); pg.wait_for_timeout(200)
        check('B7 CR: Manual Selectors still work and the mandatory WHERE safeguard still applies in the Generated SQL card', 'WHERE condition is required' in (sql_of(pg, '#crSqlMount') or ''), sql_of(pg, '#crSqlMount'))
        d.close()

        # ───────── C  Describe What You Need — Read Only (default schema: INVOICE_HEADER / VENDOR / PO_HEADER, and AP schema 77)
        d = dev().open('describe-readonly'); pg = d.page
        check('C1 two separate cards: "Describe What You Need (optional)" and "Result"', titles(pg) == ['Describe What You Need (optional)', 'Result'], titles(pg))
        check('C2 idle state explains what happens next; no SQL is shown', 'Build from Description' in pg.inner_text('#nlResult') and status(pg) == 'idle' and not pg.query_selector('#nlResult pre.sql-output'))
        shot(pg, 'describe-readonly-idle')
        pg.click('#nlBuildBtn'); pg.wait_for_timeout(500)
        check('C3 empty description → error state, no SQL', status(pg) == 'error' and 'Enter a description' in pg.inner_text('#nlResult') and not pg.query_selector('#nlResult pre.sql-output'), pg.inner_text('#nlResult')[:120])
        # observe states during a run
        pg.evaluate("window.__seen=[];new MutationObserver(()=>{document.querySelectorAll('#nlResult [data-result-status]').forEach(e=>{const s=e.getAttribute('data-result-status');if(window.__seen[window.__seen.length-1]!==s)window.__seen.push(s)})}).observe(document.getElementById('nlResult'),{subtree:true,childList:true,attributes:true})")
        txt = describe_ro(d, 'total invoice amount per vendor for approved invoices in the last 30 days, top 10', 'Oracle')
        seen = pg.evaluate('window.__seen'); sql = sql_of(pg, '#nlResult')
        check('C4 a loading state is shown while the SQL is generated, then the final state', 'loading' in seen and seen[-1] in ('success', 'review'), seen)
        check('C5 successful description → success banner + SQL built from the schema (SUM, GROUP BY, join, filter, limit)', status(pg) == 'success' and sql and all(x in sql for x in ['SUM(INVOICE_HEADER.INVOICE_AMOUNT)', 'GROUP BY VENDOR.VENDOR_NAME', 'FETCH FIRST 10 ROWS ONLY']), (status(pg), sql))
        shot(pg, 'describe-readonly-success')
        pg.click('#btnCopySql'); pg.wait_for_timeout(200); check('C6 Copy SQL copies exactly the displayed SQL', pg.evaluate('navigator.clipboard.readText()').strip() == sql.strip())
        before = sql; pg.click('#btnFormatSql'); pg.wait_for_timeout(200); after = sql_of(pg, '#nlResult')
        check('C7 Format SQL changes layout only (same tokens) and can be undone', re.sub(r'\s+', '', before) == re.sub(r'\s+', '', after) and 'Original layout' in pg.inner_text('#nlResult'))
        pg.click('#btnFormatSql'); pg.wait_for_timeout(150); check('C8 "Original layout" restores the original text', sql_of(pg, '#nlResult').strip() == before.strip())
        pg.click('#btnRegenSql'); pg.wait_for_selector('#nlResult [data-result-status="success"]', timeout=10000); check('C9 Regenerate re-runs the description and gives the same SQL', sql_of(pg, '#nlResult').strip() == before.strip())
        pg.click('#btnValidateSql'); pg.wait_for_timeout(200); check('C10 Validate shows the checks that were run', 'What was checked' in pg.inner_text('#nlResult') and pg.query_selector('#nlResult details[data-checks][open]') is not None)
        # needs review
        describe_ro(d, 'show invoices with blorf quantum and frobnicator'); check('C11 parts of the description that the SQL does not reflect → "Needs review" (not success), listing them', status(pg) == 'review' and 'not reflected' in pg.inner_text('#nlResult'), pg.inner_text('#nlResult')[:300]); shot(pg, 'describe-readonly-review')
        # errors
        describe_ro(d, 'xyzzy plugh frobnicate'); check('C12 nothing recognised → error with reasons, NO SQL block, Regenerate offered', status(pg) == 'error' and not pg.query_selector('#nlResult pre.sql-output') and pg.query_selector('#nlRetryBtn') is not None, pg.inner_text('#nlResult')[:200]); shot(pg, 'describe-readonly-error')
        describe_ro(d, 'delete all invoices'); check('C13 a data-change request is refused here and points to the CR builder', status(pg) == 'error' and 'Query Builder for CR' in pg.inner_text('#nlResult') and not pg.query_selector('#nlResult pre.sql-output'))
        describe_ro(d, "my token is ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8 show invoices"); check('C14 a description that contains a credential is refused', status(pg) == 'error' and 'credential' in pg.inner_text('#nlResult'))
        describe_ro(d, '<img src=x onerror=window.__xss=1> <script>window.__xss=2</script> show invoices'); check('C15a markup in a description is shown as text and never executed (HTML-escaped)', pg.evaluate('window.__xss') is None and pg.query_selector('#nlResult img') is None and pg.query_selector('#nlResult script') is None)
        describe_ro(d, 'x' * 2100); check('C15 an over-long description is refused with the limit', status(pg) == 'error' and '2000' in pg.inner_text('#nlResult'))
        d.close()

        d = dev(schema='ap').open('describe-readonly'); pg = d.page
        check('C16 the Active Schema in use is stated on the page', 'AP schema 77' in pg.inner_text('#nlSchemaLine') and '77 table' in pg.inner_text('#nlSchemaLine'), pg.inner_text('#nlSchemaLine'))
        describe_ro(d, 'show action log entries where root document type is Invoice'); sql = sql_of(pg, '#nlResult')
        check('C17 AP schema 77: decode value → code, real table and column names only', status(pg) == 'success' and "IA_ACTION_LOG.ROOT_DOCUMENT_TYPE = 'Invoice.Domain.Invoice'" in sql, sql)
        describe_ro(d, 'show invoices and their action log entries'); check('C18 AP schema 77: a recognised table that has no relationship to the others is reported, not silently dropped, and no join is invented', status(pg) == 'review' and 'no relationship' in pg.inner_text('#nlResult') and 'JOIN' not in (sql_of(pg, '#nlResult') or ''), pg.inner_text('#nlResult')[:300])
        describe_ro(d, 'show invoices over 1000 sorted by invoice date desc'); check('C19 AP schema 77: "over 1000" was not applied → flagged', status(pg) == 'review' and '1000' in pg.inner_text('#nlResult'), pg.inner_text('#nlResult')[:300])
        describe_ro(d, 'list all suppliers with their bank accounts'); check('C20 AP schema 77: "bank accounts" is not in the schema → not success', status(pg) in ('review', 'error'), status(pg))
        shot(pg, 'describe-readonly-ap-review')
        # independence from Manual Selectors
        d.go('readonly'); pg.wait_for_selector('#tabsMount input[type=checkbox]'); pg.query_selector('#tabsMount input[type=checkbox]').check(); pg.wait_for_timeout(600); manual_before = sql_of(pg, '#sqlBlockMount')
        describe_ro(d, 'count of invoices per supplier'); nl_sql = sql_of(pg, '#nlResult')
        d.go('readonly'); pg.wait_for_timeout(400); manual_after = sql_of(pg, '#sqlBlockMount')
        check('C21 independence: the description neither uses nor changes the Manual Selectors state', manual_before == manual_after and 'IA_INVOICE' in nl_sql and (manual_before or '') != nl_sql, (manual_before, manual_after))
        d.go('describe-readonly'); check('C22 state is kept when navigating away and back (description, result)', pg.input_value('#nlDesc') == 'count of invoices per supplier' and sql_of(pg, '#nlResult') == nl_sql)
        pg.click('#btnOpenBuilder'); pg.wait_for_timeout(600)
        check('C23 "Open in Query Builder" is an explicit one-way hand-over into Manual Selectors', 'Read Only Query Builder' in pg.inner_text('h1') and 'IA_INVOICE' in (sql_of(pg, '#sqlBlockMount') or ''), sql_of(pg, '#sqlBlockMount'))
        d.close()

        # ───────── D  Describe What You Need — Query Builder for CR
        d = dev().open('describe-cr'); pg = d.page
        check('D1 two separate cards: "Describe What You Need (optional)" and "Result"', titles(pg) == ['Describe What You Need (optional)', 'Result'], titles(pg)); shot(pg, 'describe-cr-idle')
        describe_cr(d, 'Update vendor name to Acme Corp where vendor id = 5'); sql = sql_of(pg, '#crNlResult')
        check('D2 CR success: value keeps the case and spaces typed; WHERE present', status(pg) == 'success' and "VENDOR_NAME = 'Acme Corp'" in sql and 'VENDOR_ID = 5' in sql, sql); shot(pg, 'describe-cr-success')
        describe_cr(d, 'add a new vendor with vendor name = Nordic Ltd and country = FI'); sql = sql_of(pg, '#crNlResult'); check('D3 CR INSERT: several columns, exact values', status(pg) == 'success' and "('Nordic Ltd', 'FI')" in sql, sql)
        describe_cr(d, 'delete invoice 77'); sql = sql_of(pg, '#crNlResult'); check('D4 CR DELETE with a key', status(pg) == 'success' and sql.startswith('DELETE FROM INVOICE_HEADER') and 'INVOICE_ID = 77' in sql, sql)
        describe_cr(d, 'update the invoice status to approved'); check('D5 UPDATE without WHERE → error (never an unrestricted UPDATE), no SQL block', status(pg) == 'error' and 'WHERE' in pg.inner_text('#crNlResult') and not pg.query_selector('#crNlResult pre.sql-output'), pg.inner_text('#crNlResult')[:200]); shot(pg, 'describe-cr-error')
        describe_cr(d, 'show me all invoices'); check('D6 a read request is refused and points to the Read Only builder', status(pg) == 'error' and 'Read Only Query Builder' in pg.inner_text('#crNlResult'))
        describe_cr(d, 'update invoices set foo_bar to 5 where invoice id 3'); check('D7 an unknown column is never invented: error/review with the name, no SQL using it', status(pg) in ('error', 'review') and 'foo_bar' not in (sql_of(pg, '#crNlResult') or ''), pg.inner_text('#crNlResult')[:200])
        describe_cr(d, 'update vendor name to Acme Corp where vendor id = 5'); pg.click('#btnCopySql'); pg.wait_for_timeout(200); check('D8 Copy SQL', "VENDOR_NAME = 'Acme Corp'" in pg.evaluate('navigator.clipboard.readText()'))
        pg.click('#btnFormatSql'); pg.wait_for_timeout(150); check('D9 Format SQL keeps the statement and can be undone', 'Original layout' in pg.inner_text('#crNlResult')); pg.click('#btnFormatSql')
        pg.click('#btnRegenSql'); pg.wait_for_selector('#crNlResult [data-result-status="success"]'); check('D10 Regenerate', "VENDOR_NAME = 'Acme Corp'" in sql_of(pg, '#crNlResult'))
        pg.click('#btnOpenBuilder'); pg.wait_for_timeout(500); check('D11 "Open in Query Builder for CR" hands the statement over to the CR Manual Selectors', 'Query Builder for CR' in pg.inner_text('h1') and "VENDOR_NAME = 'Acme Corp'" in (sql_of(pg, '#crSqlMount') or ''), sql_of(pg, '#crSqlMount'))
        d.go('describe-cr'); check('D12 CR description state kept across navigation', pg.input_value('#crNlDesc').startswith('update vendor name'))
        d.close()
        d = dev(schema='ap').open('describe-cr'); pg = d.page
        describe_cr(d, 'update invoice status to approved where invoice id is 12'); sql = sql_of(pg, '#crNlResult') or ''
        check('D13 CR uses the Active Schema (AP schema 77), not the default schema', status(pg) in ('success', 'review') and 'IA_INVOICE' in sql and 'INVOICE_HEADER' not in sql, sql)
        d.close()

        # ───────── E  central repository configuration (two machines; the repository is an in-memory stand-in for GitHub)
        NEW = {'repo': 'acme/sql-assistant-data-2', 'branch': 'release', 'path': 'sql-assistant-data/schemas/registry.json'}
        def loc(pg): return pg.evaluate('window.__sqla.repoLocation()')
        def central_text(pg): return pg.evaluate(f'window.__sqla.repoFile({json.dumps(CENTRAL)})')
        a = dev(seed={}).open('github'); pg = a.page
        check('E0 machine A starts with the application defaults', loc(pg)[:3] == ['basware', 'sk-ap-sql-assistant', 'main'], loc(pg))
        pg.click('#repoCfgToggle'); pg.wait_for_selector('#centralCfgStatus')
        check('E1 the card says that no central configuration has been published yet', 'No central configuration has been published yet' in pg.inner_text('#centralCfgStatus'), pg.inner_text('#centralCfgStatus'))
        shot(pg, 'github-config-before')
        pg.click('#repoCfgEdit'); pg.fill('#repoCfgAdminPw', 'wrong'); pg.click('#repoCfgUnlock'); pg.wait_for_timeout(700)
        check('E2 a wrong Admin Password keeps the configuration read-only and publishes nothing', 'Incorrect Admin Password' in pg.inner_text('#repoCfgResult') and pg.get_attribute('#vaultRepo', 'readonly') is not None and central_text(pg) is None)
        pg.fill('#repoCfgAdminPw', 'admin'); pg.click('#repoCfgUnlock'); pg.wait_for_selector('#repoCfgSave:visible', timeout=8000)
        pg.fill('#vaultBranch', 'a..b'); pg.click('#repoCfgSave'); pg.wait_for_timeout(700)
        check('E3 an invalid configuration is refused with the reason and nothing is written (central or local)', ('not valid' in pg.inner_text('#repoCfgResult').lower()) and central_text(pg) is None and pg.evaluate("localStorage.getItem('sqla.repoconfig.v1756')") is None, pg.inner_text('#repoCfgResult')[:200])
        pg.fill('#vaultRepo', NEW['repo']); pg.fill('#vaultBranch', NEW['branch']); pg.fill('#vaultPath', NEW['path']); pg.click('#repoCfgSave'); wait_js(pg, "document.body.innerText.includes('Repository configuration saved centrally')", 10000); pg.wait_for_timeout(300)
        txt = central_text(pg); rec = json.loads(txt)
        check('E4 an administrator saves → a toast and the card message say "saved centrally (revision 1)"', 'saved centrally (revision 1)' in (pg.text_content('#repoCfgResult') or ''), (pg.text_content('#repoCfgResult') or '')[:200]); shot(pg, 'github-config-saved')
        check('E5 the updated values are in the repository (version-controlled file, revision 1) and in force on machine A', rec['revision'] == 1 and rec['format'] == 'sqla-repository-config' and rec['config'] == {'owner': 'acme', 'repo': 'sql-assistant-data-2', 'branch': 'release', 'schemaPath': NEW['path']} and loc(pg)[:3] == ['acme', 'sql-assistant-data-2', 'release'], (rec, loc(pg)))
        check('E6 the central file holds no secret and no credential field', not re.search(r'ghp_|github_pat_|token|password|secret|passphrase', txt, re.I), txt)
        pg.reload(); pg.wait_for_selector('html[data-sqla-ready="1"]', state='attached', timeout=30000)
        check('E7 machine A keeps the saved configuration after a reload', loc(pg)[:3] == ['acme', 'sql-assistant-data-2', 'release'], loc(pg))
        a.close()
        # a NEW machine: starts from the defaults, adopts the central configuration at start-up — nothing typed
        b = dev(seed={CENTRAL: txt}).open(); pg = b.page
        wait_js(pg, "window.__sqla.repoLocation()[1] === 'sql-assistant-data-2'", 15000)
        check('E8 a NEW machine initialises itself with the central configuration at start-up', loc(pg)[:3] == ['acme', 'sql-assistant-data-2', 'release'], loc(pg))
        b.go('github'); pg.click('#repoCfgToggle'); pg.wait_for_selector('#centralCfgStatus')
        check('E9 the card on the new machine shows the central revision and the central values', 'Maintained centrally' in pg.inner_text('#centralCfgStatus') and 'revision 1' in pg.inner_text('#centralCfgStatus') and pg.input_value('#vaultRepo') == NEW['repo'] and pg.input_value('#vaultBranch') == NEW['branch'], pg.inner_text('#centralCfgStatus')); shot(pg, 'github-config-new-machine')
        check('E10 the stored configuration on the new machine holds no secret', not re.search(r'ghp_|github_pat_', pg.evaluate('JSON.stringify(Object.assign({}, localStorage))')))
        b.close()
        # an EXISTING machine (already running on the defaults) receives a later revision with Sync
        c = dev(seed={}).open(); pg = c.page; check('E11 existing machine C runs on the defaults', loc(pg)[1] == 'sk-ap-sql-assistant', loc(pg))
        rec2 = dict(rec); rec2['revision'] = 2; rec2['config'] = dict(rec['config'], branch='stable'); txt2 = json.dumps(rec2, indent=2) + '\n'
        pg.evaluate(f"window.__sqla.setRepositoryOverride(window.__sqla.memoryRepository({{[{json.dumps(CENTRAL)}]: {json.dumps(txt2)}}}))")
        pg.click('#syncNowBtn'); wait_js(pg, "window.__sqla.repoLocation()[2] === 'stable'", 15000)
        check('E12 an EXISTING machine synchronizes the updated configuration with the existing Sync workflow', loc(pg)[:3] == ['acme', 'sql-assistant-data-2', 'stable'], loc(pg)); shot(pg, 'sync-applied-config')
        pg.wait_for_selector('#syncNowBtn:not([disabled])', timeout=15000)
        # failed / hostile synchronization never changes the local configuration
        before = pg.evaluate("localStorage.getItem('sqla.repoconfig.v1756')")
        for bad in ['{broken', json.dumps(dict(rec2, revision=9, config=dict(rec2['config'], branch='x..y'))), json.dumps(dict(rec2, revision=9, note='ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'))]:
            pg.evaluate(f"window.__sqla.setRepositoryOverride(window.__sqla.memoryRepository({{[{json.dumps(CENTRAL)}]: {json.dumps(bad)}}}))")
            pg.click('#syncNowBtn'); pg.wait_for_timeout(1800); pg.wait_for_selector('#syncNowBtn:not([disabled])', timeout=15000)
            check('E13 an unusable central record is ignored: local configuration untouched, failure logged', pg.evaluate("localStorage.getItem('sqla.repoconfig.v1756')") == before and loc(pg)[2] == 'stable', bad[:30])
        log = pg.evaluate("window.__sqla.services().centralConfig.log().filter(l=>!l.ok).length")
        check('E14 the refusals are in the local log (no secret in it)', log >= 3 and not re.search(r'ghp_', pg.evaluate("JSON.stringify(window.__sqla.services().centralConfig.log())")), log)
        # a repository that cannot be written (permission) refuses the save and changes nothing
        pg.evaluate("(()=>{const m=window.__sqla.memoryRepository({}); const ro={describe:'read-only',read:m.read,async write(){throw new Error('Writing failed: the token lacks permission (Contents: read/write).')}}; window.__sqla.setRepositoryOverride(ro);})()")
        c.go('github'); pg.click('#repoCfgToggle'); pg.click('#repoCfgEdit'); pg.fill('#repoCfgAdminPw', 'admin'); pg.click('#repoCfgUnlock'); pg.wait_for_selector('#repoCfgSave:visible', timeout=8000)
        pg.fill('#vaultBranch', 'other'); pg.click('#repoCfgSave'); pg.wait_for_timeout(1500)
        check('E15 a read-only repository connection cannot change the central configuration: refused, nothing changed on this device', 'lacks permission' in pg.inner_text('#repoCfgResult') and 'Nothing was changed on this device' in pg.inner_text('#repoCfgResult') and loc(pg)[2] == 'stable', pg.inner_text('#repoCfgResult')[:240])
        # check-for-updates button
        pg.evaluate(f"window.__sqla.setRepositoryOverride(window.__sqla.memoryRepository({{[{json.dumps(CENTRAL)}]: {json.dumps(json.dumps(dict(rec2, revision=3, config=dict(rec2['config'], branch='latest')), indent=2) + chr(10))}}}))")
        c.go('github')
        if not pg.is_visible('#centralCfgSyncBtn'): pg.click('#repoCfgToggle')
        pg.click('#centralCfgSyncBtn'); wait_js(pg, "window.__sqla.repoLocation()[2] === 'latest'", 10000)
        check('E16 "Check for updated configuration" applies the newest revision', loc(pg)[2] == 'latest')
        check('E17 the rest of the existing GitHub page still works (repository card, token row, Pull Schema, Pull Secret Vault)', all(x in pg.inner_text('.page') for x in ['GitHub repository', 'Pull Schema']) and bool(pg.query_selector('#changeTokenBtn, #brokerSignInBtn')), pg.inner_text('.page')[:200])
        c.close()

        # ───────── F  responsive + console errors
        for w, h, nm in [(390, 844, 'mobile'), (768, 1024, 'tablet'), (1366, 900, 'desktop')]:
            d = dev(width=w, height=h).open(); pg = d.page
            for route in ['readonly', 'cr', 'describe-readonly', 'describe-cr']:
                d.go(route); over = pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
                check(f'F1 {nm} {w}px: {route} has no horizontal overflow', over <= 1, over); shot(pg, f'{nm}-{route}')
            d.close()
        for i, dv in enumerate(all_devs):
            if dv.errors: problems.append((i, dv.errors))
        check('F2 no console error and no page error in any session', not problems, problems)
        br.close()
    fails = [r for r in results if not r[1]]
    print(f'\nV17.7.2 browser suite: {len(results) - len(fails)} passed, {len(fails)} failed (of {len(results)})')
    return 1 if fails else 0

if __name__ == '__main__': sys.exit(main())
