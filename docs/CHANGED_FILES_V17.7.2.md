# Changed files — V17.7.2

**New:** `src/ui/pages/describeNeed.ts` · `src/v17/engines/nlAssessment.ts` · `src/v17/engines/llmContext.ts` · `src/v17/services/centralConfig.ts` · `src/utils/sqlFormat.ts` · `scripts/browser_test_v1772.py` · `test/v1772.test.mjs` · `test/fixtures/ui-baseline-v1771.json` · `test/fixtures/repo-cards-v1771-lines.json` · `docs/*_V17.7.2.md`, `docs/CENTRAL_CONFIG.md`, `docs/NL_SQL_ROOT_CAUSE_V17.7.2.md`

**UI modules changed (the complete list, pinned in `ui-baseline-v1771.json → changedIn1772`):** `src/ui/components/navbar.ts` (menu group, Sync pulls the central configuration) · `src/ui/components/tourOverlay.ts` (step 4 route) · `src/ui/context.ts` (central-configuration service + connection, single repository builder) · `src/ui/pages/other.ts` (CR layout, Quick Start, About) · `src/ui/pages/readonly.ts` (layout, hand-over hook) · `src/ui/pages/schemaRepoCards.ts` (central status, save through the central service; 7 lines of V17.7.1 changed) · `src/ui/state.ts` (two routes).

**Other source:** `src/main.ts` (routes, start-up pull, scheduler) · `src/engines/crEngine.ts` · `src/v17/services/queryOrchestrator.ts` · `src/v17/services/aiLlmService.ts` · `src/v17/services/repositoryConfig.ts` · `src/services/storage.ts` (two storage keys) · `src/testHooks.ts` (test build only) · `src/v17/sync/schemaFormat.ts` and `src/v17/engines/nluEngine.ts` (version stamps).

**Not changed:** `public/styles.css`, `public/favicon.svg`, `.github/workflows/*`, `scripts/publish-data.mjs`, `server/`.

**Tests / config:** `package.json` (version, `test:browser`), `README.md`, `test/support/version.mjs`, `test/v1769.test.mjs` and `test/v1771.test.mjs` (historical pins re-scoped to exempt the modules V17.7.2 changed deliberately; the pins for every other module are unchanged).
