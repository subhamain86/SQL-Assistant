### SQL Assistant 17.6.4 — CI / deployment fix

**Goal.** The workflow "Build, test and deploy SQL Assistant to GitHub Pages" failed in its *build* job after 11–22 seconds on `main`, so the *deploy* job was skipped and the site was not published. No feature or UI change.

#### Baseline
`SQL-Assistant-V17.6.3.zip` (attached; the last-known-good UI and the latest version). Run unchanged first: lint, production build and 167/167 Node tests passed.

#### Diagnosis (what was actually reproduced, and what was not)
| Finding | Evidence | Status |
|---|---|---|
| **Order of stages.** `deploy-pages.yml` ran `typecheck && lint && security && test && build`. `npm run security` scans `dist/index.html` and fails with *"dist/index.html is missing — run npm run build first"* on a checkout that does not contain it. Reproduced here on a copy without `dist/`: typecheck passes, lint passes, **security exits 1**. All of that takes only seconds, matching an 11–22 s failure. | reproduced | **real defect, fixed** |
| **TypeScript major version.** TypeScript 6.0.2 rejects `tsconfig.json` (`moduleResolution: node`) with **TS5107**. `package.json` allowed `^5.8.3`, so npm installs a 5.x version on GitHub and TypeScript 6 is **not confirmed** as the cause of the failure. The build is verified with 5.8.3, which is now pinned exactly. | reproduced with 6.0.2; 5.8.3 passes | **hardened** (exact pin) |
| `npm ci \|\| npm install` with no `package-lock.json` always prints a failing `npm ci` first. | by reading | **replaced** |
| Whether `dist/` is in your repository, and which exact step failed on GitHub | the run logs were **not available** | **NOT confirmed** — see "Still to check" |

Other causes that could not be ruled out without the run log: a TypeScript 5.9.x behaviour difference (the build was verified with 5.8.3), a file missing from the repository, or a repository setting.

The other two failing workflows are **configuration**, not code: *Verify the central GitHub PAT* fails when the secret `SQLA_GITHUB_PAT` is missing or rejected (the script already says so), and *Deploy the repository access service* ran on every push touching `server/**` even though the service (Azure, secrets, variables) is not set up.

#### Changes
| File | Change |
|---|---|
| `.github/workflows/deploy-pages.yml` | stages are separate named steps; **build runs before the security check**; deterministic install (`npm ci` only with a lock file, else `npm install`); fails with a clear message if TypeScript is not 5.x; the deploy job checks that GitHub Pages is enabled and, if not, names *Settings → Pages → Source = GitHub Actions*. Permissions, `needs: build`, Node 24, checkout@v5 / setup-node@v5 unchanged. |
| `.github/workflows/deploy-broker.yml` | a push is **skipped** unless the variable `SQLA_BROKER_APP_NAME` exists; a manual run always runs and names every missing item (`SQLA_BROKER_APP_NAME`, `AZURE_CREDENTIALS`, `SQLA_GITHUB_PAT`, `SQLA_GITHUB_CLIENT_ID`, `SQLA_ALLOWED_ORIGINS`). Never prints a secret. |
| `package.json` | `typescript` pinned to exactly `5.8.3`; version 17.6.4 |
| `src/v17/sync/schemaFormat.ts`, `src/v17/engines/nluEngine.ts`, `src/ui/pages/other.ts` | version stamp, About entry |
| `test/v1764.test.mjs` | new (5 tests) |
| older tests / browser scripts | version expectations only |
| docs | this file, `TEST_REPORT_V17.6.4.md`, `REGRESSION_BASELINE_V17.6.4.md`, `SOURCE_PROVENANCE.md`, `README.md` |

**Not changed:** UI, the three Pull Schema cards, repository configuration and Admin Password, default passphrase, vault envelope and key derivation, Pull Schema, published-copy logic, broker code, SQL generation, selectors, `public/styles.css` (byte-identical), compiled output of `src/` apart from the version strings.

#### Still to check on GitHub (cannot be done here)
1. Re-run the workflow (Actions → *Build, test and deploy …* → Re-run, or push this version) and open the first red step, if any — each stage now has its own step.
2. Settings → Pages → Source = **GitHub Actions**.
3. `package-lock.json` could not be generated here (npm registry blocked); run `npm install` once and commit the lock file.
4. *Verify the central GitHub PAT* will still fail until the secret `SQLA_GITHUB_PAT` exists and is accepted by GitHub (see `docs/CENTRAL_PAT.md`); that is configuration, not code.

#### One flaky test fixed (test-only)
`test/v1753.test.mjs` ("an update that cannot be confirmed …", case *content differs*) corrupted the first ciphertext character by replacing it with `Z`. The ciphertext is random, so in about 1 run in 64 the character already was `Z`, nothing differed, and the test failed (seen once in 3 full runs here; it passes when re-run). The replacement now always picks a different character. No application code is involved; the assertions are not weakened.
