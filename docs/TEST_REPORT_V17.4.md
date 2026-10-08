# Test report: SQL Assistant 17.4

Run on the final build (build/, dist/, dev-dist/, release/, test-results/ and the root index.html were removed first; sources unchanged since).

| Check | Result |
|---|---|
| TypeScript validation (`tsc --noEmit`, strict) | **0 errors** |
| Lint (70 files, import cycles) | passed |
| Security check (`npm run security`) | passed |
| Node tests (`test/*.test.mjs`: V17.3.1's 29 + 16 new) | **45/45** |
| Development build + production build | succeeded (single self-contained page, 552 KB) |
| Real-browser regression suite of V17.3.1 (`scripts/browser_test.py`, unchanged apart from the version string and 7 → 8 Settings tabs) | **56/56** |
| Real-browser suite of the V17.4 features (`scripts/browser_test_v174.py`) | **120/120** |
| Refresh / reload tests | included in both suites (routes, builder draft, schema edit, admin library, migration) |
| Clean-install test | see `docs/SOURCE_PROVENANCE.md` — run from the final ZIP with the pre-installed TypeScript (the npm registry is blocked in the build environment) |

Browser: Chromium (Playwright) on the **production** build, served like GitHub Pages (`/SQL-Assistant/`) and opened from `file://`. Multi-device scenarios use separate browser contexts with an in-memory repository.

## Acceptance criteria (section 28) → evidence

| # | Criterion | Evidence |
|---|---|---|
| 1 | V17.3.1 UI preserved | Before/after screenshots reviewed; 56/56 unchanged baseline checks; additions are additive CSS only |
| 2 | Existing functionality preserved | `docs/REGRESSION_BASELINE_V17.3.1.md`; 29 original Node tests + 56 original browser checks green |
| 3 | Index / application page works | 4 hosting modes × (load, routes, refresh) in the baseline suite |
| 4 | Describe What You Need uses the active schema | Browser: "the active schema is used"; Node: acceptance examples on two schemas |
| 5 | Offline NLU works without an external AI service | Browser: "works fully offline" (network disabled) |
| 6 | Centralized learning works | Node: tiers, merge, tombstones; Browser: tiered learning checks; knowledge sync |
| 7 | Admin Query Library works | Browser: 24 checks (add, edit, delete, enable/disable, approve, search, filter, validate, use) |
| 8 | Learned queries assist future SQL generation | Browser: "a learned query is retrieved and used as a pattern"; Node: "learned pattern is used for later requests" |
| 9 | Manual Selector selections no longer reset | Browser: 14 "Selectors:" checks, including reload and schema switch |
| 10 | Advanced SQL options work automatically and manually | Browser: 32 "Advanced:" checks; Node: engine + resolver tests |
| 11 | Manual Schema Update supports edit / delete / save | Browser: 6 "Schema:" checks + 4 baseline row-edit/delete checks |
| 12 | Schema changes persist centrally | Browser: reload checks read `sqla.registry.v15`; Node: "persists centrally and refreshes NLU knowledge" |
| 13 | Secret Vault synchronization is encrypted | Node + Browser: AES-256-GCM, no plaintext / Base64 / URL-encoded secret, tamper and wrong-passphrase rejected |
| 14 | GitHub synchronization continues to work | Node: 13 sync tests; Browser: Sync #1 → #2 → #3 → restart |
| 15 | AI/LLM Model supports the offline architecture | Browser: layers, local provider, unreachable model → offline result |
| 16 | Generated SQL is schema-aware and validated | Node: 12-check validator over 40 generated queries (0 false positives) + 12 classes of bad SQL |
| 17 | No fabricated tables or columns | Node + Browser: unknown identifiers and phrases are reported, not invented |
| 18 | No sensitive credentials are exposed | `npm run security`; Browser: token absent from UI, storage, repository file |
| 19 | Existing UI is not unnecessarily changed | Screenshots (desktop / tablet / phone); one new Settings tab |
| 20 | Browser testing is completed | 176 real-browser checks |
| 21 | Production build succeeds | yes |
| 22 | Final ZIP is generated as `SQL-Assistant-V17.4.zip` | yes |

## V17.4 browser checks (120)
- ✔ Selectors: selecting a table keeps the module filter and the search text (no reset)
- ✔ Selectors: selecting a table keeps the column search and the previously selected column
- ✔ Selectors: selecting a second column does not reset the first
- ✔ Selectors: selecting a table does not reset filters
- ✔ Selectors: editing a filter does not reset the selected tables
- ✔ Selectors: changing Advanced Options does not clear the selections
- ✔ Selectors: switching tabs keeps the search boxes, selections and filters
- ✔ Selectors: the Tables & Columns tab stays mounted — search text survives a tab round-trip
- ✔ Selectors: Advanced Options keep their values when the tab is shown again
- ✔ Selectors: the table list keeps its scroll position after a selection
- ✔ Selectors: a page reload keeps the builder draft (tables, options, SQL)
- ✔ Selectors: deselecting a table removes its columns/filters from the SQL but keeps them
- ✔ Selectors: re-selecting the table brings its columns and filters back
- ✔ Selectors: switching the Active Schema keeps the description, options and the selections that still exist
- ✔ Describe: the example request is accepted and the active schema is used
- ✔ Describe: SUM + GROUP BY + ORDER BY DESC + LIMIT 20 are inferred automatically
- ✔ Describe: the generated SQL is validated before it is shown (12 checks)
- ✔ Describe: Validate shows what was checked
- ✔ Describe: Explain lists tables, columns, joins, aggregation, grouping, sorting and limit
- ✔ Describe: the Advanced Options tab shows what was inferred automatically
- ✔ Describe: unknown columns are reported and never invented
- ✔ Describe: items the schema cannot provide (invoice number, gross amount) are listed as not found
- ✔ Describe: works fully offline (no external AI service)
- ✔ Learning: a generated (unconfirmed) query is recorded but is NOT used as a pattern
- ✔ Learning: SQL that is not valid for the Active Schema cannot be accepted or learned
- ✔ Learning: user-modified SQL is recorded as modified & confirmed
- ✔ Learning: SQL reported as successfully executed is the strongest learned tier
- ✔ Learning: a learned query is retrieved and used as a pattern for the same request
- ✔ Learning: 'Report issue' removes the result from the trusted patterns
- ✔ Learning: successful, modified and executed records are stored centrally (versioned structure)
- ✔ Describe: the dialect decides how the limit is written (TOP for SQL Server)
- ✔ Advanced: aggregation (SUM) with GROUP BY completed automatically
- ✔ Advanced: aggregation COUNT
- ✔ Advanced: aggregation AVG
- ✔ Advanced: aggregation MIN
- ✔ Advanced: aggregation MAX
- ✔ Advanced: HAVING
- ✔ Advanced: ORDER BY with ASC / DESC
- ✔ Advanced: LIMIT (FETCH FIRST for Oracle)
- ✔ Advanced: DISTINCT
- ✔ Advanced: GROUP BY (manual columns)
- ✔ Advanced: LEFT JOIN
- ✔ Advanced: RIGHT JOIN
- ✔ Advanced: FULL JOIN
- ✔ Advanced: INNER JOIN
- ✔ Advanced: table aliases
- ✔ Advanced: every option has a short plain-language description
- ✔ Advanced: the options catalog lists WHERE, AND/OR, BETWEEN, IN, LIKE, IS NULL, dates, CASE, joins, WITH, EXISTS
- ✔ Advanced: WITH / CTE
- ✔ Advanced: EXISTS sub-select filter (validated read-only)
- ✔ Advanced: NOT EXISTS
- ✔ Advanced: a destructive sub-select is rejected and the SQL is flagged
- ✔ Advanced: options are limited to what the dialect supports (no FULL JOIN in MySQL)
- ✔ Advanced: date filter shortcut (last 30 days)
- ✔ Advanced: filter IN
- ✔ Advanced: filter NOT IN
- ✔ Advanced: filter LIKE
- ✔ Advanced: filter NOT LIKE
- ✔ Advanced: filter BETWEEN
- ✔ Advanced: filter IS NULL
- ✔ Advanced: filter IS NOT NULL
- ✔ Advanced: filter <>
- ✔ Advanced: a manual option takes precedence over the value inferred from the description
- ✔ Schema: a row edit (column + table information) is saved and the Active Schema, SQL generation and NLU knowledge are refreshed
- ✔ Schema: the edit survives a page reload (centralized saved schema data)
- ✔ Schema: the Schema page shows the saved change
- ✔ Schema: a deleted row stays deleted after reload
- ✔ Schema: the builder uses the updated Active Schema (deleted column is gone)
- ✔ Schema: an invalid change (empty decode code) is refused with an actionable message
- ✔ Admin Library: the tab is part of Settings and starts empty
- ✔ Admin Library: tables and columns are detected from the SQL
- ✔ Admin Library: test / validate runs the 12 checks against the Active Schema
- ✔ Admin Library: add query — saved as a draft with metadata
- ✔ Admin Library: draft queries are not trusted yet
- ✔ Admin Library: approve (only valid queries) — query becomes a trusted example
- ✔ Admin Library: an invalid query cannot be approved (clear reason shown)
- ✔ Admin Library: test shows invalid result for the broken query
- ✔ Admin Library: a query containing a credential is refused
- ✔ Admin Library: names are escaped (no HTML injection)
- ✔ Admin Library: search
- ✔ Admin Library: search with no result
- ✔ Admin Library: filter by approval status, tag and dialect
- ✔ Admin Library: edit query keeps the approval when only the description changes
- ✔ Admin Library: editing the SQL withdraws the approval (test + approve again)
- ✔ Admin Library: an approved query is found and used during SQL generation (adapted, not copied)
- ✔ Admin Library: retrieval order is shown — Active Schema → Admin Query Library → learned → NLU → SQL engine
- ✔ Admin Library: the pattern is adapted to the dialect (TOP for SQL Server)
- ✔ Admin Library: disable
- ✔ Admin Library: a disabled query is not used
- ✔ Admin Library: enable
- ✔ Admin Library: the library survives a page reload
- ✔ Admin Library: delete requires the Admin Password and removes the query
- ✔ Admin Library: learned queries are offered for review only when confirmed / executed
- ✔ Knowledge sync: learned queries + the Admin Query Library are published as one versioned file
- ✔ Knowledge sync: the published file holds no credentials
- ✔ Knowledge sync: a second device receives the Admin Query Library
- ✔ Knowledge sync: a second device receives the successfully executed learned query
- ✔ Knowledge sync: the synchronized knowledge is used on the second device
- ✔ Knowledge sync: a deletion made on one device reaches the other
- ✔ Knowledge sync: hostile remote records (destructive SQL, credentials) are rejected, not imported
- ✔ Vault: save secret — the token is encrypted at rest and never shown
- ✔ Vault: push validates the secret configuration first and explains what to fix
- ✔ Vault: push encrypts, prepares a repository-safe file, pushes, verifies by read-back
- ✔ Vault: the repository file contains no plaintext or Base64 token (AES-256-GCM envelope)
- ✔ Vault: pull — a wrong passphrase is rejected; the right one retrieves, decrypts and validates
- ✔ Vault: the plaintext token is never in the UI, console or storage of the receiving device
- ✔ Vault: a device without the decryption key says so clearly and keeps the old data
- ✔ AI/LLM: the layered offline architecture is shown (schema engine · offline NLU · local learning · optional local LLM)
- ✔ AI/LLM: offline stays primary and a local model needs no key
- ✔ AI/LLM: an unreachable local model is reported and SQL generation keeps working offline
- ✔ AI/LLM: with an unavailable model the offline result is still produced
- ✔ Migration: V17.3.1 learned data is migrated automatically and the old data is kept
- ✔ Migration: idempotent — a restart does not duplicate anything
- ✔ Migration: the Synchronization tab lists the versioned migrations
- ✔ Responsive (desktop 1366px): builder, Advanced Options, hamburger menu and Admin Query Library fit without horizontal page scroll
- ✔ Responsive (tablet 768px): builder, Advanced Options, hamburger menu and Admin Query Library fit without horizontal page scroll
- ✔ Responsive (phone 390px): builder, Advanced Options, hamburger menu and Admin Query Library fit without horizontal page scroll
- ✔ Security: the production page contains no credentials and no external script
- ✔ Security: a hostile description is rendered as text (no HTML injection / script execution)
- ✔ No console errors or uncaught exceptions in any V17.4 flow

## V17.3.1 regression browser checks (56)
- ✔ Build output exists: dist/index.html
- ✔ Build output exists: index.html
- ✔ Build output exists: release/index.html
- ✔ Build output exists: release/404.html
- ✔ Build output exists: release/.nojekyll
- ✔ Entry page is self-contained (no src/main.ts, no module script, no CDN)
- ✔ Root cause reproduced: V17.2.1 root index.html (src/main.ts) is blank
- ✔ GitHub Pages sub-path /SQL-Assistant/: index loads with the V17.2 UI
- ✔ GitHub Pages sub-path /SQL-Assistant/: every route renders and survives refresh
- ✔ project root via http: index loads with the V17.2 UI
- ✔ project root via http: every route renders and survives refresh
- ✔ dist/index.html via file://: index loads with the V17.2 UI
- ✔ dist/index.html via file://: every route renders and survives refresh
- ✔ root index.html via file://: index loads with the V17.2 UI
- ✔ root index.html via file://: every route renders and survives refresh
- ✔ Version 17.4.0 in footer; no old product name
- ✔ Hamburger navigation works
- ✔ V17.2 layout: two equal top cards (Describe / Generated SQL)
- ✔ Offline NLU: aggregation, grouping, date range, limit
- ✔ Offline NLU badge + Active Schema audit line
- ✔ Manual Selectors: table + column
- ✔ Advanced Options: DISTINCT + limit
- ✔ Generated SQL validates
- ✔ Query Builder for CR
- ✔ Settings locked: password screen shown, tabs hidden
- ✔ Wrong password rejected; Settings stay locked
- ✔ Default password unlocks; V17.2 Settings tabs
- ✔ Default-password warning shown
- ✔ Navbar lock badge shows unlocked
- ✔ Change password: mismatch rejected
- ✔ Change password: wrong current password rejected
- ✔ Change password: success
- ✔ Password never stored in plain text
- ✔ Lock Settings returns to the lock screen
- ✔ Old default password no longer works
- ✔ Settings locked again after restart
- ✔ New password unlocks after restart
- ✔ Row selection identified
- ✔ Save disabled until a change
- ✔ Row edit saved; other rows unchanged
- ✔ Row delete: wrong password refused
- ✔ Row delete with the Admin Password removes only that row
- ✔ Sync #1: legacy AP schema 77 migrated, nothing rejected
- ✔ Republished: writer 17.4.0, all 437 decode entries
- ✔ Sync #2: success, no re-migration
- ✔ Sync #3: success, no re-migration
- ✔ Restart + sync: still clean
- ✔ Token masked; not in browser storage
- ✔ Push Secret Vault: encrypted, token not in repository
- ✔ AI/LLM Model tab present (offline stays primary)
- ✔ Danger Zone asks for the Admin Password
- ✔ Danger Zone: wrong password refused
- ✔ Reset Admin Password to default locks Settings
- ✔ Default password works again after reset
- ✔ Blocked storage: app still starts
- ✔ No console errors or uncaught exceptions
