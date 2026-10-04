# V17.2.1 Test Report

Run on 2026-10-04. TypeScript strict compile: 0 errors (upgrade package and patched mock V17.2 project).

## Unit / regression tests (real AP schema 77 file)
- ✔ Baseline reproduction: unmigrated AP schema 77 fails exactly like the V17.1+ report (#1..#3 …and 434 more) (7.9308ms)
- ✔ Test 1 — legacy schema without writer stamp → detected as legacy → migration → validation → success (14.211811ms)
- ✔ Test 2 — empty decode raw values are restored from the legacy "code" field (R1), values preserved exactly (7.928627ms)
- ✔ Test 3 — all 437 decode entries processed, no partial migration, nothing deleted (6.487418ms)
- ✔ Test 3b — variants: { code, label } without rawValue, and the original document format (55.522661ms)
- ✔ Test 4 — invalid decode structure fails safely with exact location (no guessing NULL vs empty string) (35.038672ms)
- ✔ Test 5 — valid current schema: no migration, normal validation succeeds, output identical (0.757594ms)
- ✔ Valid legacy schema with no data problems is not rejected for the missing stamp — it is only stamped (0.495609ms)
- ✔ Test 6 — multiple schemas processed independently (current + legacy + unrecoverable) (54.792888ms)
- ✔ Test 7 — migration repeat: migrated schema needs no migration again (no loop), deterministic (32.607633ms)
- ✔ Cross-version: V17.0 publishes → V17.2.1 migrates → publishes → another V17.2.1 device downloads clean (18.204755ms)
- ✔ Publish protection: an invalid schema is never published (11.141749ms)
- ✔ Validator is not weakened: relationships, identifiers, nullable, duplicate columns, decode label types (1.021327ms)
- ✔ Generic, not special-cased: rule applies to any column/table name (0.457968ms)
- ✔ Diagnostics never expose secrets (38.594436ms)
- ℹ pass 15
- ℹ fail 0

## Patcher
- Dry run, apply, re-run (idempotent: 'already hooked'), typecheck, `npm test` through the project's own runner, production build — all passed on a mock V17.2 project with the V17 build pipeline.

## Real-browser sync test (headless Chromium, built dist/index.html)
- PASS Browser title is "SQL Assistant"
- PASS Header shows SQL Assistant · V17.2.1: SQL Assistant · V17.2.1
- PASS No diagnostics box before sync (empty container)
- PASS Sync: only the unrecoverable schema rejected → 1 of 3 schema(s) in the repository failed validation and were not loaded — your local copies were kept unchanged.
- PASS AP schema 77 loaded with restored decode values (77 tables)
- PASS All 437 decode entries present after sync
- PASS Writer stamp added (schemaFormat 17.2.1)
- PASS Unrecoverable schema not loaded (local protected)
- PASS Diagnostics panel shows: Migration successful
- PASS Diagnostics panel shows: Migrated schema
- PASS Diagnostics panel shows: Migration failed
- PASS Diagnostics panel shows: Legacy schema migration could not be completed
- PASS Diagnostics panel shows: Location: IA_ACTION_LOG.ROOT_DOCUMENT_TYPE
- PASS Diagnostics panel shows: …and 434 more
- PASS Diagnostics panel shows: existing valid local schema was preserved
- PASS Re-sync of migrated data: All 2 schema(s) loaded.
- PASS After restart: migrated AP schema 77 syncs without failure
- PASS No console/runtime errors
- 18 passed, 0 failed

## Not verified here
- The real V17.2 source could not be opened from SharePoint, so the patcher was verified on a mock with the same choke points as V17.0 (`validateIncomingRegistryFile`, `sanitizeIncomingSchema`). NLU, Manual Selectors, Manual Schema Update, Secret Vault and AI/LLM Model are not modified by this upgrade; run your existing V17.2 smoke test after applying.
