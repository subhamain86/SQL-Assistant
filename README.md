# SQL Assistant — V17.2 (complete project)

SQL Assistant generates read-only and change-request SQL from the **Active Schema**. Its primary engine is an **offline self-training NLU**; an optional AI/LLM Model can be added.

- **Run it:** open or host **`dist/index.html`**. It is one self-contained file and also works from disk.
- **Develop:** `npm install`, then `npm run dev`. The server runs on http://localhost:5173 and rebuilds on change.
- **Verify:** `npm run verify` (clean → typecheck → lint → tests → production + development builds), then `npm run smoke`.
- **After upgrading:** read `docs/DEPLOYMENT.md`. Replace every old copy of the app, because V17.0-or-older copies publish schemas without validation.

| Document | Contents |
|---|---|
| `docs/ROOT_CAUSE_V17.2.md` | Why the synchronization error kept coming back, and the fixes |
| `docs/CHANGELOG_V17.2.md` | Everything new in V17.2 |
| `docs/SECURITY.md` | Secret Vault and repository-sync security model, including limitations |
| `docs/TEST_REPORT_V17.2.md` | Clean-build verification, 70 tests, 76 browser checks × 3 configurations |
| `docs/DEPLOYMENT.md` | Deploy, build and post-upgrade steps |
| `docs/ROOT_CAUSE_V17.1.md`, `docs/CHANGELOG_V17.1.md`, `docs/CHANGELOG_V17.0.md` | Earlier releases |
| `docs/SOURCE_PROVENANCE.md` | How the baseline was obtained |

| Path | Purpose |
|---|---|
| `dist/index.html` | The application (deploy this) |
| `src/` | TypeScript source (84 files) |
| `src/services/syncService.ts` | Repository sync: one location, 3-way merge, stale-copy guard, serialised operations, self-recovery |
| `src/v17/sync/schemaFormat.ts` | Single schema format authority (parse → normalise → validate → repair) |
| `src/v17/engines/nluEngine.ts` | Offline NLU (primary engine) |
| `src/v17/services/learningStore.ts` | Centralized learned query knowledge |
| `src/v17/engines/schemaRecordEngine.ts` | Row-wise Manual Schema Update |
| `scripts/` | build, dev server, tests, browser test, lint, diagnostics |
| `test/` | V16, V17.0, V17.1 and V17.2 test suites |
