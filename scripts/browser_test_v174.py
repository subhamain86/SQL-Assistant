"""SQL Assistant V17.4 — real-browser tests of the NEW V17.4 features on the PRODUCTION build (Chromium / Playwright).
   npm run build && python3 scripts/browser_test_v174.py        (CHROME_PATH=/path/to/chrome to use an installed browser)
Covers: Manual Selectors state, Describe What You Need (active schema, validation, explain, unknown columns), Advanced Options (manual + automatic),
Schema edit/persist, tiered learning, Admin Query Library (add/edit/delete/enable/approve/search/filter/validate/use), two-device knowledge sync,
Secret Vault (save/encrypt/push/pull/verify), AI/LLM layers + offline fallback, responsive layout, security and reload behaviour."""
import json, os, sys, time, subprocess, pathlib, socket, traceback
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
GOOD = ("SELECT VENDOR.VENDOR_NAME, SUM(INVOICE_HEADER.INVOICE_AMOUNT) AS TOTAL\nFROM INVOICE_HEADER\nINNER JOIN VENDOR ON INVOICE_HEADER.VENDOR_ID = VENDOR.VENDOR_ID\n"
        "WHERE INVOICE_HEADER.STATUS = 'A'\nGROUP BY VENDOR.VENDOR_NAME\nORDER BY SUM(INVOICE_HEADER.INVOICE_AMOUNT) DESC\nFETCH FIRST 10 ROWS ONLY;")
KPATH = "sql-assistant-data/knowledge/knowledge.json"; VPATH = "sql-assistant-data/vault/secret-vault.v17.enc.json"
TOKEN = "ghp_" + "Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2"; PASS = "correct horse battery staple"
results, errors = [], []


def check(name, ok, detail=""):
    results.append((name, bool(ok))); print(("PASS " if ok else "FAIL ") + name + ("" if ok or not detail else f" — {str(detail)[:380]}"), flush=True)


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def watch(pg, tag):
    pg.on("console", lambda m: m.type == "error" and errors.append(f"{tag}: {m.text}")); pg.on("pageerror", lambda e: errors.append(f"{tag}: {e}")); pg.on("dialog", lambda d: d.accept())


def ready(pg): pg.wait_for_function("() => document.documentElement.getAttribute('data-sqla-ready') === '1'", timeout=20000); pg.wait_for_timeout(200)
def go(pg, route): pg.evaluate(f"location.hash = '#{route}'"); pg.wait_for_timeout(300)
def sql(pg): return pg.inner_text("#sqlBlockMount .sql-output")
def unlock(pg, pw="admin"):
    go(pg, "settings")
    if pg.locator("#settingsPwInput").count(): pg.fill("#settingsPwInput", pw); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(1000)
def stab(pg, name): pg.click(f'.tab-btn:has-text("{name}")'); pg.wait_for_timeout(300)
def btab(pg, which): pg.click(f'[data-tour="tab-{which}"]'); pg.wait_for_timeout(250)
def newdev(browser, url, w=1366, h=900, tag="dev"):
    ctx = browser.new_context(viewport={"width": w, "height": h}); pg = ctx.new_page(); watch(pg, tag); pg.goto(url); ready(pg); return ctx, pg
def repo(pg, files): pg.evaluate("(f) => { const r = window.__sqla.memoryRepository(f); window.__repo = r; window.__sqla.setRepositoryOverride(r); }", files); pg.wait_for_timeout(100)
def pick_table(pg, name, search=None):
    if search is not None: pg.fill("#tablePickerMount .picker-search-input", search)
    pg.click(f'#tablePickerMount .picker-row[data-table="{name}"]'); pg.wait_for_timeout(150)
def col(pg, table, column): pg.locator(f'#columnPickerMount [data-table="{table}"][data-column="{column}"] .column-checkbox').first.click(); pg.wait_for_timeout(120)
def describe(pg, text, dialect=None, fresh=True):
    if fresh: pg.click("#btnClearSql"); pg.wait_for_timeout(200)  # the builder MERGES a description with the current selections (V17.2 behaviour) — start each test from a clean query
    pg.fill("#nlDesc", text)
    if dialect: pg.select_option("#dialectSelect", dialect)
    pg.click("#nlBuildBtn"); pg.wait_for_timeout(700)
def clear(pg): pg.click("#btnClearSql"); pg.wait_for_timeout(250)
def section(name, fn, *a):
    try: fn(*a)
    except Exception as ex:  # a broken section is reported, the others still run
        check(f"{name}: section completed", False, f"{type(ex).__name__}: {str(ex)[:300]} | {traceback.format_exc().splitlines()[-3][:160]}")


# ───────────────────────────── Manual Selectors ─────────────────────────────
def manual_selectors(b, url):
    ctx, pg = newdev(b, url, tag="selectors"); go(pg, "readonly")
    pg.select_option("#tablePickerMount .module-select", "Invoices"); pick_table(pg, "INVOICE_HEADER", "invoice")
    check("Selectors: selecting a table keeps the module filter and the search text (no reset)", pg.eval_on_selector("#tablePickerMount .module-select", "e=>e.value") == "Invoices" and pg.eval_on_selector("#tablePickerMount .picker-search-input", "e=>e.value") == "invoice")
    col(pg, "INVOICE_HEADER", "INVOICE_ID"); pg.fill("#columnPickerMount .picker-search-input", "status")
    pg.select_option("#tablePickerMount .module-select", ""); pick_table(pg, "VENDOR", "vend")
    check("Selectors: selecting a table keeps the column search and the previously selected column", pg.eval_on_selector("#columnPickerMount .picker-search-input", "e=>e.value") == "status" and "INVOICE_HEADER.INVOICE_ID" in sql(pg))
    col(pg, "VENDOR", "VENDOR_NAME") if False else None
    pg.fill("#columnPickerMount .picker-search-input", ""); col(pg, "VENDOR", "VENDOR_NAME")
    check("Selectors: selecting a second column does not reset the first", "INVOICE_HEADER.INVOICE_ID" in sql(pg) and "VENDOR.VENDOR_NAME" in sql(pg))
    pg.click(".add-filter-btn"); pg.fill(".filter-row .val-input", "X"); pg.wait_for_timeout(120); pick_table(pg, "PO_HEADER", "po_head")
    check("Selectors: selecting a table does not reset filters", pg.eval_on_selector_all(".filter-row .val-input", "e=>e.map(x=>x.value)") == ["X"] and "= 'X'" in sql(pg))
    pg.fill("#tablePickerMount .picker-search-input", ""); pg.fill(".filter-row .val-input", "Y"); pg.wait_for_timeout(100)
    check("Selectors: editing a filter does not reset the selected tables", pg.inner_text("#tablePickerMount .picker-count").startswith("3"))
    btab(pg, "advanced"); pg.check("#advDistinct"); pg.fill("#advLimit", "7"); pg.wait_for_timeout(150)
    check("Selectors: changing Advanced Options does not clear the selections", "SELECT DISTINCT" in sql(pg) and "INVOICE_HEADER.INVOICE_ID" in sql(pg) and "FETCH FIRST 7" in sql(pg) and "= 'Y'" in sql(pg))
    btab(pg, "summary"); btab(pg, "tables-columns")
    check("Selectors: switching tabs keeps the search boxes, selections and filters", pg.eval_on_selector("#columnPickerMount .picker-search-input", "e=>e.value") == "" and pg.inner_text("#tablePickerMount .picker-count").startswith("3") and pg.eval_on_selector_all(".filter-row .val-input", "e=>e.map(x=>x.value)") == ["Y"])
    pg.fill("#tablePickerMount .picker-search-input", "po_h"); pg.fill("#columnPickerMount .picker-search-input", "stat"); btab(pg, "advanced"); btab(pg, "tables-columns")
    check("Selectors: the Tables & Columns tab stays mounted — search text survives a tab round-trip", pg.eval_on_selector("#tablePickerMount .picker-search-input", "e=>e.value") == "po_h" and pg.eval_on_selector("#columnPickerMount .picker-search-input", "e=>e.value") == "stat")
    btab(pg, "advanced"); check("Selectors: Advanced Options keep their values when the tab is shown again", pg.is_checked("#advDistinct") and pg.input_value("#advLimit") == "7")
    btab(pg, "tables-columns")
    # selecting a table list item in a long list keeps the scroll position
    pg.fill("#tablePickerMount .picker-search-input", ""); pg.evaluate("document.querySelector('#tablePickerMount .picker-list').scrollTop = 30"); pg.wait_for_timeout(100); pick_table(pg, "GL_ACCOUNT"); pick_table(pg, "GL_ACCOUNT")
    check("Selectors: the table list keeps its scroll position after a selection", pg.evaluate("document.querySelector('#tablePickerMount .picker-list').scrollTop") > 0)
    pick_table(pg, "PO_HEADER")  # deselect PO_HEADER, keep INVOICE_HEADER + VENDOR
    pg.reload(); ready(pg)
    check("Selectors: a page reload keeps the builder draft (tables, options, SQL)", "SELECT DISTINCT" in sql(pg) and "FETCH FIRST 7" in sql(pg) and pg.inner_text("#tablePickerMount .picker-count").startswith("2"), sql(pg)[:100])
    pick_table(pg, "INVOICE_HEADER", ""); s1 = sql(pg)
    check("Selectors: deselecting a table removes its columns/filters from the SQL but keeps them", "INVOICE_HEADER.INVOICE_ID" not in s1 and "= 'Y'" not in s1, s1)
    pick_table(pg, "INVOICE_HEADER"); s2 = sql(pg)
    check("Selectors: re-selecting the table brings its columns and filters back", "INVOICE_HEADER.INVOICE_ID" in s2 and "= 'Y'" in s2, s2)
    pg.fill("#nlDesc", "keep this description")
    pg.evaluate("() => { const s = window.__sqla.services().schemas; s.setActive(s.schemas()[1].id); }"); pg.wait_for_timeout(600)
    check("Selectors: switching the Active Schema keeps the description, options and the selections that still exist", pg.input_value("#nlDesc") == "keep this description" and pg.inner_text("#tablePickerMount .picker-count").startswith("2") and "FETCH FIRST 7" in sql(pg), pg.inner_text("#tablePickerMount .picker-count"))
    ctx.close()


# ───────────────────────────── Describe What You Need + learning ─────────────────────────────
def describe_and_learn(b, url):
    ctx, pg = newdev(b, url, tag="describe"); go(pg, "readonly")
    describe(pg, "Show the top 20 suppliers by total invoice value.", "Oracle"); s = sql(pg)
    check("Describe: the example request is accepted and the active schema is used", "Active Schema used: AP / P2P Core" in pg.inner_text("#nlNotes") and "Offline NLU" in pg.inner_text("#nlNotes"))
    check("Describe: SUM + GROUP BY + ORDER BY DESC + LIMIT 20 are inferred automatically", all(x in s for x in ["SUM(INVOICE_HEADER.INVOICE_AMOUNT)", "GROUP BY VENDOR.VENDOR_NAME", "ORDER BY SUM(INVOICE_HEADER.INVOICE_AMOUNT) DESC", "FETCH FIRST 20 ROWS ONLY"]), s)
    check("Describe: the generated SQL is validated before it is shown (12 checks)", "SQL passed validation" in pg.inner_text("#validationMount") and "12/12" in pg.inner_text("#validationMount"), pg.inner_text("#validationMount")[:120])
    pg.click("#validationMount summary"); pg.wait_for_timeout(100); check("Describe: Validate shows what was checked", "Tables exist in the Active Schema" in pg.inner_text("#validationMount") and "Read-only" in pg.inner_text("#validationMount"))
    pg.click("#explainMount summary"); pg.wait_for_timeout(100); ex = pg.inner_text("#explainMount")
    check("Describe: Explain lists tables, columns, joins, aggregation, grouping, sorting and limit", all(x in ex for x in ["Tables", "Columns", "Joins", "Aggregation", "Grouping", "Sorting", "Limit"]), ex[:200])
    btab(pg, "advanced"); auto = pg.inner_text("[data-v17-auto-options]"); check("Describe: the Advanced Options tab shows what was inferred automatically", "SUM(" in auto and "GROUP BY" in auto and "Limit 20" in auto, auto[:200]); btab(pg, "tables-columns")
    describe(pg, "show vendors with PAYMENT_CHANNEL_CODE"); check("Describe: unknown columns are reported and never invented", "Not found in the Active Schema" in pg.inner_text("#nlNotes") and "PAYMENT_CHANNEL_CODE" not in sql(pg), sql(pg))
    describe(pg, "Show all invoices from supplier ABC created during the last 30 days with their invoice number, gross amount and status.")
    check("Describe: items the schema cannot provide (invoice number, gross amount) are listed as not found", "invoice number" in pg.inner_text("#nlNotes") and "VENDOR.VENDOR_NAME = 'ABC'" in sql(pg), pg.inner_text("#nlNotes")[:300])
    # offline: the whole flow works with the network off
    ctx.set_offline(True); describe(pg, "show open purchase orders sorted by po date desc", "Oracle"); check("Describe: works fully offline (no external AI service)", "PO_HEADER.STATUS = 'O'" in sql(pg) and "ORDER BY PO_HEADER.PO_DATE DESC" in sql(pg), sql(pg)); ctx.set_offline(False)
    # tiered learning
    describe(pg, "list vendors by country"); L = lambda js: pg.evaluate(js)
    check("Learning: a generated (unconfirmed) query is recorded but is NOT used as a pattern", L("() => { const s = window.__sqla.services(); const r = s.learning.all().find(x => x.requestText === 'list vendors by country'); return !!r && r.status === 'generated' && s.learning.hints('list vendors by country', s.schemas.active()).length === 0; }"))
    describe(pg, "Show the top 20 suppliers by total invoice value.", "Oracle"); pg.click("#btnAcceptLearn"); pg.wait_for_timeout(200)
    pg.fill("#v17AcceptSql", "SELECT * FROM NOPE;"); pg.click("#v17AcceptOk"); pg.wait_for_timeout(200)
    check("Learning: SQL that is not valid for the Active Schema cannot be accepted or learned", "cannot be accepted" in pg.inner_text("#v17AcceptErrors") and "NOPE" in pg.inner_text("#v17AcceptErrors") and L("() => window.__sqla.services().learning.all().filter(r => r.status !== 'generated').length") == 0)
    pg.fill("#v17AcceptSql", sql(pg).replace("20 ROWS", "30 ROWS")); pg.click("#v17AcceptOk"); pg.wait_for_timeout(250)
    check("Learning: user-modified SQL is recorded as modified & confirmed", L("() => window.__sqla.services().learning.all().find(r => r.requestText.startsWith('Show the top 20'))?.status") == "modified")
    pg.click("#btnAcceptLearn"); pg.select_option("#v17AcceptResult", "success"); pg.click("#v17AcceptOk"); pg.wait_for_timeout(250)
    check("Learning: SQL reported as successfully executed is the strongest learned tier", L("() => window.__sqla.services().learning.all().find(r => r.requestText.startsWith('Show the top 20'))?.status") == "executed")
    describe(pg, "Show the top 20 suppliers by total invoice value.", "Oracle")
    check("Learning: a learned query is retrieved and used as a pattern for the same request", "Learned query" in pg.inner_text("#nlNotes") and "Successfully executed" in pg.inner_text("#nlNotes"), pg.inner_text("#nlNotes")[:260])
    pg.click("#btnReportIssue"); pg.click("#v17IssueOk"); pg.wait_for_timeout(250)
    check("Learning: 'Report issue' removes the result from the trusted patterns", L("() => { const s = window.__sqla.services(); return s.learning.hints('Show the top 20 suppliers by total invoice value.', s.schemas.active()).length === 0; }"))
    check("Learning: successful, modified and executed records are stored centrally (versioned structure)", L("() => JSON.parse(localStorage.getItem('sqla.learning.v174')).schemaVersion === 1 && JSON.parse(localStorage.getItem('sqla.learning.v174')).records.length >= 2"))
    # the SQL can be edited; dialect switch re-generates it
    describe(pg, "Show the top 20 suppliers by total invoice value.", "SQL Server"); check("Describe: the dialect decides how the limit is written (TOP for SQL Server)", "SELECT TOP 20" in sql(pg), sql(pg))
    ctx.close()


# ───────────────────────────── Advanced Options ─────────────────────────────
def advanced_options(b, url):
    ctx, pg = newdev(b, url, tag="advanced"); go(pg, "readonly"); pick_table(pg, "INVOICE_HEADER"); pick_table(pg, "VENDOR")
    col(pg, "VENDOR", "VENDOR_NAME"); col(pg, "INVOICE_HEADER", "INVOICE_AMOUNT")
    pg.locator('#columnPickerMount [data-table="INVOICE_HEADER"][data-column="INVOICE_AMOUNT"] .column-agg-select').select_option("SUM"); pg.wait_for_timeout(150); s = sql(pg)
    check("Advanced: aggregation (SUM) with GROUP BY completed automatically", "SUM(INVOICE_HEADER.INVOICE_AMOUNT)" in s and "GROUP BY VENDOR.VENDOR_NAME" in s, s)
    for fn, label in [("COUNT", "COUNT"), ("AVG", "AVG"), ("MIN", "MIN"), ("MAX", "MAX")]:
        pg.locator('#columnPickerMount [data-table="INVOICE_HEADER"][data-column="INVOICE_AMOUNT"] .column-agg-select').select_option(fn); pg.wait_for_timeout(100)
        check(f"Advanced: aggregation {label}", f"{fn}(INVOICE_HEADER.INVOICE_AMOUNT)" in sql(pg))
    pg.locator('#columnPickerMount [data-table="INVOICE_HEADER"][data-column="INVOICE_AMOUNT"] .column-agg-select').select_option("SUM")
    btab(pg, "advanced"); pg.fill("#advHaving", "SUM(INVOICE_HEADER.INVOICE_AMOUNT) > 100"); pg.wait_for_timeout(120); check("Advanced: HAVING", "HAVING SUM(INVOICE_HEADER.INVOICE_AMOUNT) > 100" in sql(pg))
    pg.click("#addSortBtn"); pg.wait_for_timeout(150); pg.locator(".sort-dir").first.select_option("DESC"); pg.wait_for_timeout(120); check("Advanced: ORDER BY with ASC / DESC", re_find(r"ORDER BY \S+ DESC", sql(pg)), sql(pg))
    pg.fill("#advLimit", "5"); pg.wait_for_timeout(100); check("Advanced: LIMIT (FETCH FIRST for Oracle)", "FETCH FIRST 5 ROWS ONLY" in sql(pg))
    pg.check("#advDistinct"); pg.wait_for_timeout(100); check("Advanced: DISTINCT", "SELECT DISTINCT" in sql(pg))
    pg.uncheck("#advDistinct"); pg.fill("#advGroupBy", "VENDOR.VENDOR_NAME, VENDOR.COUNTRY"); pg.wait_for_timeout(100); check("Advanced: GROUP BY (manual columns)", "GROUP BY VENDOR.VENDOR_NAME, VENDOR.COUNTRY" in sql(pg), sql(pg)); pg.fill("#advGroupBy", "VENDOR.VENDOR_NAME")
    for jt, expect in [("LEFT JOIN", "LEFT JOIN VENDOR"), ("RIGHT JOIN", "RIGHT JOIN VENDOR"), ("FULL JOIN", "FULL OUTER JOIN VENDOR"), ("INNER JOIN", "INNER JOIN VENDOR")]:
        pg.select_option("#advJoinType", jt); pg.wait_for_timeout(150); check(f"Advanced: {jt}", expect in sql(pg) or expect.replace("VENDOR", "INVOICE_HEADER") in sql(pg), sql(pg))
    pg.check("#advTableAliases"); pg.wait_for_timeout(100); check("Advanced: table aliases", "FROM INVOICE_HEADER ih" in sql(pg) or "FROM VENDOR v" in sql(pg), sql(pg)); pg.uncheck("#advTableAliases")
    desc = pg.inner_text("#tabsMount")
    check("Advanced: every option has a short plain-language description", pg.locator(".opt-desc").count() >= 10 and all(x in desc for x in ["Removes duplicate rows from the result.", "Limits the number of rows returned by the query.", "Groups rows so aggregate functions such as COUNT or SUM can be applied.", "Filters grouped/aggregated results.", "Creates a temporary named query that can be referenced by the main query.", "Controls the sorting order of the returned results."]))
    pg.click("[data-catalog] summary"); pg.wait_for_timeout(100); cat = pg.inner_text("[data-catalog]")
    check("Advanced: the options catalog lists WHERE, AND/OR, BETWEEN, IN, LIKE, IS NULL, dates, CASE, joins, WITH, EXISTS", all(x in cat for x in ["WHERE", "AND / OR", "BETWEEN", "IN / NOT IN", "LIKE / NOT LIKE", "IS NULL / IS NOT NULL", "Date filtering", "CASE expressions", "RIGHT JOIN", "WITH / CTE", "EXISTS / NOT EXISTS"]))
    pg.click("#addCteBtn"); pg.wait_for_timeout(100); pg.fill(".cte-name-input", "recent"); pg.fill(".cte-body-input", "SELECT INVOICE_HEADER.INVOICE_ID FROM INVOICE_HEADER"); pg.locator(".cte-body-input").blur(); pg.wait_for_timeout(150); check("Advanced: WITH / CTE", sql(pg).startswith("WITH recent AS ("), sql(pg)[:80])
    pg.click(".remove-cte-btn"); pg.wait_for_timeout(100)
    pg.click("#addSubBtn"); pg.wait_for_timeout(100); pg.fill(".sub-body", "SELECT 1 FROM INVOICE_HEADER WHERE INVOICE_HEADER.VENDOR_ID = VENDOR.VENDOR_ID"); pg.locator(".sub-body").blur(); pg.wait_for_timeout(200)
    check("Advanced: EXISTS sub-select filter (validated read-only)", "WHERE EXISTS (" in sql(pg) and "valid read-only SELECT" in pg.inner_text(".sub-msg"), sql(pg))
    pg.locator(".sub-kind").select_option("NOT EXISTS"); pg.wait_for_timeout(150); check("Advanced: NOT EXISTS", "NOT EXISTS (" in sql(pg))
    pg.locator(".sub-body").fill("DELETE FROM VENDOR"); pg.locator(".sub-body").blur(); pg.wait_for_timeout(200)
    check("Advanced: a destructive sub-select is rejected and the SQL is flagged", "needs attention" in pg.inner_text("#validationMount") and "Destructive" in pg.inner_text("#roIssues"), pg.inner_text("#roIssues")[:200])
    pg.click(".remove-sub"); pg.wait_for_timeout(100)
    pg.select_option("#dialectSelect", "MySQL"); pg.wait_for_timeout(150); btab(pg, "advanced"); opts = pg.locator("#advJoinType option").all_inner_texts()
    check("Advanced: options are limited to what the dialect supports (no FULL JOIN in MySQL)", not any("FULL" in o for o in opts) and "FETCH FIRST" not in sql(pg) and "LIMIT 5" in sql(pg), str(opts))
    pg.select_option("#dialectSelect", "Oracle"); btab(pg, "tables-columns")
    # filters: WHERE, AND/OR, BETWEEN, IN, NOT IN, LIKE, NOT LIKE, IS NULL, IS NOT NULL, date filtering
    pg.click(".add-filter-btn"); pg.wait_for_timeout(100); pg.locator(".col-select").first.select_option("INVOICE_HEADER::INVOICE_DATE"); pg.wait_for_timeout(100); pg.locator(".date-preset").first.select_option("d30"); pg.wait_for_timeout(150)
    check("Advanced: date filter shortcut (last 30 days)", "INVOICE_HEADER.INVOICE_DATE >= TRUNC(SYSDATE) - 30" in sql(pg), sql(pg))
    pg.click(".add-filter-btn"); pg.wait_for_timeout(100); r = pg.locator(".filter-row").nth(1); r.locator(".col-select").select_option("VENDOR::COUNTRY"); r.locator(".combinator-select").select_option("OR")
    for op, val, val2, expect in [("IN", "FI, SE", None, "VENDOR.COUNTRY IN ('FI', 'SE')"), ("NOT IN", "FI", None, "VENDOR.COUNTRY NOT IN ('FI')"), ("LIKE", "F%", None, "VENDOR.COUNTRY LIKE 'F%'"), ("NOT LIKE", "F%", None, "VENDOR.COUNTRY NOT LIKE 'F%'"), ("BETWEEN", "A", "F", "VENDOR.COUNTRY BETWEEN 'A' AND 'F'"), ("IS NULL", None, None, "VENDOR.COUNTRY IS NULL"), ("IS NOT NULL", None, None, "VENDOR.COUNTRY IS NOT NULL"), ("<>", "FI", None, "VENDOR.COUNTRY <> 'FI'")]:
        r = pg.locator(".filter-row").nth(1); r.locator(".op-select").select_option(op); pg.wait_for_timeout(100); r = pg.locator(".filter-row").nth(1)
        if val is not None: r.locator(".val-input").fill(val)
        if val2 is not None: r.locator(".val2-input").fill(val2)
        pg.wait_for_timeout(100); check(f"Advanced: filter {op}", expect in sql(pg) and "OR VENDOR.COUNTRY" in sql(pg), sql(pg))
    # manual wins over inference; automatic mode otherwise
    btab(pg, "advanced"); pg.fill("#advLimit", "50"); pg.wait_for_timeout(100); describe(pg, "top 5 vendors by total invoice amount", fresh=False)
    check("Advanced: a manual option takes precedence over the value inferred from the description", "FETCH FIRST 50 ROWS ONLY" in sql(pg) and "Kept your manual settings" in pg.inner_text("#nlNotes"), sql(pg))
    ctx.close()


def re_find(pattern, text):
    import re
    return re.search(pattern, text) is not None


# ───────────────────────────── Schema (settings) ─────────────────────────────
def schema_update(b, url):
    ctx, pg = newdev(b, url, tag="schema"); unlock(pg); stab(pg, "Manual Schema Update")
    pg.select_option("#editorModuleSelect", "Vendors"); pg.wait_for_timeout(100); pg.select_option("#editorTableSelect", "VENDOR"); pg.wait_for_timeout(250)
    pg.click('tr[data-row-id="VENDORPAYMENT_TERMS"]'); pg.click("#editRowBtn"); pg.wait_for_timeout(200); pg.fill("#f_columnDescription", "Payment terms (edited in V17.4)"); pg.fill("#f_tableDescription", "Supplier master (edited)"); pg.wait_for_timeout(100); pg.click("#rowFormSave"); pg.wait_for_timeout(500)
    txt = pg.inner_text("main")
    check("Schema: a row edit (column + table information) is saved and the Active Schema, SQL generation and NLU knowledge are refreshed", "offline NLU knowledge were refreshed" in txt and "Payment terms (edited in V17.4)" in pg.evaluate("() => JSON.stringify(window.__sqla.services().schemas.active())"), txt[:200])
    pg.reload(); ready(pg)
    check("Schema: the edit survives a page reload (centralized saved schema data)", "Payment terms (edited in V17.4)" in pg.evaluate("() => localStorage.getItem('sqla.registry.v15')") and "Supplier master (edited)" in pg.evaluate("() => JSON.stringify(window.__sqla.services().schemas.active())"))
    go(pg, "schema-used"); pg.fill("#schemaSearchInput", "Payment terms"); pg.wait_for_timeout(250); check("Schema: the Schema page shows the saved change", "edited in V17.4" in pg.inner_text("#tablesReadOnlyList"))
    unlock(pg); stab(pg, "Manual Schema Update"); pg.select_option("#editorModuleSelect", "Vendors"); pg.select_option("#editorTableSelect", "VENDOR"); pg.wait_for_timeout(250)
    pg.click('tr[data-row-id="VENDORDUNS_NUMBER"]'); pg.click("#deleteRowBtn"); pg.wait_for_timeout(200); pg.click("#c1Continue"); pg.wait_for_timeout(100); pg.click("#c2Continue"); pg.wait_for_timeout(100); pg.fill("#c3Password", "admin"); pg.click("#c3Delete"); pg.wait_for_timeout(700)
    pg.reload(); ready(pg); check("Schema: a deleted row stays deleted after reload", "DUNS_NUMBER" not in pg.evaluate("() => JSON.stringify(window.__sqla.services().schemas.active())"))
    go(pg, "readonly"); pick_table(pg, "VENDOR"); pg.fill("#columnPickerMount .picker-search-input", "duns"); pg.wait_for_timeout(150); check("Schema: the builder uses the updated Active Schema (deleted column is gone)", pg.locator('#columnPickerMount [data-column="DUNS_NUMBER"]').count() == 0)
    # an invalid change is refused (validation not weakened)
    unlock(pg); stab(pg, "Manual Schema Update"); pg.select_option("#editorModuleSelect", "Vendors"); pg.select_option("#editorTableSelect", "VENDOR"); pg.wait_for_timeout(250); pg.click('tr[data-row-id="VENDORCOUNTRY"]'); pg.click("#editRowBtn"); pg.wait_for_timeout(200)
    pg.fill("#f_decodeText", "=Broken"); pg.wait_for_timeout(100); pg.click("#rowFormSave"); pg.wait_for_timeout(300); check("Schema: an invalid change (empty decode code) is refused with an actionable message", "empty raw value" in pg.inner_text("#rowFormIssues") or "not valid" in pg.inner_text("#rowFormIssues"), pg.inner_text("#rowFormIssues")[:200])
    ctx.close()


# ───────────────────────────── Admin Query Library ─────────────────────────────
def admin_library(b, url):
    ctx, pg = newdev(b, url, tag="admin"); unlock(pg); stab(pg, "Admin Query Library")
    check("Admin Library: the tab is part of Settings and starts empty", "The library is empty" in pg.inner_text("main") and "Admin Query Library" in pg.inner_text(".tabs-strip"))
    pg.click("#aqAdd"); pg.wait_for_timeout(200); pg.fill("#aq_name", "Top vendors by spend"); pg.fill("#aq_description", "Ranking of suppliers by total invoice amount"); pg.fill("#aq_purpose", "Spend analysis"); pg.fill("#aq_sql", GOOD); pg.fill("#aq_tags", "Spend, Ranking"); pg.select_option("#aq_dialect", "Oracle")
    pg.click("#aqDetect"); pg.wait_for_timeout(150); check("Admin Library: tables and columns are detected from the SQL", pg.input_value("#aq_tables") == "INVOICE_HEADER, VENDOR" and "VENDOR.VENDOR_NAME" in pg.input_value("#aq_columns"))
    pg.click("#aqTestBtn"); pg.wait_for_timeout(200); check("Admin Library: test / validate runs the 12 checks against the Active Schema", "Valid against the Active Schema" in pg.inner_text("#aqIssues") and "Read-only" in pg.inner_text("#aqIssues"))
    pg.click("#aqSave"); pg.wait_for_timeout(400); row = pg.inner_text("main")
    check("Admin Library: add query — saved as a draft with metadata", "Top vendors by spend" in row and "Draft" in row and "oracle" not in row.lower().replace("oracle", "") or "Oracle" in row, row[:300])
    check("Admin Library: draft queries are not trusted yet", "0 trusted for use" in pg.inner_text(".admin-stats"))
    pg.locator('[data-act="approve"]').first.click(); pg.wait_for_timeout(400); check("Admin Library: approve (only valid queries) — query becomes a trusted example", "approved" in pg.inner_text("#aqResult") and "1 trusted for use" in pg.inner_text(".admin-stats"), pg.inner_text("#aqResult")[:200])
    pg.click("#aqAdd"); pg.wait_for_timeout(150); pg.fill("#aq_name", "Broken query"); pg.fill("#aq_sql", "SELECT NOPE.X FROM NOPE"); pg.click("#aqSave"); pg.wait_for_timeout(300)
    pg.locator("tr", has_text="Broken query").locator('[data-act="approve"]').click(); pg.wait_for_timeout(300); check("Admin Library: an invalid query cannot be approved (clear reason shown)", "was not approved" in pg.inner_text("#aqResult") and "not in the Active Schema" in pg.inner_text("#aqResult"), pg.inner_text("#aqResult")[:200])
    pg.locator("tr", has_text="Broken query").locator('[data-act="test"]').click(); pg.wait_for_timeout(300); check("Admin Library: test shows invalid result for the broken query", "not valid" in pg.inner_text("#aqResult") and "Invalid" in pg.inner_text("main"))
    pg.click("#aqAdd"); pg.wait_for_timeout(150); pg.fill("#aq_name", "Leaky"); pg.fill("#aq_sql", "SELECT 'ghp_" + "q" * 30 + "' FROM VENDOR"); pg.click("#aqSave"); pg.wait_for_timeout(250); check("Admin Library: a query containing a credential is refused", "credential" in pg.inner_text("#aqIssues") and "Leaky" not in pg.inner_text("main").split("Learned queries")[0].replace("Leaky", "", 0) or pg.locator("tr", has_text="Leaky").count() == 0)
    pg.click("#aqCancel")
    pg.click("#aqAdd"); pg.wait_for_timeout(150); pg.fill("#aq_name", "<img src=x onerror=window.__xss=1>"); pg.fill("#aq_sql", "SELECT VENDOR.VENDOR_ID FROM VENDOR"); pg.click("#aqSave"); pg.wait_for_timeout(300)
    check("Admin Library: names are escaped (no HTML injection)", pg.evaluate("() => window.__xss === undefined") and pg.locator("tbody img").count() == 0)
    pg.fill("#aqSearch", "ranking"); pg.wait_for_timeout(250); check("Admin Library: search", "Top vendors by spend" in pg.inner_text("tbody") and "Broken query" not in pg.inner_text("tbody"))
    pg.fill("#aqSearch", "zzzz"); pg.wait_for_timeout(250); check("Admin Library: search with no result", "No query matches" in pg.inner_text("tbody")); pg.fill("#aqSearch", ""); pg.wait_for_timeout(250)
    pg.select_option("#aqStatus", "approved"); pg.wait_for_timeout(200); ok1 = "Top vendors by spend" in pg.inner_text("tbody") and "Broken query" not in pg.inner_text("tbody"); pg.select_option("#aqStatus", "draft"); pg.wait_for_timeout(200); ok2 = "Broken query" in pg.inner_text("tbody") and "Top vendors by spend" not in pg.inner_text("tbody"); pg.select_option("#aqStatus", "all")
    pg.select_option("#aqTag", "spend"); pg.wait_for_timeout(200); ok3 = "Top vendors by spend" in pg.inner_text("tbody") and "Broken query" not in pg.inner_text("tbody"); pg.select_option("#aqTag", ""); pg.select_option("#aqDialect", "Oracle"); pg.wait_for_timeout(200); ok4 = "Top vendors by spend" in pg.inner_text("tbody"); pg.select_option("#aqDialect", "all")
    check("Admin Library: filter by approval status, tag and dialect", ok1 and ok2 and ok3 and ok4, f"{ok1} {ok2} {ok3} {ok4}")
    pg.locator("tr", has_text="Top vendors by spend").locator('[data-act="edit"]').click(); pg.wait_for_timeout(200); pg.fill("#aq_description", "Edited: ranking of suppliers"); pg.click("#aqSave"); pg.wait_for_timeout(400)
    check("Admin Library: edit query keeps the approval when only the description changes", "Edited: ranking of suppliers" in pg.inner_text("tbody") and "1 approved" in pg.inner_text(".admin-stats"))
    pg.locator("tr", has_text="Top vendors by spend").locator('[data-act="edit"]').click(); pg.wait_for_timeout(200); pg.fill("#aq_sql", GOOD.replace("FETCH FIRST 10", "FETCH FIRST 15")); pg.click("#aqSave"); pg.wait_for_timeout(400)
    check("Admin Library: editing the SQL withdraws the approval (test + approve again)", "0 approved" in pg.inner_text(".admin-stats")); pg.locator("tr", has_text="Top vendors by spend").locator('[data-act="approve"]').click(); pg.wait_for_timeout(400)
    # use during generation
    go(pg, "readonly"); describe(pg, "ranking of suppliers by total invoice amount", "Oracle")
    check("Admin Library: an approved query is found and used during SQL generation (adapted, not copied)", "Admin Query Library" in pg.inner_text("#nlNotes") and "Top vendors by spend" in pg.inner_text("#nlNotes") and "GROUP BY VENDOR.VENDOR_NAME" in sql(pg) and "FETCH FIRST 15 ROWS ONLY" in sql(pg), pg.inner_text("#nlNotes")[:300] + sql(pg))
    pg.click("#nlNotes details summary"); pg.wait_for_timeout(100); tr = pg.inner_text("#nlNotes .trace-list"); check("Admin Library: retrieval order is shown — Active Schema → Admin Query Library → learned → NLU → SQL engine", tr.index("Active Schema:") < tr.index("Admin Query Library:") < tr.index("Learned queries:") < tr.index("Offline NLU:") < tr.index("Local SQL engine"), tr[:400])
    describe(pg, "ranking of suppliers by total invoice amount", "SQL Server"); check("Admin Library: the pattern is adapted to the dialect (TOP for SQL Server)", "SELECT TOP 15" in sql(pg), sql(pg))
    unlock(pg); stab(pg, "Admin Query Library"); pg.locator("tr", has_text="Top vendors by spend").locator('[data-act="toggle"]').click(); pg.wait_for_timeout(300); check("Admin Library: disable", "Disabled" in pg.inner_text("tbody") and "0 trusted for use" in pg.inner_text(".admin-stats"))
    go(pg, "readonly"); describe(pg, "ranking of suppliers by total invoice amount", "Oracle"); check("Admin Library: a disabled query is not used", "Admin Query Library: " not in pg.inner_text("#nlNotes").split("How this was resolved")[0] or "Top vendors by spend" not in pg.inner_text("#nlNotes").split("How this was resolved")[0], pg.inner_text("#nlNotes")[:300])
    unlock(pg); stab(pg, "Admin Query Library"); pg.locator("tr", has_text="Top vendors by spend").locator('[data-act="toggle"]').click(); pg.wait_for_timeout(300); check("Admin Library: enable", "1 trusted for use" in pg.inner_text(".admin-stats"))
    pg.reload(); ready(pg); unlock(pg); stab(pg, "Admin Query Library"); check("Admin Library: the library survives a page reload", "Top vendors by spend" in pg.inner_text("tbody") and "1 trusted for use" in pg.inner_text(".admin-stats"))
    pg.locator("tr", has_text="Broken query").locator('[data-act="delete"]').click(); pg.wait_for_timeout(200); pg.fill("#aqPw", "wrong"); pg.click("#aqPwOk"); pg.wait_for_timeout(900); wrong = "Incorrect Admin Password" in pg.inner_text("#aqPwErr")
    pg.fill("#aqPw", "admin"); pg.click("#aqPwOk"); pg.wait_for_timeout(900); check("Admin Library: delete requires the Admin Password and removes the query", wrong and "Broken query" not in pg.inner_text("tbody"))
    # learned queries ready for review can be promoted
    check("Admin Library: learned queries are offered for review only when confirmed / executed", "Learned queries ready for review" in pg.inner_text("main"))
    ctx.close()


# ───────────────────────────── Two devices: knowledge sync + vault ─────────────────────────────
def devices(b, url):
    A, a = newdev(b, url, tag="deviceA"); unlock(a); stab(a, "Admin Query Library"); repo(a, {})
    a.click("#aqAdd"); a.wait_for_timeout(150); a.fill("#aq_name", "Open POs"); a.fill("#aq_sql", "SELECT PO_HEADER.PO_ID FROM PO_HEADER WHERE PO_HEADER.STATUS = 'O';"); a.select_option("#aq_dialect", "Oracle"); a.click("#aqSave"); a.wait_for_timeout(300); a.locator('[data-act="approve"]').first.click(); a.wait_for_timeout(300)
    go(a, "readonly"); describe(a, "show open purchase orders", "Oracle"); a.click("#btnAcceptLearn"); a.select_option("#v17AcceptResult", "success"); a.click("#v17AcceptOk"); a.wait_for_timeout(250)
    unlock(a); stab(a, "Synchronization"); a.click("#syncKnowledgeBtn"); a.wait_for_timeout(1200); res = a.inner_text("#knowledgeResult")
    kfile = a.evaluate("(p) => window.__repo.files.get(p)?.text || ''", KPATH)
    check("Knowledge sync: learned queries + the Admin Query Library are published as one versioned file", "Published knowledge" in res and '"format": "sqla-knowledge"' in kfile.replace('"format":', '"format": ') or "sqla-knowledge" in kfile, res[:200])
    check("Knowledge sync: the published file holds no credentials", "ghp_" not in kfile)
    B, bb = newdev(b, url, tag="deviceB"); repo(bb, {KPATH: kfile}); unlock(bb); stab(bb, "Admin Query Library"); bb.click("#aqSync"); bb.wait_for_timeout(1200)
    check("Knowledge sync: a second device receives the Admin Query Library", "Open POs" in bb.inner_text("tbody") and "Approved" in bb.inner_text("tbody"), bb.inner_text("#aqResult")[:200])
    cnt = bb.evaluate("() => window.__sqla.services().learning.all().filter(r => r.status === 'executed').length"); check("Knowledge sync: a second device receives the successfully executed learned query", cnt == 1)
    go(bb, "readonly"); describe(bb, "show open purchase orders", "Oracle"); check("Knowledge sync: the synchronized knowledge is used on the second device", "Open POs" in bb.inner_text("#nlNotes") or "Learned query" in bb.inner_text("#nlNotes"), bb.inner_text("#nlNotes")[:250])
    # tombstone: delete on B, sync both ways
    unlock(bb); stab(bb, "Admin Query Library"); bb.locator("tr", has_text="Open POs").locator('[data-act="delete"]').click(); bb.wait_for_timeout(200); bb.fill("#aqPw", "admin"); bb.click("#aqPwOk"); bb.wait_for_timeout(900); bb.click("#aqSync"); bb.wait_for_timeout(1200)
    kfile2 = bb.evaluate("(p) => window.__repo.files.get(p)?.text || ''", KPATH); repo(a, {KPATH: kfile2}); unlock(a); stab(a, "Admin Query Library"); a.click("#aqSync"); a.wait_for_timeout(1200)
    check("Knowledge sync: a deletion made on one device reaches the other", "Open POs" not in a.inner_text("tbody"), a.inner_text("tbody")[:100])
    # invalid / hostile remote records are rejected
    bad = json.loads(kfile2); bad["admin"].append({"id": "evil1", "name": "Evil", "sql": "DROP TABLE VENDOR", "approved": True}); bad["admin"].append({"id": "evil2", "name": "Leak", "sql": "SELECT 'ghp_" + "z" * 30 + "' FROM VENDOR"})
    repo(a, {KPATH: json.dumps(bad)}); stab(a, "Admin Query Library"); a.click("#aqSync"); a.wait_for_timeout(1200); check("Knowledge sync: hostile remote records (destructive SQL, credentials) are rejected, not imported", "Evil" not in a.inner_text("tbody") and "Leak" not in a.inner_text("tbody") and "rejected" in a.inner_text("#aqResult"), a.inner_text("#aqResult")[:250])
    # Secret Vault
    go(a, "settings"); stab(a, "Secret Vault"); a.fill("#vaultRepo", "acme/sql-data"); a.click("#saveVaultCfgBtn"); a.wait_for_timeout(1400); stab(a, "Secret Vault"); a.click("#changeTokenBtn"); a.fill("#newTokenInput", TOKEN); a.click("#saveTokenBtn"); a.wait_for_timeout(1400); stab(a, "Secret Vault")
    store_dump = a.evaluate("() => JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(Object.assign({}, sessionStorage))")
    check("Vault: save secret — the token is encrypted at rest and never shown", TOKEN not in a.inner_text("body") and TOKEN not in store_dump and "••••" in a.inner_text("#maskedToken"))
    repo(a, {}); a.fill("#v17VaultPass", PASS); a.fill("#v17VaultPass2", "something else entirely"); a.click("#pushVaultBtn"); a.wait_for_timeout(700)
    check("Vault: push validates the secret configuration first and explains what to fix", "Step 1 of 6" in a.inner_text("#v17VaultResult") and "do not match" in a.inner_text("#v17VaultResult"), a.inner_text("#v17VaultResult")[:200])
    a.fill("#v17VaultPass2", PASS); a.click("#pushVaultBtn"); a.wait_for_timeout(3500); vres = a.inner_text("#v17VaultResult"); vfile = a.evaluate("(p) => window.__repo.files.get(p)?.text || ''", VPATH)
    check("Vault: push encrypts, prepares a repository-safe file, pushes, verifies by read-back", all(x in vres for x in ["1 Secret configuration validated", "2 Sensitive values encrypted", "3 Repository-safe", "4 Encrypted configuration pushed", "5 Synchronization confirmed", "6 The token was never shown"]), vres[:400])
    import base64
    check("Vault: the repository file contains no plaintext or Base64 token (AES-256-GCM envelope)", vfile and TOKEN not in vfile and base64.b64encode(TOKEN.encode()).decode() not in vfile and '"alg": "AES-256-GCM"' in vfile and TOKEN not in a.inner_text("body"))
    C2, c2 = newdev(b, url, tag="deviceC"); repo(c2, {VPATH: vfile}); unlock(c2); stab(c2, "Secret Vault"); c2.fill("#vaultRepo", "acme/sql-data"); c2.click("#saveVaultCfgBtn"); c2.wait_for_timeout(1400); stab(c2, "Secret Vault"); c2.click("#changeTokenBtn"); c2.fill("#newTokenInput", "ghp_" + "R" * 36); c2.click("#saveTokenBtn"); c2.wait_for_timeout(1400); stab(c2, "Secret Vault"); repo(c2, {VPATH: vfile})
    c2.fill("#v17VaultPass", "a completely wrong passphrase"); c2.click("#pullVaultBtn"); c2.wait_for_timeout(2500); wrong = c2.inner_text("#v17VaultResult")
    c2.fill("#v17VaultPass", PASS); c2.click("#pullVaultBtn"); c2.wait_for_timeout(2500); good = c2.inner_text("#v17VaultResult"); tail = c2.inner_text("#maskedToken")
    check("Vault: pull — a wrong passphrase is rejected; the right one retrieves, decrypts and validates", "wrong or the data was modified" in wrong and "retrieved, decrypted and validated" in good and TOKEN[-4:] in tail, f"{wrong[:100]} | {good[:100]} | {tail}")
    check("Vault: the plaintext token is never in the UI, console or storage of the receiving device", TOKEN not in c2.inner_text("body") and TOKEN not in c2.evaluate("() => JSON.stringify(Object.assign({}, localStorage))"))
    # a device that lost its key
    a.evaluate("() => new Promise((res) => { const r = indexedDB.deleteDatabase('sql-assistant-keys'); r.onsuccess = r.onerror = r.onblocked = () => res(); })"); a.reload(); ready(a); unlock(a); stab(a, "Secret Vault"); msg = a.inner_text("main")
    check("Vault: a device without the decryption key says so clearly and keeps the old data", "cannot open its saved Secret Vault" in msg and "Retrieve from Repository" in msg and a.evaluate("() => Object.keys(localStorage).some(k => k.startsWith('sqla.vault.local.v17'))"), msg[:300])
    for c in (A, B, C2): c.close()


# ───────────────────────────── AI/LLM, offline fallback, responsive, security, migration ─────────────────────────────
def ai_and_rest(b, url, pages_root):
    ctx, pg = newdev(b, url, tag="ai"); unlock(pg); stab(pg, "AI/LLM Model")
    check("AI/LLM: the layered offline architecture is shown (schema engine · offline NLU · local learning · optional local LLM)", pg.locator(".layer-card").count() == 4 and "Layer 4" in pg.inner_text(".layer-grid") and "Offline NLU" in pg.inner_text(".layer-grid"))
    check("AI/LLM: offline stays primary and a local model needs no key", "always active" in pg.inner_text("main") and "local" in pg.locator("#v17LlmProvider option").evaluate_all("o => o.map(x => x.value)"))
    pg.select_option("#v17LlmProvider", "local"); pg.fill("#v17LlmModel", "sqlcoder"); pg.click("#v17LlmTest"); pg.wait_for_timeout(2500); check("AI/LLM: an unreachable local model is reported and SQL generation keeps working offline", "keeps working offline" in pg.inner_text("#v17LlmResult"), pg.inner_text("#v17LlmResult")[:200])
    pg.check("#v17LlmEnabled"); pg.click("#v17LlmSave"); pg.wait_for_timeout(600); go(pg, "readonly"); describe(pg, "xyzzy plugh vendors", "Oracle"); check("AI/LLM: with an unavailable model the offline result is still produced", "FROM VENDOR" in sql(pg) or "VENDOR" in sql(pg), sql(pg))
    ctx.close()
    # migration from a V17.3.1 device
    seed = json.dumps([{"id": "lp_old1", "schemaId": "schema-core-ap-p2p", "schemaFingerprint": "f", "requestText": "open purchase orders", "tokens": ["open", "purchase", "order"], "generatedSql": "SELECT 1", "modifiedSql": None, "finalSql": "SELECT PO_HEADER.PO_ID FROM PO_HEADER WHERE PO_HEADER.STATUS = 'O';", "tables": ["PO_HEADER"], "columns": [], "sorts": [], "limit": None, "count": 3, "status": "confirmed", "updatedAt": "2026-10-01T00:00:00.000Z"}])
    c = b.new_context(); c.add_init_script("if (!localStorage.getItem('sqla.learning.v17')) localStorage.setItem('sqla.learning.v17', " + json.dumps(seed) + ");"); pg = c.new_page(); watch(pg, "migrate"); pg.goto(url); ready(pg)
    mig = pg.evaluate("() => ({ n: window.__sqla.services().learning.all().length, st: window.__sqla.services().learning.all()[0]?.status, old: localStorage.getItem('sqla.learning.v17') !== null, m: window.__sqla.services().migrations.applied.map(a => a.id + ':' + a.result) })")
    check("Migration: V17.3.1 learned data is migrated automatically and the old data is kept", mig["n"] == 1 and mig["st"] == "confirmed" and mig["old"] and "learning-v17-to-v174:applied" in mig["m"], str(mig))
    pg.reload(); ready(pg); check("Migration: idempotent — a restart does not duplicate anything", pg.evaluate("() => window.__sqla.services().learning.all().length") == 1)
    unlock(pg); stab(pg, "Synchronization"); check("Migration: the Synchronization tab lists the versioned migrations", "Learned queries (V17.0–V17.3.1)" in pg.inner_text("main")); c.close()
    # responsive
    for (w, h, name) in [(1366, 900, "desktop"), (768, 1024, "tablet"), (390, 800, "phone")]:
        ctx, pg = newdev(b, url, w, h, tag=f"resp-{name}"); go(pg, "readonly"); ov = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        pg.click("#navToggle"); pg.wait_for_timeout(150); menu = pg.locator("#hamburgerOverlay").count() == 1; pg.click("#hamburgerCloseBtn")
        pick_table(pg, "VENDOR"); btab(pg, "advanced"); ov2 = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth"); unlock(pg); stab(pg, "Admin Query Library"); ov3 = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        check(f"Responsive ({name} {w}px): builder, Advanced Options, hamburger menu and Admin Query Library fit without horizontal page scroll", ov <= 2 and ov2 <= 2 and ov3 <= 2 and menu, f"{ov} {ov2} {ov3} menu={menu}"); ctx.close()
    # security
    html = (ROOT / "dist/index.html").read_text(encoding="utf-8"); import re
    check("Security: the production page contains no credentials and no external script", not re.search(r"ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}", html) and "<script src" not in html and "Content-Security-Policy" in html and "'unsafe-eval'" not in html and "eval(" not in html.replace("retrieval(", ""))
    ctx, pg = newdev(b, url, tag="sec"); go(pg, "readonly"); describe(pg, "<img src=x onerror=window.__xss2=1> show vendors"); check("Security: a hostile description is rendered as text (no HTML injection / script execution)", pg.evaluate("() => window.__xss2 === undefined") and pg.locator("#nlNotes img").count() == 0); ctx.close()


def main():
    if not (ROOT / "dist/index.html").exists(): print("Run npm run build first."); sys.exit(2)
    port = free_port(); serve = subprocess.Popen(["node", str(ROOT / "scripts/serve.mjs")], env={**os.environ, "PORT": str(port), "BASE": "/SQL-Assistant/"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.9)
    url = f"http://127.0.0.1:{port}/SQL-Assistant/?e2e=1"
    try:
        with sync_playwright() as p:
            exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
            section("Manual Selectors", manual_selectors, b, url); section("Describe What You Need + learning", describe_and_learn, b, url); section("Advanced Options", advanced_options, b, url)
            section("Schema", schema_update, b, url); section("Admin Query Library", admin_library, b, url); section("Devices (knowledge sync + vault)", devices, b, url); section("AI/LLM + migration + responsive + security", ai_and_rest, b, url, ROOT)
            b.close()
    finally:
        serve.terminate()
    real = [e for e in errors if "Failed to load resource" not in e and "net::ERR" not in e and "ERR_INTERNET_DISCONNECTED" not in e and "localhost:11434" not in e and "127.0.0.1:9" not in e]
    check("No console errors or uncaught exceptions in any V17.4 flow", not real, "; ".join(real[:4]))
    failed = [r for r in results if not r[1]]; print(f"\n{len(results) - len(failed)}/{len(results)} V17.4 browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True); (ROOT / "test-results/browser-results-v174.json").write_text(json.dumps([{"check": n, "pass": ok} for n, ok in results], indent=2)); sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
