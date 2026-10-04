"""SQL Assistant V17.3 — real-browser tests (Chromium via Playwright) on the PRODUCTION build.
    npm run build && python3 scripts/browser_test.py        (CHROME_PATH=/path/to/chrome to use an installed browser)"""
import json, os, sys, threading, functools, http.server, socketserver, pathlib, tempfile, shutil
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
LEGACY = json.dumps({"schemas": [tiny("Core A"), tiny("Core B"), mangled()]})
results, errors = [], []
def check(name, ok, detail=""):
    results.append((name, bool(ok), detail)); print(("PASS " if ok else "FAIL ") + name + ("" if ok or not detail else f" — {str(detail)[:300]}"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
def serve(d):
    h = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Q, directory=str(d))); threading.Thread(target=h.serve_forever, daemon=True).start(); return h
def watch(pg, tag):
    pg.on("console", lambda m: m.type == "error" and errors.append(f"{tag}: {m.text}")); pg.on("pageerror", lambda e: errors.append(f"{tag}: {e}")); pg.on("dialog", lambda d: d.accept())
def ready(pg): pg.wait_for_function("() => document.documentElement.getAttribute('data-sqla-ready') === '1'", timeout=15000)
def repo(pg, files): pg.evaluate("(f) => { const r = window.__sqla.memoryRepository(f); window.__repo = r; window.__sqla.setRepositoryOverride(r); }", files)
def main():
    for f in ["dist/index.html", "index.html", "release/index.html", "release/404.html", "release/.nojekyll"]:
        check(f"Production build produced {f}", (ROOT / f).exists())
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    check("Entry pages are self-contained (no module script, no src/main.ts)", 'type="module"' not in html and "src/main.ts" not in html and "<script src" not in html)
    # GitHub Pages-like layout: site served from a sub-path
    site = pathlib.Path(tempfile.mkdtemp()); shutil.copytree(ROOT / "release", site / "SQL-Assistant")
    h_root = serve(ROOT); h_site = serve(site)
    root_url = f"http://127.0.0.1:{h_root.server_address[1]}/"; pages_url = f"http://127.0.0.1:{h_site.server_address[1]}/SQL-Assistant/"
    with sync_playwright() as p:
        exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        # Root cause reproduction: the V17.2.1 root index.html loaded TypeScript as a module
        with tempfile.TemporaryDirectory() as tmp:
            t = pathlib.Path(tmp); (t / "src").mkdir(); (t / "src/main.ts").write_text("const x: number = 1; document.getElementById('app')!.textContent = 'loaded';")
            (t / "index.html").write_text('<!doctype html><div id="app"></div><script type="module" src="/src/main.ts"></script>')
            hs = serve(t); pg = b.new_page(); pg.goto(f"http://127.0.0.1:{hs.server_address[1]}/"); pg.wait_for_timeout(800)
            check("Root cause reproduced: V17.2.1-style index.html (src/main.ts) renders a blank page", pg.inner_text("#app") == ""); pg.close(); hs.shutdown()
        entries = [("project root index.html via http /", root_url), ("project root index.html via file://", (ROOT / "index.html").as_uri()), ("dist/index.html via file://", (ROOT / "dist/index.html").as_uri()), ("GitHub Pages sub-path /SQL-Assistant/", pages_url)]
        for label, url in entries:
            ctx = b.new_context(); pg = ctx.new_page(); watch(pg, label); pg.goto(url); ready(pg)
            check(f"{label}: index loads, SQL Assistant shown, Quick Start is default", pg.inner_text("#appName") == "SQL Assistant" and pg.title() == "SQL Assistant" and "Welcome to SQL Assistant" in pg.inner_text("#page") and "17.3" in pg.inner_text(".ver"))
            for r in ["readonly", "cr", "schema-used", "error-rectifier", "settings", "about"]:
                pg.click(f'a[data-route="{r}"]'); pg.wait_for_selector("#page h1")
            pg.reload(); ready(pg); check(f"{label}: refresh on #about keeps the page", "About" in pg.inner_text("#page h1"))
            pg.click('a[data-route="quickstart"]'); pg.wait_for_function("() => document.querySelector('#page h1')?.innerText.includes('Welcome')", timeout=5000); check(f"{label}: return to index", "Welcome" in pg.inner_text("#page h1"))
            ctx.close()
        ctx = b.new_context(); pg = ctx.new_page(); watch(pg, "direct"); pg.goto(pages_url + "#settings"); ready(pg); check("Direct navigation to #settings", "Settings" in pg.inner_text("#page h1"))
        pg.goto(pages_url + "#/does-not-exist"); ready(pg); check("Unknown route falls back to the index", "Welcome" in pg.inner_text("#page h1"))
        # GitHub Pages serves release/404.html for unknown paths; the local test server does not, so load it directly.
        pg.goto(pages_url + "404.html"); ready(pg); check("404.html fallback page is the full app (GitHub Pages deep links)", pg.inner_text("#appName") == "SQL Assistant")
        ctx.close()
        # Startup when sync FAILS and when it SUCCEEDS
        ctx = b.new_context(); pg = ctx.new_page(); watch(pg, "sync-fail"); pg.goto(root_url + "index.html?e2e=1"); ready(pg); repo(pg, {PATH: "<html>Sign in</html>"})
        pg.click('a[data-route="settings"]'); pg.click("#syncNow"); pg.wait_for_selector("#pullReport")
        check("Sync failure: UI stays available and reports the exact stage", "Remote file could not be parsed" in pg.inner_text("#pullReport") and pg.locator("nav.side a").count() == 7)
        pg.click('a[data-route="readonly"]'); pg.fill("#nlText", "total invoice amount per vendor for approved invoices in the last 30 days, top 10"); pg.click("#nlGenerate"); pg.wait_for_selector("#autoOptions")
        sql = pg.input_value("#sqlOut"); check("Offline NLU works while sync is failing", "SUM(INVOICE_HEADER.INVOICE_AMOUNT)" in sql and "FETCH FIRST 10 ROWS ONLY" in sql, sql)
        pg.click("#acceptSql"); pg.wait_for_selector(".toast-success")
        # Manual selectors + advanced options
        pg.click("#resetRo"); pg.select_option("#tableSelect", ["VENDOR"]); pg.check('[data-col="VENDOR.COUNTRY"]'); pg.select_option("#fCol", "VENDOR.STATUS"); pg.fill("#fVal", "A"); pg.click("#addFilter")
        pg.select_option("#sCol", "VENDOR.COUNTRY"); pg.select_option("#sDir", "DESC"); pg.click("#addSort"); pg.check("#advDistinct"); pg.fill("#advLimit", "5"); pg.click("#applyAdvanced")
        sql = pg.input_value("#sqlOut"); check("Manual Selectors + Advanced Options", all(x in sql for x in ["SELECT DISTINCT VENDOR.COUNTRY", "WHERE VENDOR.STATUS = 'A'", "ORDER BY VENDOR.COUNTRY DESC", "FETCH FIRST 5 ROWS ONLY"]), sql)
        # Legacy sync succeeds, repeated, restart
        repo(pg, {PATH: LEGACY}); pg.click('a[data-route="settings"]'); pg.click("#syncNow"); pg.wait_for_selector("#pullReport")
        rep = pg.inner_text("#syncDiagnostics"); check("Sync #1: legacy AP schema 77 migrated, nothing rejected", "Migration successful" in rep and "failed validation" not in rep, rep[:400])
        pub = json.loads(pg.evaluate("(p) => window.__repo.files.get(p).text", PATH)); ap = next(s for s in pub["schemas"] if s["name"] == "AP schema 77")
        check("Republished with writer stamp 17.3.0 and all 437 decode entries", pub["writtenBy"] == "SQL Assistant 17.3.0" and sum(len(c.get("decode") or []) for t in ap["tables"] for c in t["columns"]) == 437)
        for n in (2, 3):
            pg.click("#syncNow"); pg.wait_for_selector("#pullReport"); r = pg.inner_text("#syncDiagnostics")
            check(f"Sync #{n}: success, no migration repeated", "Migration successful" not in r and "failed validation" not in r and "Up to date" in r, r[:300])
        pg.click('#schemaList tr:has-text("AP schema 77") [data-activate]'); check("Active schema refreshed", "AP schema 77" in pg.inner_text("#activeSchemaPill"))
        pg.click('a[data-route="readonly"]'); pg.fill("#nlText", "show action log entries where root document type is Invoice"); pg.click("#nlGenerate"); pg.wait_for_selector("#autoOptions")
        check("SQL generation uses the migrated active schema", "ROOT_DOCUMENT_TYPE = 'Invoice.Domain.Invoice'" in pg.input_value("#sqlOut"))
        corrected = pg.evaluate("(p) => window.__repo.files.get(p).text", PATH)
        pg.reload(); ready(pg); repo(pg, {PATH: corrected}); check("Restart: AP schema 77 still active", "AP schema 77" in pg.inner_text("#activeSchemaPill"))
        pg.click('a[data-route="settings"]'); pg.click("#syncNow"); pg.wait_for_selector("#pullReport"); r = pg.inner_text("#syncDiagnostics")
        check("Sync after restart: success", "failed validation" not in r and "Up to date" in r)
        # Manual Schema Update
        pg.click('[data-tab="manual-update"]'); pg.click('#muGrid tr[data-row="IA_ACTION_LOG::ACTION_COMMENT"]'); pg.fill("#muDesc", "Edited in V17.3 test"); pg.click("#muSave"); pg.wait_for_selector("#muChanges")
        pg.click('#muGrid tr[data-row="IA_ACTION_LOG::PARENT_ID"]'); pg.click("#muDelete"); pg.wait_for_selector("#muChanges")
        pg.reload(); ready(pg); pg.click('a[data-route="settings"]'); pg.click('[data-tab="manual-update"]')
        check("Row delete persisted", pg.locator('#muGrid tr[data-row="IA_ACTION_LOG::PARENT_ID"]').count() == 0)
        pg.click('#muGrid tr[data-row="IA_ACTION_LOG::ACTION_COMMENT"]'); check("Row edit persisted across restart", pg.input_value("#muDesc") == "Edited in V17.3 test")
        # Secret Vault + AI/LLM
        TOKEN = "ghp_" + "Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2"
        pg.click('[data-tab="vault"]'); check("Schema path defaults to sql-assistant-data/schemas/registry.json", pg.input_value("#vSchemaPath") == PATH)
        pg.fill("#vRepo", "example-org/sql-assistant-data"); pg.fill("#vToken", TOKEN); pg.click("#vSave"); pg.wait_for_function("() => !!localStorage.getItem('sqla.vault.local.v17')")
        dump = pg.evaluate("() => JSON.stringify(Object.assign({}, localStorage))"); check("Vault encrypted at rest (token not in storage)", TOKEN not in dump)
        repo(pg, {}); pg.click('[data-tab="vault"]'); pg.fill("#vPass", "correct horse battery staple"); pg.click("#vPush"); pg.wait_for_function("() => document.querySelector('#vResult')?.innerText.includes('pushed')")
        vf = pg.evaluate("() => [...window.__repo.files.values()][0]?.text || ''"); check("Push Secret Vault: encrypted, token not in repository", TOKEN not in vf and "AES-256-GCM" in vf)
        pg.fill("#vPass", "wrong passphrase value"); pg.click("#vPull"); pg.wait_for_function("() => document.querySelector('#vResult')?.innerText.includes('failed')"); check("Wrong passphrase rejected", "wrong or the data was modified" in pg.inner_text("#vResult"))
        pg.fill("#vPass", "correct horse battery staple"); pg.click("#vPull"); pg.wait_for_function("() => document.querySelector('#vResult')?.innerText.includes('retrieved')"); check("Retrieve → decrypt → validate", True)
        check("Token never rendered", TOKEN not in pg.content())
        pg.click('[data-tab="ai"]'); pg.check("#aiEnabled"); pg.fill("#aiModel", ""); pg.click("#aiSave"); pg.wait_for_selector("#aiResult .issue-box"); check("AI/LLM validation", "Model is required" in pg.inner_text("#aiResult"))
        pg.select_option("#aiProvider", "custom"); pg.fill("#aiModel", "local"); pg.fill("#aiEndpoint", "http://127.0.0.1:59999/v1"); pg.select_option("#aiAuth", "none"); pg.fill("#aiTimeout", "1500"); pg.click("#aiSave"); pg.wait_for_selector(".toast-success")
        pg.reload(); ready(pg); pg.click('a[data-route="settings"]'); pg.click('[data-tab="ai"]'); check("AI/LLM saved and loaded", pg.input_value("#aiModel") == "local")
        pg.click('a[data-route="readonly"]'); pg.fill("#nlText", "xyzzy plugh"); pg.click("#nlGenerate"); pg.wait_for_selector("#autoOptions"); check("AI/LLM unavailable → offline fallback", "offline NLU result is used" in pg.inner_text("#autoOptions"))
        ctx.close()
        # Upgrade from V17.2.1 package: schemas in sqla.schemaRegistry.v15 are recovered
        ctx = b.new_context(); ctx.add_init_script("if(!sessionStorage.x){localStorage.setItem('sqla.schemaRegistry.v15', JSON.stringify({formatVersion:2,writtenBy:'SQL Assistant 17.2.1',activeSchemaId:'s-mine',schemas:[{id:'s-mine',name:'My V17.2.1 schema',tables:[{name:'T1',module:'M',description:'',columns:[{name:'ID',type:'NUMBER',nullable:false,isPrimaryKey:true,description:''}]}],relationships:[]}]}));sessionStorage.x=1}")
        pg = ctx.new_page(); watch(pg, "upgrade"); pg.goto(root_url); ready(pg); check("Upgrade: schemas saved by V17.2.1/V17.2.2 are recovered and active", "My V17.2.1 schema" in pg.inner_text("#activeSchemaPill")); ctx.close()
        ctx = b.new_context(); ctx.add_init_script("if(!sessionStorage.x){localStorage.setItem('sqla.registry.v15','{corrupt');sessionStorage.x=1}")
        pg = ctx.new_page(); pg.goto(root_url); ready(pg); check("Corrupt stored data: index still loads", pg.locator("nav.side a").count() == 7); ctx.close()
        ctx = b.new_context(); ctx.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new DOMException('denied','SecurityError')}})")
        pg = ctx.new_page(); pg.goto(root_url); ready(pg); check("Blocked storage: index still loads", pg.locator("nav.side a").count() == 7); ctx.close()
        b.close()
    h_root.shutdown(); h_site.shutdown()
    real = [e for e in errors if "ERR_CONNECTION" not in e and "59999" not in e and "127.0.0.1:9" not in e]
    check("No console errors or uncaught exceptions", not real, "; ".join(real[:4]))
    failed = [r for r in results if not r[1]]; print(f"\n{len(results) - len(failed)}/{len(results)} browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True); (ROOT / "test-results/browser-results.json").write_text(json.dumps([{"check": n, "pass": ok} for n, ok, _ in results], indent=2))
    sys.exit(1 if failed else 0)
if __name__ == "__main__": main()
