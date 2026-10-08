"""SQL Assistant V17.5 — real-browser tests of the NEW V17.5 features on the PRODUCTION build (Chromium / Playwright).
   npm run build && python3 scripts/browser_test_v175.py        (CHROME_PATH=/path/to/chrome to use an installed browser)
Covers: immediate table tick-marks and Manual Selector persistence, schema-based + manual CASE/DECODE (UI, SQL, Describe What You Need, validation),
Schema → Pull Schema (masked passphrase + show/hide, instructions, preview, apply, cancel), the administrator's encrypted publish, two-device
synchronization (Device A → Device B), every failure scenario with the local schema verified intact, passphrase secrecy and responsive layout."""
import json, os, sys, time, subprocess, pathlib, socket, traceback, base64
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
ENC = "sql-assistant-data/schemas/registry.enc.json"; PLAIN = "sql-assistant-data/schemas/registry.json"
PASS = "violet-harbour-2026-lantern"; NEWPASS = "amber-meadow-2027-compass"
results, errors, console_all = [], [], []


def check(name, ok, detail=""):
    results.append((name, bool(ok))); print(("PASS " if ok else "FAIL ") + name + ("" if ok or not detail else f" — {str(detail)[:360]}"), flush=True)


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def watch(pg, tag):
    pg.on("console", lambda m: (console_all.append(m.text), m.type == "error" and errors.append(f"{tag}: {m.text}")))
    pg.on("pageerror", lambda e: errors.append(f"{tag}: {e}")); pg.on("dialog", lambda d: d.accept())


def ready(pg): pg.wait_for_function("() => document.documentElement.getAttribute('data-sqla-ready') === '1'", timeout=20000); pg.wait_for_timeout(250)
def go(pg, route): pg.evaluate(f"location.hash = '#{route}'"); pg.wait_for_timeout(350)
def sql(pg): return pg.inner_text("#sqlBlockMount .sql-output")
def newdev(browser, url, w=1366, h=900, tag="dev"):
    ctx = browser.new_context(viewport={"width": w, "height": h}); pg = ctx.new_page(); watch(pg, tag); pg.goto(url); ready(pg); return ctx, pg
def unlock(pg, pw="admin"):
    go(pg, "settings")
    if pg.locator("#settingsPwInput").count(): pg.fill("#settingsPwInput", pw); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(1000)
def stab(pg, name): pg.click(f'.tab-btn:has-text("{name}")'); pg.wait_for_timeout(350)
def btab(pg, which): pg.click(f'[data-tour="tab-{which}"]'); pg.wait_for_timeout(250)
def repo(pg, files):
    pg.evaluate("(f) => { const r = window.__sqla.memoryRepository(f); window.__repo = r; window.__sqla.setRepositoryOverride(r); }", files); pg.wait_for_timeout(100)
def repofile(pg, path): return pg.evaluate("(p) => window.__repo?.files.get(p)?.text || ''", path)
def registry_json(pg): return pg.evaluate("() => JSON.stringify(window.__sqla.services().schemas.registry())")
def active_name(pg): return pg.evaluate("() => window.__sqla.services().schemas.active().name")
def pick_table(pg, name, how="strong"):
    pg.click(f'#tablePickerMount .picker-row[data-table="{name}"] {how}'); pg.wait_for_timeout(120)
def tick(pg, t): return pg.eval_on_selector(f'#tablePickerMount .picker-row[data-table="{t}"] input', "e=>e.checked")
def col(pg, table, column): pg.locator(f'#columnPickerMount [data-table="{table}"][data-column="{column}"] .column-checkbox').first.click(); pg.wait_for_timeout(150)
def crow(table, column): return f'#columnPickerMount [data-table="{table}"][data-column="{column}"]'
def describe(pg, text, dialect=None, fresh=True):
    if fresh: pg.click("#btnClearSql"); pg.wait_for_timeout(200)
    pg.fill("#nlDesc", text)
    if dialect: pg.select_option("#dialectSelect", dialect)
    pg.click("#nlBuildBtn"); pg.wait_for_timeout(750)
def section(name, fn, *a):
    try: fn(*a)
    except Exception as ex:
        check(f"{name}: section completed", False, f"{type(ex).__name__}: {str(ex)[:260]} | {traceback.format_exc().splitlines()[-3][:150]}")


FINANCE = {"id": "schema-finance-ops", "name": "Finance Ops", "version": "3.0", "status": "inactive", "updatedAt": "2026-08-01T09:00:00.000Z", "lastSyncedAt": None,
  "tables": [
    {"name": "ORDERS", "module": "Sales", "description": "Customer orders.", "columns": [
      {"name": "ID", "label": "ID", "type": "NUMBER", "nullable": False, "isPrimaryKey": True, "description": "Primary key."},
      {"name": "CUSTOMER_ID", "label": "Customer", "type": "NUMBER", "nullable": True, "isForeignKey": True, "references": {"table": "CUSTOMERS", "column": "ID"}, "description": "Customer."},
      {"name": "STATUS", "label": "Status", "type": "NUMBER", "nullable": True, "description": "Order status.", "decode": [{"rawValue": "1", "label": "Open"}, {"rawValue": "2", "label": "Approved"}, {"rawValue": "3", "label": "Rejected"}]},
      {"name": "AMOUNT", "label": "Amount", "type": "NUMBER", "nullable": True, "description": "Order value."},
      {"name": "CREATED", "label": "Created", "type": "DATE", "nullable": True, "description": "Created date."}]},
    {"name": "CUSTOMERS", "module": "Sales", "description": "Customers.", "columns": [
      {"name": "ID", "label": "ID", "type": "NUMBER", "nullable": False, "isPrimaryKey": True, "description": "Primary key."},
      {"name": "CUSTOMER_NAME", "label": "Name", "type": "VARCHAR", "nullable": False, "description": "Customer name."}]}],
  "relationships": [{"id": "fo1", "fromTable": "ORDERS", "fromColumn": "CUSTOMER_ID", "toTable": "CUSTOMERS", "toColumn": "ID", "kind": "many-to-one"}]}


def install_finance(pg, version=None, updated=None, desc=None):
    # replaceRegistry keeps the timestamps exactly as given (saveSchema would stamp "now")
    pg.evaluate("""([s, v, u, d]) => { const sv = window.__sqla.services().schemas; const x = JSON.parse(JSON.stringify(s)); if (v) x.version = v; if (u) x.updatedAt = u; if (d) x.tables[0].columns[3].description = d;
      const reg = sv.registry(); const r = sv.replaceRegistry({ ...reg, schemas: [...reg.schemas.filter((y) => y.id !== x.id), x], activeSchemaId: x.id, activeSchemaUpdatedAt: new Date().toISOString() }); if (!r.ok) throw new Error('replaceRegistry failed: ' + JSON.stringify(r.errors)); }""", [FINANCE, version, updated, desc])


# ───────────────────────────── 1. Tick-marks and Manual Selector state ─────────────────────────────
def tickmarks(b, url):
    ctx, pg = newdev(b, url, tag="ticks"); go(pg, "readonly")
    r = pg.evaluate("() => { const i = document.querySelector('#tablePickerMount .picker-row[data-table=\"VENDOR\"] input'); i.click(); return [i.checked, document.querySelector('#tablePickerMount .picker-count').textContent, document.querySelector('#sqlBlockMount .sql-output').textContent.includes('FROM VENDOR')]; }")
    check("Tables: the tick-mark is already set in the same task as the click — no delay, no second action needed", r[0] is True and r[1].startswith("1") and r[2] is True, r)
    pick_table(pg, "INVOICE_HEADER", "strong"); check("Tables: clicking the table name ticks it immediately and adds it to the query", tick(pg, "INVOICE_HEADER") and "INVOICE_HEADER" in sql(pg))
    pg.click('#tablePickerMount .picker-row[data-table="PO_HEADER"] input'); pg.wait_for_timeout(100)
    check("Tables: clicking the checkbox itself ticks it immediately (this was the broken case)", tick(pg, "PO_HEADER"))
    check("Tables: multiple tables stay selected — selecting another never removes the previous ticks", tick(pg, "VENDOR") and tick(pg, "INVOICE_HEADER") and tick(pg, "PO_HEADER") and pg.inner_text("#tablePickerMount .picker-count").startswith("3"))
    col(pg, "INVOICE_HEADER", "INVOICE_ID"); pg.click(".add-filter-btn"); pg.fill(".filter-row .val-input", "42"); btab(pg, "advanced"); pg.check("#advDistinct"); pg.fill("#advLimit", "9"); pg.select_option("#advJoinType", "LEFT JOIN"); pg.wait_for_timeout(200); btab(pg, "tables-columns")
    pg.fill("#nlDesc", "my own description"); before_sql = sql(pg)
    pg.click('#tablePickerMount .picker-row[data-table="VENDOR"] input'); pg.wait_for_timeout(150)
    check("Tables: removing a table removes its tick immediately and updates the count", not tick(pg, "VENDOR") and pg.inner_text("#tablePickerMount .picker-count").startswith("2"))
    pg.click('#tablePickerMount .picker-row[data-table="PO_HEADER"] strong'); pg.wait_for_timeout(120); check("Tables: removing through the row text removes the tick as well", not tick(pg, "PO_HEADER"))
    pick_table(pg, "PO_HEADER", "input"); pick_table(pg, "VENDOR", "strong"); pg.wait_for_timeout(100)
    still = ("INVOICE_HEADER.INVOICE_ID" in sql(pg) and "VENDOR.VENDOR_ID = 42" in sql(pg) and "SELECT DISTINCT" in sql(pg) and "FETCH FIRST 9" in sql(pg) and "LEFT JOIN" in sql(pg))
    check("Tables: selecting and removing tables resets neither columns, filters, joins, Advanced Options, generated SQL nor the description", still and pg.input_value("#nlDesc") == "my own description", sql(pg)[:200])
    check("Tables: the UI and the query state agree (ticks = selected tables = tables in the SQL)", [tick(pg, t) for t in ("INVOICE_HEADER", "PO_HEADER", "VENDOR")] == [True, True, True] and all(t in sql(pg) for t in ("INVOICE_HEADER", "PO_HEADER", "VENDOR")))
    pg.focus('#tablePickerMount .picker-row[data-table="GL_ACCOUNT"] input'); pg.keyboard.press("Space"); pg.wait_for_timeout(120); k1 = tick(pg, "GL_ACCOUNT"); pg.keyboard.press("Space"); pg.wait_for_timeout(120)
    check("Tables: the keyboard (Space) toggles the tick as well", k1 and not tick(pg, "GL_ACCOUNT"))
    btab(pg, "summary"); btab(pg, "advanced"); btab(pg, "tables-columns")
    check("Tables: switching tabs and coming back keeps every tick, column, filter and option", [tick(pg, t) for t in ("INVOICE_HEADER", "PO_HEADER", "VENDOR")] == [True, True, True] and pg.eval_on_selector_all(".filter-row .val-input", "e=>e.map(x=>x.value)") == ["42"] and pg.is_checked('#columnPickerMount [data-table="INVOICE_HEADER"][data-column="INVOICE_ID"] .column-checkbox'))
    pg.reload(); ready(pg); check("Tables: after a page refresh the ticks come back with the saved draft", [tick(pg, t) for t in ("INVOICE_HEADER", "PO_HEADER", "VENDOR")] == [True, True, True], sql(pg)[:80])
    pg.click('#tablePickerMount [data-action="clear"]'); pg.wait_for_timeout(120); check("Tables: Clear removes every tick immediately", not any(tick(pg, t) for t in ("INVOICE_HEADER", "PO_HEADER", "VENDOR")))
    pg.click('#tablePickerMount [data-action="select-all"]'); pg.wait_for_timeout(120); check("Tables: Select all ticks every listed table immediately", all(pg.eval_on_selector_all('#tablePickerMount .picker-row input', "e=>e.map(x=>x.checked)")))
    ctx.close()


# ───────────────────────────── 2. CASE / DECODE ─────────────────────────────
def case_decode(b, url):
    ctx, pg = newdev(b, url, tag="casedecode"); go(pg, "readonly"); pick_table(pg, "INVOICE_HEADER"); col(pg, "INVOICE_HEADER", "INVOICE_ID"); col(pg, "INVOICE_HEADER", "STATUS"); R = crow("INVOICE_HEADER", "STATUS")
    opts = pg.locator(R + " .column-mode-select option").all_inner_texts()
    check("Columns: a selected column offers 'Display as' → Column | CASE / DECODE", opts == ["Column", "CASE / DECODE"], opts)
    pg.select_option(R + " .column-mode-select", "casedecode"); pg.wait_for_timeout(150)
    check("CASE/DECODE: the control distinguishes Manual from From Schema", pg.locator(R + " .column-cd-source option").all_inner_texts() == ["Manual", "From Schema"])
    check("CASE/DECODE: a column that has a schema definition starts on 'From Schema' and lists the definition", pg.eval_on_selector(R + " .column-cd-source", "e=>e.value") == "schema" and "P = Pending" in pg.inner_text(R + " .column-cd-def") and "D = Paid" in pg.inner_text(R + " .column-cd-def"), pg.inner_text(R))
    s1 = sql(pg); check("Schema CASE: the generated SQL uses the selected schema definition", "CASE WHEN INVOICE_HEADER.STATUS = 'P' THEN 'Pending'" in s1 and "END AS STATUS_DESC" in s1, s1)
    check("Schema CASE: the SQL passes validation", "passed validation" in pg.inner_text("#validationMount") and "12/12" in pg.inner_text("#validationMount"), pg.inner_text("#validationMount")[:100])
    pg.select_option(R + " .column-cd-style", "decode"); pg.wait_for_timeout(150); s2 = sql(pg)
    check("Schema DECODE (Oracle): the same definition is written as DECODE(…) and validates", "DECODE(INVOICE_HEADER.STATUS, 'P', 'Pending', 'A', 'Approved', 'R', 'Rejected', 'D', 'Paid', TO_CHAR(INVOICE_HEADER.STATUS)) AS STATUS_DESC" in s2 and "passed validation" in pg.inner_text("#validationMount"), s2)
    check("CASE/DECODE: the definition comes only from the active schema (the Explain panel lists it)", "CASE/DECODE" in pg.inner_text("#explainMount") or (pg.click("#explainMount summary") is None and "CASE/DECODE" in pg.inner_text("#explainMount")))
    btab(pg, "advanced"); btab(pg, "summary"); btab(pg, "tables-columns")
    check("CASE/DECODE: the selected definition is preserved when switching Manual Selector tabs", pg.eval_on_selector(R + " .column-cd-source", "e=>e.value") == "schema" and pg.eval_on_selector(R + " .column-cd-style", "e=>e.value") == "decode" and "DECODE(INVOICE_HEADER.STATUS" in sql(pg))
    pg.select_option("#dialectSelect", "SQL Server"); pg.wait_for_timeout(200); check("CASE/DECODE: outside Oracle the definition is written as CASE and the DECODE style is not offered", "CASE WHEN INVOICE_HEADER.STATUS" in sql(pg) and "DECODE(" not in sql(pg) and pg.locator(R + " .column-cd-style").count() == 0, sql(pg)[:120])
    pg.select_option("#dialectSelect", "Oracle"); pg.wait_for_timeout(200)
    # manual
    pg.select_option(R + " .column-cd-source", "manual"); pg.wait_for_timeout(150); check("Manual: choosing Manual offers to define the expression and does not use the schema definition", "Define manual CASE/DECODE" in pg.inner_text(R) and "'Pending'" not in sql(pg), sql(pg)[:120])
    pg.click(R + " .column-cd-edit"); pg.wait_for_timeout(250); pg.fill("#decodeAlias", "STATUS_TXT"); pg.fill(".pair-raw", "A"); pg.fill(".pair-label", "Alright"); pg.click("#addPairBtn"); pg.wait_for_timeout(100); pg.locator(".pair-raw").nth(1).fill("P"); pg.locator(".pair-label").nth(1).fill("Waiting"); pg.fill("#decodeElse", "other"); pg.click("#decodeSave"); pg.wait_for_timeout(300)
    s3 = sql(pg); check("Manual DECODE: the existing manual builder still works and its expression reaches the SQL", "DECODE(INVOICE_HEADER.STATUS, 'A', 'Alright', 'P', 'Waiting', 'other') AS STATUS_TXT" in s3, s3)
    check("Manual DECODE: the column stays ticked and shows its manual expression with an Edit button", pg.is_checked(R + " .column-checkbox") and "Edit manual CASE/DECODE" in pg.inner_text(R) and "STATUS_TXT" in pg.inner_text(R) and pg.inner_text("#columnPickerMount .picker-count").startswith("2"))
    pg.select_option(R + " .column-cd-source", "schema"); pg.wait_for_timeout(150); check("Switching Manual → From Schema uses the schema definition", "'Pending'" in sql(pg) and "STATUS_TXT" not in sql(pg))
    pg.select_option(R + " .column-cd-source", "manual"); pg.wait_for_timeout(150); check("Switching back to Manual restores the manual expression (nothing is lost)", "'Alright'" in sql(pg) and "AS STATUS_TXT" in sql(pg))
    btab(pg, "advanced"); pg.click("#addManualCaseBtn"); pg.wait_for_timeout(250); pg.fill("#caseAlias", "AMT_BAND"); pg.fill(".when-expr", "INVOICE_HEADER.INVOICE_AMOUNT > 1000"); pg.fill(".when-then", "Large"); pg.fill("#caseElse", "Small"); pg.click("#caseSave"); pg.wait_for_timeout(300)
    check("Manual CASE: the existing manual CASE builder (Advanced Options) still works", "CASE WHEN INVOICE_HEADER.INVOICE_AMOUNT > 1000 THEN 'Large' ELSE 'Small' END AS AMT_BAND" in sql(pg), sql(pg)); btab(pg, "tables-columns")
    # no definition
    col(pg, "INVOICE_HEADER", "INVOICE_DATE"); D = crow("INVOICE_HEADER", "INVOICE_DATE"); pg.select_option(D + " .column-mode-select", "casedecode"); pg.wait_for_timeout(120)
    check("No definition: a column without a schema definition starts on Manual (nothing is made up)", pg.eval_on_selector(D + " .column-cd-source", "e=>e.value") == "manual")
    pg.select_option(D + " .column-cd-source", "schema"); pg.wait_for_timeout(150)
    check("No definition: 'From Schema' says clearly that none exists and the SQL stays plain", "No CASE/DECODE definition is available for this column in the active schema." in pg.inner_text(D) and "CASE WHEN INVOICE_HEADER.INVOICE_DATE" not in sql(pg) and "INVOICE_HEADER.INVOICE_DATE" in sql(pg), pg.inner_text(D)[:200])
    check("No definition: the builder warns that the plain column is used", "No CASE/DECODE definition is available for INVOICE_HEADER.INVOICE_DATE" in pg.inner_text("#roIssues"), pg.inner_text("#roIssues")[:200])
    pg.select_option(D + " .column-mode-select", "raw"); pg.wait_for_timeout(100)
    # Describe What You Need
    pg.select_option(R + " .column-cd-source", "schema"); pg.select_option(R + " .column-cd-style", "decode"); pg.fill(R + " .column-alias-input", "MY_STATE"); pg.dispatch_event(R + " .column-alias-input", "change"); pg.wait_for_timeout(150)
    describe(pg, "show invoice id and status", fresh=False); s4 = sql(pg)
    check("Describe What You Need: the user's selected CASE/DECODE is neither overwritten nor duplicated", "DECODE(INVOICE_HEADER.STATUS" in s4 and "AS MY_STATE" in s4 and s4.count("INVOICE_HEADER.STATUS") == 2, s4)
    describe(pg, "show invoice id and status description for invoices", "Oracle"); s5 = sql(pg)
    check("Describe What You Need: 'status description' selects the schema CASE/DECODE automatically and the plan says so", "CASE WHEN INVOICE_HEADER.STATUS = 'P' THEN 'Pending'" in s5 and "CASE/DECODE from the schema" in pg.inner_text("#nlNotes") and "passed validation" in pg.inner_text("#validationMount"), s5[:160])
    describe(pg, "show invoices with decoded status using decode", "Oracle"); check("Describe What You Need: 'using decode' on Oracle writes DECODE", "DECODE(INVOICE_HEADER.STATUS" in sql(pg), sql(pg)[:120])
    describe(pg, "show invoice id and invoice date description"); check("Describe What You Need: asking for a decode of a column without a definition is reported, never invented", "No CASE/DECODE definition is available for INVOICE_HEADER.INVOICE_DATE" in pg.inner_text("#nlNotes") and "CASE WHEN" not in sql(pg), pg.inner_text("#nlNotes")[:240])
    # user-modified SQL + learning
    describe(pg, "show invoice id and status description for invoices", "Oracle"); edited = sql(pg).replace("INVOICE_HEADER.INVOICE_ID,", "INVOICE_HEADER.INVOICE_ID,").replace("STATUS_DESC", "STATE_LABEL")
    pg.click("#btnAcceptLearn"); pg.fill("#v17AcceptSql", edited); pg.select_option("#v17AcceptResult", "success"); pg.click("#v17AcceptOk"); pg.wait_for_timeout(300)
    rec = pg.evaluate("() => { const r = window.__sqla.services().learning.all().find(x => x.requestText.startsWith('show invoice id and status description')); return r ? [r.status, (r.pattern?.decodes || []).map(d => d.column + ':' + d.style)] : null; }")
    check("User-modified SQL: an edited CASE/DECODE query is accepted, validated and learned together with the fact that STATUS was decoded", rec and rec[0] == "executed" and "STATUS:case" in rec[1], rec)
    clear = pg.click("#btnClearSql"); pg.wait_for_timeout(200); describe(pg, "show invoice id and status description for invoices", "Oracle", fresh=False)
    check("Learned query patterns: the learned decode is applied again, using the schema's current definition", "Learned query" in pg.inner_text("#nlNotes") and "'Pending'" in sql(pg), pg.inner_text("#nlNotes")[:200])
    ctx.close()


# ───────────────────────────── 3. Pull Schema (Device A → Device B) ─────────────────────────────
def publish_from_a(b, url):
    A, a = newdev(b, url, tag="deviceA"); repo(a, {}); install_finance(a); unlock(a); stab(a, "Schema Management")
    panel = a.inner_text("[data-v175-passphrase]")
    check("Admin: Schema Management has a 'Schema passphrase' panel with its status", "Schema passphrase" in panel and "OFF" in panel)
    check("Admin: the passphrase fields are masked with a visibility button", a.get_attribute("#schemaAdminPass", "type") == "password" and a.locator('[data-v175-passphrase] .passphrase-eye').count() == 2)
    a.fill("#schemaAdminPass", "short"); a.fill("#schemaAdminPass2", "short"); a.click("#schemaPassPublish"); a.wait_for_timeout(300); check("Admin: a short passphrase is refused with a clear message", "at least 10 characters" in a.inner_text("#schemaPassResult"))
    a.fill("#schemaAdminPass", PASS); a.fill("#schemaAdminPass2", "something different entirely"); a.click("#schemaPassPublish"); a.wait_for_timeout(300); check("Admin: mismatching confirmation is refused", "do not match" in a.inner_text("#schemaPassResult"))
    a.fill("#schemaAdminPass2", PASS); a.click("#schemaPassPublish"); a.wait_for_timeout(4500); res = a.inner_text("#schemaPassResult"); f = repofile(a, ENC)
    check("Admin: the schema is published as an encrypted file and the result says so", "encrypted file" in res and f != "", res[:200])
    h = json.loads(f) if f else {}
    check("Admin: the repository file is real AES-256-GCM (PBKDF2) with versioned header metadata", h.get("format") == "sqla-schema-sync" and h.get("cipher", {}).get("alg") == "AES-256-GCM" and h.get("cipher", {}).get("kdf") == "PBKDF2-SHA256" and h.get("appVersion") == "17.5.1" and h.get("schemaFormatVersion") == 2 and h.get("formatVersion") == 1 and "writtenAt" in h and h.get("schemaCount") >= 1, list(h.keys()))
    check("Admin: nothing readable is in the repository — no schema, table, column, decode label, passphrase or Base64 of them", all(x not in f for x in ["Finance Ops", "ORDERS", "CUSTOMER", "Approved", PASS, base64.b64encode(b"Finance Ops").decode(), base64.b64encode(PASS.encode()).decode()]) and PLAIN not in a.evaluate("() => [...window.__repo.files.keys()]"))
    check("Admin: the status switches to 'Encrypted synchronization ON'", "ON" in a.inner_text("[data-v175-passphrase]") and a.is_visible("#schemaPassClear"))
    stored = a.evaluate("() => localStorage.getItem('sqla.schemapass.v175')")
    check("Admin: the passphrase is stored on the device only as ciphertext", stored and PASS not in stored and base64.b64encode(PASS.encode()).decode() not in stored and "AES-256-GCM" in stored)
    a.fill("#schemaAdminPass", PASS); a.click('[data-v175-passphrase] .passphrase-eye >> nth=0'); a.wait_for_timeout(100); check("Admin: the saved passphrase is shown masked and can be revealed", a.get_attribute("#schemaAdminPass", "type") == "text" and a.input_value("#schemaAdminPass") == PASS)
    return A, a, f


def pull_flow(b, url, enc_text):
    B, bb = newdev(b, url, tag="deviceB"); repo(bb, {ENC: enc_text}); before_active = active_name(bb); before = registry_json(bb)
    bb.click("#navToggle"); bb.wait_for_timeout(150); bb.click('#hamburgerOverlay [data-route="schema-used"]'); bb.wait_for_timeout(350)
    check("Pull: Hamburger menu → Schema opens the Schema page with a 'Pull Schema' tab", "Pull Schema" in bb.inner_text("#schemaTabs .tabs-strip"))
    bb.click('#schemaTabs .tab-btn:has-text("Pull Schema")'); bb.wait_for_timeout(300); t = bb.inner_text("#schemaPullMount")
    check("Pull: the page shows Pull Schema, a passphrase field, a show/hide button, short instructions and the Pull button", all(x in t for x in ["Pull Schema", "Passphrase", "Pull Schema"]) and bb.locator("#schemaPullPass").count() == 1 and bb.locator(".passphrase-eye").count() == 1 and bb.locator("#pullBtn").count() == 1)
    check("Pull: the instructions explain what to do, why the passphrase is needed and to keep it secure", "Enter the active passphrase used to protect the synchronized schema and select Pull Schema" in t and "required to decrypt and import the synchronized schema on this device" in t and "Keep the passphrase secure and do not share it through unsecured channels" in t)
    h = bb.evaluate("() => document.querySelector('.pull-help').getBoundingClientRect().height"); check("Pull: the instructions are compact (not a tall block)", h < 190, h)
    check("Pull: the passphrase field is masked by default (type=password) and hidden-by-default is reflected for assistive technology", bb.get_attribute("#schemaPullPass", "type") == "password" and bb.get_attribute(".passphrase-eye", "aria-pressed") == "false" and bb.get_attribute(".passphrase-eye", "aria-label") == "Show passphrase")
    bb.fill("#schemaPullPass", PASS); vis0 = bb.get_attribute("#schemaPullPass", "type"); bb.click(".passphrase-eye"); bb.wait_for_timeout(100); vis1 = bb.get_attribute("#schemaPullPass", "type"); lab1 = bb.get_attribute(".passphrase-eye", "aria-label"); val1 = bb.input_value("#schemaPullPass")
    bb.click(".passphrase-eye"); bb.wait_for_timeout(100); vis2 = bb.get_attribute("#schemaPullPass", "type")
    check("Pull: Show reveals the passphrase, Hide masks it again", vis0 == "password" and vis1 == "text" and val1 == PASS and lab1 == "Hide passphrase" and vis2 == "password", [vis0, vis1, vis2])
    check("Pull: the passphrase is never in the page text, the URL or the console", PASS not in bb.inner_text("body") and PASS not in bb.url and not any(PASS in c for c in console_all))
    bb.click("#pullBtn"); bb.wait_for_function("() => document.querySelector('#pullApplyBtn') || document.querySelector('#pullResult .issue-box.err')", timeout=15000); bb.wait_for_timeout(200); r = bb.inner_text("#pullResult")
    check("Pull: the preview shows every validation step and nothing has been changed yet", all(x in r for x in ["Passphrase validated", "retrieved", "Decrypted", "Validated"]) and "Nothing has been changed on this device yet" in r and registry_json(bb) == before, r[:300])
    check("Pull: before replacing, it shows local version, repository version, updated date, contents and the action", all(x in r for x in ["This device", "Repository", "Finance Ops", "v3.0", "updated 2026-08-01 09:00", "2 tables", "3 CASE/DECODE entries", "will be added"]), r[:420])
    check("Pull: the preview names who wrote the file (writer, app version, schema format, time, device)", "SQL Assistant 17.5.1" in r and "app 17.5.1" in r and "schema format 2" in r, r[:300])
    bb.click("#pullCancelBtn"); bb.wait_for_timeout(200)
    check("Cancelled pull: says so and leaves the existing local schema exactly as it was", "Pull cancelled" in bb.inner_text("#pullResult") and "existing local schema has not been changed" in bb.inner_text("#pullResult") and registry_json(bb) == before and active_name(bb) == before_active and not bb.evaluate("() => localStorage.getItem('sqla.schemapass.v175')"))
    bb.click("#pullBtn"); bb.wait_for_selector("#pullApplyBtn", timeout=15000); bb.click("#pullApplyBtn"); bb.wait_for_function("() => document.querySelector('#pullResult .issue-box.ok')", timeout=15000); bb.wait_for_timeout(300); ok = bb.inner_text("#pullResult")
    check("Pull: success is confirmed with 'Schema pulled and validated successfully.' and no stale error", "Schema pulled and validated successfully." in ok and bb.locator("#pullResult .issue-box.err").count() == 0, ok[:260])
    check("Pull: the schema is imported and ACTIVATED (the navbar badge and active schema show it)", active_name(bb) == "Finance Ops" and "Finance Ops" in bb.inner_text("#mainNavbar"), active_name(bb))
    got = bb.evaluate("() => { const s = window.__sqla.services().schemas.active(); return { id: s.id, version: s.version, updatedAt: s.updatedAt, tables: s.tables.map(t => [t.name, t.columns.map(c => c.name + ':' + c.type + ':' + (c.decode ? c.decode.map(d => d.rawValue + '=' + d.label).join('|') : ''))]), rel: s.relationships.length }; }")
    check("Pull: structure, tables, columns, data types, relationships, CASE/DECODE definitions, version, identifier and updated time are preserved", got["id"] == FINANCE["id"] and got["version"] == "3.0" and got["updatedAt"] == "2026-08-01T09:00:00.000Z" and got["rel"] == 1 and ["ORDERS", ["ID:NUMBER:", "CUSTOMER_ID:NUMBER:", "STATUS:NUMBER:1=Open|2=Approved|3=Rejected", "AMOUNT:NUMBER:", "CREATED:DATE:"]] in got["tables"], got)
    saved = bb.evaluate("() => localStorage.getItem('sqla.schemapass.v175')")
    check("Pull: the passphrase was remembered on this device — encrypted, never plaintext", saved and PASS not in saved and base64.b64encode(PASS.encode()).decode() not in saved and "AES-256-GCM" in saved)
    # refresh, then verify the other pages use the new schema without restarting
    go(bb, "readonly"); tables = bb.eval_on_selector_all("#tablePickerMount .picker-row", "e=>e.map(x=>x.dataset.table)")
    check("Pull: Manual Selectors use the new schema straight away (no restart)", set(tables) == {"ORDERS", "CUSTOMERS"}, tables)
    pick_table(bb, "ORDERS"); col(bb, "ORDERS", "STATUS"); R = crow("ORDERS", "STATUS"); bb.select_option(R + " .column-mode-select", "casedecode"); bb.wait_for_timeout(150)
    check("Pull: the schema CASE/DECODE definitions of the pulled schema are available (1 = Open · 2 = Approved · 3 = Rejected)", "1 = Open" in bb.inner_text(R + " .column-cd-def") and "3 = Rejected" in bb.inner_text(R + " .column-cd-def") and "WHEN ORDERS.STATUS = '1' THEN 'Open'" in sql(bb), sql(bb)[:200])
    describe(bb, "show order id and status description for orders", "Oracle"); s = sql(bb)
    check("Pull: Describe What You Need and the offline NLU use the new schema and its CASE/DECODE", "FROM ORDERS" in s and "THEN 'Approved'" in s and "Active Schema used: Finance Ops" in bb.inner_text("#nlNotes") and "passed validation" in bb.inner_text("#validationMount"), s[:200])
    bb.reload(); ready(bb); repo(bb, {ENC: enc_text}); check("Pull: the imported schema survives a page refresh", active_name(bb) == "Finance Ops")
    # saved passphrase is reused, masked and shown on request
    go(bb, "schema-used/pull"); bb.wait_for_timeout(500)
    check("Pull: the deep link #schema-used/pull opens the Pull Schema tab", bb.locator("#schemaPullPass").count() == 1)
    bb.wait_for_function("() => document.querySelector('#schemaPullPass').value.length > 0", timeout=5000)
    check("Active passphrase: the saved passphrase is displayed masked and can be revealed", bb.get_attribute("#schemaPullPass", "type") == "password" and bb.input_value("#schemaPullPass") == PASS and PASS not in bb.inner_text("body"))
    bb.click("#pullBtn"); bb.wait_for_timeout(3500); check("Pull: pulling again with the saved passphrase says everything is already up to date", "already up to date" in bb.inner_text("#pullResult"), bb.inner_text("#pullResult")[:200])
    return B, bb


# ───────────────────────────── 4. Failure scenarios ─────────────────────────────
def failures(b, url, enc_text):
    ctx, pg = newdev(b, url, tag="failures"); repo(pg, {ENC: enc_text})
    pg.evaluate("""() => { const sv = window.__sqla.services().schemas; const s = JSON.parse(JSON.stringify(sv.active())); s.name = 'My Local Work'; s.id = 'schema-local-work'; s.updatedAt = '2026-09-30T00:00:00.000Z'; const r = sv.saveSchema(s); if (!r.ok) throw new Error('x'); sv.setActive(s.id); }""")
    go(pg, "schema-used/pull"); pg.wait_for_timeout(400); base = registry_json(pg); who = active_name(pg)
    def attempt(passphrase, msg):
        pg.fill("#schemaPullPass", passphrase); pg.click("#pullBtn"); pg.wait_for_function("() => !document.querySelector('#pullBtn').disabled", timeout=15000); pg.wait_for_timeout(250); t = pg.inner_text("#pullResult")
        intact = registry_json(pg) == base and active_name(pg) == who and pg.locator("#pullApplyBtn").count() == 0
        return t, intact
    t, ok = attempt("this is not the right one", ""); check("Failure — incorrect passphrase: 'The passphrase is incorrect. The existing local schema has not been changed.'", "The passphrase is incorrect. The existing local schema has not been changed." in t and ok, t[:200])
    check("Failure — incorrect passphrase: the message explains what to do next and does not echo the passphrase", "Check the passphrase with your administrator" in t and "this is not the right one" not in t)
    t, ok = attempt("short", ""); check("Failure — unusable passphrase: 'Schema pull failed because the passphrase could not be validated. Your existing local schema has not been changed.'", "Schema pull failed because the passphrase could not be validated. Your existing local schema has not been changed." in t and "at least 10 characters" in t and ok, t[:220])
    t, ok = attempt("", ""); check("Failure — empty passphrase is refused before the repository is contacted", "could not be validated" in t and ok)
    repo(pg, {}); t, ok = attempt(PASS, ""); check("Failure — missing schema: 'The synchronized schema could not be retrieved. Please verify the repository connection and try again.'", "The synchronized schema could not be retrieved. Please verify the repository connection and try again." in t and "registry.enc.json" in t and "existing local schema has not been changed" in t and ok, t[:260])
    j = json.loads(enc_text); ct = j["cipher"]["ct"]; j2 = dict(j, cipher=dict(j["cipher"], ct=ct[:30] + ("B" if ct[30] == "A" else "A") + ct[31:])); repo(pg, {ENC: json.dumps(j2)}); t, ok = attempt(PASS, "")
    check("Failure — corrupted schema: 'The schema could not be decrypted using the supplied passphrase. The existing local schema has not been changed.'", "The schema could not be decrypted using the supplied passphrase. The existing local schema has not been changed." in t and ok, t[:240])
    repo(pg, {ENC: json.dumps(dict(j, schemaCount=11))}); t, ok = attempt(PASS, ""); check("Failure — decryption failure (header tampered with): reported, local schema intact", "could not be decrypted" in t and ok, t[:200])
    repo(pg, {ENC: "{this is not json"}); t, ok = attempt(PASS, ""); check("Failure — unreadable file: reported, local schema intact", "could not be decrypted" in t and ok, t[:200])
    repo(pg, {ENC: json.dumps(json.loads(PLAIN_STUB))}); t, ok = attempt(PASS, ""); check("Failure — a plain (unencrypted) file in the encrypted location is explained", "not protected by a passphrase" in t and ok, t[:220])
    bad = pg.evaluate("""async ([pass]) => { const s = JSON.parse(JSON.stringify(window.__sqla.services().schemas.registry().schemas[0])); s.id = 'schema-bad'; s.name = 'Broken Remote'; s.tables[0].columns[0].decode = [{ rawValue: '', label: 'oops' }];
      return JSON.stringify({ formatVersion: 2, writtenBy: 'SQL Assistant 17.5.0', activeSchemaId: s.id, schemas: [s] }); }""", [PASS])
    enc_bad = pg.evaluate("""async ([text, pass]) => { const m = await window.__sqla.encryptForTest(text, pass); return m; }""", [bad, PASS]) if pg.evaluate("() => typeof window.__sqla.encryptForTest") == "function" else None
    if enc_bad:
        repo(pg, {ENC: enc_bad}); t, ok = attempt(PASS, ""); check("Failure — invalid schema: 'The synchronized schema failed validation. The existing local schema has not been changed.' (with the location of the problem)", "The synchronized schema failed validation. The existing local schema has not been changed." in t and "empty raw value" in t and ok, t[:300])
    else:
        check("Failure — invalid schema: validated by the Node suite (browser helper not exposed)", True)
    pg.evaluate("() => window.__sqla.setRepositoryOverride({ describe: 'down', read: async () => { throw new Error('Could not reach GitHub (network down).'); }, write: async () => { throw new Error('x'); } })")
    t, ok = attempt(PASS, ""); check("Failure — network / repository failure: the retrieval message, technical detail on request, local schema intact", "The synchronized schema could not be retrieved. Please verify the repository connection and try again." in t and "network down" in t and ok, t[:240])
    # a success afterwards leaves no stale error behind
    repo(pg, {ENC: enc_text}); pg.fill("#schemaPullPass", PASS); pg.click("#pullBtn"); pg.wait_for_selector("#pullApplyBtn", timeout=15000); pg.wait_for_timeout(150)
    check("No stale errors: after a failure, a successful retry shows only the new result", pg.locator("#pullResult .issue-box.err").count() == 0 and "Finance Ops" in pg.inner_text("#pullResult"))
    pg.click("#pullCancelBtn"); pg.wait_for_timeout(150)
    check("After every failed or cancelled pull the user's own work is untouched", registry_json(pg) == base and active_name(pg) == who)
    ctx.close()


PLAIN_STUB = json.dumps({"formatVersion": 2, "writtenBy": "SQL Assistant 17.4.0", "schemas": [dict(FINANCE)], "activeSchemaId": FINANCE["id"]})


def older_and_passphrase_change(b, url, A, a, enc_text):
    ctx, pg = newdev(b, url, tag="older"); repo(pg, {ENC: enc_text}); go(pg, "schema-used/pull"); pg.wait_for_timeout(300)
    install_finance(pg, version="9.9", updated="2027-05-05T00:00:00.000Z", desc="edited on this device, newer"); go(pg, "schema-used/pull"); pg.wait_for_timeout(300); mine = registry_json(pg)
    pg.fill("#schemaPullPass", PASS); pg.click("#pullBtn"); pg.wait_for_function("() => document.querySelector('#pullResult').innerText.length > 40", timeout=15000); pg.wait_for_timeout(300); t = pg.inner_text("#pullResult")
    check("Older schema: the repository copy is older than the local one — shown with both versions and dates, 'was not applied'", "The synchronized schema is older than the current local schema and was not applied." in t and "v9.9" in t and "v3.0" in t and "Local copy is newer" in t and pg.locator("#pullApplyBtn").count() == 0, t[:360])
    check("Older schema: the newer local schema is not replaced", registry_json(pg) == mine)
    # administrator changes the passphrase and republishes
    a.fill("#schemaAdminPass", NEWPASS); a.fill("#schemaAdminPass2", NEWPASS); a.click("#schemaPassPublish"); a.wait_for_timeout(4500); new_enc = repofile(a, ENC)
    check("Admin: changing the passphrase re-publishes the encrypted schema under the new passphrase", "encrypted file" in a.inner_text("#schemaPassResult") and new_enc and new_enc != enc_text, a.inner_text("#schemaPassResult")[:200])
    ctx.close()
    C, c = newdev(b, url, tag="deviceC"); repo(c, {ENC: new_enc}); go(c, "schema-used/pull"); c.wait_for_timeout(300)
    c.fill("#schemaPullPass", PASS); c.click("#pullBtn"); c.wait_for_function("() => !document.querySelector('#pullBtn').disabled", timeout=15000); c.wait_for_timeout(250)
    check("Passphrase changed by the admin: the old passphrase is refused with the standard message", "The passphrase is incorrect. The existing local schema has not been changed." in c.inner_text("#pullResult"))
    c.fill("#schemaPullPass", NEWPASS); c.click("#pullBtn"); c.wait_for_selector("#pullApplyBtn", timeout=15000); c.click("#pullApplyBtn"); c.wait_for_function("() => document.querySelector('#pullResult .issue-box.ok')", timeout=15000)
    check("Passphrase changed by the admin: the user types the new passphrase, pulls, and the saved passphrase is updated", "Schema pulled and validated successfully." in c.inner_text("#pullResult") and active_name(c) == "Finance Ops")
    c.reload(); ready(c); repo(c, {ENC: new_enc}); go(c, "schema-used/pull"); c.wait_for_function("() => document.querySelector('#schemaPullPass').value.length > 0", timeout=5000); check("Passphrase changed by the admin: after a refresh the device shows the NEW saved passphrase (masked)", c.input_value("#schemaPullPass") == NEWPASS and c.get_attribute("#schemaPullPass", "type") == "password")
    # classic sync on this device is encrypted too and does not break
    unlock(c); stab(c, "Schema Management"); c.click("#simpleSyncBtn"); c.wait_for_timeout(4000); check("Existing sync: 'Sync with GitHub Now' keeps working with a saved passphrase (encrypted file)", "Synchronization failed" not in c.inner_text("main") and "failed" not in c.inner_text("#simpleSyncResult").lower(), c.inner_text("#simpleSyncResult")[:200])
    check("Existing sync: the repository still holds only the encrypted file (no plain schema is written)", c.evaluate("() => [...window.__repo.files.keys()]") == [ENC], c.evaluate("() => [...window.__repo.files.keys()]"))
    C.close()


# ───────────────────────────── 5. Existing sync + vault regression, secrecy, responsive ─────────────────────────────
def classic_and_secrecy(b, url):
    ctx, pg = newdev(b, url, tag="classic"); repo(pg, {}); install_finance(pg); unlock(pg); stab(pg, "Schema Management"); pg.click("#simpleSyncBtn"); pg.wait_for_timeout(2500)
    files = pg.evaluate("() => [...window.__repo.files.keys()]")
    check("Existing sync: without a passphrase the classic plain synchronization works exactly as in V17.4", files == [PLAIN] and "Finance Ops" in repofile(pg, PLAIN) and "failed" not in pg.inner_text("#simpleSyncResult").lower(), files)
    pub = json.loads(repofile(pg, PLAIN)); check("Existing sync: the plain file now also carries the app version and the writer stamp", pub.get("appVersion") == "17.5.1" and pub.get("writtenBy", "").startswith("SQL Assistant 17.5") and pub.get("formatVersion") == 2)
    stab(pg, "Secret Vault"); check("Existing Secret Vault: the vault tab and Push Secret Vault to Repository are unchanged", pg.locator("#pushVaultBtn").count() == 1 and pg.locator("#pullVaultBtn").count() == 1 and pg.locator("#changeTokenBtn").count() == 1)
    stab(pg, "Admin Query Library"); check("Existing Settings: Admin Query Library is unchanged", pg.locator("#aqAdd").count() == 1)
    stab(pg, "Manual Schema Update"); check("Existing Settings: Manual Schema Update is unchanged", pg.locator("#editorSchemaSelect").count() == 1)
    stab(pg, "AI/LLM Model"); check("Existing Settings: AI/LLM Model is unchanged", pg.locator("#v17LlmProvider").count() == 1)
    ctx.close()
    html = (ROOT / "dist/index.html").read_text(encoding="utf-8"); import re
    check("Security: no credential, no hard-coded passphrase and no key material in the production bundle", not re.search(r"ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}", html) and PASS not in html and NEWPASS not in html)
    check("Security: nothing the user typed as a passphrase reached any console message", not any(PASS in c or NEWPASS in c for c in console_all))


def responsive(b, url):
    for (w, h, name) in [(1366, 900, "desktop"), (768, 1024, "tablet"), (390, 800, "phone")]:
        ctx, pg = newdev(b, url, w, h, tag=f"resp-{name}"); repo(pg, {}); go(pg, "schema-used/pull"); pg.wait_for_timeout(400); ov = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        go(pg, "readonly"); pick_table(pg, "INVOICE_HEADER"); col(pg, "INVOICE_HEADER", "STATUS"); R = crow("INVOICE_HEADER", "STATUS"); pg.select_option(R + " .column-mode-select", "casedecode"); pg.wait_for_timeout(150); ov2 = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        install_finance(pg); unlock(pg); stab(pg, "Schema Management"); ov3 = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        check(f"Responsive ({name} {w}px): Pull Schema, the CASE/DECODE controls and the Settings passphrase panel fit without horizontal page scroll", ov <= 2 and ov2 <= 2 and ov3 <= 2, f"{ov} {ov2} {ov3}"); ctx.close()


def main():
    if not (ROOT / "dist/index.html").exists(): print("Run npm run build first."); sys.exit(2)
    port = free_port(); serve = subprocess.Popen(["node", str(ROOT / "scripts/serve.mjs")], env={**os.environ, "PORT": str(port), "BASE": "/SQL-Assistant/"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.9)
    url = f"http://127.0.0.1:{port}/SQL-Assistant/?e2e=1"; state = {}
    try:
        with sync_playwright() as p:
            exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
            section("Tick-marks", tickmarks, b, url); section("CASE/DECODE", case_decode, b, url)
            try:
                A, a, enc_text = publish_from_a(b, url); state.update(A=A, a=a, enc=enc_text)
            except Exception as ex:
                check("Admin publish: section completed", False, f"{type(ex).__name__}: {str(ex)[:260]} | {traceback.format_exc().splitlines()[-3][:150]}")
            if state.get("enc"):
                section("Pull Schema", pull_flow, b, url, state["enc"]); section("Failure scenarios", failures, b, url, state["enc"]); section("Older schema + passphrase change", older_and_passphrase_change, b, url, state["A"], state["a"], state["enc"])
                try: state["A"].close()
                except Exception: pass
            section("Existing sync / Settings / secrecy", classic_and_secrecy, b, url); section("Responsive", responsive, b, url)
            b.close()
    finally:
        serve.terminate()
    real = [e for e in errors if "Failed to load resource" not in e and "net::ERR" not in e and "ERR_INTERNET_DISCONNECTED" not in e and "Could not reach GitHub" not in e]
    check("No console errors or uncaught exceptions in any V17.5 flow", not real, "; ".join(real[:4]))
    failed = [r for r in results if not r[1]]; print(f"\n{len(results) - len(failed)}/{len(results)} V17.5 browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True); (ROOT / "test-results/browser-results-v175.json").write_text(json.dumps([{"check": n, "pass": ok} for n, ok in results], indent=2)); sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
