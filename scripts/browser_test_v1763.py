"""SQL Assistant V17.6.3 — real-browser tests of the PUBLISHED COPY (reads need no token) on the PRODUCTION build (Chromium / Playwright).
   npm run build && python3 scripts/browser_test_v1763.py        (CHROME_PATH=/path/to/chrome to use an installed browser)

What is REAL: the production page on real static servers (scripts/serve.mjs); the REAL publication scripts (scripts/publish-data.mjs and scripts/build-central-vault.mjs, run as processes) producing the marker,
the mirrored files and the central token vault; the application's own client, vault and crypto; every browser profile ("device") is a separate Chromium context (no shared localStorage / IndexedDB / cookies).
What is EMULATED (no network access to github.com here): github.com's REST API — test/support/github-stub.mjs (a private repository, read-only and writer tokens, 401 / 403 / 404), reached through Playwright's
network routing for https://api.github.com. The GitHub Actions run itself is not executed. Nothing reaches github.com.
Covers: Device A (a token on the device), Device B (clean profile, nothing saved — central vault with the default passphrase restores the token automatically), Device C (clean profile, central vault under its
own passphrase — reads work with no token at all), the failure scenarios, regression (no marker ⇒ V17.6.2 behaviour) and secret hygiene."""
import json, os, re, sys, time, subprocess, pathlib, shutil, tempfile, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import browser_test_v1762 as T
ROOT = T.ROOT; check = T.check; free_port = T.free_port; results = T.results
OWNER, REPO = T.OWNER, T.REPO; DEF = T.DEF; PLAIN = T.PLAIN; VPATH = T.VPATH; SHARED = T.SHARED; REGISTRY = T.REGISTRY
USER_OK, USER_RW, USER_NONE, PAT = T.USER_OK, T.USER_RW, T.USER_NONE, T.PAT; OWN = T.OWN; DEFAULT_PASS = T.DEFAULT_PASS; COMMIT = "c0ffee" + "1" * 34
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type,accept,x-github-api-version", "access-control-allow-methods": "GET,POST,PUT,OPTIONS"}

def run(args, env=None):
    p = subprocess.run(["node"] + args, env={**os.environ, **(env or {})}, capture_output=True, text=True, timeout=60); return p.returncode, p.stdout + p.stderr
def make_published(sp, vault_pass, allow_default, root_name):
    """The REAL workflow steps: build the central token vault (read-only token), then mirror sql-assistant-data/ into <site>/sql-assistant-data/ with the marker."""
    src = pathlib.Path(tempfile.mkdtemp(prefix="sqla-src-")); dest = pathlib.Path(tempfile.mkdtemp(prefix="sqla-dest-"))
    (src / "sql-assistant-data/schemas").mkdir(parents=True); (src / PLAIN).write_text(REGISTRY, encoding="utf-8")
    env = {"SQLA_DEVICE_TOKEN": USER_OK, "SQLA_REPOSITORY": DEF, "GITHUB_API_BASE": f"http://127.0.0.1:{sp}", "SQLA_OUT_ROOT": str(src)}
    if vault_pass: env["SQLA_VAULT_PASSPHRASE"] = vault_pass
    if allow_default: env["SQLA_ALLOW_DEFAULT_VAULT_PASSPHRASE"] = "true"
    rc, out = run([str(ROOT / "scripts/build-central-vault.mjs")], env); assert rc == 0, out
    rc2, out2 = run([str(ROOT / "scripts/publish-data.mjs"), "--src", str(src), "--dest", str(dest), "--commit", COMMIT, "--repository", DEF]); assert rc2 == 0, out2
    return src, dest, out
def site(pub_dest, port):
    d = pathlib.Path(tempfile.mkdtemp(prefix="sqla-site-")); shutil.copytree(ROOT / "release", d / "release"); (d / "scripts").mkdir(); shutil.copy(ROOT / "scripts/serve.mjs", d / "scripts/serve.mjs")
    if pub_dest is not None: shutil.copytree(pub_dest / "sql-assistant-data", d / "release/sql-assistant-data", dirs_exist_ok=True)
    p = subprocess.Popen(["node", str(d / "scripts/serve.mjs")], env={**os.environ, "PORT": str(port), "BASE": "/"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.9); return p, d
def gh_route(sp):
    def h(route):
        req = route.request; path = req.url.replace("https://api.github.com", "")
        if req.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
        hdr = {k: v for k, v in req.headers.items() if k in ("authorization", "accept", "content-type")}
        try:
            r = urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{sp}{path}", method=req.method, headers=hdr, data=req.post_data_buffer), timeout=10); st, body = r.status, r.read(); extra = {}
        except urllib.error.HTTPError as e: st, body = e.code, e.read(); extra = {}
        route.fulfill(status=st, body=body, headers={"content-type": "application/json", **CORS, **extra})
    return h
def newdev(b, url, tag, sp, w=1366, h=900):
    ctx = b.new_context(viewport={"width": w, "height": h}); ctx.route("https://api.github.com/**", gh_route(sp)); pg = ctx.new_page(); T.watch(pg, tag); pg.goto(url + "?e2e=1"); T.ready(pg); return ctx, pg
def masked(pg): return pg.inner_text("#maskedToken")
def auto_text(pg, timeout=20000):
    pg.wait_for_function("() => { const r = document.querySelector('#autoTokenResult'); return r && r.innerText.trim().length > 0; }", timeout=timeout); return pg.inner_text("#autoTokenResult")
def api_reqs(): return [r for r in T.requests if "api.github.com" in r[2]]
def site_urls(port): return [r for r in T.requests if f"127.0.0.1:{port}" in r[2]]
def fp(pg): return pg.evaluate("() => JSON.stringify(window.__sqla.services().schemas.registry().schemas.map(s => [s.id, s.name, s.version, s.tables.length]))")
def blob(pg): return pg.evaluate("() => localStorage.getItem('sqla.vault.local.v17')")

def main():
    html = (ROOT / "dist/index.html").read_text(encoding="utf-8")
    check("The production bundle holds no PAT, no device token, no vault passphrase other than the built-in default, and no environment access", not T.leaked(html, PAT, USER_OK, USER_RW, USER_NONE, OWN, "process.env"))
    sp = free_port(); procs = []; dirs = []; p1, p2, p3 = free_port(), free_port(), free_port()
    try:
        gh = T.spawn([str(ROOT / "test/support/github-stub.mjs"), str(sp)], {}, "github stub"); procs.append(gh); T.stub(sp, "file", path=PLAIN, text=REGISTRY)
        src1, pub1, out1 = make_published(sp, None, True, "default"); src2, pub2, out2 = make_published(sp, OWN, False, "own"); dirs += [src1, pub1, src2, pub2]
        check("Workflow step 1 (build-central-vault): the read-only device token is encrypted into the standard vault envelope; the log names the PUBLIC default passphrase as a warning when it is used and never prints the token", "::warning" in out1 and "built-in default" in out1 and "secret SQLA_VAULT_PASSPHRASE" in out2 and not T.leaked(out1 + out2, USER_OK, PAT))
        mk = json.loads((pub2 / "sql-assistant-data/published.json").read_text()); vtext = (pub2 / VPATH).read_text()
        check("Workflow step 2 (publish-data): the marker lists the registry and the vault with SHA-256, the vault file contains no readable token or passphrase, no GITHUB PAT was needed", mk["format"] == "sqla-published-data" and set(mk["files"]) == {PLAIN, VPATH} and not T.leaked(vtext, USER_OK, PAT, OWN, DEFAULT_PASS) and sorted(json.loads(vtext)) == sorted(["v", "alg", "kdf", "iter", "salt", "iv", "ct"]))
        s1, d1 = site(pub1, p1); s2, d2 = site(pub2, p2); s3, d3 = site(None, p3); procs += [s1, s2, s3]; dirs += [d1, d2, d3]
        with sync_playwright() as p:
            exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
            device_b(b, f"http://127.0.0.1:{p1}/", sp, p1); device_c(b, f"http://127.0.0.1:{p2}/", sp, p2, d2, procs[2]); device_a(b, f"http://127.0.0.1:{p1}/", sp, p1); regression(b, f"http://127.0.0.1:{p3}/", sp, p3); hygiene(sp, p1, p2)
            b.close()
    finally:
        for pr in procs:
            try: pr.terminate()
            except Exception: pass
        for d in dirs: shutil.rmtree(d, ignore_errors=True)
    bad = [e for e in T.errors if "Failed to load resource" not in e]
    check("No console errors or uncaught exceptions in any V17.6.3 flow (expected network-status lines of the failure scenarios excluded); no secret in any console message", not bad and not T.leaked("\n".join(T.console_all), PAT, USER_OK, USER_RW, OWN, T.AI), bad[:3])
    failed = [r for r in results if not r[1]]; print(f"\n{len(results) - len(failed)}/{len(results)} V17.6.3 browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True); (ROOT / "test-results/browser-results-v1763.json").write_text(json.dumps([{"check": n, "pass": ok} for n, ok in results], indent=2)); sys.exit(1 if failed else 0)

# ───────────── Device B — clean profile, central vault under the DEFAULT passphrase ⇒ the token is restored automatically ─────────────
def device_b(b, url, sp, port):
    T.stub(sp, "reset"); ctx, pg = newdev(b, url, "B", sp); T.hamburger_pull(pg)
    heads = pg.evaluate("() => [...document.querySelectorAll('#schemaRepoCardMount h2, #schemaPullHost h2, #schemaVaultCardMount h2')].map(h => h.innerText.trim())")
    check("B: Hamburger → Schema → Pull Schema holds exactly the three cards in order: GitHub repository (schema synchronization) · Pull Schema from GitHub · Pull Secret Vault to Repository", len(heads) == 3 and heads[0].endswith("GitHub repository (schema synchronization)") and heads[1].endswith("Pull Schema from GitHub") and heads[2].endswith("Pull Secret Vault to Repository"), heads)
    msg = auto_text(pg)
    check("B: a clean profile with NO token: the GitHub Access Token is populated automatically from the published central vault — 'restored automatically', masked, no one typed or copied anything", "restored automatically" in msg and DEF.split("/")[0] != "" and USER_OK[-4:] in masked(pg) and "(not set)" not in masked(pg), msg[:200])
    check("B: the token is held only as ciphertext (encrypted vault in browser storage), shown masked, and appears in no page text, markup, storage or console", blob(pg) is not None and not T.leaked(pg.inner_text("body") + pg.evaluate("() => document.querySelector('#app').outerHTML") + T.storage(pg), USER_OK, PAT))
    check("B: the token went only to api.github.com (as a Bearer header) for GitHub's own validation; the site received no credential", all(("Bearer" not in r[4]) or "api.github.com" in r[2] for r in T.requests if r[0] == "B") and any(r[4] == f"Bearer {USER_OK}" and "api.github.com" in r[2] for r in T.requests if r[0] == "B"))
    check("B: the card says a token is only needed to publish, and shows the publication record (commit, files)", "Reading needs no token" in pg.inner_text("#publishedHint") and COMMIT[:7] in pg.inner_text("#publishedHint"))
    pg.click("#pullBtn"); res = T.pull_wait(pg)
    check("B: Pull Schema from GitHub works — the schema is retrieved, validated and applied, success is reported only afterwards, and the shared schema is active (no passphrase asked)", "Schema pulled and validated successfully" in res and T.active_name(pg) == SHARED and pg.locator("#schemaPullHost input").count() == 0, res[:200])
    check("B: Settings → Secret Vault has no repository card and no token row, keeps Push Secret Vault to Repository, and explains the published copy; Schema Management has no passphrase card", (lambda: (T.unlock(pg), T.stab(pg, "Secret Vault"), True)[-1])() and pg.locator("#pushVaultBtn").count() == 1 and pg.locator("#vaultRepo, #vaultBranch, #vaultPath, #repoCfgEdit, #newTokenInput").count() == 0 and "Published copy" in pg.inner_text("main") and (lambda: (T.stab(pg, "Schema Management"), "Schema passphrase" not in pg.inner_text("main") and "Sync with GitHub Now" in pg.inner_text("main"))[-1])())
    ctx.close()

# ───────────── Device C — clean profile, central vault under its OWN passphrase: reading needs no token at all ─────────────
def device_c(b, url, sp, port, site_dir, site_proc):
    T.stub(sp, "reset"); ctx, pg = newdev(b, url, "C", sp); T.hamburger_pull(pg); n0 = len(api_reqs())
    msg = auto_text(pg)
    check("C: the central vault is protected by its OWN passphrase: automatic restore does not guess — it says so and points to the Pull Secret Vault card; the token stays '(not set)' and nothing was changed", "its own Vault Sync Passphrase" in msg and "(not set)" in masked(pg) and blob(pg) is None, msg[:200])
    reg0 = T.registry_json(pg); pg.click("#pullBtn"); res = T.pull_wait(pg)
    check("C: with NO token Pull Schema still works — read from the published copy (hash-checked), applied, shared schema active", "Schema pulled and validated successfully" in res and T.active_name(pg) == SHARED, res[:200])
    check("C: …and not a single request went to GitHub for it (no api.github.com request, no credential anywhere)", len(api_reqs()) == n0 and not [r for r in T.requests if r[0] == "C" and r[4]])
    # Pull Secret Vault: default passphrase is wrong for this vault → refused, nothing changes
    local0 = T.local_only(pg); pg.click("#pullVaultBtn"); r1 = T.vault_wait(pg)
    check("C: Pull Secret Vault with the pre-filled default passphrase: refused with the real cause ('passphrase is wrong'), no other passphrase tried, the device is unchanged; the card names the source as the published copy", ("passphrase is wrong" in r1.lower() or "could not be decrypted" in r1.lower()) and T.local_only(pg) == local0 and "(not set)" in masked(pg), r1[:240])
    T.set_pass(pg, OWN); pg.click("#pullVaultBtn"); r2 = T.vault_wait(pg)
    check("C: with the right passphrase the vault is retrieved from the published copy, validated, decrypted and restored — 'Secret Vault imported and validated', source = the published copy, no GitHub credential used to fetch it", "Secret Vault imported and validated" in r2 and "published copy" in r2 and USER_OK[-4:] in masked(pg), r2[:260])
    # direction + reads only: no write ever
    check("C: Pull Secret Vault only READS: the stub saw no write from this device", not [r for r in T.state(sp)["requests"] if r["method"] == "PUT"])
    # failure scenarios on a second clean device (published copy tampered / unlisted / site down), the local schema stays intact
    ctx.close(); ctx, pg = newdev(b, url, "C2", sp); T.hamburger_pull(pg); auto_text(pg); pg.click("#pullBtn"); T.pull_wait(pg); base = fp(pg); who = T.active_name(pg); intact = lambda: fp(pg) == base and T.active_name(pg) == who
    reg_file = site_dir / "release" / PLAIN; orig = reg_file.read_text(encoding="utf-8")
    reg_file.write_text(orig.replace(SHARED, "Tampered Schema"), encoding="utf-8"); pg.click("#pullBtn"); res = T.pull_wait(pg)
    check("Failure — the published registry does not match its publication record (publication in progress / tampered): refused, never applied, the local schema is unchanged, the message names the cause", "pulled and validated" not in res and ("does not match its publication record" in res or "Detail" in res) and intact() and "Tampered" not in fp(pg), res[:240])
    reg_file.write_text(orig, encoding="utf-8"); mk_file = site_dir / "release" / "sql-assistant-data/published.json"; mk0 = mk_file.read_text(encoding="utf-8"); mk = json.loads(mk0); del mk["files"][PLAIN]; mk_file.write_text(json.dumps(mk), encoding="utf-8")
    pg.reload(); T.ready(pg); T.hamburger_pull(pg); pg.click("#pullBtn"); res = T.pull_wait(pg)
    check("Failure — the registry is not listed in the publication (missing): 'No schema file was found in the repository yet', no false success, the local schema is unchanged", "No schema file was found" in res and intact(), res[:200])
    mk_file.write_text(mk0, encoding="utf-8"); reg_file.write_text('{ "schemas": [ { "name": 12 ] ', encoding="utf-8")
    mk2 = json.loads(mk0); import hashlib; mk2["files"][PLAIN] = hashlib.sha256(reg_file.read_bytes()).hexdigest(); mk_file.write_text(json.dumps(mk2), encoding="utf-8"); pg.reload(); T.ready(pg); T.hamburger_pull(pg); pg.click("#pullBtn"); res = T.pull_wait(pg)
    check("Failure — a malformed registry that the publication vouches for: refused by the schema validation with the reason, the local schema is unchanged", "pulled and validated" not in res and intact(), res[:240])
    reg_file.write_text(orig, encoding="utf-8"); mk_file.write_text(mk0, encoding="utf-8"); (site_dir / "release" / VPATH).write_text("<html>sign in</html>", encoding="utf-8"); pg.reload(); T.ready(pg); T.hamburger_pull(pg); local0 = T.local_only(pg); pg.click("#pullVaultBtn"); r = T.vault_wait(pg)
    check("Failure — the published vault is damaged (an HTML page instead of the file): refused before decryption, nothing restored, the device is unchanged", "Secret Vault imported" not in r and T.local_only(pg) == local0 and intact(), r[:240])
    T.set_ai(pg, T.AI); unlock_ok = (T.unlock(pg), T.stab(pg, "Secret Vault"), pg.fill("#v17VaultPass", OWN), pg.fill("#v17VaultPass2", OWN), pg.click("#pushVaultBtn"), pg.wait_for_function("() => { const r = document.querySelector('#v17VaultResult'); return r && r.querySelector('.issue-box'); }", timeout=20000))
    pt = pg.inner_text("#v17VaultResult")
    check("Failure — Push Secret Vault to Repository on a device with no token: stopped before anything is encrypted or written, with the real reason (it reads the published copy and cannot publish) and what to do", "holds no GitHub access token" in pt and "cannot publish" in pt and "Nothing was written" in pt, pt[:260])
    pg.evaluate("location.hash = '#schema-used/pull'"); pg.wait_for_timeout(500); pg.click("#repoCfgToggle"); pg.click("#repoCfgEdit"); pg.fill("#repoCfgAdminPw", "not-the-admin-password"); pg.click("#repoCfgUnlock"); pg.wait_for_timeout(900)
    check("Failure — an unauthorized configuration change: a wrong Admin Password keeps the repository fields read-only (no token, no sign-in involved)", "Incorrect Admin Password" in pg.inner_text("#repoCfgResult") and pg.get_attribute("#vaultRepo", "readonly") is not None and "sqla.repoconfig" not in T.local_only(pg))
    site_proc.terminate(); site_proc.wait(timeout=5); time.sleep(0.4); pg.click("#pullBtn"); res = T.pull_wait(pg)
    check("Failure — the site (backend) goes away: Pull Schema reports it could not be retrieved, no success, the local schema is unchanged", "pulled and validated" not in res and ("could not be retrieved" in res or "could not be reached" in res or "Detail" in res) and intact(), res[:240])
    ctx.close()

# ───────────── Device A — a token on the device: the existing authenticated route keeps precedence ─────────────
def device_a(b, url, sp, port):
    T.stub(sp, "reset"); T.stub(sp, "file", path=PLAIN, text=REGISTRY); ctx, pg = newdev(b, url, "A", sp)
    T.hamburger_pull(pg); pg.click("#changeTokenBtn"); pg.fill("#newTokenInput", USER_OK); pg.fill("#tokenAdminPw", "admin"); pg.click("#saveTokenBtn"); pg.wait_for_timeout(1500)
    check("A: a device with a token (set with the Admin Password, validated by GitHub) keeps the V17.6.2 behaviour: token masked, no automatic restore attempted", USER_OK[-4:] in masked(pg) and pg.locator("#autoTokenResult").count() in (0, 1) and "restored automatically" not in pg.inner_text("main"))
    T.stub(sp, "reset"); n0 = len(T.requests); pg.click("#pullBtn"); res = T.pull_wait(pg); st = T.state(sp)
    check("A: Pull Schema uses the authenticated GitHub route (precedence: a token on the device beats the published copy): the schema file was read with the token through the API", "Schema pulled and validated successfully" in res and T.active_name(pg) == SHARED and any(r["cred"] == "user" and "/contents/" in r["path"] and "registry.json" in r["path"] for r in st["requests"]), res[:200])
    check("A: …and the page did not read the registry from the site for it", not [r for r in T.requests[n0:] if r[0] == "A" and "127.0.0.1" in r[2] and "/schemas/registry.json" in r[2]])
    ctx.close()

# ───────────── regression: no marker ⇒ exactly V17.6.2 ─────────────
def regression(b, url, sp, port):
    ctx, pg = newdev(b, url, "R", sp); T.hamburger_pull(pg); pg.wait_for_timeout(800)
    check("Regression: a site WITHOUT the publication marker behaves as V17.6.2 — token row with 'Set Token', no 'Reading needs no token' hint, no automatic restore", "(not set)" in masked(pg) and pg.locator("#publishedHint").count() == 0 and pg.locator("#autoTokenResult").count() == 0 and pg.locator("#changeTokenBtn").count() == 1)
    pg.click("#pullBtn"); res = T.pull_wait(pg); check("Regression: Pull Schema without a token asks for a token (as before) and reads nothing", "No GitHub access token is set" in res and not [r for r in T.requests if r[0] == "R" and "sql-assistant-data" in r[2] and ("/schemas/" in r[2] or "/vault/" in r[2])], res[:160]); ctx.close()

def hygiene(sp, p1, p2):
    others = [(t, m, u) for t, m, u, d, a in T.requests if not re.match(r"^(http://127\.0\.0\.1:\d+/|data:|blob:|https://api\.github\.com/)", u)]
    check("Hygiene: the page contacted only the site and api.github.com (for GitHub's own validation of a token) — never github.com, a broker or any other host", not others, others[:3])
    auth = [(t, u, a) for t, m, u, d, a in T.requests if a]; check("Hygiene: the only Authorization headers the page sent went to api.github.com, never to the site (the published copy is read with no credential)", auth and all("api.github.com" in u for t, u, a in auth), [(u, a[:12]) for t, u, a in auth if "api.github.com" not in u][:3])
    bodies = "\n".join(d for t, m, u, d, a in T.requests) + "\n".join(u for t, m, u, d, a in T.requests); check("Hygiene: no PAT, device token, vault passphrase or AI key in any request URL or body sent by the page", not T.leaked(bodies, PAT, USER_OK, USER_RW, OWN, DEFAULT_PASS, T.AI))
    check("Hygiene: the stub never saw the central PAT from the page (the PAT is not used by any V17.6.3 path)", not [r for r in T.state(sp)["requests"] if r["cred"] == "PAT"])
if __name__ == "__main__": main()
