## Test report: SQL Assistant 17.5.1

Run on the **final** build (`build/`, `dist/`, `dev-dist/`, `release/`, `test-results/` and the root `index.html` were removed first; sources unchanged afterwards).

| Check | Result |
|---|---|
| TypeScript validation (`tsc --noEmit`, strict) | **0 errors** |
| Lint (77 files, no import cycles) | passed |
| Security check (`npm run security`) | passed |
| Node tests (`test/*.test.mjs`, serial): V17.5's 59 + 8 new | **67/67** (3 consecutive runs) |
| Development build + production build | succeeded (single self-contained page, 624 KB) |
| Real-browser suite of V17.5.1 (`browser_test_v1751.py`) | **59/59** |
| Real-browser regression suite of V17.5 (`browser_test_v175.py`, unchanged apart from the version string) | **102/102** |
| Real-browser regression suite of V17.4 (`browser_test_v174.py`, **unchanged**) | **120/120** |
| Real-browser regression suite of V17.3.1 (`browser_test.py`, unchanged apart from the version string) | **56/56** |
| Refresh / reload tests | included (message survives a refresh; hidden stays hidden; cleared stays cleared) |
| Clean-install test | the ZIP unzipped into an empty directory, built from scratch, checked and smoke-tested; the build is **byte-identical** to the shipped one (see `SOURCE_PROVENANCE.md` for the npm-registry note) |

**337 real-browser checks in total** (Chromium / Playwright on the **production** build, served like GitHub Pages and opened from `file://`). Multi-device scenarios use separate browser contexts and an in-memory repository, so what Device A publishes is what Devices B, C and D read.

### V17.5.1 browser checks by area (59)
| Area | Checks |
|---|---|
| Admin panel | 16 |
| Delivery to other devices | 18 |
| Rendering & plain text | 4 |
| Failures & offline | 11 |
| Regression & layout | 9 |
| Console errors | 1 |

### Requirement → evidence
| Requirement | Evidence |
|---|---|
| A short message | 140-character limit, live counter, one clean line — "Admin: … over 140 … refused", "… normalised to one clean line", "Rendering: a 140-character message is accepted and fully shown"; Node "path + text rules" |
| Cross device | "Device B/C/D: …" through the real triggers (*Sync with GitHub Now*, visibility, start-up); Node "cross-device" |
| In the nav bar | "Admin: the publisher sees the banner immediately, inside the navbar"; "Device B: … adds one slim row … the controls row keeps its height"; four widths + dark theme |
| Admin sets it | "Admin: Settings → Synchronization has an 'Admin message' panel (inside the password-protected Settings; no new tab)" |
| Existing UI preserved | "Device B: the existing navbar is untouched — schema badge keeps its full name and its width"; "Regression: with no message the navbar is exactly the V17.5 navbar"; all 278 earlier browser checks green |
| Existing synchronization preserved | Node "isolation" (schema file byte-identical, sync metadata untouched); "Regression: Synchronization / Schema Management content"; V17.4 + V17.5 suites |
| Safe | "Rendering:" (HTML / script / web address stay text), "Admin: … credential … refused", "Failure: … credential-like text is rejected", "Admin: the file contains no credential" |
| Fails safely | "Offline publish: …" (4), "Failure: …" (5), "Last writer wins: …" (2) |

### V17.5.1 browser checks (59)
- ✔ Admin: Settings → Synchronization has an 'Admin message' panel (inside the password-protected Settings; no new tab)
- ✔ Admin: the panel explains the limit, plain-text-only, per-user hiding and that the file is not encrypted
- ✔ Admin: the type selector offers Information and Warning; Clear is disabled while nothing is published
- ✔ Admin: a live character counter shows 5 / 140
- ✔ Admin: an empty message is refused with a clear reason
- ✔ Admin: a message over 140 characters is refused and the counter turns red
- ✔ Admin: text that looks like a credential is refused and nothing is written
- ✔ Admin: 'password: …' style text is refused as well
- ✔ Admin: publishing succeeds and says the other devices will receive it at their next synchronization or when they open the app
- ✔ Admin: the repository gets one small versioned plain-JSON file next to the schemas (same repository, separate file)
- ✔ Admin: the message is normalised to one clean line (spaces, line breaks and tabs collapsed)
- ✔ Admin: the file contains no credential, passphrase or token
- ✔ Admin: the publisher sees the banner immediately, inside the navbar
- ✔ Admin: the panel shows the current message and enables Clear
- ✔ Admin: nothing else was written to the repository (the schema file is untouched)
- ✔ Admin: a warning replaces the previous message and is styled as a warning
- ✔ Device B: before it synchronizes there is no banner
- ✔ Device B: 'Sync with GitHub Now' brings the message (the real user path) — warning text, label and level
- ✔ Device B: the existing navbar is untouched — schema badge keeps its full name and its width
- ✔ Device B: the banner adds one slim row (≈ 30–40 px) below the controls — the controls row keeps its height
- ✔ Device B: the message is announced politely to assistive technology and the dismiss button is a labelled button
- ✔ Device B: the message survives a page refresh (it is stored on the device)
- ✔ Device B: only the message and its metadata are stored locally — no secret
- ✔ Device C: coming back to the tab (visibility) refreshes the message without any click
- ✔ Device D: a repository without a message shows nothing and raises no error
- ✔ Dismiss: 'hide' removes the banner on this device at once
- ✔ Dismiss: it stays hidden after a refresh
- ✔ Dismiss: other devices still show it (hiding is per device)
- ✔ Dismiss: synchronizing again does not bring the SAME message back
- ✔ Dismiss: a NEW message appears again on the device that had hidden the old one
- ✔ Clear: the administrator's own banner disappears and the panel says nothing is published
- ✔ Clear: a clearing record is published (so devices that are offline now receive it later)
- ✔ Clear: the other devices lose the banner at their next synchronization
- ✔ Clear: and it does not come back after a refresh
- ✔ Rendering: HTML in the message is shown as plain text — nothing is interpreted, no element is created, no script runs
- ✔ Rendering: the same text in the administrator's panel is escaped as well
- ✔ Rendering: a web address stays plain text — never a link
- ✔ Rendering: a 140-character message is accepted and fully shown
- ✔ Offline publish: the message is saved on this device and the result says clearly that it could not be published yet
- ✔ Offline publish: the panel marks it as not yet published
- ✔ Offline publish: a toast tells the administrator it is not yet published
- ✔ Offline publish: the next 'Sync with GitHub Now' publishes it automatically
- ✔ Offline publish: after that the 'not yet published' mark is gone
- ✔ Failure: when the repository cannot be reached the banner already on screen stays — no error, no flicker
- ✔ Failure: a damaged or hostile message file in the repository is ignored; the current banner stays
- ✔ Failure: a repository record that contains a credential-like text is rejected (never shown)
- ✔ Failure: a file written in a newer format is ignored instead of being misread
- ✔ Last writer wins: an OLDER message in the repository never replaces the newer one on this device
- ✔ Last writer wins: a NEWER message in the repository replaces it
- ✔ Regression: with no message the navbar is exactly the V17.5 navbar (no banner element, no extra row)
- ✔ Regression: the existing Synchronization content (sync source/time, shared location, knowledge, migrations, conflicts, log) is all still there
- ✔ Regression: Schema Management keeps its V17.5 content (repository sync, schema passphrase, stored schemas)
- ✔ Responsive (desktop 1366px): the banner spans the navbar, shows the full text, keeps the dismiss button reachable and causes no horizontal scroll
- ✔ Responsive (small laptop 1024px): the banner spans the navbar, shows the full text, keeps the dismiss button reachable and causes no horizontal scroll
- ✔ Responsive (tablet 768px): the banner spans the navbar, shows the full text, keeps the dismiss button reachable and causes no horizontal scroll
- ✔ Responsive (phone 390px): the banner spans the navbar, shows the full text, keeps the dismiss button reachable and causes no horizontal scroll
- ✔ Dark theme: banner text uses the theme text colour and differs from the background
- ✔ Regression: the Guided Walkthrough still starts and highlights navbar controls while the banner is shown
- ✔ No console errors or uncaught exceptions in any V17.5.1 flow

### V17.5 regression browser checks (102)
- ✔ Tables: the tick-mark is already set in the same task as the click — no delay, no second action needed
- ✔ Tables: clicking the table name ticks it immediately and adds it to the query
- ✔ Tables: clicking the checkbox itself ticks it immediately (this was the broken case)
- ✔ Tables: multiple tables stay selected — selecting another never removes the previous ticks
- ✔ Tables: removing a table removes its tick immediately and updates the count
- ✔ Tables: removing through the row text removes the tick as well
- ✔ Tables: selecting and removing tables resets neither columns, filters, joins, Advanced Options, generated SQL nor the description
- ✔ Tables: the UI and the query state agree (ticks = selected tables = tables in the SQL)
- ✔ Tables: the keyboard (Space) toggles the tick as well
- ✔ Tables: switching tabs and coming back keeps every tick, column, filter and option
- ✔ Tables: after a page refresh the ticks come back with the saved draft
- ✔ Tables: Clear removes every tick immediately
- ✔ Tables: Select all ticks every listed table immediately
- ✔ Columns: a selected column offers 'Display as' → Column | CASE / DECODE
- ✔ CASE/DECODE: the control distinguishes Manual from From Schema
- ✔ CASE/DECODE: a column that has a schema definition starts on 'From Schema' and lists the definition
- ✔ Schema CASE: the generated SQL uses the selected schema definition
- ✔ Schema CASE: the SQL passes validation
- ✔ Schema DECODE (Oracle): the same definition is written as DECODE(…) and validates
- ✔ CASE/DECODE: the definition comes only from the active schema (the Explain panel lists it)
- ✔ CASE/DECODE: the selected definition is preserved when switching Manual Selector tabs
- ✔ CASE/DECODE: outside Oracle the definition is written as CASE and the DECODE style is not offered
- ✔ Manual: choosing Manual offers to define the expression and does not use the schema definition
- ✔ Manual DECODE: the existing manual builder still works and its expression reaches the SQL
- ✔ Manual DECODE: the column stays ticked and shows its manual expression with an Edit button
- ✔ Switching Manual → From Schema uses the schema definition
- ✔ Switching back to Manual restores the manual expression (nothing is lost)
- ✔ Manual CASE: the existing manual CASE builder (Advanced Options) still works
- ✔ No definition: a column without a schema definition starts on Manual (nothing is made up)
- ✔ No definition: 'From Schema' says clearly that none exists and the SQL stays plain
- ✔ No definition: the builder warns that the plain column is used
- ✔ Describe What You Need: the user's selected CASE/DECODE is neither overwritten nor duplicated
- ✔ Describe What You Need: 'status description' selects the schema CASE/DECODE automatically and the plan says so
- ✔ Describe What You Need: 'using decode' on Oracle writes DECODE
- ✔ Describe What You Need: asking for a decode of a column without a definition is reported, never invented
- ✔ User-modified SQL: an edited CASE/DECODE query is accepted, validated and learned together with the fact that STATUS was decoded
- ✔ Learned query patterns: the learned decode is applied again, using the schema's current definition
- ✔ Admin: Schema Management has a 'Schema passphrase' panel with its status
- ✔ Admin: the passphrase fields are masked with a visibility button
- ✔ Admin: a short passphrase is refused with a clear message
- ✔ Admin: mismatching confirmation is refused
- ✔ Admin: the schema is published as an encrypted file and the result says so
- ✔ Admin: the repository file is real AES-256-GCM (PBKDF2) with versioned header metadata
- ✔ Admin: nothing readable is in the repository — no schema, table, column, decode label, passphrase or Base64 of them
- ✔ Admin: the status switches to 'Encrypted synchronization ON'
- ✔ Admin: the passphrase is stored on the device only as ciphertext
- ✔ Admin: the saved passphrase is shown masked and can be revealed
- ✔ Pull: Hamburger menu → Schema opens the Schema page with a 'Pull Schema' tab
- ✔ Pull: the page shows Pull Schema, a passphrase field, a show/hide button, short instructions and the Pull button
- ✔ Pull: the instructions explain what to do, why the passphrase is needed and to keep it secure
- ✔ Pull: the instructions are compact (not a tall block)
- ✔ Pull: the passphrase field is masked by default (type=password) and hidden-by-default is reflected for assistive technology
- ✔ Pull: Show reveals the passphrase, Hide masks it again
- ✔ Pull: the passphrase is never in the page text, the URL or the console
- ✔ Pull: the preview shows every validation step and nothing has been changed yet
- ✔ Pull: before replacing, it shows local version, repository version, updated date, contents and the action
- ✔ Pull: the preview names who wrote the file (writer, app version, schema format, time, device)
- ✔ Cancelled pull: says so and leaves the existing local schema exactly as it was
- ✔ Pull: success is confirmed with 'Schema pulled and validated successfully.' and no stale error
- ✔ Pull: the schema is imported and ACTIVATED (the navbar badge and active schema show it)
- ✔ Pull: structure, tables, columns, data types, relationships, CASE/DECODE definitions, version, identifier and updated time are preserved
- ✔ Pull: the passphrase was remembered on this device — encrypted, never plaintext
- ✔ Pull: Manual Selectors use the new schema straight away (no restart)
- ✔ Pull: the schema CASE/DECODE definitions of the pulled schema are available (1 = Open · 2 = Approved · 3 = Rejected)
- ✔ Pull: Describe What You Need and the offline NLU use the new schema and its CASE/DECODE
- ✔ Pull: the imported schema survives a page refresh
- ✔ Pull: the deep link #schema-used/pull opens the Pull Schema tab
- ✔ Active passphrase: the saved passphrase is displayed masked and can be revealed
- ✔ Pull: pulling again with the saved passphrase says everything is already up to date
- ✔ Failure — incorrect passphrase: 'The passphrase is incorrect. The existing local schema has not been changed.'
- ✔ Failure — incorrect passphrase: the message explains what to do next and does not echo the passphrase
- ✔ Failure — unusable passphrase: 'Schema pull failed because the passphrase could not be validated. Your existing local schema has not been changed.'
- ✔ Failure — empty passphrase is refused before the repository is contacted
- ✔ Failure — missing schema: 'The synchronized schema could not be retrieved. Please verify the repository connection and try again.'
- ✔ Failure — corrupted schema: 'The schema could not be decrypted using the supplied passphrase. The existing local schema has not been changed.'
- ✔ Failure — decryption failure (header tampered with): reported, local schema intact
- ✔ Failure — unreadable file: reported, local schema intact
- ✔ Failure — a plain (unencrypted) file in the encrypted location is explained
- ✔ Failure — invalid schema: 'The synchronized schema failed validation. The existing local schema has not been changed.' (with the location of the problem)
- ✔ Failure — network / repository failure: the retrieval message, technical detail on request, local schema intact
- ✔ No stale errors: after a failure, a successful retry shows only the new result
- ✔ After every failed or cancelled pull the user's own work is untouched
- ✔ Older schema: the repository copy is older than the local one — shown with both versions and dates, 'was not applied'
- ✔ Older schema: the newer local schema is not replaced
- ✔ Admin: changing the passphrase re-publishes the encrypted schema under the new passphrase
- ✔ Passphrase changed by the admin: the old passphrase is refused with the standard message
- ✔ Passphrase changed by the admin: the user types the new passphrase, pulls, and the saved passphrase is updated
- ✔ Passphrase changed by the admin: after a refresh the device shows the NEW saved passphrase (masked)
- ✔ Existing sync: 'Sync with GitHub Now' keeps working with a saved passphrase (encrypted file)
- ✔ Existing sync: the repository still holds only the encrypted file (no plain schema is written)
- ✔ Existing sync: without a passphrase the classic plain synchronization works exactly as in V17.4
- ✔ Existing sync: the plain file now also carries the app version and the writer stamp
- ✔ Existing Secret Vault: the vault tab and Push Secret Vault to Repository are unchanged
- ✔ Existing Settings: Admin Query Library is unchanged
- ✔ Existing Settings: Manual Schema Update is unchanged
- ✔ Existing Settings: AI/LLM Model is unchanged
- ✔ Security: no credential, no hard-coded passphrase and no key material in the production bundle
- ✔ Security: nothing the user typed as a passphrase reached any console message
- ✔ Responsive (desktop 1366px): Pull Schema, the CASE/DECODE controls and the Settings passphrase panel fit without horizontal page scroll
- ✔ Responsive (tablet 768px): Pull Schema, the CASE/DECODE controls and the Settings passphrase panel fit without horizontal page scroll
- ✔ Responsive (phone 390px): Pull Schema, the CASE/DECODE controls and the Settings passphrase panel fit without horizontal page scroll
- ✔ No console errors or uncaught exceptions in any V17.5 flow

### V17.4 regression browser checks (120, unchanged)
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

### V17.3.1 regression browser checks (56)
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
- ✔ Version 17.5.1 in footer; no old product name
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
- ✔ Republished: writer 17.5.1, all 437 decode entries
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
