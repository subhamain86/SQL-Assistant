# Test report — V17.7.4

Environment: Linux sandbox, Node 24, **no npm registry access and no node_modules** (the build used the committed `tools/typescript` 5.8.3), Chromium 1228 driven by Playwright 1.57. The analytics service of V17.7.3 and a local stand-in for the GitHub contents API ran as real HTTP servers. Nothing was run against real GitHub, Azure or GitHub Actions.

| Check | Result |
|---|---|
| `node scripts/tsc.mjs -p tsconfig.json --noEmit` and `-p tsconfig.test.json --noEmit` (strict) | pass |
| `node scripts/lint.mjs` | pass — 109 files, no import cycles |
| `node scripts/check-stale.mjs` (hygiene) | **pass** — 109 production files, no orphaned or stale files |
| `node scripts/check-toolchain.mjs` | pass — TypeScript 5.8.3 from `tools/typescript (committed)` |
| `node scripts/security_check.mjs` | pass (one review note on an existing V17.7.2 line in `describeNeed.ts`) |
| `node scripts/verify-artifact.mjs` | pass — root = dist = release, `version.json` 17.7.4, self-contained, no secret |
| `env -i … node scripts/build.mjs` (empty environment: no node_modules, no NODE_PATH, no TSC_PATH) | pass — production and `--dev` build |
| **Node tests** `node --test --test-concurrency=1 test/*.test.mjs` | **428 / 428 pass** (33 new in `test/v1774.test.mjs`; the V17.7.3 file `v1773` — 41 tests — passes unchanged) |
| **Browser suite** `scripts/browser_test_v1774.py` (serverless provider, test build + production page) | **60 / 60 checks pass** |
| **Browser suite** `scripts/browser_test_v1773.py` (V17.7.3 service provider, run against the V17.7.4 build) | **84 / 84 checks pass** |

The three Node tests that failed on the V17.7.2 / V17.7.3 sources (they needed the 18 historical Python browser suites that are not in the package) now pass: the hygiene check no longer requires files that do not exist, and it still reports a suite that is named but missing (tested).

## What the new Node tests prove (`test/v1774.test.mjs`)
Version stamps, the exact release note and the V17.7.3 UI byte-identity · **cryptography**: strict encodings, password policy, the private key stored only wrapped (wrong password, tampered ciphertext, swapped public key, bound key id, downgraded and absurd PBKDF2 cost all refused; nothing password-like in the file; unlocked key non-extractable), change password keeps the key pair, rotate keys keeps old keys, hybrid encryption (nothing readable, padded sizes, tamper / wrong key / unknown key / forged public key refused) · **parity with the service**: the same events give the same validator results and the same dashboard (KPIs, daily, weekly, monthly, features, versions, DAU / WAU / MAU, active-time cap) · roll-ups (identity across the month end, hostile roll-up sanitized) · **device side**: one new encrypted file per batch, random name, fixed commit message, create-only, every failure a result (no repository, not set up, no write access, wrong token, repository missing, network, name collision, throwing storage / IO), retry timing · **administration** over an in-memory repository: set-up (weak password, second set-up, no write access, interrupted set-up finished), unlock (exactly "Invalid administrator password"), dashboard from several devices (one device = one unique user; damaged, foreign-key, forged and hostile files skipped and counted), privacy of everything a repository reader sees, change password (old data readable, old password stops), rotate keys, compaction (identical dashboard before and after, idempotent, interrupted run never double counts, retention, bounded per run) · **over HTTP** against the GitHub stand-in: list / delete / create-only writes, read-only token, wrong token, outage · configuration (defaults, clamps, pinned public key, private key anywhere in the public file refused) · privacy and source guarantees · publication never mirrors the analytics folder · the registry-free toolchain (checksums, tamper, wrong version at `TSC_PATH`, missing folder) · workflows · hygiene · documentation.

## Browser checks (60)
- ✔ A1 with provider "repository" the dialog asks for the administrator password (masked)
- ✔ A2 NO repository connection: a clear message, no dashboard, SQL Assistant unaffected
- ✔ A3 NOT SET UP: the message says so and offers "Set up Analytics…"
- ✔ A4 Set up is an administrator action: with Settings locked there is NO form, only the instruction to unlock Settings
- ✔ A5 nothing was written to the repository by refused attempts
- ✔ A6 the wizard explains that the data cannot be recovered without the password
- ✔ A7 a weak password is refused with the reason (minimum 14 characters) and nothing is written
- ✔ A8 two different entries are refused
- ✔ A9 the password fields are emptied after every attempt
- ✔ A10 set-up wrote exactly the key file and the public key
- ✔ A11 the key file holds a WRAPPED key: no password, no hash, no verifier, no plaintext private key; PBKDF2 cost ≥ 600 000
- ✔ A12 the page offers the PUBLIC key to pin — and only the public key
- ✔ A13 the public key file is the PUBLIC key only
- ✔ B1 a wrong password shows exactly "Invalid administrator password"
- ✔ B2 a failed attempt exposes nothing: no dashboard, no key, the field is emptied
- ✔ B3 the right password opens the dashboard: the 11 KPI cards, numeric values, no SQL generated yet
- ✔ B4 the password is nowhere in the page: not in the DOM, localStorage, sessionStorage, the URL or cookies
- ✔ B5 no private key or wrapped key in the page or its storage (the unwrapped key lives only in memory): the only analytics storage is the device id and the unsent queue
- ✔ B6 the dashboard says the data is stored encrypted and shows the V17.7.4 release note
- ✔ B7 Lock Analytics removes every number from the page
- ✔ C1 the first send (tab hidden) wrote ONE batch under events/YYYY-MM-DD/ with a random 128-bit name
- ✔ C2 leaving the page wrote the final batch (a second file); nothing links the two
- ✔ C3 PRIVACY: no repository file contains a readable event, id, feature name, version, SQL keyword or the description text
- ✔ C4 every batch has only the envelope fields (format, v, kid, epk, iv, ct)
- ✔ C5 the SQL-generation flow was not affected by encryption and writing (a valid and a refused description both produced their result)
- ✔ C6 a reload requires the password again (no session survives it)
- ✔ C7 the dashboard decrypts the stored usage: 2 generations (1 valid, 1 failed), one unique user, success rate 50%
- ✔ C8 the most-used features and the application version are shown from the decrypted data
- ✔ C9 total active usage time is greater than zero (measured, then encrypted, then decrypted)
- ✔ C10 unique users are not counted per session: two page sessions of one browser profile are one user
- ✔ D1 the panel for the repository provider offers Change password, Rotate keys, Publish public key and Compact; the minimum is 14 characters
- ✔ D2 a wrong CURRENT password is refused and changes nothing
- ✔ D3 a weak new password is refused with the reason
- ✔ D4 the password fields are emptied after every attempt
- ✔ D5 a successful change locks Analytics and says so; the key file changed and holds neither password
- ✔ D6 the key PAIR is unchanged (same key id) — only its wrapping changed
- ✔ D7 the OLD password no longer works
- ✔ D8 the NEW password opens the dashboard and ALL earlier data is still readable (generations, users, success rate unchanged; sessions can only have grown)
- ✔ D9 Rotate keys needs the current password
- ✔ D10 rotation created a second wrapped key, made it current and published its PUBLIC key
- ✔ D11 the page shows the new public key to pin (public only)
- ✔ D12 Compact now runs and reports (nothing is old enough yet: 0 files)
- ✔ D13 usage written after the rotation is encrypted to the NEW key; earlier batches keep the old key id
- ✔ D14 after rotation the dashboard reads old AND new batches (generations unchanged, a new feature appears)
- ✔ D15 no uncaught page error in the administration flows
- ✔ D16 after the configured inactivity period Analytics locks itself, says so, and drops the data
- ✔ D17 ACTIVE TIME through the encrypted repository: 12 s open with ONE click and a 5 s inactivity timeout counts about 5 s, not 12 s (idle time is excluded)
- ✔ E1 NO WRITE ACCESS: usage is queued locally (bounded, no content), SQL generation works, no error is shown
- ✔ E2 NOT SET UP on a read-only repository: the Analytics page says so (the browser is not blocked)
- ✔ E3 no uncaught page error with a read-only repository
- ✔ E4 a DAMAGED key file: the page says it was not used; nothing is revealed; no crash
- ✔ E5 a pinned public key that is not valid switches analytics off with a message (nothing is sent anywhere)
- ✔ F1 the PRODUCTION page has no test hook (the in-memory repository exists only in the test build)
- ✔ F2 PRODUCTION page, no token on the device: "No repository connection…" (and the page works)
- ✔ F3 SQL generation works exactly as before
- ✔ F4 the version is V17.7.4 in the footer and in the navbar
- ✔ F5 About lists 17.7.4 with the release note, then 17.7.3
- ✔ F6 Settings is still behind its lock screen (the Admin Password is unchanged and separate)
- ✔ F7 the page metadata carries the version
- ✔ F8 no uncaught page error on the production page

Screenshots (`test-results-v17.7.4/`): the not-set-up state, the Set up wizard (weak-password refusal) and the set-up result with the public key to pin.

## Defects found by these tests and fixed
* Compaction merged a session that crosses a month end into two roll-ups (counted twice) — one model over all roll-ups now carries it.
* Compaction after an interrupted run could count already-merged files again — the roll-up now remembers the file names it merged.
* The administrator's own device kept encrypting to the OLD public key after a rotation — the cached key is now forgotten after Rotate / Publish.
* GitHub lists at most 1000 files per folder — batches now go to one folder per UTC day.
* Analytics batch pushes would have started the Pages build and the data publication — path filters added, and the analytics folder is never published.

## Not run / not possible here
A real GitHub repository (tokens, permissions, branch protection, API and secondary rate limits), a real Pages deployment, GitHub Actions runs, other browsers, real users and scale. The 18 historical Python browser suites (V17.4–V17.7.2) are not in the package and were not run — `npm run test:browser:all` runs every suite present in a full checkout.
