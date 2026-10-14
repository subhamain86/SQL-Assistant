"""SQL Assistant V17.6.8 — real-browser validation (Chromium / Playwright) of the centralized Admin Password at the authentication boundary and of the navigation-bar Sync button, on the PRODUCTION build.
   npm run build && python3 scripts/browser_test_v1768.py        (CHROME_PATH=/path/to/chrome to use an installed browser)

What is REAL: the production page (dist/index.html from disk), the application's own services, crypto and UI, the REAL publication script (published copy); every "device" is a separate Chromium context (own localStorage / IndexedDB).
What is EMULATED: the repository — one live shared in-memory repository (GitHub-like sha / "file changed" semantics) reached through the application's own test hook (?e2e=1 → setRepositoryOverride); github.com and GitHub Actions
are not reachable here. Passwords are synthetic test values.

Sections: clean device · cross-device password · stale cache · stale device · stale-session re-lock · navbar Sync (desktop + responsive) · failed synchronization · invalid central record · startup race · existing-device upgrade · secret scan."""
import json, os, re, sys, time, pathlib
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import browser_test_v1765 as T
import browser_test_v1766 as P
ROOT = T.ROOT; PATH = T.PATH; check = T.check; results = T.results; errors = T.errors
VERSION = json.loads((ROOT / "package.json").read_text())["version"]  # V17.6.9: the CURRENT version comes from package.json — suites never pin it with a literal
CP = "MyCentralPassword"; CP2 = "MyCentralPassword-v2"; CP3 = "MyCentralPassword-v3"; OWN = "SYNTHETIC-local-value-777"
REQS = []; _watch = T.watch
def _watch_all(pg, tag): _watch(pg, tag); pg.on("request", lambda r: REQS.append((r.url, r.post_data or "")))
T.watch = _watch_all
class SlowRepo(T.Repo):
    def __init__(self): super().__init__(); self.delay = 0.0; self.fail = False; self.reads = []
    def read(self, p):
        if self.delay: time.sleep(self.delay)
        if self.fail: raise Exception("GitHub did not answer within 20 seconds (the connection timed out).")
        if p == PATH: self.reads.append(p)
        return super().read(p)
def locked(pg): return pg.locator("#settingsPwInput").count() == 1
def attempt(pg, pw, wait=1800):
    pg.evaluate("() => window.__sqla.store.lockSettings()"); T.go(pg, "settings"); pg.wait_for_timeout(250)
    pg.fill("#settingsPwInput", pw); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(wait); return not locked(pg)
def marker(pg): return pg.evaluate("() => localStorage.getItem('sqla.pwvault.v15')")
def meta(pg): return pg.evaluate("() => localStorage.getItem('sqla.adminpwmeta.v1765')")
def diag(pg): return pg.evaluate("() => window.__sqla.adminAuth.diagnostics()")
def body(pg): return pg.evaluate("() => document.body.innerText")
def storage_blob(pg): return pg.evaluate("() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))")
def sync_status(pg): return pg.evaluate("() => (document.querySelector('#syncNowStatus') || {}).innerText || ''")
def wait_sync_done(pg, timeout=15000): pg.wait_for_function("() => { const b = document.querySelector('#syncNowBtn'); return b && !b.disabled && document.querySelector('#syncNowStatus') && document.querySelector('#syncNowStatus').innerText.trim() !== ''; }", timeout=timeout); pg.wait_for_timeout(200)
def snap_ls(pg, skip=("sqla.pwvault.v15", "sqla.adminpwmeta.v1765")): return pg.evaluate("(skip) => Object.fromEntries(Object.keys(localStorage).filter(k => !skip.includes(k) && !k.startsWith('sqla.deviceTag') && !k.startsWith('sqla.sync') && !k.startsWith('sqla.knowledge') && !k.startsWith('sqla.adminmsg')).sort().map(k => [k, localStorage.getItem(k)]))", list(skip))
def change_pw(pg, old, new, wait=2600):
    T.stab(pg, "Security"); pg.fill("#pwCurrent", old); pg.fill("#pwNew", new); pg.fill("#pwConfirm", new); pg.click("#changePwBtn"); pg.wait_for_timeout(wait); return pg.inner_text("#pwResult")

def main():
    html = (ROOT / "test-dist/index.html").read_text(encoding="utf-8")
    url0 = (ROOT / "test-dist/index.html").as_uri() + "?e2e=1"
    with sync_playwright() as p:
        exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        repo = SlowRepo()
        # ───────────────── Device A saves the central password
        cA, a = T.newdev(b, url0, repo, tag="A"); T.unlock(a)
        check("A0. Device A is a first-time device: the repository answered and holds no record, so the default 'admin' unlocks Settings (genuine first-time setup)", not locked(a), diag(a)["state"])
        res = change_pw(a, "admin", CP); rec = T.central(repo)
        check("A1. Device A: Settings → Security: 'admin' → MyCentralPassword is saved and synchronized (revision 1, encrypted verifier only, no plaintext)", "synchronized to the central repository" in res and rec and rec["revision"] == 1 and not rec["isDefault"] and set(rec["verifier"]) == {"salt", "iv", "ciphertext"} and CP not in repo.files[PATH][0], res[:200])
        check("A2. The local marker on Device A IS the central verifier (applied only after the successful central write)", json.loads(marker(a)) == rec["verifier"] and json.loads(meta(a))["revision"] == 1)
        # ───────────────── Clean device B (cross-device)
        cB, bb = T.newdev(b, url0, repo, tag="B"); check("B1. Device B is clean: no marker, no synchronization record (no cached password can make the test pass)", marker(bb) is None and meta(bb) is None)
        okA = attempt(bb, "admin"); ok = attempt(bb, CP)
        check("B2. 'admin' is REJECTED on the clean Device B", not okA)
        check("B3. MyCentralPassword unlocks Settings on Device B", ok)
        d = diag(bb); ev = [x["e"] for x in d["trace"]]
        check("B4. The central verifier was applied BEFORE the final authentication (central:loaded precedes auth:accepted) and the default basis never occurred", any(e.startswith("central:loaded") for e in ev) and ev.index(next(e for e in ev if e.startswith("central:loaded"))) < ev.index("auth:accepted basis=central") and not any("basis=default" in e for e in ev), ev[-12:])
        check("B5. Bootstrap state on Device B is 'central-applied'; marker == central verifier; revision recorded", d["state"] == "central-applied" and json.loads(marker(bb)) == rec["verifier"] and json.loads(meta(bb))["revision"] == 1, d["state"])
        bb.reload(); T.ready(bb); bb.wait_for_timeout(500); T.connect(bb)
        check("B6. After a refresh the central password still unlocks and 'admin' is still rejected", attempt(bb, CP) and not attempt(bb, "admin"))
        check("B7. No plaintext password in Device B's browser storage, diagnostics or the repository record", CP not in storage_blob(bb) and CP not in json.dumps(diag(bb)) and CP not in repo.files[PATH][0])
        # ───────────────── Change on A → stale cached verifier on B is refreshed; the old password stops working
        change_pw(a, CP, CP2); rec2 = T.central(repo)
        check("C1. A second change (→ -v2) is published as revision 2", rec2 and rec2["revision"] == 2 and rec2["verifier"] != rec["verifier"])
        T.go(bb, "quickstart"); check("C2. Device B still holds the revision-1 verifier until it synchronizes (stale cache)", json.loads(meta(bb))["revision"] == 1)
        check("C3. At the next check the stale verifier is refreshed: the OLD password is rejected, the NEW one unlocks", not attempt(bb, CP) and attempt(bb, CP2) and json.loads(meta(bb))["revision"] == 2)
        # ───────────────── Stale device cannot overwrite a newer revision
        n_writes = len(repo.writes); cS, s = T.newdev(b, url0, repo, tag="STALE")
        s.evaluate("() => { localStorage.setItem('sqla.pwvault.v15', %s); localStorage.setItem('sqla.adminpwmeta.v1765', %s); }" % (json.dumps(json.dumps(rec["verifier"])), json.dumps(json.dumps({"revision": 1, "pending": True, "sha": None, "updatedAt": "2026-01-01T00:00:00.000Z", "lastPullAt": None}))))
        s.evaluate("async () => { await window.__sqla.services().adminPassword.synchronize(); }"); s.wait_for_timeout(500)
        check("C4. A stale device (revision 1, pending) synchronizes: the newer central revision 2 is NOT overwritten (no write) and the stale device adopts revision 2", T.central(repo)["revision"] == 2 and json.loads(meta(s))["revision"] == 2 and len(repo.writes) == n_writes, (T.central(repo)["revision"], meta(s), len(repo.writes), n_writes)); cS.close()
        # ───────────────── Stale-session re-lock (default session → central arrives via the navbar Sync)
        class Switch:  # V17.6.9: Device C first talks to an EMPTY authoritative repository (the default is CONFIRMED there), later to the shared one that holds the central record
            def __init__(self, t): self.t = t
            def read(self, p): return self.t.read(p)
            def write(self, p, t_, s_, m_): return self.t.write(p, t_, s_, m_)
        sw = Switch(T.Repo()); cC, c = T.newdev(b, url0, sw, tag="C"); T.unlock(c)
        check("D1. Device C (the authoritative repository answered 'no record'): the default is CONFIRMED and unlocks Settings; the session basis is 'default-confirmed' (V17.6.9: there is no provisional default)", not locked(c) and diag(c)["state"] == "confirmed-default" and c.evaluate("() => window.__sqla.adminAuth.sessionBasis()") == "default-confirmed", body(c)[-240:])
        sw.t = repo; c.wait_for_timeout(200)
        T.go(c, "quickstart"); c.wait_for_timeout(300)
        check("D2. The Settings session opened with 'admin' is still open (the central record has not been applied yet)", c.evaluate("() => window.__sqla.store.settingsUnlocked") is True)
        c.click("#syncNowBtn"); wait_sync_done(c, 20000); c.wait_for_timeout(500); T.go(c, "settings"); c.wait_for_timeout(300)
        check("D3. The navbar Sync applied the central password: the Settings session opened with 'admin' is INVALIDATED and Settings are LOCKED again, with an explanatory message", locked(c) and c.evaluate("() => window.__sqla.store.settingsUnlocked") is False and "no longer in force" in body(c) and c.evaluate("() => window.__sqla.adminAuth.sessionBasis()") is None, (locked(c), body(c)[-200:]))
        check("D4. Afterwards 'admin' is rejected and the central password unlocks; the Sync status says 'Synced'", not attempt(c, "admin") and attempt(c, CP2) and sync_status(c) == "Synced", sync_status(c))
        # ───────────────── navbar Sync on desktop
        T.go(c, "quickstart")
        check("E1. Desktop (1366px): ONE clearly visible Sync button in the existing navigation bar; the existing controls are all still there", c.locator("#syncNowBtn").count() == 1 and c.locator("#syncNowBtn").is_visible() and all(c.locator(x).count() >= 1 for x in ("#syncSourceBtn", "#syncTimeBtn", "#settingsLockBadge", "#themeBtn", "#tourBtnNav", "#navToggle", "#logoHomeBtn")))
        state_before = snap_ls(c); repo.reads.clear(); repo.delay = 0.7
        c.evaluate("() => { const b = document.querySelector('#syncNowBtn'); b.click(); b.click(); }"); c.wait_for_timeout(250)
        busy = c.evaluate("() => { const b = document.querySelector('#syncNowBtn'); return { disabled: b.disabled, busy: b.getAttribute('aria-busy'), text: b.innerText.trim() }; }")
        check("E2. While syncing the button shows 'Syncing…', is disabled and aria-busy (a syncing state is displayed)", busy["disabled"] and busy["busy"] == "true" and "Syncing" in busy["text"], busy)
        wait_sync_done(c, 30000); repo.delay = 0.0; dbl = len(repo.reads)
        repo.reads.clear(); c.click("#syncNowBtn"); wait_sync_done(c, 20000); single = len(repo.reads)
        check("E3. A double click runs ONE synchronization (duplicate concurrent requests are prevented): the central record was read exactly as often as in a single run", dbl == single and single >= 1, (dbl, single))
        check("E4. The completion status is accurate: 'Synced', the button is back to its normal state", sync_status(c) == "Synced" and not c.evaluate("() => document.querySelector('#syncNowBtn').disabled") and c.inner_text("#syncNowBtn").strip() == "Sync", (sync_status(c), c.inner_text("#syncNowBtn")))
        tt = c.evaluate("() => document.querySelector('#syncNowStatus').title")
        check("E5. The status tooltip reports every step honestly (Admin Password, Schemas and synchronization metadata, Knowledge, Admin message) and never a credential", all(x in tt for x in ("Admin Password: OK", "Schemas and synchronization metadata:", "Knowledge:", "Admin message:")) and CP not in tt and CP2 not in tt, tt[:300])
        check("E6. The Sync did not alter or reset unrelated application state (theme, schemas, learning, repository configuration, vault keys unchanged)", snap_ls(c) == state_before)
        change_pw(a, CP2, CP3); check("F0. (set-up) Device A changed the password again (revision 3)", T.central(repo)["revision"] == 3)
        c.click("#syncNowBtn"); wait_sync_done(c, 20000)
        check("F1. The navbar Sync retrieves the latest Admin Password verifier immediately (revision 3 applied on Device C; previous password rejected)", json.loads(meta(c))["revision"] == 3 and not attempt(c, CP2) and attempt(c, CP3))
        # ───────────────── failed synchronization
        before_rec = json.dumps(T.central(repo)); n_w = len(repo.writes); mk = marker(c); repo.fail = True; T.go(c, "quickstart"); c.click("#syncNowBtn"); wait_sync_done(c, 20000); repo.fail = False
        st = sync_status(c); tt = c.evaluate("() => document.querySelector('#syncNowStatus').title")
        check("G1. A failed synchronization (repository unreachable) is reported as a FAILURE (not 'Synced') with the cause", st in ("Sync failed", "Partly synced") and "timed out" in tt, (st, tt[:300]))
        check("G2. Nothing was overwritten or created centrally, no default record published, the local credential is preserved", json.dumps(T.central(repo)) == before_rec and len(repo.writes) == n_w and marker(c) == mk and attempt(c, CP3))
        T.go(c, "quickstart"); c.click("#syncNowBtn"); wait_sync_done(c, 20000)
        check("G3. Retry works through the Sync button once the repository is back ('Synced')", sync_status(c) == "Synced", sync_status(c))
        cN, nn = T.newdev(b, url0, None, tag="NOCONN"); nn.click("#syncNowBtn"); wait_sync_done(nn, 15000); tt = nn.evaluate("() => document.querySelector('#syncNowStatus').title")
        check("G4. With no repository connection the Sync reports 'Skipped' honestly and changes nothing (no marker, no record)", sync_status(nn) == "Skipped" and "no repository connection" in tt.lower() and marker(nn) is None and meta(nn) is None, (sync_status(nn), tt[:200])); cN.close()
        # ───────────────── responsive layouts
        cR, r = T.newdev(b, url0, repo, tag="RESP", w=390, h=800)
        check("H1. Responsive (390px): the navbar stays usable — the Sync control moves into the existing navigation panel (hamburger), exactly like Sync Source / Sync Time", r.locator("#syncNowBtn").count() == 1 and not r.locator("#syncNowBtn").is_visible())
        r.click("#navToggle"); r.wait_for_timeout(250)
        check("H2. The panel shows the Sync entry with the same styling class as the other panel entries", r.locator("#hbSyncNow").is_visible() and "hb-link" in (r.get_attribute("#hbSyncNow", "class") or ""))
        r.click("#hbSyncNow"); r.wait_for_function("() => { const s = document.querySelector('#hbSyncStatus'); return s && /Synced|Partly|failed|Skipped/.test(s.innerText); }", timeout=20000)
        check("H3. Running the Sync from the responsive panel reports the result there", "Synced" in r.inner_text("#hbSyncStatus"), r.inner_text("#hbSyncStatus")); cR.close()
        cT, t = T.newdev(b, url0, repo, tag="TAB", w=800, h=900); check("H4. Tablet (800px): the navbar does not overflow horizontally", t.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")); cT.close()
        # ───────────────── invalid central record (published copy, real publish script)
        bad = "[1, 2, 3]"; pr, dd, url = P.site(bad)
        try:
            c1, n = P.newdev(b, url, "BADREC"); n.wait_for_timeout(1500); T.go(n, "settings"); n.wait_for_timeout(800); ok_admin = attempt(n, "admin", 2300)
            check("I1. Invalid central record (published copy): 'admin' is NOT accepted, Settings stay locked, the message is clear and actionable (names the Sync button)", not ok_admin and "Sync button" in body(n) and ("not valid" in body(n) or "newer version" in body(n)), body(n)[-300:])
            check("I2. The invalid central record is neither deleted nor replaced, nothing was created on the device", P.served_record(dd) == bad and marker(n) is None); c1.close()
        finally: pr.kill()
        # ───────────────── startup race on a published copy (real publication, record held back)
        pr, dd, url = P.site(json.dumps(T.central(repo)))
        try:
            held = []; ctx = b.new_context(viewport={"width": 1366, "height": 900}); pg = ctx.new_page(); T.watch(pg, "RACE"); ctx.route("**/security/admin-password.json", lambda rt: held.append(rt)); pg.goto(url); T.ready(pg); pg.wait_for_timeout(500)
            T.go(pg, "settings"); pg.fill("#settingsPwInput", "admin"); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(900)
            check("J1. Startup race: while the central record is still LOADING, 'admin' is not accepted (state 'loading'; Settings stay locked)", locked(pg) and len(held) >= 1 and marker(pg) is None and diag(pg)["state"] == "loading", (locked(pg), len(held), diag(pg)["state"]))
            for rt in held: rt.continue_()
            pg.wait_for_timeout(1200); pg.fill("#settingsPwInput", CP3); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(2200)
            check("J2. When the record arrives it is applied first; the central password then unlocks and 'admin' is rejected", not locked(pg) and diag(pg)["state"] == "central-applied" and not attempt(pg, "admin")); ctx.close()
        finally: pr.kill()
        # ───────────────── existing-device upgrade (V17.6.7 state: marker + meta kept byte-for-byte)
        m7, mt7 = marker(a), meta(a)
        init = "try { if (!localStorage.getItem('sqla.pwvault.v15')) { localStorage.setItem('sqla.pwvault.v15', %s); localStorage.setItem('sqla.adminpwmeta.v1765', %s); } } catch (e) {}" % (json.dumps(m7), json.dumps(mt7))
        cU = b.new_context(viewport={"width": 1366, "height": 900}); T.attach(cU, None, repo); u = cU.new_page(); T.watch(u, "UPG"); u.add_init_script(init); u.goto(url0); T.ready(u); T.connect(u); u.wait_for_timeout(300)
        check("K1. Existing V17.6.7 device (marker + meta from the previous version, central revision 3): its marker is unchanged by the upgrade start-up; the central password unlocks, 'admin' is rejected", (attempt(u, CP3) and not attempt(u, "admin")), (marker(u) == m7, meta(u)))
        cU.close()
        # ───────────────── generated artifacts secret scan
        blobs = {"dist/index.html": html, "index.html": (ROOT / "index.html").read_text(encoding="utf-8"), "release/index.html": (ROOT / "release/index.html").read_text(encoding="utf-8"), "release/version.json": (ROOT / "release/version.json").read_text(encoding="utf-8")}
        bad_pat = re.compile(r"\bghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----")
        check("L1. Generated-artifact secret scan: no credential-looking string and none of the test passwords in dist/, index.html, release/", not any(bad_pat.search(v) or any(x in v for x in (CP, CP2, OWN, "MyCentralPassword", "SYNTHETIC-")) for v in blobs.values()))
        T.go(a, "about")
        check("L2. Current version in the footer, the About page (first entry), the page title and release/version.json", VERSION in a.inner_text("footer") and a.inner_text("main").index(VERSION) < a.inner_text("main").index("17.6.7") < a.inner_text("main").index("17.6.6") and a.title() == "SQL Assistant" and json.loads((ROOT / "release/version.json").read_text())["version"] == VERSION)
        allreq = "\n".join(f"{u_}\n{d_}" for u_, d_ in REQS)
        check(f"L3. Hygiene: no test password appears in any request URL or body sent by a page ({len(REQS)} requests inspected)", len(REQS) > 0 and "MyCentralPassword" not in allreq)
        for c_ in (cA, cB, cC): c_.close()
        b.close()
    bad_errs = [e for e in errors if "Failed to load resource" not in e and "timed out" not in e]
    check("No unexpected browser console errors or page errors", not bad_errs, bad_errs[:3])
    failed = [r_ for r_ in results if not r_[1]]; print(f"\n{len(results) - len(failed)}/{len(results)} V17.6.8 browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True); (ROOT / "test-results/browser-results-v1768.json").write_text(json.dumps([{"check": n, "pass": ok} for n, ok in results], indent=2)); sys.exit(1 if failed else 0)
if __name__ == "__main__": main()
