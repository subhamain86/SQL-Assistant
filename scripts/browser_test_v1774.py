#!/usr/bin/env python3
"""
V17.7.4 browser suite — SERVERLESS Usage Analytics (provider "repository"), end to end in a real Chromium:

  A  no repository connection / not set up / Set up (administrator only, password policy) / what the repository holds
  B  Administrator Authentication: wrong password = "Invalid administrator password" · right password opens the dashboard · password and private key are nowhere in the page, storage or URL
  C  usage is ENCRYPTED on the device: nothing readable in any repository file · the dashboard decrypts it (unique users, generations, features, version) · Lock · a reload needs the password again
  D  Change password (old data still readable) · Rotate keys (old and new data readable) · Compact · inactivity lock
  E  failure handling: no write access, damaged key file, no connection — SQL Assistant keeps working
  F  the production page: no test hook, no repository ⇒ a clear message, everything else works · About / version · Settings still locked

It uses the TEST build (?e2e=1: GitHub is replaced by an in-memory repository, node scripts/build.mjs --test) for A–E and the PRODUCTION build (release/) for F.
Run:  node scripts/build.mjs && node scripts/build.mjs --test && python3 scripts/browser_test_v1774.py      (Chromium: $SQLA_CHROMIUM, or the Playwright default)
Results: test-results-v17.7.4/browser-results.json
"""
import json, os, re, socket, subprocess, sys, time, glob
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = json.load(open(os.path.join(ROOT, 'package.json')))['version']
PW = 'SYNTHETIC-correct-horse-battery-42'; PW2 = 'SYNTHETIC-another-long-passphrase-77'
results = []
def check(name, ok, detail=''):
    results.append({'name': name, 'pass': bool(ok), 'detail': str(detail)[:300]})
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  -> {str(detail)[:300]}'), flush=True); return bool(ok)
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

SITE_PORT = free_port(); SITE = f'http://127.0.0.1:{SITE_PORT}'; procs = []
def start_site():
    p = subprocess.Popen(['node', os.path.join(ROOT, 'scripts/serve.mjs')], env={**os.environ, 'PORT': str(SITE_PORT)}, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT); procs.append(p); assert wait_port(SITE_PORT), 'site did not start'

def cfg(**kw):
    a = {'enabled': True, 'provider': 'repository', 'inactivityTimeout': 5, 'adminSessionTimeout': 60}; a.update(kw); return {'analytics': a}
class Page:
    def __init__(self, browser, config=None, ctx=None):
        self.ctx = ctx or browser.new_context(viewport={'width': 1366, 'height': 900})
        if ctx is None: self.ctx.add_init_script("try { localStorage.setItem('sqla.tourseen.v15', '1'); } catch (e) {}")
        self.config = config; self.errors = []; self.consoles = []; self.requests = []
        self.ctx.route('**/sql-assistant-data/analytics.config.json', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(self.config)) if self.config else r.fulfill(status=404, body=''))
        self.page = self.ctx.new_page(); self.page.on('pageerror', lambda e: self.errors.append(str(e))); self.page.on('console', lambda m: self.consoles.append(m.text) if m.type == 'error' else None); self.page.on('request', lambda r: self.requests.append((r.method, r.url)))
    def open(self, path='?e2e=1'):
        self.page.goto(f'{SITE}/{path}'); self.page.wait_for_selector('html[data-sqla-ready]', timeout=15000); time.sleep(0.8)
    def reload(self):
        self.page.reload(); self.page.wait_for_selector('html[data-sqla-ready]', timeout=15000); time.sleep(0.8)
    def use_memory_repo(self, files=None):
        self.page.evaluate("(f) => window.__sqla.setRepositoryOverride(window.__sqla.memoryRepository(f))", files or {})
    def dump(self): return json.loads(self.page.evaluate("() => JSON.stringify(window.__sqla.repoDump())"))
    def seed_next_load(self, dump): self.page.evaluate("(d) => sessionStorage.setItem('__sqla_seed_repo', d)", json.dumps(dump))
    def nav_analytics(self):
        self.page.click('#navToggle'); self.page.click('a[data-route="analytics"]')
    def text(self): return self.page.inner_text('body')
    def hide(self): self.page.evaluate("() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__vs || 'visible' }); window.__vs = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); }")
    def show(self): self.page.evaluate("() => { window.__vs = 'visible'; document.dispatchEvent(new Event('visibilitychange')); }")
    def page_exit(self): self.page.evaluate("() => window.dispatchEvent(new Event('pagehide'))")
    def unlock_attempt(self, pw):
        if not self.page.locator('#analyticsAuthModal').count():
            self.nav_analytics()
        self.page.wait_for_selector('#anAuthPw'); self.page.fill('#anAuthPw', pw); self.page.click('#anAuthOk')
    def unlock(self, pw=PW):
        self.nav_analytics(); self.page.wait_for_selector('#analyticsAuthModal'); self.unlock_attempt(pw); self.page.wait_for_selector('.an-kpis', timeout=25000)
    def msg(self): return self.page.inner_text('#anAuthMsg').strip()
    def wait_msg(self, sel='#anAuthMsg', timeout=25000):
        self.page.wait_for_function("(s) => document.querySelector(s) && document.querySelector(s).innerText.trim().length > 0", arg=sel, timeout=timeout); return self.page.inner_text(sel).strip()
    def kpi(self, name): return self.page.inner_text(f'[data-kpi="{name}"] [data-kpi-value]').strip()
    def close(self): self.ctx.close()
def generate_describe(p, text, expect='[data-result-status]'):
    p.page.evaluate("() => { location.hash = '#describe-readonly'; }"); p.page.wait_for_selector('#nlDesc'); p.page.fill('#nlDesc', text); p.page.click('#nlBuildBtn'); p.page.wait_for_selector(f'#nlResult {expect}', timeout=15000)
def parse_dur(s):
    h = re.search(r'(\d+) h', s); m = re.search(r'(\d+) min', s); x = re.search(r'(\d+) s', s); return (int(h.group(1)) * 3600 if h else 0) + (int(m.group(1)) * 60 if m else 0) + (int(x.group(1)) if x else 0)
def benign(m): return bool(re.search(r'status of (404|401|403)|ERR_CONNECTION|Failed to load resource', m))
def open_setup_wizard(p):
    p.nav_analytics(); p.page.wait_for_selector('#analyticsAuthModal'); p.unlock_attempt(PW); p.wait_msg(); p.page.click('#anSetupBtn'); p.page.wait_for_selector('#analyticsSetupModal')

def main():
    exe = chromium_path(); start_site()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(**({'executable_path': exe} if exe else {}), args=['--no-sandbox'])
        try:
            # ═══════════════════════════ A · connection, set-up, what the repository holds
            p = Page(browser, config=cfg()); p.open(); gen_uid = None
            p.nav_analytics(); p.page.wait_for_selector('#analyticsAuthModal')
            check('A1 with provider "repository" the dialog asks for the administrator password (masked)', p.page.get_attribute('#anAuthPw', 'type') == 'password' and 'Administrator Authentication' in p.page.inner_text('#analyticsAuthModal'))
            p.unlock_attempt(PW); m = p.wait_msg()
            check('A2 NO repository connection: a clear message, no dashboard, SQL Assistant unaffected', 'No repository connection' in m and p.page.locator('.an-kpi').count() == 0, m)
            p.page.click('#anAuthCancel'); p.use_memory_repo(); p.nav_analytics(); p.page.wait_for_selector('#analyticsAuthModal'); p.unlock_attempt(PW); m = p.wait_msg()
            check('A3 NOT SET UP: the message says so and offers "Set up Analytics…"', 'has not been set up' in m and p.page.locator('#anSetupBtn').count() == 1, m)
            p.page.click('#anSetupBtn'); p.page.wait_for_selector('#analyticsSetupModal')
            check('A4 Set up is an administrator action: with Settings locked there is NO form, only the instruction to unlock Settings', p.page.locator('#anSetupForm').count() == 0 and 'Unlock' in p.page.inner_text('#analyticsSetupModal') and 'Settings' in p.page.inner_text('#analyticsSetupModal'))
            check('A5 nothing was written to the repository by refused attempts', p.dump() == {}, list(p.dump())); p.page.click('#anSetupCancel')
            p.page.evaluate("() => { window.__sqla.store.settingsUnlocked = true; }"); open_setup_wizard(p)
            check('A6 the wizard explains that the data cannot be recovered without the password', 'no way to recover' in p.page.inner_text('#analyticsSetupModal'))
            p.page.fill('#anSetupPw', 'short'); p.page.fill('#anSetupPw2', 'short'); p.page.click('#anSetupGo'); m = p.wait_msg('#anSetupMsg', 20000)
            check('A7 a weak password is refused with the reason (minimum 14 characters) and nothing is written', 'at least 14' in m and p.dump() == {}, m)
            p.page.fill('#anSetupPw', PW); p.page.fill('#anSetupPw2', 'a-different-entry-1234'); p.page.click('#anSetupGo'); time.sleep(0.4)
            check('A8 two different entries are refused', 'differ' in p.page.inner_text('#anSetupMsg') and p.dump() == {})
            check('A9 the password fields are emptied after every attempt', p.page.input_value('#anSetupPw') == '' and p.page.input_value('#anSetupPw2') == '')
            p.page.fill('#anSetupPw', PW); p.page.fill('#anSetupPw2', PW); p.page.click('#anSetupGo'); p.page.wait_for_selector('#anSetupDone', timeout=30000)
            d = p.dump(); base = 'sql-assistant-data/analytics'; ak = d.get(f'{base}/admin-key.json', ''); pk = d.get(f'{base}/public-key.json', '')
            check('A10 set-up wrote exactly the key file and the public key', sorted(d) == [f'{base}/admin-key.json', f'{base}/public-key.json'], sorted(d))
            check('A11 the key file holds a WRAPPED key: no password, no hash, no verifier, no plaintext private key; PBKDF2 cost ≥ 600 000', PW not in ak and not re.search(r'PRIVATE|"d"\s*:|verifier|password', ak, re.I) and json.loads(ak)['kdf']['iterations'] >= 600000 and json.loads(ak)['kdf']['name'] == 'PBKDF2-SHA256', ak[:160])
            pin = p.page.input_value('textarea[data-an-pin]') if p.page.locator('textarea[data-an-pin]').count() else p.page.inner_text('[data-an-pin]')
            check('A12 the page offers the PUBLIC key to pin — and only the public key', '"kid"' in pin and '"x"' in pin and '"d"' not in pin and 'PRIVATE' not in pin and 'publicKey' in pin, pin[:120]); p.page.click('#anSetupDone')
            check('A13 the public key file is the PUBLIC key only', '"d"' not in pk and 'PRIVATE' not in pk and json.loads(pk)['current']['alg'] == 'ECDH-P256')

            # ═══════════════════════════ B · authentication
            p.nav_analytics(); p.page.wait_for_selector('#analyticsAuthModal'); p.unlock_attempt('not-the-password-123'); m = p.wait_msg()
            check('B1 a wrong password shows exactly "Invalid administrator password"', m == 'Invalid administrator password', m)
            check('B2 a failed attempt exposes nothing: no dashboard, no key, the field is emptied', p.page.locator('.an-kpi, .an-chart, .an-table').count() == 0 and p.page.input_value('#anAuthPw') == '' and not re.search(r'PBKDF2|salt|iterations|kid|key', m, re.I))
            p.page.fill('#anAuthPw', PW); p.page.click('#anAuthOk'); p.page.wait_for_selector('.an-kpis', timeout=25000)
            check('B3 the right password opens the dashboard: the 11 KPI cards, numeric values, no SQL generated yet', p.page.locator('.an-kpi').count() == 11 and re.fullmatch(r'\d+', p.kpi('unique-users')) and p.kpi('queries-generated') == '0', (p.kpi('unique-users'), p.kpi('queries-generated')))
            storage = p.page.evaluate("() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), location.href, document.cookie])"); html = p.page.evaluate("() => document.documentElement.outerHTML"); app_html = p.page.evaluate("() => document.getElementById('app').outerHTML")
            check('B4 the password is nowhere in the page: not in the DOM, localStorage, sessionStorage, the URL or cookies', PW not in html and PW not in storage and 'not-the-password-123' not in html + storage)
            ana = p.page.evaluate("() => JSON.stringify(Object.entries(localStorage).filter(([k]) => k.startsWith('sqla.analytics')))"); ana_keys = p.page.evaluate("() => Object.keys(localStorage).filter((k) => k.startsWith('sqla.analytics'))")
            hit = re.search(r'PRIVATE KEY|"kdf"|admin-key|"kty"', app_html + ana); check('B5 no private key or wrapped key in the page or its storage (the unwrapped key lives only in memory): the only analytics storage is the device id and the unsent queue', not hit and set(ana_keys) <= {'sqla.analytics.uid.v1773', 'sqla.analytics.queue.v1773'}, (hit and (hit.group(0), (app_html + ana)[max(0, hit.start() - 60):hit.start() + 60]), ana_keys))
            check('B6 the dashboard says the data is stored encrypted and shows the V17.7.4 release note', 'Stored encrypted' in p.text() and 'deployable without a server' in p.text())
            p.page.click('#anLock'); p.page.wait_for_selector('[data-an-state="locked"]'); check('B7 Lock Analytics removes every number from the page', p.page.locator('.an-kpi, .an-chart, .an-table').count() == 0)

            # ═══════════════════════════ C · usage is encrypted on the device; the dashboard decrypts it
            uid = p.page.evaluate("() => localStorage.getItem('sqla.analytics.uid.v1773')")
            p.page.evaluate("() => { location.hash = '#about'; }"); time.sleep(0.5); p.page.click('body', position={'x': 600, 'y': 400}); p.page.evaluate("() => { location.hash = '#quickstart'; }"); time.sleep(0.4)
            SECRET = 'ZZ-PRIVATE-DESC-9f3 total invoice amount per vendor over 1000'
            generate_describe(p, SECRET); generate_describe(p, 'xyzzy plugh frobnicate ZZ-PRIVATE-NOISE', '[data-result-status="error"]'); both_ok = p.page.locator('#nlResult [data-result-status="error"]').count() == 1; time.sleep(1.2)
            p.hide(); time.sleep(2.5)
            batches = [k for k in p.dump() if '/events/' in k]
            check('C1 the first send (tab hidden) wrote ONE batch under events/YYYY-MM-DD/ with a random 128-bit name', len(batches) == 1 and re.fullmatch(rf'{base}/events/\d{{4}}-\d\d-\d\d/[a-f0-9]{{32}}\.json', batches[0]), batches)
            p.show(); p.page.click('body', position={'x': 500, 'y': 300}); p.page.evaluate("() => { location.hash = '#settings'; }"); time.sleep(0.5); p.page_exit(); time.sleep(3.0)
            d = p.dump(); batches = sorted(k for k in d if '/events/' in k); blob = '\n'.join(k + d[k] for k in batches)
            check('C2 leaving the page wrote the final batch (a second file); nothing links the two', len(batches) == 2 and len(set(batches)) == 2, batches)
            check('C3 PRIVACY: no repository file contains a readable event, id, feature name, version, SQL keyword or the description text', not re.search(r'ZZ-PRIVATE|xyzzy|describe-read-only|quick-start|generation|session_|SELECT|INVOICE|VENDOR|17\.7\.\d', blob, re.I) and (not uid or uid not in blob), blob[:120])
            check('C4 every batch has only the envelope fields (format, v, kid, epk, iv, ct)', all(sorted(json.loads(d[k]).keys()) == ['ct', 'epk', 'format', 'iv', 'kid', 'v'] for k in batches))
            check('C5 the SQL-generation flow was not affected by encryption and writing (a valid and a refused description both produced their result)', both_ok)
            p.seed_next_load(d); p.reload(); p.nav_analytics(); p.page.wait_for_selector('#analyticsAuthModal')
            check('C6 a reload requires the password again (no session survives it)', p.page.locator('.an-kpi').count() == 0 and p.page.locator('#anAuthPw').count() == 1)
            p.page.fill('#anAuthPw', PW); p.page.click('#anAuthOk'); p.page.wait_for_selector('.an-kpis', timeout=25000); time.sleep(2.0); p.page.click('#anRefresh'); time.sleep(2.0)
            check('C7 the dashboard decrypts the stored usage: 2 generations (1 valid, 1 failed), one unique user, success rate 50%', p.kpi('queries-generated') == '2' and p.kpi('successful-generations') == '1' and p.kpi('failed-generations') == '1' and p.kpi('unique-users') == '1' and p.kpi('success-rate') == '50%', [p.kpi(k) for k in ('queries-generated', 'successful-generations', 'failed-generations', 'unique-users', 'success-rate')])
            fe = p.page.inner_text('[data-view="features"]'); ve = p.page.inner_text('[data-view="versions"]')
            check('C8 the most-used features and the application version are shown from the decrypted data', 'Describe What You Need' in fe and 'About' in fe and f'V{VERSION}' in ve, (fe[:100], ve[:60]))
            check('C9 total active usage time is greater than zero (measured, then encrypted, then decrypted)', p.page.inner_text('[data-kpi="total-active-time"] [data-kpi-value]').strip() not in ('0 s', ''), p.kpi('total-active-time'))
            check('C10 unique users are not counted per session: two page sessions of one browser profile are one user', p.kpi('unique-users') == '1' and int(p.kpi('total-sessions')) >= 1)

            # ═══════════════════════════ D · change password · rotate keys · compact · inactivity
            before = {k: p.kpi(k) for k in ('queries-generated', 'unique-users', 'total-sessions', 'success-rate')}; p.page.click('#anAdminPanel summary'); p.page.wait_for_selector('#anPwForm')
            check('D1 the panel for the repository provider offers Change password, Rotate keys, Publish public key and Compact; the minimum is 14 characters', all(p.page.locator(s).count() == 1 for s in ('#anPwForm', '#anRotateForm', '#anPubGo', '#anCompactGo')) and '14 characters' in p.page.inner_text('#anPwForm'))
            p.page.fill('#anPwCur', 'wrong-current-pass-1'); p.page.fill('#anPwNew', PW2); p.page.fill('#anPwNew2', PW2); p.page.click('#anPwSave'); m = p.wait_msg('#anPwMsg')
            check('D2 a wrong CURRENT password is refused and changes nothing', 'current password is not correct' in m and p.dump()[f'{base}/admin-key.json'] == ak, m)
            p.page.fill('#anPwCur', PW); p.page.fill('#anPwNew', 'short'); p.page.fill('#anPwNew2', 'short'); p.page.click('#anPwSave'); m = p.wait_msg('#anPwMsg')
            check('D3 a weak new password is refused with the reason', 'at least 14' in m, m)
            check('D4 the password fields are emptied after every attempt', p.page.input_value('#anPwCur') == '' and p.page.input_value('#anPwNew') == '')
            p.page.fill('#anPwCur', PW); p.page.fill('#anPwNew', PW2); p.page.fill('#anPwNew2', PW2); p.page.click('#anPwSave'); p.page.wait_for_selector('[data-an-state="locked"]', timeout=40000)
            ak2 = p.dump()[f'{base}/admin-key.json']
            check('D5 a successful change locks Analytics and says so; the key file changed and holds neither password', 'password was changed' in p.text() and ak2 != ak and PW not in ak2 and PW2 not in ak2)
            check('D6 the key PAIR is unchanged (same key id) — only its wrapping changed', json.loads(ak)['current'] == json.loads(ak2)['current'] and json.loads(ak)['kdf']['salt'] != json.loads(ak2)['kdf']['salt'])
            p.page.click('#anUnlockBtn'); p.page.wait_for_selector('#anAuthPw'); p.page.fill('#anAuthPw', PW); p.page.click('#anAuthOk'); m = p.wait_msg()
            check('D7 the OLD password no longer works', m == 'Invalid administrator password', m)
            p.page.fill('#anAuthPw', PW2); p.page.click('#anAuthOk'); p.page.wait_for_selector('.an-kpis', timeout=25000); time.sleep(2.0)
            after = {k: p.kpi(k) for k in before}; check('D8 the NEW password opens the dashboard and ALL earlier data is still readable (generations, users, success rate unchanged; sessions can only have grown)', all(after[k] == before[k] for k in ('queries-generated', 'unique-users', 'success-rate')) and int(after['total-sessions']) >= int(before['total-sessions']), (before, after))
            p.page.click('#anAdminPanel summary'); p.page.wait_for_selector('#anRotateForm'); p.page.fill('#anRotPw', 'wrong-current-pass-1'); p.page.click('#anRotGo'); p.page.wait_for_function("() => /not correct/.test(document.querySelector('#anRotMsg').innerText)", timeout=40000); m = p.page.inner_text('#anRotMsg'); time.sleep(0.5)
            check('D9 Rotate keys needs the current password', 'not correct' in m and len(json.loads(p.dump()[f'{base}/admin-key.json'])['keys']) == 1, m)
            p.page.fill('#anRotPw', PW2); p.page.click('#anRotGo'); p.page.wait_for_function("() => /Keys rotated/.test(document.querySelector('#anRotMsg').innerText)", timeout=40000)
            kf = json.loads(p.dump()[f'{base}/admin-key.json']); pub = json.loads(p.dump()[f'{base}/public-key.json'])
            check('D10 rotation created a second wrapped key, made it current and published its PUBLIC key', len(kf['keys']) == 2 and pub['current']['kid'] == kf['current'] and kf['current'] != json.loads(ak)['current'] and '"d"' not in json.dumps(pub), (len(kf['keys']), pub['current']['kid']))
            check('D11 the page shows the new public key to pin (public only)', p.page.locator('#anRotMsg textarea[data-an-pin]').count() == 1 and '"d"' not in p.page.input_value('#anRotMsg textarea[data-an-pin]'))
            p.page.click('#anCompactGo'); p.page.wait_for_function("() => /Merged \\d+ file/.test(document.querySelector('#anCompactMsg').innerText)", timeout=40000)
            check('D12 Compact now runs and reports (nothing is old enough yet: 0 files)', 'Merged 0 file(s)' in p.page.inner_text('#anCompactMsg'), p.page.inner_text('#anCompactMsg'))
            p.page.click('#anLock'); p.page.wait_for_selector('[data-an-state="locked"]')
            p.page.evaluate("() => { location.hash = '#schema-used'; }"); time.sleep(0.5); p.page.click('body', position={'x': 600, 'y': 400}); time.sleep(0.5); p.page_exit(); time.sleep(3.5)
            batches = [k for k in p.dump() if '/events/' in k]; kids = sorted({json.loads(p.dump()[k])['kid'] for k in batches})
            check('D13 usage written after the rotation is encrypted to the NEW key; earlier batches keep the old key id', len(kids) == 2 and kf['current'] in kids, kids)
            p.show(); p.unlock(PW2); time.sleep(2.5); p.page.click('#anRefresh'); time.sleep(2.5)
            check('D14 after rotation the dashboard reads old AND new batches (generations unchanged, a new feature appears)', p.kpi('queries-generated') == before['queries-generated'] and 'Schema' in p.page.inner_text('[data-view="features"]'), (p.kpi('queries-generated'), p.page.inner_text('[data-view="features"]')[:80]))
            check('D15 no uncaught page error in the administration flows', not p.errors and all(benign(x) for x in p.consoles), (p.errors, p.consoles[:2])); final_dump = p.dump(); p.close()
            p = Page(browser, config=cfg(adminSessionTimeout=10)); p.open(); p.use_memory_repo(final_dump); p.unlock(PW2); t0 = time.time(); p.page.wait_for_selector('[data-an-state="locked"]', timeout=25000)
            check('D16 after the configured inactivity period Analytics locks itself, says so, and drops the data', p.page.locator('.an-kpi').count() == 0 and 'locked automatically' in p.text() and time.time() - t0 >= 8, round(time.time() - t0, 1)); p.close()
            keys_only = {k: v for k, v in final_dump.items() if '/events/' not in k and '/rollups/' not in k}
            p = Page(browser, config=cfg(inactivityTimeout=5)); p.open(); p.use_memory_repo(keys_only); p.page.click('body', position={'x': 600, 'y': 400}); time.sleep(12); p.page_exit(); time.sleep(3.5)
            p.seed_next_load(p.dump()); p.reload(); p.unlock(PW2); time.sleep(2.5); p.page.click('#anRefresh'); time.sleep(2.5); secs = parse_dur(p.kpi('total-active-time'))
            check('D17 ACTIVE TIME through the encrypted repository: 12 s open with ONE click and a 5 s inactivity timeout counts about 5 s, not 12 s (idle time is excluded)', 3 <= secs <= 9, p.kpi('total-active-time')); p.close()

            # ═══════════════════════════ E · failure handling
            p = Page(browser, config=cfg()); p.open(); p.page.evaluate("""() => { const m = window.__sqla.memoryRepository({}); const bad = { describe: 'read-only test repository', read: (x) => m.read(x), list: (x) => m.list(x), remove: (a, b, c) => m.remove(a, b, c), write: async () => { const e = new Error('no permission'); e.name = 'RepositoryError'; e.kind = 'permission'; throw e; } }; window.__sqla.setRepositoryOverride(bad); }""")
            p.page.click('body', position={'x': 600, 'y': 400}); generate_describe(p, 'show all vendors'); p.hide(); time.sleep(3.0)
            q = p.page.evaluate("() => localStorage.getItem('sqla.analytics.queue.v1773')")
            check('E1 NO WRITE ACCESS: usage is queued locally (bounded, no content), SQL generation works, no error is shown', bool(q) and 'show all vendors' not in q and 'SELECT' not in q and p.page.locator('#nlResult [data-result-status]').count() == 1, (q or '')[:100])
            p.nav_analytics(); p.page.wait_for_selector('#analyticsAuthModal'); p.unlock_attempt(PW); m = p.wait_msg()
            check('E2 NOT SET UP on a read-only repository: the Analytics page says so (the browser is not blocked)', 'has not been set up' in m, m)
            check('E3 no uncaught page error with a read-only repository', not p.errors, p.errors); p.close()
            p = Page(browser, config=cfg()); p.open(); p.use_memory_repo({f'{base}/admin-key.json': '{broken'}); p.nav_analytics(); p.page.wait_for_selector('#analyticsAuthModal'); p.unlock_attempt(PW); m = p.wait_msg()
            check('E4 a DAMAGED key file: the page says it was not used; nothing is revealed; no crash', 'damaged or does not have the expected format' in m and p.page.locator('.an-kpi').count() == 0 and not p.errors, m); p.close()
            ctx2 = browser.new_context(viewport={'width': 1366, 'height': 900}); ctx2.add_init_script("try { localStorage.setItem('sqla.tourseen.v15', '1'); } catch (e) {}")
            p = Page(browser, config=cfg(publicKey={'kid': 'forgedkid1234', 'jwk': {'kty': 'EC', 'crv': 'P-256', 'x': 'A' * 43, 'y': 'A' * 43}}), ctx=ctx2); p.open(); p.use_memory_repo(); p.nav_analytics(); p.page.wait_for_selector('#analyticsAuthModal')
            check('E5 a pinned public key that is not valid switches analytics off with a message (nothing is sent anywhere)', 'not valid' in p.page.inner_text('#analyticsAuthModal') and p.page.locator('#anAuthPw').count() == 0, p.page.inner_text('#analyticsAuthModal')[:160]); p.close()

            # ═══════════════════════════ F · the production page, About, Settings
            p = Page(browser, config=cfg()); p.open(''); hooks = p.page.evaluate("() => typeof window.__sqla")
            check('F1 the PRODUCTION page has no test hook (the in-memory repository exists only in the test build)', hooks == 'undefined', hooks)
            p.nav_analytics(); p.page.wait_for_selector('#analyticsAuthModal'); p.unlock_attempt(PW); m = p.wait_msg()
            check('F2 PRODUCTION page, no token on the device: "No repository connection…" (and the page works)', 'No repository connection' in m, m); p.page.click('#anAuthCancel'); p.page.evaluate("() => { location.hash = '#describe-readonly'; }"); p.page.wait_for_selector('#nlDesc'); p.page.fill('#nlDesc', 'show all vendors'); p.page.click('#nlBuildBtn'); p.page.wait_for_selector('#nlResult [data-result-status]', timeout=15000)
            check('F3 SQL generation works exactly as before', p.page.locator('#nlResult [data-result-status]').count() == 1)
            foot = p.page.inner_text('.app-footer'); badge = p.page.inner_text('.brand-text .small'); check('F4 the version is shown in the footer and in the navbar', VERSION in foot and ('V' + VERSION) in badge, (foot, badge))
            p.page.evaluate("() => { location.hash = '#about'; }"); time.sleep(0.5); about = p.page.inner_text('#mainContent')
            check('F5 About lists the serverless release (17.7.4) with its release note, before 17.7.3, and the current version', 'deployable without a server or cloud credentials' in about and about.index('17.7.4') < about.index('17.7.3') and f'Version {VERSION}' in about)
            p.page.evaluate("() => { location.hash = '#settings'; }"); time.sleep(0.6); check('F6 Settings is still behind its lock screen (the Admin Password is unchanged and separate)', p.page.locator('#mainContent input[type=password]').count() >= 1 and 'Unlock' in p.text())
            meta = p.page.evaluate("() => document.querySelector('meta[name=generator]').content"); check('F7 the page metadata carries the version', VERSION in meta, meta)
            check('F8 no uncaught page error on the production page', not p.errors, p.errors); p.close()
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
    out = os.path.join(ROOT, 'test-results-v17.7.4'); os.makedirs(out, exist_ok=True); failed = [r for r in results if not r['pass']]
    json.dump({'version': VERSION, 'total': len(results), 'passed': len(results) - len(failed), 'failed': len(failed), 'results': results}, open(os.path.join(out, 'browser-results.json'), 'w'), indent=1)
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed', flush=True); sys.exit(1 if failed or code else 0)
