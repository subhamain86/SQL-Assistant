# SQL Assistant V17.2

**Baseline:** V17.1. **Type:** reliability and feature release. No V17.1 features were removed and the UI was not redesigned.

## Application name
- The product is called **SQL Assistant** everywhere in the UI: title, navbar, About, walkthrough, messages.
- The version stays in technical metadata: footer, About, registry `writtenBy`.

## Schema synchronization (see `ROOT_CAUSE_V17.2.md`)
- **No stale copies.** Repository files are never read from the browser cache (`cache: 'no-store'`). A copy this device has already replaced is never applied again.
- **One location.** Discovery, pull, push and diagnostics read the same repository location (the configured one, remembered on the device).
- **3-way merge.** Each schema has a base from the last sync:
  - a local edit is published instead of producing a false conflict;
  - a remote-only change is applied automatically;
  - changes on both sides become a conflict for the user.
- **Self-recovery.** Sync operations are serialised. A push that races another device recovers on its own (pull → merge → push). Newer local schemas found during a pull are published automatically.
- **Diagnostics.**
  - Every error names its failing stage, with exact paths.
  - Rejected data names the version and device that wrote it, so an out-of-date device can be identified.
  - An out-of-date app copy is flagged.
  - Storage failures are reported as "Schema persistence failed" without leaving partial data.
- Discovery is throttled (90 s) and de-duplicated, which avoids GitHub rate limits.
- **Validation unchanged**, with one correction: decode raw values are compared exactly (`'a'` ≠ `'A'`).

## Describe What You Need (offline NLU, primary engine)
- Relative dates: **current/previous** week/month/year (in addition to today, yesterday, last N days/weeks/months/years, this …).
- Country names map to ISO codes on ISO-coded country columns ("Finland" → `'FI'`), with a note.
- Detects **table aliases** ("using table aliases") and **LEFT JOIN** ("including those without a vendor").
- Negative string conditions ("does not contain …" → `NOT LIKE`).
- "table aliases" and similar phrases are no longer misread as a missing table.

## Learning
Learned query knowledge now records the complete example:
- request, generated/modified/final SQL, tables, columns;
- detected filters, joins, sorting, grouping, aggregates, date logic;
- schema fingerprint and version, engine version, outcome, and the user's corrections.

How it learns:
- **Corrections are learned from the final SQL** you accept (e.g. a changed ORDER BY), including aliased SQL.
- **Credentials are never learned.** Requests or SQL containing tokens, keys or passwords are refused.
- **The Active Schema always wins.** A pattern that references a deleted table or column is ignored, and the request is re-evaluated against the current schema.
- **Invalid SQL is never recorded.** Generations that fail validation are not learned.

## SQL validation
- Alias-aware schema validation: `FROM T a … a.COL` is checked column by column; duplicate and unknown aliases are reported.
- Structural checks:
  - unbalanced parentheses
  - unterminated strings
  - missing FROM
  - clause order (WHERE → GROUP BY → HAVING → ORDER BY)
  - trailing commas
  - duplicate output aliases
  - BETWEEN without a second value
  - ORDER BY on a table that is not selected
- Applied to generated, learned, AI/LLM and accepted SQL alike.

## Manual Selectors → Advanced Options
- New: **Use table aliases**, **Join type for automatic joins** (INNER/LEFT), and **Join paths** (choose the path when several exist). Before this, the join-path choice the app asked for had no control.
- All V17.1 options are unchanged. Every new option can be set automatically from the description, and manual settings always win.

## Settings → Manual Schema Update (row-wise)
- The selected row is identified in the table bar and in the edit dialog.
- The dialog shows **current → modified** values for every changed field. Table-level fields (module, table description) are marked as applying to all columns of the table.
- **Save** is disabled until something changes; **Reset** restores the current values; **Cancel** discards.
- The selected row stays selected after saving.

## Settings → AI/LLM Model, Secret Vault
- The "AI/LLM Model" naming is used throughout.
- The offline engine is explicitly labelled primary/default. The model is optional, and every failure (offline browser, locked vault, missing key, provider error) falls back to the offline result.
- The Secret Vault push states its security model in the UI and in `SECURITY.md`.

## Tooling
- `npm run dev`: development build with inline source maps, served at http://localhost:5173, rebuilt on change.
- `npm run build:dev`: development build to `dev-dist/`.
- `npm run lint`: import graph, cycles, debug statements, hard-coded credentials, old product name.
- `npm run build`: refuses to write output that contains a credential.
- `npm run verify`: clean → typecheck → lint → tests → production build → development build.
- `npm run smoke` / `npm run smoke:http` / `python3 scripts/smoke_test.py --target dev`: real-browser tests.
