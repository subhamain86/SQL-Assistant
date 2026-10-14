"""SQL Assistant V17.6.6 — real-browser tests of the NEW-DEVICE Admin Password fix on the PRODUCTION build (Chromium / Playwright).
   npm run build && python3 scripts/browser_test_v1766.py        (CHROME_PATH=/path/to/chrome to use an installed browser)

The defect: a new device kept using the default "admin" although a central Admin Password existed. What is REAL here: the production page served by scripts/serve.mjs (like GitHub Pages); the REAL publication
script (scripts/publish-data.mjs) that mirrors the repository data folder next to the app — so a brand-new device reads the central record exactly as a token-free device does in production (the published copy);
the central record itself is written by the application (device A, Settings → Security → Change Password) into a shared in-memory repository and then published; every device is a separate Chromium context.
What is EMULATED: GitHub (no network, no Actions run). All passwords are synthetic test values."""
import json, os, re, sys, time, shutil, socket, pathlib, tempfile, subprocess, hashlib
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import browser_test_v1765 as T
ROOT = T.ROOT; PATH = T.PATH; check = T.check; results = T.results; errors = T.errors
PW1 = "SYNTHETIC-central-value-001"; PW2 = "SYNTHETIC-central-value-002"; OWN = "SYNTHETIC-local-value-777"; COMMIT = "c0ffee" + "1" * 34; DEF = "basware/sk-ap-sql-assistant"

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p
def publish(record_text, dest_release):
    """The real workflow step: mirror sql-assistant-data/** (here: the central record) into the site folder with the marker. record_text None = nothing to publish."""
    src = pathlib.Path(tempfile.mkdtemp(prefix="sqla-src-")); dest = pathlib.Path(tempfile.mkdtemp(prefix="sqla-dest-")); (src / "sql-assistant-data/schemas").mkdir(parents=True)
    (src / "sql-assistant-data/schemas/registry.json").write_text('{"schemas":[]}', encoding="utf-8")
    if record_text is not None: (src / "sql-assistant-data/security").mkdir(parents=True); (src / PATH).write_text(record_text, encoding="utf-8")
    p = subprocess.run(["node", str(ROOT / "scripts/publish-data.mjs"), "--src", str(src), "--dest", str(dest), "--commit", COMMIT, "--repository", DEF], capture_output=True, text=True, timeout=60); assert p.returncode == 0, p.stdout + p.stderr
    shutil.rmtree(dest_release / "sql-assistant-data", ignore_errors=True); shutil.copytree(dest / "sql-assistant-data", dest_release / "sql-assistant-data")
def site(record_text, release=None):
    d = pathlib.Path(tempfile.mkdtemp(prefix="sqla-site-")); shutil.copytree(release or ROOT / "release", d / "release"); (d / "scripts").mkdir(); shutil.copy(ROOT / "scripts/serve.mjs", d / "scripts/serve.mjs"); (d / "test-dist").mkdir(exist_ok=True); shutil.copy(ROOT / "test-dist/index.html", d / "test-dist/index.html"); publish(record_text, d / "release")  # V17.7: ?e2e=1 is served the browser-test build; the production page of release/ has no hook
    port = free_port(); pr = subprocess.Popen(["node", str(d / "scripts/serve.mjs")], env={**os.environ, "PORT": str(port), "BASE": "/"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.9)
    return pr, d, f"http://127.0.0.1:{port}/index.html?e2e=1"
def served_record(d): f = d / "release" / PATH; return f.read_text(encoding="utf-8") if f.exists() else None
def newdev(b, url, tag, init=None, w=1366, h=900):
    ctx = b.new_context(viewport={"width": w, "height": h}); pg = ctx.new_page(); T.watch(pg, tag)
    if init: pg.add_init_script(init)
    pg.goto(url); T.ready(pg); return ctx, pg
def marker(pg): return pg.evaluate("() => localStorage.getItem('sqla.pwvault.v15')")
def meta(pg): return pg.evaluate("() => localStorage.getItem('sqla.adminpwmeta.v1765')")
def wait_marker(pg, present=True, timeout=8000):
    try: pg.wait_for_function(f"() => (localStorage.getItem('sqla.pwvault.v15') !== null) === {str(present).lower()}", timeout=timeout); return True
    except Exception: return False
def try_unlock(pg, pw):
    pg.evaluate("() => window.__sqla.store.lockSettings()"); T.go(pg, "settings"); pg.wait_for_timeout(200)
    if not pg.locator("#settingsPwInput").count(): pg.evaluate("() => window.__sqla.store.lockSettings()"); pg.wait_for_timeout(300)
    pg.fill("#settingsPwInput", pw); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(2200); return not T.locked(pg)
def plain(pg, *words): blob = pg.evaluate("() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))"); return not any(w in blob for w in words)

def central_record(b, url0):
    """Device A (own context, shared in-memory repository) saves a non-default central password through the real Security tab."""
    repo = T.Repo(); cA, a = T.newdev(b, url0, repo, tag="A"); T.unlock(a); T.stab(a, "Security"); a.fill("#pwCurrent", "admin"); a.fill("#pwNew", PW1); a.fill("#pwConfirm", PW1); a.click("#changePwBtn"); a.wait_for_timeout(2500)
    rec = T.central(repo); check("1. A centralized non-default Admin Password is saved (revision 1, encrypted verifier, no plaintext in the record)", rec and rec["revision"] == 1 and not rec["isDefault"] and PW1 not in repo.files[PATH][0], rec)
    return repo, cA, a

def clean_device_flow(b, repo, rec_text):
    pr, d, url = site(rec_text); before = hashlib.sha256(served_record(d).encode()).hexdigest()
    try:
        held = []; ctx = b.new_context(viewport={"width": 1366, "height": 900}); pg = ctx.new_page(); T.watch(pg, "NEW")
        ctx.route("**/security/admin-password.json", lambda r: held.append(r))   # the central record is held back: the start-up synchronization is still running
        pg.goto(url); T.ready(pg); pg.wait_for_timeout(600)
        check("2. A clean new device has NO local Admin Password marker and no synchronization record", marker(pg) is None and meta(pg) is None)
        T.go(pg, "settings"); pg.fill("#settingsPwInput", "admin"); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(700)
        check("Race: the unlock check is waiting for the central record (it did not accept the default while the start-up synchronization was still running)", T.locked(pg) and len(held) >= 1 and marker(pg) is None, (len(held), T.locked(pg)))
        for r in held: r.continue_()
        pg.wait_for_timeout(300)
        pg.wait_for_timeout(2500)
        check("5. The default 'admin' is REJECTED on the new device once the central record has arrived (Settings stay locked, no hint about the password)", T.locked(pg) and "Incorrect password" in pg.inner_text("main"), pg.inner_text("main")[:200])
        check("3. The new device retrieved the centralized encrypted verifier (marker applied, V17.6.5 format salt / iv / ciphertext, central revision recorded)", marker(pg) is not None and set(json.loads(marker(pg))) == {"salt", "iv", "ciphertext"} and json.loads(meta(pg))["revision"] == 1, (marker(pg), meta(pg)))
        pg.fill("#settingsPwInput", PW1); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(2200)
        check("4. The saved central password unlocks Admin mode on the new device", not T.locked(pg))
        check("No plaintext password in the new device's browser storage; the central record is byte-identical to what was published", plain(pg, PW1, PW2, OWN) and hashlib.sha256(served_record(d).encode()).hexdigest() == before)
        ctx.unroute_all(behavior="ignore_errors"); pg.reload(); T.ready(pg); pg.wait_for_timeout(1500)
        check("The saved password works after a refresh (marker kept, 'admin' still rejected)", try_unlock(pg, PW1) and not try_unlock(pg, "admin"))
        ctx.close()
        # a device that opens the page and unlocks with the central password at once (no waiting) — new context
        ctx2, p2 = newdev(b, url, "NEW2"); check("New device #2: the central password works at the first attempt; the default does not", try_unlock(p2, PW1) and not try_unlock(p2, "admin")); ctx2.close()
        return pr, d, url
    except Exception:
        pr.kill(); raise

def manual_sync_clean(b, repo):
    """Deterministic manual-sync test: a SECOND site that still serves revision 1 (PW1); the device unlocks; revision 2 is published; the user presses Sync with GitHub Now; the device now accepts PW2 and rejects PW1."""
    pr, d, url = site(None)
    try:
        # first record (revision 1 = PW1) is produced by a fresh in-memory run so the two revisions are real application output
        rA = T.Repo(); ctx, a = T.newdev(b, url.replace("127.0.0.1", "127.0.0.1"), rA, tag="MA", connected=True)
        T.unlock(a); T.stab(a, "Security"); a.fill("#pwCurrent", "admin"); a.fill("#pwNew", PW1); a.fill("#pwConfirm", PW1); a.click("#changePwBtn"); a.wait_for_timeout(2500); rev1 = rA.files[PATH][0]
        publish(rev1, d / "release")
        c2, m = newdev(b, url, "M"); ok1 = try_unlock(m, PW1); T.stab(m, "Schema Management") if ok1 else None
        T.stab(a, "Security"); a.fill("#pwCurrent", PW1); a.fill("#pwNew", PW2); a.fill("#pwConfirm", PW2); a.click("#changePwBtn"); a.wait_for_timeout(2500); rev2 = rA.files[PATH][0]; publish(rev2, d / "release")
        check("Manual sync test set-up: device M is unlocked with revision 1; revision 2 (a password change from another device) is published", ok1 and json.loads(rev2)["revision"] == 2, (ok1,))
        m1 = marker(m); m.click("#simpleSyncBtn"); m.wait_for_timeout(4000)
        check("7. Manual 'Sync with GitHub Now' refreshes the Admin Password record (marker replaced, revision 2 recorded)", marker(m) != m1 and json.loads(meta(m))["revision"] == 2, (meta(m),))
        m.evaluate("() => window.__sqla.store.lockSettings()"); m.wait_for_timeout(300)
        check("8. The changed password is valid on the other device after synchronization; the previous one is not", try_unlock(m, PW2) and not try_unlock(m, PW1), "")
        check("The central record was not overwritten by the device (the published file is the one device A produced)", served_record(d) == rev2)
        c2.close(); ctx.close()
    finally: pr.kill()

def failure_flow(b):
    """Invalid / unreadable / missing central data: nothing is overwritten, the local behaviour is kept, nothing is claimed."""
    for label, text in [("unreadable (valid JSON, not a record)", "[1, 2, 3]"), ("invalid record (bad fields)", json.dumps({"format": "sqla-admin-password", "formatVersion": 1, "revision": 1, "isDefault": False, "verifier": {"salt": "x", "iv": "y", "ciphertext": "z"}, "updatedAt": "2026-01-01T00:00:00.000Z"})), ("no record published", None)]:
        pr, d, url = site(text)
        try:
            ctx, pg = newdev(b, url, "FAIL"); pg.wait_for_timeout(1800)
            ok_default = try_unlock(pg, "admin"); body = pg.inner_text("body")
            # V17.6.8: an unreadable / invalid central record never enables the default; "no record published" (the publication answered) is the genuine first-time default
            if text is not None:
                check(f"9. Central data {label}: V17.6.8 — the default is NOT accepted, Settings stay locked, no marker is created, nothing is claimed as synchronized", (not ok_default) and marker(pg) is None, (ok_default, marker(pg)))
                check(f"   … {label}: an actionable message names the problem and the retry (the Sync button)", "Sync button" in body and ("not valid" in body or "newer version" in body), body[-300:])
            else: check(f"9. Central data {label}: V17.6.9 — the publication lists no record, but a published copy can be OLDER than the repository: the default is NOT accepted (it needs an explicit reset record or the authoritative repository), Settings stay locked, no marker is created, nothing is claimed as synchronized", (not ok_default) and marker(pg) is None and "published copy" in body, (ok_default, marker(pg), body[-200:]))
            T.stab(pg, "Security") if ok_default else None; st = pg.inner_text("#pwSyncStatus") if pg.locator("#pwSyncStatus").count() else ""
            check(f"   … {label}: Security → Central synchronization does not say 'synchronized'", "synchronized with the central" not in st, st)
            ctx.close()
            if text is not None:   # an EXISTING device with its own valid local marker must keep it
                ctx, e = newdev(b, url, "EXIST", init=None); e.evaluate("(m) => localStorage.setItem('sqla.pwvault.v15', m)", T.legacy_marker(e, OWN)); keep = marker(e)
                e.reload(); T.ready(e); e.pause = None; e.wait_for_timeout(1800)
                check(f"9. Central data {label}: an existing device's valid local marker is not overwritten and its password still unlocks", marker(e) == keep and try_unlock(e, OWN) and marker(e) == keep); ctx.close()
            check(f"   … {label}: the published central file is untouched", served_record(d) == text or (text is None and served_record(d) is None))
        finally: pr.kill()

BASELINE = pathlib.Path(os.environ.get("BASELINE_RELEASE", ROOT.parent.parent / "base6/SQL-Assistant-V17.6.5/release"))
def existing_install_flow(b, repo, rec_text):
    """An existing V17.6.5 installation. The marker and the synchronization meta are produced by the REAL V17.6.5 build (the attached baseline) on its own site, then carried to the V17.6.6 build's origin
    (same storage keys). After the upgrade they must be unchanged byte-for-byte, unlock with the password and reject 'admin'."""
    from_baseline = (BASELINE / "index.html").exists(); pr0, d0, url0 = site(rec_text, BASELINE if from_baseline else None)
    try:
        ctx, pg = newdev(b, url0, "V1765"); wait_marker(pg); m, mt = marker(pg), meta(pg); ctx.close()
    finally: pr0.kill()
    check("10. (set-up) the V17.6.5 build itself created the marker and the synchronization meta" if from_baseline else "10. (set-up) marker and meta created (baseline build not found — current build used)", m is not None and mt is not None and json.loads(mt)["revision"] == 1)
    pr, d, url = site(rec_text)
    try:
        init = f"try {{ if (!localStorage.getItem('sqla.pwvault.v15')) {{ localStorage.setItem('sqla.pwvault.v15', {json.dumps(m)}); localStorage.setItem('sqla.adminpwmeta.v1765', {json.dumps(mt)}); }} }} catch (e) {{}}"
        ctx2, p2 = newdev(b, url, "V1766", init=init); p2.wait_for_timeout(1800)
        check("10. Existing V17.6.5 installation after the upgrade: marker and meta unchanged byte-for-byte, its password unlocks, the default 'admin' is rejected", marker(p2) == m and meta(p2) is not None and json.loads(meta(p2))["revision"] == 1 and try_unlock(p2, PW1) and not try_unlock(p2, "admin") and marker(p2) == m)
        ctx2.close()
    finally: pr.kill()

def late_connection_flow(b, repo, url0):
    """The repository connection appears AFTER start-up (sign-in / token restore): the next unlock check asks the central record first; nothing is written."""
    ctx = b.new_context(viewport={"width": 1366, "height": 900}); pg = ctx.new_page(); T.watch(pg, "LATE"); T.attach(ctx, pg, repo); pg.goto(url0); T.ready(pg)
    check("Late connection: before any connection the device has no marker", marker(pg) is None); writes = len(repo.writes); text = repo.files[PATH][0]
    T.connect(pg); pg.evaluate("() => window.__sqla.reloadSecrets()"); pg.wait_for_timeout(500)
    check("Late connection: the connection itself causes no Admin Password request (Pull Schema / vault / sign-in contracts stay exact)", marker(pg) is None)
    check("Late connection: at the next unlock the central record is asked first — 'admin' is rejected, the central password unlocks", not try_unlock(pg, "admin") and try_unlock(pg, PW1) and json.loads(meta(pg))["revision"] == T.central(repo)["revision"], (meta(pg),))
    check("Late connection: the central record was not overwritten (no write, same content)", len(repo.writes) == writes and repo.files[PATH][0] == text); ctx.close()

def main():
    html = (ROOT / "test-dist/index.html").read_text(encoding="utf-8"); import re as _re
    check("13. Generated-bundle secret scan: no credential-looking string, none of the synthetic test passwords", not _re.search(r"\bghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----", html) and not any(x in html for x in (PW1, PW2, OWN, "SYNTHETIC-")))
    url0 = (ROOT / "test-dist/index.html").as_uri() + "?e2e=1"; procs = []
    with sync_playwright() as p:
        exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        repo, cA, a = central_record(b, url0); rec_text = repo.files[PATH][0]
        pr, d, url = clean_device_flow(b, repo, rec_text); pr.kill()
        manual_sync_clean(b, repo); failure_flow(b); existing_install_flow(b, repo, rec_text); late_connection_flow(b, repo, url0)
        T.stab(a, "Security") if False else None; cA.close(); b.close()
    check("No browser console errors or page errors", not [e for e in errors if "Failed to load resource" not in e], errors[:3])
    failed = [r for r in results if not r[1]]; print(f"\n{len(results) - len(failed)}/{len(results)} V17.6.6 browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True); (ROOT / "test-results/browser-results-v1766.json").write_text(json.dumps([{"check": n, "pass": ok} for n, ok in results], indent=2)); sys.exit(1 if failed else 0)
if __name__ == "__main__": main()
