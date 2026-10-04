# SQL Assistant V17.2.1

Offline natural-language SQL builder with schema management, legacy-schema migration, encrypted
repository synchronization and an optional AI/LLM Model.

## Quick start
```bash
npm install          # TypeScript only (no runtime dependencies)
npm run build        # clean production build → dist/
npm run serve        # http://localhost:8080
```

## Verify (clean → typecheck → lint → unit tests → real-browser tests)
```bash
npm run verify
```
* Unit/regression tests: `npm test` (Node ≥ 20, `node:test`), 31 tests.
* Browser tests: `npm run test:browser` (Python 3 + `pip install playwright` + `playwright install chromium`;
  or set `CHROME_PATH` to an existing Chrome/Chromium). They run the production build in Chromium (51 checks).
  Results are written to `test-results/browser-results.json`.

## Project layout
| Path | Purpose |
|---|---|
| `src/v17/sync/schemaFormat.ts` | Schema format detection, **legacy migration rules**, strict recursive validator, writer stamp, source recovery |
| `src/v17/sync/syncService.ts` | Synchronization pipeline (download → migrate → validate → merge → persist → publish) |
| `src/services/schemaService.ts` | Centralized saved schema data, Active Schema, Manual Schema Update, import |
| `src/v17/engines/nluEngine.ts` | Offline self-training NLU for *Describe What You Need* |
| `src/v17/services/learningStore.ts` | Controlled, schema-scoped learning from accepted/corrected SQL |
| `src/v17/engines/advancedOptionsResolver.ts` | Automatic inference + manual precedence for Advanced Options |
| `src/v17/engines/schemaRecordEngine.ts` | Row-wise edit/delete with dependency protection |
| `src/v17/services/cryptoBox.ts`, `secretVault.ts` | AES-256-GCM vault (PBKDF2 passphrase for the repository copy, non-extractable device key locally) |
| `src/v17/services/aiLlmService.ts` | Optional AI/LLM Model (OpenAI, Azure OpenAI, Anthropic, custom) |
| `src/ui/**` | Pages: Quick Start, Read Only Query Builder, Query Builder for CR, Schema Used, Error Rectifier, Settings, About |
| `test/` | Regression tests incl. the real AP schema 77 fixture |
| `scripts/` | build, lint, browser test |
| `docs/` | Root-cause analysis, migration rules, test matrix |

See `docs/V17.2.1-SCHEMA-MIGRATION.md` for the root cause and the migration rules, and `CHANGELOG.md`.
