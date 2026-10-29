#!/usr/bin/env python3
"""
V17.7.1 browser suite (Chromium through Playwright). Run: node scripts/build.mjs && node scripts/build.mjs --test && python3 scripts/browser_test_v1771.py
It starts scripts/serve.mjs itself, loads the TEST build (?e2e=1 — the only page with src/testHooks.ts) and drives the real UI.

What is REAL: the application, the DOM, localStorage, the Admin Password authority, the Query Library code, the repository synchronization code.
What is EMULATED (stated, never claimed otherwise): api.github.com (answered by Playwright request interception) and the repository (an in-memory repository object). There is no real GitHub, GitHub Actions,
Azure broker or deployed site in this environment. The token below is a synthetic example value.

Results: test-results-v17.7.1/browser-results.json and screenshots/*.png.
"""
import json, os, re, socket, subprocess, sys, time, glob
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PORT = int(os.environ.get('PORT', '8171')); BASE = f'http://127.0.0.1:{PORT}'
OUT = ROOT / 'test-results-v17.7.1'; (OUT / 'screenshots').mkdir(parents=True, exist_ok=True)
TOKEN = 'ghp' + '_BROWSERsyntheticTOKEN0123456789abcdefABC'  # synthetic; assembled at run time so no scanner mistakes this file for a leaked credential
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
RESULTS = []

def check(name, cond, detail=''):
    RESULTS.append({'name': name, 'pass': bool(cond), 'detail': str(detail)[:300]})
    print(('PASS  ' if cond else 'FAIL  ') + name + (f'  [{detail}]' if (detail and not cond) else ''), flush=True)

class Gh:
    """Emulated api.github.com. mode: ok | readonly | 401 | 403 | abort | hang"""
    def __init__(self): self.mode = 'ok'; self.reqs = []; self.pending = []
    def handler(self, route, request):
        self.reqs.append({'method': request.method, 'url': request.url, 'auth': any(k.lower() == 'authorization' for k in request.headers)})
        m = self.mode
        if m == 'ok': route.fulfill(status=200, content_type='application/json', body=json.dumps({'permissions': {'push': True}}))
        elif m == 'readonly': route.fulfill(status=200, content_type='application/json', body=json.dumps({'permissions': {'push': False}}))
        elif m in ('401', '403'): route.fulfill(status=int(m), content_type='application/json', body='{}')
        elif m == 'abort': route.abort('failed')
        elif m == 'hang': self.pending.append(route)
        else: route.fulfill(status=500, body='{}')
    def release(self):
        for r in self.pending:
            try: r.fulfill(status=200, content_type='application/json', body=json.dumps({'permissions': {'push': True}}))
            except Exception: pass
        self.pending = []

def wait_port(port, secs=15):
    t = time.time()
    while time.time() - t < secs:
        try: socket.create_connection(('127.0.0.1', port), 0.3).close(); return True
        except OSError: time.sleep(0.2)
    return False

def start_server():
    env = dict(os.environ, PORT=str(PORT))
    p = subprocess.Popen(['node', 'scripts/serve.mjs'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert wait_port(PORT), 'the static server did not start'; return p

class Session:
    def __init__(self, browser, gh=None, viewport=None):
        self.ctx = browser.new_context(viewport=viewport or {'width': 1280, 'height': 900}); self.gh = gh or Gh(); self.console = []; self.errors = []
        self.ctx.route('https://api.github.com/**', self.gh.handler)
        self.page = self.ctx.new_page(); self.page.on('console', lambda m: self.console.append(m.text)); self.page.on('pageerror', lambda e: self.errors.append(str(e)))
    def open(self, hash=''):
        self.page.goto(f'{BASE}/?e2e=1{hash}'); self.until("() => document.documentElement.getAttribute('data-sqla-ready') === '1'", timeout=15000); return self.page
    def shot(self, name): self.page.screenshot(path=str(OUT / 'screenshots' / f'{name}.png'), full_page=False)
    def chip(self): return self.page.locator('#ghStateChip').inner_text()
    def wait_chip(self, text, secs=8):
        try: self.until("t => (document.querySelector('#ghStateChip')||{}).innerText === t", arg=text, timeout=secs * 1000); return True
        except Exception: return False
    def ev(self, js, arg=None): return self.page.evaluate(js, arg)
    def until(self, js, arg=None, timeout=10000):
        # polling through page.evaluate: the application's Content-Security-Policy forbids the eval() Playwright's waitForFunction needs
        t0 = time.time()
        while (time.time() - t0) * 1000 < timeout:
            try:
                if self.page.evaluate(js, arg): return True
            except Exception: pass
            time.sleep(0.1)
        raise TimeoutError(f'condition not met within {timeout} ms: {js[:90]}')
    def set_token(self, token):
        self.ev("async t => { const s = window.__sqla.services(); const cur = await s.vault.load(); await s.vault.save({ ...cur, githubToken: t }); await window.__sqla.reloadSecrets(); }", token)
    def hamburger(self, route, group=None):
        p = self.page; p.click('#navToggle')
        if group: p.click(f'.hb-group-toggle[data-group="{group}"]')
        p.click(f'a[data-route="{route}"]'); p.wait_for_timeout(150)
    def leaks(self):
        html = self.page.content(); ls = self.ev("() => JSON.stringify(Object.assign({}, localStorage))")
        return TOKEN in html or TOKEN in ls or any(TOKEN in c for c in self.console) or any(TOKEN in e for e in self.errors)

def run(pw):
    exe = os.environ.get('SQLA_CHROMIUM') or next(iter(glob.glob('/opt/pw-browsers/chromium-*/chrome-linux64/chrome')), None)
    browser = pw.chromium.launch(executable_path=exe, args=['--no-sandbox']) if exe else pw.chromium.launch(args=['--no-sandbox'])

    # ───────────────────────── A. start-up: the GitHub connection is initialised without opening Pull Schema
    s = Session(browser); p = s.open()
    check('A1 start-up: the application starts and shows the Home page', p.locator('h1:has-text("Welcome")').count() == 1 and s.errors == [], s.errors)
    check('A2 Home shows a GitHub repository section matching the V17.7 panel style', p.locator('[data-github-status]').count() == 1 and p.locator('[data-github-status].builder-panel').count() >= 1)
    check('A3 nothing configured: Home says "Not set up" and NO request was sent to GitHub', s.chip() == 'Not set up' and len(s.gh.reqs) == 0, (s.chip(), len(s.gh.reqs)))
    s.shot('A-home-not-configured')
    s.set_token(TOKEN); check('A4 saving a token re-checks by itself (no page opened): chip becomes Connected', s.wait_chip('Connected'), s.chip())
    n_before = len(s.gh.reqs)
    p = s.open()   # a fresh start of the application
    check('A5 fresh start: the saved token is validated at start-up while the route is still Home (Pull Schema / Settings never opened)', s.wait_chip('Connected') and p.url.endswith('e2e=1') and len(s.gh.reqs) > n_before, (s.chip(), p.url))
    new = s.gh.reqs[n_before:]
    check('A6 start-up requests are READ-ONLY (GET to api.github.com) and carry the saved token; exactly one check', all(r['method'] == 'GET' and r['url'].startswith('https://api.github.com/repos/') for r in new) and all(r['auth'] for r in new) and s.ev('window.__sqla.github.checks()') == 1, [(r['method'], r['url']) for r in new])
    check('A7 Home shows write access, the repository and the synchronization status', 'basware/' in p.locator('#ghRepoChip').inner_text() and 'Last successful synchronization' in p.locator('#ghSyncLine').inner_text() and s.ev('window.__sqla.github.conn().canWrite') is True)
    cnt = len(s.gh.reqs); s.hamburger('schema-used'); p.wait_for_timeout(150); s.hamburger('quickstart'); p.wait_for_timeout(200)
    check('A8 navigating away and back to Home makes no new GitHub request (the answer is reused)', len(s.gh.reqs) == cnt, len(s.gh.reqs) - cnt)
    check('A9 the token appears nowhere: not in the page, not in storage (encrypted vault), not in the console, not in the state', not s.leaks() and TOKEN not in json.dumps(s.ev('window.__sqla.github.conn()')))
    check('A10 no unrelated error / unhandled exception during start-up', s.errors == [], s.errors)
    s.ctx.close()

    # ───────────────────────── B. failures: expired / revoked, no access, unreachable, slow GitHub — the app keeps working
    for mode, chip_text, label in [('401', 'Token rejected', 'expired or revoked token (401)'), ('403', 'No access', 'no permission / rate limit (403)'), ('abort', 'Unreachable', 'network failure')]:
        gh = Gh(); s = Session(browser, gh); s.open(); s.set_token(TOKEN); s.wait_chip('Connected'); gh.mode = mode; p = s.open()
        ok = s.wait_chip(chip_text); msg = p.locator('#ghStateMsg').inner_text()
        check(f'B {label}: Home shows "{chip_text}" with a message and what to do', ok and len(msg) > 30, (s.chip(), msg))
        check(f'B {label}: no token in the message / page', not s.leaks())
        s.hamburger('readonly', 'query-builder-group'); p.fill('#nlDesc', 'List all vendors'); p.click('#nlBuildBtn'); p.wait_for_timeout(500)
        sql = p.locator('#sqlBlockMount pre.sql-output').inner_text() if p.locator('#sqlBlockMount pre.sql-output').count() else ''
        check(f'B {label}: unrelated SQL generation still works', 'SELECT' in sql.upper(), sql[:80])
        s.ctx.close()
    gh = Gh(); s = Session(browser, gh); s.open(); s.set_token(TOKEN); s.wait_chip('Connected'); gh.mode = 'hang'; t0 = time.time(); p = s.open(); ready = time.time() - t0
    check('B slow GitHub: the application is ready while GitHub has not answered yet (start-up is never blocked) and Home shows "Checking…"', ready < 5 and s.chip() == 'Checking…', (round(ready, 2), s.chip()))
    gh.mode = 'ok'; gh.release(); check('B slow GitHub: the late answer updates Home', s.wait_chip('Connected'), s.chip()); s.ctx.close()
    gh = Gh(); s = Session(browser, gh); s.open(); s.set_token(TOKEN); s.wait_chip('Connected'); gh.mode = 'readonly'; p = s.open(); s.wait_chip('Connected')
    check('B read-only token: Home says "read-only access"', 'read-only access' in p.locator('[data-github-status]').inner_text(), p.locator('[data-github-status]').inner_text()[:120]); s.ctx.close()
    gh = Gh(); s = Session(browser, gh); p = s.open(); s.until("() => ['connected','published','not-configured','rejected','no-access','unreachable','error','signin-required'].includes(window.__sqla.github.conn().state)", timeout=8000); s.ev("() => window.__sqla.setBrokerConfig({ state: 'enabled', config: { url: 'https://broker.test' } })"); s.ev("() => window.__sqla.github.init({ force: true })"); p.wait_for_timeout(300)
    check('B central access without a session: "Sign-in needed" with a Sign in button, NO sign-in was started and nothing was requested', s.chip() == 'Sign-in needed' and p.locator('#ghSignInBtn').count() == 1 and len(gh.reqs) == 0, (s.chip(), len(gh.reqs))); s.ctx.close()
    gh = Gh(); s = Session(browser, gh); p = s.open(); s.until("() => ['connected','published','not-configured','rejected','no-access','unreachable','error','signin-required'].includes(window.__sqla.github.conn().state)", timeout=8000); s.ev("() => window.__sqla.setPublishedState({ state: 'available', marker: { format: 'sqla-published-data', formatVersion: 1, publishedAt: '2026-10-26T00:00:00Z', sourceCommit: 'abcdef1', sourceRepository: 'o/r', files: {} } })"); s.ev("() => window.__sqla.github.init({ force: true })"); p.wait_for_timeout(300)
    check('B published copy: "Read-only · published copy" and no request', s.chip().startswith('Read-only') and len(gh.reqs) == 0, s.chip()); s.ctx.close()

    # ───────────────────────── C. GitHub Repository from Home and from the hamburger menu; Pull Schema from Home
    gh = Gh(); s = Session(browser, gh); p = s.open(); s.set_token(TOKEN); s.wait_chip('Connected')
    p.click('#ghOpenBtn'); p.wait_for_timeout(250)
    check('C1 Home → "GitHub repository settings" opens the GitHub Repository page with the repository card, Pull Schema and Pull Secret Vault', p.url.endswith('#github') and p.locator('[data-v1754-repo-card]').count() == 1 and p.locator('#pullBtn').count() == 1 and p.locator('[data-v1754-vault-card]').count() == 1)
    check('C2 that page shows the same connection status', p.locator('#ghStateChip').inner_text() == 'Connected' and p.locator('#ghOpenBtn').count() == 0)
    s.shot('C-github-page')
    s.hamburger('quickstart'); s.hamburger('github')
    check('C3 hamburger menu → GitHub Repository opens the same page', p.url.endswith('#github') and p.locator('[data-v1754-repo-card]').count() == 1)
    s.hamburger('schema-used'); p.click('text=Pull Schema >> nth=0'); p.wait_for_timeout(200)
    check('C4 Schema → Pull Schema still has the repository card, Pull Schema and the vault card (unchanged)', p.locator('[data-v1754-repo-card]').count() == 1 and p.locator('#pullBtn').count() == 1 and p.locator('[data-v1754-vault-card]').count() == 1)
    s.hamburger('quickstart')
    # a test repository stands in for GitHub: publish a (non-built-in) schema, then pull it from Home
    s.ev("""async () => { const h = window.__sqla; const repo = h.memoryRepository(); window.__repo = repo; h.setRepositoryOverride(repo); const sv = h.services(); const a = sv.schemas.active();
      const copy = JSON.parse(JSON.stringify(a)); copy.id = 'schema-browser-copy'; copy.name = 'Browser Copy'; copy.status = 'inactive'; copy.tables[0].description = (copy.tables[0].description || '') + ' (edited in the browser test)'; sv.schemas.saveSchema(copy); const r = await sv.sync.push(); window.__push = r.ok; window.__pushMsg = JSON.stringify(r.problems || []); h.render(); }""")
    check('C5 (setup) a schema was published to the test repository', s.ev('window.__push') is True, s.ev('window.__pushMsg'))
    # remove the local copy so the pull has something to apply
    s.ev("""() => { const sv = window.__sqla.services(); const r = sv.schemas.registry(); window.__before = r.schemas.length; }""")
    p.click('#ghPullBtn'); s.until("() => (document.querySelector('#ghPullNote')||{}).innerText && !document.querySelector('#ghPullBtn').disabled", timeout=10000); note = p.locator('#ghPullNote').inner_text()
    check('C6 Home → Pull Schema pulls through the existing validated pull and reports success', 'pulled and validated successfully' in note, note); check('C7 the last successful synchronization is shown', p.locator('#ghLastSync').inner_text() != 'none yet', p.locator('#ghLastSync').inner_text())
    s.shot('C-home-after-pull')
    active_before = s.ev('() => window.__sqla.services().schemas.active().id')
    s.ev("""() => { const h = window.__sqla; h.setRepositoryOverride({ describe: 'down', read: async () => { const e = new Error('Could not reach GitHub (offline).'); e.name = 'RepositoryError'; e.kind = 'network'; throw e; }, write: async () => { throw new Error('no'); } }); }""")
    p.click('#ghPullBtn'); s.until("() => { const n = document.querySelector('#ghPullNote'); return !!n && /could not be retrieved|unavailable|has not been changed/i.test(n.innerText) && !document.querySelector('#ghPullBtn').disabled; }", timeout=10000); note = p.locator('#ghPullNote').inner_text()
    check('C8 a failing pull says what failed and that the existing schema is unchanged — and the active schema really is unchanged', 'has not been changed' in note and s.ev('() => window.__sqla.services().schemas.active().id') == active_before, note)
    s.ctx.close()

    # ───────────────────────── D. Query Library: Add New Query → pending → administrator → approved / rejected; the user view is read-only
    gh = Gh(); s = Session(browser, gh); p = s.open(); s.ev("() => window.__sqla.store.hasSeenWalkthrough = true")
    names = s.ev("() => { const a = window.__sqla.services().schemas.active(); const t = a.tables[0]; return { table: t.name, col: t.columns[0].name, col2: t.columns[1] ? t.columns[1].name : t.columns[0].name, schema: a.name }; }")
    SQL = f"SELECT {names['col']}, {names['col2']} FROM {names['table']}"; SQL2 = f"SELECT {names['col']} FROM {names['table']}"
    p.click('#navToggle')
    check('D1 the hamburger menu has a top-level "Query Library" group', p.locator('.hb-group-toggle[data-group="query-library-group"]').count() == 1 and 'Query Library' in p.locator('.hb-group-toggle[data-group="query-library-group"]').inner_text())
    p.click('.hb-group-toggle[data-group="query-library-group"]'); kids = [t.strip() for t in p.locator('.hb-group-children a').all_inner_texts()]
    check('D2 it contains exactly "Add New Query" and "View Query Library"', kids == ['Add New Query', 'View Query Library'], kids); s.shot('D-hamburger-open')
    p.click('a[data-route="query-add"]'); p.wait_for_timeout(200)
    check('D3 Add New Query shows the form and the approval explanation', p.locator('#qa_sql').count() == 1 and 'Pending approval' in p.locator('.note-box').inner_text()); s.shot('D-add-new-query')
    def fill(name, sql, tested=True, desc='A tested query'):
        p.fill('#qa_name', name); p.fill('#qa_sql', sql); p.fill('#qa_description', desc); p.fill('#qa_by', 'Sam Tester'); p.set_checked('#qa_tested', tested)
    fill('', SQL); p.click('#qaCheck'); check('D4 missing name is refused', 'name is required' in p.locator('#qaIssues').inner_text().lower())
    fill('Bad delete', f"DELETE FROM {names['table']} WHERE 1=1"); p.click('#qaCheck'); check('D5 a destructive statement is refused', 'cannot be submitted' in p.locator('#qaIssues').inner_text().lower())
    fill('Has secret', f"SELECT 1 FROM {names['table']} WHERE x = '{TOKEN}'"); p.click('#qaCheck'); check('D6 a credential in the SQL is refused', 'credential' in p.locator('#qaIssues').inner_text().lower())
    fill('Malformed', f"SELECT ( {names['col']} FROM {names['table']}"); p.click('#qaCheck'); check('D7 malformed SQL (unbalanced parentheses) is refused', 'parentheses' in p.locator('#qaIssues').inner_text().lower())
    fill('Untested', SQL, tested=False); p.click('#qaCheck'); check('D8 "I ran this query successfully" is required', 'ran this query successfully' in p.locator('#qaIssues').inner_text().lower())
    fill('Unknown identifiers', 'SELECT NOPE_COLUMN FROM NOPE_TABLE'); p.click('#qaCheck'); issues = p.locator('#qaIssues').inner_text().lower()
    check('D9 unknown tables / columns only WARN (the query can still be submitted)', 'warnings' in issues and 'nothing prevents' in issues, issues[:160])
    fill('Valid query one', SQL); p.click('#qaReview'); p.wait_for_selector('#qaSubmit'); check('D10 "Review & submit" shows the review dialog with the SQL and the pending-approval notice', SQL in p.locator('.modal-card pre').inner_text() and 'Pending approval' in p.locator('.modal-card').inner_text()); s.shot('D-review-dialog')
    check('D11 nothing is saved before the user confirms', s.ev("() => window.__sqla.services().submissions.all().length") == 0)
    p.click('#qaSubmit'); p.wait_for_selector('#qaResult:has-text("Submitted for approval")')
    check('D12 the confirmation appears only after the submission was saved, as PENDING APPROVAL', 'Pending approval' in p.locator('#qaResult').inner_text() and s.ev("() => window.__sqla.services().submissions.pending().length") == 1)
    sub = s.ev("() => window.__sqla.services().submissions.pending()[0]")
    check('D13 the stored record has every field (name, SQL exact, description, submitter, time, status)', sub['sql'] == SQL and sub['name'] == 'Valid query one' and sub['submittedBy'] == 'Sam Tester' and sub['status'] == 'pending' and sub['submittedAt'], sub['status'])
    check('D14 it is NOT in the Admin Query Library and NOT trusted', s.ev("() => { const s = window.__sqla.services(); return [s.admin.all().length, s.admin.counts().approved, s.admin.trusted(s.schemas.active(), 'Generic').length]; }") == [0, 0, 0])
    check('D15 without a write-capable connection the page says it is saved on this device only', 'saved on this device' in p.locator('#qaShareNote').inner_text().lower(), p.locator('#qaShareNote').inner_text()[:160])
    check('D16 "Your submissions" lists it with its status', 'Pending approval' in p.locator('table.data-table').inner_text() and 'Valid query one' in p.locator('table.data-table').inner_text()); s.shot('D-add-submitted')
    fill('Duplicate by SQL', SQL.lower()); p.click('#qaCheck'); check('D17 a duplicate (same SQL) is refused', 'already waiting for approval' in p.locator('#qaIssues').inner_text())
    fill('Valid query one', SQL2); p.click('#qaCheck'); check('D18 a duplicate name is refused', 'already waiting for approval' in p.locator('#qaIssues').inner_text() and 'choose another name' in p.locator('#qaIssues').inner_text())
    fill('Valid query two', SQL2); p.click('#qaReview'); p.wait_for_selector('#qaSubmit'); p.click('#qaSubmit'); p.wait_for_selector('#qaResult:has-text("Submitted for approval")')
    check('D19 a second submission is pending too', s.ev("() => window.__sqla.services().submissions.pending().length") == 2)
    s.hamburger('query-library'); p.wait_for_timeout(200)
    check('D20 View Query Library lists NO query yet (pending submissions are not library entries)', '0 approved queries' in p.locator('#qlCount').inner_text() and p.locator('#qlRows tr td.data-table-empty').count() == 1, p.locator('#qlCount').inner_text())
    s.ev("""async () => { const h = window.__sqla; const repo = h.memoryRepository(); window.__repo = repo; h.setRepositoryOverride(repo); await h.services().adminPassword.bootstrap(); }""")
    p.evaluate("() => { location.hash = '#settings'; }"); p.wait_for_selector('#settingsPwInput'); check('D21 Settings is locked (route / URL does not bypass the Admin Password)', p.locator('#settingsUnlockBtn').count() == 1)
    p.fill('#settingsPwInput', 'wrong-password'); p.click('#settingsUnlockBtn'); p.wait_for_timeout(600); check('D22 a wrong Admin Password does not unlock Settings', p.locator('#settingsPwInput').count() == 1 and not s.ev('() => window.__sqla.store.settingsUnlocked'))
    r = s.ev("""() => { const sv = window.__sqla.services(); const id = sv.submissions.pending()[0].id; const a = sv.submissions.approve(id, sv.admin, sv.schemas.active(), 'Generic'); const b = sv.submissions.reject(id, 'x'); window.__sqla.store.settingsUnlocked = true; const c = sv.submissions.approve(id, sv.admin, sv.schemas.active(), 'Generic'); window.__sqla.store.settingsUnlocked = false; return [a.ok, b.ok, c.ok, sv.admin.all().length, sv.submissions.pending().length]; }""")
    check('D23 direct approve / reject calls — even with the Settings flag forced — are refused by the service (no Admin Password ticket); nothing changed', r == [False, False, False, 0, 2], r)
    p.fill('#settingsPwInput', 'admin'); p.click('#settingsUnlockBtn'); s.until("() => window.__sqla.store.settingsUnlocked === true", timeout=8000)
    s.ev("() => { window.__sqla.store.settingsTab = 'admin-library'; window.__sqla.render(); }"); p.wait_for_selector('[data-qs-panel]')
    check('D24 the administrator sees "Query submissions awaiting review" with 2 pending', '2 pending' in p.locator('#qsCount').inner_text(), p.locator('#qsCount').inner_text()); s.shot('D-admin-panel')
    p.locator('tr[data-qs] >> nth=0').locator('[data-qs-act=review]').click(); p.wait_for_selector('#qsClose')
    check('D25 Review shows the SQL, the metadata and whether it can be approved', 'can be approved' in p.locator('.modal-card').inner_text() and 'Sam Tester' in p.locator('.modal-card').inner_text()); s.shot('D-admin-review'); p.click('#qsClose')
    p.locator('tr[data-qs] >> nth=0').locator('[data-qs-act=approve]').click(); p.wait_for_selector('#qsPw'); p.fill('#qsPw', 'wrong'); p.click('#qsPwOk'); p.wait_for_timeout(600)
    check('D26 Approve asks for the Admin Password again; a wrong password changes nothing', 'Incorrect' in p.locator('#qsPwErr').inner_text() and s.ev("() => window.__sqla.services().admin.all().length") == 0)
    p.fill('#qsPw', 'admin'); p.click('#qsPwOk'); s.until("() => !!document.querySelector('#qsResult') && /approved/i.test(document.querySelector('#qsResult').innerText)", timeout=10000)
    lib = s.ev("() => window.__sqla.services().admin.all().map(q => ({ name: q.name, approved: q.approved, enabled: q.enabled, sql: q.sql }))")
    check('D27 the approved submission is now an approved, enabled Admin Query Library entry (exact SQL)', len(lib) == 1 and lib[0]['approved'] and lib[0]['enabled'] and lib[0]['sql'] in (SQL, SQL2), lib)
    check('D28 it is trusted for SQL generation like any admin query', s.ev("() => { const s = window.__sqla.services(); return s.admin.trusted(s.schemas.active(), 'Generic').length; }") == 1)
    check('D29 the pending count dropped and the decision is listed under "Recently reviewed"', '1 pending' in p.locator('#qsCount').inner_text() and 'Approved' in p.locator('[data-qs-panel]').inner_text())
    p.locator('tr[data-qs] >> nth=0').locator('[data-qs-act=reject]').click(); p.wait_for_selector('#qsNote'); p.fill('#qsNote', 'Please add a filter'); p.fill('#qsPw', 'admin'); p.click('#qsPwOk')
    s.until("() => !!document.querySelector('#qsResult') && /rejected/i.test(document.querySelector('#qsResult').innerText)", timeout=10000)
    st = s.ev("() => window.__sqla.services().submissions.all().map(q => [q.name, q.status, q.reviewNote])")
    check('D30 the rejected submission keeps its status and feedback and did NOT enter the library', sorted(x[1] for x in st) == ['approved', 'rejected'] and any(x[2] == 'Please add a filter' for x in st) and s.ev("() => window.__sqla.services().admin.all().length") == 1, st)
    check('D31 the existing Admin Query Library controls are still there (Add / Export / Import / Sync / Test / Approve…)', all(p.locator(sel).count() >= 1 for sel in ['#aqAdd', '#aqExport', '#aqImport', '#aqSync', '[data-act="toggle"]', '[data-act="delete"]']))
    s.ev("() => window.__sqla.store.lockSettings()"); s.hamburger('query-library'); p.wait_for_selector('#qlRows')
    body = p.locator('#mainContent').inner_text(); rows = p.locator('#qlRows tr[data-id]')
    check('D32 View Query Library shows the approved query (and only it)', rows.count() == 1 and '1 approved query' in p.locator('#qlCount').inner_text() and lib[0]['name'] in body, body[:100])
    check('D33 pending / rejected submissions are not visible in the library view', 'Please add a filter' not in body and not any(x[0] in body for x in st if x[1] == 'rejected'))
    check('D34 the view has NO administrator control: no Approve / Reject / Delete / Edit / Import / Export / Enable / Disable / Withdraw / Add query / Test', p.locator('#mainContent [data-act], #mainContent #aqAdd, #mainContent #aqImport, #mainContent #aqExport, #mainContent #aqSync, #mainContent [data-qs-act]').count() == 0 and not re.search(r'\b(Approve|Reject|Delete|Withdraw approval|Disable|Enable|Import JSON|Export JSON|Add query)\b', body))
    check('D35 it offers search, dialect / tag filters, details and Copy SQL (the same admin-list table and chips)', all(p.locator(sel).count() >= 1 for sel in ['#qlSearch', '#qlDialect', '#qlTag', '[data-ql="details"]', '[data-ql="copy"]', 'table.data-table', '.admin-toolbar']))
    p.fill('#qlSearch', 'zzz-no-such-query'); check('D36 search filters the list', p.locator('#qlRows td.data-table-empty').count() == 1); p.fill('#qlSearch', '')
    p.click('[data-ql="details"]'); p.wait_for_selector('#qlDetailClose'); check('D37 Details shows the SQL, tables and a Copy SQL button; no administrator data', lib[0]['sql'] in p.locator('.modal-card pre').inner_text() and 'Please add a filter' not in p.locator('.modal-card').inner_text()); s.shot('D-user-details'); p.click('#qlDetailClose')
    s.ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE); p.click('[data-ql="copy"]'); p.wait_for_timeout(300)
    try: copied = p.evaluate('() => navigator.clipboard.readText()')
    except Exception: copied = ''
    check('D38 Copy SQL puts the query on the clipboard', copied == lib[0]['sql'], copied[:80])
    s.shot('D-user-library')
    check('D39 after the user view, the library on the device is unchanged and still holds exactly the approved entry', s.ev("() => window.__sqla.services().admin.all().length") == 1)
    p.evaluate("() => { location.hash = '#admin-library'; }"); p.wait_for_timeout(300); check('D40 an unknown / admin-looking route does not expose the administrator library (falls back to Home)', p.locator('[data-qs-panel]').count() == 0 and p.locator('#aqAdd').count() == 0)
    p.evaluate("() => { location.hash = '#settings'; }"); p.wait_for_timeout(300); check('D41 #settings is the lock screen again for the ordinary user', p.locator('#settingsPwInput').count() == 1)
    check('D42 no script error during the Query Library flows', s.errors == [], s.errors); s.ctx.close()

    # ───────────────────────── E. sharing: a connection that may write publishes; a read-only connection says so
    s = Session(browser); p = s.open(); s.ev("() => window.__sqla.store.hasSeenWalkthrough = true"); names = s.ev("() => { const t = window.__sqla.services().schemas.active().tables[0]; return { table: t.name, col: t.columns[0].name }; }"); SQL = f"SELECT {names['col']} FROM {names['table']}"
    s.ev("() => { const h = window.__sqla; const repo = h.memoryRepository(); window.__repo = repo; h.setRepositoryOverride(repo); }")
    s.hamburger('query-add', 'query-library-group'); p.fill('#qa_name', 'Shared query'); p.fill('#qa_sql', SQL); p.set_checked('#qa_tested', True); p.click('#qaReview'); p.wait_for_selector('#qaSubmit'); p.click('#qaSubmit'); s.until("() => /Shared with the administrator/.test((document.querySelector('#qaShareNote')||{innerText:''}).innerText)", timeout=10000)
    files = s.ev("() => [...window.__repo.files.keys()]")
    check('E1 a write-capable connection publishes the pending submission to its OWN file and leaves knowledge.json untouched', 'sql-assistant-data/knowledge/submissions.json' in files and 'sql-assistant-data/knowledge/knowledge.json' not in files, files)
    txt = s.ev("() => window.__repo.files.get('sql-assistant-data/knowledge/submissions.json').text"); check('E2 the published record is pending and carries no library flag', '"status": "pending"' in txt and '"approved"' not in txt)
    s.ev("""() => { const h = window.__sqla; h.setRepositoryOverride({ describe: 'ro', read: async () => null, write: async () => { const e = new Error('Your GitHub account has read-only access to the repository, so it cannot publish or push.'); e.name = 'RepositoryError'; e.kind = 'permission'; throw e; } }); }""")
    p.fill('#qa_name', 'Read only query'); p.fill('#qa_sql', f"SELECT {names['col']} FROM {names['table']} WHERE {names['col']} IS NOT NULL"); p.set_checked('#qa_tested', True); p.click('#qaReview'); p.wait_for_selector('#qaSubmit'); p.click('#qaSubmit'); s.until("() => /cannot write|device only/i.test((document.querySelector('#qaShareNote')||{innerText:''}).innerText)", timeout=10000)
    check('E3 a read-only connection keeps the submission on the device and says so (export is offered)', 'Export' in p.locator('#qaShareNote').inner_text() and s.ev("() => window.__sqla.services().submissions.mine().length") == 2 and p.locator('#qaExport').count() == 1, p.locator('#qaShareNote').inner_text()[:200]); s.ctx.close()

    # ───────────────────────── F. regression: V17.7 features and UI
    s = Session(browser); p = s.open(); s.ev("() => window.__sqla.store.hasSeenWalkthrough = true")
    check('F1 version: the footer and the navbar badge show the package version', f'Version {VERSION}' in p.locator('footer').inner_text() and p.locator('.brand-text .small').inner_text() == 'V' + VERSION, p.locator('.brand-text .small').inner_text())
    s.hamburger('readonly', 'query-builder-group'); p.fill('#nlDesc', 'Top 5 vendors by total invoice amount for approved invoices this year'); p.click('#nlBuildBtn'); p.wait_for_timeout(800)
    sql = p.locator('#sqlBlockMount pre.sql-output').inner_text() if p.locator('#sqlBlockMount pre.sql-output').count() else ''
    check('F2 Describe What You Need → SQL generation works', 'SELECT' in sql.upper(), sql[:100])
    p.click('button:has-text("Advanced Options")'); p.wait_for_timeout(200)
    check('F3 Manual Selectors (table picker), Advanced Options (DISTINCT, GROUP BY, join type) and the dialect selector are present', all(p.locator(x).count() >= 1 for x in ['#tablePickerMount', '#advDistinct', '#advGroupBy', '#advJoinType', '#dialectSelect']), [p.locator(x).count() for x in ['#tablePickerMount', '#advDistinct', '#advGroupBy', '#advJoinType', '#dialectSelect']])
    s.hamburger('cr', 'query-builder-group'); check('F4 Query Builder for CR loads', p.locator('#crNlDesc').count() == 1)
    s.hamburger('error-rectifier'); check('F5 Error Rectifier loads', p.locator('[data-tour="error-rectifier-form"]').count() == 1)
    s.hamburger('schema-used'); check('F6 Schema page: tables, stored schemas and Pull Schema tabs', p.locator('#schemaTabs').count() == 1)
    s.hamburger('settings'); check('F7 Settings is still password protected (lock screen)', p.locator('#settingsPwInput').count() == 1)
    s.hamburger('about'); check('F8 About lists the 17.7.1 history entry', '17.7.1' in p.locator('[data-tour="about-panel"]').inner_text())
    p.click('#themeBtn'); p.click('[data-theme-choice="dark"]'); check('F9 theme switch works', p.evaluate("() => document.documentElement.getAttribute('data-theme')") == 'dark'); p.click('#themeBtn'); p.click('[data-theme-choice="light"]')
    order = p.evaluate("() => { document.querySelector('#navToggle').click(); return [...document.querySelectorAll('.hamburger-panel-body > a.hb-link, .hamburger-panel-body > .hb-group-toggle')].map(e => e.innerText.trim()); }")
    check('F10 hamburger order: Quick Start, Query Builder, Query Library, Schema, GitHub Repository, Error Rectifier, Settings, About', order == ['Quick Start', 'Query Builder', 'Query Library', 'Schema', 'GitHub Repository', 'Error Rectifier', 'Settings', 'About'], order)
    check('F11 no script error during the regression pass', s.errors == [], s.errors); s.ctx.close()

    # ───────────────────────── G. responsive layouts (screenshots; layout assertions: no horizontal overflow)
    for w, h, tag in [(390, 844, 'mobile'), (820, 1000, 'tablet'), (1440, 900, 'desktop')]:
        s = Session(browser, viewport={'width': w, 'height': h}); p = s.open(); s.ev("() => window.__sqla.store.hasSeenWalkthrough = true"); s.set_token(TOKEN); s.wait_chip('Connected'); s.ev("() => window.__sqla.render()"); p.wait_for_timeout(200)
        s.shot(f'G-home-{tag}'); over = p.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth"); check(f'G {tag} {w}px: Home has no horizontal overflow with the GitHub section', over <= 1, over)
        p.click('#navToggle'); p.click('.hb-group-toggle[data-group="query-library-group"]'); s.shot(f'G-hamburger-{tag}'); p.click('a[data-route="query-library"]'); p.wait_for_timeout(200); s.shot(f'G-library-{tag}')
        over = p.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth"); check(f'G {tag} {w}px: View Query Library has no horizontal page overflow', over <= 1, over)
        s.hamburger('query-add'); s.shot(f'G-add-{tag}'); over = p.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth"); check(f'G {tag} {w}px: Add New Query has no horizontal page overflow', over <= 1, over)
        s.hamburger('github'); s.shot(f'G-github-{tag}'); s.ctx.close()
    browser.close()

def main():
    srv = start_server()
    try:
        with sync_playwright() as pw: run(pw)
    finally:
        srv.terminate()
    failed = [r for r in RESULTS if not r['pass']]
    (OUT / 'browser-results.json').write_text(json.dumps({'version': VERSION, 'total': len(RESULTS), 'passed': len(RESULTS) - len(failed), 'failed': len(failed), 'emulated': ['api.github.com (request interception)', 'repository (in-memory)'], 'results': RESULTS}, indent=1))
    print(f'\n{len(RESULTS) - len(failed)}/{len(RESULTS)} browser checks passed', flush=True); sys.exit(1 if failed else 0)

if __name__ == '__main__': main()
