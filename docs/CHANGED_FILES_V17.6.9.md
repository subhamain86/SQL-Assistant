# Changed files — V17.6.9 against the V17.6.8 package

Compared by SHA-256 of every file (node_modules, build/, test-results/ excluded). Nothing is deleted from the package: the stale files of earlier versions listed in `docs/STALE_FILES_V17.6.9.md` were never part of it.

**Source (src/) — 7 files:** `src/services/passwordService.ts`, `src/v17/services/adminPassword.ts`, `src/ui/pages/settings.ts`, `src/ui/pages/other.ts`, `src/main.ts`, `src/v17/sync/schemaFormat.ts` (APP_VERSION), `src/v17/engines/nluEngine.ts` (NLU label). No other source file changed.

### Added (39)
* `docs/CHANGED_FILES_V17.6.9.md`
* `docs/CHANGELOG_V17.6.9.md`
* `docs/PUBLISH_DEPLOY_RESULTS_V17.6.9.md`
* `docs/REGRESSION_BASELINE_V17.6.9.md`
* `docs/RELEASE_NOTES_V17.6.9.md`
* `docs/ROLLBACK_V17.6.9.md`
* `docs/STALE_FILES_V17.6.9.md`
* `docs/TEST_REPORT_V17.6.9.md`
* `docs/VERIFICATION_REPORT_V17.6.9.md`
* `rollback/SQL-Assistant-V17.6.8.zip`
* `scripts/browser_test_v1769.py`
* `scripts/check-stale.mjs`
* `scripts/check-toolchain.mjs`
* `scripts/prune-stale.mjs`
* `scripts/stale-files.json`
* `scripts/verify-artifact.mjs`
* `test-results-v17.6.9/browser/browser_test.txt`
* `test-results-v17.6.9/browser/browser_test_v174.txt`
* `test-results-v17.6.9/browser/browser_test_v175.txt`
* `test-results-v17.6.9/browser/browser_test_v1751.txt`
* `test-results-v17.6.9/browser/browser_test_v1752.txt`
* `test-results-v17.6.9/browser/browser_test_v1754.txt`
* `test-results-v17.6.9/browser/browser_test_v1755.txt`
* `test-results-v17.6.9/browser/browser_test_v1757.txt`
* `test-results-v17.6.9/browser/browser_test_v1761.txt`
* `test-results-v17.6.9/browser/browser_test_v1762.txt`
* `test-results-v17.6.9/browser/browser_test_v1763.txt`
* `test-results-v17.6.9/browser/browser_test_v1765.txt`
* `test-results-v17.6.9/browser/browser_test_v1766.txt`
* `test-results-v17.6.9/browser/browser_test_v1767.txt`
* `test-results-v17.6.9/browser/browser_test_v1768.txt`
* `test-results-v17.6.9/browser/browser_test_v1769.txt`
* `test-results-v17.6.9/node-tests.txt`
* `test-results-v17.6.9/verify-no-npm-full.txt`
* `test-results-v17.6.9/verify-no-npm-summary.txt`
* `test/fixtures/historical-stamps.json`
* `test/fixtures/ui-baseline-v1768.json`
* `test/support/version.mjs`
* `test/v1769.test.mjs`

### Changed (46)
* `.github/workflows/deploy-broker.yml`
* `.github/workflows/deploy-pages.yml`
* `README.md`
* `dist/index.html`
* `docs/ADMIN_PASSWORD.md`
* `docs/DEPLOYMENT.md`
* `index.html`
* `package.json`
* `release/404.html`
* `release/index.html`
* `release/version.json`
* `scripts/browser_test.py`
* `scripts/browser_test_v174.py`
* `scripts/browser_test_v175.py`
* `scripts/browser_test_v1751.py`
* `scripts/browser_test_v1752.py`
* `scripts/browser_test_v1754.py`
* `scripts/browser_test_v1755.py`
* `scripts/browser_test_v1757.py`
* `scripts/browser_test_v1761.py`
* `scripts/browser_test_v1762.py`
* `scripts/browser_test_v1763.py`
* `scripts/browser_test_v1765.py`
* `scripts/browser_test_v1766.py`
* `scripts/browser_test_v1767.py`
* `scripts/browser_test_v1768.py`
* `scripts/build.mjs`
* `scripts/prune-orphans.mjs`
* `scripts/security_check.mjs`
* `scripts/verify-no-npm.mjs`
* `scripts/verify-pat.mjs`
* `src/main.ts`
* `src/services/passwordService.ts`
* `src/ui/pages/other.ts`
* `src/ui/pages/settings.ts`
* `src/v17/engines/nluEngine.ts`
* `src/v17/services/adminPassword.ts`
* `src/v17/sync/schemaFormat.ts`
* `test/password.test.mjs`
* `test/v1757.test.mjs`
* `test/v1763.test.mjs`
* `test/v1764.test.mjs`
* `test/v1765.test.mjs`
* `test/v1766.test.mjs`
* `test/v1767.test.mjs`
* `test/v1768.test.mjs`

### Removed (0)
_none_

Generated outputs among the above: `dist/index.html`, `index.html`, `release/404.html`, `release/index.html`, `release/version.json`.
