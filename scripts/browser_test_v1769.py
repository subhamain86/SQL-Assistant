"""SQL Assistant V17.6.9 — real-browser acceptance (Chromium / Playwright) of the CROSS-DEVICE Admin Password scenario and of the "default is confirmed, never presumed" policy, on the PRODUCTION build.
   npm run build && python3 scripts/browser_test_v1769.py        (CHROME_PATH=/path/to/chrome to use an installed browser)

REAL: the production page (dist/index.html from disk), the application's own services, crypto and UI; every "device" is a separate Chromium context (own localStorage / IndexedDB).
EMULATED: the repository — an in-memory repository with GitHub-like sha / "file changed" semantics, reached through the application's own test hook (?e2e=1 → setRepositoryOverride). github.com, GitHub Actions, the
central access service and Azure are NOT reachable here and are not claimed. Device B is NEVER seeded: no local-storage copy, no fixture, no browser-state copying — it receives the credential only through Sync.
Passwords are synthetic test values."""
import json, os, re, sys, pathlib
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import browser_test_v1765 as T
ROOT = T.ROOT; PATH = T.PATH; check = T.check; results = T.results; errors = T.errors
VERSION = json.loads((ROOT / "package.json").read_text())["version"]  # the CURRENT version comes from package.json
CP = "SYNTHETIC-central-pw-A1"; CP2 = "SYNTHETIC-central-pw-B2"
def locked(pg): return pg.locator("#settingsPwInput").count() == 1
def attempt(pg, pw, wait=1800):
    pg.evaluate("() => window.__sqla.store.lockSettings()"); T.go(pg, "settings"); pg.wait_for_timeout(250)
    pg.fill("#settingsPwInput", pw); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(wait); return not locked(pg)
def diag(pg): return pg.evaluate("() => window.__sqla.adminAuth.diagnostics()")
def body(pg): return pg.evaluate("() => document.body.innerText")
def marker(pg): return pg.evaluate("() => localStorage.getItem('sqla.pwvault.v15')")
def meta(pg): return pg.evaluate("() => localStorage.getItem('sqla.adminpwmeta.v1765')")
def change_pw(pg, old, new, wait=2600):
    T.stab(pg, "Security"); pg.fill("#pwCurrent", old); pg.fill("#pwNew", new); pg.fill("#pwConfirm", new); pg.click("#changePwBtn"); pg.wait_for_timeout(wait); return pg.inner_text("#pwResult")
class Switch:
    def __init__(self, t): self.t = t
    def read(self, p): return self.t.read(p)
    def write(self, p, t_, s_, m_): return self.t.write(p, t_, s_, m_)
SYNC_DONE = "() => { const b = document.querySelector('#syncNowBtn'); return b && !b.disabled && document.querySelector('#syncNowStatus') && document.querySelector('#syncNowStatus').innerText.trim() !== ''; }"
def main():
    url0 = (ROOT / "test-dist/index.html").as_uri() + "?e2e=1"
    with sync_playwright() as p:
        exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        repo = T.Repo()
        # ── Device A: a non-default password, saved, synchronized, published and read back
        cA, a = T.newdev(b, url0, repo, tag="A"); T.unlock(a)
        check("A0. Device A (authoritative repository answered 'no record'): state confirmed-default, Settings open with the first-time default", not locked(a) and diag(a)["state"] == "confirmed-default", diag(a)["state"])
        res = change_pw(a, "admin", CP); rec = T.central(repo)
        check("A1. Device A saved and synchronized a non-default password: central record revision 1, encrypted verifier only, no plaintext, read back and applied locally", "synchronized to the central repository" in res and rec and rec["revision"] == 1 and not rec["isDefault"] and set(rec["verifier"]) == {"salt", "iv", "ciphertext"} and CP not in repo.files[PATH][0] and json.loads(marker(a)) == rec["verifier"], res[:200])
        # ── Device B: clean context, NO local storage, NOT seeded; the repository access path is established only LATER
        cB, bb = T.newdev(b, url0, None, tag="B", connected=False)
        check("B0. Device B is clean: no marker, no synchronization record", marker(bb) is None and meta(bb) is None)
        okd = attempt(bb, "admin"); check("B1. BEFORE any repository connection: 'admin' is REJECTED (a new device is not an uninitialized installation), Settings stay locked, the message names the Sync button", not okd and locked(bb) and diag(bb)["state"] == "error" and "Sync button" in body(bb), (diag(bb)["state"], body(bb)[-200:]))
        check("B2. BEFORE any repository connection the lock screen does not claim that 'admin' is the password", "default password is admin" not in re.sub(r"\s+", " ", bb.inner_text("main")))
        T.attach(cB, bb, repo); T.connect(bb); bb.wait_for_timeout(200)
        T.go(bb, "quickstart"); bb.click("#syncNowBtn"); bb.wait_for_function(SYNC_DONE, timeout=20000); bb.wait_for_timeout(300)
        check("B3. Sync retrieved and applied the central credential (state central-applied, marker = central verifier, revision 1)", diag(bb)["state"] == "central-applied" and json.loads(marker(bb)) == rec["verifier"] and json.loads(meta(bb))["revision"] == 1, (diag(bb)["state"], meta(bb)))
        r_admin = attempt(bb, "admin"); r_cent = attempt(bb, CP)
        check("B4. Settings: the centralized password is ACCEPTED, the default 'admin' is REJECTED", r_cent and not r_admin)
        ev = [x["e"] for x in diag(bb)["trace"]]; check("B5. The default basis never occurred on Device B", not any("basis=default" in e for e in ev), ev[-8:])
        # ── Stale-session re-lock: C opens Settings on the confirmed default of an EMPTY repository; the central record then arrives
        sw = Switch(T.Repo()); cC, c = T.newdev(b, url0, sw, tag="C"); T.unlock(c)
        check("C1. Device C: Settings opened on the CONFIRMED default (empty authoritative repository)", not locked(c) and c.evaluate("() => window.__sqla.adminAuth.sessionBasis()") == "default-confirmed")
        sw.t = repo; T.go(c, "quickstart"); c.click("#syncNowBtn"); c.wait_for_function(SYNC_DONE, timeout=20000); c.wait_for_timeout(500)
        check("C2. The central credential arrived: the session is invalidated, temporary authorization cleared, Settings RE-LOCKED", c.evaluate("() => window.__sqla.store.settingsUnlocked") is False and c.evaluate("() => window.__sqla.adminAuth.sessionBasis()") is None)
        c.reload(); T.ready(c); T.connect(c); T.go(c, "settings"); c.wait_for_timeout(600)
        check("C3. After a refresh the stale session is NOT restored; 'admin' is rejected, the central password unlocks", locked(c) and not attempt(c, "admin") and attempt(c, CP))
        # ── Central change on A reaches B (revision 2); old password stops working; no plaintext anywhere
        res2 = change_pw(a, CP, CP2); rec2 = T.central(repo)
        check("D1. A second change is published as revision 2 (read back)", "synchronized" in res2 and rec2 and rec2["revision"] == 2 and rec2["verifier"] != rec["verifier"], res2[:160])
        T.go(bb, "quickstart"); bb.click("#syncNowBtn"); bb.wait_for_timeout(2500)
        check("D2. Device B after Sync: revision 2 applied; the previous password and 'admin' are rejected, the new one is accepted", json.loads(meta(bb))["revision"] == 2 and not attempt(bb, "admin") and not attempt(bb, CP) and attempt(bb, CP2))
        # ── Failed remote read / invalid record: the default is never accepted
        bad = T.Repo(); bad.files[PATH] = ("[1, 2, 3]", "shaX"); cE, e = T.newdev(b, url0, bad, tag="E")
        check("E1. An INVALID central record: 'admin' is rejected, Settings stay locked, nothing is applied or overwritten", not attempt(e, "admin", 2300) and locked(e) and marker(e) is None and bad.files[PATH][0] == "[1, 2, 3]" and diag(e)["state"] == "error", (diag(e)["state"], body(e)[-200:]))
        class Down:
            def read(self, p): raise Exception("GitHub did not answer within 20 seconds (the connection timed out).")
            def write(self, *x): raise Exception("down")
        cF, f = T.newdev(b, url0, Down(), tag="F")
        check("F1. A FAILED remote read on a new device: 'admin' is rejected and Settings stay locked; the state is error", not attempt(f, "admin", 2300) and locked(f) and diag(f)["state"] == "error")
        # ── generated artifacts: no plaintext password, no credential
        blobs = [(ROOT / x).read_text(encoding="utf-8") for x in ("dist/index.html", "index.html", "release/index.html")]
        check("G1. No test password and no credential-looking string in the generated outputs", not any(CP in v or CP2 in v or "SYNTHETIC-" in v or re.search(r"\bghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}", v) for v in blobs))
        T.go(a, "about"); check("G2. The footer and the About page show the current version first; the page title is unchanged", ("Version " + VERSION) in a.inner_text("footer") and a.inner_text("main").index(VERSION) < a.inner_text("main").index("17.6.8") and a.title() == "SQL Assistant")
        for c_ in (cA, cB, cC, cE, cF): c_.close()
        b.close()
    bad_errs = [x for x in errors if "Failed to load resource" not in x and "timed out" not in x]
    check("No unexpected browser console errors or page errors", not bad_errs, bad_errs[:3])
    failed = [r_ for r_ in results if not r_[1]]; print(f"\n{len(results) - len(failed)}/{len(results)} V17.6.9 browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True); (ROOT / "test-results/browser-results-v1769.json").write_text(json.dumps([{"check": n, "pass": ok} for n, ok in results], indent=2)); sys.exit(1 if failed else 0)
if __name__ == "__main__": main()
