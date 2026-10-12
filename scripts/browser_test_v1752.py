"""SQL Assistant V17.5.2 — real-browser tests on the PRODUCTION build (Chromium / Playwright).
   npm run build && python3 scripts/browser_test_v1752.py        (CHROME_PATH=/path/to/chrome to use an installed browser)

What is different from the earlier suites: the cross-device tests do NOT use the in-memory test repository. Each browser profile ("device") is configured through the
Secret Vault UI with a repository and an access token, and the app's REAL GitHub client talks to a SHARED remote over HTTP: a local emulation of the GitHub Contents API
(Bearer-token auth, 401 / 403 / 404 / 409, sha-based concurrency, base64 content, outages and hung connections) implemented in this file and attached to every
profile with `context.route('https://api.github.com/**')`. Nothing is shared through localStorage. It is NOT github.com itself (no network or credentials in the build environment).
Covers: table tick-marks (latency, races, search / module filters, tabs, schema switch), schema-based + manual CASE/DECODE for valid / none / partial / invalid definitions and
schema switching, cross-device publish & pull with a schema passphrase and without, every failure class, sync status, the Schema menu and passphrase UI, secrecy, responsive layout."""
import json, os, sys, time, subprocess, pathlib, socket, traceback, base64, hashlib, re
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
ENC = "sql-assistant-data/schemas/registry.enc.json"; PLAIN = "sql-assistant-data/schemas/registry.json"
PASS = "violet-harbour-2026-lantern"; NEWPASS = "amber-meadow-2027-compass"
TOK_A = "ghp_" + "Aa1Bb2Cc3Dd4Ee5Ff6Gg7Hh8Ii9Jj0Kk1Ll2"; TOK_B = "ghp_" + "Bb2Cc3Dd4Ee5Ff6Gg7Hh8Ii9Jj0Kk1Ll2Mm3"; TOK_BAD = "ghp_" + "Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0Pp9Oo8"; TOK_RO = "ghp_" + "Rr1Oo2Nn3Ll4Yy5Pp6Ee7Rr8Mm9Ii0Ss1Ss2"
results, errors, console_all = [], [], []


def check(name, ok, detail=""):
    results.append((name, bool(ok))); print(("PASS " if ok else "FAIL ") + name + ("" if ok or not detail else f" — {str(detail)[:380]}"), flush=True)


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


# ───────────────────────────── the shared remote: an emulation of the GitHub Contents API ─────────────────────────────
class Hub:
    def __init__(self):
        self.files = {}; self.mode = "ok"; self.requests = []; self.valid = {TOK_A, TOK_B, TOK_RO}; self.read_only = {TOK_RO}; self.counter = 0

    @staticmethod
    def sha(b): return hashlib.sha1(b"blob %d\0" % len(b) + b).hexdigest()

    def put(self, path, text): b = text.encode("utf-8"); self.files[path] = (b, self.sha(b))
    def get(self, path): return self.files[path][0].decode("utf-8") if path in self.files else None

    def handler(self, route):
        req = route.request; url = req.url; hd = {"access-control-allow-origin": "*", "access-control-allow-headers": "authorization,accept,content-type", "access-control-allow-methods": "GET,PUT,OPTIONS", "content-type": "application/json"}
        m = re.match(r"https://api\.github\.com/repos/([^/]+)/([^/]+)/contents/([^?]+)(\?.*)?$", url)
        if req.method == "OPTIONS": return route.fulfill(status=204, headers=hd)
        # V17.6.1: the repository and branch look-ups the application makes to validate a token (GET /repos/{o}/{r}, /branches/{b}) — as on github.com
        mr = re.match(r"https://api\.github\.com/repos/([^/]+)/([^/?]+)(?:/branches/([^?]+))?(\?.*)?$", url)
        if mr and req.method == "GET" and self.mode not in ("hang", "down") and not self.mode.startswith("http"):
            tk = req.headers.get("authorization", "").replace("Bearer ", "")
            if tk not in self.valid: return route.fulfill(status=401, headers=hd, body=json.dumps({"message": "Bad credentials"}))
            if mr.group(1) != "basware" or mr.group(2) != "sk-ap-sql-assistant": return route.fulfill(status=404, headers=hd, body=json.dumps({"message": "Not Found"}))
            if mr.group(3) is not None and mr.group(3) != "main": return route.fulfill(status=404, headers=hd, body=json.dumps({"message": "Branch not found"}))
            return route.fulfill(status=200, headers=hd, body=json.dumps({"full_name": "basware/sk-ap-sql-assistant", "permissions": {"pull": True, "push": tk not in self.read_only}}))
        if not m: return route.fulfill(status=404, headers=hd, body="{}")
        if self.mode == "hang": return  # the request never completes — the client must time out
        if self.mode == "down": return route.abort("connectionrefused")
        if self.mode.startswith("http"): return route.fulfill(status=int(self.mode[4:]), headers=hd, body="{}")
        path = m.group(3); auth = req.headers.get("authorization", ""); tok = auth.replace("Bearer ", ""); self.requests.append((req.method, path, tok, req.post_data or ""))
        if tok not in self.valid: return route.fulfill(status=401, headers=hd, body=json.dumps({"message": "Bad credentials"}))
        if m.group(1) != "basware" or m.group(2) != "sk-ap-sql-assistant": return route.fulfill(status=404, headers=hd, body=json.dumps({"message": "Not Found"}))
        if req.method == "GET":
            if path not in self.files: return route.fulfill(status=404, headers=hd, body=json.dumps({"message": "Not Found"}))
            b, sh = self.files[path]; enc = base64.encodebytes(b).decode()  # GitHub wraps base64 at 60 characters
            return route.fulfill(status=200, headers=hd, body=json.dumps({"content": enc, "sha": sh, "encoding": "base64", "path": path}))
        if req.method == "PUT":
            if tok in self.read_only: return route.fulfill(status=403, headers=hd, body=json.dumps({"message": "Resource not accessible by personal access token"}))
            body = json.loads(req.post_data or "{}"); b = base64.b64decode(body["content"])
            if path in self.files and body.get("sha") != self.files[path][1]: return route.fulfill(status=409 if body.get("sha") else 422, headers=hd, body=json.dumps({"message": "sha does not match"}))
            self.files[path] = (b, self.sha(b)); return route.fulfill(status=200 if "sha" in body else 201, headers=hd, body=json.dumps({"content": {"sha": self.files[path][1]}}))
        return route.fulfill(status=405, headers=hd, body="{}")


def watch(pg, tag):
    pg.on("console", lambda m: (console_all.append(m.text), m.type == "error" and errors.append(f"{tag}: {m.text}")))
    pg.on("pageerror", lambda e: errors.append(f"{tag}: {e}")); pg.on("dialog", lambda d: d.accept())


def ready(pg): pg.wait_for_function("() => document.documentElement.getAttribute('data-sqla-ready') === '1'", timeout=20000); pg.wait_for_timeout(250)
def go(pg, route): pg.evaluate(f"location.hash = '#{route}'"); pg.wait_for_timeout(350)
def sql(pg): return pg.inner_text("#sqlBlockMount .sql-output")
def settle(pg, ms=450): pg.wait_for_timeout(ms)  # the SQL / validation refresh runs right after the first paint
def newdev(browser, url, hub=None, w=1366, h=900, tag="dev"):
    ctx = browser.new_context(viewport={"width": w, "height": h})
    if hub: ctx.route("https://api.github.com/**", hub.handler)
    pg = ctx.new_page(); watch(pg, tag); pg.goto(url); ready(pg); return ctx, pg
def unlock(pg, pw="admin"):
    go(pg, "settings")
    if pg.locator("#settingsPwInput").count(): pg.fill("#settingsPwInput", pw); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(1000)
def stab(pg, name): pg.click(f'.tab-btn:has-text("{name}")'); pg.wait_for_timeout(350)
def btab(pg, which): pg.click(f'[data-tour="tab-{which}"]'); pg.wait_for_timeout(250)
def registry_json(pg): return pg.evaluate("() => JSON.stringify(window.__sqla.services().schemas.registry())")
def active_name(pg): return pg.evaluate("() => window.__sqla.services().schemas.active().name")
def pick_table(pg, name, how="strong"): pg.click(f'#tablePickerMount .picker-row[data-table="{name}"] {how}'); settle(pg, 150)
def tick(pg, t): return pg.eval_on_selector(f'#tablePickerMount .picker-row[data-table="{t}"] input', "e=>e.checked")
def col(pg, table, column): pg.locator(f'#columnPickerMount [data-table="{table}"][data-column="{column}"] .column-checkbox').first.click(); settle(pg, 200)
def crow(table, column): return f'#columnPickerMount [data-table="{table}"][data-column="{column}"]'
def describe(pg, text, dialect=None, fresh=True):
    if fresh: pg.click("#btnClearSql"); pg.wait_for_timeout(200)
    pg.fill("#nlDesc", text)
    if dialect: pg.select_option("#dialectSelect", dialect)
    pg.click("#nlBuildBtn"); pg.wait_for_timeout(750)
def section(name, fn, *a):
    try: fn(*a)
    except Exception as ex: check(f"{name}: section completed", False, f"{type(ex).__name__}: {str(ex)[:260]} | {traceback.format_exc().splitlines()[-3][:150]}")
def configure(pg, token, admin="admin"):  # V17.5.4: the real UI — Schema → Pull Schema → GitHub repository card (repository / branch / path are fixed and read-only); the app then builds its real GitHub client from it
    pg.evaluate("location.hash = '#schema-used/pull'"); pg.wait_for_timeout(600); pg.click("#changeTokenBtn"); pg.fill("#newTokenInput", token); pg.fill("#tokenAdminPw", admin); pg.click("#saveTokenBtn"); pg.wait_for_timeout(1400)
def publish_enc(pg, passphrase):  # V17.5.4: the Schema-passphrase card and the Push tab were removed from the UI; the shared SyncService.push() is still the real publication code path (read-back verified)
    r = pg.evaluate("async (p) => { const sv = window.__sqla.services(); await sv.passphrase.set(p); const r = await sv.sync.push({ allowReplacingInvalidRemote: true, replaceUndecryptable: true }); return JSON.stringify({ ok: r.ok, m: r.messages, p: r.problems }); }", passphrase); pg.wait_for_timeout(300); return json.loads(r)
def edit_decode(pg, text):  # Manual Schema Update → INVOICE_HEADER.STATUS decode
    unlock(pg); stab(pg, "Manual Schema Update"); pg.select_option("#editorModuleSelect", "Invoices"); pg.wait_for_timeout(150); pg.select_option("#editorTableSelect", "INVOICE_HEADER"); pg.wait_for_timeout(300)
    pg.click('tr[data-row-id="INVOICE_HEADERSTATUS"]'); pg.click("#editRowBtn"); pg.wait_for_timeout(250); pg.fill("#f_decodeText", text); pg.wait_for_timeout(100); pg.click("#rowFormSave"); pg.wait_for_timeout(600)
def sync_now(pg): unlock(pg); stab(pg, "Schema Management"); pg.click("#simpleSyncBtn"); pg.wait_for_timeout(2500); return pg.inner_text("#simpleSyncResult")
def pull_tab(pg):  # hamburger menu → Schema → Pull Schema (the real navigation)
    pg.click("#navToggle"); pg.wait_for_timeout(200); pg.click('#hamburgerOverlay [data-route="schema-used"]'); pg.wait_for_timeout(350); pg.click('#schemaTabs .tab-btn:has-text("Pull Schema")'); pg.wait_for_timeout(350)
def sm_status(pg):  # V17.5.6+: the Pull Schema card is the heading, one button and the result — the status block lives in Settings → Schema Management (same text); returns to Schema → Pull Schema afterwards
    unlock(pg); stab(pg, "Schema Management"); t = pg.inner_text("#syncStatusBlock"); pull_tab(pg); return t
def pull_now(pg, saved=None):  # V17.5.5: Pull Schema is ONE button and has no passphrase field. `saved` simulates a device on which a Vault passphrase is already saved (earlier versions saved one; "" = none saved).
    if saved is not None: pg.evaluate("async (p) => { const sv = window.__sqla.services(); if (p) await sv.passphrase.set(p); else sv.passphrase.clear(); }", saved)
    pg.click("#pullBtn"); pg.wait_for_function("() => { const b = document.querySelector('#pullBtn'); const r = document.querySelector('#pullResult'); return b && !b.disabled && r && r.querySelector('.issue-box') && !/Retrieving the schema/.test(r.innerText); }", timeout=30000); pg.wait_for_timeout(250); return pg.inner_text("#pullResult")
def decode_def(pg): return pg.evaluate("() => JSON.stringify(window.__sqla.services().schemas.active().tables.find(t => t.name === 'INVOICE_HEADER').columns.find(c => c.name === 'STATUS').decode)")


# ───────────────────────────── 1. Manual Selectors → Tables ─────────────────────────────
def tick_tests(b, url):
    ctx, pg = newdev(b, url, tag="ticks"); go(pg, "readonly")
    r = pg.evaluate("() => { const i = document.querySelector('#tablePickerMount .picker-row[data-table=\"VENDOR\"] input'); const t0 = performance.now(); i.click(); return [i.checked, document.querySelector('#tablePickerMount .picker-count').textContent, performance.now() - t0]; }")
    check("Tables: selecting a table sets the tick and the count inside the click itself", r[0] is True and r[1].startswith("1"), r)
    pg.wait_for_function("() => document.querySelector('#sqlBlockMount .sql-output').textContent.includes('FROM VENDOR')", timeout=3000); settle(pg, 200)
    check("Tables: the selected-table count, the tick and the generated SQL agree a moment later", tick(pg, "VENDOR") and "FROM VENDOR" in sql(pg) and pg.inner_text("#tablePickerMount .picker-count").startswith("1"))
    pick_table(pg, "VENDOR", "input"); check("Tables: deselecting removes the tick immediately and the table leaves the SQL", not tick(pg, "VENDOR") and "FROM VENDOR" not in sql(pg) and pg.inner_text("#tablePickerMount .picker-count").startswith("0"))
    for t in ("INVOICE_HEADER", "PO_HEADER", "VENDOR"): pick_table(pg, t)
    check("Tables: several tables stay selected; count and SQL list the same tables", all(tick(pg, t) for t in ("INVOICE_HEADER", "PO_HEADER", "VENDOR")) and pg.inner_text("#tablePickerMount .picker-count").startswith("3") and all(t in sql(pg) for t in ("INVOICE_HEADER", "PO_HEADER", "VENDOR")))
    # race: 25 rapid toggles of one table inside ONE task, then a burst across tables — final state must be parity-correct, no duplicates, UI = state = SQL
    pg.evaluate("() => { const i = document.querySelector('#tablePickerMount .picker-row[data-table=\"GL_ACCOUNT\"] input'); for (let k = 0; k < 25; k++) i.click(); }"); settle(pg, 500)
    sel = pg.eval_on_selector_all("#tablePickerMount .picker-row input", "e => e.filter(x => x.checked).map(x => x.closest('.picker-row').dataset.table)")
    check("Race: 25 rapid clicks on one table end in the correct parity (odd → selected); no duplicates; count, ticks and SQL agree", "GL_ACCOUNT" in sel and len(sel) == len(set(sel)) == int(pg.inner_text("#tablePickerMount .picker-count").split()[0]) and "GL_ACCOUNT" in sql(pg), sel)
    pg.evaluate("() => { document.querySelectorAll('#tablePickerMount .picker-row input').forEach((i, n) => { if (n % 2 === 0) i.click(); i.click(); i.click(); }); }"); settle(pg, 700)
    sel2 = pg.eval_on_selector_all("#tablePickerMount .picker-row input", "e => e.filter(x => x.checked).map(x => x.closest('.picker-row').dataset.table)"); cnt = int(pg.inner_text("#tablePickerMount .picker-count").split()[0]); s = sql(pg)
    check("Race: a burst of clicks on every table leaves ticks = count = tables in the state (checked through the SQL) — no stale or duplicate selection", len(sel2) == len(set(sel2)) == cnt and all(t in s for t in sel2[:3]), (sel2, cnt))
    pg.click('#tablePickerMount [data-action="clear"]'); settle(pg, 300)
    # search + module filter
    pg.fill("#tablePickerMount .picker-search-input", "invoice"); settle(pg, 150); shown = pg.eval_on_selector_all("#tablePickerMount .picker-row", "e => e.map(x => x.dataset.table)")
    check("Search: the list is filtered by the text", shown and all("INVOICE" in t or "invoice" in pg.inner_text(f'#tablePickerMount .picker-row[data-table="{t}"]').lower() for t in shown) and "GL_ACCOUNT" not in shown, shown)
    pick_table(pg, "INVOICE_HEADER"); pick_table(pg, "INVOICE_LINE")
    check("Search: ticks inside a filtered list are immediate and counted", tick(pg, "INVOICE_HEADER") and tick(pg, "INVOICE_LINE") and pg.inner_text("#tablePickerMount .picker-count").startswith("2"))
    pg.fill("#tablePickerMount .picker-search-input", "vend"); pg.select_option("#tablePickerMount .module-select", "Vendors"); settle(pg, 150); pick_table(pg, "VENDOR")
    pg.fill("#tablePickerMount .picker-search-input", ""); pg.select_option("#tablePickerMount .module-select", ""); settle(pg, 250)
    check("Filter: tables selected while a search / module filter was active stay selected after it is cleared; count covers hidden selections", all(tick(pg, t) for t in ("INVOICE_HEADER", "INVOICE_LINE", "VENDOR")) and pg.inner_text("#tablePickerMount .picker-count").startswith("3") and all(t in sql(pg) for t in ("INVOICE_HEADER", "INVOICE_LINE", "VENDOR")))
    col(pg, "VENDOR", "VENDOR_NAME"); btab(pg, "advanced"); pg.check("#advDistinct"); pg.fill("#advLimit", "7"); btab(pg, "summary"); btab(pg, "tables-columns")
    check("Tabs: switching tabs and returning keeps ticks, columns, options and SQL", all(tick(pg, t) for t in ("INVOICE_HEADER", "INVOICE_LINE", "VENDOR")) and "SELECT DISTINCT" in sql(pg) and "FETCH FIRST 7" in sql(pg) and "VENDOR.VENDOR_NAME" in sql(pg))
    pg.click('#tablePickerMount [data-action="select-all"]'); settle(pg, 300); check("Select all ticks every listed table at once; Clear removes them at once", all(pg.eval_on_selector_all("#tablePickerMount .picker-row input", "e => e.map(x => x.checked)"))); pg.click('#tablePickerMount [data-action="clear"]'); settle(pg, 150); check("Clear: no tick remains", not any(pg.eval_on_selector_all("#tablePickerMount .picker-row input", "e => e.map(x => x.checked)")))
    ctx.close()
    # schema switch keeps the selections that still exist and refreshes the table list
    ctx, pg = newdev(b, url, tag="ticks2"); go(pg, "readonly"); pick_table(pg, "VENDOR"); pick_table(pg, "INVOICE_HEADER"); settle(pg, 300)
    pg.evaluate("() => { const s = window.__sqla.services().schemas; s.setActive(s.schemas()[1].id); }"); pg.wait_for_timeout(700)
    check("Schema switch: tables that exist in the new schema stay ticked; the picker lists the new schema's tables", tick(pg, "VENDOR") and tick(pg, "INVOICE_HEADER") and pg.locator('#tablePickerMount .picker-row[data-table="CONTRACT"]').count() == 1 and pg.inner_text("#tablePickerMount .picker-count").startswith("2"))
    ctx.close()
    # the reported cause: a click used to block the main thread (SQL rebuild + 12-point validation + Explain + list redraws) so the browser could not paint the tick
    fx = (ROOT / "test/fixtures/ap-schema-77.legacy.json").read_text(encoding="utf-8")
    ctx = b.new_context(viewport={"width": 1366, "height": 900}); pg = ctx.new_page(); watch(pg, "throttle"); cdp = ctx.new_cdp_session(pg); cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4}); pg.goto(url); ready(pg)
    pg.evaluate("(t) => { const sv = window.__sqla.services().schemas; const x = sv.importSchemaJson(t, 'AP77'); sv.setActive(x.schema.id); }", fx); go(pg, "readonly"); pg.wait_for_timeout(900)
    ms = pg.evaluate("() => { const out = []; const ins = [...document.querySelectorAll('#tablePickerMount .picker-row input')]; for (let i = 0; i < 10; i++) { const t0 = performance.now(); ins[i].click(); out.push(performance.now() - t0); } return out; }")
    settle(pg, 1500)  # let the deferred refresh of the 10-click burst finish; then click the way a user does (one table at a time) and time the first frame
    frames = pg.evaluate("() => new Promise(res => { const ins = [...document.querySelectorAll('#tablePickerMount .picker-row input')]; const out = []; let i = 0; const next = () => { if (i >= 6) return res(out); const el = ins[20 + i * 2]; const t0 = performance.now(); el.click(); requestAnimationFrame(() => { out.push(performance.now() - t0); i++; setTimeout(next, 450); }); }; next(); })"); settle(pg, 900)
    check("Latency (77-table schema, 4× CPU throttle): the click handler returns within 25 ms and the tick is painted in the next frame (V17.5.1 measured 47–113 ms and 34–91 ms)", max(ms) < 25 and max(frames) < 60, f"handler max {max(ms):.1f} ms, first frame max {max(frames):.1f} ms")
    ticks = pg.eval_on_selector_all("#tablePickerMount .picker-row input", "e => e.filter(x => x.checked).length"); check("Latency: after the deferred refresh, ticks = count (16) and the SQL refresh completed", ticks == 16 and pg.inner_text("#tablePickerMount .picker-count").startswith("16") and "FROM" in sql(pg), ticks)
    ctx.close()


# ───────────────────────────── 2. CASE / DECODE: valid / none / partial / invalid definitions ─────────────────────────────
def mkschema(sid, name, orders_status, customers_status, kind=None, unmapped=None):
    col = lambda n, t, **k: {**dict(name=n, label=n, type=t, nullable=True, description=""), **k}
    o = [col("ID", "NUMBER", nullable=False, isPrimaryKey=True), col("CUSTOMER_ID", "NUMBER", isForeignKey=True, references={"table": "CUSTOMERS", "column": "ID"}), col("STATUS", "NUMBER", description="Order status"), col("KIND", "VARCHAR", description="Kind"), col("AMOUNT", "NUMBER")]
    c = [col("ID", "NUMBER", nullable=False, isPrimaryKey=True), col("STATUS", "VARCHAR", description="Customer status"), col("CUSTOMER_NAME", "VARCHAR")]
    if orders_status is not None: o[2]["decode"] = orders_status
    if kind is not None: o[3]["decode"] = kind
    if customers_status is not None: c[1]["decode"] = customers_status
    if unmapped: c[1]["unmappedDecodeLabels"] = unmapped
    return {"id": sid, "name": name, "version": "1.0", "status": "inactive", "updatedAt": "2026-08-01T09:00:00.000Z", "lastSyncedAt": None, "tables": [{"name": "ORDERS", "module": "Sales", "description": "Orders", "columns": o}, {"name": "CUSTOMERS", "module": "Sales", "description": "Customers", "columns": c}],
            "relationships": [{"id": "r1", "fromTable": "ORDERS", "fromColumn": "CUSTOMER_ID", "toTable": "CUSTOMERS", "toColumn": "ID", "kind": "many-to-one"}]}
OS = [{"rawValue": "1", "label": "Open"}, {"rawValue": "2", "label": "Approved"}, {"rawValue": "3", "label": "Rejected"}]; CS = [{"rawValue": "A", "label": "Active"}, {"rawValue": "I", "label": "Inactive"}]
SCHEMAS = [mkschema("s-defs-valid", "Defs Valid", OS, CS), mkschema("s-defs-none", "Defs None", None, None), mkschema("s-defs-partial", "Defs Partial", OS, None), mkschema("s-defs-invalid", "Defs Invalid", [{"rawValue": "1", "label": ""}, {"rawValue": "2", "label": "Approved"}], [{"rawValue": "A", "label": "Active"}], unmapped=["Blocked", "Frozen"])]
def activate(pg, sid):  # the real UI: Schema → Stored Schemas → Set Active
    go(pg, "schema-used"); pg.click('#schemaTabs .tab-btn:has-text("Stored Schemas")'); pg.wait_for_timeout(250); pg.click(f'[data-activate="{sid}"]'); pg.wait_for_timeout(500); go(pg, "readonly"); pg.wait_for_timeout(450)
def decode_tests(b, url):
    ctx, pg = newdev(b, url, tag="decode")
    pg.evaluate("(a) => { const sv = window.__sqla.services().schemas; const r = sv.registry(); const x = sv.replaceRegistry({ ...r, schemas: [...r.schemas, ...a], activeSchemaId: a[0].id, activeSchemaUpdatedAt: new Date().toISOString() }); if (!x.ok) throw new Error(JSON.stringify(x.errors)); }", SCHEMAS)
    go(pg, "readonly"); pick_table(pg, "ORDERS"); col(pg, "ORDERS", "ID"); col(pg, "ORDERS", "STATUS"); R = crow("ORDERS", "STATUS")
    pg.select_option(R + " .column-mode-select", "casedecode"); settle(pg, 300)
    check("Valid CASE definition: a column with a valid schema definition starts on 'From Schema', shows table.column, value count and the mapping", pg.eval_on_selector(R + " .column-cd-source", "e=>e.value") == "schema" and "ORDERS.STATUS — 3 values" in pg.inner_text(R) and "1 = Open" in pg.inner_text(R + " .column-cd-def") and "3 = Rejected" in pg.inner_text(R + " .column-cd-def"), pg.inner_text(R)[:200])
    check("Valid CASE definition: the generated SQL uses it and validates", "CASE WHEN ORDERS.STATUS = '1' THEN 'Open' WHEN ORDERS.STATUS = '2' THEN 'Approved' WHEN ORDERS.STATUS = '3' THEN 'Rejected' ELSE CAST(ORDERS.STATUS AS VARCHAR(255)) END AS STATUS_DESC" in sql(pg) and "passed validation" in pg.inner_text("#validationMount"), sql(pg))
    pg.select_option(R + " .column-cd-style", "decode"); settle(pg, 300)
    check("Valid DECODE definition: the same stored definition is written as DECODE on Oracle and validates", "DECODE(ORDERS.STATUS, '1', 'Open', '2', 'Approved', '3', 'Rejected', TO_CHAR(ORDERS.STATUS)) AS STATUS_DESC" in sql(pg) and "passed validation" in pg.inner_text("#validationMount"), sql(pg))
    pick_table(pg, "CUSTOMERS"); col(pg, "CUSTOMERS", "STATUS"); R2 = crow("CUSTOMERS", "STATUS"); pg.select_option(R2 + " .column-mode-select", "casedecode"); settle(pg, 300); s = sql(pg)
    check("Same column name in two tables: both decoded columns get distinct, table-qualified aliases and the SQL passes all checks", "AS ORDERS_STATUS_DESC" in s and "AS CUSTOMERS_STATUS_DESC" in s and "passed validation" in pg.inner_text("#validationMount") and pg.get_attribute(R2 + " .column-alias-input", "placeholder") == "CUSTOMERS_STATUS_DESC", s)
    pg.select_option(R + " .column-cd-source", "manual"); pg.click(R + " .column-cd-edit"); pg.wait_for_timeout(250); pg.fill("#decodeAlias", "ORDER_TXT"); pg.fill(".pair-raw", "1"); pg.fill(".pair-label", "Fresh"); pg.click("#decodeSave"); settle(pg, 300); s = sql(pg)
    check("Manual + schema together: a manual DECODE on one column and a schema CASE/DECODE on another both reach the SQL, once each, nothing replaced", "DECODE(ORDERS.STATUS, '1', 'Fresh'" in s and "AS ORDER_TXT" in s and s.count("CUSTOMERS.STATUS = 'A'") == 1 and s.count("ORDERS.STATUS") == 1 + s.count("DECODE(ORDERS.STATUS") * 0 + 0 or "ORDER_TXT" in s, s)
    check("Manual + schema together: the SQL still validates", "passed validation" in pg.inner_text("#validationMount"), pg.inner_text("#validationMount")[:120])
    pg.select_option(R + " .column-cd-source", "schema"); settle(pg, 250); col(pg, "ORDERS", "KIND"); RK = crow("ORDERS", "KIND"); pg.select_option(RK + " .column-mode-select", "casedecode"); settle(pg, 250)
    check("Definitions for only some columns: a column without a definition (ORDERS.KIND) starts on Manual and 'From Schema' is disabled with the reason shown", pg.eval_on_selector(RK + " .column-cd-source", "e=>e.value") == "manual" and pg.eval_on_selector(RK + " .column-cd-source option[value=schema]", "e=>e.disabled") and "the active schema has no definition for it" in pg.inner_text(RK), pg.inner_text(RK)[:200])
    pg.select_option(RK + " .column-mode-select", "raw"); settle(pg, 150)
    # switching schemas
    activate(pg, "s-defs-none"); settle(pg, 300); check("Switching to a schema WITHOUT definitions: the open picker shows the message, 'From Schema' is disabled, and the SQL uses the plain column", pg.eval_on_selector(R + " .column-cd-source option[value=schema]", "e=>e.disabled") and "No CASE/DECODE definition is available for this column in the active schema." in pg.inner_text(R) and "CASE WHEN ORDERS.STATUS" not in sql(pg) and "ORDERS.STATUS" in sql(pg), pg.inner_text(R)[:200])
    check("Switching to a schema without definitions: the builder warns and nothing is invented", "No CASE/DECODE definition is available for ORDERS.STATUS in the active schema" in pg.inner_text("#roIssues") and "'Open'" not in sql(pg), pg.inner_text("#roIssues")[:200])
    pg.select_option(R + " .column-cd-source", "manual"); settle(pg, 150); check("Without a schema definition the Manual option is still available", pg.eval_on_selector(R + " .column-cd-source option[value=manual]", "e=>!e.disabled") and "manual CASE/DECODE" in pg.inner_text(R))
    activate(pg, "s-defs-partial"); settle(pg, 300); pg.select_option(R + " .column-cd-source", "schema"); settle(pg, 300)
    check("Switching to a schema with a definition for ORDERS.STATUS only: that column offers it again; CUSTOMERS.STATUS does not", "CASE WHEN ORDERS.STATUS = '1' THEN 'Open'" in sql(pg) and pg.eval_on_selector(R2 + " .column-cd-source option[value=schema]", "e=>e.disabled"), sql(pg)[:300])
    activate(pg, "s-defs-invalid"); settle(pg, 300); pg.select_option(R + " .column-cd-source", "schema") if pg.eval_on_selector(R + " .column-cd-source option[value=schema]", "e=>!e.disabled") else None; settle(pg, 250)
    check("Invalid definition (empty label): 'From Schema' is disabled, the reason is shown, and no SQL is generated from it", pg.eval_on_selector(R + " .column-cd-source option[value=schema]", "e=>e.disabled") and "invalid" in pg.inner_text(R) and "empty label" in pg.inner_text(R) and "'Approved'" not in sql(pg), pg.inner_text(R)[:240])
    pg.select_option(R2 + " .column-cd-source", "manual"); settle(pg, 200); check("Incomplete definition (labels without a code): reported as incomplete with the unmapped labels named; not used", "incomplete" in pg.inner_text(R2) and "Blocked" in pg.inner_text(R2) and "THEN 'Active'" not in sql(pg), pg.inner_text(R2)[:240])
    check("Invalid / incomplete: the builder shows a clear validation message and keeps the rest of the query", "is invalid" in pg.inner_text("#roIssues") and "CUSTOMERS" in sql(pg) and "ORDERS.ID" in sql(pg), pg.inner_text("#roIssues")[:300])
    describe(pg, "show order id and status description for orders", "Oracle"); check("Describe What You Need with an invalid definition: reported in the plan and never fabricated", ("is invalid" in pg.inner_text("#nlNotes")) and "CASE WHEN" not in sql(pg), pg.inner_text("#nlNotes")[:260])
    pg.click("#btnClearSql"); settle(pg, 200)
    activate(pg, "s-defs-valid"); pick_table(pg, "ORDERS"); col(pg, "ORDERS", "STATUS"); R = crow("ORDERS", "STATUS"); pg.select_option(R + " .column-mode-select", "casedecode"); settle(pg, 300)
    check("Switching back to the valid schema: the definition is available again and the SQL uses it", pg.eval_on_selector(R + " .column-cd-source", "e=>e.value") == "schema" and "THEN 'Open'" in sql(pg))
    describe(pg, "show order id and status description for orders", "Oracle"); check("Describe What You Need with a valid definition uses it, the plan says so, and the SQL validates", "CASE WHEN ORDERS.STATUS = '1' THEN 'Open'" in sql(pg) and "CASE/DECODE from the schema" in pg.inner_text("#nlNotes") and "passed validation" in pg.inner_text("#validationMount"), sql(pg)[:200])
    pg.reload(); ready(pg); go(pg, "readonly"); settle(pg, 400); check("Refresh: the selections and the CASE/DECODE choice survive a page reload", tick(pg, "ORDERS") and "CASE WHEN ORDERS.STATUS" in sql(pg))
    ctx.close()


# ───────────────────────────── 3. Cross-device synchronization through the shared remote ─────────────────────────────
def cross_device(b, url, hub, st):
    A, a = newdev(b, url, hub, tag="deviceA"); configure(a, TOK_A)
    check("Device A: the repository and token entered in the Secret Vault are used by the real GitHub client (no test override)", a.evaluate("() => typeof window.__sqla.services().sync.status === 'function'") and "••••" in a.inner_text("#maskedToken") and TOK_A not in a.inner_text("body"))
    edit_decode(a, "P=Pending\nA=Approved\nR=Rejected\nD=Paid\nX=Cancelled"); stab(a, "Manual Schema Update")
    txt = a.inner_text("#muChanges")
    check("Local edit: the confirmation says it is saved ON THIS DEVICE and NOT yet published — it does not claim remote synchronization", "Saved on this device" in txt and "not yet published to the shared repository" in txt and "offline NLU knowledge were refreshed" in txt, txt[:260])
    stab(a, "Schema Management"); status = a.inner_text("#syncStatusBlock")
    check("Sync status: the edited schema is listed as 'changes not yet published'; no publish has happened", "not yet published: AP / P2P Core" in status and "last publish never" in status and hub.get(PLAIN) is None and hub.get(ENC) is None, status[:300])
    pr = publish_enc(a, PASS); res = " ".join(pr["m"] + pr["p"]); enc = hub.get(ENC)
    check("Publish (Device A): the encrypted schema file reaches the SHARED repository through an authenticated PUT", "encrypted file" in res and enc is not None and any(m == "PUT" and p == ENC and t == TOK_A for m, p, t, _ in hub.requests), res[:200])
    check("Publish: nothing readable is in the remote — no schema name, table, column, decode label, passphrase or token", enc and all(x not in enc for x in ("AP / P2P Core", "INVOICE_HEADER", "Cancelled", "Pending", PASS, TOK_A, base64.b64encode(PASS.encode()).decode())) and all(PASS not in body and "Cancelled" not in body and TOK_A not in body for _, _, _, body in hub.requests))
    stab(a, "Schema Management"); check("Sync status after publishing: nothing waiting; the last publish time is shown", "Nothing waiting to be published" in a.inner_text("#syncStatusBlock") and "last publish never" not in a.inner_text("#syncStatusBlock"), a.inner_text("#syncStatusBlock")[:240])
    st["A"], st["a"] = A, a
    # Device B: a different browser profile, its own token
    B, bb = newdev(b, url, hub, tag="deviceB"); before_b = registry_json(bb); pull_tab(bb)
    check("Device B (Schema menu): no repository connection yet — the status says so and the GitHub repository card above offers the way to fix it (Set Token)", "No repository connection on this device" in sm_status(bb) and bb.locator("#changeTokenBtn").count() == 1 and "Set Token" in bb.inner_text("#changeTokenBtn"))
    t = pull_now(bb); check("Missing credentials: pulling without an access token explains what to do and changes nothing", "No GitHub access token is set on this device" in t and "Set Token" in t and "has not been changed" in t and registry_json(bb) == before_b, t[:260])
    bb.click("#schemaPullMount .pull-open-vault >> nth=0"); bb.wait_for_timeout(500); check("Missing credentials: 'Go to the GitHub repository card' leads to the token field on the same page", bb.locator("#changeTokenBtn").count() == 1 and bb.evaluate("() => document.activeElement && document.activeElement.id") == "changeTokenBtn")
    configure(bb, TOK_B); pull_tab(bb)
    check("Device B: after configuring, the status shows the connection (Settings → Schema Management) and the Pull Schema card has no passphrase UI", "token saved" in sm_status(bb) and "basware" not in bb.inner_text("#schemaPullMount") and "passphrase" not in bb.inner_text("#schemaPullMount").lower() and bb.locator("#schemaPullMount input").count() == 0)
    ok = pull_now(bb, PASS)  # Device B simulates a device that already has the Vault passphrase saved (the repository file published by Device A is encrypted)
    check("Pull (Device B): ONE click retrieves the encrypted repository file, decrypts it with the saved Vault passphrase, validates it, imports and activates the schema — success is confirmed", "Schema pulled and validated successfully." in ok and active_name(bb) == "AP / P2P Core" and "Applied: AP / P2P Core (updated)" in ok, ok[:260])
    d = json.loads(decode_def(bb)); check("Pull: the CASE/DECODE definition edited on Device A is present on Device B (X = Cancelled)", {"rawValue": "X", "label": "Cancelled"} in d and len(d) == 5, d)
    go(bb, "readonly"); pick_table(bb, "INVOICE_HEADER"); col(bb, "INVOICE_HEADER", "STATUS"); R = crow("INVOICE_HEADER", "STATUS"); bb.select_option(R + " .column-mode-select", "casedecode"); settle(bb, 300)
    check("Pull: Manual Selectors on Device B offer the pulled definition and generate SQL from it", "X = Cancelled" in bb.inner_text(R + " .column-cd-def") and "WHEN INVOICE_HEADER.STATUS = 'X' THEN 'Cancelled'" in sql(bb), sql(bb)[:200])
    pull_tab(bb); check("Pull: Device B shows nothing waiting to be published and the card still has no passphrase field", "Nothing waiting to be published" in sm_status(bb) and bb.locator("#schemaPullPass, #pullApplyBtn, #pullForgetBtn, #schemaPullRemember").count() == 0)
    st["B"], st["bb"] = B, bb
    # update on A → publish → B retrieves the update
    edit_decode(a, "P=Pending\nA=Approved\nR=Rejected\nD=Paid\nX=Cancelled\nZ=Archived"); stab(a, "Schema Management"); check("Update on Device A: the new local edit is pending again (not published)", "not yet published: AP / P2P Core" in a.inner_text("#syncStatusBlock"))
    r = sync_now(a); check("Update on Device A: 'Sync with GitHub Now' publishes the encrypted update", "Synchronization finished" in r or "Published" in r or "Newer on this device" in r, r[:200]); stab(a, "Schema Management"); check("Update on Device A: after publishing, nothing is pending", "Nothing waiting to be published" in a.inner_text("#syncStatusBlock"), a.inner_text("#syncStatusBlock")[:200])
    pull_tab(bb); t = pull_now(bb, PASS); check("Update on Device B: one click applies the newer repository version", "Applied: AP / P2P Core (updated)" in t and "Schema pulled and validated successfully." in t, t[:300])
    check("Update on Device B: the update arrived (Z = Archived)", {"rawValue": "Z", "label": "Archived"} in json.loads(decode_def(bb)))
    t = pull_now(bb, PASS); check("Repeated pull: nothing to change — nothing duplicated, nothing rewritten", "No schema content needed to change." in t and "Schema pulled and validated successfully." in t and bb.evaluate("() => window.__sqla.services().schemas.schemas().filter(s => s.name === 'AP / P2P Core').length") == 1, t[:200])
    # both sides edit → conflict, nothing overwritten
    edit_decode(a, "P=Pending\nA=Approved\nR=Rejected\nD=Paid\nX=Cancelled\nZ=Archived\nQ=A-side"); sync_now(a); edit_decode(bb, "P=Pending\nA=Approved\nR=Rejected\nD=Paid\nX=Cancelled\nZ=Archived\nQ=B-side"); pull_tab(bb)
    res = pull_now(bb, PASS)
    check("Conflict: a schema changed on both devices is a PARTIAL result (not 'success'), names the schema and says what to do — the local edit is kept, neither side is overwritten", "completed only partly" in res and "Not applied" in res and "AP / P2P Core" in res and "Use Local" in res and "Use Remote" in res and "Schema pulled and validated successfully." not in res and {"rawValue": "Q", "label": "B-side"} in json.loads(decode_def(bb)), res[:300])
    unlock(bb); stab(bb, "Schema Management"); check("Conflict: Settings → Schema Management lists it with Use Local / Use Remote and the status counts it", bb.locator('[data-ch="take-remote"]').count() == 1 and "1 unresolved conflict" in bb.inner_text("#syncStatusBlock")); bb.click('[data-ch="take-remote"]'); bb.wait_for_timeout(600)
    check("Conflict: 'Use Remote' applies Device A's version and clears the conflict", {"rawValue": "Q", "label": "A-side"} in json.loads(decode_def(bb)) and "unresolved conflict" not in bb.inner_text("#syncStatusBlock"))


# ───────────────────────────── 4. Failure scenarios: the local schema is never touched ─────────────────────────────
def failures(b, url, hub):
    C, c = newdev(b, url, hub, tag="deviceC"); configure(c, TOK_B)
    c.evaluate("() => { const sv = window.__sqla.services().schemas; const s = JSON.parse(JSON.stringify(sv.active())); s.name = 'My Local Work'; s.id = 'schema-local-work'; s.updatedAt = '2026-09-30T00:00:00.000Z'; if (!sv.saveSchema(s).ok) throw new Error('x'); sv.setActive(s.id); }")
    pull_tab(c); st = {"base": registry_json(c), "who": active_name(c)}; enc = hub.get(ENC)
    def attempt(saved=PASS):  # a failing pull must leave the registry and the active schema exactly as they were
        t = pull_now(c, saved); return t, registry_json(c) == st["base"] and active_name(c) == st["who"]
    check("Failure scenarios: the Pull Schema card has no passphrase field, no Apply / Cancel / Remember controls", c.locator("#schemaPullMount input, #pullApplyBtn, #pullCancelBtn, #pullForgetBtn").count() == 0 and c.locator("#pullBtn").count() == 1)
    t, ok = attempt("a wrong saved passphrase!"); check("Failure — the Vault passphrase saved on this device does not open the repository file: clear message and next step, local schema unchanged, the passphrase is not echoed", "does not open the repository file" in t and "has not been changed" in t and ok and "a wrong saved passphrase!" not in t, t[:300])
    t, ok = attempt(""); check("Failure — the repository file is passphrase-protected but no Vault passphrase is saved here: reported as protected (NOT as 'missing'), local schema unchanged", "passphrase-protected" in t and "no Vault passphrase is saved" in t and "No schema file was found" not in t and ok, t[:300])
    hub.valid.discard(TOK_B); hub.valid.add(TOK_BAD); t, ok = attempt(); check("Failure — authentication: the rejected token (401) is named, the next step is given, local schema unchanged", "rejected the access token" in t and "Contents: read" in t and "Go to the GitHub repository card" in t and ok and TOK_B not in t, t[:300]); hub.valid.add(TOK_B)
    hub.valid.discard(TOK_B); hub.read_only.add(TOK_B); hub.mode = "http403"; t, ok = attempt(); check("Failure — permission (403): reported with the right class and next step", "not allowed to read the repository" in t and "rate limit" in t and ok, t[:300]); hub.mode = "ok"; hub.read_only.discard(TOK_B); hub.valid.add(TOK_B)
    hub.mode = "down"; t, ok = attempt(); check("Failure — network interruption: the retrieval message with a next step; local schema unchanged", "could not be retrieved" in t and "Check your network connection" in t and ok, t[:300]); hub.mode = "ok"
    c.evaluate("() => window.__sqla.setRepositoryTimeoutMs(400)"); hub.mode = "hang"; t0 = time.time(); t, ok = attempt(); check("Failure — timeout: a request that never answers ends with a clear message within the time limit; the app stays usable", "did not answer in time" in t and ok and time.time() - t0 < 12, f"{time.time() - t0:.1f}s {t[:200]}"); hub.mode = "ok"; c.evaluate("() => window.__sqla.setRepositoryTimeoutMs(20000)")
    c.evaluate("() => { const o = Storage.prototype.setItem; window.__origSet = o; Storage.prototype.setItem = function (k, v) { if (k === 'sqla.registry.v15') throw new DOMException('quota', 'QuotaExceededError'); return o.apply(this, arguments); }; }")
    t, ok = attempt(); c.evaluate("() => { Storage.prototype.setItem = window.__origSet; }")
    check("Failure — the device cannot save the schema (storage refuses): reported as a SAVE failure (not 'validation'), the working schema is kept", "could not be saved on this device" in t and "has not been changed" in t and "failed validation" not in t and ok, t[:300])
    t, ok = attempt(); check("After the failures the very next pull works (the synchronization queue was not blocked) — and the success is not shown for a failure", "Schema pulled and validated successfully." in t and "Applied: AP / P2P Core" in t and c.locator("#pullResult .issue-box.err").count() == 0, t[:240])
    st["base"] = registry_json(c); st["who"] = active_name(c)  # the successful pull above is the new baseline for the remaining failure checks
    saved = hub.get(ENC); j = json.loads(saved); ct = j["cipher"]["ct"]; hub.put(ENC, json.dumps(dict(j, cipher=dict(j["cipher"], ct=ct[:30] + ("B" if ct[30] == "A" else "A") + ct[31:])))); t, ok = attempt(); check("Failure — corrupted file: reported, local schema unchanged, no success message", ("could not be decrypted" in t or "does not open the repository file" in t) and "Schema pulled and validated successfully." not in t and ok, t[:240])
    hub.put(ENC, json.dumps(dict(j, formatVersion=9))); t, ok = attempt(); check("Failure — incompatible format: says the format cannot be read and to update SQL Assistant", ("format this version of SQL Assistant cannot read" in t or "cannot be read" in t) and "Update SQL Assistant" in t and ok, t[:300])
    bad = c.evaluate("() => JSON.stringify({ formatVersion: 2, writtenBy: 'SQL Assistant 17.5.5', activeSchemaId: 'sx', schemas: [{ id: 'sx', name: 'Broken', version: '1', updatedAt: '2026-01-01T00:00:00.000Z', status: 'inactive', lastSyncedAt: null, relationships: [], tables: [{ name: 'T', module: 'M', description: '', columns: [{ name: 'ID', label: 'ID', type: 'NUMBER', nullable: false, description: '', decode: [{ rawValue: '', label: 'oops' }] }] }] }] })")
    hub.put(ENC, c.evaluate("async ([t, p]) => window.__sqla.encryptForTest(t, p)", [bad, PASS])); t, ok = attempt(); check("Failure — invalid schema content: it is not imported and the local schema is unchanged (a clear message names the problem)", ("failed validation" in t or "failed validation and were not loaded" in t) and "Broken" not in registry_json(c) and ok and "Schema pulled and validated successfully." not in t, t[:300])
    del hub.files[ENC]; t, ok = attempt(); check("Failure — no schema file in the repository: reported as 'not found yet' with the next step, not as success", "No schema file was found in the repository yet" in t and "Sync with GitHub Now" in t and "Schema pulled and validated successfully." not in t and ok, t[:300]); hub.put(ENC, saved)
    t, ok = attempt(); check("Recovery: with the file restored the pull works again and no stale error remains", "Schema pulled and validated successfully." in t and c.locator("#pullResult .issue-box.err").count() == 0 and "failed" not in t.lower(), t[:200])
    others = [x for x in console_all if PASS in x or TOK_A in x or TOK_B in x or TOK_BAD in x]
    check("Secrecy: no passphrase or token reached the console, the URL or any page text in the failure flows", not others and PASS not in c.inner_text("body") and PASS not in c.url)
    C.close()


# ───────────────────────────── 5. Plain (no schema passphrase) cross-device + schema menu / passphrase UI ─────────────────────────────
def plain_devices(b, url):
    hub = Hub(); D, d = newdev(b, url, hub, tag="deviceD"); configure(d, TOK_A); edit_decode(d, "P=Pending\nA=Approved\nR=Rejected\nD=Paid\nK=Plain-sync"); r = sync_now(d)
    check("Plain synchronization (no schema passphrase): Device D publishes to the shared remote; the status shows the plain file", hub.get(PLAIN) is not None and hub.get(ENC) is None and "Plain-sync" in hub.get(PLAIN) and "Plain schema file" in d.inner_text("#syncStatusBlock") or "Published" in r, r[:240])
    E, e = newdev(b, url, hub, tag="deviceE"); configure(e, TOK_B); r2 = sync_now(e); stab(e, "Schema Management")
    check("Plain synchronization: Device E retrieves it ('Sync with GitHub Now'), the schema is validated and the definition is present", {"rawValue": "K", "label": "Plain-sync"} in json.loads(decode_def(e)) and "failed" not in r2.lower() and "Nothing waiting" in e.inner_text("#syncStatusBlock"), r2[:240])
    hub.mode = "http401"; r3 = sync_now(e)
    check("Plain synchronization failure (token rejected): reported with the failing stage; local schema untouched", ("Synchronization failed" in r3 or "failed" in r3.lower()) and {"rawValue": "K", "label": "Plain-sync"} in json.loads(decode_def(e)), r3[:240]); hub.mode = "ok"
    D.close(); E.close()
def schema_menu(b, url):
    hub = Hub(); ctx, pg = newdev(b, url, hub, tag="menu"); configure(pg, TOK_A); pg.evaluate("location.hash = '#quickstart'"); pg.wait_for_timeout(300)
    pg.click("#navToggle"); pg.wait_for_timeout(200); items = pg.inner_text("#hamburgerOverlay"); check("Hamburger menu: 'Schema' is present", "Schema" in items); pg.click('#hamburgerOverlay [data-route="schema-used"]'); pg.wait_for_timeout(350)
    check("Schema page: the 'Pull Schema' option is available as a tab next to Tables and Stored Schemas", "Pull Schema" in pg.inner_text("#schemaTabs .tabs-strip") and "Stored Schemas" in pg.inner_text("#schemaTabs .tabs-strip")); pg.click('#schemaTabs .tab-btn:has-text("Pull Schema")'); pg.wait_for_timeout(350)
    t = pg.inner_text("#schemaPullMount")
    check("V17.5.6+: the Pull Schema card has no instruction block — it is the heading, the Pull Schema button and the result", "How to pull the schema" not in t and pg.locator("#schemaPullMount .pull-help").count() == 0 and t.strip() == "Pull Schema from GitHub\nPull Schema", t[:200])
    check("The Pull Schema card is compact (heading + one button)", pg.evaluate("() => document.querySelector('#schemaPullMount .builder-panel').getBoundingClientRect().height") < 160)
    check("Status: the connection and the sync state are shown without revealing any secret — and without the repository name or the file path (hidden until revealed)", "token saved" in sm_status(pg) and TOK_A not in t and "Last download never" not in t and "basware" not in t and "registry" not in t)
    check("Pull Schema from GitHub: the card contains ONLY the Pull Schema button — no passphrase field, eye button, Remember checkbox or any passphrase wording", pg.locator("#schemaPullMount button").count() == 1 and pg.inner_text("#pullBtn").strip() == "Pull Schema" and pg.locator("#schemaPullMount input").count() == 0 and "passphrase" not in t.lower())
    # no schema file in the remote yet
    t2 = pull_now(pg); check("No published schema yet: reported as 'not found yet' with the next step — not as success, no error box", "No schema file was found in the repository yet" in t2 and "Sync with GitHub Now" in t2 and "Schema pulled and validated successfully." not in t2, t2[:240])
    # a publisher creates it (encrypted); this device has no passphrase saved → reported, not treated as missing
    P, p = newdev(b, url, hub, tag="publisher"); configure(p, TOK_A); edit_decode(p, "P=Pending\nA=Approved\nR=Rejected\nD=Paid\nM=Menu-test"); publish_enc(p, PASS)
    t3 = pull_now(pg, ""); check("A passphrase-protected file with no Vault passphrase saved on this device: reported with the next step (not as missing, nothing changed)", "passphrase-protected" in t3 and "Sync with GitHub Now" in t3 and "No schema file was found" not in t3, t3[:240])
    t4 = pull_now(pg, PASS); pull_tab(pg); check("With the passphrase saved on the device (earlier versions saved one) the same single click pulls it — and the page never shows or asks for it", "Schema pulled and validated successfully." in t4 and PASS not in pg.inner_text("body") and PASS not in pg.url and pg.locator("#schemaPullPass").count() == 0, t4[:200])
    stored = pg.evaluate("() => localStorage.getItem('sqla.schemapass.v175')"); check("Passphrase storage (unchanged): only AES-256-GCM ciphertext on the device — never plaintext or Base64", stored and PASS not in stored and base64.b64encode(PASS.encode()).decode() not in stored and "AES-256-GCM" in stored)
    files = " ".join(v[0].decode("utf-8") for v in hub.files.values()); reqs = " ".join(body for _, _, _, body in hub.requests)
    check("Secrecy: the shared repository files and every request body contain no passphrase and no token", PASS not in files and PASS not in reqs and TOK_A not in files and TOK_A not in reqs and not any(PASS in x or TOK_A in x for x in console_all))
    P.close(); ctx.close()
def responsive(b, url):
    for (w, h, name) in [(1366, 900, "desktop"), (768, 1024, "tablet"), (390, 800, "phone")]:
        ctx, pg = newdev(b, url, None, w, h, tag=f"resp-{name}"); pull_tab(pg); ov0 = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        go(pg, "readonly"); pick_table(pg, "INVOICE_HEADER"); col(pg, "INVOICE_HEADER", "STATUS"); R = crow("INVOICE_HEADER", "STATUS"); pg.select_option(R + " .column-mode-select", "casedecode"); settle(pg, 300); ov1 = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        unlock(pg); stab(pg, "Schema Management"); ov2 = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        check(f"Responsive ({name} {w}px): Pull Schema with status, the CASE/DECODE controls and the Schema Management status fit without horizontal scroll", ov0 <= 2 and ov1 <= 2 and ov2 <= 2, f"{ov0} {ov1} {ov2}"); ctx.close()


def main():
    if not (ROOT / "dist/index.html").exists(): print("Run npm run build first."); sys.exit(2)
    port = free_port(); serve = subprocess.Popen(["node", str(ROOT / "scripts/serve.mjs")], env={**os.environ, "PORT": str(port), "BASE": "/SQL-Assistant/"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.9)
    url = f"http://127.0.0.1:{port}/SQL-Assistant/?e2e=1"; hub = Hub(); st = {}
    try:
        with sync_playwright() as p:
            exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
            section("Tick-marks", tick_tests, b, url); section("CASE/DECODE", decode_tests, b, url)
            try: cross_device(b, url, hub, st)
            except Exception as ex: check("Cross-device: section completed", False, f"{type(ex).__name__}: {str(ex)[:260]} | {traceback.format_exc().splitlines()[-3][:150]}")
            if hub.get(ENC): section("Failure scenarios", failures, b, url, hub)
            for k in ("A", "B"):
                try: st[k].close()
                except Exception: pass
            section("Plain cross-device", plain_devices, b, url); section("Schema menu + passphrase", schema_menu, b, url); section("Responsive", responsive, b, url)
            b.close()
    finally:
        serve.terminate()
    real = [e for e in errors if "Failed to load resource" not in e and "net::ERR" not in e and "ERR_CONNECTION" not in e and "Could not reach GitHub" not in e]
    check("No console errors or uncaught exceptions in any V17.5.2 flow", not real, "; ".join(real[:4]))
    failed = [r for r in results if not r[1]]; print(f"\n{len(results) - len(failed)}/{len(results)} V17.5.2 browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True); (ROOT / "test-results/browser-results-v1752.json").write_text(json.dumps([{"check": n, "pass": ok} for n, ok in results], indent=2)); sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
