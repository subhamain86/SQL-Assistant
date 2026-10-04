# AP-SQL Assistant — V17.1 (complete project)

**V17.1 is a stability release.** It fixes *"Schema synchronization failed: the remote schema file failed validation"* at its root cause, keeps validation fully enabled, and leaves the V17.0 UI and features unchanged.

- **Run it:** open or host **`dist/index.html`**. It is one self-contained file and also works from disk (file://).
- **Build it:** `npm install && npm run verify` (clean → typecheck → tests → build). Requires Node.js 18+.
- **After upgrading:** follow the three steps in `docs/DEPLOYMENT.md` once to clear the synchronization error on all devices.

## Documentation
| File | Contents |
|---|---|
| `docs/ROOT_CAUSE_V17.1.md` | Full investigation: where validation failed, why, and every contributing defect |
| `docs/CHANGELOG_V17.1.md` | All V17.1 fixes and additions |
| `docs/TEST_REPORT_V17.1.md` | Clean-build verification, 50 unit/integration tests, 55 browser checks |
| `docs/DEPLOYMENT.md` | Deploy, build, and recovery steps |
| `docs/CHANGELOG_V17.0.md` | V17.0 features (offline NLU, AI / LLM Model, encrypted vault sync, …) |
| `docs/SOURCE_PROVENANCE.md` | How the source baseline was obtained |

## Project layout
| Path | Purpose |
|---|---|
| `dist/index.html` | **The application** (deploy this) |
| `src/` | TypeScript source (82 files) |
| `src/v17/sync/schemaFormat.ts` | **V17.1:** the single schema format authority (parse → normalise → validate → repair) |
| `src/services/syncService.ts` | Repository sync: publish gate, per-schema verdict, recovery |
| `src/services/githubApiService.ts` | GitHub API, including large files and precise errors |
| `src/v17/` | V17 modules (NLU, learning, AI / LLM, vault sync, schema records) |
| `scripts/` | `build.mjs`, `run-tests.mjs`, `smoke_test.py`, `diagnose-registry.mjs`, `check-imports.mjs`, `clean.mjs` |
| `test/` | Unit and integration tests (V16 baseline, V17.0, V17.1 synchronization) |
| `public/favicon.svg` | Icon (embedded into the build) |
