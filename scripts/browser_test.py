"""SQL Assistant V17.5 — real-browser regression tests of the V17.3.1 baseline (V17.2 UI) on the PRODUCTION build (Chromium/Playwright).
   npm run build && python3 scripts/browser_test.py          (CHROME_PATH=/path/to/chrome to use an installed browser)"""
import json, os, sys, time, subprocess, pathlib, tempfile, threading, functools, http.server, socketserver, socket
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]
AP77 = json.loads((ROOT / "test/fixtures/ap-schema-77.legacy.json").read_text(encoding="utf-8"))
PATH = "sql-assistant-data/schemas/registry.json"
def tiny(n): return {"id": "s-" + n.lower().replace(" ", "-"), "name": n, "tables": [{"name": "T1", "module": "M", "description": "", "columns": [{"name": "ID", "type": "NUMBER", "nullable": False, "isPrimaryKey": True, "description": ""}]}], "relationships": []}
def mangled():
    s = json.loads(json.dumps(AP77))
    for t in s["tables"]:
        for c in t["columns"]:
            if c.get("decode"): c["decode"] = [{"rawValue": "", "code": d["code"], "label": d["label"]} for d in c["decode"]]
    return dict(s, id="schema-ap77", name="AP schema 77")
LEGACY = json.dumps({"schemas": [tiny("Core A"), tiny("Core B"), mangled()], "activeSchemaId": "s-core-a"})
results, errors = [], []
def check(name, ok, detail=""):
    results.append((name, bool(ok))); print(("PASS " if ok else "FAIL ") + name + ("" if ok or not detail else f" — {str(detail)[:300]}"))
def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
def static_server(d):
    h = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Q, directory=str(d))); threading.Thread(target=h.serve_forever, daemon=True).start(); return h
def watch(pg, tag):
    pg.on("console", lambda m: m.type == "error" and errors.append(f"{tag}: {m.text}")); pg.on("pageerror", lambda e: errors.append(f"{tag}: {e}")); pg.on("dialog", lambda d: d.accept())
def ready(pg): pg.wait_for_function("() => document.documentElement.getAttribute('data-sqla-ready') === '1'", timeout=20000); pg.wait_for_timeout(150)
def go(pg, route): pg.evaluate(f"location.hash = '#{route}'"); pg.wait_for_timeout(250)
def repo(pg, files): pg.evaluate("(f) => { const r = window.__sqla.memoryRepository(f); window.__repo = r; window.__sqla.setRepositoryOverride(r); window.__sqla.render(); }", files); pg.wait_for_timeout(150)
def unlock(pg, pw="admin"):
    go(pg, "settings"); pg.fill("#settingsPwInput", pw); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(900)
def tab(pg, name): pg.click(f'.tab-btn:has-text("{name}")'); pg.wait_for_timeout(250)
def sql(pg): return pg.inner_text("#sqlBlockMount .sql-output")
def describe(pg, text, dialect=None):
    pg.click("#btnClearSql"); pg.wait_for_timeout(100); pg.fill("#nlDesc", text)
    if dialect: pg.select_option("#dialectSelect", dialect)
    pg.click("#nlBuildBtn"); pg.wait_for_timeout(600)
def main():
    for f in ["dist/index.html", "index.html", "release/index.html", "release/404.html", "release/.nojekyll"]: check(f"Build output exists: {f}", (ROOT / f).exists())
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    check("Entry page is self-contained (no src/main.ts, no module script, no CDN)", "src/main.ts" not in html and 'type="module"' not in html and "<script src" not in html)
    pport = free_port(); serve = subprocess.Popen(["node", str(ROOT / "scripts/serve.mjs")], env={**os.environ, "PORT": str(pport), "BASE": "/SQL-Assistant/"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.8)
    pages = f"http://127.0.0.1:{pport}/SQL-Assistant/"; hroot = static_server(ROOT)
    try:
        with sync_playwright() as p:
            exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
            with tempfile.TemporaryDirectory() as tmp:
                t = pathlib.Path(tmp); (t / "src").mkdir(); (t / "src/main.ts").write_text("document.getElementById('app')!.textContent = 'x';")
                (t / "index.html").write_text('<!doctype html><div id="app"></div><script type="module" src="/src/main.ts"></script>'); hs = static_server(t)
                pg = b.new_page(); pg.goto(f"http://127.0.0.1:{hs.server_address[1]}/"); pg.wait_for_timeout(800)
                check("Root cause reproduced: V17.2.1 root index.html (src/main.ts) is blank", pg.inner_text("#app") == ""); pg.close(); hs.shutdown()
            # ── Index page / deployment / V17.2 UI ──
            for label, url in [("GitHub Pages sub-path /SQL-Assistant/", pages), ("project root via http", f"http://127.0.0.1:{hroot.server_address[1]}/"), ("dist/index.html via file://", (ROOT / "dist/index.html").as_uri()), ("root index.html via file://", (ROOT / "index.html").as_uri())]:
                ctx = b.new_context(viewport={"width": 1366, "height": 900}); pg = ctx.new_page(); watch(pg, label); pg.goto(url); ready(pg)
                check(f"{label}: index loads with the V17.2 UI", pg.title() == "SQL Assistant" and "SQL Assistant" in pg.inner_text("#mainNavbar") and pg.locator("#navToggle").count() == 1 and pg.locator("#syncSourceBtn").count() == 1 and "Welcome — what does this tool do?" in pg.inner_text("main"))
                ok = True
                for r in ["readonly", "cr", "schema-used", "error-rectifier", "settings", "about", "quickstart"]:
                    go(pg, r); pg.reload(); ready(pg); ok = ok and pg.inner_text("main").strip() != ""
                check(f"{label}: every route renders and survives refresh", ok); ctx.close()
            ctx = b.new_context(viewport={"width": 1366, "height": 900}); pg = ctx.new_page(); watch(pg, "app"); pg.goto(pages + "?e2e=1"); ready(pg)
            check("Version 17.5.1 in footer; no old product name", "17.5.1" in pg.inner_text("footer") and "AP-SQL" not in pg.content() and "AP_SQL" not in pg.inner_text("body"))
            pg.click("#navToggle"); pg.wait_for_timeout(150); pg.click(".hb-group-toggle"); pg.wait_for_timeout(100); pg.click('#hamburgerOverlay [data-route="readonly"]'); pg.wait_for_timeout(300)
            check("Hamburger navigation works", "Read Only Query Builder" in pg.inner_text("main") and pg.locator("#hamburgerOverlay").count() == 0)
            bx = [pg.locator(".builder-grid-top .builder-panel").nth(i).bounding_box() for i in range(2)]
            check("V17.2 layout: two equal top cards (Describe / Generated SQL)", abs(bx[0]["width"] - bx[1]["width"]) < 4)
            # ── SQL generation ──
            describe(pg, "top 5 vendors by total invoice amount for approved invoices in 2025", "Oracle"); s = sql(pg)
            check("Offline NLU: aggregation, grouping, date range, limit", all(x in s for x in ["SUM(INVOICE_HEADER.INVOICE_AMOUNT)", "INVOICE_HEADER.STATUS = 'A'", "DATE '2025-01-01'", "GROUP BY VENDOR.VENDOR_NAME", "FETCH FIRST 5 ROWS ONLY"]), s)
            check("Offline NLU badge + Active Schema audit line", "Offline NLU" in pg.inner_text("#nlNotes") and "Active Schema used" in pg.inner_text("#nlNotes"))
            pg.click("#btnClearSql"); pg.wait_for_timeout(150)
            pg.click('#tablePickerMount .picker-row[data-table="VENDOR"]'); pg.wait_for_timeout(150)
            pg.locator('#columnPickerMount [data-column="VENDOR_NAME"] .column-checkbox').first.click(); pg.wait_for_timeout(150)
            check("Manual Selectors: table + column", "VENDOR.VENDOR_NAME" in sql(pg) and "FROM VENDOR" in sql(pg))
            pg.click('[data-tour="tab-advanced"]'); pg.wait_for_timeout(200); pg.check("#advDistinct"); pg.fill("#advLimit", "25"); pg.wait_for_timeout(200)
            check("Advanced Options: DISTINCT + limit", "SELECT DISTINCT" in sql(pg) and "25" in sql(pg))
            pg.click("#btnValidateSql"); pg.wait_for_timeout(150); check("Generated SQL validates", "passed validation" in pg.inner_text("#validationMount"))
            go(pg, "cr"); pg.fill("#crNlDesc", "Update invoice 1234 status to Approved"); pg.click("#crNlBuildBtn"); pg.wait_for_timeout(400)
            check("Query Builder for CR", "INVOICE_ID = 1234" in pg.inner_text("#crSqlMount"))
            # ── PASSWORD SECTION ──
            go(pg, "settings")
            check("Settings locked: password screen shown, tabs hidden", pg.locator("#settingsPwInput").count() == 1 and pg.locator(".tab-btn").count() == 0 and pg.inner_html("#settingsPwError").strip() == "")
            pg.fill("#settingsPwInput", "wrong-pass"); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(900)
            check("Wrong password rejected; Settings stay locked", "Incorrect password" in pg.inner_text("#settingsPwError") and pg.locator(".tab-btn").count() == 0)
            pg.fill("#settingsPwInput", "admin"); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(900)
            check("Default password unlocks; V17.2 Settings tabs", pg.locator(".tab-btn").all_inner_texts() == ["Security", "Manual Schema Update", "Schema Management", "Secret Vault", "Synchronization", "Admin Query Library", "AI/LLM Model", "Danger Zone"])
            check("Default-password warning shown", "default Admin Password" in pg.inner_text("main"))
            check("Navbar lock badge shows unlocked", "is-unlocked" in (pg.get_attribute("#settingsLockBadge", "class") or ""))
            tab(pg, "Security"); pg.fill("#pwCurrent", "admin"); pg.fill("#pwNew", "S3cure-Pass"); pg.fill("#pwConfirm", "Different-1"); pg.click("#changePwBtn"); pg.wait_for_timeout(400)
            check("Change password: mismatch rejected", "do not match" in pg.inner_text("#pwResult"))
            pg.fill("#pwCurrent", "nope"); pg.fill("#pwNew", "S3cure-Pass"); pg.fill("#pwConfirm", "S3cure-Pass"); pg.click("#changePwBtn"); pg.wait_for_timeout(900)
            check("Change password: wrong current password rejected", "incorrect" in pg.inner_text("#pwResult").lower())
            pg.fill("#pwCurrent", "admin"); pg.fill("#pwNew", "S3cure-Pass"); pg.fill("#pwConfirm", "S3cure-Pass"); pg.click("#changePwBtn"); pg.wait_for_timeout(1200)
            check("Change password: success", "changed" in pg.inner_text("#pwResult").lower())
            check("Password never stored in plain text", "S3cure-Pass" not in pg.evaluate("() => JSON.stringify(Object.assign({}, localStorage))"))
            pg.click("#lockSettingsBtn"); pg.wait_for_timeout(300); check("Lock Settings returns to the lock screen", pg.locator("#settingsPwInput").count() == 1)
            pg.fill("#settingsPwInput", "admin"); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(900); check("Old default password no longer works", pg.locator(".tab-btn").count() == 0)
            pg.reload(); ready(pg); go(pg, "settings"); check("Settings locked again after restart", pg.locator("#settingsPwInput").count() == 1)
            unlock(pg, "S3cure-Pass"); check("New password unlocks after restart", pg.locator(".tab-btn").count() == 8 and "default Admin Password" not in pg.inner_text("main"))
            # Manual Schema Update — row-wise, delete needs the password
            tab(pg, "Manual Schema Update"); pg.select_option("#editorModuleSelect", "Vendors"); pg.wait_for_timeout(150); pg.select_option("#editorTableSelect", "VENDOR"); pg.wait_for_timeout(250)
            pg.click('tr[data-row-id="VENDORCOUNTRY"]'); pg.wait_for_timeout(150); check("Row selection identified", "VENDOR.COUNTRY" in pg.inner_text("#selectedRowLabel"))
            before = pg.evaluate("() => JSON.stringify(window.__sqla.services().schemas.active().tables.find(t=>t.name==='VENDOR').columns.filter(c=>c.name!=='COUNTRY'))")
            pg.click("#editRowBtn"); pg.wait_for_timeout(200); check("Save disabled until a change", pg.is_disabled("#rowFormSave"))
            pg.fill("#f_columnDescription", "ISO country (edited)"); pg.wait_for_timeout(100); pg.click("#rowFormSave"); pg.wait_for_timeout(600)
            after = pg.evaluate("() => JSON.stringify(window.__sqla.services().schemas.active().tables.find(t=>t.name==='VENDOR').columns.filter(c=>c.name!=='COUNTRY'))")
            check("Row edit saved; other rows unchanged", before == after and "ISO country (edited)" in pg.evaluate("() => JSON.stringify(window.__sqla.services().schemas.active())"))
            pg.click('tr[data-row-id="VENDORDUNS_NUMBER"]'); pg.click("#deleteRowBtn"); pg.wait_for_timeout(200); pg.click("#c1Continue"); pg.wait_for_timeout(150); pg.click("#c2Continue"); pg.wait_for_timeout(150)
            pg.fill("#c3Password", "admin"); pg.click("#c3Delete"); pg.wait_for_timeout(900)
            check("Row delete: wrong password refused", "Incorrect" in pg.inner_text("#c3Error") and "DUNS_NUMBER" in pg.evaluate("() => JSON.stringify(window.__sqla.services().schemas.active())"))
            pg.fill("#c3Password", "S3cure-Pass"); pg.click("#c3Delete"); pg.wait_for_timeout(900)
            check("Row delete with the Admin Password removes only that row", "DUNS_NUMBER" not in pg.evaluate("() => JSON.stringify(window.__sqla.services().schemas.active())") and pg.locator('tr[data-row-id="VENDORCOUNTRY"]').count() == 1)
            # Schema sync — legacy AP schema 77
            repo(pg, {PATH: LEGACY}); unlock(pg, "S3cure-Pass") if pg.locator("#settingsPwInput").count() else None; tab(pg, "Schema Management")
            pg.click("#simpleSyncBtn"); pg.wait_for_timeout(1500); r = pg.inner_text("main")
            check("Sync #1: legacy AP schema 77 migrated, nothing rejected", "Migration successful" in r and "failed validation" not in r, r[:500])
            pub = json.loads(pg.evaluate("(p) => window.__repo.files.get(p).text", PATH)); ap = next(x for x in pub["schemas"] if x["name"] == "AP schema 77")
            check("Republished: writer 17.5.1, all 437 decode entries", "17.5.1" in pub["writtenBy"] and sum(len(c.get("decode") or []) for t in ap["tables"] for c in t["columns"]) == 437)
            for n in (2, 3):
                pg.click("#simpleSyncBtn"); pg.wait_for_timeout(1000); check(f"Sync #{n}: success, no re-migration", "Migration successful" not in pg.inner_text("main") and "failed validation" not in pg.inner_text("main"))
            corrected = pg.evaluate("(p) => window.__repo.files.get(p).text", PATH)
            pg.reload(); ready(pg); repo(pg, {PATH: corrected}); unlock(pg, "S3cure-Pass"); tab(pg, "Schema Management"); pg.click("#simpleSyncBtn"); pg.wait_for_timeout(1000)
            check("Restart + sync: still clean", "failed validation" not in pg.inner_text("main") and "AP schema 77" in pg.inner_text("main"))
            # Secret Vault push — no token exposed
            TOKEN = "ghp_" + "Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2"; tab(pg, "Secret Vault")
            pg.click("#changeTokenBtn"); pg.fill("#newTokenInput", TOKEN); pg.click("#saveTokenBtn"); pg.wait_for_timeout(900)
            check("Token masked; not in browser storage", TOKEN not in pg.inner_text("body") and TOKEN not in pg.evaluate("() => JSON.stringify(Object.assign({}, localStorage))"))
            repo(pg, {}); unlock(pg, "S3cure-Pass") if pg.locator("#settingsPwInput").count() else None; tab(pg, "Secret Vault")
            pg.fill("#v17VaultPass", "correct horse battery staple"); pg.fill("#v17VaultPass2", "correct horse battery staple"); pg.click("#pushVaultBtn"); pg.wait_for_timeout(2500)
            vf = pg.evaluate("() => [...window.__repo.files.values()].map(f=>f.text).join('')"); check("Push Secret Vault: encrypted, token not in repository", vf and TOKEN not in vf)
            # AI/LLM + Danger Zone (password required)
            tab(pg, "AI/LLM Model"); check("AI/LLM Model tab present (offline stays primary)", pg.locator("#v17LlmProvider").count() == 1 and pg.locator("#v17LlmModel").count() == 1)
            tab(pg, "Danger Zone"); check("Danger Zone asks for the Admin Password", pg.locator("#dangerPw").count() == 1)
            pg.fill("#dangerPw", "wrong"); pg.click("#dangerPwReset"); pg.wait_for_timeout(900); check("Danger Zone: wrong password refused", "Incorrect" in pg.inner_text("#dangerErr"))
            pg.fill("#dangerPw", "S3cure-Pass"); pg.click("#dangerPwReset"); pg.wait_for_timeout(900)
            check("Reset Admin Password to default locks Settings", pg.locator("#settingsPwInput").count() == 1)
            pg.fill("#settingsPwInput", "admin"); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(900); check("Default password works again after reset", pg.locator(".tab-btn").count() == 8)
            ctx.close()
            ctx = b.new_context(); ctx.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new DOMException('denied','SecurityError')}})")
            pg = ctx.new_page(); pg.goto(pages); ready(pg); check("Blocked storage: app still starts", pg.locator("#mainNavbar").count() == 1); ctx.close()
            b.close()
    finally:
        serve.terminate(); hroot.shutdown()
    real = [e for e in errors if "59999" not in e and "Failed to load resource" not in e]
    check("No console errors or uncaught exceptions", not real, "; ".join(real[:4]))
    failed = [r for r in results if not r[1]]; print(f"\n{len(results) - len(failed)}/{len(results)} browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True); (ROOT / "test-results/browser-results.json").write_text(json.dumps([{"check": n, "pass": ok} for n, ok in results], indent=2))
    sys.exit(1 if failed else 0)
if __name__ == "__main__": main()
