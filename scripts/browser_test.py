"""
SQL Assistant V17.2.1 — end-to-end browser test (real Chromium via Playwright).
Runs the PRODUCTION build from dist/ over HTTP. Repository sync uses an in-memory repository
injected through the ?e2e=1 test hook (no network, no real GitHub token).

    npm run build && python3 scripts/browser_test.py
"""
import json, os, sys, threading, functools, http.server, socketserver, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
SOURCE = json.loads((ROOT / "test/fixtures/ap-schema-77.source.json").read_text(encoding="utf-8"))
PATH = "schemas/schema-registry.json"

def tiny(name):
    return {"id": "s-" + name.lower().replace(" ", "-"), "name": name, "tables": [{"name": "T1", "module": "M", "description": "", "columns": [
        {"name": "ID", "type": "NUMBER", "nullable": False, "isPrimaryKey": True, "description": ""},
        {"name": "STATUS", "type": "VARCHAR", "nullable": True, "description": "", "decode": [{"rawValue": "A", "label": "Active"}]}]}], "relationships": []}

# What a V17.0 device published: no writer stamp, AP schema 77 at schemas[2] in its original export shape.
LEGACY_FILE = json.dumps({"schemas": [tiny("Core A"), tiny("Core B"), dict(SOURCE, id="schema-ap77", name="AP schema 77")], "activeSchemaId": "s-core-a"})

results, console_errors = [], []
def check(name, cond, detail=""):
    results.append((name, bool(cond), detail)); print(("PASS " if cond else "FAIL ") + name + (f" — {detail}" if detail and not cond else ""))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def serve():
    handler = functools.partial(Quiet, directory=str(DIST))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd

def inject_repo(page, text):
    page.evaluate("""([path, text]) => { const r = window.__sqla.memoryRepository(text === null ? {} : { [path]: text }); window.__repo = r; window.__sqla.setRepositoryOverride(r); }""", [PATH, text])

def repo_text(page):
    return page.evaluate("(path) => window.__repo.files.get(path)?.text ?? null", PATH)

def main():
    if not (DIST / "index.html").exists(): sys.exit("dist/ not found — run npm run build first")
    httpd = serve(); base = f"http://127.0.0.1:{httpd.server_address[1]}/index.html?e2e=1"
    with sync_playwright() as p:
        exe = os.environ.get("CHROME_PATH")
        browser = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        ctx = browser.new_context(); page = ctx.new_page()
        allow_net_errors = {"on": False}
        page.on("console", lambda m: (m.type == "error" and not (allow_net_errors["on"] and "ERR_CONNECTION" in m.text + str(m.location))) and console_errors.append(m.text))
        page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))
        page.on("dialog", lambda d: d.accept())

        # ── Application ──
        page.goto(base); page.wait_for_selector("#appName")
        check("Application loads (no blank page)", page.locator("nav.side a").count() == 7)
        check("Browser title is SQL Assistant", page.title() == "SQL Assistant", page.title())
        check("Header shows SQL Assistant V17.2.1", page.inner_text("#appName") == "SQL Assistant" and "17.2.1" in page.inner_text(".ver"))
        check("No AP_SQL_Assistant branding in UI", "AP_SQL_Assistant" not in page.content() and "AP SQL Assistant" not in page.content())
        for route, heading in [("readonly", "Read Only Query Builder"), ("cr", "Query Builder for CR"), ("schema-used", "Schema Used"), ("error-rectifier", "Error Rectifier"), ("settings", "Settings"), ("about", "About"), ("quickstart", "Welcome")]:
            page.click(f'nav.side a[data-route="{route}"]'); page.wait_for_selector("main h1")
            check(f"Navigation → {route}", heading in page.inner_text("main h1"))

        # ── Describe What You Need (offline NLU) on the default schema ──
        page.click('a[data-route="readonly"]')
        page.fill("#nlText", "total invoice amount per vendor for approved invoices in the last 30 days, top 10")
        page.click("#nlGenerate"); page.wait_for_selector("#autoOptions")
        sql = page.input_value("#sqlOut")
        check("NLU: aggregation + join + decode filter + date + top N", all(x in sql for x in ["SUM(INVOICE_HEADER.INVOICE_AMOUNT)", "INNER JOIN VENDOR", "INVOICE_HEADER.STATUS = 'A'", "GROUP BY VENDOR.VENDOR_NAME", "FETCH FIRST 10 ROWS ONLY"]), sql)
        check("SQL validated against the Active Schema", "valid against the Active Schema" in page.inner_text("#sqlValidation"))
        page.click("#acceptSql"); page.wait_for_selector(".toast-success")
        learned = page.evaluate("() => window.__sqla.learning.all()[0]?.status")
        check("Accepted query stored as confirmed learning", learned == "confirmed", str(learned))

        # ── Manual selectors + Advanced Options precedence ──
        page.click("#resetRo")
        page.select_option("#tableSelect", ["VENDOR"])
        page.check('[data-col="VENDOR.COUNTRY"]')
        page.select_option("#fCol", "VENDOR.STATUS"); page.select_option("#fOp", "="); page.fill("#fVal", "A"); page.click("#addFilter")
        page.select_option("#sCol", "VENDOR.COUNTRY"); page.select_option("#sDir", "DESC"); page.click("#addSort")
        page.check("#advDistinct"); page.fill("#advLimit", "5"); page.click("#applyAdvanced")
        sql = page.input_value("#sqlOut")
        check("Manual selectors: tables/columns/filters/sorting/DISTINCT/limit", all(x in sql for x in ["SELECT DISTINCT VENDOR.COUNTRY", "WHERE VENDOR.STATUS = 'A'", "ORDER BY VENDOR.COUNTRY DESC", "FETCH FIRST 5 ROWS ONLY"]), sql)
        check("Manual Advanced Options are marked", page.locator(".manual-badge").count() >= 2)
        page.fill("#nlText", "vendor country top 20"); page.click("#nlGenerate"); page.wait_for_selector("#autoOptions")
        check("Manual LIMIT takes precedence over inferred top 20", "FETCH FIRST 5 ROWS ONLY" in page.input_value("#sqlOut"))
        page.select_option("#tableSelect", ["VENDOR", "ORGANIZATION"]); page.select_option("#advJoinType", "LEFT JOIN"); page.click("#applyAdvanced")
        check("Join type override (LEFT JOIN) + automatic join path", "LEFT JOIN ORGANIZATION ON" in page.input_value("#sqlOut"))
        page.select_option("#advGroupBy" if False else "#dialect", "SQL Server")
        check("Dialect switch regenerates SQL (TOP n)", "TOP 5" in page.input_value("#sqlOut"))
        page.click("#releaseManual"); page.click("#resetRo")

        # ── Schema synchronization: V17.0 legacy file with AP schema 77 ──
        inject_repo(page, LEGACY_FILE)
        page.click('a[data-route="settings"]'); page.click('[data-tab="schema-management"]')
        page.click("#syncNow"); page.wait_for_selector("#pullReport")
        report = page.inner_text("#syncDiagnostics")
        check("Repository writer detected as legacy (no writer stamp)", "V17.0 or older" in report and "Legacy schema" in report, report[:300])
        check("AP schema 77: Migration successful", "AP schema 77" in report and "Migration successful" in report)
        check("No schema rejected (was: 1 of 3 failed validation)", "failed validation" not in report and "Migration failed" not in report)
        check("Migration summary mentions all 437 decode values", "437 decode raw value(s)" in report, report[:600])
        published = json.loads(repo_text(page))
        ap = next(s for s in published["schemas"] if s["name"] == "AP schema 77")
        n_decode = sum(len(c.get("decode") or []) for t in ap["tables"] for c in t["columns"])
        check("Migrated schema republished with writer stamp", published.get("writtenBy") == "SQL Assistant 17.2.1" and published.get("formatVersion") == 2)
        check("Published AP schema 77 keeps all 437 decode entries", n_decode == 437, str(n_decode))
        check("Schema list shows 'Migrated schema' status", "Migrated schema" in page.inner_text("#schemaList"))

        # activate AP schema 77 and generate SQL against it
        page.click('#schemaList tr:has-text("AP schema 77") [data-activate]')
        check("Active Schema refreshed to AP schema 77", "AP schema 77" in page.inner_text("#activeSchemaPill"))
        page.click('a[data-route="readonly"]'); page.fill("#nlText", "show action log entries where root document type is Invoice"); page.click("#nlGenerate"); page.wait_for_selector("#autoOptions")
        sql = page.input_value("#sqlOut")
        check("SQL generated from migrated AP schema 77 uses recovered decode code", "IA_ACTION_LOG.ROOT_DOCUMENT_TYPE = 'Invoice.Domain.Invoice'" in sql, sql)
        page.fill("#nlText", "total gross sum per supplier name for invoices in the last 30 days"); page.click("#nlGenerate"); page.wait_for_selector("#autoOptions")
        sql = page.input_value("#sqlOut")
        check("AP schema 77 aggregation query", "SUM(IA_INVOICE.GROSS_SUM)" in sql and "GROUP BY IA_INVOICE.SUPPLIER_NAME" in sql, sql)

        # restart the application, then synchronize again
        corrected = repo_text(page)
        page.reload(); page.wait_for_selector("#appName"); inject_repo(page, corrected)
        check("After restart AP schema 77 is still active", "AP schema 77" in page.inner_text("#activeSchemaPill"))
        page.click('a[data-route="settings"]'); page.click("#syncNow"); page.wait_for_selector("#pullReport")
        report = page.inner_text("#syncDiagnostics")
        check("Re-sync after migration: no migration repeated, nothing rejected", "Migration successful" not in report and "failed validation" not in report and "Up to date" in report, report[:400])

        # second device (fresh browser profile) downloads the corrected file
        ctx2 = browser.new_context(); p2 = ctx2.new_page(); p2.on("pageerror", lambda e: console_errors.append(f"device2: {e}"))
        p2.goto(base); p2.wait_for_selector("#appName"); inject_repo(p2, corrected)
        p2.click('a[data-route="settings"]'); p2.click("#syncNow"); p2.wait_for_selector("#pullReport")
        r2 = p2.inner_text("#syncDiagnostics")
        check("Cross-device: other device reads current-format file (no migration)", "Legacy schema" not in r2 and "AP schema 77" in r2 and "failed validation" not in r2, r2[:300])
        ctx2.close()

        # ── Multiple schemas: invalid among valid; local protection ──
        broken = dict(tiny("Core A")); broken["tables"] = [{"name": "T1", "columns": [{"name": "ID", "type": "NUMBER", "nullable": False, "decode": [{"rawValue": "", "label": "x"}]}]}]
        inject_repo(page, json.dumps({"formatVersion": 2, "writtenBy": "SQL Assistant 17.2", "schemas": [broken, tiny("Core B"), tiny("Fresh One")]}))
        page.click("#pullOnly"); page.wait_for_selector("#pullReport")
        report = page.inner_text("#syncDiagnostics")
        check("Invalid remote schema rejected with exact location", "Invalid schema" in report and "Location: T1.ID" in report, report[:500])
        check("Valid schemas still load independently", "Fresh One" in page.inner_text("#schemaList"))
        check("Local copy kept unchanged", "your local copies were kept unchanged" in report.lower() or "local copy was kept unchanged" in report.lower())
        inject_repo(page, corrected)

        # ── Manual Schema Update: select / edit / save / delete row ──
        page.click('[data-tab="manual-update"]'); page.fill("#muFilter", "IA_ACTION_LOG"); page.press("#muFilter", "Enter"); page.dispatch_event("#muFilter", "change")
        page.click('#muGrid tr[data-row="IA_ACTION_LOG::ACTION_COMMENT"]')
        page.fill("#muDesc", "Edited in browser test"); page.click("#muSave"); page.wait_for_selector("#muChanges")
        st = page.evaluate("() => { const s = window.__sqla.schemas.schemas().find(x => x.name === 'AP schema 77'); return { d: s.tables[0].columns.find(c => c.name === 'ACTION_COMMENT').description, other: s.tables[1].columns[0].description, n: s.tables[0].columns.length }; }")
        check("Edit row saved to centralized schema (row-wise)", st["d"] == "Edited in browser test" and st["other"] == "Primary key. Mirrors IA_ACTION_LOG.", str(st))
        page.click('#muGrid tr[data-row="IA_ACTION_LOG::PARENT_ID"]'); page.click("#muDelete"); page.wait_for_selector("#muChanges")
        n_after = page.evaluate("() => window.__sqla.schemas.schemas().find(x => x.name === 'AP schema 77').tables[0].columns.length")
        check("Delete row removes exactly one column", n_after == st["n"] - 1, f"{st['n']} → {n_after}")
        page.click('#muGrid tr[data-row="ADM_USER_DATA::ID"]') if page.locator('#muGrid tr[data-row="ADM_USER_DATA::ID"]').count() else None
        page.click('[data-tab="schema-management"]'); page.click("#syncNow"); page.wait_for_selector("#pullReport")
        pub = json.loads(repo_text(page)); ap = next(s for s in pub["schemas"] if s["name"] == "AP schema 77")
        check("Manual changes synchronized to repository", any(c["name"] == "ACTION_COMMENT" and c["description"] == "Edited in browser test" for c in ap["tables"][0]["columns"]) and not any(c["name"] == "PARENT_ID" for c in ap["tables"][0]["columns"]))
        corrected = repo_text(page); page.reload(); page.wait_for_selector("#appName"); inject_repo(page, corrected)
        page.click('a[data-route="settings"]'); page.click("#syncNow"); page.wait_for_selector("#pullReport")
        persisted = page.evaluate("() => window.__sqla.schemas.schemas().find(x => x.name === 'AP schema 77').tables[0].columns.find(c => c.name === 'ACTION_COMMENT').description")
        check("Manual change persists after restart + re-sync", persisted == "Edited in browser test")

        # ── Secret Vault ──
        TOKEN = "ghp_" + "Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2"
        page.click('[data-tab="vault"]'); page.fill("#vRepo", "example-org/sql-assistant-data"); page.fill("#vToken", TOKEN); page.click("#vSave"); page.wait_for_function("() => !!localStorage.getItem('sqla.vault.local.v17') && document.querySelector('#vRepo')?.value === 'example-org/sql-assistant-data'")
        storage_dump = page.evaluate("() => JSON.stringify(Object.assign({}, localStorage))")
        check("Vault saved encrypted (token not in browser storage)", TOKEN not in storage_dump and "sqla.vault.local.v17" in storage_dump)
        inject_repo(page, corrected)
        page.fill("#vPass", "short"); page.click("#vPush"); page.wait_for_selector("#vResult .issue-box")
        check("Vault push error handling (weak passphrase rejected)", "at least 10" in page.inner_text("#vResult"))
        page.fill("#vPass", "correct horse battery staple"); page.click("#vPush"); page.wait_for_function("() => document.querySelector('#vResult')?.innerText.includes('pushed')")
        vault_file = page.evaluate("() => window.__repo.files.get('vault/secret-vault.enc.json')?.text")
        check("Pushed vault is AES-GCM encrypted, token not in repository", vault_file and TOKEN not in vault_file and '"AES-256-GCM"' in vault_file)
        page.fill("#vPass", "wrong passphrase value"); page.click("#vPull"); page.wait_for_function("() => document.querySelector('#vResult')?.innerText.includes('failed')")
        check("Retrieve with wrong passphrase fails safely", "wrong or the data was modified" in page.inner_text("#vResult"))
        page.fill("#vPass", "correct horse battery staple"); page.click("#vPull"); page.wait_for_function("() => document.querySelector('#vResult')?.innerText.includes('retrieved')")
        check("Retrieve → decrypt → validate", "decrypted and validated" in page.inner_text("#vResult"))
        check("Token never rendered in the page", TOKEN not in page.content())

        # ── AI/LLM Model ──
        page.click('[data-tab="ai"]')
        check("Setting renamed to AI/LLM Model", "AI/LLM Model" in page.inner_text("main") and "Online AI/NLP Endpoint" not in page.content())
        page.check("#aiEnabled"); page.fill("#aiModel", ""); page.click("#aiSave"); page.wait_for_selector("#aiResult .issue-box")
        check("AI/LLM configuration validation", "Model is required" in page.inner_text("#aiResult"))
        page.select_option("#aiProvider", "custom"); page.fill("#aiModel", "local-model"); page.fill("#aiEndpoint", "http://127.0.0.1:59999/v1/chat/completions"); page.select_option("#aiAuth", "none"); page.fill("#aiTimeout", "1500"); page.click("#aiSave"); page.wait_for_selector(".toast-success")
        page.reload(); page.wait_for_selector("#appName"); page.click('a[data-route="settings"]'); page.click('[data-tab="ai"]')
        check("AI/LLM configuration saved and loaded", page.input_value("#aiModel") == "local-model" and page.is_checked("#aiEnabled"))
        allow_net_errors["on"] = True
        page.click('a[data-route="readonly"]'); page.fill("#nlText", "xyzzy plugh frobnicate"); page.click("#nlGenerate"); page.wait_for_selector("#autoOptions")
        check("Online model unavailable → offline fallback", "offline NLU result is used" in page.inner_text("#autoOptions"))
        allow_net_errors["on"] = False

        # ── Import the original AP schema file (legacy export shape) ──
        page.click('a[data-route="settings"]'); page.click('[data-tab="schema-management"]')
        page.set_input_files("#importFile", str(ROOT / "test/fixtures/ap-schema-77.source.json")); page.fill("#importName", "AP schema 77 import"); page.click("#importBtn")
        page.wait_for_selector(".toast-success")
        check("Import of original legacy export succeeds (77 tables)", "AP schema 77 import" in page.inner_text("#schemaList"))

        check("No critical console/runtime errors", not console_errors, "; ".join(console_errors[:5]))
        browser.close()
    httpd.shutdown()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True)
    (ROOT / "test-results/browser-results.json").write_text(json.dumps([{"check": n, "pass": ok, "detail": d} for n, ok, d in results], indent=2))
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
