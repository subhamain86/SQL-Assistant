# V17.0 Test Report

| Check | Result |
|---|---|
| `npm run typecheck` (strict TypeScript, ES2020) | 0 errors |
| `npm test` — unit and integration tests against the real sources | **62 / 62 passed** |
| `npm run smoke` — end-to-end test of the built `dist/index.html`, opened via file:// in headless Chromium | **70 / 70 passed**, no unexpected console errors |

GitHub and AI / LLM network calls cannot reach the internet from the build sandbox, so they were tested as failure paths:
- **Secret Vault push:** fails with a specific error and the token is not exposed.
- **AI / LLM:** falls back to the offline engine.
- **Success paths:** tested with mocked repository and model responses in the unit tests.

Check both once on your network.

## Unit / integration tests
- ✔ sqlEngine: basic SELECT with join and filter
- ✔ sqlEngine: dialect limits (Oracle FETCH FIRST, SQL Server TOP, others LIMIT) and schema DECODE
- ✔ crEngine: UPDATE/DELETE without WHERE is blocked; confirmed no-WHERE is allowed with warning
- ✔ crNlpEngine: "Update invoice 1234 status to Approved"
- ✔ errorRectifier: ORA-00904 produces a review comment
- ✔ schema-authoritative filtering discards fabricated tables
- ✔ isCopilotConfigured requires every field
- ✔ V16.1: real-world data types valid in schema and registry validation
- ✔ default schemas are internally valid
- ✔ V16.2: error containers render empty (no hidden-attribute pattern)
- ✔ V16.4/16.5: Active Schema pointer last-write-wins
- ✔ V16.5: discoverPublicRegistry merges content before syncing the Active Schema pointer
- ✔ V16.5: GitHub calls have a timeout
- ✔ V17: Secret Vault no longer auto-pushes to the repository
- ✔ V16 baseline: buildSelectSQL join + filter unchanged
- ✔ V16 baseline: destructive SQL still rejected by read-only validator
- ✔ V16 baseline: fabricated AI table is discarded by filterToKnownTables
- ✔ V16 baseline: parseRequirement still works (kept as the NLU starting point)
- ✔ V16.1 fix preserved: real-world data types remain valid
- ✔ Filter quoting: user text is still quoted; only whitelisted generated date expressions pass through
- ✔ 1. simple SELECT
- ✔ 2. multiple tables + 3. JOIN (direct)
- ✔ 3. JOIN via bridge table
- ✔ 3b. JOIN derived from foreign-key metadata (no explicit relationship row)
- ✔ 4. WHERE condition from business value (decode label)
- ✔ 5. multiple conditions
- ✔ 5b. negation and OR lists are correct (no contradictory AND)
- ✔ 5c. string conditions: contains / ends with / is empty
- ✔ 6. date filtering — explicit year, range, relative (Generic / Oracle / SQL Server / MySQL)
- ✔ 7. ORDER BY (explicit and "latest N")
- ✔ 8. GROUP BY + 9. aggregation (SUM / COUNT / AVG)
- ✔ 10. DISTINCT
- ✔ 11. complex SELECT (ranking + aggregate + join + conditions + dates + limit)
- ✔ Active schema awareness: unknown identifier is reported, never silently added
- ✔ Active schema awareness: no false table from substrings (e.g. "PO" inside "posting")
- ✔ Error handling: empty active schema → ACTIVE_SCHEMA_UNAVAILABLE; unknown text → OFFLINE_MODEL_UNABLE
- ✔ Advanced Options: manual settings are never overwritten by the description engine
- ✔ Advanced Options: all existing options still render in SQL (DISTINCT, GROUP BY, HAVING, LIMIT, CTE, RECURSIVE, manual CASE)
- ✔ Advanced Options: consistency check flags a GROUP BY that does not cover selected columns
- ✔ Learning: records queries; one-off is NOT used; repeated is used; accepted is confirmed
- ✔ 12. user-modified SQL: valid edits are accepted, unsafe or schema-invalid edits are rejected
- ✔ Learning: accepted pattern influences a similar later request
- ✔ Learning survives restart (same storage, new instance) and is skipped when the schema no longer has its columns
- ✔ Learning sync: per-device counters merge idempotently; literals are masked for the repository
- ✔ Edit row: only the selected record changes
- ✔ Edit row: renaming a referenced column updates its relationships and FK references explicitly
- ✔ Invalid / malformed records are rejected before saving
- ✔ Real-world data types are preserved when editing (no silent change to VARCHAR)
- ✔ Delete row: leaf column removes only that record
- ✔ Delete row: referenced column is blocked (no silent invalid state); cascade is explicit and leaves a valid schema
- ✔ Schema service: edit/delete persist to the centralized registry, survive reload, and do not touch other schemas
- ✔ SQL generation uses the modified schema immediately (rename) and after a delete
- ✔ Vault: secret is encrypted; repository content never contains the token (plain or base64)
- ✔ Vault: push works and pull/decrypt works on another device; wrong passphrase / tampering / downgrade are handled safely
- ✔ Vault: weak passphrase rejected; repository errors never expose the token
- ✔ No AI/LLM configured → offline NLU still works
- ✔ AI/LLM enabled → model is used; its SQL is validated against the Active Schema
- ✔ AI/LLM returning unsafe or non-schema SQL is rejected; offline result kept
- ✔ Invalid AI/LLM configuration → clear error, offline still works
- ✔ AI/LLM unavailable (network error / timeout / 401) → app stays functional; key never in messages
- ✔ Migration: V16 Online AI/NLP Endpoint becomes an AI / LLM Model (custom endpoint) once
- ✔ Provider request shapes (OpenAI-compatible, Azure, Anthropic, custom)

## End-to-end browser checks
- ✔ App shell renders from file:// (single self-contained file)
- ✔ Version V17 shown in navbar and footer
- ✔ Page renders: readonly
- ✔ Page renders: cr
- ✔ Page renders: schema-used
- ✔ Page renders: error-rectifier
- ✔ Page renders: about
- ✔ Page renders: quickstart
- ✔ Hamburger navigation opens
- ✔ Navigation via hamburger works and closes the menu
- ✔ Top cards on Read Only builder have equal widths (V16.1)
- ✔ Manual table selection generates SQL
- ✔ Manual column selection generates SQL
- ✔ Describe → SQL contains SUM(INVOICE_HEADER.INVOICE_AMOUNT)
- ✔ Describe → SQL contains INVOICE_HEADER.STATUS = 'A'
- ✔ Describe → SQL contains DATE '2025-01-01'
- ✔ Describe → SQL contains GROUP BY VENDOR.VENDOR_NAME
- ✔ Describe → SQL contains ORDER BY SUM(INVOICE_HEADER.INVOICE_AMOUNT) DESC
- ✔ Describe → SQL contains FETCH FIRST 5 ROWS ONLY
- ✔ Engine badge shows Offline NLU (no AI/LLM configured)
- ✔ No error box when there is no error (Read Only)
- ✔ Unknown column reported clearly and not added to SQL
- ✔ Advanced Options shows the automatic/manual strip
- ✔ Existing Advanced Option present: #advDistinct
- ✔ Existing Advanced Option present: #advGroupBy
- ✔ Existing Advanced Option present: #advHaving
- ✔ Existing Advanced Option present: #advLimit
- ✔ Existing Advanced Option present: #advRecursive
- ✔ Existing Advanced Option present: #addCteBtn
- ✔ Existing Advanced Option present: #addManualCaseBtn
- ✔ Existing Advanced Option present: #addManualDecodeBtn
- ✔ Manual LIMIT reflected in SQL
- ✔ Editing LIMIT marks it as manual
- ✔ CTE option still works
- ✔ Manual CASE column still works
- ✔ Accept & Learn opens with no error box
- ✔ Accepted query stored as learned knowledge
- ✔ CR builder: DELETE without WHERE blocked
- ✔ CR builder: description interpreted into UPDATE … WHERE
- ✔ Error Rectifier works
- ✔ Settings password error box is empty on load (V16.2)
- ✔ Wrong password shows an error
- ✔ Error clears when editing
- ✔ All Settings tabs present; "AI / NLP Engine" replaced by "AI / LLM Model"
- ✔ Edit row persisted to centralized schema registry
- ✔ Edit did not touch unrelated schema
- ✔ Malformed record rejected with a specific message
- ✔ Delete confirmation error box empty on open (V16.2)
- ✔ Delete removed only the selected row
- ✔ Deleting a referenced column asks about dependent records
- ✔ Cancelled dependent delete leaves schema unchanged
- ✔ Sync error indicator empty with no sync error
- ✔ Schema-name error box empty by default (V16.2)
- ✔ Schema import with real-world data types succeeds
- ✔ GitHub token saved and shown masked only
- ✔ Token not stored in plain text in browser storage
- ✔ V17 encrypted vault sync section present
- ✔ Push gives specific feedback without exposing the token
- ✔ AI / LLM tab shows offline engine as primary
- ✔ Invalid AI/LLM configuration gives a clear error
- ✔ Settings tab renders: Security
- ✔ Settings tab renders: Synchronization
- ✔ Settings tab renders: Danger Zone
- ✔ Schema edits/deletes survive reload and appear on Schema page
- ✔ Imported schema survives reload
- ✔ SQL generation respects deleted schema record
- ✔ Theme switch works
- ✔ Guided walkthrough starts
- ✔ Responsive: no horizontal overflow on mobile width
- ✔ No unexpected console errors
