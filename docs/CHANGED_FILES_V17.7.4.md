# Changed files — V17.7.4 versus V17.7.3

**New:**
* `docs/ANALYTICS_SERVERLESS.md`
* `docs/CHANGELOG_V17.7.4.md`
* `docs/RELEASE_NOTES_V17.7.4.md`
* `docs/ROLLBACK_V17.7.4.md`
* `docs/analytics.config.repository.example.json`
* `scripts/browser_test_v1774.py`
* `scripts/toolchain.mjs`
* `scripts/tsc.mjs`
* `src/ui/pages/analyticsRepoPanel.ts`
* `src/v17/services/analyticsAggregate.ts`
* `src/v17/services/analyticsCrypto.ts`
* `src/v17/services/analyticsRepo.ts`
* `test/fixtures/ui-baseline-v1773.json`
* `test/support/analytics-github-stub.mjs`
* `test/v1774.test.mjs`
* `tools/typescript/CHECKSUMS.json`
* `tools/typescript/LICENSE.txt`
* `tools/typescript/README.md`
* `tools/typescript/ThirdPartyNoticeText.txt`
* `tools/typescript/bin/tsc`
* `tools/typescript/package.json`
* `tools/typescript/lib/**` — 54 vendored TypeScript library files (see `tools/typescript/README.md`)

**Changed:**
* `.github/workflows/deploy-analytics.yml`
* `.github/workflows/deploy-broker.yml`
* `.github/workflows/deploy-pages.yml`
* `.github/workflows/publish-data.yml`
* `README.md`
* `docs/DEPLOYMENT.md`
* `docs/SECURITY.md`
* `package.json`
* `public/styles.css`
* `scripts/build.mjs`
* `scripts/check-toolchain.mjs`
* `scripts/publish-data.mjs`
* `scripts/verify-no-npm.mjs`
* `src/testHooks.ts`
* `src/ui/analyticsRuntime.ts`
* `src/ui/pages/analyticsPage.ts`
* `src/ui/pages/other.ts`
* `src/v17/engines/nluEngine.ts`
* `src/v17/services/analyticsAdmin.ts`
* `src/v17/services/analyticsConfig.ts`
* `src/v17/services/analyticsTracker.ts`
* `src/v17/services/githubClient.ts`
* `src/v17/sync/schemaFormat.ts`
* `test/support/version.mjs`
* `test/v1763.test.mjs`
* `test/v1769.test.mjs`
* `test/v1773.test.mjs`
* generated: `index.html`, `dist/index.html`, `dev-dist/index.html`, `release/**` (rebuilt, version 17.7.4)

**Removed:** none

**Byte-identical to V17.7.3 (tested by `test/v1774.test.mjs` against `test/fixtures/ui-baseline-v1773.json`):** every `src/ui` module except `analyticsRuntime.ts`, `pages/analyticsPage.ts`, `pages/other.ts` (About); the favicon; the V17.7.3 bytes of `public/styles.css`; `server/analytics-service.mjs` and the V17.7.3 service provider code paths.
