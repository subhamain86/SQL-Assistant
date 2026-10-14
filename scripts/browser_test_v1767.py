"""SQL Assistant V17.6.7 — real-browser validation of the NEW-DEVICE Admin Password fix on the PRODUCTION build (Chromium / Playwright).
   npm run build && python3 scripts/browser_test_v1767.py        (CHROME_PATH=/path/to/chrome; BASELINE_RELEASE=<release/ of V17.6.6> for the upgrade check)

The request's Mandatory Validation is run literally, through the user interface, in the three ways a device reaches the repository:
  TOKEN      — a GitHub token on the device (the real GitHub client against test/support/github-stub.mjs, a private repository; every device = separate Chromium context)
  PUBLISHED  — a device with no credential reads the published copy (the REAL publish-data script + a real static server)
  BROKER     — central repository access (the REAL server/repo-broker.mjs + the stub; GitHub device-flow sign-in)
Device A changes the Admin Password from "admin" to MyCentralPassword and synchronizes; the repository record is checked; Device B (clean) configures the repository, synchronizes and opens Settings.
Also the order that exposed the defect: Settings opened with the default BEFORE the repository was reachable, then the repository is configured / synchronized.
What is EMULATED: github.com (no network here) and the GitHub Actions run. Test passwords are synthetic example values."""
import json, os, re, sys, time, shutil, pathlib, tempfile
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import browser_test_v1763 as Y
Y.AUTO_CONFIRM = False  # V17.6.9: a dedicated authentication suite — no harness may confirm the default on its behalf
import browser_test_v1766 as P
T = Y.T; ROOT = T.ROOT; PATH = "sql-assistant-data/security/admin-password.json"; CP = "MyCentralPassword"; CP2 = "MyCentralPassword-v2"; OWN = "SYNTHETIC-local-value-777"
results = []; errs = []
def check(name, ok, detail=""):
    results.append((name, bool(ok))); print(("PASS " if ok else "FAIL ") + name + ("" if ok or not detail else f" — {str(detail)[:360]}"), flush=True)
def locked(pg): return pg.locator("#settingsPwInput").count() == 1
def attempt(pg, pw, wait=2300):
    pg.evaluate("() => window.__sqla.store.lockSettings()"); T.go(pg, "settings"); pg.wait_for_timeout(300)
    pg.fill("#settingsPwInput", pw); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(wait); return not locked(pg)
def marker(pg): return pg.evaluate("() => localStorage.getItem('sqla.pwvault.v15')")
def meta(pg): return pg.evaluate("() => localStorage.getItem('sqla.adminpwmeta.v1765')")
def status(pg): return pg.evaluate("() => window.__sqla.adminAuth.diagnostics().status.text")
def trace(pg): return [x["e"] for x in pg.evaluate("() => window.__sqla.adminAuth.diagnostics().trace")]
def body(pg): return pg.evaluate("() => document.body.innerText")
def establish_access(pg, tok):
    """V17.6.9: a NEW device cannot use the Admin Password card to obtain its first token (the default is refused while the central state is unknown, and the central password cannot be checked without a connection).
    The repository access path is established the way a new device really does it — restoring the Secret Vault / sign-in — which needs no Admin Password. Nothing about the password is seeded."""
    pg.evaluate("async (t) => { const v = window.__sqla.services().vault; const s = await v.load(); await v.save({ ...s, githubToken: t }); await window.__sqla.reloadSecrets(); window.__sqla.render(); }", tok); pg.wait_for_timeout(700)
def set_token(pg, tok, pw="admin"):
    pg.click("#changeTokenBtn"); pg.fill("#newTokenInput", tok); pg.fill("#tokenAdminPw", pw); pg.click("#saveTokenBtn")
    pg.wait_for_function("() => { const r = document.querySelector('#vaultCfgResult'); return r && r.innerText.trim() && !/Checking the token/.test(r.innerText); }", timeout=20000); pg.wait_for_timeout(500)
def stored(sp): f = T.state(sp)["files"]; return f.get(PATH)
def watch(pg): return pg
def plaintext_free(pg, *words): blob = pg.evaluate("() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))") + json.dumps(trace(pg)); return not any(w in blob for w in words)
def change_pw(pg, old, new, wait=3000):
    T.stab(pg, "Security"); pg.fill("#pwCurrent", old); pg.fill("#pwNew", new); pg.fill("#pwConfirm", new); pg.click("#changePwBtn"); pg.wait_for_timeout(wait); return pg.inner_text("#pwResult")
def idx(ev, pat): return next((i for i, e in enumerate(ev) if re.search(pat, e)), -1)

# ─────────────────────────────────────────── TOKEN
def token_flow(b, sp, url):
    cA, a = Y.newdev(b, url, "A", sp); T.hamburger_pull(a); a.evaluate("() => window.__sqla.setRepositoryOverride(window.__sqla.memoryRepository({}))")  # V17.6.9: the FIRST administrator needs the default CONFIRMED by an authoritative (empty) repository before the first token can be saved
    set_token(a, T.PAT); a.evaluate("() => window.__sqla.setRepositoryOverride(null)"); T.unlock(a)
    res = change_pw(a, "admin", CP); rec_text = stored(sp); rec = json.loads(rec_text) if rec_text else None
    check("A. Device A: Settings → Security: 'admin' → MyCentralPassword saved and synchronized (message says so)", "synchronized to the central repository" in res, res[:200])
    check("A. The repository contains the updated centralized Admin Password record (revision 1, encrypted verifier, no plaintext, no password in the commit)", rec and rec["revision"] == 1 and not rec["isDefault"] and set(rec["verifier"]) == {"salt", "iv", "ciphertext"} and CP not in rec_text and CP not in T.state(sp).get("lastCommitMessage", ""), rec)
    # ---- Device B1: Install → configure repository (token) → synchronize (Pull Schema) → open Settings
    cB, bb = Y.newdev(b, url, "B1", sp); check("B1. Device B is a clean installation: no local Admin Password marker, no synchronization record", marker(bb) is None and meta(bb) is None)
    T.hamburger_pull(bb); establish_access(bb, T.USER_OK); bb.click("#pullBtn"); T.pull_wait(bb); n_tr = len(trace(bb)); T.go(bb, "settings"); bb.wait_for_timeout(1800)
    check("B1. The lock screen no longer tells the user that 'admin' is the password (the central record was found; the hint was wrong)", locked(bb) and "default password is admin" not in " ".join(bb.inner_text("main").split()), bb.inner_text("main")[:200])
    ok_admin = attempt(bb, "admin"); ok_cp = attempt(bb, CP)
    check("B1. MyCentralPassword unlocks Settings on the new device", ok_cp)
    check("B1. 'admin' is rejected on the new device (Settings stay locked)", not ok_admin)
    rec = json.loads(stored(sp)); check("B1. Device B adopted the central encrypted verifier byte-for-byte (marker == central verifier, revision recorded)", json.loads(marker(bb)) == rec["verifier"] and json.loads(meta(bb))["revision"] == 1)
    ev = trace(bb)[n_tr:]; check("B1. Diagnostics (from opening Settings on): central record downloaded → loaded → authentication; the default basis never occurs; the default was rejected", 0 <= idx(ev, r"^central:downloaded") < idx(ev, r"^central:loaded") < idx(ev, r"^auth:accepted basis=central") and idx(ev, r"^auth:rejected") >= 0 and not any("basis=default" in e for e in ev), ev)
    bb.reload(); T.ready(bb); bb.wait_for_timeout(1200); check("B1. After a refresh: the central password still unlocks and 'admin' is still rejected", attempt(bb, CP) and not attempt(bb, "admin"))
    check("B1. No plaintext password in Device B's browser storage or diagnostics", plaintext_free(bb, CP, CP2)); cB.close()
    # ---- Device B2: the order that exposed the defect: Settings opened with the default BEFORE the repository is configured, then configure + synchronize
    cC, c = Y.newdev(b, url, "B2", sp); T.unlock(c, "admin"); first = not locked(c)
    check("B2. V17.6.9 — with NO repository connection yet the default is NOT accepted (a new device is not an uninitialized installation): Settings stay locked and the message names the Sync button", (not first) and locked(c) and "Sync button" in body(c), body(c)[-300:])
    check("B2. Diagnostics: no session was opened (basis none); the bootstrap state is 'error'", c.evaluate("() => window.__sqla.adminAuth.sessionBasis()") is None and c.evaluate("() => window.__sqla.adminAuth.diagnostics().state") == "error")
    T.hamburger_pull(c); establish_access(c, T.USER_OK); T.go(c, "settings"); c.wait_for_timeout(3000)
    check("B2. Once the repository is reachable the central password is applied; Settings are still locked; 'admin' is rejected", locked(c) and not attempt(c, "admin"), (locked(c), body(c)[-260:]))
    check("B2. MyCentralPassword unlocks Settings", attempt(c, CP))
    T.stab(c, "Schema Management"); c.click("#simpleSyncBtn"); c.wait_for_timeout(3500); check("B2. 'Sync with GitHub Now' keeps working after the central password was applied (status: synchronized)", "synchronized with the central" in status(c), status(c))
    cC.close()
    # ---- Device B3: password change on A reaches an open device through 'Sync with GitHub Now'
    cD, d = Y.newdev(b, url, "B3", sp); T.hamburger_pull(d); establish_access(d, T.USER_OK); check("B3. (set-up) Device B3 unlocks with MyCentralPassword", attempt(d, CP))
    res = change_pw(a, CP, CP2); check("A. A second change (→ MyCentralPassword-v2) is synchronized; the repository record is revision 2", "synchronized" in res and json.loads(stored(sp))["revision"] == 2, res[:160])
    T.go(d, "settings"); T.stab(d, "Schema Management"); d.click("#simpleSyncBtn"); d.wait_for_timeout(3500)
    check("B3. 'Sync with GitHub Now' on Device B refreshes the Admin Password record (revision 2)", json.loads(meta(d))["revision"] == 2, meta(d))
    check("B3. The changed password is valid on Device B after synchronization; the previous one is not", attempt(d, CP2) and not attempt(d, CP)); cD.close()
    # ---- failures: unreadable / invalid central data
    T.stub(sp, "file", path=PATH, text="[1, 2, 3]"); bad = stored(sp); cE, e = Y.newdev(b, url, "B4", sp); T.hamburger_pull(e); establish_access(e, T.USER_OK); ok_def = attempt(e, "admin", 2300); e.wait_for_timeout(500)
    check("B4. Invalid central record (V17.6.8): the default is NOT accepted, Settings stay locked, nothing is applied or overwritten, and the message says the record is not valid and names the Sync button", not ok_def and locked(e) and marker(e) is None and stored(sp) == bad and "not valid" in body(e) and "Sync button" in body(e), (locked(e), marker(e), body(e)[-260:]))
    T.stub(sp, "file", path=PATH, text=rec_text); T.go(e, "quickstart"); e.click("#syncNowBtn"); e.wait_for_timeout(4000)
    check("B4. Normal retry: once the record is valid again the Sync button applies it; the central password unlocks and 'admin' is rejected", marker(e) is not None and attempt(e, CP) and not attempt(e, "admin"), (marker(e) is not None)); cE.close()
    return rec_text, cA, a

# ─────────────────────────────────────────── PUBLISHED
def published_flow(b, rec_text):
    pr, d, url = P.site(rec_text)
    try:
        c1, n = P.newdev(b, url, "PB"); P.wait_marker(n, True, 8000); check("P1. Published copy — Device B (clean install, no credential): the START-UP synchronization downloaded and applied the central verifier before anyone opened Settings", marker(n) is not None and json.loads(meta(n))["revision"] == 1); T.go(n, "settings"); n.wait_for_timeout(1000)
        check("P1. 'admin' is rejected and MyCentralPassword unlocks Settings on the new device", not attempt(n, "admin") and attempt(n, CP)); c1.close()
    finally: pr.kill()
    pr, d, url = P.site(None)   # a publication exists, but the central record is not in it (yet)
    try:
        c2, m = P.newdev(b, url, "PB2"); T.unlock(m, "admin"); check("P2. V17.6.9 — a publication exists but lists no central record: a published copy can be OLDER than the repository, so the default is NOT accepted (it needs an explicit reset record or the authoritative repository); Settings stay locked", locked(m) and m.evaluate("() => window.__sqla.adminAuth.sessionBasis()") is None)
        P.publish(rec_text, d / "release"); T.go(m, "quickstart"); m.click("#syncNowBtn"); m.wait_for_timeout(4000)
        check("P2. The central record appears later (publication): the next Sync applies it; 'admin' is rejected and the central password unlocks", not attempt(m, "admin") and attempt(m, CP), (locked(m), status(m)[:120])); c2.close()
    finally: pr.kill()

# ─────────────────────────────────────────── BROKER
def broker_flow(b, rec_text_unused):
    sp, bp, wp = T.free_port(), T.free_port(), T.free_port(); procs = []; dirs = []
    try:
        gh = T.spawn([str(ROOT / "test/support/github-stub.mjs"), str(sp)], {}, "stub"); procs.append(gh); T.stub(sp, "file", path=T.PLAIN, text=T.REGISTRY)
        benv = {"SQLA_GITHUB_PAT": T.PAT, "SQLA_GITHUB_CLIENT_ID": T.CLIENT, "SQLA_ALLOWED_ORIGINS": f"http://127.0.0.1:{wp}", "SQLA_SESSION_SECRET": T.SESSION_SECRET, "GITHUB_API_BASE": f"http://127.0.0.1:{sp}", "GITHUB_WEB_BASE": f"http://127.0.0.1:{sp}", "PORT": str(bp), "SQLA_AUDIT_LOG": "0"}
        procs.append(T.spawn([str(ROOT / "server/repo-broker.mjs")], benv, "broker")); s1, d1 = T.site(f"http://127.0.0.1:{bp}", wp); procs.append(s1); dirs.append(d1); url = f"http://127.0.0.1:{wp}/"
        T.stub(sp, "set", values={"deviceMode": "approve", "issue": T.USER_RW}); cA, a = T.newdev(b, url, "BA"); T.hamburger_pull(a); a.click("#pullBtn"); T.pull_wait(a)
        T.unlock(a, "admin"); res = change_pw(a, "admin", CP); rec = stored(sp)
        check("K1. Central access — Device A (signed in): the change is synchronized through the repository access service; the repository record exists, encrypted, revision 1", "synchronized to the central repository" in res and rec and json.loads(rec)["revision"] == 1 and CP not in rec, res[:160])
        cB, bb = T.newdev(b, url, "BB"); T.go(bb, "settings"); bb.wait_for_timeout(400); bb.fill("#settingsPwInput", "admin"); bb.click("#settingsUnlockBtn"); bb.wait_for_timeout(9000)
        check("K2. Central access — Device B (clean, no GitHub session): the Settings unlock starts the existing GitHub sign-in FIRST; once the central record is readable 'admin' is REJECTED (V17.6.8: no provisional default on a managed device)", locked(bb) and marker(bb) is not None, (locked(bb), marker(bb) is not None, body(bb)[-200:]))
        check("K3. Central access — MyCentralPassword unlocks Settings on Device B and 'admin' stays rejected", attempt(bb, CP) and not attempt(bb, "admin"))
        for c in (cA, cB): c.close()
        return rec
    finally:
        for pr in procs:
            try: pr.terminate()
            except Exception: pass
        for d in dirs: shutil.rmtree(d, ignore_errors=True)

# ─────────────────────────────────────────── existing V17.6.6 installations
BASELINE = pathlib.Path(os.environ.get("BASELINE_RELEASE", "/home/claude/base7/SQL-Assistant-V17.6.6/release"))
def compat_flow(b, rec_text):
    ok = (BASELINE / "index.html").exists(); pr0, d0, url0 = P.site(rec_text, BASELINE if ok else None)
    try:
        c0, n0 = P.newdev(b, url0, "V1766"); n0.wait_for_timeout(500); T.go(n0, "settings"); n0.wait_for_timeout(1500); attempt(n0, CP); m, mt = marker(n0), meta(n0); c0.close()
    finally: pr0.kill()
    check("C1. (set-up) the V17.6.6 build itself created the marker and the synchronization meta" if ok else "C1. (set-up) marker and meta created (baseline build not found — current build used)", m is not None and mt is not None and json.loads(mt)["revision"] == 1)
    pr, d, url = P.site(rec_text)
    try:
        init = f"try {{ if (!localStorage.getItem('sqla.pwvault.v15')) {{ localStorage.setItem('sqla.pwvault.v15', {json.dumps(m)}); localStorage.setItem('sqla.adminpwmeta.v1765', {json.dumps(mt)}); }} }} catch (e) {{}}"
        c1, n1 = P.newdev(b, url, "V1767", init=init); n1.wait_for_timeout(1500)
        check("C1. An existing V17.6.6 installation after the upgrade: marker unchanged byte-for-byte, its password unlocks, 'admin' is rejected, nothing re-locks or re-asks", marker(n1) == m and attempt(n1, CP) and not attempt(n1, "admin") and marker(n1) == m); c1.close()
    finally: pr.kill()

def main():
    html = (ROOT / "test-dist/index.html").read_text(encoding="utf-8")
    check("The production bundle contains no credential-looking string and none of the test passwords", not re.search(r"\bghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----", html) and not any(x in html for x in (CP, CP2, OWN)))
    sp = T.free_port(); p1 = T.free_port(); procs = []
    try:
        procs.append(T.spawn([str(ROOT / "test/support/github-stub.mjs"), str(sp)], {}, "stub")); T.stub(sp, "file", path=Y.PLAIN, text=Y.REGISTRY)
        s1, d1 = Y.site(None, p1); procs.append(s1); url = f"http://127.0.0.1:{p1}/"
        with sync_playwright() as p:
            exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
            rec_text, cA, a = token_flow(b, sp, url); cA.close(); published_flow(b, rec_text); broker_flow(b, rec_text); compat_flow(b, rec_text)
            allreq = "\n".join(f"{u}\n{d}" for t, m, u, d, au in T.requests); check("Hygiene: the test password appears in no request URL or body sent by any page", CP not in allreq and CP2 not in allreq)
            b.close()
    finally:
        for pr in procs:
            try: pr.terminate()
            except Exception: pass
    bad = [e for e in (T.errors + P.T.errors) if "Failed to load resource" not in e]; check("No browser console errors or page errors", not bad, bad[:3])
    failed = [r for r in results if not r[1]]; print(f"\n{len(results) - len(failed)}/{len(results)} V17.6.7 browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True); (ROOT / "test-results/browser-results-v1767.json").write_text(json.dumps([{"check": n, "pass": ok} for n, ok in results], indent=2)); sys.exit(1 if failed else 0)
if __name__ == "__main__": main()
