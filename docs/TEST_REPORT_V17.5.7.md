### Test report: SQL Assistant 17.5.7

Run on the **final** build (`build/`, `dist/`, `dev-dist/`, `release/`, `test-results/` and the root `index.html` removed first). The environment has no route to github.com or SharePoint (see *Not verifiable here*). Figures come from the run logs .

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`, strict) | **0 errors** |
| Lint (81 files, no import cycles) / Security check (`npm run security`) | passed / passed |
| Production and development builds | both complete; `dist/index.html` 679 KB, self-contained |
| Node tests (serial): V17.5.5's 102 + 13 new | **115/115**, three consecutive runs |
| Mutation checks of the new Node tests (token rejection ignored · admin check removed · imported vault path adopted · path-collision check removed) | each makes a test fail |
| Browser (real Chromium, production build): V17.3.1 (56) · V17.4 (120) · V17.5 (84) · V17.5.1 (59) · V17.5.2 (89) · V17.5.4 (47) · V17.5.5 (75) · **V17.5.7 (112, incl. the two-profile cross-device recovery)** | **all pass** |
| Side-by-side with V17.5.5 (`compare_v1755.py`, both builds, 16 pages × 1366 / 390 px) | **33/33**: style sheet byte-identical; 13 unrelated pages' markup identical; only About, Schema → Pull Schema and Settings → Secret Vault differ (as intended); navbar and footer identical everywhere |

The V17.5.4 and V17.5.5 suites were re-run once after their request-URL assertions were adjusted for the new token-validation request (a `GET /repos/{owner}/{repo}` during Save Token / import — the check now filters to Contents requests and allows that one read of the same repository); both passed (47/47, 75/75) on the unchanged build.


#### Checklist from the request
**Schema synchronization** — defaults shown (basware/sk-ap-sql-assistant · main · sql-assistant-data/schemas/registry.json) ✔ · standard users cannot edit (read-only fields; typing / Delete / fill() refused; hidden until revealed) ✔ · administrators can edit (Admin Password → unlock → validate → save; wrong / empty password refused; auto-lock) ✔ · Pull Schema card = only the button ✔ · no passphrase requested ✔ · valid remote schema synchronizes ✔ · invalid / unavailable remote (401, 403, network, timeout, 404 repository / branch, malformed, newer-format file, storage refusal) never corrupts local data ✔ (V17.5.5 suite, unchanged, plus the new suite)
**Secret Vault** — import / pull under Schema → Pull Schema ✔ · default passphrase preserved ✔ · valid vault imported and validated ✔ · **token restored on a second device through the supported recovery workflow, tested on two separate browser profiles** ✔ · token never shown (page text, markup, storage, URL, console, toast, report, error messages — tested with the real token string) ✔ · invalid credentials and decryption failures handled safely (wrong passphrase, tampered ciphertext, non-vault, damaged, empty, rejected token, malformed token) ✔ · Push only under Settings → Secret Vault ✔ · Push uses the centralized configuration (every request URL inspected against three emulated repositories) ✔ · configuration not duplicated ✔
**Regression / build** — Schema Management passphrase card removed (all 9 other controls remain) ✔ · unrelated features work ✔ · TypeScript ✔ · production build ✔ · no new console errors ✔ · desktop / 768 px / 390 px ✔ · failed synchronization leaves configuration, vault and schemas byte-identical ✔ · no secrets in logs, responses or committed files ✔

#### Defects found and fixed during testing
* The imported vault's own vault-file path would have been adopted (a crafted vault could redirect the next push onto the schema registry) → ignored, and push validation refuses colliding paths.
* A test assertion on Settings → Schema Management wrongly treated the read-only status chip "No Vault passphrase on this device" as a control → the check now looks for password inputs.
* V17.5.5's own `package.json` listed `browser_test_v1753.py`, a file that does not exist in the package → removed from `test:browser`.
* Test harness only: the migration log in Settings → Synchronization prints a minute timestamp; the comparison script normalizes timestamps.

#### Not verifiable here / outstanding
* **github.com was not reachable.** The real GitHub client was exercised against an HTTP emulation of the REST API (repository incl. `permissions`, branches, contents; 401 / 403 / 404 / 409 / 422; private / public; read-only tokens). Before release run one smoke test with a real fine-grained token: save the token on profile 1, pull, push the vault with your own passphrase, import the file on profile 2.
* The GitHub `permissions` object is used to detect read-only tokens; when GitHub does not report it, the message says the write permission could not be determined (never claims it).
* **SharePoint folders** could not be browsed; a V17.5.6 package in your OneDrive could not be read. `npm install` was not run (registry blocked).
* Timing-sensitive latency check of the V17.5.2 suite (4× CPU throttle): run browser suites serially.
* Limitations and security notes: SECURITY.md → *Added in V17.5.7*.
