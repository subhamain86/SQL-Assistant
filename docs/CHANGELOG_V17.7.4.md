# Changelog — V17.7.4 (from V17.7.3)

V17.7.4 makes Usage Analytics deployable without a server or cloud credentials. Analytics data is encrypted on the device and can be read only in the Analytics dashboard after administrator authentication. SQL Assistant continues to capture usage metadata only and does not capture SQL content, credentials, database results, or customer data.

## Added
* **Provider "repository"**: `src/v17/services/analyticsCrypto.ts` (WebCrypto: password-wrapped ECDH private key, hybrid encryption, policy), `analyticsRepo.ts` (device sink, set-up, unlock, change password, rotate keys, dashboard load, compaction, retention), `analyticsAggregate.ts` (the strict validator and the aggregation, parity-tested against the service), `src/ui/pages/analyticsRepoPanel.ts` (Set up wizard, Rotate keys, Publish public key, Compact), runtime / page / About / config integration (`analytics.repositoryPath`, `analytics.retentionDays`, `analytics.publicKey`).
* `SchemaRepository.list` / `remove` (token connection and the in-memory repository); `githubRepository(apiBase)` for tests only.
* **Registry-free build**: `tools/typescript/` (checksum-pinned TypeScript 5.8.3), `scripts/toolchain.mjs`, `scripts/tsc.mjs`; `build.mjs`, `check-toolchain.mjs`, `verify-no-npm.mjs` use them; `npm run typecheck` runs through node; the Pages Install step uses the committed compiler.
* Workflows: path filters keep analytics commits from triggering the Pages build and the data publication; `publish-data.mjs` never publishes `sql-assistant-data/analytics/**`; `deploy-pages.yml` writes the serverless configuration from variables; `deploy-analytics.yml` / `deploy-broker.yml` are marked optional.
* The real `public/favicon.svg` ships; `package.json` `test:browser` names only suites that exist (`test:browser:all` runs every suite present).
* Tests: `test/v1774.test.mjs`, `scripts/browser_test_v1774.py`, `test/support/analytics-github-stub.mjs`, `test/fixtures/ui-baseline-v1773.json`.

## Changed
`src/ui/analyticsRuntime.ts`, `src/ui/pages/analyticsPage.ts`, `src/ui/pages/other.ts` (About), `public/styles.css` (appended), `src/testHooks.ts` (`repoDump`, test build only), tracker (`retryAfterMs`, cadence options), config (union type), version stamps 17.7.4, `README.md`, docs. Historical tests: the V17.7.3 version test is now a documented historical test; `v1769` / `v1763` assertions about the browser chain and the publish-data trigger were adapted (intent kept), nothing else was weakened.

## Unchanged (verified by tests)
The V17.7.3 service provider and its 41 tests, every other `src/ui` module, the V17.7.3 bytes of the style sheet, the favicon, SQL generation, the Admin Password, repository / token / vault code.
