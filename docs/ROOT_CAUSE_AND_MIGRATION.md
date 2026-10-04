# V17.2.1 — root cause and migration rules

## Root cause (confirmed on the real file)
AP schema 77 (the "Alusta DB Description" schema: 77 tables, 1,561 columns) stores every decode entry as
`{ "code": "Invoice.Domain.Invoice", "label": "Invoice" }`. SQL Assistant's model is `{ rawValue, label }`.
A device on V17.0 or older imported/published the schema **without mapping `code` → `rawValue`** and without validating,
so all **437** decode entries reached the repository with an empty raw value (3 shown + "…and 434 more" = 437).
The value was never empty — it is still present under the legacy key. V17.1+ correctly rejects `rawValue: ""`,
so the schema failed on every sync.

**Classification of the empty value:** a parser/export defect (field-name mismatch) — not a NULL mapping,
not an empty-string mapping, not intentional data. No decode entry in the source file has an empty code.

## Pipeline
`Download → Parse → Detect format → Legacy migration (if needed) → Normalize → Validate (unchanged rules) → Persist → Active schema refresh`
- Current schema: validated, unchanged.
- Legacy schema: migrated, validated, stamped, persisted; published clean by the next V17.2.1 push.
- Unrecoverable schema: left untouched → the existing validator rejects it → local copy kept unchanged.
Each schema is processed independently.

## Rules (recorded in `schemaFormat.migrationRules`)
| Rule | Repair |
|---|---|
| R1 | Empty/missing `rawValue` ← legacy alias (`code`, `raw`, `value`, `raw_value`, `rawvalue`, `key`). Conflicting aliases → fail. |
| R2 | Numeric/boolean raw values → string |
| R3 | `"RAW=Label"` strings / `{RAW: "Label"}` maps → entries |
| R4 | Missing label ← `description`/`name`/`text`/`meaning` |
| R5 | `decode: null`, `alias: null` → removed |
| R6 | `primary_key`/`foreign_key` → `isPrimaryKey`/`isForeignKey`+`references`; missing label ← column name |
| R7 | `schema_name`/`schema_version`/`notes` → `name`/`version`/`description`; missing relationships → `[]` |
| R8 | String booleans → booleans |

**Not repaired (fails with exact location):** empty raw value with no recoverable code (NULL vs '' cannot be
determined), conflicting values, duplicate raw values, non-object entries, malformed foreign keys.
Validation is not weakened; no table, column or meaningful decode is deleted.

## Writer stamp
```json
"schemaFormat": { "app": "SQL Assistant", "appVersion": "17.2.1", "formatVersion": 3, "writer": "17.2.1",
                  "generatedAt": "…", "migratedFrom": "legacy-unstamped", "migrationRules": ["R1"] }
```
A migrated schema is detected as `current` next time → no repeated migration, no loop.

## Integration notes
- The patcher hooks `validateIncomingRegistryFile` and `sanitizeIncomingSchema` (the V17.x choke points for
  sync, import and replace). If V17.2 renamed them, the patcher stops without writing anything.
- Publish protection: V17.1+ already validates before publishing; `prepareForPublish()` is provided for the
  push path if you want the stamp on every published schema.
- If V17.2's sanitizer rebuilds schema objects field-by-field, the `schemaFormat` key may be dropped on
  import; data stays migrated and the next sync only re-stamps (no data change, no failure).
- Storage keys (`sqla.*`) and internal identifiers are not renamed.
