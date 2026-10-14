# Review of the supplied error archives — V17.7

**Method.** All five archives were unpacked and read stage by stage (`1_build.txt`, `build/*.txt`, `deploy/*.txt`, `verify/*.txt`). Each failure is classified as an **application / repository defect** (fixable in code or in the repository) or an **external environment / configuration blocker** (not fixable by a source change). Nothing was hidden, no validation was weakened, no stage was disabled.

| Archive | Workflow job | Application version in the log | Outcome |
|---|---|---|---|
| `logs_103717775423` | build (GitHub Pages) | `sql-assistant@17.6.7` | failed at **Typecheck** — 155 TypeScript errors |
| `logs_104050659931` | deploy (repository access service → Azure) | n/a (preflight step) | failed at **Refuse to deploy without the required secret / variables** |
| `logs_104050659931 (1)` | deploy | n/a | **byte-identical duplicate** of `logs_104050659931` (verified with `cmp`) — same finding |
| `logs_104050744994` | verify (`SQLA_GITHUB_PAT`) | n/a | failed: HTTP 403 from GitHub, `AADSTS53003` |
| `logs_104051351287` | build (GitHub Pages) | `sql-assistant@17.6.8` | typecheck, lint, build and security **passed**; **Tests** failed: 313 tests, 290 pass, **23 fail** |

## 1. `logs_103717775423` and `logs_104051351287` — stale files that exist only in the repository (repository defect, not an application defect)
* **103717775423 (17.6.7):** `tsc` compiled `src/**` and reported 155 errors in files such as `src/components/conflictBanner.ts`, `src/engines/schemaVersionEngine.ts`, `src/ui/views/settings.ts`, `src/v17/services/adminCredentialService.ts`. Every one of them is a file of an **earlier** version (missing exports / removed types). None is in the V17.6.7, V17.6.8, V17.6.9 or V17.7 package, none is imported from `src/main.ts`.
* **104051351287 (17.6.8):** typecheck / lint / build / security passed because `tsconfig.json` already compiles from `src/main.ts` and reports the leftovers by name (*"54 orphaned file(s) under src/ … were not linted"*). The test stage then failed: the historical tests `engines`, `v1756`, `v1758`, `v1759`, `v176` (still in the repository, not in the package) exercise modules that no longer exist (e.g. `R.looksLikeVaultFile is not a function` — the V17.5.8 hosted-vault module, replaced in V17.6.3 by the published copy) and one current test (`CI log rectified …`) correctly reported the 54 orphans.
* **Root cause.** Publishing a version by copying a package over the repository never deletes files that an earlier version had and the new one does not.
* **Correction in the application / pipeline (already in the V17.6.9 baseline, preserved and re-validated in V17.7).** `npm run check:stale` names every orphan and every stale test and fails; `scripts/stale-files.json` is the reviewed list (**59 files: 54 orphaned sources + 5 historical tests**, unchanged in V17.7); `node scripts/prune-orphans.mjs --delete` and `node scripts/prune-stale.mjs --delete` remove exactly those files and re-verify at deletion time. Nothing was restored, stubbed or excluded to make old tests pass.
* **What is still required from you (repository step).** The target repository must be cleaned **once**: `node scripts/prune-orphans.mjs --delete && node scripts/prune-stale.mjs --delete`, then `git add -A && git commit`. Until then CI keeps failing on exactly these 59 files, by design. See `docs/STALE_FILES_V17.7.md`.

## 2. `logs_104050659931` (and its duplicate) — Azure credentials missing (external configuration blocker)
* The preflight step stops with `##[error]The repository secret AZURE_CREDENTIALS is not set.` (the secret value is empty in the log: `AZURE:`). `SQLA_GITHUB_PAT`, `SQLA_GITHUB_CLIENT_ID` and `SQLA_ALLOWED_ORIGINS` were present.
* **Not an application defect.** The workflow behaved correctly (V17.6.9 reports every missing key at once, by name, and refuses to continue); Azure login is not bypassed. It needs the repository secret `AZURE_CREDENTIALS` to be created by an administrator with access to the Azure subscription.
* **One thing to check, not verified here:** the log shows `APP: Signin sql-query-gen` for the variable **`SQLA_BROKER_APP_NAME`** — a value that contains a space. Azure app names do not contain spaces, so this may be a mistyped variable (for example the name of a different resource). This review cannot confirm the real name; please check the variable against the actual Azure app.

## 3. `logs_104050744994` — the central PAT is refused by the organization's identity policy (external blocker)
* `verify-pat.mjs` reports `GitHub accepted SQLA_GITHUB_PAT but refused it for this repository (HTTP 403)` with GitHub's own message `AADSTS53003: Access has been blocked by Conditional Access policies.`
* **Not an application defect.** The failure is reported as a failed verification (never as success) with the upstream message. Possible causes (not verified): the token's approval is pending, SSO is not authorized for the token, a Conditional Access / IP policy applies to the runner, or the token's resource owner is not the organization. A source change cannot lift the policy; the tenant's identity / GitHub Enterprise administrators must.
* **Does not block the Admin Password flow of V17.7.** Reading and publishing the data folder uses the built-in `GITHUB_TOKEN` (`publish-data.yml`), not this PAT; devices read the published copy without any credential.

## 4. Summary
| Finding | Class | Action in V17.7 |
|---|---|---|
| 155 / 54 TypeScript errors from files of earlier versions | repository defect | detection and reviewed removal in place (`check:stale`, prune scripts); **repository must be cleaned once** |
| 23 failing historical tests | repository defect (stale tests) | same; the production tests pass 100 % |
| `AZURE_CREDENTIALS` not set | external configuration | none possible in code; deployment stays blocked by design |
| `SQLA_BROKER_APP_NAME` contains a space | probable configuration error (unverified) | flagged |
| PAT 403 `AADSTS53003` | external policy | none possible in code; reported honestly |

None of the five archives contains evidence of a defect in the Admin Password flow. The defect that this release addresses (the production page carried a browser-test back door and the default password was inferred from the *absence* of a verifier) was found by reading the V17.6.9 source, not in the logs — see `docs/VERIFICATION_REPORT_V17.7.md`.
