# Verification report — SQL Assistant V17.7

**Verdict.** Everything that can be verified inside this build environment passed: typecheck, lint, hygiene, build, security scan, artifact verification, all Node tests and all 17 sequential browser suites (987 checks) — numbers in `docs/TEST_REPORT_V17.7.md`. **Nothing was executed against GitHub, GitHub Actions, GitHub Pages, the Basware publishing zone, Azure or a real sign-in.**

## 1. Commands run (Node v24.16.0, TypeScript 5.8.3 from `node_modules`)
| Command | Result |
|---|---|
| `npm run clean`, `check:toolchain` | OK — project-pinned TypeScript 5.8.3 |
| `npm run typecheck` | pass (strict) |
| `npm run lint` | pass — 88 production files, no import cycles |
| `npm run check:stale` | pass — no orphaned / stale file, every test imports production code |
| `npm run build` | pass — `dist/index.html`, root `index.html`, `release/` (SQL Assistant 17.7.0) |
| `npm run security` | pass — 88 source files, `dist/index.html`, 7 generated files of the root page and `release/` |
| `npm run verify:artifact` | pass — root `index.html` = `dist/index.html` = `release/index.html` = `release/404.html`, version.json matches package.json |
| `tsc -p tsconfig.test.json --noEmit` and `build --test` | pass — `test-dist/` (browser-test build, never deployed) |
| `node scripts/verify-no-npm.mjs --skip-browser` | exit 0 — summary in `test-results-v17.7/verify-no-npm-summary.txt` |
| 17 sequential browser suites | 987/987 — see TEST_REPORT |

`npm` cannot reach a registry here, so TypeScript is the pre-installed 5.8.3 linked into `node_modules`; `npm ci` was not run. The CI workflow runs `npm ci` and then `npm run check:toolchain`, which fails if the installed version differs from the pin.

## 2. What V17.7 changes (see `docs/CHANGELOG_V17.7.md`)
* **Evidence-based default.** `admin` is accepted only for a central reset record, or when the authoritative repository answers that no record ever existed for a device that never knew one. A stale / forged local revision higher than the central one no longer reaches `confirmed-default`, and the central password is never overwritten by a default record.
* **No test hook in production.** `window.__sqla` and the repository override exist only in `test-dist/` (`src/testHooks.ts`, `npm run build:test`). Confirmed in this run: the production page has no `__sqla`, `__sqlaRequire` or `define`; the test build has the hook; `verify:artifact` refuses a page with a hook, a global loader or an unscoped script (asserted by tests that mutate a copy).
* **No Node / npm at run time.** The password-sync code and the generated page use no Node API and no bare-specifier import; `package.json` has no runtime dependency; asserted by `test/v177.test.mjs` and by browser check B5.
* **Cross-device evidence (`browser_test_v177.py`, 28/28).** A publishes; a clean B (never seeded, first attempt `admin`) is rejected and the central password opens Settings; a remote change locks B's stale session; unavailable / tampered / invalid / no-record central states reject `admin`; an explicit central reset accepts it.

## 3. Defects found and fixed in this verification pass
| Finding | Kind | Fix |
|---|---|---|
| Three Node tests failed on the working tree (V17.5 writer-label shape, missing V17.7 docs, over-broad import detector) | test design / missing docs | Assertions corrected, docs written (details in TEST_REPORT) |
| Six browser suites (V17.6.1, .2, .3, .6, .7, .8) failed in set-up because their site copies carried only the production page | harness | `site()` helpers copy `test-dist/index.html` (served for `?e2e=1` only) |
| A first edit of that fix commented out one `publish(...)` call in the V17.6.6 helper | harness (caught by the re-run) | restored, suites re-run: all pass |

No application source file was changed in this pass.

## 4. Outstanding external blockers (unchanged, not solvable in source)
| Item | State |
|---|---|
| `AZURE_CREDENTIALS` | Missing in the target repository / environment; the broker workflow reports it and stops. A real Azure deployment cannot succeed until it is configured. |
| PAT verification HTTP 403 (`AADSTS53003`, Conditional Access) | Organization policy; needs an administrator. |
| `bw-publish-zone` | Not accessible from here; compatibility must be confirmed by the zone's owner. |
| GitHub Actions workflows | Parsed and structurally asserted by tests; **not executed** by GitHub. |
| Stale files in the target repository | 59 files listed in `docs/STALE_FILES_V17.7.md` must be removed there once (`npm run prune-stale`). |

## 5. Known limits
* Behaviour is deliberately strict: a brand-new device with no repository connection cannot open Settings with `admin`; published-copy-only deployments need one explicit reset record first (`docs/RELEASE_NOTES_V17.7.md`).
* The repository is emulated in all browser suites (GitHub-like sha / conflict semantics); no real GitHub.
* If `admin` still works on your deployed site, check that the footer shows 17.7.0 — a failing CI build leaves the old build deployed.
