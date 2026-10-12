### Test report — SQL Assistant 17.6.3

All results were produced in this build environment on the final source (`node` / `python3` run directly because `npm` cannot reach the registry; the gates and their order are those of `npm run verify`).

| Gate | Result |
|---|---|
| Baseline V17.6.2 built and tested **unchanged first** | 155 / 155 Node tests, type check, build — green |
| TypeScript (`tsc --noEmit`, strict; TypeScript 6.0.2 needs `--ignoreDeprecations 6.0` for the unchanged `moduleResolution: node`) | **0 errors** |
| Lint (86 files, import cycles) · Security check (`src/` and `dist/index.html`) | **passed** · **passed** |
| Production and `--dev` builds | **succeeded** — SQL Assistant 17.6.3 |
| Node tests (`test/*.test.mjs`) | **167 / 167** — 12 new (`v1763.test.mjs`) |
| Browser — **V17.6.3** (`browser_test_v1763.py`: Device A / B / C, 9 failure scenarios, regression, hygiene) | **33 / 33** |
| Browser — earlier suites on the V17.6.3 build: V17.6.2 / V17.6.1 / V17.5.7 / V17.5.5 / V17.5.4 / V17.5.2 / V17.5.1 / V17.5 / V17.4 / base | **63/63 · 57/57 · 112/112 · 75/75 · 47/47 · 89/89 · 59/59 · 84/84 · 120/120 · 56/56** |
| UI comparison with the V17.6.2 build (`compare_v1763.py`, 16 pages × 2 widths) | **33 / 33** — style sheet byte-identical; **15 pages identical** (including Schema → Pull Schema and Settings → Secret Vault without a marker); only *About* changed (1 list entry) |
| Console errors / unhandled exceptions in any V17.6.3 flow | **none** (expected network-status lines of the failure scenarios excluded) |

#### Scenarios (what the new tests prove)
* **Publication (real scripts):** `build-central-vault` seals the read-only token into the standard envelope (the app opens it); `publish-data` mirrors only allowed files, writes the marker last with correct SHA-256, never copies `*.config.json`, dot-files, symlinks or non-JSON, refuses a file containing a token / private key (run fails, nothing written, message free of content), removes files that left the repository, leaves administrator-placed configuration alone and is idempotent; `build.mjs` keeps `dist/sql-assistant-data/**`.
* **Device B** (clean Chromium context, nothing saved, **no token**): three cards in order; the token is **restored automatically** from the published central vault — masked, stored only as ciphertext, in no page text / storage / console, sent only to api.github.com (GitHub's own validation), never to the site; *Pull Schema* succeeds and activates the shared schema with no passphrase; Settings → Secret Vault has no repository card, keeps Push, explains the published copy; Schema Management has no passphrase card.
* **Device C** (clean context, central vault under its **own** passphrase): automatic restore does not guess and says what to do; **Pull Schema works with no token and no request to GitHub at all**; Pull Secret Vault with the pre-filled default is refused ("passphrase is wrong", device unchanged), with the right passphrase it restores the token from the published copy (read-only, no write seen).
* **Device A** (token on the device): the authenticated GitHub route keeps precedence — the registry is read through the API with the token and **not** from the site.
* **Failures** (each: real cause shown, local data unchanged, no secret in the message): published registry that does not match its record · registry not listed · malformed registry the publication vouches for · damaged vault (HTML instead of the file) · Push with no token · wrong Admin Password on the configuration card · site goes away; plus (Node) listed-but-unserved file, site sign-in required (401), network / timeout, vault refusal reasons, wrong vault passphrase, a read-write or rejected or SSO-blocked central token.
* **Regression:** a site without a marker behaves exactly as V17.6.2 (Set Token row, no hint, no automatic restore; Pull Schema asks for a token).
* **Hygiene:** the page contacted only the site and api.github.com; the only `Authorization` headers went to api.github.com; no PAT, device token, vault passphrase or AI key in any request URL / body, storage, console or the bundle; the PAT is used by no V17.6.3 path.

#### What was real and what was emulated (read this before relying on the numbers)
* **Real:** the production page in real Chromium (separate contexts as "devices": no shared localStorage / IndexedDB / cookies) against real static servers (`scripts/serve.mjs`); `scripts/publish-data.mjs` and `scripts/build-central-vault.mjs` run as separate processes; the application's own client, vault and crypto.
* **Emulated (no network access to github.com here):** GitHub's REST API — `test/support/github-stub.mjs` (private repository, read-only and writer tokens, 401 / 403 / 404), reached through Playwright's network routing for `https://api.github.com`.
* **Not tested:** github.com itself, **a GitHub Actions run** (the workflows are validated YAML plus source tests; `publish-data.yml` was not executed), the zone platform (how `dist/` is served, republished and protected), branch protection on `main`, SAML SSO, two physical machines. The request asks to test "against real GitHub if reachable" — **it was not reachable.** Run the checks in `PUBLISHED_DATA.md` §3 on your real systems before relying on it.
