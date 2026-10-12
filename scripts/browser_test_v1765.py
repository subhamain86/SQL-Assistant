"""SQL Assistant V17.6.5 — real-browser tests of the CENTRAL ADMIN PASSWORD on the PRODUCTION build (Chromium / Playwright).
   npm run build && python3 scripts/browser_test_v1765.py        (CHROME_PATH=/path/to/chrome to use an installed browser)

What is REAL: the production page on a real static server (scripts/serve.mjs); the application's own code, Web Crypto and storage; the REAL publication script (scripts/publish-data.mjs, run as a process) turning the
repository file into the published copy a device with NO token reads; every "device" is a separate Chromium context (no shared localStorage / IndexedDB).
What is EMULATED: the repository (the application's in-memory test repository, installed through the ?e2e=1 hook — it stands in for the broker / token route of the authorized device) and GitHub Actions
(the publication step is run by the test after each change, the way the workflow does it). No request from any page goes anywhere but the local site (checked). The real broker over HTTP is covered by the Node tests.
Covers: Security tab UI (Save, Reset to default + confirmation, strength indicator, Show/Hide, autocomplete, keyboard, aria, mobile width), save on device A → accepted on clean device B → old rejected,
a password changed elsewhere works at once on a failed unlock, reset (authorization, effect on both devices, unlocked session ends), first Save after reset, failed writes leave everything unchanged,
lock-out, Danger Zone, escaping, fallback with no write route, no secret anywhere."""
import json, os, re, sys, time, subprocess, pathlib, shutil, tempfile, base64
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import browser_test as BT
ROOT = BT.ROOT; check = BT.check; ready = BT.ready; go = BT.go; free_port = BT.free_port; results = BT.results
CRED = "sql-assistant-data/security/admin-credential.json"; OWNER_REPO = "basware/sk-ap-sql-assistant"; COMMIT = "c0ffee1" + "1" * 33
PW1 = "Quartz-Lantern-Harbour-41"; PW2 = "Violet-Meadow-Compass-77"; PW3 = "Amber-Willow-Signal-52"; LOCAL = "Local-Only-Pass-12"
errors, console_all, requests = [], [], []
def watch(pg, tag):
    pg.on("console", lambda m: (console_all.append(m.text), m.type == "error" and errors.append(f"{tag}: {m.text}"))); pg.on("pageerror", lambda e: errors.append(f"{tag}: {e}")); pg.on("dialog", lambda d: d.accept())
    pg.on("request", lambda r: requests.append((tag, r.method, r.url, r.post_data or "")))
def site(port):
    d = pathlib.Path(tempfile.mkdtemp(prefix="sqla65-site-")); shutil.copytree(ROOT / "release", d / "release"); (d / "scripts").mkdir(); shutil.copy(ROOT / "scripts/serve.mjs", d / "scripts/serve.mjs")
    p = subprocess.Popen(["node", str(d / "scripts/serve.mjs")], env={**os.environ, "PORT": str(port), "BASE": "/"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.9); return p, d
def publish(d, text):
    """The workflow's step: mirror sql-assistant-data/ of the repository into <site>/sql-assistant-data/ with the marker last."""
    src = pathlib.Path(tempfile.mkdtemp(prefix="sqla65-src-")); f = src / CRED; f.parent.mkdir(parents=True); f.write_text(text, encoding="utf-8")
    r = subprocess.run(["node", str(ROOT / "scripts/publish-data.mjs"), "--src", str(src), "--dest", str(d / "release"), "--commit", COMMIT, "--repository", OWNER_REPO], capture_output=True, text=True, timeout=60); shutil.rmtree(src, ignore_errors=True); return r.returncode == 0, r.stdout + r.stderr
def newdev(b, url, tag, w=1366, h=900):
    ctx = b.new_context(viewport={"width": w, "height": h}); pg = ctx.new_page(); watch(pg, tag); pg.goto(url + "?e2e=1"); ready(pg); return ctx, pg
def use_repo(pg): pg.evaluate("() => { const r = window.__sqla.memoryRepository({}); window.__repo = r; window.__sqla.setRepositoryOverride(r); window.__sqla.render(); }"); pg.wait_for_timeout(150)
def repo_text(pg): return pg.evaluate("(p) => window.__repo.files.get(p)?.text ?? null", CRED)
def record(pg):
    t = repo_text(pg); return json.loads(t) if t else None
def unlock(pg, pw="admin", wait=1500):
    go(pg, "settings")
    if pg.locator("#settingsPwInput").count(): pg.fill("#settingsPwInput", pw); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(wait)
def unlocked(pg): return pg.locator("#lockSettingsBtn").count() == 1
def lock(pg):
    if pg.locator("#lockSettingsBtn").count(): pg.click("#lockSettingsBtn"); pg.wait_for_timeout(300)
def fill_pw(pg, cur, new, conf=None):
    pg.fill("#pwCurrent", cur); pg.fill("#pwNew", new); pg.fill("#pwConfirm", new if conf is None else conf)
def storage(pg): return pg.evaluate("() => JSON.stringify({l: Object.fromEntries(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])), s: Object.fromEntries(Object.keys(sessionStorage).map(k => [k, sessionStorage.getItem(k)]))})")
def forms(pw): return [pw, base64.b64encode(pw.encode()).decode(), pw.encode().hex(), pw[::-1]]
def holds(text, *pws): return any(f in text for pw in pws for f in forms(pw))
def wait_result(pg, sel, pattern, timeout=15000):
    try: pg.wait_for_function("([s, p]) => { const e = document.querySelector(s); return !!e && new RegExp(p, 'i').test(e.innerText); }", arg=[sel, pattern], timeout=timeout)
    except Exception: pass
    return pg.inner_text(sel)
def main():
    for f in ["dist/index.html", "release/index.html", "release/version.json"]: check(f"Build output exists: {f}", (ROOT / f).exists())
    html = (ROOT / "dist/index.html").read_text(encoding="utf-8"); check("Production build is V17.6.5 and carries the CSP without eval", json.loads((ROOT / "release/version.json").read_text())["version"] == "17.6.5" and "Content-Security-Policy" in html and "unsafe-eval" not in html)
    check("The bundle contains the new Security UI strings and no password, token or key", "Save (all devices)" in html and "Reset to default" in html and "new-password" in html and not re.search(r"ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}", html) and not holds(html, PW1, PW2, PW3, LOCAL))
    port = free_port(); proc, sdir = site(port); url = f"http://127.0.0.1:{port}/"
    try:
        with sync_playwright() as p:
            exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
            device_a(b, url, sdir); device_b_and_reset(b, url, sdir); fallback_and_lockout(b, url, sdir)
            b.close()
    finally:
        try: proc.terminate()
        except Exception: pass
        shutil.rmtree(sdir, ignore_errors=True)
    bad = [e for e in errors if "Failed to load resource" not in e]
    check("No console errors or uncaught exceptions in any V17.6.5 flow (expected network-status lines excluded); no password in any console message", not bad and not holds("\n".join(console_all), PW1, PW2, PW3, LOCAL), bad[:3])
    check("Hygiene: no request from any page went anywhere but the local site, and none carries a password (URL or body)", all(u.startswith(f"http://127.0.0.1:{port}/") for _, _, u, _ in requests) and not any(holds(u + body, PW1, PW2, PW3, LOCAL) for _, _, u, body in requests), [u for _, _, u, _ in requests if not u.startswith(f"http://127.0.0.1:{port}/")][:3])
    failed = [r for r in results if not r[1]]; print(f"\n{len(results) - len(failed)}/{len(results)} V17.6.5 browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True); (ROOT / "test-results/browser-results-v1765.json").write_text(json.dumps([{"check": n, "pass": ok} for n, ok in results], indent=2)); sys.exit(1 if failed else 0)

# ───────────────────────────── Device A — the authorized device (write route) ─────────────────────────────
def device_a(b, url, sdir):
    ctx, pg = newdev(b, url, "A"); use_repo(pg); unlock(pg, "admin"); check("A: Settings unlock with the default password (no central record yet = V17.6.4 behaviour)", unlocked(pg) and pg.locator("#pwCurrent").count() == 1)
    check("A: Security shows Save (all devices), the existing Change Password, Reset to default, the strength indicator and the status line", pg.is_visible("#savePwCentralBtn") and pg.is_visible("#changePwBtn") and pg.is_visible("#resetCentralBtn") and pg.locator("#pwStrength").count() == 1 and "not central" in pg.inner_text("#adminCredStatus"))
    check("A: new-password fields use autocomplete=new-password; Show/Hide buttons carry accessible labels; the Save and Reset buttons have aria-labels", pg.get_attribute("#pwNew", "autocomplete") == "new-password" and pg.get_attribute("#pwConfirm", "autocomplete") == "new-password" and pg.get_attribute("#pwCurrent", "autocomplete") == "current-password" and pg.get_attribute('[data-eye-for="pwNew"]', "aria-label") == "Show password" and "all devices" in pg.get_attribute("#savePwCentralBtn", "aria-label") and "every device" in pg.get_attribute("#resetCentralBtn", "aria-label"))
    pg.fill("#pwNew", "abc"); check("A: strength indicator reports a short password", "Too short" in pg.inner_text("#pwStrength")); pg.fill("#pwNew", PW1); check("A: strength indicator reports a long password as at least Good", re.search(r"good|strong", pg.inner_text("#pwStrength"), re.I) is not None, pg.inner_text("#pwStrength"))
    pg.click('[data-eye-for="pwNew"]'); check("A: Show/Hide — the field is revealed and the button now says Hide password", pg.get_attribute("#pwNew", "type") == "text" and pg.get_attribute('[data-eye-for="pwNew"]', "aria-label") == "Hide password" and pg.get_attribute('[data-eye-for="pwNew"]', "aria-pressed") == "true"); pg.click('[data-eye-for="pwNew"]'); check("A: …and hidden again", pg.get_attribute("#pwNew", "type") == "password")
    fill_pw(pg, "admin", PW1, "Different-Pass-99"); pg.click("#savePwCentralBtn"); pg.wait_for_timeout(300); check("A: mismatching confirmation is refused with a message", "do not match" in pg.inner_text("#pwResult") and repo_text(pg) is None)
    fill_pw(pg, "admin", "ninechars"); pg.click("#savePwCentralBtn"); t = wait_result(pg, "#pwResult", "at least 10"); check("A: weak password refused with an actionable message; nothing written", "at least 10 characters" in t and "Choose a longer password" in t and repo_text(pg) is None, t)
    fill_pw(pg, "admin", "admin"); pg.click("#savePwCentralBtn"); t = wait_result(pg, "#pwResult", "admin"); check("A: the default password cannot be chosen", "admin" in t and repo_text(pg) is None, t)
    fill_pw(pg, "definitely-wrong", PW1); pg.click("#savePwCentralBtn"); t = wait_result(pg, "#pwResult", "incorrect", 20000); check("A: wrong current password refused (nothing written)", "incorrect" in t.lower() and "Re-enter the current Admin Password" in t and repo_text(pg) is None, t)
    fill_pw(pg, "admin", PW1); pg.focus("#savePwCentralBtn"); pg.keyboard.press("Enter"); t = wait_result(pg, "#pwResult", "saved for all devices", 25000)
    rec = record(pg); check("A: Save (all devices) — started from the keyboard — writes the record, reads it back and only then reports success", "saved for all devices" in t and "read back" in t and rec is not None and rec["revision"] == 1 and rec["isDefault"] is False, t[:200])
    txt = repo_text(pg) or ""; check("A: the repository file is the encrypted-marker envelope — exact keys, no plaintext / Base64 / hex / reversed password", list(rec.keys()) == ["format", "formatVersion", "revision", "updatedAt", "updatedBy", "isDefault", "marker"] and list(rec["marker"].keys()) == ["salt", "iv", "ciphertext"] and rec["format"] == "sqla-admin-credential" and not holds(txt, PW1), txt[:120])
    st = storage(pg); check("A: nothing in A's browser storage holds the password (plain, Base64, hex, reversed); the fields were cleared", not holds(st, PW1) and pg.input_value("#pwNew") == "" and pg.input_value("#pwCurrent") == "")
    check("A: the status line now says the record is central (revision 1)", "central" in pg.inner_text("#adminCredStatus") and "revision 1" in pg.inner_text("#adminCredStatus") and "custom password set" in pg.inner_text("#pwStatusText"))
    fill_pw(pg, PW1, "Another-Pass-1234"); pg.click("#changePwBtn"); t = wait_result(pg, "#pwResult", "central", 10000); check("A: Change Password (device only) is refused while a central record exists — it would be ignored", "managed centrally" in t, t)
    lock(pg); unlock(pg, "admin"); err = pg.inner_text("#settingsPwError") if pg.locator("#settingsPwError").count() else ""; check("A: after Save the OLD password is rejected on A", pg.locator("#settingsPwInput").count() == 1 and "Incorrect" in err, err)
    unlock(pg, PW1); check("A: …and the new one unlocks", unlocked(pg))
    ok, out = publish(sdir, txt); check("Publication (the workflow's step) mirrors the record next to the app and lists it in the marker", ok and (sdir / "release" / CRED).exists() and CRED in json.loads((sdir / "release/sql-assistant-data/published.json").read_text())["files"], out)
    # failed writes leave everything unchanged and name the step
    before_repo = repo_text(pg)
    for label, js, want in [("a write the repository refuses", "() => { window.__repo.write = async () => { throw new Error('Writing x failed: HTTP 500.'); }; }", ["writing the central record"]), ("a conflict", "() => { window.__repo.write = async () => { throw new Error('Writing failed: the file changed on the server — synchronize again.'); }; }", ["writing the central record", "conflict"]), ("an unreadable repository", "() => { window.__repo.read = async () => { throw new Error('Could not reach GitHub (offline).'); }; }", ["reading the central record", "Could not reach GitHub"])]:
        pg.click('.tab-btn:has-text("Security")'); pg.wait_for_timeout(200); store_before = storage(pg); pg.evaluate(js); fill_pw(pg, PW1, PW2); pg.click("#savePwCentralBtn"); t = wait_result(pg, "#pwResult", "Nothing was changed|NOT changed", 20000)
        check(f"A: failed save ({label}) names the failed step, says nothing was changed", re.search("Nothing was changed|NOT changed", t) is not None and all(w in t for w in want), t[:300])
        check(f"A: …({label}) the repository record and A's browser storage are byte-identical to before", before_repo == repo_text(pg) and store_before == storage(pg))
        use_repo_keep(pg, before_repo)
    lock(pg); unlock(pg, PW2); check("A: after the failures the NEW password was never applied (PW2 rejected)", not unlocked(pg)); unlock(pg, PW1); check("A: …and the old one (PW1) still works", unlocked(pg))
    # XSS: a hostile error message is shown as text, never as markup
    pg.evaluate("() => { window.__repo.write = async () => { throw new Error('<img src=x onerror=window.__xss=1> <b id=xssb>bold</b>'); }; }"); fill_pw(pg, PW1, PW2); pg.click("#savePwCentralBtn"); wait_result(pg, "#pwResult", "xss|img|bold", 15000)
    check("A: a hostile error text is escaped (no element created, no script run)", pg.locator("#pwResult img").count() == 0 and pg.locator("#xssb").count() == 0 and pg.evaluate("() => window.__xss === undefined"))
    use_repo_keep(pg, before_repo)
    # Mobile width: Security tab
    pg.set_viewport_size({"width": 375, "height": 740}); pg.click('.tab-btn:has-text("Security")'); pg.wait_for_timeout(300)
    ov = pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"); hs = pg.evaluate("() => [...document.querySelectorAll('.sec-actions .btn')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), r.left >= 0 && r.right <= window.innerWidth]; })")
    check("A: mobile width (375 px) — no horizontal overflow; Save, Change, Lock and Reset buttons are full width, at least 40 px high and inside the viewport", ov and len(hs) == 4 and all(h[0] >= 250 and h[1] >= 40 and h[2] for h in hs), (ov, hs))
    pg.set_viewport_size({"width": 1366, "height": 900})
    ctx.close()

# ───────────────────────────── Device B (nothing saved, no token) — and the reset ─────────────────────────────
def device_b_and_reset(b, url, sdir):
    # A is a fresh page again (its storage is gone with the context), so rebuild the same history: A saves PW1 and publishes.
    shutil.rmtree(sdir / "release/sql-assistant-data", ignore_errors=True)  # a clean site again: no publication yet
    ctxA, A = newdev(b, url, "A2"); use_repo(A); unlock(A, "admin"); A.fill("#pwCurrent", "admin"); A.fill("#pwNew", PW1); A.fill("#pwConfirm", PW1); A.click("#savePwCentralBtn"); wait_result(A, "#pwResult", "saved for all devices", 25000)
    ok, out = publish(sdir, repo_text(A)); check("B-setup: A saved revision 1 and the publication ran", ok and record(A)["revision"] == 1, out)
    ctxB, B = newdev(b, url, "B"); B.wait_for_timeout(1500)
    unlock(B, "admin"); err = B.inner_text("#settingsPwError") if B.locator("#settingsPwError").count() else ""; check("B: the OLD password (admin) is rejected on a clean device B after the sync", not unlocked(B) and "Incorrect" in err, err)
    unlock(B, PW1); check("B: the password saved on A is accepted on clean device B (published copy, no token)", unlocked(B))
    check("B: B holds the record as a cache (no password in it) and shows it as central", "sqla.credrec.v1765" in storage(B) and not holds(storage(B), PW1) and "central" in B.inner_text("#adminCredStatus"))
    B.fill("#pwCurrent", PW1); B.fill("#pwNew", PW2); B.fill("#pwConfirm", PW2); B.click("#savePwCentralBtn"); t = wait_result(B, "#pwResult", "no way to write", 15000)
    check("B: Save with no write route — says so plainly, names the step, nothing saved, no sign-in prompt invented", "no way to write to the repository" in t and "Nothing was changed" in t and record(A)["revision"] == 1, t[:200])
    B.fill("#pwCurrent", PW1); B.fill("#pwNew", "Another-Pass-1234"); B.fill("#pwConfirm", "Another-Pass-1234"); B.click("#changePwBtn"); t = wait_result(B, "#pwResult", "central", 8000); check("B: the V17.6.4 local change is not a fallback while a central record exists (it would be ignored)", "managed centrally" in t, t)
    # A changes the password again; B (cached revision 1) enters the new one on the lock screen
    A.fill("#pwCurrent", PW1); A.fill("#pwNew", PW2); A.fill("#pwConfirm", PW2); A.click("#savePwCentralBtn"); wait_result(A, "#pwResult", "saved for all devices", 25000); rev2 = record(A)
    check("A: a second Save raises the revision and replaces the marker (fresh salt and IV)", rev2["revision"] == 2 and rev2["marker"]["salt"] != json.loads(publish_text(sdir))["marker"]["salt"])
    publish(sdir, repo_text(A)); lock(B); unlock(B, PW2, 2500); check("B: a password changed elsewhere works AT ONCE — the failed unlock refreshed the record once and the retry succeeded (no reload, no waiting)", unlocked(B))
    check("B: …and that did not count as a wrong attempt (no lock-out counter)", "sqla.pwlock.v1765" not in storage(B))
    lock(B); unlock(B, PW1); check("B: the previous password is rejected now", not unlocked(B))
    # ── reset ──
    A.click('.tab-btn:has-text("Security")'); A.wait_for_timeout(200); A.click("#resetCentralBtn"); A.wait_for_timeout(300)
    body = A.inner_text("#resetCentralModal"); check("A: Reset to default opens a confirmation that states it applies to every device", "This sets the Admin Password to the default admin on every device." in body and A.locator("#resetCurrentPw").count() == 1 and A.get_attribute("#resetCentralModal .modal-card", "role") == "dialog", body[:200])
    A.click("#resetCancelBtn"); A.wait_for_timeout(200); check("A: Cancel closes it and changes nothing", A.locator("#resetCentralModal").count() == 0 and record(A)["revision"] == 2 and record(A)["isDefault"] is False)
    A.click("#resetCentralBtn"); A.wait_for_timeout(200); A.keyboard.press("Escape"); A.wait_for_timeout(200); check("A: Escape closes the dialog too (keyboard accessible)", A.locator("#resetCentralModal").count() == 0)
    A.click("#resetCentralBtn"); A.wait_for_timeout(200); A.fill("#resetCurrentPw", "wrong-password-1"); A.click("#resetConfirmBtn"); t = wait_result(A, "#resetCentralResult", "incorrect", 20000)
    check("A: reset with a WRONG password is refused (nothing written) and the dialog stays open with the reason", "incorrect" in t.lower() and record(A)["revision"] == 2 and A.locator("#resetCentralModal").count() == 1, t[:200])
    A.fill("#resetCurrentPw", PW2); A.click("#resetConfirmBtn"); A.wait_for_selector("#settingsPwInput", timeout=20000); A.wait_for_timeout(300)
    r3 = record(A); check("A: reset with the current password writes a new central record: isDefault true, higher revision, read back", r3["isDefault"] is True and r3["revision"] == 3 and r3["updatedBy"].startswith("device-") and not holds(repo_text(A), PW2), r3)
    check("A: after the reset A's Settings are locked and the lock screen explains it; the default-password hint is shown", not unlocked(A) and A.locator("#settingsPwInput").count() == 1 and "reset" in A.inner_text("main").lower() and "admin" in A.inner_text("main"))
    unlock(A, PW2); check("A: the old password no longer works on A", not unlocked(A)); unlock(A, "admin"); check("A: admin works again on A — with the existing default-password warning toast", unlocked(A) and "default Admin Password" in A.inner_text("#toastHost"))
    check("A: status line shows the default password in force", "default password in force" in A.inner_text("#adminCredStatus") and "default password in use" in A.inner_text("#pwStatusText"))
    # B was unlocked with PW2: the reset must end its session at its next refresh
    B.reload(); ready(B); unlock(B, PW2, 1200); check("B-setup: B unlocked with PW2 before the reset reaches it", unlocked(B))
    publish(sdir, repo_text(A)); B.evaluate("async () => { await window.__sqla.refreshAdminCredential('manual', { force: true }); }"); B.wait_for_timeout(800)
    check("B: a reset on another device ends B's unlocked session at its next refresh and warns", not unlocked(B) and "reset to the default" in B.inner_text("#toastHost"), B.inner_text("main")[:150])
    unlock(B, PW2); check("B: the old password fails on B after the reset", not unlocked(B)); unlock(B, "admin"); check("B: admin works on B after the reset (both devices now agree)", unlocked(B))
    # first Save after reset replaces the default record
    lock(A); unlock(A, "admin"); A.fill("#pwCurrent", "admin"); A.fill("#pwNew", PW3); A.fill("#pwConfirm", PW3); A.click("#savePwCentralBtn"); wait_result(A, "#pwResult", "saved for all devices", 25000); r4 = record(A)
    check("A: the first Save after a reset replaces the default record with a normal one (higher revision, isDefault false)", r4["isDefault"] is False and r4["revision"] == 4, r4)
    publish(sdir, repo_text(A)); lock(B); unlock(B, PW3, 2500); check("B: …and B follows (new password accepted on the first attempt, admin rejected)", unlocked(B)); lock(B); unlock(B, "admin"); check("B: admin no longer works on B", not unlocked(B))
    # Danger Zone with a central record: the central flow (confirmation), not the local reset
    unlock(A, PW3); A.click('.tab-btn:has-text("Danger Zone")'); A.wait_for_timeout(300); A.fill("#dangerPw", "x"); A.click("#dangerPwReset"); A.wait_for_timeout(400)
    check("A: Danger Zone 'Reset Admin Password to default' becomes the central flow when a central record exists (same confirmation dialog)", A.locator("#resetCentralModal").count() == 1 and "on every device" in A.inner_text("#resetCentralModal")); A.keyboard.press("Escape")
    # rollback protection through the site: an older record is refused, the user is told once, the device keeps its last good record
    good = repo_text(A); old = json.loads(publish_text(sdir)); old["revision"] = 1; stale = json.dumps(old, indent=2) + "\n"
    ok, _ = publish(sdir, stale); B.reload(); ready(B); B.wait_for_timeout(1500); cache_b = B.evaluate("() => localStorage.getItem('sqla.credrec.v1765')")
    check("B: a published record of an OLDER revision (rollback) was handed to B — B's cached record is still revision 4", ok and json.loads(cache_b)["revision"] == 4, cache_b)
    lock(B); unlock(B, PW3); check("B: PW3 (last good record) still works after a rolled-back publication", unlocked(B))
    st = B.inner_text("#adminCredStatus") if B.locator("#adminCredStatus").count() else ""; check("B: the status line tells that the record was refused and the last good one is kept", "refused" in st.lower() and "older revision" in st, st[:200])
    ctxA.close(); ctxB.close()
def publish_text(sdir): return (sdir / "release" / CRED).read_text(encoding="utf-8")
def use_repo_keep(pg, text):
    """Reinstall a healthy repository holding `text` (the test's own failure injections replaced its read / write)."""
    pg.evaluate("(a) => { const [p, t] = a; const r = window.__sqla.memoryRepository(t ? { [p]: t } : {}); window.__repo = r; window.__sqla.setRepositoryOverride(r); }", [CRED, text]); pg.wait_for_timeout(100)

# ───────────────────────────── a device that cannot write, and the lock-out ─────────────────────────────
def fallback_and_lockout(b, url, sdir):
    shutil.rmtree(sdir / "release/sql-assistant-data", ignore_errors=True)  # no publication at all: C is a device with no central record (V17.6.4 behaviour)
    ctx, C = newdev(b, url, "C"); C.wait_for_timeout(800)
    unlock(C, "admin"); C.fill("#pwCurrent", "admin"); C.fill("#pwNew", PW1); C.fill("#pwConfirm", PW1); C.click("#savePwCentralBtn"); t = wait_result(C, "#pwResult", "no way to write", 15000)
    check("C: with no write route Save says so plainly and nothing is saved centrally", "no way to write to the repository" in t and "Nothing was changed" in t and "Change Password" in t, t[:240])
    C.fill("#pwCurrent", "admin"); C.fill("#pwNew", LOCAL); C.fill("#pwConfirm", LOCAL); C.click("#changePwBtn"); t = wait_result(C, "#pwResult", "Admin Password changed", 15000)
    check("C: REGRESSION — with no central record the V17.6.4 local change works unchanged (this device only)", "Admin Password changed" in t and "sqla.credrec.v1765" not in storage(C) and not holds(storage(C), LOCAL), t)
    lock(C); unlock(C, LOCAL); check("C: the local password unlocks; the default no longer does", unlocked(C)); lock(C)
    # lock-out
    for i in range(5): unlock(C, f"wrong-{i}-attempt", 1100)
    err = C.inner_text("#settingsPwError"); check("C: after 5 wrong attempts the lock screen reports a lock-out (60 s)", "Too many wrong attempts" in err and re.search(r"(5\d|60) second", err) is not None, err)
    unlock(C, LOCAL, 900); err2 = C.inner_text("#settingsPwError"); check("C: even the CORRECT password is refused while locked out", not unlocked(C) and "Too many wrong attempts" in err2, err2)
    C.reload(); ready(C); unlock(C, LOCAL, 900); check("C: the lock-out survives a reload", not unlocked(C) and "Too many wrong attempts" in C.inner_text("#settingsPwError"))
    lk = C.evaluate("() => localStorage.getItem('sqla.pwlock.v1765')"); check("C: the lock state holds only a counter and a time — never a password", lk is not None and set(json.loads(lk).keys()) == {"fails", "until"} and not holds(lk, LOCAL))
    C.evaluate("() => localStorage.removeItem('sqla.pwlock.v1765')"); unlock(C, LOCAL); check("C: (after the counter is cleared) the correct password unlocks again", unlocked(C))
    # Danger Zone without a central record: V17.6.4 local reset
    C.click('.tab-btn:has-text("Danger Zone")'); C.wait_for_timeout(300); C.fill("#dangerPw", LOCAL); C.click("#dangerPwReset"); C.wait_for_timeout(1500)
    check("C: REGRESSION — Danger Zone reset with no central record keeps its V17.6.4 local behaviour (locks Settings; admin works again)", C.locator("#settingsPwInput").count() == 1 and C.locator("#resetCentralModal").count() == 0)
    unlock(C, "admin"); check("C: …and the default password works after the local reset", unlocked(C))
    ctx.close()
if __name__ == "__main__": main()
