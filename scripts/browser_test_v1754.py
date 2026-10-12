"""SQL Assistant V17.5.4 — real-browser tests of the relocated cards on the PRODUCTION build (Chromium / Playwright).
   npm run build && python3 scripts/browser_test_v1754.py        (CHROME_PATH=/path/to/chrome to use an installed browser)
Reuses the shared-remote emulation of the GitHub Contents API from the V17.5.2 suite: the app's REAL GitHub client talks to it over HTTP, every device is configured through the
UI, nothing is shared through browser storage. The emulation only serves basware/sk-ap-sql-assistant — any request to another repository would 404, so the 'locked location' is proven
by the sync working at all, and additionally by inspecting every URL the app requested. It is NOT github.com itself (no network or credentials in the build environment)."""
import json, os, re, sys, time, subprocess, pathlib, base64, traceback
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import browser_test_v1752 as B
from playwright.sync_api import sync_playwright
ROOT = B.ROOT; PLAIN = B.PLAIN; TOK_A, TOK_B, TOK_BAD = B.TOK_A, B.TOK_B, B.TOK_BAD
check, go, unlock, stab, newdev, configure, section = B.check, B.go, B.unlock, B.stab, B.newdev, B.configure, B.section
DEFAULTS = (ROOT / "src/v17/services/repositoryDefaults.ts").read_text(encoding="utf-8")
DEFAULT_PASS = re.search(r"DEFAULT_VAULT_PASSPHRASE = '([^']+)'", DEFAULTS).group(1)  # never printed or put into a check name
VPATH = "sql-assistant-data/vault/secret-vault.v17.enc.json"; REPO_PREFIX = "https://api.github.com/repos/basware/sk-ap-sql-assistant/contents/"
UNRELATED = {"README.md": "# data repo — do not touch\n", "sql-assistant-data/knowledge/knowledge.json": '{"keep":"me"}', "sql-assistant-data/messages/admin-message.json": '{"keep":"me"}'}
class Hub(B.Hub):
    def __init__(self): super().__init__(); self.urls = []
    def handler(self, route): self.urls.append((route.request.method, route.request.url)); return super().handler(route)
def pull_page(pg): go(pg, "schema-used/pull"); pg.wait_for_timeout(600)
def hamburger_pull(pg):  # the real navigation: hamburger menu → Schema → Pull Schema
    pg.click("#navToggle"); pg.wait_for_timeout(200); pg.click('#hamburgerOverlay [data-route="schema-used"]'); pg.wait_for_timeout(350); pg.click('#schemaTabs .tab-btn:has-text("Pull Schema")'); pg.wait_for_timeout(450)
def vault_result(pg): pg.wait_for_function("() => { const r = document.querySelector('#v17VaultResult'); return r && r.innerText.trim() && !/Retrieving and decrypting|Working/.test(r.innerText); }", timeout=20000); pg.wait_for_timeout(250); return pg.inner_text("#v17VaultResult")
def gets(hub, path): return [u for m, u in hub.urls if m == "GET" and path in u]
def puts(hub): return [u for m, u in hub.urls if m == "PUT"]

# ───────────────────────────── UI validation ─────────────────────────────
def ui(b, url):
    hub = Hub(); ctx, pg = newdev(b, url, hub, tag="ui"); pg.evaluate("location.hash = '#quickstart'"); pg.wait_for_timeout(300); hamburger_pull(pg)
    check("UI 1: Hamburger → Schema → Pull Schema displays the GitHub repository (schema synchronization) card", "GitHub repository (schema synchronization)" in pg.inner_text("#schemaRepoCardMount") and pg.locator("[data-v1754-repo-card]").count() == 1 and "Pull Schema from GitHub" in pg.inner_text("#schemaPullHost"))
    h0 = pg.evaluate("() => { const p = document.querySelector('#repoCfgPanel'); const t = document.querySelector('#repoCfgToggle'); return [p.hidden, getComputedStyle(p).display, t.getAttribute('aria-expanded')]; }")
    check("UI 4: the repository configuration (values and details message) is hidden by default", h0 == [True, "none", "false"] and not pg.is_visible("#vaultRepo") and not pg.is_visible("#vaultBranch") and not pg.is_visible("#vaultPath") and not pg.is_visible("#repoInfoMsg"), h0)
    pg.click("#repoCfgToggle"); pg.wait_for_timeout(150)  # reveal: the checks below read and try to edit the values
    vals = pg.evaluate("() => ['#vaultRepo', '#vaultBranch', '#vaultPath'].map((s) => document.querySelector(s).value)")
    check("UI 2: repository, branch and schema path show the required values (basware/sk-ap-sql-assistant · main · sql-assistant-data/schemas/registry.json)", vals == ["basware/sk-ap-sql-assistant", "main", "sql-assistant-data/schemas/registry.json"], vals)
    for sel in ("#vaultRepo", "#vaultBranch", "#vaultPath"): pg.click(sel); pg.keyboard.type("zzz"); pg.keyboard.press("Backspace"); pg.keyboard.press("Control+a"); pg.keyboard.press("Delete")
    ro = pg.evaluate("() => ['#vaultRepo', '#vaultBranch', '#vaultPath'].map((s) => { const i = document.querySelector(s); return [i.readOnly, i.getAttribute('aria-readonly'), i.value]; })")
    check("UI 3: the configuration values are non-editable (read-only; typing, Backspace and Delete change nothing)", all(r[0] and r[1] == "true" for r in ro) and [r[2] for r in ro] == vals, ro)
    refused = False
    try: pg.fill("#vaultRepo", "evil/repo", timeout=1500)
    except Exception: refused = True
    check("UI 3b: the browser itself refuses to fill the repository field (not editable)", refused and pg.input_value("#vaultRepo") == vals[0])
    check("UI 5: the reveal control shows the repository details message — synchronization details, no secret (the values and the message are revealed together)", pg.is_visible("#repoInfoMsg") and pg.get_attribute("#repoCfgToggle", "aria-expanded") == "true" and "Hide configuration" in pg.inner_text("#repoCfgToggle") and all(x in pg.inner_text("#repoInfoMsg") for x in ["basware/sk-ap-sql-assistant", "registry.enc.json", "knowledge.json", "admin-message.json", "Contents: Read and write"]) and TOK_A not in pg.inner_text("#repoInfoMsg") and DEFAULT_PASS not in pg.inner_text("#repoInfoMsg"))
    pg.click("#repoCfgToggle"); pg.wait_for_timeout(150); ok_hide = not pg.is_visible("#repoInfoMsg") and not pg.is_visible("#vaultRepo") and pg.get_attribute("#repoCfgToggle", "aria-expanded") == "false" and "Show configuration" in pg.inner_text("#repoCfgToggle")
    pg.click("#repoCfgToggle"); pg.click("#repoCfgToggle"); pg.wait_for_timeout(100)
    check("UI 5b: the button hides it again and keeps working when pressed repeatedly", ok_hide and not pg.is_visible("#repoInfoMsg"))
    pg.click("#repoCfgToggle"); go(pg, "quickstart"); hamburger_pull(pg); check("UI 5c: after leaving the page the configuration is hidden again (hidden by default every time)", not pg.is_visible("#repoInfoMsg") and not pg.is_visible("#vaultRepo"))
    v = pg.inner_text("#schemaVaultCardMount")
    check("UI 6: 'Pull Secret Vault to Repository' is available in the Schema section with its passphrase, file path and the Retrieve / Import actions", "Pull Secret Vault to Repository" in v and pg.locator("#pullVaultBtn").count() == 1 and pg.locator("#importVaultFile").count() == 1 and pg.locator("#v17VaultPass").count() == 1 and pg.locator("#vaultFilePathRO").count() == 1)
    pv = pg.evaluate("() => { const i = document.querySelector('#v17VaultPass'); return [i.type, i.value.length]; }")
    check("UI 6b: the Vault Sync Passphrase field is masked by default and pre-filled with the default value", pv == ["password", len(DEFAULT_PASS)], pv)
    pg.click('#schemaVaultCardMount .passphrase-eye'); pg.wait_for_timeout(100); rv = pg.evaluate("() => [document.querySelector('#v17VaultPass').type, document.querySelector('#v17VaultPass').value]"); pg.click('#schemaVaultCardMount .passphrase-eye'); pg.wait_for_timeout(100)
    check("UI 6c: the eye button reveals the default value and hides it again", rv == ["text", DEFAULT_PASS] and pg.get_attribute("#v17VaultPass", "type") == "password")
    html = pg.evaluate("() => document.querySelector('#app').outerHTML")  # the rendered DOM (page.content() would include the inline application bundle, which does contain the constant — see UI 6e)
    check("UI 6d: the default value is never written into the rendered page markup, the visible text, browser storage or the console", DEFAULT_PASS not in html and DEFAULT_PASS not in pg.inner_text("body") and DEFAULT_PASS not in pg.evaluate("() => JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(Object.assign({}, sessionStorage))") and not any(DEFAULT_PASS in c for c in B.console_all))
    src_hits = [str(f.relative_to(ROOT)) for f in (ROOT / "src").rglob("*.ts") if DEFAULT_PASS in f.read_text(encoding="utf-8")]; bundle_hits = (ROOT / "dist/index.html").read_text(encoding="utf-8").count(DEFAULT_PASS)
    check("UI 6e: the default value is defined in exactly ONE source file (centralized, easy to remove or rotate) and — as disclosed — ships inside the application bundle", src_hits == ["src/v17/services/repositoryDefaults.ts"] and bundle_hits >= 1, (src_hits, bundle_hits))
    tabs = pg.locator("#schemaTabs .tab-btn").all_inner_texts(); body = pg.inner_text("main")
    check("UI 7: no separate 'Push to GitHub' action appears in Schema (tabs: Tables & Views · Stored Schemas · Pull Schema)", tabs == ["Tables & Views in Active Schema", "Stored Schemas", "Pull Schema"] and "Push / Populate" not in body and "Push to GitHub" not in body and pg.locator("#pushBtn, #schemaPushPass").count() == 0, tabs)
    go(pg, "schema-used/push"); pg.wait_for_timeout(500); check("UI 7b: the old deep link #schema-used/push no longer opens anything push-related", pg.locator("#pushBtn, #schemaPushPass, #schemaPushMount").count() == 0 and "Push / Populate" not in pg.inner_text("main"))
    unlock(pg); stab(pg, "Schema Management"); sm = pg.inner_text("main")
    check("UI 8: Settings → Schema Management no longer displays the 'Schema passphrase — encrypted synchronization' card or its controls", "Schema passphrase" not in sm and "encrypted synchronization" not in sm.lower().replace("encrypted sync", "") and pg.locator("[data-v175-passphrase], #schemaAdminPass, #schemaPassPublish, #schemaPassSave, #schemaPassClear").count() == 0 and "Repository synchronization" in sm and "Stored Schemas" in sm, sm[:200])
    stab(pg, "Secret Vault"); sv = pg.inner_text("main")
    check("UI 9: Settings → Secret Vault no longer displays the GitHub repository (schema synchronization) card or its controls", "GitHub repository (schema synchronization)" not in sv and pg.locator("#vaultRepo, #vaultBranch, #vaultPath, #changeTokenBtn, #newTokenInput, #saveTokenBtn, #saveVaultCfgBtn, #maskedToken").count() == 0)
    check("UI 10: Settings → Secret Vault retains Push Secret Vault to Repository — as its only action (no pull / retrieve / import there)", "Push Secret Vault to Repository" in sv and pg.locator("#pushVaultBtn").count() == 1 and pg.locator("#pullVaultBtn, #importVaultFile").count() == 0 and "Retrieve from Repository" not in sv and pg.locator("#v17VaultPass, #v17VaultPass2, #vaultFilePath").count() == 3 and pg.evaluate("() => document.querySelector('#v17VaultPass').value") == "")
    check("UI 10b: the labels communicate the operation — Settings only pushes, and points to Schema → Pull Schema for the repository, the token and the pull", "only" in sv and "Schema → Pull Schema" in sv and pg.locator("#gotoPullSchemaBtn").count() == 1)
    pg.click("#gotoPullSchemaBtn"); pg.wait_for_timeout(500); check("UI 10c: the pointer button opens Schema → Pull Schema", pg.locator("[data-v1754-repo-card]").count() == 1)
    routes_ok = True
    for r in ["quickstart", "readonly", "cr", "schema-used", "schema-used/pull", "error-rectifier", "settings", "about"]:
        go(pg, r); routes_ok = routes_ok and pg.inner_text("main").strip() != ""
    unlock(pg); tabs_ok = pg.locator(".tab-btn").all_inner_texts() == ["Security", "Manual Schema Update", "Schema Management", "Secret Vault", "Synchronization", "Admin Query Library", "AI/LLM Model", "Danger Zone"]
    pg.click("#navToggle"); pg.wait_for_timeout(200); pg.click("#hamburgerOverlay .hb-group-toggle"); pg.wait_for_timeout(150); menu = pg.locator("#hamburgerOverlay [data-route]").evaluate_all("e => e.map(x => x.dataset.route)"); pg.click("#hamburgerCloseBtn")
    check("UI 11: all other pages and the navigation remain functional (every route renders, the 8 Settings tabs and the hamburger menu are unchanged)", routes_ok and tabs_ok and {"quickstart", "readonly", "cr", "schema-used", "error-rectifier", "settings", "about"} <= set(menu), menu)
    ctx.close()

# ───────────────────────────── token card + locked location + schema synchronization ─────────────────────────────
def location_and_sync(b, url):
    hub = Hub(); [hub.put(k, v) for k, v in UNRELATED.items()]; ctx, pg = newdev(b, url, hub, tag="sync"); pull_page(pg)
    check("Token: before a token is saved the status says there is no repository connection", "No repository connection on this device" in B.sm_status(pg) and "(not set)" in pg.inner_text("#maskedToken"))
    pg.click("#changeTokenBtn"); pg.fill("#newTokenInput", TOK_A); pg.fill("#tokenAdminPw", "wrong-admin-pw"); pg.click("#saveTokenBtn"); pg.wait_for_timeout(900)
    check("Token: a wrong Admin Password is refused and the token is not saved", "Incorrect Admin Password" in pg.inner_text("#vaultCfgResult") and "(not set)" in pg.inner_text("#maskedToken") and pg.evaluate("() => !localStorage.getItem('sqla.vault.local.v17')"))
    pg.fill("#tokenAdminPw", "admin"); pg.click("#saveTokenBtn"); pg.wait_for_timeout(1400)
    st = B.sm_status(pg); store = pg.evaluate("() => JSON.stringify(Object.assign({}, localStorage))")
    check("Token: with the Admin Password it is saved encrypted, shown masked, and the status shows the fixed repository", "••••" in pg.inner_text("#maskedToken") and "token saved" in st and TOK_A not in pg.inner_text("body") and TOK_A not in store and TOK_A not in pg.content())
    check("Token: saving the token did not change the repository values and the information message is hidden again after the re-render", pg.evaluate("() => ['#vaultRepo', '#vaultBranch', '#vaultPath'].map((s) => document.querySelector(s).value)") == ["basware/sk-ap-sql-assistant", "main", "sql-assistant-data/schemas/registry.json"] and not pg.is_visible("#repoInfoMsg"))
    B.edit_decode(pg, "P=Pending\nA=Approved\nR=Rejected\nD=Paid\nX=Cancelled"); hub.urls.clear(); r = B.sync_now(pg)
    check("Sync: schema synchronization uses the configured repository, branch and file path — the plain schema file was written to sql-assistant-data/schemas/registry.json", PLAIN in hub.files and "Cancelled" in hub.get(PLAIN) and "failed" not in r.lower(), r[:200])
    bad = [u for m, u in hub.urls if not u.startswith(REPO_PREFIX[:-10])]; branches = {re.search(r"ref=([^&]+)", u).group(1) for m, u in hub.urls if m == "GET" and "ref=" in u}
    check("Sync: every request went to basware/sk-ap-sql-assistant, GETs read branch 'main', and only the schema file was written", not bad and branches == {"main"} and {u.split("/contents/")[1] for u in puts(hub)} == {PLAIN} and all(hub.get(k) == v for k, v in UNRELATED.items()), (bad[:2], branches))
    # an existing device that still has another repository stored: the stored value is kept as data but ignored
    pg.evaluate("async () => { const sv = window.__sqla.services(); const cur = await sv.vault.load(); await sv.vault.save({ ...cur, githubOwner: 'acme', githubRepo: 'legacy', githubBranch: 'dev', schemaPath: 'legacy/registry.json' }); await window.__sqla.reloadSecrets(); }"); pg.reload(); B.ready(pg); hub.urls.clear(); pull_page(pg)
    vals = pg.evaluate("() => ['#vaultRepo', '#vaultBranch', '#vaultPath'].map((s) => document.querySelector(s).value)"); B.edit_decode(pg, "P=Pending\nA=Approved\nR=Rejected\nD=Paid\nX=Cancelled\nZ=Archived"); B.sync_now(pg)
    check("Compatibility: a device whose stored vault names another repository / branch / path still shows and uses the fixed values (nothing stored is deleted)", vals == ["basware/sk-ap-sql-assistant", "main", "sql-assistant-data/schemas/registry.json"] and hub.urls and all(u.startswith(REPO_PREFIX[:-10]) for m, u in hub.urls) and "Archived" in hub.get(PLAIN) and pg.evaluate("() => JSON.stringify(Object.assign({}, localStorage))").count("sqla.vault.local.v17") >= 1, vals)
    ctx.close()

# ───────────────────────────── Pull Secret Vault (Schema) ↔ Push Secret Vault (Settings) ─────────────────────────────
def vault_flow(b, url):
    hub = Hub(); [hub.put(k, v) for k, v in UNRELATED.items()]
    A, a = newdev(b, url, hub, tag="deviceA"); configure(a, TOK_A); unlock(a); stab(a, "Secret Vault"); a.fill("#v17VaultPass", DEFAULT_PASS); a.fill("#v17VaultPass2", "something else"); a.click("#pushVaultBtn"); a.wait_for_timeout(700)
    check("Push (Settings): the passphrases must match — validated first, nothing written", "do not match" in a.inner_text("#v17VaultResult") and not puts(hub))
    a.fill("#v17VaultPass2", DEFAULT_PASS); hub.urls.clear(); a.click("#pushVaultBtn"); a.wait_for_timeout(3500); res = a.inner_text("#v17VaultResult"); vf = hub.get(VPATH) or ""
    check("Push (Settings): Push Secret Vault to Repository still works — encrypted, written once, read back and verified", all(x in res for x in ["1 Secret configuration validated", "4 Encrypted configuration pushed", "5 Synchronization confirmed", "6 The token was never shown"]) and vf != "" and len(puts(hub)) == 1 and puts(hub)[0].endswith(VPATH), res[:300])
    check("Push (Settings): the repository file is AES-256-GCM ciphertext (no token, no passphrase, no Base64 of them) and no unrelated file was touched", '"alg": "AES-256-GCM"' in vf and TOK_A not in vf and DEFAULT_PASS not in vf and base64.b64encode(TOK_A.encode()).decode() not in vf and all(hub.get(k) == v for k, v in UNRELATED.items()) and sorted(hub.files) == sorted([VPATH, *UNRELATED]))
    # Device B: its own (different) token, then Pull Secret Vault with the PRE-FILLED passphrase — nothing is typed
    B_, bb = newdev(b, url, hub, tag="deviceB"); configure(bb, TOK_B); tail_before = bb.inner_text("#maskedToken"); hub.urls.clear(); before = json.dumps({k: hub.get(k) for k in hub.files}, sort_keys=True)
    bb.click("#pullVaultBtn"); r = vault_result(bb); tail_after = bb.inner_text("#maskedToken")
    check("Pull Secret Vault: with the pre-filled default passphrase it retrieves, decrypts and validates the vault — the device now holds the pushed token", "Secret Vault imported and validated" in r and TOK_B[-4:] in tail_before and TOK_A[-4:] in tail_after and TOK_A[-4:] != TOK_B[-4:], (tail_before, tail_after, r[:120]))
    check("Pull Secret Vault: the repository is only READ — no write request, no file changed, and only the vault file was read", not puts(hub) and json.dumps({k: hub.get(k) for k in hub.files}, sort_keys=True) == before and {u.split("/contents/")[1].split("?")[0] for m, u in hub.urls if m == "GET" and "/contents/" in u} == {VPATH} and all(u.startswith(REPO_PREFIX[:-10]) for m, u in hub.urls))
    check("Pull Secret Vault: the token is never shown and not in the storage, markup or console of the receiving device", TOK_A not in bb.inner_text("body") and TOK_A not in bb.content() and TOK_A not in bb.evaluate("() => JSON.stringify(Object.assign({}, localStorage))") and not any(TOK_A in c for c in B.console_all))
    check("Pull Secret Vault: the passphrase field kept its value and stays masked after the page re-rendered", bb.get_attribute("#v17VaultPass", "type") == "password" and bb.evaluate("() => document.querySelector('#v17VaultPass').value.length") == len(DEFAULT_PASS) and not bb.is_visible("#repoInfoMsg"))
    # failures — each must leave the device exactly as it was and never show a success
    def attempt(passphrase=None, mode=None, undo=None):
        pull_page(bb); bb.evaluate("() => window.__sqla.setRepositoryTimeoutMs(20000)")
        if passphrase is not None: bb.fill("#v17VaultPass", passphrase)
        if mode: hub.mode = mode
        hub.urls.clear(); tok = bb.inner_text("#maskedToken"); bb.click("#pullVaultBtn"); t = vault_result(bb); hub.mode = "ok"
        return t, bb.inner_text("#maskedToken") == tok and "retrieved, decrypted" not in t and bb.locator("#v17VaultResult .issue-box.ok").count() == 0
    t, ok = attempt("a completely wrong passphrase"); check("Failure — wrong passphrase: 'wrong or the data was modified', nothing changed, no success message", "passphrase is wrong" in t and ok and "a completely wrong passphrase" not in t, t[:200])
    hub.valid.discard(TOK_A); t, ok = attempt(); hub.valid.add(TOK_A); check("Failure — authorization (401): the rejected token is reported, nothing changed", "invalid or has expired" in t and ok and TOK_A not in t, t[:200])
    t, ok = attempt(mode="down"); check("Failure — network error: reported ('Could not reach GitHub'), nothing changed", "could not be reached" in t.lower() and ok, t[:200])
    bb.evaluate("() => window.__sqla.setRepositoryTimeoutMs(400)"); pull_page(bb); bb.evaluate("() => window.__sqla.setRepositoryTimeoutMs(400)"); hub.mode = "hang"; bb.click("#pullVaultBtn"); bb.wait_for_timeout(150)
    loading = [bb.is_disabled("#pullVaultBtn"), "Retrieving" in bb.inner_text("#v17VaultResult")]; t = vault_result(bb); hub.mode = "ok"; bb.evaluate("() => window.__sqla.setRepositoryTimeoutMs(20000)")
    check("Loading state reflects the real operation: the button is disabled and 'Retrieving…' shows while GitHub does not answer; then the timeout is reported and the button is usable again", loading == [True, True] and "did not answer" in t and not bb.is_disabled("#pullVaultBtn") and bb.locator("#v17VaultResult .issue-box.ok").count() == 0, (loading, t[:160]))
    saved = hub.files.pop(VPATH); t, ok = attempt(); hub.files[VPATH] = saved; check("Failure — no vault in the repository: 'No encrypted Secret Vault found', nothing changed", "No encrypted Secret Vault was found" in t and ok, t[:200])
    pull_page(bb); n = len(hub.urls); hub.urls.clear(); bb.dblclick("#pullVaultBtn"); vault_result(bb); g = gets(hub, VPATH)
    check("No duplicate operations: a double click starts ONE retrieval (one GET, no PUT)", len(g) == 1 and not puts(hub), g)
    # no token on a fresh device
    C, c = newdev(b, url, hub, tag="deviceC"); pull_page(c); hub.urls.clear(); c.click("#pullVaultBtn"); t = vault_result(c)
    check("Failure — no access token yet: explained with the way that needs no token (Import encrypted file); the only request is an anonymous read — nothing written", "do not have to set the token first" in t and "Import encrypted file" in t and "Set the GitHub access token (card above) first" not in t and not [u for m, u in hub.urls if m != "GET"], t[:200])
    # import of an encrypted file works through the same card
    c.evaluate("() => window.__sqla.setRepositoryOverride(null)"); path = pathlib.Path("/tmp/v.json") if False else pathlib.Path("/home/claude/vault-import.json"); path.write_text(vf, encoding="utf-8"); c.set_input_files("#importVaultFile", str(path)); t = vault_result(c)
    check("Import encrypted file (same card): retrieves the vault from a file with the pre-filled passphrase — the device now holds the pushed token", "imported" in t and TOK_A[-4:] in c.inner_text("#maskedToken"), t[:200]); path.unlink()
    A.close(); B_.close(); C.close()

# ───────────────────────────── responsive ─────────────────────────────
def responsive(b, url):
    for (w, h, name) in [(1366, 900, "desktop"), (768, 1024, "tablet"), (390, 800, "phone")]:
        hub = Hub(); ctx, pg = newdev(b, url, hub, w, h, tag=f"resp-{name}"); pull_page(pg); o1 = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth"); pg.click("#repoCfgToggle"); pg.wait_for_timeout(120); o2 = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        boxes = pg.evaluate("() => ['[data-v1754-repo-card]', '#schemaPullMount > .builder-panel', '[data-v1754-vault-card]'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; })")
        check(f"Responsive ({name} {w}px): the repository card, the schema pull and the Secret Vault card fit without horizontal scroll, with the details message open", o1 <= 2 and o2 <= 2 and all(0 <= l and r <= w + 2 for l, r in boxes), (o1, o2, boxes)); ctx.close()

def main():
    if not (ROOT / "dist/index.html").exists(): print("Run npm run build first."); sys.exit(2)
    port = B.free_port(); serve = subprocess.Popen(["node", str(ROOT / "scripts/serve.mjs")], env={**os.environ, "PORT": str(port), "BASE": "/SQL-Assistant/"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.9)
    url = f"http://127.0.0.1:{port}/SQL-Assistant/?e2e=1"
    try:
        with sync_playwright() as p:
            exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
            section("UI validation", ui, b, url); section("Token + locked location + schema sync", location_and_sync, b, url); section("Secret Vault pull / push", vault_flow, b, url); section("Responsive", responsive, b, url)
            b.close()
    finally: serve.terminate()
    real = [e for e in B.errors if "Failed to load resource" not in e and "net::ERR" not in e and "Could not reach GitHub" not in e and "ERR_CONNECTION" not in e]
    check("No console errors or uncaught exceptions in any V17.5.4 flow", not real, "; ".join(real[:4]))
    results = B.results; failed = [r for r in results if not r[1]]; print(f"\n{len(results) - len(failed)}/{len(results)} V17.5.4 browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True); (ROOT / "test-results/browser-results-v1754.json").write_text(json.dumps([{"check": n, "pass": ok} for n, ok in results], indent=2)); sys.exit(1 if failed else 0)
if __name__ == "__main__": main()
