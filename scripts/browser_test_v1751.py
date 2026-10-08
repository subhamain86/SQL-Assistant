"""SQL Assistant V17.5.1 — real-browser tests of the cross-device admin message on the PRODUCTION build (Chromium / Playwright).
   npm run build && python3 scripts/browser_test_v1751.py        (CHROME_PATH=/path/to/chrome to use an installed browser)
Covers: the administrator panel (Settings → Synchronization), publishing to the shared repository, delivery to a second and third device through the REAL triggers
(Sync with GitHub Now, start-up/visibility), the navbar banner (content, level, plain-text rendering), per-device dismissal, clearing, publish-while-offline,
silent failures, the unchanged existing navbar, responsive layout, secrecy and console errors."""
import json, os, sys, time, subprocess, pathlib, socket, traceback
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
MSG = "sql-assistant-data/messages/admin-message.json"; PLAIN = "sql-assistant-data/schemas/registry.json"
TOKEN = "ghp_" + "Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2"
results, errors = [], []


def check(name, ok, detail=""):
    results.append((name, bool(ok))); print(("PASS " if ok else "FAIL ") + name + ("" if ok or not detail else f" — {str(detail)[:340]}"), flush=True)


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def watch(pg, tag):
    pg.on("console", lambda m: m.type == "error" and errors.append(f"{tag}: {m.text}")); pg.on("pageerror", lambda e: errors.append(f"{tag}: {e}")); pg.on("dialog", lambda d: d.accept())


def ready(pg): pg.wait_for_function("() => document.documentElement.getAttribute('data-sqla-ready') === '1'", timeout=20000); pg.wait_for_timeout(250)
def go(pg, route): pg.evaluate(f"location.hash = '#{route}'"); pg.wait_for_timeout(300)
def newdev(browser, url, w=1366, h=900, tag="dev"):
    ctx = browser.new_context(viewport={"width": w, "height": h}); pg = ctx.new_page(); watch(pg, tag); pg.goto(url); ready(pg); return ctx, pg
def unlock(pg, pw="admin"):
    go(pg, "settings")
    if pg.locator("#settingsPwInput").count(): pg.fill("#settingsPwInput", pw); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(1000)
def stab(pg, name): pg.click(f'.tab-btn:has-text("{name}")'); pg.wait_for_timeout(350)
def repo(pg, files):
    pg.evaluate("(f) => { const r = window.__sqla.memoryRepository(f); window.__repo = r; window.__sqla.setRepositoryOverride(r); }", files); pg.wait_for_timeout(100)
def share(pg, other):  # the SAME repository object for two devices: copy the files of `other` into `pg`
    repo(pg, other.evaluate("() => Object.fromEntries([...window.__repo.files].map(([k, v]) => [k, v.text]))"))
def bar(pg): return pg.locator("#adminMsgBar")
def bar_text(pg): return pg.inner_text("#adminMsgBar") if bar(pg).count() else ""
def section(name, fn, *a):
    try: fn(*a)
    except Exception as ex: check(f"{name}: section completed", False, f"{type(ex).__name__}: {str(ex)[:260]} | {traceback.format_exc().splitlines()[-3][:150]}")
def publish(pg, text, level="info"):
    pg.fill("#adminMsgText", text); pg.select_option("#adminMsgLevel", level); pg.click("#adminMsgPublish"); pg.wait_for_timeout(900)
def syncnow(pg):  # the real user path: Settings → Schema Management → Sync with GitHub Now
    unlock(pg); stab(pg, "Schema Management"); pg.click("#simpleSyncBtn"); pg.wait_for_timeout(1500)
def box(pg, sel): return pg.eval_on_selector(sel, "e => { const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.width)]; }")


def admin_panel(b, url):
    A, a = newdev(b, url, tag="deviceA"); repo(a, {}); unlock(a); stab(a, "Synchronization"); panel = a.inner_text("[data-v1751-admin-message]")
    check("Admin: Settings → Synchronization has an 'Admin message' panel (inside the password-protected Settings; no new tab)", "Admin message" in panel and "navbar of every device" in panel and a.locator(".tab-btn").all_inner_texts() == ["Security", "Manual Schema Update", "Schema Management", "Secret Vault", "Synchronization", "Admin Query Library", "AI/LLM Model", "Danger Zone"])
    check("Admin: the panel explains the limit, plain-text-only, per-user hiding and that the file is not encrypted", all(x in panel for x in ["140 characters", "text only", "hide it on their own device", "not encrypted"]))
    check("Admin: the type selector offers Information and Warning; Clear is disabled while nothing is published", a.locator("#adminMsgLevel option").all_inner_texts() == ["Information", "Warning"] and a.is_disabled("#adminMsgClear") and "No message is published" in a.inner_text("#adminMsgCurrent"))
    a.fill("#adminMsgText", "x" * 5); check("Admin: a live character counter shows 5 / 140", a.inner_text("#adminMsgCount").strip() == "5 / 140")
    a.fill("#adminMsgText", "   "); a.click("#adminMsgPublish"); a.wait_for_timeout(250); check("Admin: an empty message is refused with a clear reason", "Enter the message text" in a.inner_text("#adminMsgResult") and bar(a).count() == 0)
    a.fill("#adminMsgText", "y" * 150); a.click("#adminMsgPublish"); a.wait_for_timeout(250); check("Admin: a message over 140 characters is refused and the counter turns red", "limit is 140" in a.inner_text("#adminMsgResult") and a.inner_text("#adminMsgCount").strip() == "150 / 140" and "rgb(214, 69, 80)" in a.eval_on_selector("#adminMsgCount", "e => getComputedStyle(e).color"))
    a.fill("#adminMsgText", f"temporary token {TOKEN}"); a.click("#adminMsgPublish"); a.wait_for_timeout(250); check("Admin: text that looks like a credential is refused and nothing is written", "credential" in a.inner_text("#adminMsgResult") and bar(a).count() == 0 and a.evaluate("() => window.__repo.files.size") == 0)
    a.fill("#adminMsgText", "password: hunter2hunter2"); a.click("#adminMsgPublish"); a.wait_for_timeout(250); check("Admin: 'password: …' style text is refused as well", "credential" in a.inner_text("#adminMsgResult"))
    a.fill("#adminMsgText", "  Planned maintenance\n tonight 22:00–23:00 CET —  schema sync may be unavailable.  "); a.select_option("#adminMsgLevel", "info"); a.click("#adminMsgPublish"); a.wait_for_timeout(900); res = a.inner_text("#adminMsgResult"); f = a.evaluate("(p) => window.__repo.files.get(p)?.text || ''", MSG)
    check("Admin: publishing succeeds and says the other devices will receive it at their next synchronization or when they open the app", "was published" in res and "next synchronization" in res and "open SQL Assistant" in res, res[:200])
    j = json.loads(f) if f else {}
    check("Admin: the repository gets one small versioned plain-JSON file next to the schemas (same repository, separate file)", j.get("format") == "sqla-admin-message" and j.get("formatVersion") == 1 and j.get("active") is True and j.get("level") == "info" and j.get("appVersion") == "17.5.1" and j.get("text") == "Planned maintenance tonight 22:00–23:00 CET — schema sync may be unavailable." and "updatedAt" in j and "id" in j, list(j.keys()))
    check("Admin: the message is normalised to one clean line (spaces, line breaks and tabs collapsed)", j.get("text", "").count("  ") == 0 and "\n" not in j.get("text", ""))
    check("Admin: the file contains no credential, passphrase or token", TOKEN not in f and "ghp_" not in f)
    check("Admin: the publisher sees the banner immediately, inside the navbar", bar(a).count() == 1 and a.evaluate("() => !!document.querySelector('#mainNavbar #adminMsgBar')") and "Message from the administrator" in bar_text(a) and "Planned maintenance tonight" in bar_text(a))
    check("Admin: the panel shows the current message and enables Clear", "Planned maintenance tonight" in a.inner_text("#adminMsgCurrent") and not a.is_disabled("#adminMsgClear") and a.input_value("#adminMsgText").startswith("Planned maintenance"))
    check("Admin: nothing else was written to the repository (the schema file is untouched)", a.evaluate("() => [...window.__repo.files.keys()]") == [MSG])
    a.fill("#adminMsgText", "Upgrade to the new release is blocked — do not pull schemas until 18:00."); a.select_option("#adminMsgLevel", "warning"); a.click("#adminMsgPublish"); a.wait_for_timeout(900)
    check("Admin: a warning replaces the previous message and is styled as a warning", "Warning from the administrator" in bar_text(a) and "is-warning" in (bar(a).get_attribute("class") or "") and json.loads(a.evaluate("(p) => window.__repo.files.get(p).text", MSG))["level"] == "warning")
    return A, a


def delivery(b, url, A, a):
    B, bb = newdev(b, url, tag="deviceB"); share(bb, a); before = box(bb, "#activeSchemaBadge"); w0 = bb.evaluate("() => document.querySelector('#mainNavbar').getBoundingClientRect().height")
    check("Device B: before it synchronizes there is no banner", bar(bb).count() == 0)
    syncnow(bb); go(bb, "quickstart"); bb.wait_for_timeout(300)
    check("Device B: 'Sync with GitHub Now' brings the message (the real user path) — warning text, label and level", "Upgrade to the new release is blocked" in bar_text(bb) and "Warning from the administrator" in bar_text(bb))
    badge = box(bb, "#activeSchemaBadge")
    check("Device B: the existing navbar is untouched — schema badge keeps its full name and its width", "AP / P2P Core" in bb.inner_text("#activeSchemaBadge") and badge[1] > 100 and bb.locator("#syncSourceBtn").count() == 1 and bb.locator("#syncTimeBtn").count() == 1 and bb.locator("#tourBtnNav").count() == 1 and bb.locator("#settingsLockBadge").count() == 1, f"{before} -> {badge}")
    h1 = bb.evaluate("() => document.querySelector('#mainNavbar').getBoundingClientRect().height"); check("Device B: the banner adds one slim row (≈ 30–40 px) below the controls — the controls row keeps its height", 22 <= h1 - w0 <= 48, h1 - w0)
    check("Device B: the message is announced politely to assistive technology and the dismiss button is a labelled button", bar(bb).get_attribute("role") == "status" and bar(bb).get_attribute("aria-live") == "polite" and bb.get_attribute("#adminMsgDismiss", "aria-label"))
    bb.reload(); ready(bb); check("Device B: the message survives a page refresh (it is stored on the device)", "Upgrade to the new release is blocked" in bar_text(bb))
    stored = bb.evaluate("() => localStorage.getItem('sqla.adminmsg.v1751')"); check("Device B: only the message and its metadata are stored locally — no secret", stored and "ghp_" not in stored and "updatedAt" in stored)
    C, c = newdev(b, url, tag="deviceC"); share(c, a); c.evaluate("() => document.dispatchEvent(new Event('visibilitychange'))"); c.wait_for_timeout(1500)
    check("Device C: coming back to the tab (visibility) refreshes the message without any click", "Upgrade to the new release is blocked" in bar_text(c))
    D, d = newdev(b, url, tag="deviceD"); repo(d, {}); d.evaluate("() => window.__sqla.services().adminMessage.synchronize()"); d.wait_for_timeout(400)
    check("Device D: a repository without a message shows nothing and raises no error", bar(d).count() == 0); D.close()
    # dismissal is per device
    bb.click("#adminMsgDismiss"); bb.wait_for_timeout(300)
    check("Dismiss: 'hide' removes the banner on this device at once", bar(bb).count() == 0)
    bb.reload(); ready(bb); check("Dismiss: it stays hidden after a refresh", bar(bb).count() == 0)
    check("Dismiss: other devices still show it (hiding is per device)", "Upgrade to the new release is blocked" in bar_text(c) and bar(a).count() == 1)
    share(bb, a); syncnow(bb); go(bb, "quickstart"); check("Dismiss: synchronizing again does not bring the SAME message back", bar(bb).count() == 0)
    # new message appears again
    a.fill("#adminMsgText", "The upgrade is complete — you can pull schemas again."); a.select_option("#adminMsgLevel", "info"); a.click("#adminMsgPublish"); a.wait_for_timeout(900)
    share(bb, a); syncnow(bb); go(bb, "quickstart"); check("Dismiss: a NEW message appears again on the device that had hidden the old one", "The upgrade is complete" in bar_text(bb) and "Message from the administrator" in bar_text(bb))
    # clear reaches every device
    a.click("#adminMsgClear"); a.wait_for_timeout(900)
    check("Clear: the administrator's own banner disappears and the panel says nothing is published", bar(a).count() == 0 and "No message is published" in a.inner_text("#adminMsgCurrent") and a.is_disabled("#adminMsgClear"))
    rec = json.loads(a.evaluate("(p) => window.__repo.files.get(p).text", MSG)); check("Clear: a clearing record is published (so devices that are offline now receive it later)", rec["active"] is False and rec["text"] == "")
    share(bb, a); syncnow(bb); go(bb, "quickstart"); share(c, a); c.evaluate("() => window.__sqla.services().adminMessage.synchronize()"); c.wait_for_timeout(500)
    check("Clear: the other devices lose the banner at their next synchronization", bar(bb).count() == 0 and bar(c).count() == 0)
    c.reload(); ready(c); check("Clear: and it does not come back after a refresh", bar(c).count() == 0)
    return B, bb, C, c


def rendering(b, url):
    ctx, pg = newdev(b, url, tag="render"); repo(pg, {}); unlock(pg); stab(pg, "Synchronization")
    publish(pg, "<img src=x onerror=window.__xss=1> <b>bold</b> & \"quotes\" 100% <script>window.__xss=2</script>"); t = bar_text(pg)
    check("Rendering: HTML in the message is shown as plain text — nothing is interpreted, no element is created, no script runs", "<img src=x onerror=window.__xss=1>" in t and "<b>bold</b>" in t and pg.evaluate("() => window.__xss === undefined") and pg.locator("#adminMsgBar img, #adminMsgBar b, #adminMsgBar script").count() == 0, t[:200])
    check("Rendering: the same text in the administrator's panel is escaped as well", pg.evaluate("() => window.__xss === undefined") and pg.locator("#adminMsgCurrent img, #adminMsgCurrent script, #adminMsgCurrent b").count() == 0)
    publish(pg, "Read https://example.com/now for details"); check("Rendering: a web address stays plain text — never a link", "https://example.com/now" in bar_text(pg) and pg.locator("#adminMsgBar a").count() == 0)
    publish(pg, "x" * 140); check("Rendering: a 140-character message is accepted and fully shown", len(bar_text(pg).split("administrator")[-1].strip()) == 140, len(bar_text(pg)))
    ctx.close()


def failures(b, url):
    ctx, pg = newdev(b, url, tag="offline"); repo(pg, {}); unlock(pg); stab(pg, "Synchronization")
    pg.evaluate("() => window.__sqla.setRepositoryOverride({ describe: 'down', read: async () => { throw new Error('Could not reach GitHub (offline).'); }, write: async () => { throw new Error('Could not reach GitHub (offline).'); } })")
    publish(pg, "Notice written while offline"); res = pg.inner_text("#adminMsgResult")
    check("Offline publish: the message is saved on this device and the result says clearly that it could not be published yet", "saved on this device but could not be published" in res and "next synchronization" in res and "Notice written while offline" in bar_text(pg), res[:240])
    check("Offline publish: the panel marks it as not yet published", "not yet published" in pg.inner_text("#adminMsgCurrent"))
    check("Offline publish: a toast tells the administrator it is not yet published", "not yet published" in pg.inner_text("#toastHost"))
    repo(pg, {}); unlock(pg); stab(pg, "Schema Management"); pg.click("#simpleSyncBtn"); pg.wait_for_timeout(1800)
    check("Offline publish: the next 'Sync with GitHub Now' publishes it automatically", MSG in pg.evaluate("() => [...window.__repo.files.keys()]") and json.loads(pg.evaluate("(p) => window.__repo.files.get(p).text", MSG))["text"] == "Notice written while offline")
    stab(pg, "Synchronization"); check("Offline publish: after that the 'not yet published' mark is gone", "not yet published" not in pg.inner_text("#adminMsgCurrent"))
    # a device that already shows a message keeps it through every failure
    X, x = newdev(b, url, tag="quiet"); share(x, pg); x.evaluate("() => window.__sqla.services().adminMessage.synchronize()"); x.wait_for_timeout(400); assert "Notice written while offline" in bar_text(x)
    x.evaluate("() => window.__sqla.setRepositoryOverride({ describe: 'down', read: async () => { throw new Error('Could not reach GitHub (network down).'); }, write: async () => { throw new Error('x'); } })")
    unlock(x); stab(x, "Schema Management"); x.click("#simpleSyncBtn"); x.wait_for_timeout(1500); go(x, "quickstart")
    check("Failure: when the repository cannot be reached the banner already on screen stays — no error, no flicker", "Notice written while offline" in bar_text(x) and "admin message" not in x.inner_text("#toastHost").lower())
    repo(x, {MSG: "{this is not json"}); x.evaluate("() => window.__sqla.services().adminMessage.synchronize()"); x.wait_for_timeout(400)
    check("Failure: a damaged or hostile message file in the repository is ignored; the current banner stays", "Notice written while offline" in bar_text(x))
    hostile = json.dumps({"format": "sqla-admin-message", "formatVersion": 1, "id": "evil", "active": True, "text": f"leak {TOKEN}", "level": "info", "updatedAt": "2099-01-01T00:00:00.000Z"}); repo(x, {MSG: hostile}); x.evaluate("() => window.__sqla.services().adminMessage.synchronize()"); x.wait_for_timeout(400)
    check("Failure: a repository record that contains a credential-like text is rejected (never shown)", "leak" not in bar_text(x) and "Notice written while offline" in bar_text(x))
    future = json.dumps({"format": "sqla-admin-message", "formatVersion": 7, "id": "f", "active": True, "text": "from the future", "level": "info", "updatedAt": "2099-01-01T00:00:00.000Z"}); repo(x, {MSG: future}); x.evaluate("() => window.__sqla.services().adminMessage.synchronize()"); x.wait_for_timeout(400)
    check("Failure: a file written in a newer format is ignored instead of being misread", "from the future" not in bar_text(x))
    older = json.dumps({"format": "sqla-admin-message", "formatVersion": 1, "id": "old1", "active": True, "text": "an older message", "level": "info", "updatedAt": "2020-01-01T00:00:00.000Z"}); repo(x, {MSG: older}); x.evaluate("() => window.__sqla.services().adminMessage.synchronize()"); x.wait_for_timeout(400)
    check("Last writer wins: an OLDER message in the repository never replaces the newer one on this device", "Notice written while offline" in bar_text(x) and "an older message" not in bar_text(x))
    newer = json.dumps({"format": "sqla-admin-message", "formatVersion": 1, "id": "new1", "active": True, "text": "a newer message", "level": "warning", "updatedAt": "2099-02-02T00:00:00.000Z"}); repo(x, {MSG: newer}); x.evaluate("() => window.__sqla.services().adminMessage.synchronize()"); x.wait_for_timeout(400)
    check("Last writer wins: a NEWER message in the repository replaces it", "a newer message" in bar_text(x) and "Warning from the administrator" in bar_text(x))
    X.close(); ctx.close()


def regression_and_layout(b, url):
    ctx, pg = newdev(b, url, tag="regress"); repo(pg, {})
    check("Regression: with no message the navbar is exactly the V17.5 navbar (no banner element, no extra row)", pg.locator("#adminMsgBar").count() == 0 and "17.5.1" in pg.inner_text("footer") and pg.locator("#navToggle").count() == 1)
    unlock(pg); stab(pg, "Schema Management"); stab(pg, "Synchronization"); check("Regression: the existing Synchronization content (sync source/time, shared location, knowledge, migrations, conflicts, log) is all still there", all(x in pg.inner_text("main") for x in ["Sync Source", "Shared Location", "Central knowledge", "Data migrations", "Conflict Management", "Synchronization Log"]))
    stab(pg, "Schema Management"); check("Regression: Schema Management keeps its V17.5 content (repository sync, schema passphrase, stored schemas)", all(x in pg.inner_text("main") for x in ["Repository synchronization", "Schema passphrase", "Stored Schemas"]))
    ctx.close()
    for (w, h, name) in [(1366, 900, "desktop"), (1024, 800, "small laptop"), (768, 1024, "tablet"), (390, 800, "phone")]:
        c, p = newdev(b, url, w, h, tag=f"resp-{name}"); repo(p, {}); unlock(p); stab(p, "Synchronization"); ov0 = p.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        publish(p, "Planned maintenance tonight 22:00–23:00 CET — schema synchronization may be unavailable for about an hour. Thank you!", "warning"); ov1 = p.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        bb = p.eval_on_selector("#adminMsgBar", "e => { const r = e.getBoundingClientRect(); const t = e.querySelector('.admin-msg-bar-text').getBoundingClientRect(); const d = e.querySelector('#adminMsgDismiss').getBoundingClientRect(); return [r.width, r.height, t.right <= r.right + 1, d.right <= r.right + 1, d.width >= 24]; }")
        full = "Thank you!" in bar_text(p); nav = p.evaluate("() => document.querySelector('#mainNavbar').getBoundingClientRect().bottom")
        check(f"Responsive ({name} {w}px): the banner spans the navbar, shows the full text, keeps the dismiss button reachable and causes no horizontal scroll", full and bb[0] >= w - 2 and bb[2] and bb[3] and bb[4] and ov0 <= 2 and ov1 <= 2 and nav < 190, f"{bb} ov={ov0}/{ov1} nav={nav}")
        p.keyboard.press("Tab"); c.close()
    c, p = newdev(b, url, tag="dark"); repo(p, {}); p.evaluate("() => window.__sqla.store.setTheme('dark')"); unlock(p); stab(p, "Synchronization"); publish(p, "Dark theme check", "warning")
    col = p.eval_on_selector("#adminMsgBar .admin-msg-bar-text", "e => getComputedStyle(e).color"); bg = p.eval_on_selector("#mainNavbar", "e => getComputedStyle(e).backgroundColor")
    check("Dark theme: banner text uses the theme text colour and differs from the background", col != bg and "Dark theme check" in bar_text(p), f"{col} on {bg}"); c.close()
    c, p = newdev(b, url, tag="tour"); repo(p, {}); unlock(p); stab(p, "Synchronization"); publish(p, "Tour check", "info"); p.click("#tourBtnNav"); p.wait_for_timeout(600)
    check("Regression: the Guided Walkthrough still starts and highlights navbar controls while the banner is shown", p.locator("#tourOverlay").count() == 1 and "step 1 of 12" in p.inner_text("#tourStepLabel").lower()); c.close()


def main():
    if not (ROOT / "dist/index.html").exists(): print("Run npm run build first."); sys.exit(2)
    port = free_port(); serve = subprocess.Popen(["node", str(ROOT / "scripts/serve.mjs")], env={**os.environ, "PORT": str(port), "BASE": "/SQL-Assistant/"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.9)
    url = f"http://127.0.0.1:{port}/SQL-Assistant/?e2e=1"; st = {}
    try:
        with sync_playwright() as p:
            exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
            try: st["A"], st["a"] = admin_panel(b, url)
            except Exception as ex: check("Admin panel: section completed", False, f"{type(ex).__name__}: {str(ex)[:260]} | {traceback.format_exc().splitlines()[-3][:150]}")
            if st.get("a"): section("Delivery", delivery, b, url, st["A"], st["a"])
            section("Rendering", rendering, b, url); section("Failures", failures, b, url); section("Regression + layout", regression_and_layout, b, url)
            b.close()
    finally:
        serve.terminate()
    real = [e for e in errors if "Failed to load resource" not in e and "net::ERR" not in e and "Could not reach GitHub" not in e]
    check("No console errors or uncaught exceptions in any V17.5.1 flow", not real, "; ".join(real[:4]))
    failed = [r for r in results if not r[1]]; print(f"\n{len(results) - len(failed)}/{len(results)} V17.5.1 browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True); (ROOT / "test-results/browser-results-v1751.json").write_text(json.dumps([{"check": n, "pass": ok} for n, ok in results], indent=2)); sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
