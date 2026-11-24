# Changed files — V17.7.5 versus V17.7.4

The V17.7.4 reference is the package **as supplied** (the rebuilt rollback, see `docs/ROLLBACK_V17.7.5.md`): favicon, three compiler files and the two browser suites were restored/re-created in it first, so they are not listed as changes.

**New (18):**
* `.github/workflows/package-analytics-service.yml`
* `.github/workflows/package-repo-broker.yml`
* `docs/CHANGED_FILES_V17.7.5.md`
* `docs/CHANGELOG_V17.7.5.md`
* `docs/REGRESSION_BASELINE_V17.7.5.md`
* `docs/RELEASE_NOTES_V17.7.5.md`
* `docs/ROLLBACK_V17.7.5.md`
* `docs/TEST_REPORT_V17.7.5.md`
* `docs/VERIFICATION_REPORT_V17.7.5.md`
* `docs/WORKFLOW_DEPENDENCIES_V17.7.5.md`
* `scripts/check-workflows.mjs`
* `scripts/ci.mjs`
* `scripts/package-service.mjs`
* `scripts/workflow-policy.mjs`
* `test/fixtures/test-adaptations-v1775.json`
* `test/fixtures/token-sync-baseline-v1774.json`
* `test/fixtures/ui-baseline-v1774.json`
* `test/v1775.test.mjs`

**Changed (22):**
* `.github/workflows/deploy-pages.yml`
* `README.md`
* `docs/ANALYTICS.md`
* `docs/ANALYTICS_SERVERLESS.md`
* `docs/CENTRAL_PAT.md`
* `docs/DEPLOYMENT.md`
* `docs/SECURITY.md`
* `package.json`
* `scripts/check-toolchain.mjs`
* `scripts/toolchain.mjs`
* `server/analytics-service.mjs`
* `src/ui/pages/other.ts`
* `src/v17/engines/nluEngine.ts`
* `src/v17/sync/schemaFormat.ts`
* `test/support/version.mjs`
* `test/v1762.test.mjs`
* `test/v1763.test.mjs`
* `test/v1764.test.mjs`
* `test/v1768.test.mjs`
* `test/v1769.test.mjs`
* `test/v1773.test.mjs`
* `test/v1774.test.mjs`

**Removed (2):**
* `.github/workflows/deploy-analytics.yml`
* `.github/workflows/deploy-broker.yml`

generated, not listed: `index.html`, `dist/index.html`, `release/**`, `dev-dist/index.html` (rebuilt, version 17.7.5).

**Token synchronization (byte-identical to V17.7.4, pinned by `test/fixtures/token-sync-baseline-v1774.json`):** every file of the token / Secret Vault / central-access / central-configuration / published-fallback logic, `publish-data.yml`, `verify-repo-pat.yml`, `scripts/publish-data.mjs`, `build-central-vault.mjs`, `verify-pat.mjs`, `github-device-relay.mjs`, `reset-admin-password.mjs`, `server/repo-broker.mjs` — except `src/v17/sync/schemaFormat.ts` (the `APP_VERSION` stamp only).

**UI (pinned by `test/fixtures/ui-baseline-v1774.json`):** only `src/ui/pages/other.ts` (the About entry) changed; the style sheet and the favicon are byte-identical.

**Earlier tests edited** (`test/fixtures/test-adaptations-v1775.json`; reversible to the V17.7.4 hash): `v1762`, `v1763`, `v1764`, `v1768`, `v1769` (the ones on the "run unchanged" list — each for a retired workflow, a renamed workflow file or the V17.7.4 `node_modules` defect) and `v1773`, `v1774` (own tests of the two previous releases). `v1761`, `v1765`, `v1766`, `v1767`, `v1771`, `v1772` are untouched.
