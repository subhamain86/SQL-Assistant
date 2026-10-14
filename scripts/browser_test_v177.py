"""SQL Assistant V17.7 — real-browser acceptance of the Admin Password authority on the PRODUCTION ARTIFACT, served as plain static files (no Node, no npm, no development server).
   npm run build && npm run build:test && python3 scripts/browser_test_v177.py        (CHROME_PATH=/path/to/chrome to use an installed browser)

REAL
  · the production page (a copy of release/ — the exact artifact that is deployed) served by Python's http.server (static files only: nothing but GET of files); Device B and every "clean device" is a separate Chromium context
    with its own empty localStorage / IndexedDB and NO test hook (production pages have none);
  · the REAL publication script (scripts/publish-data.mjs — what the publish-data workflow runs on GitHub) mirrors the repository data into the site folder; the published copy and its SHA-256 marker are what Device B reads;
  · the application's own services, crypto (PBKDF2 → AES-GCM verifier) and UI: Settings lock screen, the navbar-independent Sync button, the Security tab.
EMULATED
  · Device A (the administrator) runs the BROWSER-TEST build (test-dist/, the only build with hooks) against an in-memory repository with GitHub-like sha semantics; its repository files are what the "publish" step copies.
  · github.com, GitHub Actions, the central access service and Azure are not reachable here and are not claimed. Passwords are synthetic test values.
"""
import json, os, sys, re, shutil, subprocess, tempfile, pathlib, http.server, socketserver, threading, functools, traceback
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import browser_test_v1765 as T
ROOT = T.ROOT; PATH = T.PATH; check = T.check; results = T.results; errors = T.errors
VERSION = json.loads((ROOT / "package.json").read_text())["version"]
CP = "SYNTHETIC-central-pw-A1"; CP2 = "SYNTHETIC-central-pw-B2"; REPOSITORY = "basware/sk-ap-sql-assistant"
SYNC_DONE = "() => { const b = document.querySelector('#syncNowBtn'); return b && !b.disabled && document.querySelector('#syncNowStatus') && document.querySelector('#syncNowStatus').innerText.trim() !== ''; }"

class Static(http.server.SimpleHTTPRequestHandler):
    """Static files only — and a log of every path the page asked for (the no-NPM evidence)."""
    log = []
    def log_message(self, *a): pass
    def do_GET(self): Static.log.append(self.path.split("?")[0]); return super().do_GET()
def serve(directory):
    class S(socketserver.TCPServer): allow_reuse_address = True
    h = S(("127.0.0.1", 0), functools.partial(Static, directory=str(directory))); threading.Thread(target=h.serve_forever, daemon=True).start(); return h
def publish(files, site, commit="abc1234"):
    """What the publish-data workflow does: mirror sql-assistant-data/** of the repository into the site folder (marker last). `files` = {path: text}."""
    with tempfile.TemporaryDirectory() as t:
        for p, txt in files.items(): q = pathlib.Path(t) / p; q.parent.mkdir(parents=True, exist_ok=True); q.write_text(txt, encoding="utf-8")
        r = subprocess.run(["node", str(ROOT / "scripts/publish-data.mjs"), "--src", t, "--dest", str(site), "--commit", commit, "--repository", REPOSITORY], capture_output=True, text=True)
        if r.returncode != 0: raise Exception(r.stderr[:300])
def repo_files(repo): return {p: f[0] for p, f in repo.files.items()}
def record(revision, verifier=None, default=False): return json.dumps({"format": "sqla-admin-password", "formatVersion": 1, "revision": revision, "isDefault": default, "verifier": None if default else verifier, "updatedAt": "2026-10-14T09:00:00.000Z", "updatedByDevice": "test", "appVersion": VERSION}, indent=1)
def locked(pg): return pg.locator("#settingsPwInput").count() == 1
def attempt(pg, pw, wait=2200):
    pg.evaluate("() => { location.hash = '#quickstart'; }"); pg.wait_for_timeout(150); T.go(pg, "settings"); pg.wait_for_timeout(250)
    if not locked(pg): return True
    pg.fill("#settingsPwInput", pw); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(wait); return not locked(pg)
def marker(pg): return pg.evaluate("() => localStorage.getItem('sqla.pwvault.v15')")
def meta(pg): return pg.evaluate("() => localStorage.getItem('sqla.adminpwmeta.v1765')")
def body(pg): return pg.evaluate("() => document.body.innerText")
def change_pw(pg, old, new, wait=2800):
    T.stab(pg, "Security"); pg.fill("#pwCurrent", old); pg.fill("#pwNew", new); pg.fill("#pwConfirm", new); pg.click("#changePwBtn"); pg.wait_for_timeout(wait); return pg.inner_text("#pwResult")
def press_sync(pg, wait=500):
    T.go(pg, "quickstart"); pg.click("#syncNowBtn"); pg.wait_for_function(SYNC_DONE, timeout=25000); pg.wait_for_timeout(wait)
def device_b(b, url, tag):
    ctx = b.new_context(viewport={"width": 1366, "height": 900}); pg = ctx.new_page(); T.watch(pg, tag); reqs = []; pg.on("request", lambda r: reqs.append(r.url)); pg.goto(url); T.ready(pg); return ctx, pg, reqs
def main():
    for d in ("dist", "test-dist"):
        if not (ROOT / d / "index.html").exists(): print("Run npm run build and npm run build:test first."); sys.exit(2)
    work = pathlib.Path(tempfile.mkdtemp(prefix="sqla177-")); site = work / "site"; shutil.copytree(ROOT / "release", site, ignore=shutil.ignore_patterns("sql-assistant-data"))
    url_test = (ROOT / "test-dist/index.html").as_uri() + "?e2e=1"
    try:
        with sync_playwright() as p:
            exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
            # ── 0. the production page has no test hook and no global module loader (the V17.6.9 `?e2e=1` seam is gone)
            srv0 = serve(site); base0 = f"http://127.0.0.1:{srv0.server_address[1]}/"
            c0, p0, _ = device_b(b, base0 + "index.html?e2e=1", "prod-hook")
            st = p0.evaluate("() => ({ sqla: typeof window.__sqla, reg: typeof window.__sqlaRequire, def: typeof window.define, req: typeof window.require, proc: typeof window.process, fail: typeof window.__sqlaFail })")
            check("P1. The PRODUCTION page opened with ?e2e=1 exposes no test hook, no module registry, no global define, no Node globals", st == {"sqla": "undefined", "reg": "undefined", "def": "undefined", "req": "undefined", "proc": "undefined", "fail": "undefined"}, st)
            html = (site / "index.html").read_text(encoding="utf-8")
            check("P2. The deployed page contains no hook identifier (__sqla, installTestHooks, testHooks, e2e)", not re.search(r"\b__sqla\b|__sqlaRequire|installTestHooks|testHooks|get\('e2e'\)|e2e=1", html))
            check("P3. The page is byte-identical to dist/index.html (the artifact under test is the production build)", html == (ROOT / "dist/index.html").read_text(encoding="utf-8"))
            c0.close(); srv0.shutdown()
            # ── A. Device A (administrator, test build + emulated repository): non-default password, saved, synchronized, read back
            repo = T.Repo(); cA, a = T.newdev(b, url_test, repo, tag="A"); T.unlock(a)
            check("A0. Device A starts on the first-time default confirmed by the (empty) authoritative repository", not locked(a))
            res = change_pw(a, "admin", CP); rec = T.central(repo)
            check("A1. A saved a non-default password; the central record (revision 1, encrypted verifier only, no plaintext) was published and read back", "synchronized to the central repository" in res and rec and rec["revision"] == 1 and not rec["isDefault"] and set(rec["verifier"]) == {"salt", "iv", "ciphertext"} and CP not in json.dumps(rec), res[:200])
            # the "publish workflow" mirrors the repository into the site folder; Device B reads ONLY that
            publish(repo_files(repo), site); srv = serve(site); base = f"http://127.0.0.1:{srv.server_address[1]}/"; Static.log.clear()
            pub = json.loads((site / "sql-assistant-data/published.json").read_text())
            check("A2. The real publication script published the central record and its SHA-256 marker", PATH in pub["files"] and pub["format"] == "sqla-published-data")
            # ── B. a completely clean device: production artifact, static host, no hook, no token, no npm
            cB, bb, reqs = device_b(b, base + "index.html", "B")
            check("B0. Device B is a clean context served the PRODUCTION page: no test hook (typeof __sqla)", bb.evaluate("() => typeof window.__sqla") == "undefined")
            bb.wait_for_timeout(1500)
            ok_admin = attempt(bb, "admin"); check("B1. Clean device, central record published: 'admin' is REJECTED and Settings stay locked", not ok_admin and locked(bb), body(bb)[-160:])
            check("B2. The central verifier was retrieved from the published copy and applied (marker = central verifier, revision 1)", marker(bb) is not None and json.loads(marker(bb)) == rec["verifier"] and json.loads(meta(bb))["revision"] == 1, (marker(bb) or "")[:60])
            ok_c = attempt(bb, CP); check("B3. The centralized password is ACCEPTED on the clean device", ok_c and not locked(bb))
            T.go(bb, "quickstart"); bb.evaluate("() => { const l = document.querySelector('#settingsLockBadge'); if (l) l.click(); }"); bb.wait_for_timeout(300)
            paths = sorted(set(u.split("?")[0].replace(base, "") for u in reqs if u.startswith(base)))
            external = [u for u in reqs if not u.startswith(base) and not u.startswith("data:")]
            check("B4. NO NPM / NODE: the device asked a plain static file server for static files only (index page + sql-assistant-data/** published copy); no node_modules, no package, no API, no external host", not external and all(x in ("", "index.html") or x.startswith("sql-assistant-data/") for x in paths) and not any("node_modules" in x or "npm" in x.lower() or x.endswith(".ts") for x in paths), (paths, external[:3]))
            check("B5. The page itself needs no Node.js: no require / process / module in the page, no dev server (served by Python http.server)", bb.evaluate("() => typeof require === 'undefined' && typeof process === 'undefined' && typeof module === 'undefined'"))
            # a second, independent clean device: the very first attempt is 'admin'
            cB2, b2, _ = device_b(b, base + "index.html", "B2"); b2.wait_for_timeout(1200)
            check("B6. A second clean device whose FIRST attempt is 'admin': rejected; the central password then opens Settings", not attempt(b2, "admin") and attempt(b2, CP))
            T.go(b2, "quickstart"); b2.evaluate("() => { const l = document.querySelector('#settingsLockBadge'); if (l) l.click(); }"); T.go(b2, "settings"); b2.wait_for_timeout(300)
            check("B7. The lock screen never claims that 'admin' is the password while a central password is in force", re.sub(r"\s+", " ", b2.inner_text("main")).lower().count("default password is admin") == 0)
            # ── C. password change on A → publish → Sync on B (open, authenticated session with the old password)
            check("C0. B (still open) is authenticated with the old central password", attempt(bb, CP))
            res2 = change_pw(a, CP, CP2); rec2 = T.central(repo)
            check("C1. A changed the password: revision 2 published and read back; the verifier differs", "synchronized" in res2 and rec2 and rec2["revision"] == 2 and rec2["verifier"] != rec["verifier"], res2[:160])
            publish(repo_files(repo), site, commit="def5678")
            press_sync(bb, 800)
            T.go(bb, "settings"); bb.wait_for_timeout(300)
            check("C2. The Sync button on B applied revision 2 and the stale Admin session was invalidated: Settings are LOCKED again (the old authorization is not left in force)", locked(bb), body(bb)[-120:])
            check("C3. B's marker is now the revision-2 verifier", json.loads(marker(bb)) == rec2["verifier"] and json.loads(meta(bb))["revision"] == 2)
            r_old = attempt(bb, CP); r_def = attempt(bb, "admin"); r_new = attempt(bb, CP2)
            check("C4. After the remote change: the PREVIOUS password is rejected, 'admin' remains rejected, the NEW password works", (not r_old) and (not r_def) and r_new, (r_old, r_def, r_new))
            # ── D. fail-closed matrix on fresh clean devices of the production artifact
            def fresh(label, files, mutate=None, down=False):
                s = work / f"site-{label}"; shutil.copytree(site, s, ignore=shutil.ignore_patterns("sql-assistant-data"))
                if files is not None: publish(files, s)
                if mutate: mutate(s)
                if down: return None
                sv = serve(s); u = f"http://127.0.0.1:{sv.server_address[1]}/index.html"; return sv, u
            def run_fresh(label, files, mutate=None, expect_admin=False, expect_cp=None, down=False, note=""):
                r = fresh(label, files, mutate, down)
                if r is None:
                    s = work / f"site-{label}"; sv = serve(s); u = f"http://127.0.0.1:{sv.server_address[1]}/index.html"; c_, p_, _ = device_b(b, u, label); sv.shutdown(); sv.server_close()   # the host answers once (the page), then is gone: every later read fails
                else: sv, u = r; c_, p_, _ = device_b(b, u, label)
                p_.wait_for_timeout(1200); got_admin = attempt(p_, "admin"); got_cp = attempt(p_, CP) if expect_cp is not None else None
                check(f"D-{label}. {note}: 'admin' {'ACCEPTED (explicit central reset)' if expect_admin else 'REJECTED'}" + ("" if expect_cp is None else f"; central password {'accepted' if expect_cp else 'rejected'}"), got_admin == expect_admin and (expect_cp is None or got_cp == expect_cp), (got_admin, got_cp))
                c_.close(); sv.shutdown()
            other = {"sql-assistant-data/schemas/registry.json": "{}"}
            run_fresh("norecord", other, note="published copy lists NO Admin Password record (central status unknown on this device)")
            def corrupt(s): f = s / "sql-assistant-data/security/admin-password.json"; f.write_text(f.read_text() + " ", encoding="utf-8")
            run_fresh("tampered", repo_files(repo), mutate=corrupt, note="central record altered after publication (hash mismatch → unavailable)")
            run_fresh("invalid", {PATH: json.dumps({"format": "sqla-admin-password", "formatVersion": 1, "revision": 5})}, note="central record INVALID")
            run_fresh("down", None, down=True, note="host unreachable after the page was delivered (network request failed)")
            run_fresh("central", repo_files(repo), expect_cp=False, note="central record available (CP1 was replaced by revision 2)")
            run_fresh("reset", {PATH: record(3, default=True)}, expect_admin=True, note="central record is an EXPLICIT reset to the default")
            # ── E. stale local credential on a device whose central source is gone
            cE, e, _ = device_b(b, base + "index.html", "E"); e.wait_for_timeout(1200); got = attempt(e, CP2); check("E0. Device E adopted the central verifier from the published copy", got)
            cE.route("**/sql-assistant-data/**", lambda r: r.abort()); e.reload(); T.ready(e); e.wait_for_timeout(1500)   # the page is delivered, the central source (published copy) is no longer reachable
            check("E1. Central source unavailable on reload: the compatible LOCAL verifier still opens Settings, 'admin' does NOT", (not attempt(e, "admin")) and attempt(e, CP2))
            for c_ in (cA, cB, cB2, cE): c_.close()
            srv.shutdown(); b.close()
    finally:
        shutil.rmtree(work, ignore_errors=True)
    bad_errs = [x for x in errors if "Failed to load resource" not in x and "timed out" not in x and "ERR_CONNECTION" not in x]
    check("No unexpected browser console errors or page errors", not bad_errs, bad_errs[:3])
    failed = [r_ for r_ in results if not r_[1]]; print(f"\n{len(results) - len(failed)}/{len(results)} V17.7 browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True); (ROOT / "test-results/browser-results-v177.json").write_text(json.dumps([{"check": n, "pass": ok} for n, ok in results], indent=2)); sys.exit(1 if failed else 0)
if __name__ == "__main__": main()
