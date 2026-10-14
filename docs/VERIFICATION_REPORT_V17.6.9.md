# Verification report — SQL Assistant V17.6.9

**Verdict.** Everything that can be verified inside this build environment passed (typecheck, lint, hygiene, build, security, artifact verification, all Node tests, all sequential browser suites — numbers in `docs/TEST_REPORT_V17.6.9.md`). **Nothing was executed against GitHub, GitHub Actions, GitHub Pages, the Basware publishing zone, Azure or the organization's identity provider. No real publication or deployment is claimed.**

## 1. Commands run (this environment: Node v24.16.0, TypeScript 5.8.3 from `node_modules`)
| Command | Result |
|---|---|
| `npm run check:toolchain` | OK — project-pinned TypeScript 5.8.3 |
| `npm run typecheck` | pass (strict, entry point `src/main.ts`) |
| `npm run lint` | pass — 88 production files, no import cycles |
| `npm run check:stale` | pass — no orphaned / stale file, every test imports production code |
| `npm run build` | pass — `dist/index.html`, root `index.html`, `release/` (SQL Assistant 17.6.9) |
| `npm run security` | pass — 88 source files + root page + every file in `release/` |
| `npm run verify:artifact` | pass |
| `npm test` equivalent (`node scripts/build.mjs` + `node --test --test-concurrency=1 test/*.test.mjs`) | see TEST_REPORT |
| Sequential browser suites (Chromium, 16 scripts) | see TEST_REPORT |
| `node scripts/verify-no-npm.mjs --skip-browser` | see section 6 |

`npm` itself cannot reach a registry here (HTTP 403), so TypeScript is the pre-installed 5.8.3 linked into `node_modules`; `npm ci` was not run. The CI workflow runs `npm ci` / `npm install` and then `npm run check:toolchain`, which fails if the installed version differs from the pin.

## 2. The defect and its fix (acceptance 4–7)
**Root cause (found in the V17.6.8 source, not assumed):** `AdminPasswordService.resolution()` returned `defaultAllowed: true` with state `default-unverified` for (a) a device with no repository connection ("standalone"), (b) a device whose repository credential was refused, and treated a *published copy that lists no record* as proof that no password exists. A new / different device that had not yet read the central record was therefore indistinguishable from a first-time installation, and `verifyPassword()` accepted `admin`.
**Fix at the boundary:** `confirmed-default` exists only in `AdminPasswordService.resolution()` and `verifyPassword()` requires it. See `docs/CHANGELOG_V17.6.9.md` and `docs/ADMIN_PASSWORD.md`.
**Evidence:** `test/v1769.test.mjs` (policy matrix of 9 central states; loading / synchronizing; every entry point; stale-session re-lock; publication order and read-back; compatibility) and `scripts/browser_test_v1769.py` (cross-device acceptance in real Chromium contexts: Device A publishes, Device B is a clean context that is **never seeded** and receives the credential only through the navbar Sync; central password accepted, `admin` rejected; stale session re-locked and not restored after a refresh; revision 2 reaches B; invalid record and failed read never enable the default).

## 3. Test-design changes (acceptance 9–12)
* **Orphans.** 54 orphaned `.ts` files and 5 stale test files reported by the CI log are **not in the V17.6.8 package**; they exist only in the target repository. Handling: separate detector + reviewed list + explicit prune commands (`docs/STALE_FILES_V17.6.9.md`). **Nothing was restored to production, nothing was stubbed, no active file was excluded.** The clean tree reports `88 production source files, no orphaned or stale files`; a polluted tree (the 59 files recreated in a temporary copy) is reported by name, exits 1, and the prune commands return it to the expected clean result (tested).
* **Hosted vault.** `hostedVault.ts` and its tests are the V17.5.8 generation; the production path since V17.6.3 is `publishedData.ts` + `vaultRetrieval.ts`. The behaviours those tests protected are asserted against the production modules; the old module names are asserted absent.
* **Versions.** Current literal only in `test/support/version.mjs` + `test/v1769.test.mjs`; historical tests assert shape or use `test/fixtures/historical-stamps.json`; browser suites read the version from `package.json`.
* **TypeScript.** No absolute path remains in `scripts/` (asserted); `build.mjs` refuses a different version.

## 4. Harness changes in legacy browser suites — what they do and do not prove
Because the first-time default now needs an authoritative confirmation, the legacy suites (`browser_test`, `v174`, `v175`, `v1751`, `v1752`, `v1754`, `v1755`, `v1757`, `v1761`, `v1762`, `v1763`) that test *other features* through the Settings unlock on a connection-less device give that device a temporary EMPTY test repository while the Admin Password check runs. The application code is not changed for this. The dedicated authentication suites (`v1765`–`v1769`) have no such helper (`v1767` explicitly disables it and replaces the old "first token through the Admin Password card" step by restoring repository access without the Admin Password, because a new device can no longer use `admin` to obtain its first token). Consequences that are real and documented: first-time flows on a brand-new device now need a connection first (`docs/ADMIN_PASSWORD.md`).

## 5. Infrastructure findings (acceptance 15–17) — still open, by design
| Item | State |
|---|---|
| `AZURE_CREDENTIALS` | **Missing in the target repository/environment.** The broker workflow now blocks with `Deployment blocked: AZURE_CREDENTIALS is not configured.` (all missing keys at once, names only). Azure login is not bypassed. **A real Azure broker deployment cannot succeed until the secret is configured.** Verified here only by executing the preflight script locally with an empty value. |
| PAT verification HTTP 403 (`AADSTS53003`, Conditional Access) | **Blocked by organization policy.** The check reports a failed verification with the upstream code / trace / correlation ids; causes are listed as *possible, not verified*. Source changes cannot lift the policy. Reading and publishing the data folder does not need this PAT (`publish-data.yml`). |
| `bw-publish-zone` (github.com/basware/dh-zone) | **Not accessible from this environment; no details of it are claimed.** The artifact is a static, relative, self-contained `release/`. Compatibility has to be confirmed by the zone's owner. |
| GitHub Actions syntax | The four workflows parse as YAML and their `needs` / `if` / step-order properties are asserted by tests. They were **not** executed by GitHub (no `actionlint` available). |
| Real publishing / deployment | **Not executed.** |

## 6. Complete verification command
`node scripts/verify-no-npm.mjs --skip-browser` (clean → toolchain → typecheck → lint → hygiene → build → security → artifact → tests → dev build → final build + artifact) was run; its summary is stored in `results/verify-no-npm-summary.txt`. The sixteen browser suites were run **sequentially** as separate invocations (not through that runner) because they take ~40 minutes; the runner's browser stage is unchanged and calls the same scripts.

## 7. Known limits and trade-offs
* Behaviour change is deliberate and documented: a brand-new device without any repository connection cannot open Settings with `admin`. Published-copy-only deployments need one explicit reset record (or a token / sign-in) before the first administrator can start. If that is too strict, `AdminPasswordService.resolution()` is the single place to adapt.
* `scripts/compare_v1768.py` (side-by-side build comparison against V17.6.7) was not re-run; instead the UI is protected by SHA-256 of the style sheet and 27 of 29 `src/ui` modules (`test/fixtures/ui-baseline-v1768.json`).
* Emulated repository in all browser suites (GitHub-like sha / conflict semantics); no real GitHub.
* AI/LLM live endpoints were not contacted (tests use stubs).
