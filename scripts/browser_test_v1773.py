#!/usr/bin/env python3
"""
V17.7.3 browser suite — optional Usage Analytics (provider "service"), end to end in a real Chromium against the PRODUCTION build (release/) and the REAL analytics service (server/analytics-service.mjs):

  A  analytics off (no deployed configuration): the Analytics entry is visible, the dialog explains that analytics is not enabled, nothing is requested, SQL Assistant works
  B  Administrator Authentication: dialog on selection · no dashboard data before authentication · wrong password = "Invalid administrator password" and nothing is exposed · the password and the token are
     nowhere in the page / storage / URL · Lock Analytics · reload requires authentication again · inactivity lock · activity keeps the session · date-range filter · the 11 KPI cards and the usage views
  C  measurement: unique users are not counted per session · active time excludes hidden and idle time · only metadata leaves the page (no SQL, no description, no result) · features and generations
  D  failure handling: service stopped, invalid configuration, administrator authentication switched off, administrator password not set — SQL Assistant keeps working
  E  password rotation from the dashboard (file credential) and the platform-managed (read-only) case
  F  regression: every route, the version everywhere, the hamburger menu, Settings still locked, no uncaught page error

Run:  node scripts/build.mjs && python3 scripts/browser_test_v1773.py      (Chromium: $SQLA_CHROMIUM, or the Playwright default)
Results: test-results-v17.7.3/browser-results.json
"""
import json, os, re, socket, subprocess, sys, tempfile, time, glob, urllib.request, urllib.error, shutil
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = json.load(open(os.path.join(ROOT, 'package.json')))
VERSION = PKG['version']
PW = 'SYNTHETIC-Correct-Horse-9'; PW2 = 'SYNTHETIC-Another-Passphrase-77'
results = []
def check(name, ok, detail=''):
    results.append({'name': name, 'pass': bool(ok), 'detail': str(detail)[:300]})
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  -> {str(detail)[:300]}'), flush=True)
    return bool(ok)

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p
def wait_port(port, secs=15):
    t = time.time()
    while time.time() - t < secs:
        try: socket.create_connection(('127.0.0.1', port), 0.3).close(); return True
        except OSError: time.sleep(0.2)
    return False

def chromium_path():
    p = os.environ.get('SQLA_CHROMIUM')
    if p: return p
    for pat in ('/opt/pw-browsers/chromium-*/chrome-linux64/chrome', os.path.expanduser('~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome')):
        m = sorted(glob.glob(pat))
        if m: return m[-1]
    return None

SITE_PORT = free_port(); SITE = f'http://127.0.0.1:{SITE_PORT}'
procs = []; tmpdirs = []
def start_site():
    p = subprocess.Popen(['node', os.path.join(ROOT, 'scripts/serve.mjs')], env={**os.environ, 'PORT': str(SITE_PORT)}, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT); procs.append(p)
    assert wait_port(SITE_PORT), 'site did not start'

class Service:
    """the REAL analytics service as a separate process; password: 'file' (set by the command line), 'env' (a platform-managed hash) or None"""
    def __init__(self, password='file', port=None, data_dir=None, extra_env=None):
        self.port = port or free_port(); self.url = f'http://127.0.0.1:{self.port}'; self.dir = data_dir or tempfile.mkdtemp(prefix='sqla-an-'); tmpdirs.append(self.dir)
        self.env = {**os.environ, 'SQLA_ANALYTICS_ALLOWED_ORIGINS': SITE, 'SQLA_ANALYTICS_DATA_DIR': self.dir, 'PORT': str(self.port), 'HOST': '127.0.0.1', 'SQLA_ANALYTICS_AUDIT_LOG': '0', **(extra_env or {})}
        for k in ('SQLA_ANALYTICS_ADMIN_PASSWORD', 'SQLA_ANALYTICS_ADMIN_PASSWORD_HASH'): self.env.pop(k, None)
        node = ['node', os.path.join(ROOT, 'server/analytics-service.mjs')]
        if password == 'file':
            r = subprocess.run(node + ['set-admin-password', '--stdin', '--data-dir', self.dir], input=PW + '\n', text=True, capture_output=True, env=self.env); assert r.returncode == 0, r.stderr
        elif password == 'env':
            r = subprocess.run(node + ['hash-password', '--stdin'], input=PW + '\n', text=True, capture_output=True, env=self.env); assert r.returncode == 0, r.stderr; self.env['SQLA_ANALYTICS_ADMIN_PASSWORD_HASH'] = r.stdout.strip()
        self.proc = None; self.start()
    def start(self):
        self.proc = subprocess.Popen(['node', os.path.join(ROOT, 'server/analytics-service.mjs')], env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT); procs.append(self.proc)
        assert wait_port(self.port), 'service did not start'
    def stop(self):
        if self.proc and self.proc.poll() is None: self.proc.terminate(); self.proc.wait(timeout=10)
    def call(self, method, path, body=None, token=None):
        req = urllib.request.Request(self.url + path, method=method, data=(json.dumps(body).encode() if body is not None else None), headers={'Origin': SITE, **({'Authorization': f'Bearer {token}'} if token else {}), **({'Content-Type': 'text/plain'} if body is not None else {})})
        try:
            with urllib.request.urlopen(req, timeout=10) as r: return r.status, json.loads(r.read().decode() or '{}')
        except urllib.error.HTTPError as e:
            try: return e.code, json.loads(e.read().decode() or '{}')
            except Exception: return e.code, {}
    def login(self, pw=PW):
        s, j = self.call('POST', '/v1/admin/login', {'password': pw}); return j.get('token') if s == 200 else None
    def summary(self, frm, to, pw=PW):
        t = self.login(pw); assert t, 'service login failed'; s, j = self.call('GET', f'/v1/admin/summary?from={frm}&to={to}', token=t); self.call('POST', '/v1/admin/logout', {}, t); return j

def cfg(url, **kw):
    a = {'enabled': True, 'provider': 'service', 'serviceUrl': url, 'inactivityTimeout': 5, 'adminSessionTimeout': 10}; a.update(kw); return {'analytics': a}

class Page:
    def __init__(self, browser, config=None, config_status=200, raw_config=None, storage_state=None):
        self.ctx = browser.new_context(viewport={'width': 1366, 'height': 900}, storage_state=storage_state)
        self.ctx.add_init_script("try { localStorage.setItem('sqla.tourseen.v15', '1'); } catch (e) {}")
        self.config = config; self.raw = raw_config; self.status = config_status
        self.ctx.route('**/sql-assistant-data/analytics.config.json', self._cfg)
        self.page = self.ctx.new_page(); self.errors = []; self.consoles = []; self.requests = []; self.posts = []; self.login_bodies = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.on('console', lambda m: self.consoles.append(m.text) if m.type == 'error' else None)
        self.page.on('request', self._req)
        self.page.on('response', self._resp)
    def _cfg(self, route):
        if self.raw is not None: route.fulfill(status=200, content_type='application/json', body=self.raw)
        elif self.config is None or self.status != 200: route.fulfill(status=404, body='')
        else: route.fulfill(status=200, content_type='application/json', body=json.dumps(self.config))
    def _req(self, r):
        self.requests.append((r.method, r.url))
        if r.method == 'POST' and '/v1/events' in r.url:
            try: self.posts.append(r.post_data or '')
            except Exception: pass
    def _resp(self, r):
        if '/v1/admin/login' in r.url and r.status == 200:
            try: self.login_bodies.append(r.text())
            except Exception: pass
    def open(self, path=''):
        self.page.goto(f'{SITE}/{path}'); self.page.wait_for_selector('html[data-sqla-ready]', timeout=15000); time.sleep(0.8)
    def nav_analytics(self):
        self.page.click('#navToggle'); self.page.click('a[data-route="analytics"]')
    def text(self): return self.page.inner_text('body')
    def svc_requests(self, svc, frag=''): return [u for m, u in self.requests if u.startswith(svc.url) and frag in u]
    def hide(self):
        self.page.evaluate("() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__vs || 'visible' }); window.__vs = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); }")
    def show(self):
        self.page.evaluate("() => { window.__vs = 'visible'; document.dispatchEvent(new Event('visibilitychange')); }")
    def unlock(self, pw=PW):
        self.nav_analytics(); self.page.wait_for_selector('#analyticsAuthModal'); self.page.fill('#anAuthPw', pw); self.page.click('#anAuthOk')
        self.page.wait_for_selector('.an-kpis', timeout=10000)
    def close(self): self.ctx.close()
def bad_errors(p): return [e for e in p.errors]
def benign(msg): return bool(re.search(r'status of (404|401)|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|Failed to load resource', msg))
def kpi_value(p, name): return p.page.inner_text(f'[data-kpi="{name}"] [data-kpi-value]').strip()
def parse_dur(s):
    h = re.search(r'(\d+) h', s); m = re.search(r'(\d+) min', s); x = re.search(r'(\d+) s', s); return (int(h.group(1)) * 3600 if h else 0) + (int(m.group(1)) * 60 if m else 0) + (int(x.group(1)) if x else 0)
def generate_describe(p, text):
    p.page.goto(f'{SITE}/#describe-readonly'); p.page.wait_for_selector('#nlDesc'); p.page.fill('#nlDesc', text); p.page.click('#nlBuildBtn'); p.page.wait_for_selector('#nlResult [data-result-status]', timeout=15000)

def main():
    exe = chromium_path(); start_site()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(**({'executable_path': exe} if exe else {}), args=['--no-sandbox'])
        try:
            # ═══════════════════════════ A · analytics off
            p = Page(browser, config=None)
            p.open(); p.page.click('#navToggle'); labels = [t.strip() for t in p.page.locator('.hamburger-panel-body a.hb-link').all_inner_texts()]
            check('A1 the hamburger menu has an "Analytics" entry (visible without any configuration)', 'Analytics' in labels, labels)
            check('A2 Analytics sits between Error Rectifier and Settings; every earlier entry is still there', all(x in labels for x in ['Quick Start', 'Schema', 'GitHub Repository', 'Error Rectifier', 'Settings', 'About']) and labels.index('Error Rectifier') < labels.index('Analytics') < labels.index('Settings'), labels)
            p.page.click('a[data-route="analytics"]'); p.page.wait_for_selector('#analyticsAuthModal')
            check('A3 selecting it opens the "Administrator Authentication" dialog', 'Administrator Authentication' in p.page.inner_text('#analyticsAuthModal'))
            check('A4 with analytics off the dialog says so, has no password field and Unlock is disabled', 'not enabled' in p.page.inner_text('#anAuthUnavailable') and p.page.locator('#anAuthPw').count() == 0 and p.page.locator('#anAuthOk').is_disabled(), p.page.inner_text('#analyticsAuthModal'))
            p.page.click('#anAuthCancel'); check('A5 Cancel closes the dialog; the page shows "Analytics is locked" and NO dashboard data', p.page.locator('#analyticsAuthModal').count() == 0 and p.page.locator('[data-an-state="locked"]').count() == 1 and p.page.locator('.an-kpi').count() == 0)
            check('A6 nothing was requested from any analytics service', not [u for m, u in p.requests if '/v1/' in u], [u for m, u in p.requests if '/v1/' in u])
            generate_describe(p, 'show all vendors'); check('A7 SQL generation works exactly as before', p.page.locator('#nlResult [data-result-status]').count() == 1)
            check('A8 no uncaught page error', not bad_errors(p), p.errors); p.close()

            # ═══════════════════════════ B · Administrator Authentication
            svc = Service(password='file'); p = Page(browser, config=cfg(svc.url)); p.open()
            p.page.click('#navToggle'); p.page.click('a[data-route="analytics"]'); p.page.wait_for_selector('#analyticsAuthModal')
            check('B1 the dialog is titled "Administrator Authentication" and asks for the administrator password (masked, not auto-filled)', 'Administrator Authentication' in p.page.inner_text('#analyticsAuthModal') and p.page.get_attribute('#anAuthPw', 'type') == 'password' and p.page.get_attribute('#anAuthPw', 'autocomplete') == 'off')
            check('B2 BEFORE authentication the page holds no dashboard data: no KPI, no chart, no table, none of the labels', p.page.locator('.an-kpi, .an-chart, .an-table').count() == 0 and 'Unique Users' not in p.text().replace('What is measured', ''))
            check('B3 BEFORE authentication no administrator endpoint was requested', not p.svc_requests(svc, '/v1/admin/summary'))
            p.page.fill('#anAuthPw', 'not-the-password-123'); p.page.click('#anAuthOk'); p.page.wait_for_function("() => document.querySelector('#anAuthMsg').innerText.trim().length > 0")
            check('B4 a wrong password shows exactly "Invalid administrator password"', p.page.inner_text('#anAuthMsg').strip() == 'Invalid administrator password', p.page.inner_text('#anAuthMsg'))
            check('B5 the password field is cleared after the attempt, the dialog stays, and still no dashboard data exists', p.page.input_value('#anAuthPw') == '' and p.page.locator('#analyticsAuthModal').count() == 1 and p.page.locator('.an-kpi').count() == 0)
            check('B6 the failed attempt exposed nothing: no summary request, no configuration text, no hint about the password', not p.svc_requests(svc, '/v1/admin/summary') and not re.search(r'scrypt|hash|salt|configured|length|characters', p.page.inner_text('#anAuthMsg'), re.I))
            p.page.fill('#anAuthPw', PW); p.page.click('#anAuthOk'); p.page.wait_for_selector('.an-kpis', timeout=10000)
            check('B7 the correct password opens the dashboard and closes the dialog', p.page.locator('#analyticsAuthModal').count() == 0 and p.page.locator('[data-an-state="unlocked"]').count() == 1)
            kp = ['unique-users', 'daily-active-users', 'weekly-active-users', 'monthly-active-users', 'total-sessions', 'average-active-time', 'total-active-time', 'queries-generated', 'successful-generations', 'failed-generations', 'success-rate']
            names = {k: p.page.text_content(f'[data-kpi="{k}"] .an-kpi-label').strip() for k in kp if p.page.locator(f'[data-kpi="{k}"]').count()}
            check('B8 all 11 KPI cards are shown with their names', names == {'unique-users': 'Unique Users', 'daily-active-users': 'Daily Active Users', 'weekly-active-users': 'Weekly Active Users', 'monthly-active-users': 'Monthly Active Users', 'total-sessions': 'Total Sessions', 'average-active-time': 'Average Active Usage Time', 'total-active-time': 'Total Active Usage Time', 'queries-generated': 'SQL Queries Generated', 'successful-generations': 'Successful Generations', 'failed-generations': 'Failed Generations', 'success-rate': 'Success Rate'}, names)
            check('B9 the usage views are shown: trend, daily / weekly / monthly utilization, most-used features, application versions', all(p.page.locator(f'[data-view="{v}"]').count() == 1 for v in ['trend', 'utilization', 'features', 'versions']) and all(p.page.locator(f'.tab-btn[data-tab="{t}"]').count() == 1 for t in ['daily', 'weekly', 'monthly']))
            for tab in ['weekly', 'monthly', 'daily']:
                p.page.click(f'.tab-btn[data-tab="{tab}"]'); check(f'B10 the {tab} utilization tab renders a table', p.page.locator(f'.tab-panel[data-panel="{tab}"] table.an-table, .tab-panel[data-panel="{tab}"] [data-empty]').count() == 1)
            storage = p.page.evaluate("() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), location.href, document.cookie])"); html = p.page.evaluate("() => document.documentElement.outerHTML")
            token = json.loads(p.login_bodies[-1])['token'] if p.login_bodies else '(none)'
            check('B11 the password is nowhere in the page: not in the DOM, not in localStorage / sessionStorage, not in the URL, not in cookies', PW not in html and PW not in storage and 'not-the-password-123' not in html + storage, '')
            check('B12 the session token is nowhere in storage, URL, cookies or the DOM (it lives in memory only)', token != '(none)' and token not in storage and token not in html and token.split('.')[1] not in storage)
            src = open(os.path.join(ROOT, 'release/index.html'), encoding='utf-8').read(); live = p.page.evaluate("() => document.documentElement.outerHTML")
            check('B13 the delivered page (bundle) contains neither the password, nor any password hash, nor a password literal', PW not in src and not re.search(r'scrypt\$\d', src) and 'SYNTHETIC-' not in src and PW not in live)
            p.page.click('#anLock'); p.page.wait_for_selector('[data-an-state="locked"]')
            check('B14 "Lock Analytics" returns to the locked page and removes every number from the page', p.page.locator('.an-kpi, .an-chart, .an-table').count() == 0)
            s, _ = svc.call('GET', '/v1/admin/summary', token=token); check('B15 locking revoked the session at the service: the old token no longer works', s == 401, s)
            p.page.click('#anUnlockBtn'); p.page.wait_for_selector('#analyticsAuthModal'); check('B16 unlocking again asks for the password again', p.page.locator('#anAuthPw').count() == 1); p.page.fill('#anAuthPw', PW); p.page.click('#anAuthOk'); p.page.wait_for_selector('.an-kpis')
            p.page.reload(); p.page.wait_for_selector('html[data-sqla-ready]'); p.page.wait_for_selector('#analyticsAuthModal')  # the address still names the Analytics page: the dialog opens by itself
            check('B17 closing / reloading the application requires authentication again (no session survives a reload)', p.page.locator('.an-kpi').count() == 0 and p.page.locator('#anAuthPw').count() == 1)
            p.page.fill('#anAuthPw', PW); p.page.click('#anAuthOk'); p.page.wait_for_selector('.an-kpis')
            today_utc = time.strftime('%Y-%m-%d', time.gmtime()); from7 = time.strftime('%Y-%m-%d', time.gmtime(time.time() - 6 * 86400))
            p.page.select_option('#anPreset', '7d'); p.page.wait_for_function("(r) => document.querySelector('[data-range]').innerText === r", arg=f'{from7} – {today_utc}', timeout=10000)
            rng = p.page.inner_text('[data-range]'); days = len(p.page.locator('.tab-panel[data-panel="daily"] tbody tr').all())
            check('B18 the date-range filter: "Last 7 days" shows 7 days', days == 7 and re.match(r'\d{4}-\d\d-\d\d – \d{4}-\d\d-\d\d', rng), (days, rng))
            req = [u for u in p.svc_requests(svc, '/v1/admin/summary')][-1]; check('B19 the range is sent to the service as UTC dates (from / to)', re.search(r'from=\d{4}-\d\d-\d\d&to=\d{4}-\d\d-\d\d', req), req)
            p.page.select_option('#anPreset', 'custom'); p.page.wait_for_selector('#anFrom'); p.page.fill('#anFrom', '2026-02-10'); p.page.fill('#anTo', '2026-02-01'); p.page.click('#anApply')
            check('B20 an invalid custom range (start after end) is refused with a reason and nothing is requested', 'start date' in p.page.inner_text('#anRangeMsg') and not [u for u in p.svc_requests(svc, 'from=2026-02-10')])
            p.page.fill('#anFrom', '2026-02-01'); p.page.fill('#anTo', '2026-02-10'); p.page.click('#anApply'); p.page.wait_for_function("() => document.querySelector('[data-range]').innerText === '2026-02-01 – 2026-02-10'", timeout=10000)
            check('B21 a valid custom range is applied (10 daily rows)', len(p.page.locator('.tab-panel[data-panel="daily"] tbody tr').all()) == 10)
            p.close()
            p = Page(browser, config=cfg(svc.url, adminSessionTimeout=12)); p.open(); p.unlock(); t0 = time.time()
            for _ in range(6): time.sleep(2.5); p.page.click('#anRefresh', timeout=5000)
            check('B22 activity inside the inactivity period keeps Analytics unlocked (15 s of use with a 12 s timeout)', p.page.locator('[data-an-state="unlocked"]').count() == 1 and time.time() - t0 > 14)
            p.page.wait_for_selector('[data-an-state="locked"]', timeout=25000); idle_after = time.time() - t0
            check('B23 after the configured inactivity period Analytics locks itself and says so', p.page.locator('.an-kpi').count() == 0 and re.search(r'locked automatically after inactivity', p.text()), idle_after)
            check('B24 no uncaught page error in the authentication flows', not p.errors, p.errors); p.close()

            # ═══════════════════════════ C · measurement
            svc = Service(password='file'); c = cfg(svc.url, inactivityTimeout=5, adminSessionTimeout=60)
            p = Page(browser, config=c); p.open(); uid1 = p.page.evaluate("() => localStorage.getItem('sqla.analytics.uid.v1773')")
            check('C1 the per-device id is created (random, 32 hex) and kept in browser storage', re.fullmatch(r'[a-f0-9]{32}', uid1 or ''), uid1)
            for i in range(3):
                p.page.goto(f'{SITE}/#quickstart'); p.page.reload(); p.page.wait_for_selector('html[data-sqla-ready]'); p.page.click('body', position={'x': 600, 'y': 400}); time.sleep(0.6)
            uid2 = p.page.evaluate("() => localStorage.getItem('sqla.analytics.uid.v1773')"); check('C2 the same browser profile keeps the same device id across sessions', uid1 == uid2, (uid1, uid2))
            SECRET_TEXT = 'ZZ-PRIVATE-DESC-9f3 total invoice amount per vendor over 1000'
            generate_describe(p, SECRET_TEXT); ok_status = p.page.get_attribute('#nlResult [data-result-status]', 'data-result-status')
            p.page.goto(f'{SITE}/#describe-readonly'); p.page.fill('#nlDesc', 'xyzzy plugh frobnicate ZZ-PRIVATE-NOISE'); p.page.click('#nlBuildBtn'); p.page.wait_for_selector('#nlResult [data-result-status="error"]', timeout=15000)
            p.page.goto(f'{SITE}/#about'); p.page.click('body', position={'x': 500, 'y': 300}); time.sleep(0.5)
            p.hide(); time.sleep(1.5)
            p.page.goto(f'{SITE}/#settings'); p.hide(); time.sleep(2.0)
            deadline = time.time() + 12; sm = None
            while time.time() < deadline:
                today = time.strftime('%Y-%m-%d', time.gmtime()); sm = svc.summary(today, today)
                if sm.get('kpi', {}).get('generated', 0) >= 2: break
                time.sleep(1)
            k = sm['kpi']
            check('C3 usage reached the service: sessions, generations (one valid, one failed) and active time', k['generated'] == 2 and k['successful'] == 1 and k['failed'] == 1 and k['totalSessions'] >= 3 and k['totalActiveMs'] > 0, k)
            check('C4 UNIQUE USERS: several sessions of one browser profile are ONE unique user', k['uniqueUsers'] == 1 and k['totalSessions'] >= 3, k)
            check('C5 the success rate is successful / generated', k['successRate'] == 50.0, k['successRate'])
            fe = {f['id']: f['count'] for f in sm['features']}; check('C6 the most-used features include the pages that were opened and the Describe page', fe.get('describe-read-only', 0) >= 1 and fe.get('quick-start', 0) >= 3 and 'about' in fe and 'settings' in fe, fe)
            check('C7 the application version in use is the build version', sm['versions'] and sm['versions'][0]['version'] == VERSION, sm['versions'])
            bodies = '\n'.join(p.posts); events = []
            for b in p.posts:
                try: events += json.loads(b)['events']
                except Exception: pass
            allowed = {'v', 'eid', 't', 'ts', 'uid', 'sid', 'ver', 'usr', 'ms', 'f', 'k', 'ok', 'rv'}
            check('C8 PRIVACY: every field of every event that left the page is a whitelisted metadata field', events and all(set(e) <= allowed for e in events), sorted({k2 for e in events for k2 in e} - allowed))
            check('C9 PRIVACY: the description text, generated SQL, table / column names and any SQL keyword never left the page', not re.search(r'ZZ-PRIVATE|SELECT|FROM |WHERE|INVOICE|VENDOR|xyzzy|GROUP BY', bodies, re.I), bodies[:200])
            storeblob = p.page.evaluate("() => JSON.stringify(Object.entries(localStorage).filter(([k]) => k.startsWith('sqla.analytics')))"); service_files = ''.join(open(f, encoding='utf-8', errors='ignore').read() for f in glob.glob(os.path.join(svc.dir, '*.json')))
            check('C10 PRIVACY: nothing of the kind is in the browser queue or in the files of the service either', not re.search(r'ZZ-PRIVATE|SELECT|INVOICE|VENDOR', storeblob + service_files) and uid1 not in service_files, '')
            kinds = {e.get('k') for e in events if e['t'] == 'generation'}; check('C11 a generation event names only the builder and the outcome', kinds <= {'describe-read-only'} and all(set(e) <= {'v', 'eid', 't', 'ts', 'uid', 'sid', 'ver', 'k', 'ok', 'rv'} for e in events if e['t'] == 'generation'), kinds)
            check('C12 no uncaught page error while measuring', not p.errors, p.errors); p.close()
            p = Page(browser, config=cfg(svc.url, adminSessionTimeout=60)); p.open(); p.unlock(); time.sleep(0.5)
            oracle = svc.summary(time.strftime('%Y-%m-%d', time.gmtime(time.time() - 29 * 86400)), time.strftime('%Y-%m-%d', time.gmtime()))['kpi']
            check('C13 the dashboard shows the same numbers as the service (unique users, sessions, generations)', kpi_value(p, 'unique-users') == str(oracle['uniqueUsers']) and kpi_value(p, 'queries-generated') == str(oracle['generated']) and kpi_value(p, 'total-sessions') == str(oracle['totalSessions']), (kpi_value(p, 'unique-users'), kpi_value(p, 'queries-generated'), oracle))
            check('C14 the trend chart and the feature / version rankings are drawn from that data', p.page.locator('[data-view="trend"] svg.an-chart, [data-view="trend"] [data-empty]').count() == 1 and p.page.locator('[data-view="features"] .an-rank li').count() >= 3 and p.page.locator('[data-view="versions"] .an-rank li').count() >= 1)
            check('C15 the "Total Active Usage Time" is shown as a duration and is greater than zero', parse_dur(kpi_value(p, 'total-active-time')) > 0, kpi_value(p, 'total-active-time')); p.close()

            svc = Service(password='file'); p = Page(browser, config=cfg(svc.url, inactivityTimeout=5)); p.open(); t_open = time.time()
            p.page.click('body', position={'x': 600, 'y': 400}); time.sleep(12)
            p.hide(); time.sleep(0.8)
            first = None; deadline = time.time() + 10
            while time.time() < deadline:
                today = time.strftime('%Y-%m-%d', time.gmtime()); first = svc.summary(today, today)['kpi']['totalActiveMs']
                if first > 0: break
                time.sleep(1)
            elapsed = time.time() - t_open
            check('C16 ACTIVE TIME: 13 s open with one click and a 5 s inactivity timeout counted ≈ 5–7 s, not 13 s', 3500 <= first <= 9500, (first, round(elapsed, 1)))
            for _ in range(4): p.page.mouse.click(300, 300); time.sleep(1.2)
            time.sleep(1.5); p.show(); time.sleep(4)
            p.page.mouse.click(400, 400); time.sleep(2.2); p.page.mouse.click(420, 420); time.sleep(0.4); p.hide(); time.sleep(1.5)
            second = 0; deadline = time.time() + 10
            while time.time() < deadline:
                second = svc.summary(today, today)['kpi']['totalActiveMs']
                if second > first + 500: break
                time.sleep(1)
            delta = second - first; total_elapsed = time.time() - t_open
            check('C17 ACTIVE TIME: the hidden minutes (4 clicks while hidden, 4 s visible without interaction) are excluded; only the ≈ 3 s of real use after returning were added', 1500 <= delta <= 5500, (delta, first, second))
            check('C18 ACTIVE TIME: total active time is a small part of the time the page was open', second < total_elapsed * 1000 * 0.75, (second, round(total_elapsed, 1)))
            p.close()

            # ═══════════════════════════ D · failure handling
            svc = Service(password='file'); p = Page(browser, config=cfg(svc.url, adminSessionTimeout=60)); p.open(); p.page.click('body', position={'x': 600, 'y': 400}); svc.stop(); time.sleep(0.5)
            generate_describe(p, 'show all vendors'); p.page.goto(f'{SITE}/#quickstart'); p.hide(); time.sleep(2.5); p.show()
            check('D1 SERVICE DOWN: SQL Assistant keeps working (the first SQL generation after the outage succeeded and the pages still render)', 'Welcome' in p.text() or 'Quick Start' in p.text())
            generate_describe(p, 'show all vendors'); check('D2 SERVICE DOWN: describing and generating SQL still works', p.page.locator('#nlResult [data-result-status]').count() == 1)
            queue = p.page.evaluate("() => localStorage.getItem('sqla.analytics.queue.v1773')"); check('D3 SERVICE DOWN: usage that could not be sent is kept (bounded, metadata only) for a later attempt', bool(queue) and 'ZZ' not in queue and 'SELECT' not in queue, (queue or '')[:120])
            p.nav_analytics(); p.page.wait_for_selector('#analyticsAuthModal'); p.page.fill('#anAuthPw', PW); p.page.click('#anAuthOk'); p.page.wait_for_function("() => document.querySelector('#anAuthMsg').innerText.trim().length > 0")
            check('D4 SERVICE DOWN: Analytics says the service cannot be reached and that SQL Assistant is not affected; no dashboard data', 'could not be reached' in p.page.inner_text('#anAuthMsg') and 'not affected' in p.page.inner_text('#anAuthMsg') and p.page.locator('.an-kpi').count() == 0, p.page.inner_text('#anAuthMsg'))
            check('D5 SERVICE DOWN: no uncaught page error (only the browser\'s own failed-network notices)', not p.errors and all(benign(m) for m in p.consoles), (p.errors, p.consoles[:3])); p.close()
            p = Page(browser, config=None, raw_config=json.dumps({'analytics': {'enabled': True, 'serviceUrl': svc.url, 'adminPassword': 'SYNTHETIC-do-not-do-this'}})); p.open(); p.nav_analytics(); p.page.wait_for_selector('#analyticsAuthModal')
            check('D6 INVALID CONFIGURATION (a password in the public file): analytics is off, the dialog explains why, the value is never echoed', 'not valid' in p.page.inner_text('#anAuthUnavailable') and 'SYNTHETIC-do-not' not in p.text() and p.page.locator('#anAuthPw').count() == 0, p.page.inner_text('#anAuthUnavailable')[:200])
            check('D7 INVALID CONFIGURATION: no analytics request was made and SQL Assistant works', not p.svc_requests(svc)); p.page.click('#anAuthCancel'); generate_describe(p, 'show all vendors'); check('D8 INVALID CONFIGURATION: SQL generation works', p.page.locator('#nlResult [data-result-status]').count() == 1); p.close()
            svc = Service(password='file'); p = Page(browser, config=cfg(svc.url, adminAuthenticationEnabled=False)); p.open(); p.nav_analytics(); p.page.wait_for_selector('#analyticsAuthModal')
            check('D9 adminAuthenticationEnabled=false: the dashboard is NOT available at all (never open without the password); the dialog says why', 'switched off' in p.page.inner_text('#anAuthUnavailable') and p.page.locator('#anAuthPw').count() == 0 and p.page.locator('#anAuthOk').is_disabled())
            p.page.click('body', position={'x': 600, 'y': 400}); p.hide(); time.sleep(2.0); today = time.strftime('%Y-%m-%d', time.gmtime()); sm = svc.summary(today, today)
            check('D10 adminAuthenticationEnabled=false: usage is still collected (the service received the session)', sm['kpi']['totalSessions'] >= 1, sm['kpi']); p.close()
            svc = Service(password=None); p = Page(browser, config=cfg(svc.url)); p.open(); p.nav_analytics(); p.page.wait_for_selector('#anAuthPw'); p.page.fill('#anAuthPw', 'anything-at-all-1'); p.page.click('#anAuthOk'); p.page.wait_for_function("() => document.querySelector('#anAuthMsg').innerText.trim().length > 0")
            check('D11 ADMIN NOT SET UP on the service: a clear message (no default password exists), no dashboard', 'not set up' in p.page.inner_text('#anAuthMsg') and p.page.locator('.an-kpi').count() == 0, p.page.inner_text('#anAuthMsg'))
            check('D12 the default word "admin" does not unlock anything', svc.login('admin') is None and svc.login('administrator1') is None); p.close()

            # ═══════════════════════════ E · password rotation
            svc = Service(password='file'); p = Page(browser, config=cfg(svc.url, adminSessionTimeout=120)); p.open(); p.unlock(); p.page.click('#anAdminPanel summary'); p.page.wait_for_selector('#anPwForm')
            p.page.fill('#anPwCur', PW); p.page.fill('#anPwNew', PW2); p.page.fill('#anPwNew2', 'different-entry-1234'); p.page.click('#anPwSave')
            check('E1 the two entries of the new password must match', 'differ' in p.page.inner_text('#anPwMsg'))
            p.page.fill('#anPwCur', 'wrong-current-pass-1'); p.page.fill('#anPwNew', PW2); p.page.fill('#anPwNew2', PW2); p.page.click('#anPwSave'); p.page.wait_for_function("() => document.querySelector('#anPwMsg').innerText.trim().length > 0"); time.sleep(0.3)
            check('E2 a wrong CURRENT password is refused (the service checks it again)', 'current password is not correct' in p.page.inner_text('#anPwMsg') and svc.login(PW2) is None)
            p.page.fill('#anPwCur', PW); p.page.fill('#anPwNew', 'short'); p.page.fill('#anPwNew2', 'short'); p.page.click('#anPwSave'); p.page.wait_for_function("() => /12 characters|too easy|at least/.test(document.querySelector('#anPwMsg').innerText)")
            check('E3 a weak new password is refused with the service\'s reason', 'at least 12' in p.page.inner_text('#anPwMsg'), p.page.inner_text('#anPwMsg'))
            check('E4 all password fields are cleared after every attempt', p.page.input_value('#anPwCur') == '' and p.page.input_value('#anPwNew') == '' and p.page.input_value('#anPwNew2') == '')
            p.page.fill('#anPwCur', PW); p.page.fill('#anPwNew', PW2); p.page.fill('#anPwNew2', PW2); p.page.click('#anPwSave'); p.page.wait_for_selector('[data-an-state="locked"]', timeout=10000)
            check('E5 a successful change ends the administrator session: Analytics is locked and says the password was changed', 'password was changed' in p.text() and p.page.locator('.an-kpi').count() == 0)
            check('E6 the OLD password no longer works; the NEW one does — with no restart and no rebuild', svc.login(PW) is None and svc.login(PW2) is not None)
            cred = open(os.path.join(svc.dir, 'admin-credential.json'), encoding='utf-8').read(); check('E7 only a salted scrypt hash of the new password is stored (never the password)', PW2 not in cred and PW not in cred and '"hash": "scrypt$' in cred and json.loads(cred)['version'] == 2)
            p.page.click('#anUnlockBtn'); p.page.wait_for_selector('#anAuthPw'); p.page.fill('#anAuthPw', PW2); p.page.click('#anAuthOk'); p.page.wait_for_selector('.an-kpis', timeout=10000); check('E8 the dashboard opens with the new password', True); p.close()
            svc = Service(password='env'); p = Page(browser, config=cfg(svc.url, adminSessionTimeout=120)); p.open(); p.unlock(); p.page.click('#anAdminPanel summary'); time.sleep(0.4)
            check('E9 a PLATFORM-MANAGED password (environment hash) is not changeable from the dashboard: the panel says where to change it, no form', 'managed' in p.page.inner_text('#anAdminBody') and p.page.locator('#anPwForm').count() == 0, p.page.inner_text('#anAdminBody')[:120]); p.close()

            # ═══════════════════════════ F · regression
            svc = Service(password='file'); p = Page(browser, config=cfg(svc.url)); p.open()
            bad = []
            for r in ['quickstart', 'readonly', 'cr', 'schema-used', 'error-rectifier', 'about', 'github', 'query-add', 'query-library', 'describe-readonly', 'describe-cr', 'settings', 'analytics']:
                p.page.goto(f'{SITE}/#{r}'); time.sleep(0.5); ok = p.page.locator('#mainContent .page').count() >= 1 and p.page.locator('#mainContent .issue-box:has-text("could not be displayed")').count() == 0
                if r == 'analytics': ok = ok and p.page.locator('[data-an-state="locked"]').count() == 1 and p.page.locator('#analyticsAuthModal').count() == 1; p.page.click('#anAuthCancel')
                if not ok: bad.append(r)
            check('F1 every route renders (the 12 existing ones and Analytics — which opens its dialog while locked)', not bad, bad)
            p.page.goto(f'{SITE}/#settings'); time.sleep(0.5); check('F2 Settings is still behind its lock screen (the Admin Password is unchanged and separate)', p.page.locator('#mainContent input[type=password]').count() >= 1 and 'Unlock' in p.text())
            foot = p.page.inner_text('.app-footer'); badge = p.page.inner_text('.brand-text .small'); check('F3 the version is shown in the footer and in the navbar', VERSION in foot and ('V' + VERSION) in badge, (foot, badge))
            p.page.goto(f'{SITE}/#about'); time.sleep(0.4); about = p.page.inner_text('#mainContent'); check('F4 About shows the version and the 17.7.3 entry with the release note', f'Version {VERSION}' in about and '17.7.3' in about and 'introduces optional Usage Analytics' in about and 'usage metadata only' in about)
            meta = p.page.evaluate("() => [document.querySelector('meta[name=generator]').content, document.title]"); check('F5 the page metadata carries the version', VERSION in meta[0], meta)
            p.page.goto(f'{SITE}/#readonly'); time.sleep(0.4); check('F6 the Read Only builder and its Manual Selectors load', p.page.locator('.manual-selectors-panel').count() >= 1)
            p.page.click('#navToggle'); p.page.click('button.hb-group-toggle[data-group="describe-group"]'); labels = [t.strip() for t in p.page.locator('.hamburger-panel-body a.hb-link').all_inner_texts()]; check('F7 the earlier hamburger structure is intact', 'Describe What You Need – Read Only Query Builder' in labels and 'Analytics' in labels and 'Settings' in labels, labels); p.page.click('#hamburgerCloseBtn')
            p.page.click('#themeBtn'); p.page.click('[data-theme-choice="dark"]'); p.nav_analytics(); p.page.wait_for_selector('#analyticsAuthModal'); p.page.fill('#anAuthPw', PW); p.page.click('#anAuthOk'); p.page.wait_for_selector('.an-kpis'); dark = p.page.evaluate("() => getComputedStyle(document.querySelector('.an-kpi')).backgroundColor"); light = '#ffffff'
            check('F8 the dashboard follows the dark theme', dark != 'rgb(255, 255, 255)', dark); os.makedirs(os.path.join(ROOT, 'test-results-v17.7.3'), exist_ok=True); p.page.screenshot(path=os.path.join(ROOT, 'test-results-v17.7.3/analytics-dashboard-dark.png'), full_page=True)
            for w in (390, 820):
                p.page.set_viewport_size({'width': w, 'height': 900}); time.sleep(0.4); ov = p.page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth"); check(f'F9 the dashboard has no horizontal page overflow at {w} px', ov <= 1, ov)
            p.page.set_viewport_size({'width': 1366, 'height': 900}); p.page.click('#themeBtn'); p.page.click('[data-theme-choice="light"]'); time.sleep(0.3); p.page.screenshot(path=os.path.join(ROOT, 'test-results-v17.7.3/analytics-dashboard-light.png'), full_page=True)
            check('F10 no uncaught page error in the regression pass', not p.errors, p.errors); p.close()
        finally:
            browser.close()

if __name__ == '__main__':
    code = 0
    try: main()
    except Exception as e:
        check('suite aborted by an exception', False, repr(e)); code = 1
    finally:
        for pr in procs:
            try:
                if pr.poll() is None: pr.terminate()
            except Exception: pass
        for d in tmpdirs: shutil.rmtree(d, ignore_errors=True)
    out = os.path.join(ROOT, 'test-results-v17.7.3'); os.makedirs(out, exist_ok=True)
    failed = [r for r in results if not r['pass']]
    json.dump({'version': VERSION, 'total': len(results), 'passed': len(results) - len(failed), 'failed': len(failed), 'results': results}, open(os.path.join(out, 'browser-results.json'), 'w'), indent=1)
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed', flush=True)
    sys.exit(1 if failed or code else 0)
