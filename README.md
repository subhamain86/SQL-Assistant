# SQL Assistant V17.2.1 — upgrade package

Fixes the schema synchronization failure for schemas written by SQL Assistant V17.0 or older
(e.g. **AP schema 77**: `IA_ACTION_LOG.ROOT_DOCUMENT_TYPE has a decode entry (#1) with an empty raw value … and 434 more`)
and renames the application to **SQL Assistant**.

## Apply to your V17.2 project
```bash
node tools/apply-v1721.mjs <path>/SQL-Assistant-V17.2            # dry run — shows every change
node tools/apply-v1721.mjs <path>/SQL-Assistant-V17.2 --write    # apply (backup in .v1721-backup/)
cd <path>/SQL-Assistant-V17.2 && npm install && npm run typecheck && npm test && npm run build
```
Rollback: copy `.v1721-backup/<timestamp>/` back.

## Contents
| Path | Purpose |
|---|---|
| `src/v1721/legacySchemaMigration.ts` | Detect → normalize → repair (explicit rules R1–R8) → validate → stamp |
| `src/v1721/schemaValidator.ts` | Recursive validator with exact paths (schema › table › column › decode[i] › property) |
| `src/v1721/schemaFormat.ts` | Writer stamp (`schemaFormat`: app version, format version, writer, timestamp) |
| `src/v1721/syncHooks.ts` | Hooks for `validateIncomingRegistryFile` / `sanitizeIncomingSchema` |
| `src/v1721/diagnostics.ts`, `ui.ts` | User messages + status badges in Settings → Schema Management |
| `tools/apply-v1721.mjs` | Patcher (hooks, branding, version, tests) — all-or-nothing, idempotent |
| `test/` | 15 regression tests using the real AP schema 77 file |
| `docs/AP-schema-77.migrated.json` | AP schema 77 already migrated — importable immediately |
| `verification/` | Mock V17.2 project + real-browser sync test used for verification |

See `docs/ROOT_CAUSE_AND_MIGRATION.md` and `docs/TEST_REPORT_V17.2.1.md`.
