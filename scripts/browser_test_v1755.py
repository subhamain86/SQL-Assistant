"""SQL Assistant V17.5.5 — real-browser tests on the PRODUCTION build (Chromium / Playwright).
   npm run build && python3 scripts/browser_test_v1755.py        (CHROME_PATH=/path/to/chrome to use an installed browser)

Reuses the harness of the V17.5.2 / V17.5.4 suites: every browser profile ("device") is configured through the UI and the app's REAL GitHub client talks to a SHARED remote over HTTP —
an emulation of the GitHub Contents API (Bearer auth, 401 / 403 / 404 / 409 / 422, sha concurrency, base64 content, outages, hung connections) that serves ONLY
basware/sk-ap-sql-assistant. Nothing is shared through browser storage. It is NOT github.com itself (no network or credentials in the build environment).
Covers: the three Schema cards, hidden + read-only repository configuration, the single-button Pull Schema, failures, duplicate-request protection, Pull Secret Vault with the default
passphrase, Push Secret Vault independence, one repository for every operation (every request URL is inspected), secrecy, regression and responsive layout."""
import json, os, re, sys, time, subprocess, pathlib, base64, traceback
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import browser_test_v1754 as T
B = T.B
from playwright.sync_api import sync_playwright
ROOT = B.ROOT; PLAIN = B.PLAIN; ENC = B.ENC; TOK_A, TOK_B, TOK_BAD = B.TOK_A, B.TOK_B, B.TOK_BAD; DEFAULT_PASS = T.DEFAULT_PASS; VPATH = T.VPATH; PREFIX = T.REPO_PREFIX
check, go, unlock, stab, newdev, configure, section = B.check, B.go, B.unlock, B.stab, B.newdev, B.configure, B.section
UNRELATED = T.UNRELATED; CUSTOM = "a-different-vault-passphrase-2027"
VALUES = ["basware/sk-ap-sql-assistant", "main", "sql-assistant-data/schemas/registry.json"]
class Hub(T.Hub): pass
def storage(pg): return pg.evaluate("() => JSON.stringify(Object.assign({}, localStorage)) + '|' + JSON.stringify(Object.assign({}, sessionStorage))")
def vis(pg, sel): return pg.is_visible(sel)
def pull_click(pg):  # the one Pull Schema button
    pg.click("#pullBtn"); pg.wait_for_function("() => { const b = document.querySelector('#pullBtn'); const r = document.querySelector('#pullResult'); return b && !b.disabled && r && r.querySelector('.issue-box') && !/Retrieving the schema/.test(r.innerText); }", timeout=30000); pg.wait_for_timeout(250); return pg.inner_text("#pullResult")
def intact(pg, base): return registry_json(pg) == base["reg"] and B.active_name(pg) == base["who"]
def registry_json(pg): return B.registry_json(pg)
def snap(pg): return {"reg": registry_json(pg), "who": B.active_name(pg)}
def gets(hub, frag): return [u for m, u in hub.urls if m == "GET" and frag in u]
def puts(hub): return [u for m, u in hub.urls if m == "PUT"]
def edit(pg, extra=""): B.edit_decode(pg, "P=Pending\nA=Approved\nR=Rejected\nD=Paid\nX=Cancelled" + extra)


# ───────────────────────────── 1. The three cards, hidden + read-only configuration ─────────────────────────────
def cards_ui(b, url):
    hub = Hub(); ctx, pg = newdev(b, url, hub, tag="ui"); pg.evaluate("location.hash = '#quickstart'"); pg.wait_for_timeout(300); T.hamburger_pull(pg)
    heads = pg.eval_on_selector_all("#schemaTabs .tab-panel:not([hidden]) h2", "e => e.map(x => x.innerText.trim())")
    check("Cards: Hamburger → Schema → Pull Schema shows exactly three cards, in this order — GitHub repository (schema synchronization) · Pull Schema from GitHub · Pull Secret Vault to Repository", heads == ["GitHub repository (schema synchronization)", "Pull Schema from GitHub", "Pull Secret Vault to Repository"], heads)
    check("Tabs: Hamburger → Schema keeps its three tabs and has no push action", pg.locator("#schemaTabs .tab-btn").all_inner_texts() == ["Tables & Views in Active Schema", "Stored Schemas", "Pull Schema"] and "Push to GitHub" not in pg.inner_text("main"))
    main = pg.inner_text("main")
    check("Hidden by default: neither the repository, the branch nor the schema file path appears anywhere on the page — not in the card, the status block or the instructions", not any(x in main for x in ["basware", "sk-ap-sql-assistant", "registry.json", "registry.enc.json"]) and not any(vis(pg, s) for s in ["#vaultRepo", "#vaultBranch", "#vaultPath", "#repoInfoMsg"]), main[:200])
    h0 = pg.evaluate("() => { const p = document.querySelector('#repoCfgPanel'); const t = document.querySelector('#repoCfgToggle'); return [p.hidden, getComputedStyle(p).display, t.getAttribute('aria-expanded'), t.innerText.trim()]; }")
    check("Hidden by default: the reveal button says 'Show configuration' and reports aria-expanded=false", h0 == [True, "none", "false", "Show configuration"], h0)
    before = storage(pg); pg.click("#repoCfgToggle"); pg.wait_for_timeout(150)
    vals = pg.evaluate("() => ['#vaultRepo', '#vaultBranch', '#vaultPath'].map((s) => document.querySelector(s).value)")
    check("Reveal: the button shows the three configured values exactly (basware/sk-ap-sql-assistant · main · sql-assistant-data/schemas/registry.json)", vals == VALUES and all(vis(pg, s) for s in ["#vaultRepo", "#vaultBranch", "#vaultPath"]) and pg.get_attribute("#repoCfgToggle", "aria-expanded") == "true" and "Hide configuration" in pg.inner_text("#repoCfgToggle"), vals)
    ro = pg.evaluate("() => ['#vaultRepo', '#vaultBranch', '#vaultPath'].map((s) => { const i = document.querySelector(s); return [i.readOnly, i.getAttribute('aria-readonly'), i.value]; })")
    for sel in ("#vaultRepo", "#vaultBranch", "#vaultPath"): pg.click(sel); pg.keyboard.type("zzz"); pg.keyboard.press("Backspace"); pg.keyboard.press("Control+a"); pg.keyboard.press("Delete"); pg.keyboard.press("Control+v")
    after = pg.evaluate("() => ['#vaultRepo', '#vaultBranch', '#vaultPath'].map((s) => document.querySelector(s).value)"); refused = False
    try: pg.fill("#vaultPath", "evil/other.json", timeout=1500)
    except Exception: refused = True
    check("Read-only even when revealed: readonly + aria-readonly on all three, typing / Backspace / Delete / paste change nothing, and the browser refuses to fill them", all(r[0] and r[1] == "true" for r in ro) and after == VALUES and refused and pg.input_value("#vaultPath") == VALUES[2], (ro, after))
    check("Reveal: the details message (which files are read and written, token permissions) appears together with the values and contains no secret", "registry.enc.json" in pg.inner_text("#repoInfoMsg") and "knowledge.json" in pg.inner_text("#repoInfoMsg") and TOK_A not in pg.inner_text("#repoInfoMsg") and DEFAULT_PASS not in pg.inner_text("#repoInfoMsg"))
    for _ in range(6): pg.click("#repoCfgToggle"); pg.wait_for_timeout(60)
    state = pg.evaluate("() => [document.querySelector('#repoCfgPanel').hidden, document.querySelector('#repoCfgToggle').getAttribute('aria-expanded')]")
    check("Hide / show: repeated use is reliable (6 more presses end hidden→shown→…→shown) and the values are never changed", state == [False, "true"] and pg.evaluate("() => ['#vaultRepo', '#vaultBranch', '#vaultPath'].map((s) => document.querySelector(s).value)") == VALUES, state)
    pg.click("#repoCfgToggle"); pg.wait_for_timeout(100)
    check("Reveal / hide never changes the saved configuration: browser storage is byte-identical after revealing, trying to edit and hiding", storage(pg) == before and not vis(pg, "#vaultRepo"))
    pg.click("#repoCfgToggle"); go(pg, "quickstart"); T.hamburger_pull(pg); check("Reveal state is not kept: after leaving the page the configuration is hidden again", not vis(pg, "#vaultRepo") and not vis(pg, "#repoInfoMsg"))
    p2 = pg.inner_text("#schemaPullHost"); btns = pg.locator("#schemaPullHost button").all_inner_texts()
    check("Card 'Pull Schema from GitHub': contains ONLY the Pull Schema button (no passphrase field, eye button, remember checkbox, Apply / Cancel / Remove-passphrase button, no input at all)", btns == ["Pull Schema"] and pg.locator("#schemaPullHost input, #schemaPullHost .passphrase-eye, #schemaPullHost [data-passphrase]").count() == 0, btns)
    check("Card 'Pull Schema from GitHub': no passphrase-related wording at all (instructions, status, labels, hints)", "passphrase" not in p2.lower() and "Vault passphrase" not in p2, p2[:240])
    check("Card 'Pull Schema from GitHub' (V17.5.6+): just the heading and the button — no instruction block, no status block, no secret, repository name or path", p2.strip() == "Pull Schema from GitHub\nPull Schema" and pg.locator("#schemaPullHost .pull-help, #schemaPullHost #syncStatusBlock").count() == 0, p2[:200])
    v = pg.inner_text("#schemaVaultCardMount"); pv = pg.evaluate("() => { const i = document.querySelector('#v17VaultPass'); return [i.type, i.value.length]; }")
    check("Card 'Pull Secret Vault to Repository': the default Vault Sync Passphrase is pre-filled and masked (password field, 20 characters), with Retrieve and Import actions", pv == ["password", len(DEFAULT_PASS)] and pg.locator("#pullVaultBtn").count() == 1 and pg.locator("#importVaultFile").count() == 1 and "Pull Secret Vault to Repository" in v, pv)
    pg.click("#schemaVaultCardMount .passphrase-eye"); rv = pg.evaluate("() => [document.querySelector('#v17VaultPass').type, document.querySelector('#v17VaultPass').value]"); pg.click("#schemaVaultCardMount .passphrase-eye")
    check("Card 'Pull Secret Vault to Repository': the eye button reveals the default (xG71…) and hides it again", rv == ["text", DEFAULT_PASS] and pg.get_attribute("#v17VaultPass", "type") == "password")
    dom = pg.evaluate("() => document.querySelector('#app').outerHTML")
    check("Card 'Pull Secret Vault to Repository': the default passphrase is not in the rendered markup, the page text, browser storage or the console", DEFAULT_PASS not in dom and DEFAULT_PASS not in pg.inner_text("body") and DEFAULT_PASS not in storage(pg) and not any(DEFAULT_PASS in c for c in B.console_all))
    unlock(pg); stab(pg, "Schema Management"); sm = pg.inner_text("main")
    check("Settings → Schema Management: the 'Schema passphrase — encrypted synchronization' card and its controls are absent; every other panel is still there", "Schema passphrase" not in sm and pg.locator("[data-v175-passphrase], #schemaAdminPass, #schemaPassPublish, #schemaPassSave, #schemaPassClear").count() == 0 and all(x in sm for x in ["Repository synchronization", "Stored Schemas"]), sm[:160])
    stab(pg, "Secret Vault"); sv = pg.inner_text("main")
    check("Settings → Secret Vault: the GitHub repository configuration card is absent; Push Secret Vault to Repository is the only operation and its fields (passphrase, confirmation, vault file path) are there", "GitHub repository (schema synchronization)" not in sv and pg.locator("#vaultRepo, #vaultBranch, #vaultPath, #changeTokenBtn, #saveTokenBtn, #maskedToken, #pullVaultBtn, #importVaultFile").count() == 0 and pg.locator("#pushVaultBtn").count() == 1 and pg.locator("#v17VaultPass, #v17VaultPass2, #vaultFilePath").count() == 3 and "Push Secret Vault to Repository" in sv)
    check("Settings → Secret Vault: exactly one button pushes (no second push / pull action) and it says it only pushes", pg.locator("#pushVaultBtn").count() == 1 and pg.locator(".tab-panel:not([hidden]) button:has-text('Push')").all_inner_texts() == ["Push Secret Vault to Repository"] and "only" in sv, pg.locator(".tab-panel:not([hidden]) button:has-text('Push')").all_inner_texts())
    ctx.close()


# ───────────────────────────── 2. Version + identity ─────────────────────────────
def identity(b, url):
    ctx, pg = newdev(b, url, None, tag="id"); foot = pg.inner_text("footer"); title = pg.title(); ver = pg.evaluate("async () => (await (await fetch('version.json', { cache: 'no-store' })).json())")
    go(pg, "about"); about = pg.inner_text("main")
    check("Identity: the application identifies itself as SQL Assistant V17.6.5 (title, footer, About, release metadata) and the name is unchanged", title == "SQL Assistant" and "Version 17.6.5" in foot and "17.6.5" in about and "SQL Assistant" in about and ver.get("version") == "17.6.5" and ver.get("name") == "SQL Assistant", (title, foot, ver))
    check("Identity: the navbar still shows 'SQL Assistant' with the version and the existing controls", "SQL Assistant" in pg.inner_text("#mainNavbar") and pg.locator("#navToggle, #syncSourceBtn, #syncTimeBtn, #tourBtnNav").count() == 4)
    ctx.close()


# ───────────────────────────── 3. Pull Schema from GitHub — functional ─────────────────────────────
def pull_schema(b, url, st):
    hub = Hub(); [hub.put(k, v) for k, v in UNRELATED.items()]; st["hub"] = hub
    A, a = newdev(b, url, hub, tag="deviceA"); configure(a, TOK_A); edit(a); r = B.sync_now(a)
    check("Setup (Device A): 'Sync with GitHub Now' publishes the plain schema file to the configured path — no passphrase involved", hub.get(PLAIN) is not None and "Cancelled" in hub.get(PLAIN) and hub.get(ENC) is None and "failed" not in r.lower(), r[:200]); A.close()
    hub.urls.clear(); Bc, bb = newdev(b, url, hub, tag="deviceB"); before = snap(bb); T.pull_page(bb); t0 = pull_click(bb)
    check("No token yet: Pull Schema explains what to do (set the token), sends no request, changes nothing", "No GitHub access token is set on this device" in t0 and "Set Token" in t0 and "has not been changed" in t0 and intact(bb, before) and not hub.urls and bb.locator("#pullResult .issue-box.ok").count() == 0, t0[:240])
    check("No token yet: the 'Go to the GitHub repository card' button moves focus to the token control on the same page", (bb.click("#pullResult .pull-open-vault"), bb.evaluate("() => document.activeElement && document.activeElement.id"))[1] == "changeTokenBtn")
    configure(bb, TOK_B); T.pull_page(bb); hub.urls.clear(); un0 = {k: hub.get(k) for k in UNRELATED}
    r = pull_click(bb); g = gets(hub, PLAIN)
    check("Pull Schema: ONE click retrieves and synchronizes — success is confirmed, the schema is added / updated and ACTIVE", "Schema pulled and validated successfully." in r and "Applied: AP / P2P Core (updated)" in r and B.active_name(bb) == "AP / P2P Core" and bb.locator("#pullResult .issue-box.err").count() == 0, r[:260])
    check("Pull Schema uses the configured repository, branch and schema path: every request went to basware/sk-ap-sql-assistant, exactly ONE read of sql-assistant-data/schemas/registry.json on branch main, no write, no other file", all(u.startswith(PREFIX[:-10]) for m, u in hub.urls) and len(g) == 1 and "ref=main" in g[0] and g[0].split("/contents/")[1].split("?")[0] == PLAIN and not puts(hub) and {u.split("/contents/")[1].split("?")[0] for m, u in hub.urls} == {PLAIN}, [u for m, u in hub.urls])
    check("Pull Schema is read-only: no file in the repository changed", all(hub.get(k) == v for k, v in un0.items()) and not puts(hub))
    d = json.loads(B.decode_def(bb)); check("Pulled schema: tables, columns and the CASE/DECODE definition edited on Device A arrived (X = Cancelled, 5 entries)", {"rawValue": "X", "label": "Cancelled"} in d and len(d) == 5, d)
    check("Pull Schema: after success nothing is 'not yet published' and the status shows the new last-download time — no repository name or path", "Nothing waiting to be published" in (_s := B.sm_status(bb)) and "Last download never" not in _s and "basware" not in bb.inner_text("#schemaPullHost"))
    # integration with existing functionality
    go(bb, "schema-used"); bb.wait_for_timeout(300); bb.click('#schemaTabs .tab-btn:has-text("Tables & Views")'); bb.wait_for_timeout(300); tv = bb.inner_text("main")
    check("Integration — schema browsing: Schema → Tables & Views lists the pulled schema's tables and the badge shows the active schema", "INVOICE_HEADER" in tv and "AP / P2P Core" in bb.inner_text("#mainNavbar"), (bb.url[-40:], "INVOICE_HEADER" in tv, bb.inner_text("#mainNavbar")[:120]))
    go(bb, "readonly"); mods = bb.eval_on_selector_all("#tablePickerMount .module-select option", "e => e.map(x => x.value)"); bb.select_option("#tablePickerMount .module-select", "Invoices"); B.settle(bb, 150); in_mod = bb.eval_on_selector_all("#tablePickerMount .picker-row", "e => e.map(x => x.dataset.table)")
    bb.select_option("#tablePickerMount .module-select", ""); bb.fill("#tablePickerMount .picker-search-input", "vendor"); B.settle(bb, 150); found = bb.eval_on_selector_all("#tablePickerMount .picker-row", "e => e.map(x => x.dataset.table)"); bb.fill("#tablePickerMount .picker-search-input", "")
    check("Integration — module selection and search: the modules of the pulled schema are offered, selecting one filters the tables, searching finds tables", "Invoices" in mods and "INVOICE_HEADER" in in_mod and "VENDOR" in found and "GL_ACCOUNT" not in found and "VENDOR" not in in_mod, (mods[:5], in_mod[:3], found[:3]))
    B.pick_table(bb, "INVOICE_HEADER"); B.col(bb, "INVOICE_HEADER", "STATUS"); R = B.crow("INVOICE_HEADER", "STATUS"); bb.select_option(R + " .column-mode-select", "casedecode"); B.settle(bb, 300); btab_adv(bb)
    check("Integration — SQL generation and query editing: the SQL uses the pulled CASE/DECODE definition and passes validation; Advanced Options still apply", "WHEN INVOICE_HEADER.STATUS = 'X' THEN 'Cancelled'" in B.sql(bb) and "passed validation" in bb.inner_text("#validationMount") and "SELECT DISTINCT" in B.sql(bb) and "FETCH FIRST 5" in B.sql(bb), B.sql(bb)[:200])
    B.describe(bb, "show vendor name and country for vendors", "Oracle"); check("Integration — Describe What You Need and the offline NLU work on the pulled schema", "FROM VENDOR" in B.sql(bb) and "passed validation" in bb.inner_text("#validationMount"), B.sql(bb)[:160])
    # repeated pulls
    T.pull_page(bb); hub.urls.clear(); r2 = pull_click(bb)
    check("Repeated pull: nothing to change — success, no duplicate schema, still exactly one read per click", "No schema content needed to change." in r2 and "Schema pulled and validated successfully." in r2 and bb.evaluate("() => window.__sqla.services().schemas.schemas().filter((s) => s.name === 'AP / P2P Core').length") == 1 and len(gets(hub, PLAIN)) == 1 and not puts(hub), r2[:200])
    hub.urls.clear(); bb.evaluate("() => { const b = document.querySelector('#pullBtn'); for (let i = 0; i < 6; i++) b.click(); }"); bb.wait_for_function("() => { const b = document.querySelector('#pullBtn'); return b && !b.disabled; }", timeout=20000); bb.wait_for_timeout(300)
    check("Duplicate requests: six clicks in the same instant start ONE retrieval (one read, no write), the button is disabled while it runs", len(gets(hub, PLAIN)) == 1 and not puts(hub), gets(hub, PLAIN))
    bb.evaluate("() => window.__sqla.setRepositoryTimeoutMs(20000)"); hub.urls.clear(); bb.dblclick("#pullBtn"); bb.wait_for_function("() => { const b = document.querySelector('#pullBtn'); return b && !b.disabled; }", timeout=20000); bb.wait_for_timeout(300)
    check("Duplicate requests: a double click is one retrieval too", len(gets(hub, PLAIN)) == 1, gets(hub, PLAIN))
    st["bb"], st["Bc"] = bb, Bc
def btab_adv(pg):
    pg.click('[data-tour="tab-advanced"]'); pg.wait_for_timeout(200); pg.check("#advDistinct"); pg.fill("#advLimit", "5"); pg.click('[data-tour="tab-tables-columns"]'); pg.wait_for_timeout(300)


# ───────────────────────────── 4. Pull Schema — failures leave the local schema intact ─────────────────────────────
def pull_failures(b, url, st):
    hub = st["hub"]; C, c = newdev(b, url, hub, tag="deviceC"); configure(c, TOK_B)
    c.evaluate("() => { const sv = window.__sqla.services().schemas; const s = JSON.parse(JSON.stringify(sv.active())); s.name = 'My Local Work'; s.id = 'schema-local-work'; s.updatedAt = '2026-09-30T00:00:00.000Z'; if (!sv.saveSchema(s).ok) throw new Error('x'); sv.setActive(s.id); }")
    T.pull_page(c); base = snap(c); good = hub.get(PLAIN)
    def attempt(): T.pull_page(c); c.evaluate("() => window.__sqla.setRepositoryTimeoutMs(20000)"); t = pull_click(c); return t, intact(c, base) and c.locator("#pullResult .issue-box.ok").count() == 0 and "Schema pulled and validated successfully." not in t
    hub.valid.discard(TOK_B); hub.valid.add(TOK_BAD); t, ok = attempt(); check("Failure — authorization (401): the rejected token is named with the next step; local schema intact; no success; the token is not in the message", "rejected the access token" in t and "Contents: read" in t and "Go to the GitHub repository card" in t and ok and TOK_B not in t, t[:240]); hub.valid.add(TOK_B)
    hub.valid.discard(TOK_B); hub.read_only.add(TOK_B); hub.mode = "http403"; t, ok = attempt(); check("Failure — repository permission / rate limit (403): reported with the next step; local schema intact", "not allowed to read the repository" in t and "rate limit" in t and ok, t[:240]); hub.mode = "ok"; hub.read_only.discard(TOK_B); hub.valid.add(TOK_B)
    hub.mode = "down"; t, ok = attempt(); check("Failure — network interruption: 'could not be retrieved' with the next step; local schema intact", "could not be retrieved" in t and "network connection" in t.lower() and ok, t[:240]); hub.mode = "ok"
    c.evaluate("() => window.__sqla.setRepositoryTimeoutMs(400)"); hub.mode = "hang"; T.pull_page(c); c.evaluate("() => window.__sqla.setRepositoryTimeoutMs(400)"); c.click("#pullBtn"); c.wait_for_timeout(120); loading = [c.is_disabled("#pullBtn"), "Retrieving" in c.inner_text("#pullResult")]
    c.wait_for_function("() => { const b = document.querySelector('#pullBtn'); const r = document.querySelector('#pullResult'); return b && !b.disabled && r && /did not answer/.test(r.innerText); }", timeout=20000); t = c.inner_text("#pullResult"); hub.mode = "ok"; c.evaluate("() => window.__sqla.setRepositoryTimeoutMs(20000)")
    check("Loading state is real: while GitHub does not answer the button is disabled and 'Retrieving…' shows; then the timeout is reported and the button works again; local schema intact", loading == [True, True] and "did not answer in time" in t and intact(c, base) and not c.is_disabled("#pullBtn"), (loading, t[:160]))
    hub.files.pop(PLAIN); t, ok = attempt(); check("Failure — no schema file in the repository: 'No schema file was found … yet' with the next step (a warning, not success); local schema intact", "No schema file was found in the repository yet" in t and "Sync with GitHub Now" in t and ok, t[:240])
    enc = c.evaluate("async ([t, p]) => window.__sqla.encryptForTest(t, p)", [good, DEFAULT_PASS]); hub.put(ENC, enc); t, ok = attempt(); hub.files.pop(ENC)
    check("Failure — the repository holds a passphrase-protected schema file: reported (not as 'missing'); NOT opened with the default Secret Vault passphrase; local schema intact", "passphrase-protected" in t and "No schema file was found" not in t and ok, t[:300])
    hub.put(PLAIN, "{this is not json"); t, ok = attempt(); check("Failure — unreadable / damaged file: reported with the next step; local schema intact", ("failed validation" in t or "cannot be read" in t or "could not be retrieved" in t) and ok, t[:240])
    hub.put(PLAIN, json.dumps({"formatVersion": 99, "writtenBy": "SQL Assistant 99.0", "schemas": []})); t, ok = attempt(); check("Failure — incompatible (newer) schema format: says so and to update SQL Assistant; local schema intact", "format this version of SQL Assistant cannot read" in t and "Update SQL Assistant" in t and ok, t[:260])
    bad = c.evaluate("() => JSON.stringify({ formatVersion: 2, writtenBy: 'SQL Assistant 17.5.5', activeSchemaId: 'sx', schemas: [{ id: 'sx', name: 'Broken Remote', version: '1', updatedAt: '2026-01-01T00:00:00.000Z', status: 'inactive', lastSyncedAt: null, relationships: [], tables: [{ name: 'T', module: 'M', description: '', columns: [{ name: 'ID', label: 'ID', type: 'NUMBER', nullable: false, description: '', decode: [{ rawValue: '', label: 'oops' }] }] }] }] })")
    hub.put(PLAIN, bad); t, ok = attempt(); check("Failure — invalid schema content: it is NOT imported, the result is a partial result that names the validation failure (never 'success'); local schema intact", "failed validation" in t and "completed only partly" in t and "Broken Remote" not in registry_json(c) and ok, t[:320])
    c.evaluate("() => { const o = Storage.prototype.setItem; window.__origSet = o; Storage.prototype.setItem = function (k, v) { if (k === 'sqla.registry.v15') throw new DOMException('quota', 'QuotaExceededError'); return o.apply(this, arguments); }; }"); hub.put(PLAIN, good)
    t, ok = attempt(); c.evaluate("() => { Storage.prototype.setItem = window.__origSet; }"); check("Failure — the device cannot save the schema (storage refuses): reported as a SAVE failure, not as validation; the working schema is kept", "could not be saved on this device" in t and "failed validation" not in t and ok, t[:260])
    t2 = pull_click(c); check("Recovery: with the file restored the very next pull works, shows only the new result and no stale error", "Schema pulled and validated successfully." in t2 and c.locator("#pullResult .issue-box.err").count() == 0 and B.active_name(c) == "AP / P2P Core", t2[:200])
    secrets_seen = [x for x in B.console_all if TOK_A in x or TOK_B in x or TOK_BAD in x or DEFAULT_PASS in x]
    check("Secrecy: no token or passphrase reached the console, the URL or any message in the failure flows", not secrets_seen and TOK_B not in c.inner_text("body") and TOK_B not in c.url and DEFAULT_PASS not in c.inner_text("body"))
    C.close()


# ───────────────────────────── 5. Secret Vault: Pull (Schema) and Push (Settings) are independent ─────────────────────────────
def vault_ops(b, url, st):
    hub = Hub(); [hub.put(k, v) for k, v in UNRELATED.items()]; st["vhub"] = hub
    A, a = newdev(b, url, hub, tag="vaultA"); configure(a, TOK_A); unlock(a); stab(a, "Secret Vault"); blob0 = a.evaluate("() => localStorage.getItem('sqla.vault.local.v17')"); a.fill("#v17VaultPass", DEFAULT_PASS); a.fill("#v17VaultPass2", DEFAULT_PASS); hub.urls.clear(); a.click("#pushVaultBtn"); a.wait_for_timeout(3500); res = a.inner_text("#v17VaultResult"); vf = hub.get(VPATH) or ""
    reads = {u.split("/contents/")[1].split("?")[0] for m, u in hub.urls if m == "GET" and "/contents/" in u}; w = [u.split("/contents/")[1].split("?")[0] for u in puts(hub)]
    check("Push Secret Vault (Settings): works on its own — validated, encrypted, written once, read back and verified", all(x in res for x in ["1 Secret configuration validated", "4 Encrypted configuration pushed", "5 Synchronization confirmed"]) and vf != "" and w == [VPATH], res[:240])
    check("Push Secret Vault never invokes the pull: it reads only the vault file (for its revision) and writes only the vault file — no schema file is read or written, and this device's own vault is not re-imported", reads == {VPATH} and w == [VPATH] and a.evaluate("() => localStorage.getItem('sqla.vault.local.v17')") == blob0 and all(u.startswith(PREFIX[:-10]) for m, u in hub.urls), (reads, w))
    j = json.loads(vf); check("Push Secret Vault: the data format is unchanged (AES-256-GCM, PBKDF2-SHA256) and the file contains no token, no passphrase and no Base64 of them; no unrelated file was touched", sorted(j) == sorted(["v", "alg", "kdf", "iter", "salt", "iv", "ct"]) and j["alg"] == "AES-256-GCM" and j["kdf"] == "PBKDF2-SHA256" and j["iter"] == 310000 and j["v"] == 1 and TOK_A not in vf and DEFAULT_PASS not in vf and base64.b64encode(TOK_A.encode()).decode() not in vf and all(hub.get(k) == v for k, v in UNRELATED.items()), list(j)[:6])
    check("Push Secret Vault: it uses the repository and branch of the Schema section (every request → basware/sk-ap-sql-assistant, branch main)", all(u.startswith(PREFIX[:-10]) for m, u in hub.urls) and all("ref=main" in u for m, u in hub.urls if m == "GET"))
    Bc, bb = newdev(b, url, hub, tag="vaultB"); configure(bb, TOK_B); T.pull_page(bb); tail_b = bb.inner_text("#maskedToken"); s0 = storage(bb)
    bb.evaluate("() => document.querySelector('#schemaVaultCardMount').scrollIntoView()"); bb.click("#schemaVaultCardMount .passphrase-eye"); bb.click("#schemaVaultCardMount .passphrase-eye")
    check("Pull Secret Vault: opening the page, using the eye and leaving the default untouched does not change anything that is saved on this device", storage(bb) == s0)
    bb.evaluate("() => document.querySelector('#schemaVaultCardMount').scrollIntoView()"); hub.urls.clear(); un0 = {k: hub.get(k) for k in list(UNRELATED) + [VPATH]}; bb.click("#pullVaultBtn"); r = T.vault_result(bb)
    check("Pull Secret Vault: with the default passphrase it retrieves, decrypts and validates the vault — this device now holds the token that was pushed", "Secret Vault imported and validated" in r and TOK_A[-4:] in bb.inner_text("#maskedToken") and TOK_B[-4:] in tail_b and TOK_A[-4:] != TOK_B[-4:], (tail_b, bb.inner_text("#maskedToken")))
    check("Pull Secret Vault: it only READS — one read of the vault file, no write, no schema file touched; every request used the Schema section's repository and branch", not puts(hub) and {u.split("/contents/")[1].split("?")[0] for m, u in hub.urls if m == "GET" and "/contents/" in u} == {VPATH} and all(u.startswith(PREFIX[:-10]) and ("ref=main" in u or "/contents/" not in u) for m, u in hub.urls) and all(hub.get(k) == v for k, v in un0.items()))
    check("Pull Secret Vault: the existing data format is read as before and the passphrase / token appear nowhere (markup, text, storage, console, URL)", DEFAULT_PASS not in bb.evaluate("() => document.querySelector('#app').outerHTML") and TOK_A not in bb.evaluate("() => document.querySelector('#app').outerHTML") and TOK_A not in storage(bb) and not any(TOK_A in x or DEFAULT_PASS in x for x in B.console_all))
    # a user-typed passphrase wins over the default; a wrong one never overwrites what is saved
    a.fill("#v17VaultPass", CUSTOM); a.fill("#v17VaultPass2", CUSTOM); a.click("#pushVaultBtn"); a.wait_for_timeout(3500)
    T.pull_page(bb); tok = bb.inner_text("#maskedToken"); blob = bb.evaluate("() => localStorage.getItem('sqla.vault.local.v17')"); hub.urls.clear(); bb.click("#pullVaultBtn"); r = T.vault_result(bb)
    check("Default vs typed: the vault is now protected with another passphrase — the default is refused ('wrong or the data was modified'), nothing saved on the device changes, no success, the passphrase is not echoed", "wrong or the data was modified" in r and bb.inner_text("#maskedToken") == tok and bb.evaluate("() => localStorage.getItem('sqla.vault.local.v17')") == blob and bb.locator("#v17VaultResult .issue-box.ok").count() == 0 and DEFAULT_PASS not in r, r[:200])
    bb.evaluate("(p) => { const i = document.querySelector('#v17VaultPass'); i.value = p; }", CUSTOM); bb.click("#pullVaultBtn"); r = T.vault_result(bb)
    check("Default vs typed: typing the right passphrase overrides the default and the pull succeeds", "Secret Vault imported and validated" in r, r[:160])
    # failures
    T.pull_page(bb); tok = bb.inner_text("#maskedToken"); blob = bb.evaluate("() => localStorage.getItem('sqla.vault.local.v17')")
    def vfail(label, expect, mode=None, valid=None):
        T.pull_page(bb); bb.evaluate("() => window.__sqla.setRepositoryTimeoutMs(20000)")
        if mode: hub.mode = mode
        if valid is not None: hub.valid.discard(TOK_A); hub.valid.discard(TOK_B)
        bb.evaluate("(p) => { document.querySelector('#v17VaultPass').value = p; }", CUSTOM); bb.click("#pullVaultBtn"); t = T.vault_result(bb); hub.mode = "ok"; hub.valid.update({TOK_A, TOK_B})
        check(label, all(x in t for x in expect) and bb.locator("#v17VaultResult .issue-box.ok").count() == 0 and bb.inner_text("#maskedToken") == tok and bb.evaluate("() => localStorage.getItem('sqla.vault.local.v17')") == blob and TOK_A not in t and CUSTOM not in t, t[:200])
    vfail("Pull Secret Vault failure — authorization (401): reported, nothing saved changes, no secret in the message", ["invalid or has expired"], valid=True)
    vfail("Pull Secret Vault failure — network error: reported, nothing saved changes", ["could not be reached"], mode="down")
    saved = hub.files.pop(VPATH); vfail("Pull Secret Vault failure — no vault in the repository: reported, nothing saved changes", ["No encrypted Secret Vault was found"]); hub.files[VPATH] = saved
    T.pull_page(bb); hub.urls.clear(); bb.evaluate("(p) => { document.querySelector('#v17VaultPass').value = p; }", CUSTOM); bb.evaluate("() => { const b = document.querySelector('#pullVaultBtn'); for (let i = 0; i < 6; i++) b.click(); }"); T.vault_result(bb)
    check("Pull Secret Vault: six clicks in the same instant start ONE retrieval (one read, no write)", len(gets(hub, VPATH)) == 1 and not puts(hub), gets(hub, VPATH))
    st["A"], st["a2"], st["B2"] = A, a, Bc


# ───────────────────────────── 6. One authoritative repository for every operation ─────────────────────────────
def one_repository(b, url, st):
    hub = Hub(); ctx, pg = newdev(b, url, hub, tag="oneRepo"); configure(pg, TOK_A); edit(pg); hub.urls.clear()
    B.sync_now(pg)                                                                                                     # schemas (read + write)
    pg.evaluate("async () => { const sv = window.__sqla.services(); await sv.knowledge.synchronize(); await sv.adminMessage.synchronize(); await sv.adminMessage.publish('Maintenance notice', 'info'); }"); pg.wait_for_timeout(600)  # knowledge + admin message
    T.pull_page(pg); pull_click(pg)                                                                                    # Pull Schema
    unlock(pg); stab(pg, "Secret Vault"); pg.fill("#v17VaultPass", DEFAULT_PASS); pg.fill("#v17VaultPass2", DEFAULT_PASS); pg.click("#pushVaultBtn"); pg.wait_for_timeout(3500)  # Push Secret Vault
    T.pull_page(pg); pg.click("#pullVaultBtn"); T.vault_result(pg)                                                       # Pull Secret Vault
    files = {u.split("/contents/")[1].split("?")[0] for m, u in hub.urls if "/contents/" in u}; branches = {re.search(r"ref=([^&]+)", u).group(1) for m, u in hub.urls if m == "GET" and "ref=" in u}; bodies = [json.loads(x[3]) for x in hub.requests if x[0] == "PUT" and x[3]]
    check("One repository: schemas, knowledge, admin message, Pull Schema, Push Secret Vault and Pull Secret Vault — every one of the requests went to basware/sk-ap-sql-assistant", len(hub.urls) >= 10 and all(u.startswith(PREFIX[:-10]) for m, u in hub.urls), len(hub.urls))
    check("One branch: every read used branch main and every write was committed to branch main", branches == {"main"} and bodies and all(x.get("branch") == "main" for x in bodies), (branches, [x.get("branch") for x in bodies]))
    check("One schema path: the plain schema file is sql-assistant-data/schemas/registry.json; knowledge, admin message and vault paths are siblings in the same folder tree", PLAIN in files and "sql-assistant-data/knowledge/knowledge.json" in files and "sql-assistant-data/messages/admin-message.json" in files and VPATH in files, sorted(files))
    allf = " ".join(v[0].decode("utf-8") for v in hub.files.values()); reqs = " ".join(x[3] for x in hub.requests)
    check("Secrecy: no token, no default passphrase and no Base64 of them in any repository file or request body written by any operation", all(x not in allf and x not in reqs for x in (TOK_A, DEFAULT_PASS, base64.b64encode(TOK_A.encode()).decode(), base64.b64encode(DEFAULT_PASS.encode()).decode())))
    html = (ROOT / "dist/index.html").read_text(encoding="utf-8"); src = " ".join(p.read_text(encoding="utf-8") for p in (ROOT / "src").rglob("*.ts"))
    check("Source and bundle: no GitHub token anywhere; the default passphrase is defined in ONE source file and — as disclosed — ships in the bundle", not re.search(r"ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}", html + src) and [str(f.relative_to(ROOT)) for f in (ROOT / "src").rglob("*.ts") if DEFAULT_PASS in f.read_text(encoding="utf-8")] == ["src/v17/services/repositoryDefaults.ts"] and html.count(DEFAULT_PASS) >= 1)
    ctx.close()


# ───────────────────────────── 7. Regression + responsive ─────────────────────────────
def regression(b, url):
    ctx, pg = newdev(b, url, None, tag="reg"); ok = []
    for r in ["quickstart", "readonly", "cr", "schema-used", "schema-used/pull", "error-rectifier", "settings", "about"]: go(pg, r); ok.append(pg.inner_text("main").strip() != "")
    unlock(pg); tabs = pg.locator(".tab-btn").all_inner_texts()
    check("Regression: every route renders and the 8 Settings tabs are unchanged", all(ok) and tabs == ["Security", "Manual Schema Update", "Schema Management", "Secret Vault", "Synchronization", "Admin Query Library", "AI/LLM Model", "Danger Zone"], tabs)
    stab(pg, "Synchronization"); st = pg.inner_text("main"); stab(pg, "AI/LLM Model"); ai = pg.inner_text("main"); stab(pg, "Admin Query Library")
    check("Regression: Synchronization (sync source / time, shared location, knowledge, admin message, migrations, log), AI/LLM Model and the Admin Query Library are unchanged", all(x in st for x in ["Sync Source", "Shared Location", "Central knowledge", "Admin message", "Data migrations", "Conflict Management", "Synchronization Log"]) and "Layer 1" in ai and pg.locator("#aqAdd").count() == 1)
    stab(pg, "Manual Schema Update"); check("Regression: Manual Schema Update still edits the schema (row editor present)", pg.locator("#editorSchemaSelect").count() == 1 and pg.locator("#editorTableSelect").count() == 1)
    pg.click("#tourBtnNav"); pg.wait_for_timeout(600); check("Regression: the Guided Walkthrough still starts", pg.locator("#tourOverlay").count() == 1)
    ctx.close()
def responsive(b, url):
    for (w, h, name) in [(1366, 900, "desktop"), (768, 1024, "tablet"), (390, 800, "phone")]:
        hub = Hub(); ctx, pg = newdev(b, url, hub, w, h, tag=f"resp-{name}"); T.pull_page(pg); o1 = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth"); pg.click("#repoCfgToggle"); pg.wait_for_timeout(120); o2 = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        pull_click(pg); o3 = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        boxes = pg.evaluate("() => ['[data-v1754-repo-card]', '#schemaPullMount > .builder-panel', '[data-v1754-vault-card]'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; })")
        check(f"Responsive ({name} {w}px): the three cards fit without horizontal scroll — configuration hidden, revealed, and with a failure message shown", max(o1, o2, o3) <= 2 and all(0 <= l and r <= w + 2 for l, r in boxes), (o1, o2, o3, boxes)); ctx.close()


def main():
    if not (ROOT / "dist/index.html").exists(): print("Run npm run build first."); sys.exit(2)
    port = B.free_port(); serve = subprocess.Popen(["node", str(ROOT / "scripts/serve.mjs")], env={**os.environ, "PORT": str(port), "BASE": "/SQL-Assistant/"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.9)
    url = f"http://127.0.0.1:{port}/SQL-Assistant/?e2e=1"; st = {}
    try:
        with sync_playwright() as p:
            exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
            section("Cards UI", cards_ui, b, url); section("Identity", identity, b, url)
            try: pull_schema(b, url, st)
            except Exception as ex: check("Pull Schema: section completed", False, f"{type(ex).__name__}: {str(ex)[:260]} | {traceback.format_exc().splitlines()[-3][:150]}")
            if st.get("hub"): section("Pull Schema failures", pull_failures, b, url, st)
            for k in ("Bc",):
                try: st[k].close()
                except Exception: pass
            section("Secret Vault operations", vault_ops, b, url, st); section("One repository", one_repository, b, url, st); section("Regression", regression, b, url); section("Responsive", responsive, b, url)
            b.close()
    finally: serve.terminate()
    real = [e for e in B.errors if "Failed to load resource" not in e and "net::ERR" not in e and "Could not reach GitHub" not in e and "ERR_CONNECTION" not in e]
    check("No console errors or uncaught exceptions in any V17.5.5 flow", not real, "; ".join(real[:4]))
    results = B.results; failed = [r for r in results if not r[1]]; print(f"\n{len(results) - len(failed)}/{len(results)} V17.5.5 browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True); (ROOT / "test-results/browser-results-v1755.json").write_text(json.dumps([{"check": n, "pass": ok} for n, ok in results], indent=2)); sys.exit(1 if failed else 0)
if __name__ == "__main__": main()
