### Verification report — SQL Assistant 17.6.6 (new-device Admin Password fix)

Baseline: `SQL-Assistant-V17.6.5.zip` (attached; sole baseline). Run **unchanged first**: type-check, lint, production build, **195/195** Node tests. Stages were run as the underlying `node` / `python3` commands in `npm run verify` order (the npm registry is not reachable; the only dev dependency, TypeScript **5.8.3**, was run directly). Browser suites ran in Chromium 1208 (Playwright 1.57).

#### 1. Files changed
| Kind | Files |
|---|---|
| **Fix (5 source files, 45 changed lines in total)** | `src/services/passwordService.ts` (4), `src/v17/services/adminPassword.ts` (26), `src/ui/context.ts` (12: `passwordRepository()` + its one use), `src/ui/pages/settings.ts` (1: an added toast) — plus the About entry in `src/ui/pages/other.ts` (2) |
| Version 17.6.6 | `package.json`, `src/v17/sync/schemaFormat.ts` (`APP_VERSION` → footer, writer stamp), `src/v17/engines/nluEngine.ts` (label), `src/ui/pages/other.ts` (About), `release/version.json`, `README.md`, build output (`dist/`, `index.html`, `release/*.html`) |
| Docs | `docs/CHANGELOG_V17.6.6.md`, `TEST_REPORT_V17.6.6.md`, `REGRESSION_BASELINE_V17.6.6.md` (new); `ADMIN_PASSWORD.md` (new "New devices" section), `SOURCE_PROVENANCE.md` (new entry) |
| Tests / scripts | new: `test/v1766.test.mjs`, `scripts/browser_test_v1766.py`, `scripts/compare_v1766.py`; version expectations only: `test/v1763.test.mjs`, six older browser scripts; `test/v1765.test.mjs` and `scripts/browser_test_v1765.py` (see "Intended changes") |

Everything else is byte-identical to V17.6.5 (checked with `diff -r` against the extracted baseline): no other source file, no `public/styles.css`, no workflow, no build script.

#### 2. Root cause
Reproduced on the **unchanged V17.6.5 build** — in Node (tests 2–5 of `v1766` fail) and in a real browser (new device on a published copy: **Settings unlocked with the default `admin`**).
1. `verifyPassword()` compared the candidate with the local marker first; a new device has none, so it compared with the built-in default marker and `admin` matched. The central record was fetched only when the candidate did *not* match — never for `admin`.
2. The unlock-time refresh skipped a synchronization that was still running (start-up) and was throttled by a time stamp set when a read *started*, so an unlock during or right after a failed start-up read used the default.
3. A published-copy device could not see a record published after its page opened (the publication marker is read once; the new file failed the hash check) — also for *Sync with GitHub Now*.
4. "No central record" was reported as synchronized.

#### 3. Fix
* A device **without a local marker asks the central record first**, then decides: precedence **central → valid local → default (only when neither exists or the central record cannot be read)**.
* The unlock check **waits** for a running synchronization; the throttle counts only successful reads; a failed read is retried and its reason (no secret) is shown on the Security status line and in a toast after unlock.
* "No central record" is no longer reported as synchronized; nothing is ever written by a new device.
* For the published copy the marker is re-read before reading **this one file** (shared published state untouched).
* Marker format, key `sqla.pwvault.v15`, PBKDF2-SHA-256 150 000 / AES-GCM, record format and path, UI markup: unchanged.
* **Deliberately not done:** extra reads on Pull Schema / vault / sign-in. A first version did that; the existing contract tests (V17.5.4, V17.5.5, V17.6.2, V17.6.3) assert that those operations read only their own files, so it was removed. The next unlock check covers a connection that appears later.

#### 4. Tests executed and results
| Stage | Result |
|---|---|
| TypeScript 5.8.3 `tsc --noEmit` | passed |
| Lint (87 files, no import cycles) | passed |
| Security scan (source + `dist/index.html`) | passed |
| Production build (twice) / development build | passed (dist = root = release; version.json 17.6.6) |
| Node test suite | **216 / 216** (195 existing + 21 new in `test/v1766.test.mjs`) |
| Browser regression, V17.0 → V17.6.5 (12 scripts) | **830 / 830** — see note on timing below |
| Browser tests for V17.6.6 (`browser_test_v1766.py`) | **34 / 34** (the same 33 plus one, after the final change) |
| UI comparison with V17.6.5 (`compare_v1766.py`, 16 pages × 2 widths) | **33 / 33** — markup identical everywhere (including Settings → Security and Danger Zone) except About (one new list entry); style sheet byte-identical |
| Generated-bundle secret scan | passed — no credential pattern, no test value, in the Node test, the browser test and a separate scan |

**Required regression tests → evidence (Node `v1766` / browser `v1766`)**
| # | Requirement | Evidence |
|---|---|---|
| 1 | Centralized non-default password saved | Node 1; browser 1 (saved through the real Security tab) |
| 2 | Clean device has no marker | Node 2; browser 2 |
| 3 | New device retrieves the verifier | Node 3; browser 3 (marker applied, `salt / iv / ciphertext`, revision recorded) |
| 4 | Central password unlocks Admin mode | Node; browser 4 |
| 5 | `admin` rejected | Node; browser 5 and the **start-up race** (record held back: the unlock waits, then rejects `admin`) |
| 6 | Record not overwritten | Node (snapshot of the repository unchanged); browser (published file byte-identical; late-connection test: no write) |
| 7 | Manual sync refreshes the record | Node; browser 7 (device open on revision 1, revision 2 published, **Sync with GitHub Now** → marker replaced) |
| 8 | Change on one device valid on another | Node; browser 8 (PW2 accepted, PW1 rejected) |
| 9 | Invalid / unreadable central data overwrites nothing | Node (3 invalid forms + failing read + retry); browser (unreadable, invalid, absent: default kept, no marker created, local marker of an existing device untouched, nothing claimed as synchronized, actionable message) |
| 10 | Existing V17.6.5 installations compatible | Node; browser 10 — marker and meta created by the **real V17.6.5 build**, carried to the V17.6.6 origin: unchanged byte-for-byte, password unlocks, `admin` rejected |
| 11 | All existing tests pass | 195 Node + 830 browser checks (below) |

**Intended changes to existing assertions (none weakened):** `v1765` (Node and browser) asserted that a clean installation's first synchronization is `synchronized: true`; it is now `false` — required by "do not claim the default password is synchronized". `v1765` wiring assertion now names `passwordRepository`; version expectations 17.6.5 → 17.6.6; the version-stamp assertions moved to `v1766`.

**Note on browser-test timing.** The suites use fixed waits. In the first full run (four suites in parallel, one machine) a few checks failed that passed when re-run alone. In that first run some of them were *caused* by the first version of the fix (extra reads, see 3) — removed. In the final run (three suites in parallel) three checks in three scripts failed on timing — "Danger Zone: wrong password refused", "Push Secret Vault works on its own" / "every route renders", two published-copy vault checks — and **all three scripts passed in isolation on the same build: 56/56, 75/75, 33/33**. The 830 above counts those isolated results.

#### 5. Cross-device validation result
Passed (Node, several devices with separate storage; Chromium, separate contexts): device A saves a central password → a new device (published copy, real publication script and static server) rejects `admin` and accepts the central password at first attempt, after a refresh, and with the record delayed (race); A changes it → an open device applies it with **Sync with GitHub Now**; offline / read-only / conflicting / invalid cases keep the previous behaviour.

#### 6. Security scan result
Passed. No credential-looking string and no test value in the production bundle; no plaintext password in the repository record or in any browser-storage entry of any device (searched in Node and browser tests); the central record is never written by a new device; no password echo (a wrong password gives the same message as before); encryption and verification unchanged. Test passwords are synthetic (`SYNTHETIC-…`).

#### 7. Confirmation: no unrelated changes
Confirmed by file diff (section 1), the unchanged style sheet, 33/33 identical-markup comparisons, the module-isolation test in `v1766` (secret vault, broker, published data, sync, schema, SQL, NLU, Pull Schema / vault cards and sync preferences do not reference the fix) and the unchanged suites above.

#### Still to check on your systems
1. **Real GitHub / repository access service / Pages workflow were not exercised.** After deploying: open SQL Assistant on a clean browser profile, try `admin` (must fail) and the central password (must unlock).
2. A device that reads the **published copy** sees a changed password only after the *Publish SQL Assistant data* workflow has run for the commit that holds `…/security/admin-password.json`.
3. Not changed on purpose (outside this defect): a page that stays open still reads the publication marker only at start-up for schemas and the vault.
4. `package-lock.json` still does not exist (registry blocked).
