# Changelog — V17.7.5 (from V17.7.4)

V17.7.5 removes npm and Azure dependencies from the GitHub workflows. SQL Assistant now builds, tests, verifies and deploys with Node and the default GitHub token only. Optional services are packaged by credential-free workflows and run on any host. SQL Assistant behaviour, automatic token synchronization, security controls and usage-analytics privacy are unchanged.

## Added
* `scripts/ci.mjs` (the ordered stage list), `scripts/check-workflows.mjs` + `scripts/workflow-policy.mjs` (the guard and its one allow-list), `scripts/package-service.mjs` (service packaging and self test), `verifyCommitted` in `scripts/toolchain.mjs` and `check-toolchain.mjs --committed-only` (the Install verification).
* `.github/workflows/package-analytics-service.yml`, `package-repo-broker.yml` (credential-free packaging).
* Tests: `test/v1775.test.mjs`; fixtures `token-sync-baseline-v1774.json`, `ui-baseline-v1774.json`, `test-adaptations-v1775.json`.
* Docs: `WORKFLOW_DEPENDENCIES_V17.7.5.md`, this changelog and the other V17.7.5 release documents; a host-neutral hosting section in `DEPLOYMENT.md`, `ANALYTICS.md`, `CENTRAL_PAT.md`.
## Changed
* `deploy-pages.yml`: direct `node` calls, Install = verification only (no fallback), new Workflow guard stage; comments updated.
* `package.json`: version, scripts `ci`, `check:workflows`, `package:*` (the npm scripts remain for local convenience; no workflow uses them).
* `server/analytics-service.mjs`: two **comments** no longer name a cloud product (code lines identical).
* About entry (`src/ui/pages/other.ts`), `APP_VERSION`, NLU label, README, docs.
## Removed
* `deploy-analytics.yml`, `deploy-broker.yml` (Azure deployment). See the broker paragraph in `RELEASE_NOTES_V17.7.5.md`.
## Unchanged (pinned by tests)
Token synchronization (in-app files, `publish-data.yml`, `verify-repo-pat.yml`, their scripts, the broker), every `src/ui` module except the About page, the style sheet, the favicon, SQL generation, the Admin Password.
