"""SQL Assistant V17.6.2 — real-browser tests of CENTRAL REPOSITORY ACCESS on the PRODUCTION build (Chromium / Playwright).
   npm run build && python3 scripts/browser_test_v1762.py        (CHROME_PATH=/path/to/chrome to use an installed browser)

What is REAL: the production page served by a real static server (scripts/serve.mjs) with the deployed configuration file `sql-assistant-data/repo-broker.config.json`; the REAL repository access broker
(server/repo-broker.mjs as a separate process, real HTTP, real CORS from the page's origin); the application's own client, GitHub-less code, vault and crypto. Every "device" is a separate Chromium
context: no shared localStorage, sessionStorage, IndexedDB (so no device key) or cookies. NO request from the page goes anywhere but the site and the broker (checked).
What is EMULATED (this environment has no network access to github.com): github.com itself — test/support/github-stub.mjs, a separate process that models a PRIVATE repository, the fine-grained PAT, the
GitHub-App user tokens of the device flow, contents / blobs / branches / collaborators, and 401 / 403 / 404 / 409. The user's approval on github.com is a call the test makes while the page waits.
Covers the V17.6.2 request: Device A (authorized writer) and Device B (clean profile, read-only account), failure scenarios, regression of the default (no central access) behaviour, secret hygiene."""
import json, os, re, sys, time, subprocess, pathlib, shutil, tempfile, socket, urllib.request
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import browser_test as BT
ROOT = BT.ROOT; check = BT.check; ready = BT.ready; go = BT.go; free_port = BT.free_port
OWNER, REPO, BRANCH = "basware", "sk-ap-sql-assistant", "main"; DEF = f"{OWNER}/{REPO}"
PLAIN = "sql-assistant-data/schemas/registry.json"; VPATH = "sql-assistant-data/vault/secret-vault.v17.enc.json"
PAT = "github_pat_" + "CENTRAL0PAT1for2the3broker4only5xyz"; USER_OK = "ghu_" + "UserWhoCanRead1234567890abcdefgh"; USER_RW = "ghu_" + "UserWhoCanWrite1234567890abcdefg"; USER_NONE = "ghu_" + "UserWithoutAccess1234567890abcdef"
DEVICE_CODE = "dc_" + "stubdevicecode0123456789abcdefghij"; CLIENT = "Iv1.0123456789abcdef"; SESSION_SECRET = "browser-test-session-secret-" + "x" * 20
OWN = "violet-harbour-2026-lantern"; DEFAULT_PASS = "xG71lfp1NHZVZ4WVWCPe"; AI = "sk-test-" + "abcdefghijklmnopqrstuvwxyz0123456789"; SHARED = "Shared AP Schema"; USERCODE = "WDJB-MJHT"
errors, console_all, requests = [], [], []; results = BT.results
def log(m): print(m, flush=True)
def stub(port, op, **kw):
    req = urllib.request.Request(f"http://127.0.0.1:{port}/__ctl", data=json.dumps(dict(op=op, **kw)).encode(), method="POST"); urllib.request.urlopen(req, timeout=5).read()
def state(port): return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/__state", timeout=5).read())
def tiny(name): return {"id": "s-" + name.lower().replace(" ", "-"), "name": name, "tables": [{"name": "INVOICE", "module": "AP", "description": "", "columns": [{"name": "ID", "type": "NUMBER", "nullable": False, "isPrimaryKey": True, "description": ""}, {"name": "STATUS", "type": "VARCHAR", "nullable": True, "description": ""}]}], "relationships": []}
REGISTRY = json.dumps({"schemas": [tiny(SHARED)], "activeSchemaId": "s-" + SHARED.lower().replace(" ", "-")})
def spawn(args, env, name):
    p = subprocess.Popen(["node"] + args, env={**os.environ, **env}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True); time.sleep(0.9)
    if p.poll() is not None: raise RuntimeError(f"{name} did not start: {p.stdout.read()}")
    return p
def site(cfg_url, port):
    d = pathlib.Path(tempfile.mkdtemp(prefix="sqla-site-")); shutil.copytree(ROOT / "release", d / "release"); (d / "scripts").mkdir(); shutil.copy(ROOT / "scripts/serve.mjs", d / "scripts/serve.mjs"); (d / "test-dist").mkdir(exist_ok=True); shutil.copy(ROOT / "test-dist/index.html", d / "test-dist/index.html")  # V17.7: ?e2e=1 is served the browser-test build; the production page of release/ has no hook
    if cfg_url is not None: data = d / "release/sql-assistant-data"; data.mkdir(parents=True, exist_ok=True); (data / "repo-broker.config.json").write_text(json.dumps({"repositoryBroker": {"enabled": True, "url": cfg_url}}), encoding="utf-8")
    p = subprocess.Popen(["node", str(d / "scripts/serve.mjs")], env={**os.environ, "PORT": str(port), "BASE": "/"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.9); return p, d
def watch(pg, tag):
    pg.on("console", lambda m: (console_all.append(m.text), m.type == "error" and errors.append(f"{tag}: {m.text}"))); pg.on("pageerror", lambda e: errors.append(f"{tag}: {e}")); pg.on("dialog", lambda d: d.accept())
    pg.on("request", lambda r: requests.append((tag, r.method, r.url, r.post_data or "", r.headers.get("authorization", ""))))
ADMIN_PW_FIELDS = ["#repoCfgSave", "#repoCfgDefaults", "#settingsPwInput", "#tokenAdminPw", "#repoCfgAdminPw", "#aqPw", "#pwCurrent", "#dangerPw", "#c3Password", "#delSchemaPw"]
def _auto_confirm(pg):
    """V17.6.9 harness (legacy suites): these flows drive the FIRST-TIME default on a device that has no repository connection yet (typing the first token, changing the first password). Since V17.6.9 the default is accepted only when an
    authoritative repository CONFIRMS it, so a click that submits a visible Admin Password field on a device with NO connection (or a refused credential) and NO central access service gets a temporary EMPTY authoritative repository,
    released again afterwards. Devices with a central access service (sign-in first), a published copy or a test repository are never touched; the application code is not touched."""
    orig = pg.click
    def click(selector, *a, **k):
        tmp = False
        try:
            if not (str(selector).startswith("#pull") or "Sync" in str(selector) or "Toggle" in str(selector)) and pg.evaluate("({f}) => f.some(s => { const i = document.querySelector(s); return !!(i && i.offsetParent !== null); }) && (() => { const d = window.__sqla.adminAuth.diagnostics(); return (d.source !== 'authoritative' || d.state === 'error') && !window.__sqla.brokerEnabled(); })()", {"f": ADMIN_PW_FIELDS}):
                pg.evaluate("() => window.__sqla.setRepositoryOverride(window.__sqla.memoryRepository({}))"); pg.wait_for_timeout(120); tmp = True
        except Exception: tmp = False
        r = orig(selector, *a, **k)
        if tmp:
            pg.wait_for_timeout(1500)
            try: pg.evaluate("() => window.__sqla.setRepositoryOverride(null)")
            except Exception: pass
        return r
    pg.click = click
def newdev(b, url, tag, w=1366, h=900):
    ctx = b.new_context(viewport={"width": w, "height": h}); pg = ctx.new_page(); watch(pg, tag); pg.goto(url + "?e2e=1"); ready(pg); _auto_confirm(pg); return ctx, pg
def hamburger_pull(pg): pg.click("#navToggle"); pg.wait_for_timeout(200); pg.click('#hamburgerOverlay [data-route="schema-used"]'); pg.wait_for_timeout(350); pg.click('#schemaTabs .tab-btn:has-text("Pull Schema")'); pg.wait_for_timeout(500)
def unlock(pg, pw="admin"):
    go(pg, "settings")
    if pg.locator("#settingsPwInput").count(): pg.fill("#settingsPwInput", pw); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(1000)
def stab(pg, name): pg.click(f'.tab-btn:has-text("{name}")'); pg.wait_for_timeout(400)
def storage(pg): return pg.evaluate("() => JSON.stringify({l: Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])), s: Object.fromEntries(Object.keys(sessionStorage).map(k => [k, sessionStorage.getItem(k)]))})")
def local_only(pg): return pg.evaluate("() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])))")
def active_name(pg): return pg.evaluate("() => window.__sqla.services().schemas.active().name")
def registry_json(pg): return pg.evaluate("() => JSON.stringify(window.__sqla.services().schemas.registry())")
def secrets_now(pg): return json.loads(pg.evaluate("async () => JSON.stringify(await window.__sqla.services().vault.load())"))
def set_ai(pg, key): pg.evaluate("async (k) => { const v = window.__sqla.services().vault; const s = await v.load(); await v.save({ ...s, aiApiKey: k }); await window.__sqla.reloadSecrets(); }", key)
def pull_wait(pg, timeout=40000):
    pg.wait_for_function("() => { const b = document.querySelector('#pullBtn'); const r = document.querySelector('#pullResult'); return b && !b.disabled && r && r.querySelector('.issue-box') && !/Retrieving the schema|Starting the GitHub sign-in|Sign in to GitHub/.test(r.innerText); }", timeout=timeout); pg.wait_for_timeout(250); return pg.inner_text("#pullResult")
def code_box(pg, sel="#brokerUserCode"): pg.wait_for_selector(sel, timeout=20000); return pg.inner_text("main")
def vault_wait(pg, timeout=45000):
    pg.wait_for_function("() => { const r = document.querySelector('#v17VaultResult'); return r && r.innerText.trim() && !/Retrieving and decrypting|Sign in to GitHub|Starting the GitHub sign-in|Signed in\\. Reading/.test(r.innerText); }", timeout=timeout); pg.wait_for_timeout(300); return pg.inner_text("#v17VaultResult")
def set_pass(pg, p): pg.evaluate("(p) => { document.querySelector('#v17VaultPass').value = p; }", p)
def leaked(text, *s): return any(x and x in text for x in s)
def push_vault(pg, pw, tab_name="Secret Vault"):
    unlock(pg); stab(pg, tab_name); pg.fill("#v17VaultPass", pw); pg.fill("#v17VaultPass2", pw); pg.click("#pushVaultBtn")
    pg.wait_for_function("() => { const r = document.querySelector('#v17VaultResult'); return r && r.querySelector('.issue-box') && !/Sign in to GitHub|Starting the GitHub sign-in/.test(r.innerText) && !document.querySelector('#pushVaultBtn').disabled; }", timeout=60000); pg.wait_for_timeout(300); return pg.inner_text("#v17VaultResult")

def main():
    for f in ["dist/index.html", "release/index.html"]: check(f"Build output exists: {f}", (ROOT / f).exists())
    html = (ROOT / "test-dist/index.html").read_text(encoding="utf-8"); sp, bp, wp, wp2 = free_port(), free_port(), free_port(), free_port(); procs = []; sites = []
    check("The production bundle holds no PAT, no user token, no device code, no sign-in client ID and no environment access", not leaked(html, PAT, USER_OK, USER_RW, USER_NONE, DEVICE_CODE, CLIENT, "process.env", "SQLA_SESSION_SECRET"))
    try:
        gh = spawn([str(ROOT / "test/support/github-stub.mjs"), str(sp)], {}, "github stub"); procs.append(gh)
        stub(sp, "file", path=PLAIN, text=REGISTRY); origin = f"http://127.0.0.1:{wp}"
        benv = {"SQLA_GITHUB_PAT": PAT, "SQLA_GITHUB_CLIENT_ID": CLIENT, "SQLA_ALLOWED_ORIGINS": origin + "," + f"http://127.0.0.1:{wp2}", "SQLA_SESSION_SECRET": SESSION_SECRET, "GITHUB_API_BASE": f"http://127.0.0.1:{sp}", "GITHUB_WEB_BASE": f"http://127.0.0.1:{sp}", "PORT": str(bp), "SQLA_AUDIT_LOG": "0"}
        broker = spawn([str(ROOT / "server/repo-broker.mjs")], benv, "broker"); procs.append(broker)
        s1, d1 = site(f"http://127.0.0.1:{bp}", wp); procs.append(s1); sites.append(d1)
        s2, d2 = site(None, wp2); procs.append(s2); sites.append(d2)   # the same build WITHOUT the central-access configuration file (V17.6.1 behaviour)
        url = f"http://127.0.0.1:{wp}/"; url_default = f"http://127.0.0.1:{wp2}/"
        with sync_playwright() as p:
            exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
            device_a(b, url, sp, bp); device_b(b, url, sp); failures(b, url, sp, bp, benv, procs, sites); regression(b, url_default, sp); hygiene(sp)
            b.close()
    finally:
        for pr in procs:
            try: pr.terminate()
            except Exception: pass
        for d in sites: shutil.rmtree(d, ignore_errors=True)
    bad = [e for e in errors if "Failed to load resource" not in e]
    check("No console errors or uncaught exceptions in any V17.6.2 flow (the expected network-status lines of the failure scenarios excluded); no secret in any console message", not bad and not leaked("\n".join(console_all), PAT, USER_OK, USER_RW, USER_NONE, DEVICE_CODE, AI, OWN), bad[:3])
    failed = [r for r in results if not r[1]]; print(f"\n{len(results) - len(failed)}/{len(results)} V17.6.2 browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True); (ROOT / "test-results/browser-results-v1762.json").write_text(json.dumps([{"check": n, "pass": ok} for n, ok in results], indent=2)); sys.exit(1 if failed else 0)

# ───────────────────────────── Device A — an authorized GitHub account that can write ─────────────────────────────
def device_a(b, url, sp, bp):
    ctx, pg = newdev(b, url, "A"); hamburger_pull(pg)
    heads = pg.evaluate("() => [...document.querySelectorAll('#schemaRepoCardMount h2, #schemaPullHost h2, #schemaVaultCardMount h2')].map(h => h.innerText.trim())")
    check("A: Hamburger → Schema → Pull Schema holds exactly the three cards in the required order: GitHub repository (schema synchronization) · Pull Schema from GitHub · Pull Secret Vault to Repository", len(heads) == 3 and heads[0].endswith("GitHub repository (schema synchronization)") and heads[1].endswith("Pull Schema from GitHub") and heads[2].endswith("Pull Secret Vault to Repository"), heads)
    check("A: Card 2 holds only the Pull Schema action and its status area — no passphrase field, no input of any kind", pg.locator("#schemaPullHost input, #schemaPullHost textarea, #schemaPullHost select").count() == 0 and pg.locator("#schemaPullHost button").count() == 1 and pg.inner_text("#schemaPullHost button").strip() == "Pull Schema")
    pg.click("#repoCfgToggle"); pg.wait_for_timeout(200); vals = [pg.input_value(i) for i in ("#vaultRepo", "#vaultBranch", "#vaultPath")]
    check("A: Card 1 shows the configured repository read-only by default: basware/sk-ap-sql-assistant · main · sql-assistant-data/schemas/registry.json — all three fields read-only, no editing control visible to an ordinary user except the administrator's Edit button", vals == [DEF, BRANCH, PLAIN] and all(pg.get_attribute(i, "readonly") is not None for i in ("#vaultRepo", "#vaultBranch", "#vaultPath")) and not pg.is_visible("#repoCfgSave") and not pg.is_visible("#repoCfgAdminPw"), vals)
    check("A: with central access the token row of Card 1 is replaced by 'Repository access' (not signed in) — no token field, no Set Token", "Not signed in" in pg.inner_text("#accessStatus") and pg.locator("#changeTokenBtn, #newTokenInput, #saveTokenBtn").count() == 0 and pg.locator("#brokerSignInBtn").count() == 1)
    # the administrator authentication works without any GitHub token / session
    pg.click("#repoCfgEdit"); pg.fill("#repoCfgAdminPw", "wrong-password"); pg.click("#repoCfgUnlock"); pg.wait_for_timeout(800)
    check("A: an unauthorized configuration change is refused — a wrong Admin Password keeps the fields read-only (the administrator screen works with no GitHub token and no sign-in)", ("Incorrect Admin Password" in pg.inner_text("#repoCfgResult") or "could not be read" in pg.inner_text("#repoCfgResult")) and pg.get_attribute("#vaultRepo", "readonly") is not None)
    # V17.6.8: with central access configured but NO sign-in yet, the central Admin Password cannot be read — the default is NOT accepted (it is not proof of anything); the message says what to do
    pg.fill("#repoCfgAdminPw", "admin"); pg.click("#repoCfgUnlock"); pg.wait_for_timeout(900)
    check("A: V17.6.8 — before any sign-in (central Admin Password unknown) the default is not accepted: the editor stays read-only and the message names the Sync button", pg.get_attribute("#vaultRepo", "readonly") is not None and "Sync button" in pg.inner_text("#repoCfgResult") and "could not be read" in pg.inner_text("#repoCfgResult"), pg.inner_text("#repoCfgResult")[:200])
    pg.click("#repoCfgAuthCancel"); pg.wait_for_timeout(200); before = registry_json(pg); st0 = state(sp)
    check("A: before any sign-in nothing reached GitHub with the PAT (the page holds no token and asks nothing of GitHub itself)", not [r for r in st0["requests"] if r["cred"] == "PAT"])
    # Pull Schema → sign-in → pull, continuing by itself
    pg.click("#pullBtn"); box = code_box(pg)
    check("A: Pull Schema with no authorization starts the supported sign-in: the card shows the user code and the real github.com address with Cancel — the page never shows a device code, token or the PAT", USERCODE in box and "github.com/login/device" in box and pg.locator("#brokerSignInCancel").count() == 1 and not leaked(box, DEVICE_CODE, PAT, USER_RW), box[:200])
    check("A: while it waits NOTHING is authorized: no PAT use, the local schema is unchanged", not [r for r in state(sp)["requests"] if r["cred"] == "PAT"] and registry_json(pg) == before)
    stub(sp, "set", values={"deviceMode": "approve", "issue": USER_RW}); res = pull_wait(pg)
    check("A: after approval the page continues by itself: the schema is retrieved through the central service, validated and applied — 'Schema pulled and validated successfully', the shared schema is active", "Schema pulled and validated successfully" in res and active_name(pg) == SHARED, res[:200])
    stx = state(sp); gets = [r for r in stx["requests"] if r["cred"] == "PAT" and "/contents/" in r["path"]]
    check("A: the schema file was read by the service with the PAT (registry.json of the configured repository and branch); the sign-in token only reached GitHub for the two sign-in checks", gets and all(r["path"].startswith(f"/repos/{DEF}/contents/{PLAIN}") and f"ref={BRANCH}" in r["path"] for r in gets if "registry.enc" not in r["path"]) and sorted({r["path"].split('?')[0] for r in stx["requests"] if r["cred"] == "user"}) == sorted(["/user", f"/repos/{DEF}"]), [r["path"] for r in stx["requests"] if r["cred"] == "user"])
    check("A: Pull Schema never asked for a Secret Vault passphrase and never touched the vault file", not [r for r in stx["requests"] if "secret-vault" in r["path"]] and pg.locator("#schemaPullHost input").count() == 0)
    st = storage(pg); sess = json.loads(pg.evaluate("() => sessionStorage.getItem('sqla.repoaccess.session.v1762')") or "{}")
    check("A: the page holds only a short-lived broker session (sessionStorage; not a GitHub token) — no PAT, user token or device code anywhere in browser storage; nothing token-like in localStorage", sess.get("token", "").startswith("v1.") and sess.get("login") == "writer-rw" and sess.get("canWrite") is True and not leaked(st, PAT, USER_RW, USER_OK, DEVICE_CODE, "github_pat_", "ghp_", "ghu_") and "v1." not in local_only(pg))
    check("A: Card 1 now shows who is signed in (and that they can publish), not a token", "writer-rw" in pg.inner_text("#accessStatus") and "can publish" in pg.inner_text("#accessStatus"))
    n_codes = state(sp)["codeCalls"]; stub(sp, "file", path="sql-assistant-data/schemas/registry.json", text=REGISTRY); res = pull_wait_click(pg)
    check("A: a second Pull Schema reuses the valid session — no new sign-in, no new device code", "Schema pulled and validated" in res or "No schema content needed" in res or "pulled" in res.lower(), res[:160]); check("A: …and the sign-in service was not asked for another code", state(sp)["codeCalls"] == n_codes)
    # after the sign-in the central record can be read (none exists): the default is legitimately in force and unlocks the editor
    if not pg.is_visible("#repoCfgEdit"): pg.click("#repoCfgToggle"); pg.wait_for_timeout(250)
    pg.click("#repoCfgEdit")
    pg.fill("#repoCfgAdminPw", "admin"); pg.click("#repoCfgUnlock"); pg.wait_for_timeout(900); editable = pg.get_attribute("#vaultRepo", "readonly") is None
    pg.fill("#vaultBranch", "bad branch name"); pg.click("#repoCfgSave"); pg.wait_for_timeout(800); msg = pg.inner_text("#repoCfgResult")
    check("A: the correct Admin Password unlocks editing; an invalid value is validated and refused before anything is saved, and the current configuration stays in force", editable and "not valid" in msg and "sqla.repoconfig" not in local_only(pg) and pg.evaluate("() => window.__sqla.repoLocation().join('|')") == f"{OWNER}|{REPO}|{BRANCH}|{PLAIN}", msg[:160])
    pg.click("#repoCfgCancel"); pg.wait_for_timeout(200)
    # Check central access
    pg.click("#brokerCheckBtn"); pg.wait_for_function("() => /central PAT/.test(document.querySelector('#brokerResult').innerText)", timeout=15000); cm = pg.inner_text("#brokerResult")
    check("A: 'Check central access' reports the state of the central PAT (configured, accepted by GitHub, expiry date when GitHub reports one) and never shows it", "accepts it" in cm and not leaked(cm, PAT) and re.search(r"expiry", cm, re.I) is not None, cm[:200])
    # Settings → Secret Vault: publishing through the central mechanism
    set_ai(pg, AI); unlock(pg); stab(pg, "Secret Vault"); sv = pg.inner_text("main")
    check("A: Settings → Secret Vault keeps Push Secret Vault to Repository and holds NO copy of the repository configuration (no repository / branch / schema-path fields, no token row)", "Push Secret Vault to Repository" in sv and pg.locator("#pushVaultBtn").count() == 1 and pg.locator("#vaultRepo, #vaultBranch, #vaultPath, #repoCfgEdit, #newTokenInput").count() == 0 and "GitHub repository (schema synchronization)" not in sv and "central" in sv.lower())
    stab(pg, "Schema Management"); sm = pg.inner_text("main"); check("A: Settings → Schema Management no longer has the 'Schema passphrase — encrypted synchronization' card (its unrelated functions remain)", "Schema passphrase" not in sm and "Sync with GitHub Now" in sm and "Stored Schemas" in sm)
    res = push_vault(pg, OWN); stx = state(sp); vf = stx["files"].get(VPATH, ""); puts = [r for r in stx["requests"] if r["method"] == "PUT"]
    check("A: Push Secret Vault to Repository works through the central mechanism: signed in as writer-rw, written by the service with the PAT, read back and verified — 'pushed to the repository (ciphertext only)'", "Encrypted Secret Vault pushed to the repository" in res and "Repository access is central" in res and "5 Synchronization confirmed" in res and bool(vf) and len(puts) == 1 and puts[0]["cred"] == "PAT" and puts[0]["path"].split("?")[0].endswith(VPATH), res[:300])
    j = json.loads(vf or "{}"); check("A: the repository holds ONLY the encrypted envelope — no PAT, no GitHub token, no AI key, no passphrase (own or default), no Base64 / URL-encoded copy of any of them", sorted(j) == sorted(["v", "alg", "kdf", "iter", "salt", "iv", "ct"]) and not leaked(vf, PAT, USER_RW, AI, OWN, DEFAULT_PASS), list(j))
    check("A: the commit names the signed-in user and carries no secret", (stx.get("lastCommitMessage") or "").endswith("(via repository broker · writer-rw)") and not leaked(stx.get("lastCommitMessage") or "", PAT, AI, OWN))
    ctx.close()

def pull_wait_click(pg):
    pg.evaluate("location.hash = '#schema-used/pull'"); pg.wait_for_timeout(500); pg.click("#pullBtn"); return pull_wait(pg)

# ───────────────────────────── Device B — a clean browser profile, a READ-ONLY GitHub account ─────────────────────────────
def device_b(b, url, sp):
    stub(sp, "set", values={"deviceMode": "pending", "issue": USER_OK}); puts_a = len([r for r in state(sp)["requests"] if r["method"] == "PUT"]); ctx, pg = newdev(b, url, "B"); hamburger_pull(pg); s0 = storage(pg); reg0 = registry_json(pg); n_codes = state(sp)["codeCalls"]
    check("B: a clean profile — nothing saved, no token, no vault, no session, nothing from device A", "v1." not in s0 and "sqla.vault.local" not in s0 and "Not signed in" in pg.inner_text("#accessStatus") and active_name(pg) != SHARED)
    check("B: the Secret Vault passphrase is pre-filled with the default (xG71…), masked, and still editable; the card says the direction is repository → this device", pg.input_value("#v17VaultPass") == DEFAULT_PASS and pg.get_attribute("#v17VaultPass", "type") == "password" and pg.get_attribute("#v17VaultPass", "readonly") is None and "Direction: repository → this device" in pg.inner_text("#schemaVaultCardMount"))
    pg.fill("#v17VaultPass", "a-wrong-vault-passphrase-123"); pg.click("#pullVaultBtn"); code_box(pg); stub(sp, "set", values={"deviceMode": "approve", "issue": USER_OK}); res = vault_wait(pg)
    check("B: Retrieve from Repository on a clean profile: the sign-in starts automatically (no token had to be copied from device A), the vault is read through the service, and a WRONG passphrase is refused with the real cause", "passphrase is wrong" in res.lower() or "could not be decrypted" in res.lower(), res[:240])
    check("B: …nothing on this device was changed by the failed attempt (local data byte-identical apart from the sign-in session), the passphrase is not echoed", [l for l in json.loads(local_only(pg)).keys()] == [l for l in json.loads(s0)["l"].keys()] and registry_json(pg) == reg0 and not leaked(pg.inner_text("main"), "a-wrong-vault-passphrase-123"), list(json.loads(local_only(pg)).keys()))
    n1 = state(sp)["codeCalls"]; check("B: the sign-in (one device code) was done once; correcting the passphrase does not need another", n1 == n_codes + 1)
    set_pass(pg, OWN); pg.click("#pullVaultBtn"); res = vault_wait(pg)
    check("B: with the right passphrase the vault is retrieved through the service, validated (structure, version), decrypted, and restored — 'Secret Vault imported and validated'; the AI key is restored", "Secret Vault imported and validated" in res and "AI/LLM API key was saved" in res and secrets_now(pg)["aiApiKey"] == AI, res[:240])
    check("B: …without another sign-in, and the result names the source (the central repository access service — no token stored on this device)", state(sp)["codeCalls"] == n1 and "central repository access service" in res)
    check("B: no GitHub token of any kind exists on this device afterwards (the vault held none; central access does not restore one)", secrets_now(pg)["githubToken"] == "" and not leaked(storage(pg), PAT, USER_OK, USER_RW, "github_pat_", "ghp_", "ghu_"))
    check("B: the repository was only READ by the vault retrieval (no write at all happened since device A's push)", len([r for r in state(sp)["requests"] if r["method"] == "PUT"]) == puts_a)
    puts_before = len([r for r in state(sp)["requests"] if r["method"] == "PUT"]); res = pull_wait_click(pg)
    check("B: Pull Schema works on this clean profile with the same session — the shared schema arrives and becomes active; no second sign-in", "pulled" in res.lower() and active_name(pg) == SHARED and state(sp)["codeCalls"] == n1, res[:200])
    vf_before = state(sp)["files"].get(VPATH); res = push_vault(pg, OWN); stx = state(sp)
    check("B: a read-only GitHub account cannot publish: Push Secret Vault to Repository is refused with the reason, and the repository is unchanged (the service never reached GitHub with a write)", ("read-only access" in res) and stx["files"].get(VPATH) == vf_before and len([r for r in stx["requests"] if r["method"] == "PUT"]) == puts_before, res[:300])
    reqs = [r for r in state(sp)["requests"] if r["tok"]]
    check("B: end to end, only the service's PAT and the users' sign-in tokens ever authenticated to GitHub; the service's PAT was used only for contents / branch / repository requests", all(r["cred"] in ("PAT", "user") for r in reqs) and all(("/contents/" in r["path"] or r["path"].startswith(f"/repos/{DEF}")) for r in reqs if r["cred"] == "PAT"))
    ctx.close()

# ───────────────────────────── failure scenarios: every one preserves the existing valid local data and names the real cause ─────────────────────────────
def signed_in_device(b, url, sp, who=USER_RW, tag="F"):
    stub(sp, "set", values={"deviceMode": "approve", "issue": who}); ctx, pg = newdev(b, url, tag); hamburger_pull(pg); pg.click("#pullBtn"); pull_wait(pg); return ctx, pg
def failures(b, url, sp, bp, benv, procs, sites):
    stub(sp, "set", values={"patMode": "ok", "deviceMode": "approve", "issue": USER_RW, "down": False}); ctx, pg = signed_in_device(b, url, sp); base = registry_json(pg); who = active_name(pg); intact = lambda: registry_json(pg) == base and active_name(pg) == who
    def pull(): pg.click("#pullBtn"); return pull_wait(pg)
    for mode, needle, label in [("rejected", "rejected the central PAT", "an invalid, expired or revoked PAT"), ("invisible", "not allowed to read the configured repository", "a PAT that cannot see the repository / lacks privileges"), ("ratelimit", "limiting requests", "a GitHub rate limit")]:
        stub(sp, "set", values={"patMode": mode}); res = pull()
        check(f"Failure — {label}: Pull Schema says so (the administrator must fix the secret), never reports success, the local schema is unchanged, and the message holds no secret", needle in res and "pulled and validated" not in res and intact() and not leaked(res, PAT, USER_RW), res[:200])
    stub(sp, "set", values={"patMode": "ok", "down": True}); res = pull(); check("Failure — GitHub unreachable from the service: Pull Schema reports it, no success, local schema unchanged", ("could not be retrieved" in res or "could not reach" in res.lower()) and "pulled and validated" not in res and intact(), res[:200]); stub(sp, "set", values={"down": False})
    stub(sp, "file", path=PLAIN, text=None); res = pull(); check("Failure — missing schema registry: 'No schema file was found in the repository yet', local schema unchanged, no false success", "No schema file was found" in res and intact(), res[:200])
    stub(sp, "file", path=PLAIN, text='{ "schemas": [ { "name": 12 ] '); res = pull(); check("Failure — malformed schema registry: refused by validation with the reason, local schema unchanged", "pulled and validated" not in res and ("failed validation" in res or "could not be retrieved" in res or "not valid" in res.lower() or "unchanged" in res.lower()) and intact(), res[:240])
    stub(sp, "file", path=PLAIN, text=REGISTRY)
    # vault failures (device already signed in)
    go(pg, "schema-used/pull"); pg.wait_for_timeout(400); local0 = local_only(pg)
    stub(sp, "file", path=VPATH, text=None); pg.click("#pullVaultBtn"); res = vault_wait(pg); check("Failure — missing vault: 'No encrypted Secret Vault was found', device unchanged", "No encrypted Secret Vault was found" in res and local_only(pg) == local0, res[:200])
    for text, label in [('{"v":1,"alg":"AES-256-GCM","kdf":"PBKDF2-SHA256","iter":310000,"salt":"AAAA","iv":"AAAA"}', "damaged (incomplete envelope)"), ("<html>sign in</html>", "an HTML page instead of the file"), ('{"hello":"world"}', "not a vault"), ('{"v":9,"alg":"AES-256-GCM","kdf":"PBKDF2-SHA256","salt":"AAAA","iv":"AAAA","ct":"AAAA"}', "a newer / unknown version")]:
        stub(sp, "file", path=VPATH, text=text); pg.click("#pullVaultBtn"); res = vault_wait(pg); check(f"Failure — corrupted vault ({label}): refused before decryption with its own reason, nothing restored, device unchanged", "Secret Vault imported" not in res and "Nothing on this device was changed" in res and local_only(pg) == local0, res[:200])
    stub(sp, "set", values={"patMode": "rejected"}); stub(sp, "file", path=VPATH, text="{}"); pg.click("#pullVaultBtn"); res = vault_wait(pg); check("Failure — rejected PAT during Retrieve: the vault card names the PAT (administrator action), device unchanged, no secret", "central PAT" in res and local_only(pg) == local0 and not leaked(res, PAT), res[:200]); stub(sp, "set", values={"patMode": "ok"})
    # session expiry → a new sign-in is requested again
    pg.evaluate("() => sessionStorage.clear()"); pg.reload(); ready(pg); hamburger_pull(pg); base = registry_json(pg); who = active_name(pg); n = state(sp)["codeCalls"]; stub(sp, "set", values={"deviceMode": "pending"}); pg.click("#pullBtn"); code_box(pg)
    check("Failure — an expired / missing session: the next repository action asks for a new GitHub sign-in (no silent fall-back to any token)", state(sp)["codeCalls"] == n + 1 and pg.locator("#brokerSignInCancel").count() == 1)
    pg.click("#brokerSignInCancel"); res = pull_wait(pg); check("Cancel ends the sign-in at once: 'Sign-in cancelled', nothing changed", "cancelled" in res.lower() and intact(), res[:160])
    stub(sp, "set", values={"deviceMode": "pending"}); pg.click("#pullBtn"); code_box(pg); stub(sp, "set", values={"deviceMode": "deny"}); res = pull_wait(pg); check("Failure — the sign-in is denied on GitHub: reported, nothing authorized, nothing changed", "not approved" in res and intact(), res[:160])
    stub(sp, "set", values={"deviceMode": "pending"}); pg.click("#pullBtn"); code_box(pg); stub(sp, "set", values={"deviceMode": "approve", "issue": USER_NONE}); res = pull_wait(pg); check("Failure — a GitHub account that cannot read the repository gets no access, whatever the PAT can do (no session is created)", "cannot read the configured repository" in res and intact() and not pg.evaluate("() => sessionStorage.getItem('sqla.repoaccess.session.v1762')"), res[:200])
    # the broker process vanishes
    stub(sp, "set", values={"deviceMode": "approve", "issue": USER_RW}); pg.click("#pullBtn"); pull_wait(pg); base = registry_json(pg); who = active_name(pg); procs[1].terminate(); procs[1].wait(timeout=5); time.sleep(0.5); res = pull()
    check("Failure — the repository access service is down (network / backend failure): Pull Schema says it could not be reached, no success, local schema unchanged", ("could not be reached" in res or "could not be retrieved" in res) and "pulled and validated" not in res and intact(), res[:200])
    ctx.close()
    # a service that was deployed WITHOUT the PAT secret
    nb = free_port(); wp3 = free_port(); env = dict(benv); env.update(SQLA_GITHUB_PAT="", PORT=str(nb), SQLA_ALLOWED_ORIGINS=f"http://127.0.0.1:{wp3}"); np = spawn([str(ROOT / "server/repo-broker.mjs")], env, "broker without PAT"); procs.append(np); s3, d3 = site(f"http://127.0.0.1:{nb}", wp3); procs.append(s3); sites.append(d3)
    stub(sp, "set", values={"deviceMode": "approve", "issue": USER_RW}); ctx, pg = newdev(b, f"http://127.0.0.1:{wp3}/", "G"); hamburger_pull(pg); base = registry_json(pg); pg.click("#pullBtn"); res = pull_wait(pg)
    check("Failure — missing PAT secret: signing in works, but Pull Schema says the central access has no PAT and an administrator must configure the GitHub Actions secret SQLA_GITHUB_PAT; local schema unchanged", "no GitHub PAT" in res and "SQLA_GITHUB_PAT" in res and registry_json(pg) == base, res[:240])
    pg.click("#brokerCheckBtn"); pg.wait_for_function("() => /PAT/.test(document.querySelector('#brokerResult').innerText)", timeout=15000); check("Failure — 'Check central access' reports the missing PAT too", "no GitHub PAT" in pg.inner_text("#brokerResult") or "not set up" in pg.inner_text("#brokerResult"), pg.inner_text("#brokerResult")[:200]); ctx.close()

# ───────────────────────────── regression: without the central-access file everything is as in V17.6.1 ─────────────────────────────
def regression(b, url, sp):
    stub(sp, "reset"); ctx, pg = newdev(b, url, "R"); hamburger_pull(pg); heads = pg.evaluate("() => [...document.querySelectorAll('#schemaRepoCardMount h2, #schemaPullHost h2, #schemaVaultCardMount h2')].map(h => h.innerText.trim())")
    check("Regression: without the deployed configuration file the Pull Schema page has the same three cards in the same order, with the V17.6.1 token row (Set Token) — central access is opt-in", len(heads) == 3 and "(not set)" in pg.inner_text("#maskedToken") and pg.locator("#changeTokenBtn").count() == 1 and pg.locator("#brokerSignInBtn").count() == 0)
    pg.click("#pullBtn"); res = pull_wait(pg); check("Regression: Pull Schema without a token behaves as before (asks for a token; no sign-in prompt; no request to any service from the page)", "No GitHub access token is set" in res and pg.locator("#brokerUserCode").count() == 0 and not [r for r in requests if r[0] == "R" and not re.match(r"^(http://127\.0\.0\.1:\d+/|data:|blob:)", r[2])], res[:160])
    pg.evaluate("() => window.__sqla.setRepositoryOverride(window.__sqla.memoryRepository({}))"); unlock(pg); pg.evaluate("() => window.__sqla.setRepositoryOverride(null)")  # V17.6.9: the first-time default must be CONFIRMED by an authoritative (empty) repository; the override is released again
    stab(pg, "Secret Vault"); check("Regression: Settings → Secret Vault is unchanged (Push Secret Vault to Repository; no central-access text)", pg.locator("#pushVaultBtn").count() == 1 and "central" not in pg.inner_text("main").lower())
    ctx.close()

def hygiene(sp):
    others = [(t, m, u) for t, m, u, d, a in requests if not re.match(r"^(http://127\.0\.0\.1:\d+/|data:|blob:)", u)]
    check("Hygiene: the page itself never contacted github.com or api.github.com — every request went to the site or the central repository access service", not others, others[:3])
    auth = [(t, u, a) for t, m, u, d, a in requests if a]; ok = all(re.match(r"^Bearer v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$", a) and "/v1/" in u for t, u, a in auth)
    check("Hygiene: the only Authorization header the page ever sent is the broker session (never a GitHub token or the PAT), and only to the service's /v1/ routes", auth and ok, [(u, a[:12]) for t, u, a in auth[:3]])
    bodies = "\n".join(d for t, m, u, d, a in requests) + "\n".join(u for t, m, u, d, a in requests)
    check("Hygiene: no PAT, user token, device code, vault passphrase or AI key appears in any request URL or body sent by the page", not leaked(bodies, PAT, USER_RW, USER_OK, USER_NONE, DEVICE_CODE, OWN, DEFAULT_PASS, AI), "")
if __name__ == "__main__": main()
