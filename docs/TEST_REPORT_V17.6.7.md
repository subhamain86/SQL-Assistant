### Verification report — SQL Assistant 17.6.7 (new-device Admin Password: Settings authentication)

Baseline: `SQL-Assistant-V17.6.6.zip` (attached; sole baseline and last-known-good UI). Run **unchanged first**: type-check, lint, production build, **216/216** Node tests. Stages were run as the underlying `node` / `python3` commands in `npm run verify` order (the npm registry is not reachable; the only dev dependency, TypeScript **5.8.3**, was run directly). Browser suites ran in Chromium 1208 (Playwright 1.57).

#### 1. Root cause found
I reviewed the whole workflow (start-up, first run, new-device initialization, login validation, Settings unlock, verification service, synchronization start-up sequence, repository download, central password loading, cached credentials, local storage, security bootstrap) and ran the request's Mandatory Validation **literally, through the user interface, on the unchanged V17.6.6 build** — in token mode (the real GitHub client against a stub of a private repository), published-copy mode and central-access mode.

| What was checked on V17.6.6 | Result |
|---|---|
| Device A: `admin` → `MyCentralPassword`, Synchronize, repository contains the record | works (revision 1, encrypted verifier, no plaintext) |
| Device B (clean): configure repository → Pull Schema → open Settings: `MyCentralPassword` unlocks, `admin` is rejected | **works** (token mode, published copy; central access after sign-in) |
| Device B (clean): **open Settings with the default first** (the only way to reach *Sync with GitHub Now*, which lives inside Settings, on a device that has no repository yet), then configure the repository and synchronize, then "open Settings" | **DEFECT — Settings stay unlocked, authenticated with `admin`**, although the status line reads *synchronized (revision 1)*. Only a fresh unlock rejects `admin`. Reproduced in token mode and in published-copy mode. |

**Root cause.** A clean device has no repository connection, so the default `admin` is accepted — it must be, otherwise the repository (token / GitHub sign-in / configuration) can never be set up. The Settings session opened that way **was never invalidated when the central password became known**. V17.6.5/17.6.6 fixed the *check* (what happens when a password is typed) but not the *session*: the already-unlocked Settings kept authenticating with `admin` after the central password had been applied. Two aggravating factors: the lock screen told the user "the default password is `admin`" on a device that had simply not fetched the central record yet, and nothing recorded whether the default was accepted *because no central record exists* or *because it could not be reached*.

**Limit (not a code defect).** A device that cannot reach the repository at all — no token, no GitHub sign-in, not served from a published copy (for example `index.html` opened from disk with nothing configured) — cannot know that a central password exists. There the default must stay valid (the V17.6.2 contract: the administrator screen works without token and sign-in). The fix makes this explicit: the unlock says so, and the session is locked again as soon as a central password is applied.

#### 2. Files modified (4 source files, 94 changed lines; plus About / version stamps)
| Kind | Files |
|---|---|
| **Fix** | `src/services/passwordService.ts` (46), `src/v17/services/adminPassword.ts` (33), `src/main.ts` (6), `src/ui/pages/settings.ts` (9) |
| Version 17.6.7 | `package.json`, `src/v17/sync/schemaFormat.ts` (`APP_VERSION` → footer, writer stamp), `src/v17/engines/nluEngine.ts`, `src/ui/pages/other.ts` (About), `release/version.json`, `README.md`, build output (`dist/`, `index.html`, `release/*.html`) |
| Docs | new: `CHANGELOG_V17.6.7.md`, `TEST_REPORT_V17.6.7.md`, `REGRESSION_BASELINE_V17.6.7.md`; updated: `ADMIN_PASSWORD.md`, `SOURCE_PROVENANCE.md` |
| Tests / scripts | new: `test/v1767.test.mjs`, `scripts/browser_test_v1767.py`, `scripts/compare_v1767.py`; version expectations only: `test/v1763.test.mjs`, five older browser scripts; `test/v1766.test.mjs` (version-stamp test → history test; the pinned source text of the gate follows its restructuring), `scripts/browser_test_v1765.py` (see "Intended changes") |

Byte-identical to V17.6.6 (checked with `diff -r`): every other source file, `public/styles.css`, `.github/` (workflows), `server/`, `scripts/build.mjs`, the Secret Vault, repository, GitHub, broker, schema, SQL, NLU, learning and Admin Query Library code.

**Fix.** (a) every accepted check records its basis — `central` / `local` / `default-confirmed` (central read succeeded, no record anywhere) / `default-unverified` (accepted without a successful central read); (b) a Settings session opened on a default basis is **locked again** (with an explanatory toast) when a central, non-reset password is applied — at start-up, a scheduled sync, *Sync with GitHub Now*, when Settings are shown, or at the next unlock check; (c) the unlock says honestly when the central record could not be checked; (d) the lock screen asks for the central record at once and drops the wrong "default password is admin" hint when it was applied; (e) a secret-free in-memory authentication trace (diagnostics). Encrypted marker, storage keys, record format, paths, merge rules, migration: unchanged.

#### 3. New-device validation results (real browser, production build)
| Scenario | V17.6.6 | V17.6.7 |
|---|---|---|
| **Token** — A saves `MyCentralPassword`; B (clean) configures token → Pull Schema → Settings | works | works; the lock screen no longer shows the "admin" hint; `MyCentralPassword` unlocks, `admin` rejected; marker == central verifier byte-for-byte; works after refresh |
| **Token** — B opens Settings with the default first, configures the repository, synchronizes | **stays unlocked on `admin`** | **Settings lock again** with an explanation; `admin` rejected, central password unlocks; *Sync with GitHub Now* keeps working |
| **Published copy** — new device, record published | works | works; applied by the **start-up** synchronization before anyone opens Settings |
| **Published copy** — device unlocked on the default before the record was published; record published later; *Sync with GitHub Now* | **stays unlocked on `admin`** | locked again; `admin` rejected afterwards |
| **Central access (broker)** — B before sign-in (no connection) | default accepted | default accepted (by design) — recorded *unverified*, message shown |
| **Central access** — B signs in, opens Settings | stays unlocked | locked again; `admin` rejected, central password unlocks |
| Invalid / unreadable central record | default works, nothing overwritten | same; user told it could not be checked; nothing claimed as synchronized; after the record is valid the next sync applies it |

#### 4. Cross-device validation results
Passed: A's change reaches a clean B (revision 1) and an open B3 through *Sync with GitHub Now* (revision 2: the new password valid, the previous one rejected); the central record is never overwritten by a new device; no plaintext password in the repository record, the commit message, any request URL or body, any storage entry or the diagnostics; an existing V17.6.6 installation (marker + meta **created by the real V17.6.6 build**) is unchanged byte-for-byte after the upgrade, unlocks with its password and rejects `admin`.

#### 5. Test results
| Stage | Result |
|---|---|
| TypeScript 5.8.3 `tsc --noEmit` | passed |
| Lint (87 files, no import cycles) | passed |
| Security scan (source + `dist/index.html`) | passed |
| Production build (final, twice) / development build | passed (dist = root = release; `version.json` 17.6.7) |
| Node test suite | **236 / 236** (216 existing + 20 new in `test/v1767.test.mjs`) |
| Browser regression V17.0 → V17.6.5 (12 scripts) | **830 / 830** — see timing note |
| Browser V17.6.6 (`browser_test_v1766.py`) | **34 / 34** |
| Browser V17.6.7 (`browser_test_v1767.py`) | **35 / 35** (also run alone: 35 / 35) |
| UI comparison with V17.6.6 (`compare_v1767.py`, 16 pages × 2 widths) | **33 / 33** markup-identical everywhere except About (one new list entry); style sheet byte-identical |
| Generated-bundle secret scan | passed — no credential pattern, no test password (Node, browser and a separate scan) |

**Diagnostics → tests (Node `v1767`)**: central password downloaded (D1) · loaded (D2) · authentication uses it (D3, basis `central`) · the default is disabled when it exists (D4) · new-device initialization imports the security configuration — marker + meta (D5) · the login check reads exactly the central verifier (D6) · start-up synchronization completes before validation begins — trace order `sync:start → central:downloaded → central:loaded → auth:rejected` with the record delayed (D7).
**Regression tests**: change on A synchronized (R1) · B receives it (R2) · B authenticates with it (R3) · B cannot with `admin` (R4) · start-up loads security settings before authentication (5) · existing V17.6.6 users / repositories / encrypted security records compatible (R6–R8), plus the session re-lock (root cause), `default-confirmed` / `default-unverified`, invalid and failing central data, a central reset, the throttled re-check, and module isolation.

**Intended changes to existing assertions (none weakened):** `browser_test_v1765.py` asserted that a not-yet-synchronized device shows "the default password is admin" on the lock screen even when the central record is reachable — it now asserts that the hint disappears (that hint was part of the defect); `test/v1766.test.mjs` pinned the source text of the V17.6.6 gate — it now pins the same gate in its restructured form; version expectations 17.6.6 → 17.6.7.

**Timing note.** The browser suites use fixed waits. Run in parallel on one machine (three streams plus the comparison), four checks in three scripts failed on timing (`browser_test_v1752` latency under CPU throttle, `browser_test_v1762` ×1, `browser_test_v1763` ×2). **All three scripts passed in isolation on the same build: 89/89, 63/63, 33/33**; the 830 counts those isolated results. The same kind of load-related failures occurred in the V17.6.6 run.

#### 6. Confirmation: no unrelated changes
Confirmed by `diff -r` against the extracted V17.6.6 (section 2), the byte-identical style sheet / workflows / server / build script, 33/33 identical-markup comparisons, the module-isolation test (Pull Schema, vault, sign-in, broker, published data, sync, NLU, SQL code do not reference the fix) and the unchanged suites above.

#### Still to check on your systems
1. **Real GitHub / repository access service / Pages workflow were not exercised.** After deploying: on a clean browser profile, configure the repository, then open Settings — `admin` must be rejected and the central password must unlock.
2. If a device **still accepts `admin` after it can reach the repository**, open **Settings → Security → Central synchronization**: it names the cause (no connection · read failed: reason · not yet synchronized · synchronized, revision N). The unlock toast says the same.
3. Device A must be able to **write**: a read-only token (for example the central read-only token restored from the published vault) cannot publish the record. A's Security tab then shows *not yet published* and the repository holds no record, so every other device correctly keeps the default.
4. A published-copy device sees a changed password only after the *Publish SQL Assistant data* workflow has run for the commit that holds `…/security/admin-password.json`.
5. `package-lock.json` still does not exist (registry blocked).
