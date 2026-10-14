"""SQL Assistant V17.6.5 — real-browser tests of the CENTRALIZED ADMIN PASSWORD and Settings → Security → Reset Admin Password to Default (production build, Chromium / Playwright).
   npm run build && python3 scripts/browser_test_v1765.py        (CHROME_PATH=/path/to/chrome to use an installed browser)

What is REAL: the production page; the application's own service, crypto and UI; every "device" is a separate Chromium context (no shared localStorage / IndexedDB).
What is EMULATED: the repository — ONE live, shared in-memory repository (a Python dict with GitHub-like sha / "file changed" semantics) reached through the application's own test hook
(?e2e=1 → setRepositoryOverride), exactly as the V17.5.1 admin-message tests do. No GitHub Actions run, no GitHub, no network.
Covers: clean installation, upgrade from V17.6.4, change on one device → unlock on another, reset dialog (cancel / confirm), re-lock, warning, central record, Danger Zone reset, unchanged
other settings, a read-only repository (pending), no repository, rollback format, version stamps, regression of the Security / Danger Zone pages, secrecy and console errors."""
import json, os, sys, hashlib, pathlib, traceback
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]; PATH = "sql-assistant-data/security/admin-password.json"
VERSION = json.loads((ROOT / "package.json").read_text())["version"]  # V17.6.9: the CURRENT version comes from package.json — suites never pin it with a literal
results, errors = [], []
def check(name, ok, detail=""):
    results.append((name, bool(ok))); print(("PASS " if ok else "FAIL ") + name + ("" if ok or not detail else f" — {str(detail)[:340]}"), flush=True)
def watch(pg, tag):
    pg.on("console", lambda m: m.type == "error" and errors.append(f"{tag}: {m.text}")); pg.on("pageerror", lambda e: errors.append(f"{tag}: {e}")); pg.on("dialog", lambda d: d.accept())
def ready(pg): pg.wait_for_function("() => document.documentElement.getAttribute('data-sqla-ready') === '1'", timeout=20000); pg.wait_for_timeout(250)
def go(pg, route): pg.evaluate(f"location.hash = '#{route}'"); pg.wait_for_timeout(300)
def unlock(pg, pw="admin"):
    go(pg, "settings")
    if pg.locator("#settingsPwInput").count(): pg.fill("#settingsPwInput", pw); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(1300)
def stab(pg, name): pg.click(f'.tab-btn:has-text("{name}")'); pg.wait_for_timeout(350)
def locked(pg): return pg.locator("#settingsPwInput").count() == 1
def toasts(pg): return pg.evaluate("() => document.body.innerText")

class Repo:
    """One shared repository for every device: GitHub-like sha, 'file changed' on a stale sha, optional read-only mode."""
    def __init__(self): self.files = {}; self.n = 0; self.readonly = False; self.writes = []
    def read(self, p): f = self.files.get(p); return None if f is None else {"text": f[0], "sha": f[1]}
    def write(self, p, t, s, m):
        if self.readonly: raise Exception("This device reads the published copy and holds no GitHub access token, so it cannot publish.")
        c = self.files.get(p)
        if c and c[1] != s: raise Exception("Writing failed: the file changed on the server — synchronize again.")
        self.n += 1; sha = f"sha{self.n}"; self.files[p] = (t, sha); self.writes.append(p); return sha
def attach(ctx, pg, repo):
    ctx.expose_function("__repoRead", lambda p: repo.read(p)); ctx.expose_function("__repoWrite", lambda p, t, s, m: repo.write(p, t, s, m))
def connect(pg):
    pg.evaluate("() => window.__sqla.setRepositoryOverride({ describe: 'shared test repository', read: async (p) => window.__repoRead(p), write: async (p, t, s, m) => window.__repoWrite(p, t, s, m) })"); pg.wait_for_timeout(100)
def newdev(b, url, repo=None, tag="dev", w=1366, h=900, connected=True):
    ctx = b.new_context(viewport={"width": w, "height": h}); pg = ctx.new_page(); watch(pg, tag)
    if repo is not None: attach(ctx, pg, repo)
    pg.goto(url); ready(pg)
    if repo is not None and connected: connect(pg)
    return ctx, pg
def sync(pg): return pg.evaluate("async () => { const r = await window.__sqla.services().adminPassword.synchronize(); return { ok: r.ok, synchronized: r.synchronized, changed: r.changed, message: r.message }; }")
def central(repo): f = repo.files.get(PATH); return json.loads(f[0]) if f else None
def ls(pg, k): return pg.evaluate("(k) => localStorage.getItem(k)", k)
def snapshot(pg):  # every browser-storage entry except the Admin Password marker / meta and time-stamped, device-specific entries
    return pg.evaluate("() => Object.fromEntries(Object.keys(localStorage).filter(k => !['sqla.pwvault.v15','sqla.adminpwmeta.v1765'].includes(k)).sort().map(k => [k, localStorage.getItem(k)]))")
def legacy_marker(pg, password):  # exactly what V17.6.4 stored: PBKDF2-SHA-256 150 000 → AES-256-GCM of the fixed marker
    return pg.evaluate("""async (pw) => { const b64 = (u) => btoa(String.fromCharCode(...u)); const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
      const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']); const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('sqla-verified-marker-v15'))); return JSON.stringify({ salt: b64(salt), iv: b64(iv), ciphertext: b64(ct) }); }""", password)
def section(name, fn, *a):
    try: fn(*a)
    except Exception as ex: check(f"{name}: section completed", False, f"{type(ex).__name__}: {str(ex)[:260]} | {traceback.format_exc().splitlines()[-3][:150]}")

def identity(b, url):
    ctx, pg = newdev(b, url, Repo(), tag="id"); foot = pg.inner_text("footer");  # V17.6.9: a clean installation whose authoritative repository answers "no record" (the default is confirmed)
    go(pg, "about"); about = pg.inner_text("main")
    check("Identity: footer 'Version <current>'; About lists the current version first, then 17.6.6, 17.6.5, 17.6.4; page title unchanged", ("Version " + VERSION) in foot and about.index(VERSION) < about.index("17.6.6") < about.index("17.6.5") < about.index("17.6.4") and pg.title() == "SQL Assistant")
    go(pg, "settings"); check("Clean installation: lock screen offers the default 'admin' hint; nothing in storage about the Admin Password", "default password is" in pg.inner_text("main") and ls(pg, "sqla.pwvault.v15") is None)
    pg.fill("#settingsPwInput", "admin"); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(1300); stab(pg, "Security"); t = pg.inner_text("main")
    check("Security page: Change Admin Password and Session panels are unchanged; the status line and the new reset panel are added", "Change Admin Password" in t and "Session" in t and "Central synchronization" in t and "Reset Admin Password to Default" in t and pg.locator("#resetPwDefaultBtn").count() == 1 and pg.locator("#changePwBtn").count() == 1 and pg.locator("#lockNowBtn").count() == 1, t[:200])
    ctx.close()

def central_flow(b, url, repo):
    cA, a = newdev(b, url, repo, tag="A"); cB, bdev = newdev(b, url, repo, tag="B")
    r = sync(a); check("Clean installation: the first synchronization publishes NOTHING (default password, no record) and does not claim the default is synchronized", r["ok"] and not r["synchronized"] and PATH not in repo.files, r)
    unlock(a); stab(a, "Security"); a.fill("#pwCurrent", "admin"); a.fill("#pwNew", "Central-Pass-77"); a.fill("#pwConfirm", "Central-Pass-77"); a.click("#changePwBtn"); a.wait_for_timeout(2500)
    res = a.inner_text("#pwResult"); rec = central(repo)
    check("Change on device A: success message says it was synchronized to the central repository", "synchronized to the central repository" in res, res)
    check("Central record: revision 1, encrypted verifier only, no plaintext password anywhere in the file", rec and rec["revision"] == 1 and rec["isDefault"] is False and set(rec["verifier"]) == {"salt", "iv", "ciphertext"} and "Central-Pass-77" not in repo.files[PATH][0], rec)
    check("Status line shows the central revision", "revision 1" in a.inner_text("#pwSyncStatus"), a.inner_text("#pwSyncStatus"))
    go(bdev, "settings"); bdev.wait_for_timeout(1800); check("Device B (never synchronized): the lock screen asks for the central record at once and no longer claims that 'admin' is the password (V17.6.8)", locked(bdev) and "default password is admin" not in " ".join(bdev.inner_text("main").split()))
    bdev.fill("#settingsPwInput", "wrong-password"); bdev.click("#settingsUnlockBtn"); bdev.wait_for_timeout(1500); check("Device B: a wrong password is rejected (after one central check)", locked(bdev) and "Incorrect password" in bdev.inner_text("main"))
    bdev.fill("#settingsPwInput", "Central-Pass-77"); bdev.click("#settingsUnlockBtn"); bdev.wait_for_timeout(1800)
    check("Device B: the NEW password unlocks Settings at once (central record fetched at the unlock check)", not locked(bdev) and "Settings" in bdev.inner_text("main"))
    check("Device B: its marker is the central one (V17.6.4 key and format: salt / iv / ciphertext) and 'admin' no longer works there", set(json.loads(ls(bdev, "sqla.pwvault.v15"))) == {"salt", "iv", "ciphertext"} and ls(bdev, "sqla.pwvault.v15") is not None)
    check("No plaintext password in either device's browser storage", "Central-Pass-77" not in json.dumps(snapshot(a)) + json.dumps(snapshot(bdev)) + (ls(a, "sqla.pwvault.v15") or "") + (ls(bdev, "sqla.pwvault.v15") or "") + (ls(bdev, "sqla.adminpwmeta.v1765") or ""))
    return cA, a, cB, bdev

def reset_flow(b, url, repo, a, bdev):
    stab(bdev, "Security"); before = snapshot(bdev); n_before = len(repo.writes)
    bdev.click("#resetPwDefaultBtn"); bdev.wait_for_timeout(400); dlg = bdev.inner_text("#pwResetDialog")
    check("Reset: a confirmation dialog opens first and explains: default 'admin', every device, insecure, change immediately, no other setting changed", all(x in dlg for x in ["Reset Admin Password to Default?", "admin", "every device", "insecure", "Change it immediately", "No repository, Secret Vault, synchronization or application setting"]), dlg)
    check("Reset: nothing has happened yet (marker and central record unchanged)", central(repo)["revision"] == 1 and len(repo.writes) == n_before and not locked(bdev))
    bdev.click("#pwResetCancel"); bdev.wait_for_timeout(300); check("Reset: Cancel closes the dialog and changes nothing", bdev.locator("#pwResetDialog").count() == 0 and central(repo)["revision"] == 1 and not locked(bdev))
    bdev.click("#resetPwDefaultBtn"); bdev.wait_for_timeout(300); bdev.click("#pwResetConfirm"); bdev.wait_for_timeout(2800)
    rec = central(repo); body = toasts(bdev)
    check("Reset (confirmed): the reset is published to the central repository immediately (revision 2, isDefault, no verifier)", rec["revision"] == 2 and rec["isDefault"] is True and rec["verifier"] is None, rec)
    check("Reset: Settings are locked again and the dialog is closed", locked(bdev) and bdev.locator("#pwResetDialog").count() == 0)
    check("Reset: a warning says the default password is insecure and must be changed immediately, and that the reset was published", "insecure" in body and "change it immediately" in body and "published to the central repository" in body, body[-400:])
    check("Reset: this device's marker is removed (V17.6.4 representation of the default) and 'admin' unlocks", ls(bdev, "sqla.pwvault.v15") is None); bdev.fill("#settingsPwInput", "admin"); bdev.click("#settingsUnlockBtn"); bdev.wait_for_timeout(1300)
    check("Reset: 'admin' unlocks Settings on this device", not locked(bdev)); stab(bdev, "Security")
    after = snapshot(bdev); changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
    check("Reset: no other storage entry (repository configuration, Secret Vault, synchronization, application settings, device tag) was created or modified", changed == [], changed)
    a.evaluate("() => window.__sqla.services().adminPassword.synchronize()"); a.wait_for_timeout(1000); unlock(a, "admin")
    check("Device A (stale, still held the old password) applies the reset at its next synchronization: 'admin' unlocks, the old password does not", not locked(a) and ls(a, "sqla.pwvault.v15") is None)

def danger_flow(b, url, repo, a):
    stab(a, "Security"); a.fill("#pwCurrent", "admin"); a.fill("#pwNew", "Danger-Pass-55"); a.fill("#pwConfirm", "Danger-Pass-55"); a.click("#changePwBtn"); a.wait_for_timeout(2500); rev = central(repo)["revision"]
    check("Change after a reset: revision continues (3) and is published", rev == 3 and central(repo)["isDefault"] is False, central(repo))
    stab(a, "Danger Zone"); a.fill("#dangerPw", "Danger-Pass-55"); a.click("#dangerPwReset"); a.wait_for_timeout(2800)
    check("Danger Zone → Reset Admin Password to default: also central (revision 4, default), Settings locked, warning shown", central(repo)["revision"] == 4 and central(repo)["isDefault"] is True and locked(a) and "insecure" in toasts(a))

def upgrade_flow(b, url):
    repo = Repo(); cA, a = newdev(b, url, repo, tag="up-A", connected=False); cB, bb = newdev(b, url, repo, tag="up-B", connected=False); cC, c = newdev(b, url, repo, tag="up-C", connected=False)
    a.evaluate("(m) => localStorage.setItem('sqla.pwvault.v15', m)", legacy_marker(a, "Legacy-Alpha-1")); c.evaluate("(m) => localStorage.setItem('sqla.pwvault.v15', m)", legacy_marker(c, "Legacy-Gamma-3"))
    for pg in (a, bb, c): pg.reload(); ready(pg); connect(pg)
    unlock(a, "Legacy-Alpha-1"); check("Upgrade: a V17.6.4 password (custom marker, no new meta) still unlocks after the upgrade", not locked(a)); r = sync(a); rec = central(repo)
    check("Upgrade: the first upgraded device publishes its existing password as revision 1 (encrypted marker only)", r["synchronized"] and rec and rec["revision"] == 1 and "Legacy-Alpha-1" not in repo.files[PATH][0], (r, rec))
    sync(bb); unlock(bb, "Legacy-Alpha-1"); check("Upgrade: a fresh device B accepts the central password", not locked(bb))
    r3 = sync(c); unlock(c, "Legacy-Alpha-1"); check("Upgrade: device C had a DIFFERENT V17.6.4 password — it is replaced by the central one and C is told", r3["changed"] and not locked(c)); go(c, "settings")
    c.evaluate("() => window.__sqla.store.lockSettings()"); c.wait_for_timeout(300); unlock(c, "Legacy-Gamma-3"); check("Upgrade: C's own old password no longer works (no device-specific divergence)", locked(c))
    check("Rollback format: the synchronized marker is byte-compatible with V17.6.4 (salt / iv / ciphertext under sqla.pwvault.v15)", set(json.loads(ls(c, "sqla.pwvault.v15"))) == {"salt", "iv", "ciphertext"})
    cA.close(); cB.close(); cC.close()

def readonly_flow(b, url):
    repo = Repo(); repo.readonly = True; cA, a = newdev(b, url, repo, tag="ro"); unlock(a); stab(a, "Security"); a.fill("#pwCurrent", "admin"); a.fill("#pwNew", "Readonly-Pass-1"); a.fill("#pwConfirm", "Readonly-Pass-1"); a.click("#changePwBtn"); a.wait_for_timeout(2500)
    res = a.inner_text("#pwResult"); check("Read-only repository (V17.6.8: publish first): the change is REFUSED with the reason — nothing changes on this device, nothing is published", "cannot publish" in res and "NOT changed" in res and ls(a, "sqla.pwvault.v15") is None and central(repo) is None, (res, a.inner_text("#pwSyncStatus")))
    repo.readonly = False; a.fill("#pwCurrent", "admin"); a.fill("#pwNew", "Readonly-Pass-1"); a.fill("#pwConfirm", "Readonly-Pass-1"); a.click("#changePwBtn"); a.wait_for_timeout(2500); check("Once publishing is possible the same change is published (revision 1) and applied", central(repo) and central(repo)["revision"] == 1 and "revision 1" in (a.evaluate("() => window.__sqla.services().adminPassword.status().text")))
    cA.close()
    cN, n = newdev(b, url, None, tag="norepo", connected=False); n.evaluate("(m) => localStorage.setItem('sqla.pwvault.v15', m)", legacy_marker(n, "Old-Local-Pass1")); unlock(n, "Old-Local-Pass1"); stab(n, "Security"); n.fill("#pwCurrent", "Old-Local-Pass1");  # V17.6.9: a device without a connection never accepts the default; one that holds its own (V17.6.4) marker keeps working n.fill("#pwNew", "Local-Only-Pass1"); n.fill("#pwConfirm", "Local-Only-Pass1"); n.click("#changePwBtn"); n.wait_for_timeout(1500)
    check("No repository connection: the change still works locally and says so; status shows the missing connection", "not set up" in n.inner_text("#pwResult") or "no repository connection" in n.inner_text("#pwSyncStatus"), n.inner_text("#pwResult")); cN.close()

def main():
    html = (ROOT / "test-dist/index.html").read_text(encoding="utf-8"); url = (ROOT / "test-dist/index.html").as_uri() + "?e2e=1"
    import re; check("The production bundle contains no credential-looking string", not re.search(r"\bghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9]{20,}", html))
    repo = Repo()
    with sync_playwright() as p:
        exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        section("identity / clean installation", identity, b, url)
        try: cA, a, cB, bdev = central_flow(b, url, repo)
        except Exception as ex: check(f"central flow: section completed", False, f"{type(ex).__name__}: {str(ex)[:300]} | {traceback.format_exc().splitlines()[-3][:150]}"); b.close(); return finish()
        section("reset flow", reset_flow, b, url, repo, a, bdev); section("Danger Zone flow", danger_flow, b, url, repo, a); cA.close(); cB.close()
        section("upgrade from V17.6.4", upgrade_flow, b, url); section("read-only repository / no repository", readonly_flow, b, url)
        b.close()
    finish()
def finish():
    check("No browser console errors or page errors", not errors, errors[:3])
    failed = [r for r in results if not r[1]]; print(f"\n{len(results) - len(failed)}/{len(results)} V17.6.5 browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True); (ROOT / "test-results/browser-results-v1765.json").write_text(json.dumps([{"check": n, "pass": ok} for n, ok in results], indent=2)); sys.exit(1 if failed else 0)
if __name__ == "__main__": main()
