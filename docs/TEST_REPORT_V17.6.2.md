### Test report — SQL Assistant 17.6.2

All results were produced in this build environment on the final source (`node` / `python3` run directly because `npm` cannot reach the registry; the gates and their order are those of `npm run verify`).

| Gate | Result |
|---|---|
| TypeScript (`tsc --noEmit`, strict; TypeScript 6.0.2 needs `--ignoreDeprecations 6.0` for the unchanged `moduleResolution: node`) | **0 errors** |
| Lint (85 files, import cycles) | **passed** |
| Security check (`src/` and `dist/index.html`: no credential, no console output, no dynamic code, CSP, only GitHub / configured endpoints) | **passed** |
| Production build (`dist/index.html`, `index.html`, `release/`) and `--dev` build | **succeeded** — 757 KB, SQL Assistant 17.6.2 |
| Node tests (`test/*.test.mjs`) | **155 / 155** — 23 of them new (`v1762.test.mjs`: the broker as a real HTTP server, the client, vault, workflows, source/bundle guarantees) |
| Browser — **V17.6.2** (`browser_test_v1762.py`: Device A, Device B, 11 failure scenarios, regression, hygiene) | **63 / 63** |
| Browser — earlier suites on the V17.6.2 build: V17.6.1 / V17.5.7 / V17.5.5 / V17.5.4 / V17.5.2 / V17.5.1 / V17.5 / V17.4 / base | **57/57 · 112/112 · 75/75 · 47/47 · 89/89 · 59/59 · 84/84 · 120/120 · 56/56** |
| UI comparison with the last-known-good V17.6.1 build (`compare_v1762.py`, 16 pages × 2 widths) | **33 / 33** — style sheet byte-identical; 14 pages identical (navbar, page, footer); *About* (2 lines) and *Schema → Pull Schema* (3 lines) changed as intended |
| Console errors / unhandled exceptions in any V17.6.2 flow | **none** (expected network-status lines of the failure scenarios excluded) |

#### Acceptance scenarios (section 7 of the request)
* **Device A** (separate Chromium context, GitHub account with write access): three cards in order; repository read-only by default; wrong Admin Password refused, correct one unlocks, invalid value refused with the old configuration kept; *Pull Schema* with no session starts the sign-in (code + real github.com address + Cancel), continues by itself, applies the schema; second pull reuses the session (no new device code); *Check central access* reports the PAT state; Settings → Secret Vault has no repository card, *Push Secret Vault to Repository* works (written by the broker with the PAT, read back, ciphertext only, commit names the user); Settings → Schema Management has no passphrase card.
* **Device B** (clean context, **read-only** GitHub account, nothing saved): administrator screen works with no token; *Retrieve from Repository* signs in by itself; a wrong passphrase is refused and nothing changes (no second sign-in when corrected); the right passphrase restores the vault; *Pull Schema* works with the same session; *Push* is refused with the reason and the repository is unchanged. No token was copied; no GitHub token of any kind exists on the device.
* **Failures** (each: real cause shown, local data unchanged, no secret in the message): PAT invalid / expired / revoked · PAT lacking privileges or repository invisible · rate limit · PAT secret missing (service deployed without it) · GitHub unreachable · service down · missing registry · malformed registry · missing vault · corrupted vault (4 kinds) · wrong vault passphrase · expired session → new sign-in · sign-in cancelled / denied · account without repository access (no session) · unauthorized configuration change.
* **Hygiene:** the page never contacted github.com; the only `Authorization` header it ever sent is the broker session; no PAT, user token, device code, passphrase or AI key in any request URL/body, console message, storage or the compiled bundle.

#### What was real and what was emulated (read this before relying on the numbers)
* **Real:** the production page on a real static server; **`server/repo-broker.mjs` as a separate process** with real HTTP and real CORS from the page's origin; the application's own client, vault and crypto; separate Chromium contexts as "devices" (no shared localStorage / sessionStorage / IndexedDB / cookies).
* **Emulated (no network access to github.com here):** `test/support/github-stub.mjs` — a separate process modelling a private repository, a fine-grained PAT, the device flow, GitHub-App user tokens, contents / blobs / branches / collaborators and 401 / 403 / 404 / 409 answers.
* **Not tested:** github.com itself, a real GitHub App, SAML SSO, the Azure deployment steps (`deploy-broker.yml` is validated YAML and source-tested but **was not executed**), the real format of GitHub's token-expiry header, two physical machines. The request asks to test "actual repository access … not only mocked responses" — **that could not be done here.** Run the 5-minute check in `CENTRAL_PAT.md` on your real systems before relying on it.
