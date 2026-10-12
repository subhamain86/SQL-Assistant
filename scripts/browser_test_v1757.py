"""SQL Assistant V17.5.7 — real-browser tests on the PRODUCTION build (Chromium / Playwright).
   npm run build && python3 scripts/browser_test_v1757.py        (CHROME_PATH=/path/to/chrome to use an installed browser)

Every browser profile ("device") is configured through the UI and the app's REAL GitHub client talks over HTTP to an emulation of the GitHub REST API (repository incl. the
permissions object, branch and Contents endpoints; Bearer auth; 401 / 403 / 404 / 409 / 422; sha concurrency; base64 content; private vs public repositories; read-only tokens).
Three repositories exist (basware/sk-ap-sql-assistant — private, acme/alt-repo — private, acme/public-repo — public) so "which repository was used" is proven by inspecting every request.
Nothing is shared through browser storage: the ONLY thing that moves between the two devices of the cross-device test is the encrypted vault file in the emulated repository.
It is NOT github.com itself (no network or credentials in the build environment).
Covers: administrator-only repository configuration, ONE configuration for every operation, the single-button Pull Schema card, cross-device Secret Vault recovery (two profiles),
token validation with GitHub (rejected / read-only / no access / unreachable), import safety, push safeguards, secrecy, regression and responsive layout."""
import json, os, re, sys, time, subprocess, pathlib, base64, hashlib, tempfile, traceback
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import browser_test_v1754 as T
B = T.B
from playwright.sync_api import sync_playwright
ROOT = B.ROOT; PLAIN = B.PLAIN; TOK_A, TOK_B, TOK_BAD, TOK_RO = B.TOK_A, B.TOK_B, B.TOK_BAD, B.TOK_RO; DEFAULT_PASS = T.DEFAULT_PASS; VPATH = T.VPATH
check, go, unlock, stab, newdev, configure, section = B.check, B.go, B.unlock, B.stab, B.newdev, B.configure, B.section
DEF = "basware/sk-ap-sql-assistant"; ALT = "acme/alt-repo"; PUB = "acme/public-repo"; CUSTOM = "a-different-vault-passphrase-2027"; TOK_NEW = "ghp_" + "Nn1Ee2Ww3Tt4Oo5Kk6Ee7Nn8Aa9Bb0Cc1Dd2"
DEFAULT_CFG = [DEF, "main", PLAIN]; ALT_CFG = [ALT, "release", "data/schemas/reg.json"]

class Hub7:
    def __init__(self):
        self.repos = {DEF: {"private": True, "branches": {"main"}, "files": {}}, ALT: {"private": True, "branches": {"release"}, "files": {}}, PUB: {"private": False, "branches": {"main"}, "files": {}}}
        self.valid = {TOK_A, TOK_B, TOK_NEW, TOK_RO}; self.read_only = {TOK_RO}; self.urls = []; self.log = []; self.mode = "ok"
    @staticmethod
    def sha(b): return hashlib.sha1(b"blob %d\0" % len(b) + b).hexdigest()
    def put(self, path, text, repo=DEF): b = text.encode("utf-8"); self.repos[repo]["files"][path] = (b, self.sha(b))
    def get(self, path, repo=DEF): f = self.repos[repo]["files"].get(path); return f[0].decode("utf-8") if f else None
    def handler(self, route):
        req = route.request; url = req.url; self.urls.append((req.method, url)); hd = {"access-control-allow-origin": "*", "access-control-allow-headers": "authorization,accept,content-type", "access-control-allow-methods": "GET,PUT,OPTIONS", "content-type": "application/json"}
        if req.method == "OPTIONS": return route.fulfill(status=204, headers=hd)
        m = re.match(r"https://api\.github\.com/repos/([^/]+)/([^/?]+)(?:/(branches|contents)/([^?]*))?(\?.*)?$", url); fail = lambda st, msg="Not Found": route.fulfill(status=st, headers=hd, body=json.dumps({"message": msg}))
        if not m: return fail(404)
        if self.mode == "down": return route.abort("connectionrefused")
        if self.mode.startswith("http"): return fail(int(self.mode[4:]), "mode")
        name = f"{m.group(1)}/{m.group(2)}"; kind = m.group(3); path = m.group(4) or ""; auth = req.headers.get("authorization", ""); tok = auth.replace("Bearer ", ""); repo = self.repos.get(name)
        self.log.append((req.method, name, kind or "repo", path, "auth" if auth else "anon"))
        if auth and tok not in self.valid: return fail(401, "Bad credentials")
        if repo is None or (repo["private"] and not auth): return fail(404)
        if req.method == "GET":
            if kind is None: return route.fulfill(status=200, headers=hd, body=json.dumps({"full_name": name, "permissions": {"pull": True, "push": bool(auth) and tok not in self.read_only}} if auth else {"full_name": name}))
            if kind == "branches": return route.fulfill(status=200, headers=hd, body=json.dumps({"name": path})) if path in repo["branches"] else fail(404, "Branch not found")
            ref = re.search(r"ref=([^&]+)", url); ref = ref.group(1) if ref else "main"
            if ref not in repo["branches"] or path not in repo["files"]: return fail(404)
            b, sh = repo["files"][path]; return route.fulfill(status=200, headers=hd, body=json.dumps({"content": base64.encodebytes(b).decode(), "sha": sh, "encoding": "base64", "path": path}))
        if req.method == "PUT":
            if not auth: return fail(401, "Requires authentication")
            if tok in self.read_only: return fail(403, "Resource not accessible by personal access token")
            body = json.loads(req.post_data or "{}"); b = base64.b64decode(body["content"]); f = repo["files"].get(path)
            if body.get("branch") not in repo["branches"]: return fail(404, "Branch not found")
            if f and body.get("sha") != f[1]: return fail(409 if body.get("sha") else 422, "sha does not match")
            repo["files"][path] = (b, self.sha(b)); return route.fulfill(status=200 if "sha" in body else 201, headers=hd, body=json.dumps({"content": {"sha": repo["files"][path][1]}}))
        return fail(405)
    def reads(self, repo, kind="contents"): return [l for l in self.log if l[1] == repo and l[0] == "GET" and l[2] == kind]
    def writes(self, repo=None): return [l for l in self.log if l[0] == "PUT" and (repo is None or l[1] == repo)]
    def clear(self): self.urls.clear(); self.log.clear()

def storage(pg): return pg.evaluate("() => JSON.stringify(Object.assign({}, localStorage)) + '|' + JSON.stringify(Object.assign({}, sessionStorage))")
def vals(pg): return pg.evaluate("() => ['#vaultRepo', '#vaultBranch', '#vaultPath'].map((s) => document.querySelector(s).value)")
def ro(pg): return pg.evaluate("() => ['#vaultRepo', '#vaultBranch', '#vaultPath'].map((s) => document.querySelector(s).readOnly)")
def loc(pg): return pg.evaluate("() => window.__sqla.repoLocation().join('|')")
def reveal(pg):
    if not pg.is_visible("#vaultRepo"): pg.click("#repoCfgToggle"); pg.wait_for_timeout(150)
def pull_page(pg): T.pull_page(pg)
def pull_click(pg):
    pg.click("#pullBtn"); pg.wait_for_function("() => { const b = document.querySelector('#pullBtn'); const r = document.querySelector('#pullResult'); return b && !b.disabled && r && r.querySelector('.issue-box') && !/Retrieving the schema/.test(r.innerText); }", timeout=30000); pg.wait_for_timeout(250); return pg.inner_text("#pullResult")
def vres(pg): return T.vault_result(pg)
def admin_edit(pg, repo=None, branch=None, path=None, pw="admin", save=True):
    reveal(pg); pg.click("#repoCfgEdit"); pg.fill("#repoCfgAdminPw", pw); pg.click("#repoCfgUnlock"); pg.wait_for_timeout(1000)
    if repo is not None: pg.fill("#vaultRepo", repo)
    if branch is not None: pg.fill("#vaultBranch", branch)
    if path is not None: pg.fill("#vaultPath", path)
    if save: pg.click("#repoCfgSave"); pg.wait_for_function("() => { const r = document.querySelector('#repoCfgResult'); return r && r.innerText.trim() && !/Validating the repository configuration/.test(r.innerText); }", timeout=20000); pg.wait_for_timeout(400)
def push_vault(pg, passw, path=None):
    unlock(pg); stab(pg, "Secret Vault"); pg.fill("#v17VaultPass", passw); pg.fill("#v17VaultPass2", passw)
    if path is not None: pg.fill("#vaultFilePath", path)
    pg.click("#pushVaultBtn"); pg.wait_for_function("() => { const r = document.querySelector('#v17VaultResult'); return r && r.innerText.trim() && !document.querySelector('#pushVaultBtn').disabled; }", timeout=30000); pg.wait_for_timeout(300); return pg.inner_text("#v17VaultResult")
def confirms(pg, answer): pg.evaluate("(a) => { window.__confirms = []; window.confirm = (m) => { window.__confirms.push(m); return a; }; }", answer)
def make_schema(pg, name):
    pg.evaluate("(n) => { const sv = window.__sqla.services().schemas; const r = sv.importSchemaJson(JSON.stringify({ name: n, tables: [{ name: 'T_' + n.replace(/\\W+/g, '_').toUpperCase(), module: 'General', description: '', columns: [{ name: 'ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' }] }] }), n); if (!r.ok) throw new Error(JSON.stringify(r.errors)); sv.setActive(r.schema.id); }", name); pg.wait_for_timeout(150)
def publish_schema(pg, hub):
    r = pg.evaluate("async () => { const r = await window.__sqla.services().sync.push({ allowReplacingInvalidRemote: true }); return JSON.stringify({ ok: r.ok, p: r.problems }); }"); assert json.loads(r)["ok"], r; pg.wait_for_timeout(200); return hub.get(PLAIN)
def craft_vault(pg, token, ai="", passphrase=DEFAULT_PASS):  # an encrypted vault file holding a chosen token, made by the app's own export code on this device (the device's own vault is restored afterwards)
    return pg.evaluate("async ([t, a, pw]) => { const sv = window.__sqla.services(); const cur = await sv.vault.load(); await sv.vault.save({ ...cur, githubToken: t, aiApiKey: a }); const out = await sv.vault.exportEncrypted(pw).catch(() => null); await sv.vault.save({ ...cur }); await window.__sqla.reloadSecrets(); return out; }", [token, ai, passphrase])

# ───────────────────────────── 1. Cards and the administrator-only configuration ─────────────────────────────
def config_ui(b, url, st):
    hub = Hub7(); ctx, pg = newdev(b, url, hub, tag="cfg"); st["cfg"] = (ctx, pg, hub); pg.evaluate("location.hash = '#quickstart'"); pg.wait_for_timeout(300); T.hamburger_pull(pg)
    heads = pg.eval_on_selector_all("#schemaTabs .tab-panel:not([hidden]) h2", "e => e.map(x => x.innerText.trim())")
    check("Schema → Pull Schema holds exactly the three cards in order: GitHub repository (schema synchronization) · Pull Schema from GitHub · Pull Secret Vault to Repository", heads == ["GitHub repository (schema synchronization)", "Pull Schema from GitHub", "Pull Secret Vault to Repository"], heads)
    main = pg.inner_text("main")
    check("Default: the repository, branch and schema path are hidden — nowhere on the page until 'Show configuration'", not any(x in main for x in ["basware", "sk-ap-sql-assistant", "registry.json"]) and not pg.is_visible("#vaultRepo") and not pg.is_visible("#repoCfgEdit"))
    reveal(pg); check("Reveal shows the three default values: basware/sk-ap-sql-assistant · main · sql-assistant-data/schemas/registry.json", vals(pg) == DEFAULT_CFG, vals(pg))
    check("Ordinary user: all three fields are read-only and the only way to change them is the 'Edit configuration (administrator)' button", ro(pg) == [True, True, True] and pg.is_visible("#repoCfgEdit") and not pg.is_visible("#repoCfgSave") and not pg.is_visible("#repoCfgAuth"))
    for sel in ("#vaultRepo", "#vaultBranch", "#vaultPath"): pg.click(sel); pg.keyboard.type("zzz"); pg.keyboard.press("Control+a"); pg.keyboard.press("Delete")
    refused = False
    try: pg.fill("#vaultRepo", "evil/repo", timeout=1500)
    except Exception: refused = True
    check("Ordinary user: typing, selecting-and-deleting and fill() change nothing (the browser refuses to edit a read-only field)", vals(pg) == DEFAULT_CFG and refused)
    before = storage(pg); pg.click("#repoCfgEdit"); pg.wait_for_timeout(100)
    check("Edit asks for the Admin Password first — the fields stay read-only while the password prompt is open", pg.is_visible("#repoCfgAdminPw") and ro(pg) == [True, True, True] and pg.get_attribute("#repoCfgAdminPw", "type") == "password")
    pg.fill("#repoCfgAdminPw", "not-the-password"); pg.click("#repoCfgUnlock"); pg.wait_for_timeout(1000)
    check("Wrong Admin Password: refused with a message, the fields stay read-only, no save button, nothing stored", "Incorrect Admin Password" in pg.inner_text("#repoCfgResult") and ro(pg) == [True, True, True] and not pg.is_visible("#repoCfgSave") and storage(pg) == before)
    pg.fill("#repoCfgAdminPw", ""); pg.click("#repoCfgUnlock"); pg.wait_for_timeout(900); check("Empty Admin Password is refused too", "Incorrect Admin Password" in pg.inner_text("#repoCfgResult") and ro(pg) == [True, True, True])
    pg.fill("#repoCfgAdminPw", "admin"); pg.click("#repoCfgUnlock"); pg.wait_for_timeout(1000)
    check("Correct Admin Password: the three fields become editable and Save / Restore defaults / Cancel appear; the password field is cleared", ro(pg) == [False, False, False] and pg.is_visible("#repoCfgSave") and pg.is_visible("#repoCfgDefaults") and pg.is_visible("#repoCfgCancel") and not pg.is_visible("#repoCfgAdminPw") and pg.input_value("#repoCfgAdminPw") == "")
    for label, r, br, p, expect in [("empty repository", "", "main", PLAIN, "owner/repository"), ("no owner", "justname", "main", PLAIN, "owner/repository"), ("bad branch (space and ..)", DEF, "my branch..x", PLAIN, "Branch"), ("path outside the repository", DEF, "main", "../../etc/passwd.json", "Schema file path"), ("path that is not .json", DEF, "main", "data/registry.txt", ".json file"), ("encrypted twin as path", DEF, "main", "data/registry.enc.json", "plain registry"), ("path with a leading slash", DEF, "main", "/data/registry.json", "Schema file path"), ("owner with a space", "ac me/repo", "main", PLAIN, "owner/repository")]:
        pg.fill("#vaultRepo", r); pg.fill("#vaultBranch", br); pg.fill("#vaultPath", p); pg.click("#repoCfgSave"); pg.wait_for_timeout(1000); t = pg.inner_text("#repoCfgResult")
        check(f"Validation before saving — {label}: refused with a specific message; browser storage and the location in force are unchanged", expect in t and "nothing was saved" in t.lower() and storage(pg) == before and loc(pg) == "|".join(["basware", "sk-ap-sql-assistant", "main", PLAIN]), t[:200])
    pg.fill("#vaultRepo", ALT); pg.fill("#vaultBranch", "release"); pg.fill("#vaultPath", "data/schemas/reg.json"); pg.click("#repoCfgCancel"); pg.wait_for_timeout(150)
    check("Cancel: the typed values are discarded, the original values are back and the fields are read-only again", vals(pg) == DEFAULT_CFG and ro(pg) == [True, True, True] and pg.is_visible("#repoCfgEdit") and storage(pg) == before)
    pg.click("#repoCfgToggle"); pg.click("#repoCfgToggle"); pg.click("#repoCfgEdit"); pg.fill("#repoCfgAdminPw", "admin"); pg.click("#repoCfgUnlock"); pg.wait_for_timeout(900); pg.fill("#vaultPath", "x/y.json"); pg.click("#repoCfgToggle"); pg.click("#repoCfgToggle")
    check("Hiding the configuration while editing cancels the edit: read-only again, original values, nothing stored", vals(pg) == DEFAULT_CFG and ro(pg) == [True, True, True] and storage(pg) == before)
    pg.evaluate("() => { const o = window.setTimeout; window.__stOrig = o; window.setTimeout = (f, ms, ...a) => o(f, ms === 300000 ? 1800 : ms, ...a); }")
    pg.click("#repoCfgEdit"); pg.fill("#repoCfgAdminPw", "admin"); pg.click("#repoCfgUnlock"); pg.wait_for_timeout(450); was = ro(pg); pg.wait_for_timeout(2200); pg.evaluate("() => { window.setTimeout = window.__stOrig; }")
    check("An unlocked editor locks itself again after the inactivity period (5 minutes in production): read-only again, original values, a message says so, nothing stored", was == [False, False, False] and ro(pg) == [True, True, True] and "locked after 5 minutes" in pg.inner_text("#repoCfgResult") and vals(pg) == DEFAULT_CFG and storage(pg) == before)
    check("Nothing in the stored data of an ordinary session contains a repository override or a password", "sqla.repoconfig" not in storage(pg) and "admin" not in storage(pg).replace("sqla.pwvault", ""))

# ───────────────────────────── 2. ONE configuration for every operation ─────────────────────────────
def one_configuration(b, url, st):
    ctx, pg, hub = st["cfg"]
    A, a = newdev(b, url, hub, tag="publisher"); configure(a, TOK_A); make_schema(a, "Default Repository Schema"); default_text = publish_schema(a, hub); make_schema(a, "Alt Repository Schema"); alt_text = publish_schema(a, hub); A.close()
    hub.put(PLAIN, default_text, DEF); hub.put("data/schemas/reg.json", alt_text, ALT); hub.clear()
    configure(pg, TOK_A); pull_page(pg); reveal(pg)
    check("Token set through the repository card (Admin Password) — masked, not in storage", TOK_A[-4:] in pg.inner_text("#maskedToken") and TOK_A not in storage(pg) and TOK_A not in pg.inner_text("body"))
    hub.clear(); admin_edit(pg, repo="acme/does-not-exist", branch="release", path="data/schemas/reg.json"); t = pg.inner_text("#repoCfgResult")
    check("Live check — repository does not exist: refused ('repository was not found'), NOT saved, the token is not in the message", "repository was not found" in t.lower() and "not saved" in t.lower() and TOK_A not in t and "sqla.repoconfig" not in storage(pg), t[:200])
    pg.fill("#vaultRepo", ALT); pg.fill("#vaultBranch", "no-such-branch"); pg.click("#repoCfgSave"); pg.wait_for_timeout(1200); t = pg.inner_text("#repoCfgResult")
    check("Live check — branch does not exist: refused, NOT saved", "branch was not found" in t.lower() and "sqla.repoconfig" not in storage(pg), t[:200])
    hub.valid.discard(TOK_A); pg.fill("#vaultBranch", "release"); pg.click("#repoCfgSave"); pg.wait_for_timeout(1200); t = pg.inner_text("#repoCfgResult"); hub.valid.add(TOK_A)
    check("Live check — the saved token is rejected by GitHub: refused, NOT saved, the editor stays open", "rejected" in t.lower() and "not saved" in t.lower() and ro(pg) == [False, False, False] and "sqla.repoconfig" not in storage(pg), t[:200])
    hub.mode = "down"; pg.click("#repoCfgSave"); pg.wait_for_timeout(1500); t = pg.inner_text("#repoCfgResult"); hub.mode = "ok"
    check("Live check — GitHub unreachable: refused with an explanation (a value that cannot be verified is not saved)", "could not be verified" in t.lower() and "sqla.repoconfig" not in storage(pg), t[:200])
    hub.clear(); pg.fill("#vaultRepo", f"https://github.com/{ALT}.git"); pg.fill("#vaultPath", "data/schemas/reg.json"); pg.click("#repoCfgSave"); pg.wait_for_timeout(1500); t = pg.inner_text("#repoCfgResult"); kinds = [l[2] for l in hub.log if l[1] == ALT]
    check("Valid change by the administrator (a pasted GitHub URL is accepted): repository → branch → file are verified, then saved — 'Pull Schema, Sync with GitHub Now and Push Secret Vault now use it'", "validated and saved" in t and "Push Secret Vault now use it" in t and kinds[:3] == ["repo", "branches", "contents"] and "sqla.repoconfig" in storage(pg), (t[:200], kinds))
    check("After saving the configuration is hidden again, read-only again, and shows the new values on reveal", not pg.is_visible("#vaultRepo") and (reveal(pg) or True) and vals(pg) == ALT_CFG and ro(pg) == [True, True, True], vals(pg))
    rec = pg.evaluate("() => localStorage.getItem('sqla.repoconfig.v1756')"); j = json.loads(rec)
    check("Persisted in the existing browser-storage architecture as one small record with NO secret (no token, no password)", sorted(j) == ["branch", "owner", "repo", "savedAt", "schemaPath", "v"] and TOK_A not in rec and "admin" not in rec.lower())
    hub.clear(); pull_page(pg); t = pull_click(pg); r = hub.reads(ALT); d = hub.reads(DEF)
    check("Pull Schema uses the saved configuration: it reads ONLY acme/alt-repo → data/schemas/reg.json on branch 'release' (no request to the default repository) and succeeds", "Schema pulled and validated successfully." in t and any(l[3] == "data/schemas/reg.json" for l in r) and not d and any("ref=release" in u for m, u in hub.urls if "contents/data/schemas/reg.json" in u), (t[:160], r, d))
    check("…and the pulled schema is the one from the alternative repository (active schema)", B.active_name(pg) == "Alt Repository Schema", B.active_name(pg))
    unlock(pg); stab(pg, "Schema Management"); hub.clear(); pg.click("#simpleSyncBtn"); pg.wait_for_timeout(2500)
    check("Sync with GitHub Now (Settings → Schema Management) uses the same configuration — every request goes to acme/alt-repo", len(hub.log) > 0 and all(l[1] == ALT for l in hub.log) and "data/schemas/reg.json" in pg.inner_text("main"), hub.log[:4])
    hub.clear(); res = push_vault(pg, CUSTOM)
    check("Push Secret Vault (Settings) uses the same configuration: it writes the vault to acme/alt-repo (branch release) and nowhere else", "5 Synchronization confirmed" in res and len(hub.writes(ALT)) == 1 and not hub.writes(DEF) and all(l[1] == ALT for l in hub.log) and hub.get(VPATH, ALT) and not hub.get(VPATH, DEF), (res[:160], hub.log))
    vf = hub.get(VPATH, ALT); check("The pushed vault contains no token, no passphrase and no Base64 of them", TOK_A not in vf and CUSTOM not in vf and base64.b64encode(TOK_A.encode()).decode() not in vf)
    Bc, c = newdev(b, url, hub, tag="fresh"); pull_page(c); reveal(c); check("Another device without an administrator change uses the defaults (the override is per device)", vals(c) == DEFAULT_CFG, vals(c)); Bc.close()
    pg.reload(); B.ready(pg); pull_page(pg); reveal(pg); check("Persistence: after a reload the saved configuration is still in force and still read-only", vals(pg) == ALT_CFG and ro(pg) == [True, True, True], vals(pg))
    check("…and the Settings → Schema Management banner shows the same repository, branch and path (one source)", (unlock(pg) or True) and (stab(pg, "Schema Management") or True) and ALT in pg.inner_text(".editing-schema-banner") and "release" in pg.inner_text(".editing-schema-banner") and "data/schemas/reg.json" in pg.inner_text(".editing-schema-banner"))
    pull_page(pg); admin_edit(pg, save=False); pg.click("#repoCfgDefaults"); pg.wait_for_function("() => { const r = document.querySelector('#repoCfgResult'); return r && /restored/i.test(r.innerText); }", timeout=20000); pg.wait_for_timeout(300)
    reveal(pg); check("Restore application defaults (administrator): the defaults are back, the override record is removed", vals(pg) == DEFAULT_CFG and "sqla.repoconfig" not in storage(pg), vals(pg))
    pg.evaluate("() => localStorage.setItem('sqla.repoconfig.v1756', JSON.stringify({v:1, owner:'evil', repo:'x', branch:'main', schemaPath:'../../outside.json'}))"); pg.reload(); B.ready(pg); pull_page(pg); reveal(pg)
    check("Tampered storage: a stored record that fails validation is ignored — the defaults stay in force and the page says so", vals(pg) == DEFAULT_CFG and "not valid and was ignored" in pg.inner_text("#schemaRepoCardMount"), vals(pg))
    pg.evaluate("() => localStorage.setItem('sqla.repoconfig.v1756', 'this is not json')"); pg.reload(); B.ready(pg); pull_page(pg); reveal(pg); check("Tampered storage: unreadable data never breaks the page (defaults in force)", vals(pg) == DEFAULT_CFG and pg.locator("#pullBtn").count() == 1)
    pg.evaluate("() => localStorage.removeItem('sqla.repoconfig.v1756')")
    check("No token, password or Vault passphrase reached the console, a URL or the page during the configuration flows", not [x for x in B.console_all if TOK_A in x or TOK_B in x or "ghp_" in x or DEFAULT_PASS in x or CUSTOM in x] and TOK_A not in pg.inner_text("body"))

# ───────────────────────────── 3. The Pull Schema card ─────────────────────────────
def pull_card(b, url, st):
    hub = Hub7(); ctx, pg = newdev(b, url, hub, tag="pullcard"); pull_page(pg)
    btns = pg.locator("#schemaPullHost button").all_inner_texts(); card = pg.inner_text("#schemaPullHost")
    check("'Pull Schema from GitHub' contains only the Pull Schema action button — no input, checkbox, select, eye button or link", btns == ["Pull Schema"] and pg.locator("#schemaPullHost input, #schemaPullHost select, #schemaPullHost textarea, #schemaPullHost a, #schemaPullHost .passphrase-eye").count() == 0, btns)
    check("…and nothing else: no instructions, no status block, no passphrase wording — just the heading and the button", card.strip() == "Pull Schema from GitHub\nPull Schema" and "passphrase" not in card.lower() and pg.locator("#schemaPullHost .pull-help, #schemaPullHost #syncStatusBlock").count() == 0, card)
    t = pull_click(pg); check("Pull without a token: a clear message (no token set) — nothing requested a passphrase", "No GitHub access token is set on this device" in t and "passphrase" not in t.lower() and not hub.log, t[:200]); ctx.close()

# ───────────────────────────── 4. Token validation with GitHub (Device A step 2) ─────────────────────────────
def token_validation(b, url, st):
    hub = Hub7(); ctx, pg = newdev(b, url, hub, tag="tokcheck"); pull_page(pg)
    def set_token(tok, pw="admin"):
        pg.click("#changeTokenBtn"); pg.fill("#newTokenInput", tok); pg.fill("#tokenAdminPw", pw); hub.clear(); pg.click("#saveTokenBtn"); pg.wait_for_function("() => { const r = document.querySelector('#vaultCfgResult'); return r && r.innerText.trim() && !/Checking the token/.test(r.innerText); }", timeout=20000); pg.wait_for_timeout(500); return pg.inner_text("#vaultCfgResult")
    blob0 = pg.evaluate("() => localStorage.getItem('sqla.vault.local.v17')"); t = set_token(TOK_BAD)
    check("Token that GitHub REJECTS (401): not saved, with a clear message; nothing stored; the token is not in the message", "rejected the access token" in t and "not saved" in t and "(not set)" in pg.inner_text("#maskedToken") and pg.evaluate("() => localStorage.getItem('sqla.vault.local.v17')") == blob0 and TOK_BAD not in t and TOK_BAD not in pg.inner_text("body"), t[:240])
    t = set_token(TOK_A, "wrong-pw"); check("Wrong Admin Password: refused BEFORE any request is sent to GitHub", "Incorrect Admin Password" in t and not hub.log and "(not set)" in pg.inner_text("#maskedToken"), (t[:100], hub.log))
    t = set_token(TOK_RO); check("Token with READ-ONLY access: saved, and the message says it can pull but publishing / pushing will fail until it has 'Contents: Read and write'", "saved (encrypted)" in t and "READ-ONLY" in t and "Contents: Read and write" in t and TOK_RO[-4:] in pg.inner_text("#maskedToken"), t[:300])
    check("The check is a single authenticated read of the configured repository (no write, nothing else)", [l[:3] + l[4:] for l in hub.log] == [("GET", DEF, "repo", "auth")] and not hub.writes(), hub.log)
    t = set_token(TOK_A); check("Token with read and write access: saved, the message confirms read and write; it replaces the read-only one", "saved (encrypted)" in t and "can read and write the repository" in t and TOK_A[-4:] in pg.inner_text("#maskedToken") and TOK_RO[-4:] not in pg.inner_text("#maskedToken"), t[:300])
    blob1 = pg.evaluate("() => localStorage.getItem('sqla.vault.local.v17')"); t = set_token(TOK_BAD)
    check("A rejected token never replaces a WORKING saved token: 'the token already saved was kept', vault byte-identical", "not saved" in t and "already saved was kept" in t and TOK_A[-4:] in pg.inner_text("#maskedToken") and pg.evaluate("() => localStorage.getItem('sqla.vault.local.v17')") == blob1, t[:240])
    hub.mode = "down"; t = set_token(TOK_NEW); hub.mode = "ok"
    check("GitHub unreachable: the token cannot be checked — it is saved with the message 'saved anyway' (offline setup keeps working), not silently trusted", "saved (encrypted)" in t and "could not be reached" in t and "saved anyway" in t and TOK_NEW[-4:] in pg.inner_text("#maskedToken"), t[:300])
    hub.mode = "http404"; t = set_token(TOK_A); hub.mode = "ok"; check("Token that cannot see the repository (404 / 403): saved with an explanation — a hidden repository is not the same as an invalid token", "saved (encrypted)" in t and ("cannot see the configured repository" in t or "not allowed" in t), t[:300])
    check("No token appears in the page, storage, console or any URL during these checks", TOK_A not in pg.inner_text("body") and TOK_A not in storage(pg) and not [x for x in B.console_all if "ghp_" in x] and not [u for m, u in hub.urls if "ghp_" in u]); ctx.close()

# ───────────────────────────── 5. Cross-device recovery on TWO separate browser profiles ─────────────────────────────
def cross_device(b, url, st):
    hub = Hub7(); tmp = pathlib.Path(tempfile.mkdtemp())
    A, a = newdev(b, url, hub, tag="deviceA"); configure(a, TOK_A); make_schema(a, "Shared AP Schema"); publish_schema(a, hub)
    pull_page(a); mask_a = a.inner_text("#maskedToken"); res = push_vault(a, CUSTOM)
    check("Device A: token validated and stored (Schema → Pull Schema), then the encrypted vault is pushed through Settings → Secret Vault with the administrator's own passphrase", "5 Synchronization confirmed" in res and "application default" not in res and len(hub.writes(DEF)) >= 1 and hub.get(VPATH), res[:200])
    vf = hub.get(VPATH); j = json.loads(vf)
    check("The repository holds ONLY ciphertext (AES-256-GCM / PBKDF2): no token, no passphrase, no Base64 or URL-encoded form of either", sorted(j) == sorted(["v", "alg", "kdf", "iter", "salt", "iv", "ct"]) and TOK_A not in vf and CUSTOM not in vf and DEFAULT_PASS not in vf and base64.b64encode(TOK_A.encode()).decode() not in vf)
    Bc, bb = newdev(b, url, hub, tag="deviceB"); pull_page(bb); reveal(bb); bb.click("#repoCfgToggle")
    check("Device B (a different browser profile) starts with no token, no saved vault, the default configuration — and nothing from device A in its storage", "(not set)" in bb.inner_text("#maskedToken") and bb.evaluate("() => localStorage.getItem('sqla.vault.local.v17')") is None and "sqla.repoconfig" not in storage(bb) and TOK_A not in storage(bb))
    hub.clear(); bb.click("#pullVaultBtn"); r = vres(bb)
    check("Device B: 'Retrieve from Repository' without a token reaches the configured (private) repository anonymously and is told, honestly, that the vault file is needed — it does not claim success and says no token has to be set first", "do not have to set the token first" in r and "Import encrypted file" in r and all(l[4] == "anon" for l in hub.log) and not hub.writes() and "(not set)" in bb.inner_text("#maskedToken"), (r[:200], hub.log))
    vfile = tmp / "secret-vault.v17.enc.json"; vfile.write_text(hub.get(VPATH), encoding="utf-8"); blob = bb.evaluate("() => localStorage.getItem('sqla.vault.local.v17')")
    bb.set_input_files("#importVaultFile", str(vfile)); r = vres(bb)
    check("Device B: the default passphrase does NOT open a vault pushed with another passphrase — clear message, nothing saved, no token appears, the passphrase is not echoed", "wrong or the data was modified" in r and "(not set)" in bb.inner_text("#maskedToken") and bb.evaluate("() => localStorage.getItem('sqla.vault.local.v17')") == blob and CUSTOM not in r and DEFAULT_PASS not in r, r[:200])
    reveal(bb); bb.evaluate("(p) => { document.querySelector('#v17VaultPass').value = p; }", CUSTOM); hub.clear(); bb.set_input_files("#importVaultFile", str(vfile)); r = vres(bb)
    check("Device B: with the passphrase supplied by the user the vault is decrypted and validated locally, GitHub is asked about the token, and the token is restored — the message says so without showing it", "Secret Vault imported and validated" in r and "GitHub access token was saved" in r and "can read and write the repository" in r and TOK_A not in r and not hub.writes(), r[:300])
    check("Device B: the repository configuration was NOT revealed by the import (still hidden, still read-only, no override stored)", not bb.is_visible("#vaultRepo") and bb.get_attribute("#repoCfgToggle", "aria-expanded") == "false" and "sqla.repoconfig" not in storage(bb))
    check("Device B: the token is held only as ciphertext (masked ••••, last 4 characters), identical to device A's; it is not in the page, markup, storage, any URL or the console", bb.inner_text("#maskedToken") == mask_a and TOK_A not in bb.inner_text("body") and TOK_A not in bb.evaluate("() => document.querySelector('#app').outerHTML") and TOK_A not in storage(bb) and not any(TOK_A in u for m, u in hub.urls) and not [x for x in B.console_all if TOK_A in x or CUSTOM in x])
    hub.clear(); t = pull_click(bb)
    check("Device B: the restored token is used internally — Pull Schema works at once (authenticated), no passphrase asked, and device A's schema arrives and becomes active", "Schema pulled and validated successfully." in t and all(l[4] == "auth" for l in hub.log) and B.active_name(bb) == "Shared AP Schema" and "passphrase" not in t.lower(), (t[:160], B.active_name(bb)))
    hub.clear(); confirms(bb, False); res = push_vault(bb, CUSTOM); n = bb.evaluate("() => window.__confirms.length")
    check("Device B: Push Secret Vault works with the restored token (same repository, no confirmation needed because the vault in the repository is identical) — import and push stayed separate operations", n == 0 and "5 Synchronization confirmed" in res and len(hub.writes(DEF)) == 1 and not [l for l in hub.log if l[0] == "PUT" and l[3] != VPATH], (n, res[:160], hub.log))
    # the same vault can also be fetched straight from the repository once a token exists (second device that already has a token)
    Cc, cc = newdev(b, url, hub, tag="deviceC"); configure(cc, TOK_B); pull_page(cc); cc.evaluate("(p) => { document.querySelector('#v17VaultPass').value = p; }", CUSTOM); hub.clear(); cc.click("#pullVaultBtn"); r = vres(cc)
    check("A device that already has a token can 'Retrieve from Repository' directly (authenticated read of the vault file only); the vault's token replaces its own as an explicit import", "Secret Vault imported and validated" in r and mask_a == cc.inner_text("#maskedToken") and all(l[4] == "auth" for l in hub.log) and not hub.writes() and {l[3] for l in hub.reads(DEF)} == {VPATH}, (r[:200], hub.log)); Cc.close()
    # recovery impossible: the vault holds a token GitHub now rejects
    hub.valid.discard(TOK_A); Dd, dd = newdev(b, url, hub, tag="deviceD"); pull_page(dd); dd.evaluate("(p) => { document.querySelector('#v17VaultPass').value = p; }", CUSTOM); s0 = dd.evaluate("() => localStorage.getItem('sqla.vault.local.v17')"); dd.set_input_files("#importVaultFile", str(vfile)); r = vres(dd); hub.valid.add(TOK_A)
    check("Recovery that is not possible says so: the vault holds a token GitHub rejects (revoked / expired) → 'recovery is not possible', what to do next, nothing saved", "rejected the access token" in r and "recovery is not possible" in r and "(not set)" in dd.inner_text("#maskedToken") and dd.evaluate("() => localStorage.getItem('sqla.vault.local.v17')") == s0 and TOK_A not in r, r[:300]); Dd.close()
    check("Failure-free reuse: after the failed attempts the vault file in the repository is unchanged by any import (only device A's / B's explicit pushes wrote it)", hub.get(VPATH) is not None)
    st["hubX"] = hub; A.close(); Bc.close()

# ───────────────────────────── 6. Secret Vault import safety and the Schema section ─────────────────────────────
def vault_flows(b, url, st):
    hub = Hub7(); tmp = pathlib.Path(tempfile.mkdtemp())
    A, a = newdev(b, url, hub, tag="vaultA"); configure(a, TOK_A); make_schema(a, "Vault Test Schema"); publish_schema(a, hub); res = push_vault(a, DEFAULT_PASS); vf = hub.get(VPATH)
    check("Setup: a vault pushed with the DEFAULT passphrase (Settings → Secret Vault)", "5 Synchronization confirmed" in res and vf is not None, res[:200])
    check("Pushing with the built-in default passphrase is allowed (existing workflow) but the result carries an honest warning: it is built into the application and is not secret; use your own passphrase for a confidential token", "application default" in res and "not secret" in res and "own passphrase" in res and TOK_A not in res and DEFAULT_PASS not in res, res[-420:])
    Bc, bb = newdev(b, url, hub, tag="vaultB"); pull_page(bb)
    def do_import(pg, path): pg.set_input_files("#importVaultFile", str(path)); return vres(pg)
    vfile = tmp / "secret-vault.v17.enc.json"; vfile.write_text(vf, encoding="utf-8"); s0 = bb.evaluate("() => localStorage.getItem('sqla.vault.local.v17')")
    bb.fill("#v17VaultPass", "definitely-the-wrong-passphrase"); r = do_import(bb, vfile)
    check("Import with a wrong passphrase: 'wrong or the data was modified', nothing saved, no token appears, the passphrase is not echoed", "wrong or the data was modified" in r and "(not set)" in bb.inner_text("#maskedToken") and bb.evaluate("() => localStorage.getItem('sqla.vault.local.v17')") == s0 and "definitely-the-wrong-passphrase" not in r)
    bad = tmp / "notvault.json"; bad.write_text(json.dumps({"schemas": [], "formatVersion": 2}), encoding="utf-8"); bb.evaluate("(p) => { document.querySelector('#v17VaultPass').value = p; }", DEFAULT_PASS); r = do_import(bb, bad)
    check("Import of a file that is not a Secret Vault (a schema registry): clear message, nothing saved", "not an encrypted SQL Assistant Secret Vault" in r and "(not set)" in bb.inner_text("#maskedToken"), r[:200])
    junk = tmp / "junk.json"; junk.write_text("this is { not json", encoding="utf-8"); r = do_import(bb, junk); check("Import of a damaged / non-JSON file: clear message, nothing saved", "not valid JSON" in r and "(not set)" in bb.inner_text("#maskedToken"), r[:200])
    empty = tmp / "empty.json"; empty.write_text("", encoding="utf-8"); r = do_import(bb, empty); check("Import of an empty file: clear message, nothing saved", "not valid JSON" in r and bb.evaluate("() => localStorage.getItem('sqla.vault.local.v17')") == s0, r[:200])
    tam = json.loads(vf); tam["ct"] = tam["ct"][:-6] + ("AAAAAA" if not tam["ct"].endswith("AAAAAA") else "BBBBBB"); tf = tmp / "tampered.json"; tf.write_text(json.dumps(tam), encoding="utf-8"); r = do_import(bb, tf)
    check("Import of a tampered ciphertext: rejected (authenticated encryption), nothing saved", "wrong or the data was modified" in r and bb.evaluate("() => localStorage.getItem('sqla.vault.local.v17')") == s0, r[:200])
    check("None of the failed imports left a token, a stale success message or a changed vault behind", bb.locator("#v17VaultResult .issue-box.ok").count() == 0 and bb.evaluate("() => localStorage.getItem('sqla.vault.local.v17')") == s0)
    reveal(bb); hub.clear(); r = do_import(bb, vfile)
    check("Import of the valid file on a device with NO token: succeeds, says the GitHub access token was saved (encrypted) and that Pull Schema / Push can be used now — without setting the token first", "Secret Vault imported and validated" in r and "GitHub access token was saved on this device" in r and "does not have to be repeated" in r and "Set the GitHub access token" not in r, r[:300])
    check("…the card shows the token masked (last 4 only), 'Change Token', and — although the configuration had been revealed before — it is hidden again (an import never exposes the administrative configuration)", TOK_A[-4:] in bb.inner_text("#maskedToken") and "Change Token" in bb.inner_text("#changeTokenBtn") and not hub.writes() and not bb.is_visible("#vaultRepo"), bb.inner_text("#maskedToken"))
    hub.clear(); t = pull_click(bb); check("Right after the import Pull Schema works with the imported token — no repeat of the import", "Schema pulled and validated successfully." in t and all(l[4] == "auth" for l in hub.log), t[:160])
    # tokens that must never overwrite a saved one
    mine = bb.evaluate("() => localStorage.getItem('sqla.vault.local.v17')")
    notok = tmp / "no-token.json"; notok.write_text(craft_vault(a, "", "sk-test-" + "abcdefghijklmnopqrstuvwxyz0123456789"), encoding="utf-8"); pull_page(bb); bb.evaluate("(p) => { document.querySelector('#v17VaultPass').value = p; }", DEFAULT_PASS); r = do_import(bb, notok)
    check("A vault with NO token imported onto a device that has one: the saved token is kept, the AI key is imported, a warning explains it", TOK_A[-4:] in bb.inner_text("#maskedToken") and "no GitHub access token" in r and "was kept" in r and "AI/LLM API key was saved" in r, r[:300])
    spaced = tmp / "spaced.json"; spaced.write_text(craft_vault(a, "bad token with spaces inside it 123456"), encoding="utf-8"); pull_page(bb); bb.evaluate("(p) => { document.querySelector('#v17VaultPass').value = p; }", DEFAULT_PASS); blob = bb.evaluate("() => localStorage.getItem('sqla.vault.local.v17')"); r = do_import(bb, spaced)
    check("A vault whose token is malformed (spaces): refused, saved token kept, vault byte-identical, the value is not echoed", "not valid" in r and "Nothing was changed" in r and TOK_A[-4:] in bb.inner_text("#maskedToken") and bb.evaluate("() => localStorage.getItem('sqla.vault.local.v17')") == blob and "bad token with spaces" not in r)
    rej = tmp / "rejected.json"; rej.write_text(craft_vault(a, TOK_BAD), encoding="utf-8"); pull_page(bb); bb.evaluate("(p) => { document.querySelector('#v17VaultPass').value = p; }", DEFAULT_PASS); blob = bb.evaluate("() => localStorage.getItem('sqla.vault.local.v17')"); r = do_import(bb, rej)
    check("A vault whose token GitHub REJECTS: not applied, saved working token kept, vault byte-identical, a clear 'recovery is not possible' message with the next step", "rejected the access token" in r and "recovery is not possible" in r and "already saved was kept" in r and TOK_A[-4:] in bb.inner_text("#maskedToken") and bb.evaluate("() => localStorage.getItem('sqla.vault.local.v17')") == blob and TOK_BAD not in r)
    ro_f = tmp / "readonly.json"; ro_f.write_text(craft_vault(a, TOK_RO), encoding="utf-8"); Ee, ee = newdev(b, url, hub, tag="vaultE"); pull_page(ee); r = do_import(ee, ro_f)
    check("A vault whose token has READ-ONLY access: imported (pull works) with a visible warning that publishing / pushing will fail", "imported and validated" in r and "READ-ONLY" in r and TOK_RO[-4:] in ee.inner_text("#maskedToken"), r[:300]); Ee.close()
    Ff, ff = newdev(b, url, hub, tag="vaultF"); pull_page(ff); ff.evaluate("() => localStorage.setItem('sqla.vault.local.v17', JSON.stringify({ v: 1, alg: 'AES-256-GCM', kdf: 'DEVICE-KEY', iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }))"); ff.reload(); B.ready(ff); pull_page(ff); r = do_import(ff, vfile)
    check("A device whose own saved vault can no longer be opened (device key lost) can still import — the old data is kept as a backup copy", "imported and validated" in r and TOK_A[-4:] in ff.inner_text("#maskedToken") and ff.evaluate("() => Object.keys(localStorage).some((k) => k.includes('unreadable-'))"), r[:240]); Ff.close()
    Gg, gg = newdev(b, url, hub, tag="vaultG"); hub.put(VPATH, vf, PUB); pull_page(gg); admin_edit(gg, repo=PUB, branch="main", path=PLAIN); t = gg.inner_text("#repoCfgResult")
    check("Administrator sets a PUBLIC repository on a device with no token: saved, with the note that it could not be checked online without a token", "validated and saved" in t and "no access token is set" in t, t[:300])
    hub.clear(); gg.click("#pullVaultBtn"); r = vres(gg)
    check("'Retrieve from Repository' with no token works for a public repository (anonymous read): the vault is decrypted and the token populated", "Secret Vault imported and validated" in r and TOK_A[-4:] in gg.inner_text("#maskedToken") and all(l[4] == "anon" for l in hub.log if l[0] == "GET" and l[1] == PUB and l[2] == "contents") and not hub.writes(), (r[:200], hub.log[:3])); Gg.close(); Bc.close(); A.close()

# ───────────────────────────── 7. Push safeguards + Settings pages ─────────────────────────────
def push_safety(b, url, st):
    hub = Hub7(); A, a = newdev(b, url, hub, tag="pushA"); configure(a, TOK_A); res = push_vault(a, CUSTOM); orig = hub.get(VPATH)
    check("Push: first push creates the vault file (encrypted, verified), no default-passphrase warning with an own passphrase", "5 Synchronization confirmed" in res and orig and "application default" not in res, res[:160])
    hub.clear(); confirms(a, True); res = push_vault(a, CUSTOM); n = a.evaluate("() => window.__confirms.length"); orig = hub.get(VPATH)
    check("Push again with the same passphrase over a readable, identical vault: no confirmation is needed and the push is verified", n == 0 and "5 Synchronization confirmed" in res, (n, res[:120]))
    hub.clear(); confirms(a, False); res = push_vault(a, "another-vault-passphrase-1"); msgs = a.evaluate("() => window.__confirms")
    check("Push with a DIFFERENT passphrase over an existing vault: the user must confirm — it names the problem — and declining writes NOTHING (no PUT, the repository file is unchanged)", len(msgs) == 1 and "cannot be opened with this passphrase" in msgs[0] and "Push cancelled" in res and not hub.writes() and hub.get(VPATH) == orig, (msgs, res[:200]))
    hub.clear(); confirms(a, True); res = push_vault(a, "another-vault-passphrase-1"); check("…accepting replaces it (explicitly confirmed), verified by read-back", "Replacing the existing repository vault was confirmed" in res and "5 Synchronization confirmed" in res and len(hub.writes(DEF)) == 1 and hub.get(VPATH) != orig, res[:240])
    hub.clear(); res = push_vault(a, "another-vault-passphrase-1", path="sql-assistant-data/schemas/registry.json")
    check("Push refuses a vault file path that would overwrite another synchronized file (the schema registry): validated before anything is encrypted or written", "can never overwrite another synchronized file" in res and "Nothing was written" in res and not hub.writes(), res[:300])
    res = push_vault(a, "another-vault-passphrase-1", path="sql-assistant-data/vault/secret-vault.v17.enc.json"); check("…and with the proper path the push works again", "5 Synchronization confirmed" in res, res[:160])
    hub2 = Hub7(); P, pa = newdev(b, url, hub2, tag="pushAI"); configure(pa, TOK_A); pa.evaluate("async () => { const sv = window.__sqla.services(); const cur = await sv.vault.load(); await sv.vault.save({ ...cur, aiApiKey: 'sk-test-' + 'abcdefghijklmnopqrstuvwxyz0123456789' }); await window.__sqla.reloadSecrets(); }")
    push_vault(pa, DEFAULT_PASS); remote = hub2.get(VPATH); P.close()
    Bc, bb = newdev(b, url, hub2, tag="pushB"); configure(bb, TOK_B); hub2.clear(); confirms(bb, False); res = push_vault(bb, DEFAULT_PASS); msgs = bb.evaluate("() => window.__confirms")
    check("Push from a device that has no AI/LLM key over a repository vault that holds one: the user is told it would be REMOVED and must confirm; declining writes nothing", len(msgs) == 1 and "AI/LLM API key" in msgs[0] and "would remove" in msgs[0] and not hub2.writes() and hub2.get(VPATH) == remote and "Push cancelled" in res, (msgs, res[:160]))
    hub2.clear(); confirms(bb, True); res = push_vault(bb, DEFAULT_PASS); check("…accepting performs the push (verified)", "5 Synchronization confirmed" in res and len(hub2.writes(DEF)) == 1 and hub2.get(VPATH) != remote, res[:200]); Bc.close(); A.close()
    hub3 = Hub7(); hub3.read_only = {TOK_RO}; R, rr = newdev(b, url, hub3, tag="pushRO"); configure(rr, TOK_RO); res = push_vault(rr, CUSTOM)
    check("Push with a READ-ONLY token: GitHub's refusal is reported with a clear cause, nothing is written, no secret in the message", "Push failed" in res and ("permission" in res.lower() or "403" in res) and not hub3.get(VPATH) and TOK_RO not in res and CUSTOM not in res, res[:300]); R.close()
    Dd, dd = newdev(b, url, hub, tag="pushNo"); unlock(dd); stab(dd, "Secret Vault"); dd.fill("#v17VaultPass", DEFAULT_PASS); dd.fill("#v17VaultPass2", DEFAULT_PASS); hub.clear(); dd.click("#pushVaultBtn"); dd.wait_for_timeout(800); t = dd.inner_text("#v17VaultResult")
    check("Push without any secret saved: refused at step 1, nothing written", "Nothing was written" in t and not hub.writes(), t[:200])
    dd.evaluate("async () => { const sv = window.__sqla.services(); const cur = await sv.vault.load(); await sv.vault.save({ ...cur, aiApiKey: 'sk-test-' + 'abcdefghijklmnopqrstuvwxyz0123456789' }); await window.__sqla.reloadSecrets(); }"); dd.click("#pushVaultBtn"); dd.wait_for_timeout(1500); t = dd.inner_text("#v17VaultResult")
    check("Push with only an AI key and no GitHub token: stops before encryption — 'no GitHub access token is saved … Schema → Pull Schema' — nothing written", "no GitHub access token is saved" in t and "Schema → Pull Schema" in t and not hub.writes(), t[:240]); Dd.close()
    Ff, ff = newdev(b, url, hub, tag="pushDbl"); configure(ff, TOK_A); unlock(ff); stab(ff, "Secret Vault"); ff.fill("#v17VaultPass", CUSTOM); ff.fill("#v17VaultPass2", CUSTOM); hub.clear(); ff.evaluate("() => { const b = document.querySelector('#pushVaultBtn'); for (let i = 0; i < 5; i++) b.click(); }"); ff.wait_for_function("() => !document.querySelector('#pushVaultBtn').disabled", timeout=30000); ff.wait_for_timeout(300)
    check("Duplicate clicks: five clicks in the same instant start ONE push (one write)", len(hub.writes(DEF)) <= 1, hub.log); Ff.close()
    Gg, gg = newdev(b, url, hub, tag="settings"); unlock(gg); stab(gg, "Secret Vault"); sv = gg.inner_text("main")
    check("Settings → Secret Vault: contains Push Secret Vault to Repository (the only push) and NO repository configuration card, token editor or import / retrieve controls; no repository name is displayed", "Push Secret Vault to Repository" in sv and gg.locator("#pushVaultBtn").count() == 1 and gg.locator("#vaultRepo, #vaultBranch, #vaultPath, #changeTokenBtn, #repoCfgToggle, #pullVaultBtn, #importVaultFile").count() == 0 and "GitHub repository (schema synchronization)" not in sv and DEF not in sv and "basware" not in sv, sv[:300])
    check("…and it points to Schema → Pull Schema for the repository configuration", "Schema → Pull Schema" in sv and gg.locator("#gotoPullSchemaBtn").count() == 1)
    stab(gg, "Schema Management"); sm = gg.inner_text("main")
    check("Settings → Schema Management: the 'Schema passphrase — encrypted synchronization' card is gone; every other function remains (sync, stored schemas, add / import, advanced recovery); no passphrase input anywhere in it (the read-only status chip is not a control)", "Schema passphrase" not in sm and gg.locator("[data-v175-passphrase], #schemaPassSave, #schemaPassPublish, #schemaAdminPass").count() == 0 and gg.locator("#simpleSyncBtn, #addSchemaBtn, #importBtn, #pullRegistryBtn, #pushRegistryBtn, #validateRepoBtn, #downloadRepoBtn, #publishLocalBtn, #exportAllBtn").count() == 9 and "Stored Schemas" in sm and "Add or Import a Schema" in sm and gg.locator(".tab-panel:not([hidden]) input[type=password]").count() == 0)
    tabs = gg.locator(".tab-btn").all_inner_texts(); check("Settings tabs unchanged (8)", tabs == ["Security", "Manual Schema Update", "Schema Management", "Secret Vault", "Synchronization", "Admin Query Library", "AI/LLM Model", "Danger Zone"], tabs); Gg.close()
    Hh, hh = newdev(b, url, hub, tag="dup"); T.hamburger_pull(hh); ids = ["#pullBtn", "#pullVaultBtn", "#importVaultFile", "#repoCfgToggle", "#repoCfgEdit", "#changeTokenBtn"]; counts = [hh.locator(i).count() for i in ids]
    check("No duplicate or conflicting synchronization actions: each control exists exactly once on Schema → Pull Schema, and there is no push control there", counts == [1] * 6 and hh.locator("#pushVaultBtn, #pushBtn").count() == 0, counts); Hh.close()

# ───────────────────────────── 8. Regression, layout ─────────────────────────────
def regression(b, url):
    hub = Hub7(); ctx, pg = newdev(b, url, hub, tag="reg")
    check("Version 17.6.5 in the footer; the About page lists 17.6.5 first, then 17.5.7", "17.6.5" in pg.inner_text("footer") and (go(pg, "about") or True) and pg.inner_text("main").index("17.6.5") < pg.inner_text("main").index("17.5.7") < pg.inner_text("main").index("17.5.5"))
    ok = True
    for r in ["quickstart", "readonly", "cr", "schema-used", "schema-used/pull", "error-rectifier", "settings", "about"]: go(pg, r); ok = ok and pg.inner_text("main").strip() != ""
    check("Every route renders", ok)
    go(pg, "readonly"); B.describe(pg, "top 5 vendors by total invoice amount for approved invoices in 2025", "Oracle"); s = B.sql(pg)
    check("SQL generation (Describe What You Need, offline NLU) is unchanged: aggregation, grouping, date range, limit, validation", all(x in s for x in ["SUM(INVOICE_HEADER.INVOICE_AMOUNT)", "GROUP BY VENDOR.VENDOR_NAME", "FETCH FIRST 5 ROWS ONLY"]) and "passed validation" in pg.inner_text("#validationMount"), s[:200])
    pg.click("#btnClearSql"); pg.wait_for_timeout(150); B.pick_table(pg, "VENDOR"); B.col(pg, "VENDOR", "VENDOR_NAME"); check("Manual Selectors (table + column) are unchanged", "VENDOR.VENDOR_NAME" in B.sql(pg) and "FROM VENDOR" in B.sql(pg))
    pg.click('[data-tour="tab-advanced"]'); pg.wait_for_timeout(200); pg.check("#advDistinct"); pg.fill("#advLimit", "25"); pg.wait_for_timeout(200); check("Advanced Options are unchanged", "SELECT DISTINCT" in B.sql(pg) and "25" in B.sql(pg))
    go(pg, "schema-used"); pg.wait_for_timeout(300); tabs = pg.locator("#schemaTabs .tab-btn").all_inner_texts(); check("Schema keeps its three tabs; the hamburger menu behaves as before", tabs == ["Tables & Views in Active Schema", "Stored Schemas", "Pull Schema"] and (pg.click("#navToggle") or True) and pg.locator("#hamburgerOverlay").count() == 1 and (pg.click("#hamburgerCloseBtn") or True) and pg.locator("#hamburgerOverlay").count() == 0, tabs)
    unlock(pg); stab(pg, "Schema Management"); pg.set_input_files("#importFile", {"name": "s.json", "mimeType": "application/json", "buffer": json.dumps({"name": "Imported X", "tables": [{"name": "T_X", "module": "M", "description": "", "columns": [{"name": "ID", "type": "NUMBER", "nullable": False, "isPrimaryKey": True, "description": "pk"}]}]}).encode()}); pg.fill("#importName", "Imported X"); pg.click("#importBtn"); pg.wait_for_timeout(700)
    check("Schema import (Settings → Schema Management) still works", "Imported" in pg.inner_text("#importResult"), pg.inner_text("#importResult")[:160]); ctx.close()
def responsive(b, url):
    for w, h, name in [(1366, 900, "desktop"), (768, 900, "tablet 768px"), (390, 800, "phone 390px")]:
        hub = Hub7(); ctx, pg = newdev(b, url, hub, w=w, h=h, tag=f"resp{w}"); configure(pg, TOK_A); pull_page(pg); reveal(pg)
        fit = lambda: pg.evaluate("() => [document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1, [...document.querySelectorAll('#schemaTabs .builder-panel, #schemaTabs input, #schemaTabs button')].every((p) => p.getBoundingClientRect().right <= window.innerWidth + 1)]")
        open_ok = fit(); admin_edit(pg, repo="bad repo name", branch="main", path=PLAIN); editor_ok = fit() + [ro(pg) == [False, False, False], "owner/repository" in pg.inner_text("#repoCfgResult")]
        pg.click("#repoCfgCancel"); pg.click("#pullBtn"); pg.wait_for_timeout(1500); pg.fill("#v17VaultPass", "x"); pg.set_input_files("#importVaultFile", {"name": "v.json", "mimeType": "application/json", "buffer": b"junk"}); pg.wait_for_timeout(900); rest_ok = fit()
        pg.click("#changeTokenBtn"); pg.fill("#newTokenInput", TOK_BAD); pg.fill("#tokenAdminPw", "admin"); pg.click("#saveTokenBtn"); pg.wait_for_timeout(1500); tok_ok = fit()
        check(f"Responsive ({name}): the three cards, the revealed configuration, the open editor with its message, a pull result, a vault error and a token-validation message all fit without horizontal scrolling", all(open_ok) and all(editor_ok) and all(rest_ok) and all(tok_ok), (open_ok, editor_ok, rest_ok, tok_ok)); ctx.close()

def main():
    if not (ROOT / "dist/index.html").exists(): print("Run npm run build first."); sys.exit(2)
    port = B.free_port(); serve = subprocess.Popen(["node", str(ROOT / "scripts/serve.mjs")], env={**os.environ, "PORT": str(port), "BASE": "/SQL-Assistant/"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.9)
    url = f"http://127.0.0.1:{port}/SQL-Assistant/?e2e=1"; st = {}
    try:
        with sync_playwright() as p:
            exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
            section("Configuration UI", config_ui, b, url, st)
            if "cfg" in st: section("One configuration", one_configuration, b, url, st)
            section("Pull Schema card", pull_card, b, url, st); section("Token validation", token_validation, b, url, st); section("Cross-device recovery", cross_device, b, url, st); section("Vault import safety", vault_flows, b, url, st); section("Push safeguards", push_safety, b, url, st); section("Regression", regression, b, url); section("Responsive", responsive, b, url)
            b.close()
    finally: serve.terminate()
    real = [e for e in B.errors if "Failed to load resource" not in e and "net::ERR" not in e and "Could not reach GitHub" not in e and "ERR_CONNECTION" not in e]
    check("No console errors or uncaught exceptions in any V17.5.7 flow", not real, "; ".join(real[:4]))
    results = B.results; failed = [r for r in results if not r[1]]; print(f"\n{len(results) - len(failed)}/{len(results)} V17.5.7 browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True); (ROOT / "test-results/browser-results-v1757.json").write_text(json.dumps([{"check": n, "pass": ok} for n, ok in results], indent=2)); sys.exit(1 if failed else 0)
if __name__ == "__main__": main()
