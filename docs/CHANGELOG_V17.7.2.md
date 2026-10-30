# Changelog — V17.7.2 (from V17.7.1)

## Added
* **Describe What You Need – Read Only Query Builder** and **Describe What You Need – Query Builder for CR** (hamburger group *Describe What You Need*; `src/ui/pages/describeNeed.ts`): two cards each — *Describe What You Need (optional)* and *Result* (idle · loading · success · needs review · error; Copy, Format SQL, Validate, Regenerate, Clear; Read Only also Accept & Learn, Report issue; *Open in Query Builder* as an explicit one-way hand-over).
* `src/v17/engines/nlAssessment.ts` — honest result assessment (success / review / error) for both workflows.
* `src/v17/engines/llmContext.ts` — relevance-ranked, relationship-aware schema context for the optional AI/LLM Model.
* `src/utils/sqlFormat.ts` — whitespace-only SQL formatter.
* `src/v17/services/centralConfig.ts` — centrally maintained repository configuration (`sql-assistant-data/config/repository-config.json`); GitHub Repository card: central status, *Check for updated configuration*, recent activity. See `docs/CENTRAL_CONFIG.md`.
* Browser suite `scripts/browser_test_v1772.py`, unit tests `test/v1772.test.mjs`, UI baseline `test/fixtures/ui-baseline-v1771.json`.

## Fixed in the revised build
* **Saving the repository configuration failed with "Writing sql-assistant-data/config/repository-config.json failed: repository, branch or file not found."** when the device was set to a repository other than the application default and the token covered only that repository. The record is now written to the repository in force (primary) and mirrored best-effort into the default repository; see `docs/CENTRAL_CONFIG.md`. Regression tests: `test/v1772.test.mjs` (§ 8, including the real GitHub client against a fake GitHub API).

## Changed
* Read Only and CR Query Builders: the description card was removed from the main layout; **Generated SQL is directly below Manual Selectors**; a short hint points to the new menu options.
* `queryOrchestrator.generateFromDescription` takes `{ independent: true }` (no Manual Selector state / override markers); without it the V17.7.1 behaviour is unchanged.
* `aiLlmService.requestSqlFromModel` accepts `{ dialect }`; with it the prompt states dialect, allowed relationships and an `UNSUPPORTED:` escape (without it the V17.7.1 prompt text is unchanged).
* `crEngine.parseCrDescription` — values keep typed case/spaces, first command decides, whole table names, views refused, unknown columns reported (`docs/NL_SQL_ROOT_CAUSE_V17.7.2.md`).
* `repositoryConfig.writeRepositoryConfig` — the local write of `saveRepositoryConfig` extracted unchanged into a shared transactional helper.
* Repository card saves through the central service; start-up, scheduled synchronization and the *Sync* button pull the central configuration first.
* Quick Start cards, About version history, guided-walkthrough step 4 (now opens the Read Only description page), stamped `17.7.2`.

## Unchanged (verified by tests)
Style sheet and favicon, Manual Selectors, SQL engine, Query Library, schema import / synchronization, Settings, the Admin Password and token handling, the application name *SQL Assistant*, `repositoryDefaults` / `DEFAULT_REPOSITORY`.
