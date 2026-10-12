"""SQL Assistant V17.6.1 — real-browser tests of SECRET VAULT RECOVERY WITHOUT A PRE-EXISTING GITHUB TOKEN (GitHub sign-in bootstrap) on the PRODUCTION build (Chromium / Playwright).
   npm run build && python3 scripts/browser_test_v1761.py        (CHROME_PATH=/path/to/chrome to use an installed browser)

What is real: the production page served by a real static server (scripts/serve.mjs, as GitHub Pages would), a REAL RUN of scripts/github-device-relay.mjs (separate process, real HTTP, real CORS preflight from the page's origin),
the application's own device-flow client, GitHub client, crypto and vault code. Every browser profile ("device") is a separate Chromium context: no shared localStorage, no IndexedDB (so no device key), no cookies.
What is emulated (this environment has no network access to github.com): github.com's device endpoints (a local stub that answers /login/device/code and /login/oauth/access_token; the user's approval on github.com is a call
made by the test while the page waits) and the GitHub REST API (private repository, Bearer auth, 401 / 403 / 404, read-only and no-access tokens — browser_test_v1757.Hub7). Nothing reaches github.com.
The encrypted vault file is produced by the application's own "Push Secret Vault to Repository" on device A with an administrator-chosen passphrase, exactly as in production.
Covers: scenarios A–F of the V17.6.1 request."""
import urllib.parse, json, os, re, sys, time, subprocess, pathlib, shutil, tempfile, threading, base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import browser_test_v1757 as V7
T = V7.T; B = V7.B
from playwright.sync_api import sync_playwright
ROOT = B.ROOT; check, section, newdev, configure, go, stab, unlock = B.check, B.section, B.newdev, B.configure, B.go, B.stab, B.unlock
TOK_A, TOK_B, CUSTOM, DEFAULT_PASS, VPATH, PLAIN, DEF = V7.TOK_A, V7.TOK_B, V7.CUSTOM, V7.DEFAULT_PASS, V7.VPATH, B.PLAIN, V7.DEF
SIGNIN = "ghu_" + "Si1Gn2In3To4Ke5Nn6Aa7Bb8Cc9Dd0Ee1Ff2"; SIGNIN_NA = "ghu_" + "Nn1Oo2Aa3Cc4Cc5Ee6Ss7Ss8Dd9Ee0Nn1Ii2"; SIGNIN_OLD = "ghu_" + "Oo1Ll2Dd3Ee4Xx5Pp6Ii7Rr8Ee9Dd0Tt1Oo2Kk3"
CLIENT = "Iv1.0123456789abcdef"; USERCODE = "WDJB-MJHT"; SCHEMA_NAME = "Shared AP Schema"; HTML = (ROOT / "dist/index.html").read_text(encoding="utf-8")
CFG_PATH = "sql-assistant-data/vault-bootstrap.config.json"
SECRETS = [TOK_A, TOK_B, SIGNIN, SIGNIN_NA, SIGNIN_OLD, CUSTOM]

class GitHubDevice(BaseHTTPRequestHandler):
    """Local stand-in for github.com/login/device/code and /login/oauth/access_token."""
    st = {"mode": "pending", "approved": False, "issue": SIGNIN, "code_calls": 0, "token_calls": 0, "bodies": [], "device": "dc_" + "q" * 32}
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get("content-length", 0)); body = dict(urllib.parse.parse_qsl(self.rfile.read(n).decode())); S = self.st; S["bodies"].append((self.path, body)); out = {}
        if self.path == "/login/device/code":
            S["code_calls"] += 1; S["device"] = f"dc_{S['code_calls']:03d}" + "q" * 28
            out = {"device_code": S["device"], "user_code": USERCODE, "verification_uri": "https://github.com/login/device", "expires_in": 900, "interval": 1} if body.get("client_id") == CLIENT else {"error": "incorrect_client_credentials"}
        elif self.path == "/login/oauth/access_token":
            S["token_calls"] += 1
            if body.get("device_code") != S["device"] or body.get("grant_type") != "urn:ietf:params:oauth:grant-type:device_code": out = {"error": "bad_verification_code"}
            elif S["mode"] == "deny": out = {"error": "access_denied"}
            elif S["mode"] == "expire": out = {"error": "expired_token"}
            elif S["approved"]: out = {"access_token": S["issue"], "token_type": "bearer", "scope": "", "refresh_token": "ghr_" + "r" * 30, "expires_in": 28800}
            else: out = {"error": "authorization_pending"}
        b = json.dumps(out).encode(); self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
def reset_stub(**kw): GitHubDevice.st.update({"mode": "pending", "approved": False, "issue": SIGNIN, "code_calls": 0, "token_calls": 0, "bodies": []}); GitHubDevice.st.update(kw)
def approve(): GitHubDevice.st["approved"] = True

class Hub61(V7.Hub7):
    """Hub7 + the sign-in tokens, a token that authenticates but cannot see the repository, and a record of which token made which request."""
    def __init__(self): super().__init__(); self.valid |= {SIGNIN, SIGNIN_NA, TOK_B}; self.noaccess = {SIGNIN_NA}; self.used = []
    def handler(self, route):
        req = route.request; tok = req.headers.get("authorization", "").replace("Bearer ", ""); self.used.append((req.method, req.url, tok))
        if req.method != "OPTIONS" and tok in self.noaccess and f"/repos/{DEF}" in req.url:
            self.urls.append((req.method, req.url)); self.log.append((req.method, DEF, "repo", "", "auth")); return route.fulfill(status=404, headers={"access-control-allow-origin": "*", "content-type": "application/json"}, body=json.dumps({"message": "Not Found"}))
        return super().handler(route)

def tmp_site(cfg):
    d = pathlib.Path(tempfile.mkdtemp(prefix="sqla-site-")); shutil.copytree(ROOT / "release", d / "release"); (d / "scripts").mkdir(); shutil.copy(ROOT / "scripts/serve.mjs", d / "scripts/serve.mjs")
    if cfg is not None: data = d / "release/sql-assistant-data"; data.mkdir(parents=True, exist_ok=True); (data / "vault-bootstrap.config.json").write_text(cfg if isinstance(cfg, str) else json.dumps(cfg), encoding="utf-8")
    return d
def serve_site(d, port): p = subprocess.Popen(["node", str(d / "scripts/serve.mjs")], env={**os.environ, "PORT": str(port), "BASE": "/"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.9); return p
def cfg_for(relay_port): return {"githubSignIn": {"enabled": True, "clientId": CLIENT, "relayUrl": f"http://127.0.0.1:{relay_port}"}}

def track(pg, rec):
    pg.on("request", lambda r: rec.append((r.method, r.url, r.post_data or "", r.headers.get("authorization", ""))))
def storage(pg): return V7.storage(pg)
def blob(pg): return pg.evaluate("() => localStorage.getItem('sqla.vault.local.v17')")
def masked(pg): return pg.inner_text("#maskedToken")
def set_pass(pg, p): pg.evaluate("(p) => { document.querySelector('#v17VaultPass').value = p; }", p)
def final(pg, timeout=45000):
    pg.wait_for_function("() => { const r = document.querySelector('#v17VaultResult'); return r && r.innerText.trim() && !/Retrieving and decrypting|Authorize on GitHub|Signed in\\. Reading/.test(r.innerText); }", timeout=timeout); pg.wait_for_timeout(300); return pg.inner_text("#v17VaultResult")
def wait_box(pg): pg.wait_for_selector("#bootstrapUserCode", timeout=20000); return pg.inner_text("#v17VaultResult")
def leaked(text, *s): return any(x and x in text for x in s)
def import_file(pg, path): pg.set_input_files("#importVaultFile", str(path)); return T.vault_result(pg)

# ───────────────────────────── setup: device A configures, pushes the vault (own passphrase) and publishes a schema ─────────────────────────────
def make_vault(b, url, st):
    hub = Hub61(); A, a = newdev(b, url, hub, tag="deviceA"); configure(a, TOK_A); V7.make_schema(a, SCHEMA_NAME); schema = V7.publish_schema(a, hub); T.hamburger_pull(a); mask_a = masked(a); res = V7.push_vault(a, CUSTOM); vf = hub.get(VPATH) or ""
    check("Setup (device A): the existing workflow — token validated by GitHub, saved in the Secret Vault (encrypted), schema published, Push Secret Vault to Repository with the administrator's own passphrase (read-back verified)", "5 Synchronization confirmed" in res and bool(vf) and bool(schema) and TOK_A[-4:] in mask_a, res[:200])
    j = json.loads(vf or "{}"); check("Setup: the repository holds ONLY the encrypted envelope (AES-256-GCM / PBKDF2) — no token, no passphrase (own or default), no Base64 token", sorted(j) == sorted(["v", "alg", "kdf", "iter", "salt", "iv", "ct"]) and not leaked(vf, TOK_A, CUSTOM, DEFAULT_PASS, base64.b64encode(TOK_A.encode()).decode()))
    A.close(); st.update(vault=vf, schema=schema, mask_a=mask_a)
def fresh_hub(st, **kw):
    hub = Hub61(); hub.put(PLAIN, st["schema"]); hub.put(VPATH, st["vault"]); return hub

# ───────────────────────────── A. existing authorized browser ─────────────────────────────
def scenario_a(b, url, st, relay_calls):
    hub = fresh_hub(st); ctx, pg = newdev(b, url, hub, tag="A-authorized"); configure(pg, TOK_B); T.hamburger_pull(pg); m0 = masked(pg); reset_stub(); hub.clear(); set_pass(pg, CUSTOM); pg.click("#pullVaultBtn"); r = T.vault_result(pg)
    check("A: a device that already has a valid token uses the existing authenticated repository access — no sign-in is started, no relay or github.com device request is made", "Secret Vault imported and validated" in r and GitHubDevice.st["code_calls"] == 0 and "Authorize on GitHub" not in r and pg.locator("#bootstrapUserCode").count() == 0, r[:200])
    check("A: retrieval, decryption, validation and restoration worked: the token from the vault replaced the device's own (validated by GitHub first), source stated, repository only READ", TOK_A[-4:] in masked(pg) and masked(pg) != m0 and "read with the access token saved on this device" in r and not hub.writes() and {l[3] for l in hub.reads(DEF)} == {VPATH} and all(l[4] == "auth" for l in hub.reads(DEF)), (masked(pg), r[:240]))
    hub.clear(); t = V7.pull_click(pg)
    check("A: the existing Pull Schema operation still works on its own with the restored token (authenticated), device A's schema arrives", "Schema pulled and validated successfully" in t and B.active_name(pg) == SCHEMA_NAME and all(l[4] == "auth" for l in hub.log), t[:200]); ctx.close()

# ───────────────────────────── B. clean profile: the sign-in bootstrap ─────────────────────────────
def scenario_b(b, url, st, relay_calls):
    hub = fresh_hub(st); ctx, pg = newdev(b, url, hub, tag="B-clean"); rec = []; track(pg, rec); T.hamburger_pull(pg); s0 = storage(pg); reset_stub()
    check("B: a clean profile — no token, no saved vault, no device key, nothing from device A; the passphrase field is masked and pre-filled with the unchanged default, still editable", "(not set)" in masked(pg) and blob(pg) is None and TOK_A not in s0 and pg.get_attribute("#v17VaultPass", "type") == "password" and pg.input_value("#v17VaultPass") == DEFAULT_PASS and pg.locator("#pullVaultBtn, #importVaultFile, #pullBtn, #repoCfgToggle, #changeTokenBtn").count() == 5)
    set_pass(pg, CUSTOM); hub.clear(); pg.click("#pullVaultBtn"); box = wait_box(pg)
    check("B: 'Retrieve from Repository' with no token first tries what needs no sign-in (an anonymous read — GitHub answers 'not found' for the private repository), then asks the user to authorize on github.com: the card shows the user code and the real github.com address, with Cancel", USERCODE in box and "github.com/login/device" in box and "Authorize on GitHub" in box and pg.locator("#bootstrapCancel").count() == 1 and pg.get_attribute("#v17VaultResult a", "href") == "https://github.com/login/device" and pg.get_attribute("#v17VaultResult a", "rel") == "noopener noreferrer" and all(l[4] == "anon" for l in hub.log), (box[:300], hub.log))
    check("B: while it waits NOTHING is authorized: no authenticated GitHub request, no write, nothing stored, the vault is not read, and the passphrase / token / device code are not shown", not any(l[4] == "auth" for l in hub.log) and not hub.writes() and storage(pg) == s0 and not leaked(box, CUSTOM, TOK_A, GitHubDevice.st["device"]), hub.log)
    check("B: the page asked the real relay (real HTTP, CORS preflight from the page's origin) for a code with ONLY the public client ID — no secret, no credential", GitHubDevice.st["code_calls"] == 1 and GitHubDevice.st["bodies"][0] == ("/login/device/code", {"client_id": CLIENT}), GitHubDevice.st["bodies"])
    approve(); r = final(pg)    # the user approves on github.com in another tab; the page continues by itself
    check("B: after approval the page continues by itself: the encrypted vault is read with the short-lived sign-in, decrypted with the passphrase, validated (GitHub is asked about the restored token) and restored — 'Secret Vault imported and validated'", "Secret Vault imported and validated" in r and "GitHub access token was saved on this device (stored encrypted)" in r and "can read and write the repository" in r, r[:300])
    reads = [u for m, u, t in hub.used if m == "GET" and "/contents/" in u and t == SIGNIN]
    check("B: the sign-in token was used for exactly ONE thing — a Contents read of the vault file; never to write, never for another file", len(reads) == 1 and reads[0].split("/contents/")[1].split("?")[0] == VPATH and not hub.writes() and not any(t == SIGNIN and m != "GET" for m, u, t in hub.used), reads)
    check("B: the result names the source (the user's GitHub sign-in, kept in memory only) — success was reported only after the restore completed (the token is already in the device vault)", "GitHub sign-in" in r and "not saved" in r and TOK_A[-4:] in masked(pg) and blob(pg) is not None)
    check("B: the restored token is held only as ciphertext (shown masked as in V17.5.7); the sign-in token, the device code, the passphrase and the vault token are in no page text, markup, browser storage, console message, request URL or request body to anything but the relay / api.github.com", not leaked(pg.inner_text("body") + pg.evaluate("() => document.querySelector('#app').outerHTML") + storage(pg), SIGNIN, CUSTOM, TOK_A, GitHubDevice.st["device"]) and not any(leaked(u, *SECRETS, GitHubDevice.st["device"]) for m, u, d, a in rec) and not leaked(" ".join(B.console_all), SIGNIN, CUSTOM, TOK_A, TOK_B) and not any(leaked(d, CUSTOM, TOK_A) for m, u, d, a in rec))
    check("B: the sign-in token went only to api.github.com (as a Bearer header); the relay received only the client ID and the device code (never a token, never the passphrase)", all((SIGNIN in a) <= ("api.github.com" in u) for m, u, d, a in rec) and all(("127.0.0.1" not in u) or (not leaked(d, SIGNIN, CUSTOM, TOK_A) and not leaked(a, SIGNIN, TOK_A)) for m, u, d, a in rec) and GitHubDevice.st["token_calls"] >= 1, GitHubDevice.st["bodies"][:3])
    check("B: the repository configuration card stayed hidden and read-only; nothing in the configuration was changed by the recovery", not pg.is_visible("#vaultRepo") and "sqla.repoconfig" not in storage(pg))
    hub.clear(); n_used = len(hub.used); t = V7.pull_click(pg)
    check("B: authorized schema synchronization then works on this profile with the RESTORED token (Bearer TOK_A, not the sign-in token) — no token was ever typed here", "Schema pulled and validated successfully" in t and B.active_name(pg) == SCHEMA_NAME and [tk for m, u, tk in hub.used[n_used:] if m == "GET" and "/contents/" in u and tk] and all(tk == TOK_A for m, u, tk in hub.used[n_used:] if m == "GET" and "/contents/" in u and tk), t[:200])
    pg.reload(); B.ready(pg); T.hamburger_pull(pg); hub.clear(); t = V7.pull_click(pg)
    check("B: after a reload of the same profile the restored token is still there and Pull Schema still works (the existing device-key persistence — nothing more is claimed)", TOK_A[-4:] in masked(pg) and ("Schema pulled" in t or "No schema content needed to change" in t) and bool(hub.log), (masked(pg), t[:120]))
    hub.clear(); res = V7.push_vault(pg, CUSTOM)
    check("B: Push Secret Vault to Repository works with the restored token (one verified write of the one vault file) — recovery and push stay separate operations", "5 Synchronization confirmed" in res and len(hub.writes(DEF)) == 1 and all(l[3] == VPATH for l in hub.writes(DEF)), res[:160]); ctx.close()

# ───────────────────────────── C. incorrect passphrase ─────────────────────────────
def scenario_c(b, url, st, relay_calls):
    hub = fresh_hub(st); ctx, pg = newdev(b, url, hub, tag="C-wrong-pass"); T.hamburger_pull(pg); s0 = storage(pg); reset_stub(); set_pass(pg, DEFAULT_PASS); pg.click("#pullVaultBtn"); wait_box(pg); approve(); r = final(pg)
    check("C: the pre-filled default passphrase does not open a vault pushed with another — decryption fails SAFELY: a clear message saying what to enter, no other passphrase tried, nothing stored, the passphrase is not echoed, the field is selected for correction", "passphrase is wrong" in r and "pushed with" in r and "No other passphrase was tried" in r and storage(pg) == s0 and not leaked(r, CUSTOM, DEFAULT_PASS, TOK_A) and pg.evaluate("() => document.activeElement && document.activeElement.id") == "v17VaultPass", r[:300])
    check("C: the message says the vault was already retrieved — correcting the passphrase does not require signing in again (ciphertext only is kept in memory)", "will not be asked to sign in again" in r)
    codes = GitHubDevice.st["code_calls"]; hub.clear(); set_pass(pg, CUSTOM); pg.click("#pullVaultBtn"); r2 = T.vault_result(pg)
    check("C: with the corrected passphrase the same vault is opened without a second sign-in (no new device code, no new GitHub read) and restored", "Secret Vault imported and validated" in r2 and GitHubDevice.st["code_calls"] == codes and TOK_A[-4:] in masked(pg) and not hub.reads(DEF, "contents"), (r2[:160], hub.log)); ctx.close()
    hub = fresh_hub(st); ctx, pg = newdev(b, url, hub, tag="C-existing"); configure(pg, TOK_B); T.hamburger_pull(pg); s1 = storage(pg); m1 = masked(pg); set_pass(pg, "a-completely-wrong-passphrase"); pg.click("#pullVaultBtn"); r = T.vault_result(pg)
    check("C: with a valid token already saved, a wrong passphrase leaves the saved token, the stored vault and every setting byte-for-byte unchanged", "passphrase is wrong" in r and storage(pg) == s1 and masked(pg) == m1 and "a-completely-wrong-passphrase" not in r, r[:200])
    set_pass(pg, "short"); pg.click("#pullVaultBtn"); r = T.vault_result(pg)
    check("C: a passphrase shorter than 10 characters is refused before anything is requested, with the cursor in the field", "at least 10 characters" in r and storage(pg) == s1 and pg.evaluate("() => document.activeElement && document.activeElement.id") == "v17VaultPass"); ctx.close()

# ───────────────────────────── D. repository access failures ─────────────────────────────
def scenario_d(b, url, url_nocfg, url_badcfg, url_dead, st, relay_calls):
    # D1: no token, sign-in NOT enabled — told honestly, no bypass, no success
    hub = fresh_hub(st); ctx, pg = newdev(b, url_nocfg, hub, tag="D-nocfg"); T.hamburger_pull(pg); s0 = storage(pg); reset_stub(); set_pass(pg, CUSTOM); hub.clear(); pg.click("#pullVaultBtn"); r = T.vault_result(pg)
    check("D (missing token, sign-in not enabled): the card says GitHub hides a private repository from anonymous requests and that the passphrase does not authenticate to GitHub; names Import encrypted file and the administrator's GitHub sign-in; no success, nothing changed, no github.com request", "does not authenticate to GitHub" in r and "Import encrypted file" in r and "GitHub sign-in" in r and "imported" not in r.lower().replace("import encrypted file", "") and storage(pg) == s0 and all(l[4] == "anon" for l in hub.log) and GitHubDevice.st["code_calls"] == 0 and not leaked(r, CUSTOM, TOK_A), r[:300])
    check("D: security is not bypassed — only an anonymous read was attempted (answered 404 by the private repository), no credential was invented, nothing written", bool(hub.log) and not hub.writes() and not any(t for m, u, t in hub.used))
    ctx.close()
    # D2: invalid configuration is reported, not ignored
    hub = fresh_hub(st); ctx, pg = newdev(b, url_badcfg, hub, tag="D-badcfg"); T.hamburger_pull(pg); set_pass(pg, CUSTOM); pg.click("#pullVaultBtn"); r = T.vault_result(pg)
    check("D (misconfigured sign-in): the problem is reported to the user with what the administrator must correct; nothing changed; no request to any relay", "configured incorrectly" in r and "vault-bootstrap.config.json" in r and blob(pg) is None and GitHubDevice.st["code_calls"] == 0, r[:300]); ctx.close()
    # D3: relay unreachable
    hub = fresh_hub(st); ctx, pg = newdev(b, url_dead, hub, tag="D-dead"); T.hamburger_pull(pg); s0 = storage(pg); set_pass(pg, CUSTOM); pg.click("#pullVaultBtn"); r = T.vault_result(pg)
    check("D (network failure): an unreachable sign-in service is reported with the way out (Import encrypted file); nothing changed; no success", "could not be reached" in r and "Import encrypted file" in r and storage(pg) == s0 and "imported" not in r.lower().replace("import encrypted file", ""), r[:260]); ctx.close()
    # D4: denied / expired / cancelled
    for mode, text, label in [("deny", "was not approved", "the user denies the sign-in on github.com"), ("expire", "code expired", "the sign-in code expires")]:
        hub = fresh_hub(st); ctx, pg = newdev(b, url, hub, tag=f"D-{mode}"); T.hamburger_pull(pg); s0 = storage(pg); reset_stub(mode=mode); set_pass(pg, CUSTOM); pg.click("#pullVaultBtn"); r = final(pg)
        check(f"D (authentication required / expires): {label} — a clear message, the way to try again, nothing changed, no success, the vault not read", text in r and "Nothing on this device was changed" in r and storage(pg) == s0 and not any(t for m, u, t in hub.used if "/contents/" in u) and "imported" not in r.lower().replace("import encrypted file", ""), r[:240]); ctx.close()
    hub = fresh_hub(st); ctx, pg = newdev(b, url, hub, tag="D-cancel"); T.hamburger_pull(pg); s0 = storage(pg); reset_stub(); set_pass(pg, CUSTOM); pg.click("#pullVaultBtn"); wait_box(pg); pg.wait_for_timeout(1300); pg.click("#bootstrapCancel"); r = final(pg); n = GitHubDevice.st["token_calls"]; pg.wait_for_timeout(2500)
    check("D: Cancel ends the sign-in at once — the message says so, nothing changed, and the page stops polling (no further request after Cancel)", "cancelled" in r.lower() and storage(pg) == s0 and GitHubDevice.st["token_calls"] <= n + 1 and not pg.locator("#bootstrapUserCode").count(), (r[:100], n, GitHubDevice.st["token_calls"])); ctx.close()
    hub = fresh_hub(st); ctx, pg = newdev(b, url, hub, tag="D-leave"); T.hamburger_pull(pg); reset_stub(); set_pass(pg, CUSTOM); pg.click("#pullVaultBtn"); wait_box(pg); pg.wait_for_timeout(1100); go(pg, "about"); pg.wait_for_timeout(1500); n = GitHubDevice.st["token_calls"]; pg.wait_for_timeout(3000)
    check("D: leaving the page ends the sign-in — the page stops polling the relay", GitHubDevice.st["token_calls"] <= n + 1, (n, GitHubDevice.st["token_calls"])); ctx.close()
    # D5: the signed-in account cannot read the repository / the authorization is rejected
    for issue, text, label in [(SIGNIN_NA, "cannot read the configured repository", "the GitHub account that signed in has no access to the private repository (not a member / SSO / App not installed)"), (SIGNIN_OLD, "no longer accepts the sign-in", "the authorization has expired / was revoked (GitHub answers 401)")]:
        hub = fresh_hub(st); ctx, pg = newdev(b, url, hub, tag="D-access"); T.hamburger_pull(pg); s0 = storage(pg); reset_stub(issue=issue); set_pass(pg, CUSTOM); pg.click("#pullVaultBtn"); wait_box(pg); approve(); r = final(pg)
        check(f"D (access): {label} → reported with who can fix it; repository permissions are not bypassed; nothing changed; no success", text in r and ("Nothing" in r or "not changed" in r) and storage(pg) == s0 and "imported" not in r.lower().replace("import encrypted file", "") and not leaked(r, issue, CUSTOM) and not hub.writes(), r[:300]); ctx.close()
    # D6: a saved token that GitHub now rejects (authentication expired) — the sign-in replaces the dependency on it
    hub = fresh_hub(st); ctx, pg = newdev(b, url, hub, tag="D-expired-saved"); configure(pg, TOK_B); T.hamburger_pull(pg); hub.valid.discard(TOK_B); reset_stub(); set_pass(pg, CUSTOM); hub.clear(); pg.click("#pullVaultBtn"); box = wait_box(pg)
    check("D (saved token expired): GitHub rejects the saved token — it does not stop at the 401: the rejection is noted and the sign-in is offered", USERCODE in box and any(l[4] == "auth" for l in hub.log)); approve(); r = final(pg)
    check("D: after the sign-in the vault's valid token replaces the rejected one (validated first) and the device works again", "Secret Vault imported and validated" in r and TOK_A[-4:] in masked(pg), r[:200]); ctx.close()

# ───────────────────────────── E. invalid or corrupted vault ─────────────────────────────
def scenario_e(b, url, st, relay_calls):
    hub = fresh_hub(st); ctx, pg = newdev(b, url, hub, tag="E-invalid"); configure(pg, TOK_B); T.hamburger_pull(pg); s0 = storage(pg); m0 = masked(pg); good = json.loads(st["vault"])
    def tam(f): j = dict(good); f(j); return json.dumps(j)
    cases = [("an HTML sign-in / error page instead of the file", "<!DOCTYPE html><html><body>Sign in to GitHub</body></html>", "web page"), ("text that is not JSON", "this is { not json", "not valid JSON"), ("JSON that is not a vault (a schema registry)", json.dumps({"formatVersion": 2, "schemas": []}), "not an encrypted SQL Assistant Secret Vault"),
             ("a vault of a newer / unknown format version", tam(lambda j: j.update(v=2)), "newer or unknown format version"), ("an unsupported algorithm", tam(lambda j: j.update(alg="AES-128-CBC")), "cannot read"), ("an incomplete envelope", tam(lambda j: j.pop("ct")), "incomplete or damaged"),
             ("an implausible key-derivation setting", tam(lambda j: j.update(iter=999999999)), "key-derivation"), ("a corrupted (tampered) ciphertext", tam(lambda j: j.update(ct=j["ct"][:-8] + "AAAAAAAA")), "passphrase is wrong")]
    for label, text, expect in cases:
        hub.put(VPATH, text); set_pass(pg, CUSTOM); pg.click("#pullVaultBtn"); r = T.vault_result(pg)
        check(f"E: {label} — refused with its own reason, before or at decryption; the existing valid token, vault and settings are byte-for-byte unchanged; no success; no secret in the message", expect.lower() in r.lower() and "nothing" in r.lower() and storage(pg) == s0 and masked(pg) == m0 and "imported and validated" not in r and not leaked(r, CUSTOM, TOK_A, TOK_B), (label, r[:240]))
    del hub.repos[DEF]["files"][VPATH]; pg.click("#pullVaultBtn"); r = T.vault_result(pg)
    check("E: the vault file is missing from the repository — 'No encrypted Secret Vault was found' (the repository and branch are fine), where to push it, nothing changed", "No encrypted Secret Vault was found" in r and "Push Secret Vault to Repository" in r and storage(pg) == s0, r[:200])
    hub.put(VPATH, tam(lambda j: j.update(v=2))); v = tmp_file(tam(lambda j: j.update(v=2))); set_pass(pg, CUSTOM); r = import_file(pg, v)
    check("E: the same refusals apply to 'Import encrypted file' (unchanged messages) — a vault of a newer version is rejected, nothing changed", "newer" in r.lower() or "no vault envelope" in r or "not an encrypted" in r or "wrong or the data" in r or "not recognised" in r or "unsupported" in r.lower(), r[:200]); check("E: …and the existing credential survived every refused vault of this scenario", storage(pg) == s0 and masked(pg) == m0); ctx.close()
def tmp_file(text): f = pathlib.Path(tempfile.mkdtemp()) / "vault.json"; f.write_text(text, encoding="utf-8"); return f

# ───────────────────────────── F. regression, build, secrecy ─────────────────────────────
def scenario_f(b, url, st, relay_calls):
    check("F: the production bundle contains no credential, no client ID, no relay address and none of this test's secrets; the default passphrase is still defined exactly once; the CSP still allows only the page's own script", not re.search(r"ghp_[A-Za-z0-9]{20}|github_pat_[A-Za-z0-9_]{20}|ghu_[A-Za-z0-9]{20}", HTML) and not any(s in HTML for s in SECRETS + [CLIENT]) and HTML.count(DEFAULT_PASS) == 1 and "script-src 'sha256-" in HTML and "unsafe-eval" not in HTML and "connect-src 'self' https:" in HTML)
    check("F: the release folder ships no configuration, no vault and no relay secret (the sign-in configuration is deployed by the administrator)", not (ROOT / "release/sql-assistant-data").exists() and "client_secret" not in (ROOT / "scripts/github-device-relay.mjs").read_text().replace("client secret", ""))
    hub = fresh_hub(st); ctx, pg = newdev(b, url, hub, tag="F"); pg.evaluate("location.hash = '#quickstart'"); pg.wait_for_timeout(300); T.hamburger_pull(pg)
    heads = pg.eval_on_selector_all("#schemaTabs .tab-panel:not([hidden]) h2", "e => e.map(x => x.innerText.trim())")
    check("F: Hamburger → Schema → Pull Schema keeps exactly the three V17.5.7 cards in the same order; one Retrieve button, one Import button; no duplicate button, no new card or setting", heads == ["GitHub repository (schema synchronization)", "Pull Schema from GitHub", "Pull Secret Vault to Repository"] and pg.locator("#pullVaultBtn, #importVaultFile, #pullBtn, #repoCfgToggle, #changeTokenBtn").count() == 5 and pg.locator("[data-v1754-vault-card] button").count() == 2, heads)
    check("F: the card explains, in one added sentence, that the passphrase does not sign you in to a private repository and where sign-in / Import come in", "does not sign you in to a private repository" in pg.inner_text("[data-v1754-vault-card]") and pg.input_value("#vaultFilePathRO") == VPATH)
    go(pg, "settings"); unlock(pg); stab(pg, "Secret Vault"); tabs = pg.locator(".tab-btn").all_inner_texts()
    check("F: Settings → Secret Vault is untouched (Push Secret Vault to Repository is the only push) and the 8 Settings tabs are unchanged", pg.locator("#pushVaultBtn").count() == 1 and tabs == ["Security", "Manual Schema Update", "Schema Management", "Secret Vault", "Synchronization", "Admin Query Library", "AI/LLM Model", "Danger Zone"], tabs)
    go(pg, "about"); about = pg.inner_text("main"); check("F: version 17.6.5 in the footer and the About page (first entry, 17.5.7 still listed)", "17.6.5" in pg.inner_text("footer") and about.index("17.6.5") < about.index("17.5.7"))
    ok = True
    for r in ["quickstart", "readonly", "cr", "schema-used", "schema-used/pull", "error-rectifier", "settings", "about"]: go(pg, r); ok = ok and pg.inner_text("main").strip() != ""
    check("F: every route renders", ok)
    go(pg, "readonly"); B.describe(pg, "top 5 vendors by total invoice amount for approved invoices in 2025", "Oracle"); s = B.sql(pg)
    check("F: SQL generation (Describe What You Need, offline NLU) is unchanged", all(x in s for x in ["SUM(INVOICE_HEADER.INVOICE_AMOUNT)", "GROUP BY VENDOR.VENDOR_NAME", "FETCH FIRST 5 ROWS ONLY"]), s[:200])
    hub2 = fresh_hub(st); c2, p2 = newdev(b, url, hub2, tag="F-import"); T.hamburger_pull(p2); f = tmp_file(st["vault"]); set_pass(p2, CUSTOM); r = import_file(p2, f)
    check("F: 'Import encrypted file' (the route that needs no sign-in at all) is unchanged: decrypt, validate with GitHub, restore", "Secret Vault imported and validated" in r and TOK_A[-4:] in masked(p2) and not leaked(r, TOK_A, CUSTOM), r[:200]); ctx.close(); c2.close()

def main():
    if not (ROOT / "dist/index.html").exists(): print("Run npm run build first."); sys.exit(2)
    app_port, relay_port, stub_port, dead_port = B.free_port(), B.free_port(), B.free_port(), B.free_port()
    stub = ThreadingHTTPServer(("127.0.0.1", stub_port), GitHubDevice); threading.Thread(target=stub.serve_forever, daemon=True).start()
    relay = subprocess.Popen(["node", str(ROOT / "scripts/github-device-relay.mjs")], env={**os.environ, "PORT": str(relay_port), "HOST": "127.0.0.1", "ALLOWED_CLIENT_IDS": CLIENT, "ALLOWED_ORIGINS": f"http://127.0.0.1:{app_port}", "GITHUB_BASE": f"http://127.0.0.1:{stub_port}"}, stdout=subprocess.PIPE, stderr=subprocess.PIPE); time.sleep(1.0)
    sites = [(tmp_site(cfg_for(relay_port)), app_port)]; nocfg_port, bad_port, dead_site_port = B.free_port(), B.free_port(), B.free_port()
    sites += [(tmp_site(None), nocfg_port), (tmp_site('{"githubSignIn": {"enabled": true, "clientId": "x", "relayUrl": "ftp://nope"}}'), bad_port), (tmp_site(cfg_for(dead_port)), dead_site_port)]
    procs = [serve_site(d, p) for d, p in sites]; st = {}; relay_calls = []
    urls = [f"http://127.0.0.1:{p}/?e2e=1" for _, p in sites]
    try:
        with sync_playwright() as p:
            exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
            section("Setup", make_vault, b, urls[0], st)
            if "vault" in st:
                section("A — existing authorized browser", scenario_a, b, urls[0], st, relay_calls); section("B — clean profile, GitHub sign-in bootstrap", scenario_b, b, urls[0], st, relay_calls); section("C — incorrect passphrase", scenario_c, b, urls[0], st, relay_calls)
                section("D — repository access failures", scenario_d, b, urls[0], urls[1], urls[2], urls[3], st, relay_calls); section("E — invalid or corrupted vault", scenario_e, b, urls[0], st, relay_calls)
            section("F — regression, build and secrecy", scenario_f, b, urls[0], st, relay_calls); b.close()
    finally:
        for pr in procs: pr.terminate()
        relay.terminate(); stub.shutdown()
        for d, _ in sites: shutil.rmtree(d, ignore_errors=True)
    try: rl = (relay.stdout.read() or b"").decode() + (relay.stderr.read() or b"").decode()
    except Exception: rl = ""
    check("The relay process printed nothing about any exchange (no code, token, client ID or address in its output)", not any(x in rl for x in SECRETS + [CLIENT, USERCODE, "dc_0"]), rl[:200])
    real = [e for e in B.errors if "Failed to load resource" not in e and "net::ERR" not in e and "Could not reach GitHub" not in e and "ERR_CONNECTION" not in e and "CORS" not in e and "Access to fetch" not in e]
    check("No console errors or uncaught exceptions in any V17.6.1 flow (expected network-status lines of the failure scenarios excluded); no secret in any console message", not real and not any(leaked(c, *SECRETS) for c in B.console_all), "; ".join(real[:4]))
    results = B.results; failed = [r for r in results if not r[1]]; print(f"\n{len(results) - len(failed)}/{len(results)} V17.6.1 browser checks passed")
    (ROOT / "test-results").mkdir(exist_ok=True); (ROOT / "test-results/browser-results-v1761.json").write_text(json.dumps([{"check": n, "pass": ok} for n, ok in results], indent=2)); sys.exit(1 if failed else 0)
if __name__ == "__main__": main()
