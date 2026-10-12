## Test report: SQL Assistant 17.5.3

Run on the **final** build (`build/`, `dist/`, `dev-dist/`, `release/`, `test-results/` and the root `index.html` were removed first; sources unchanged afterwards). Every figure below comes from the result files written by the runs; nothing was estimated.

| Check | Result |
|---|---|
| TypeScript validation (`tsc --noEmit`, strict) | **0 errors** |
| Lint (80 files, no import cycles) | passed |
| Security check (`npm run security`) | passed |
| Node tests (`test/*.test.mjs`, serial): V17.5.2's 78 + 10 new | **88/88** (three consecutive runs: tests 88 pass 88 fail 0 · tests 88 pass 88 fail 0 · tests 88 pass 88 fail 0) |
| Development build + production build | succeeded (single self-contained page, 664 KB) |
| Real-browser suite of V17.5.3 (`browser_test_v1753.py`) | **63/63** |
| Real-browser regression suite of V17.5.2 (`browser_test_v1752.py`; 6 assertions re-worded for the new wording) | **97/97** |
| Real-browser regression suite of V17.5.1 (`browser_test_v1751.py`) | **59/59** |
| Real-browser regression suite of V17.5 (`browser_test_v175.py`) | **102/102** |
| Real-browser regression suite of V17.4 (`browser_test_v174.py`, **unchanged**) | **120/120** |
| Real-browser regression suite of V17.3.1 (`browser_test.py`) | **56/56** |
| Refresh / reload tests | included in the earlier suites (selections, CASE/DECODE choice, passphrase, imported schema) |
| Clean-install test | the final ZIP unzipped into an empty directory, built from scratch, checked and smoke-tested; the build is byte-identical to the shipped one |

**497 real-browser checks in total** (Chromium / Playwright, **production** build). **Mutation check:** with the read-back verification temporarily disabled the "update that cannot be confirmed" test fails; restored, it passes — the new tests can detect the fault they are meant to catch.

### What was and was not tested against the real service
* Tested: the app's **real GitHub client** against an **emulation of the GitHub Contents API** (Bearer auth, 401 / 403 / 404 / 409 / 422, sha concurrency, base64 content, outages, hung connections, and a repository that accepts a write but cannot confirm it), shared by independent browser profiles configured through the Secret Vault UI. Nothing is shared through browser storage.
* **Not tested:** github.com itself (no network access or credentials in the build environment). **No repository on github.com was populated or updated.** Branch protection, SSO-authorized tokens, secondary rate limits and eventual-consistency delays beyond the 2 read-back retries were not exercised. No database was available (SQL is validated, not executed). `package-lock.json` does not exist, so a lockfile install was not possible.

### V17.5.3 browser checks by area (63)
| Area | Checks |
|---|---|
| A. Schema menu, passphrase field, instructions | 13 |
| B. Publication to the shared repository (incl. failures) | 25 |
| C. Cross-device pull, update and failure scenarios | 11 |
| D. Passphrase rotation | 5 |
| E. Security and compatibility | 5 |
| Responsive layout | 3 |
| Console errors | 1 |

### Required tests (Requirement H) → evidence
| Required test | Evidence |
|---|---|
| **A** Hamburger menu → Schema; pull and push/populate visible; passphrase masked by default; reveal / hide works; instructions visible and understandable | "Schema menu: …", "Pull option …", "Push option …", "Passphrase: masked by default …", "Passphrase: the eye button reveals it and hides it again", "Instructions: …", "Passphrase: coming back … masked again", "Deep link …" |
| **B** Publish a valid schema; the remote holds the expected data; update an existing schema; unrelated files and modules intact; missing credentials and insufficient permissions; no false success | "Publish: …" (5), "Update: …" (2), "Idempotent: …" (2), "Missing credentials: …" (2), "Failure — insufficient permission / token rejected / unreachable / no answer / 403 / unconfirmed write" (7) |
| **C** Device A publishes → Device B (independent profile, own token, correct passphrase) pulls and activates → tables, columns, metadata, CASE/DECODE verified → update retrieved → wrong passphrase, network failure, incompatible schema, repository access failure → existing schema intact | "Device B …" (4), "Update: an update published from Device A …", "Failure — incorrect passphrase / network failure / incompatible schema file / repository access failure" (each compares the registry and active schema before and after), "Recovery …" |
| **D** No plaintext passphrase or token in the repository; none in source or built assets; logs and messages free of secrets; existing encrypted data readable | "Security: …" (4), "Compatibility: an encrypted schema file written by V17.5.2 …"; Node "typed passphrase … appears nowhere" |
| **E** Regression: startup, SQL generation, Manual Selectors, Advanced Options, schema switching, CASE/DECODE, Query Library, Settings, Secret Vault; desktop + responsive | the five earlier suites (56 + 120 + 102 + 59 + 97) and "Responsive …" |

### Release acceptance criteria → evidence
| # | Criterion | Evidence |
|---|---|---|
| 1–2 | Name remains SQL Assistant; V17.5.2 is the baseline | footer / About; SOURCE_PROVENANCE.md; unchanged baseline built and tested first (78/78) |
| 3 | Schema synchronization works across independent devices through the shared repository | section C; Node "typed passphrase … Device B pulled what Device A published" |
| 4 | Pull and push/populate are accessible from Hamburger Menu → Schema | section A |
| 5 | The existing repository and schema format are reused | "Publish: only the one schema file was written …"; Node compatibility test; `registry.enc.json`, format 2 / `sqla-schema-sync` v1 unchanged |
| 6 | The Vault passphrase is masked by default and can be revealed / hidden | section A (Push and Pull tabs) |
| 7 | The passphrase is not hard-coded or committed in plaintext | "Security: the built application and the source contain no credential, no hard-coded passphrase …"; "no plaintext passphrase … in any repository file or request body" |
| 8 | Existing encrypted schemas remain compatible | "Compatibility: …"; Node `compatibility` |
| 9 | Failed synchronization leaves valid local schema data intact | every "Failure — …" check; Node "failure classes … local schemas and sync state unchanged" |
| 10 | Existing UI and unrelated functionality remain unchanged | the five earlier suites |
| 11 | Browser tests, security checks, regression tests and production build have recorded results | this report |
| 12 | The project is packaged as `SQL-Assistant-V17.5.3.zip` | delivered |

### V17.5.3 browser checks (63)
- ✔ Schema menu: 'Schema' is in the existing hamburger menu (no new page, no new menu entry)
- ✔ Schema menu: the Schema page keeps its tabs and offers Pull Schema and Push to GitHub next to them
- ✔ Pull option: 'Pull Schema from GitHub' is visible with a masked Vault passphrase field and an eye button
- ✔ Pull instructions: the three original sentences and the 8 steps are still visible
- ✔ Push option: 'Push / Populate GitHub Repository' is visible next to the Vault passphrase field, the Admin Password and the schema list
- ✔ Passphrase: masked by default (type=password) on the Push tab; the confirmation and the Admin Password are masked as well
- ✔ Passphrase: the eye button reveals it and hides it again
- ✔ Instructions: the four push steps are short, visible and name the access token requirement (the Vault passphrase does not grant GitHub access)
- ✔ Instructions stay compact (the help box is not a tall block)
- ✔ Status: connection, Vault passphrase availability and sync state are shown, without any secret
- ✔ Plan: with only the built-in starter schema there is nothing to publish and the page says so
- ✔ Passphrase: coming back to the Schema section shows it masked again (reveal state is never kept)
- ✔ Deep link: #schema-used/push opens the Push tab
- ✔ Missing credentials: publishing explains that no repository connection exists, offers Settings → Secret Vault and shows no success
- ✔ Missing credentials: nothing reached the repository and the schema stays 'not yet published'
- ✔ Plan: both schemas (two modules) are listed as new, with tables, columns and CASE/DECODE entries; no secret is shown
- ✔ Status: it already says the connection is configured and that the changes are not yet published
- ✔ Admin Password: a wrong password is refused and nothing is published
- ✔ Passphrase confirmation: a mismatch is refused and nothing is published
- ✔ Passphrase: one that is too short is refused before the repository is contacted
- ✔ Failure — insufficient permission: a read-only token is told it needs Contents: Read and write; no success message; nothing written
- ✔ Failure — token rejected (401): named with the next step; no success message
- ✔ Failure — GitHub unreachable: named with the next step; no success message
- ✔ Failure — GitHub does not answer: a timeout message within the time limit; no success message
- ✔ Failure — repository permission error (403 on every request): reported as permission
- ✔ Failure scenarios: the local schemas are intact and still marked 'not yet published'
- ✔ Failure — the repository accepts the write but cannot confirm it: 'did not confirm the update', NOT a success
- ✔ Failure — after an unconfirmed write the schemas stay 'not yet published' and the passphrase was NOT saved on the device
- ✔ Publish: success is shown only now — 'Schema published to GitHub and verified.' with the file, the revision and the schemas that were added
- ✔ Publish: the repository was written once and then READ BACK (read, PUT, read) — the success message came after the confirmation
- ✔ Publish: the encrypted file is real AES-256-GCM and holds both schemas — nothing readable, no passphrase, no token
- ✔ Publish: only the one schema file was written — every other file in the repository is byte-identical
- ✔ Publish: afterwards nothing is waiting to be published and the Vault passphrase is shown as available (encrypted) on this device
- ✔ Publish: the passphrase was saved on this device only as ciphertext (never plaintext or Base64) and the page keeps it masked
- ✔ Update: the plan marks only the edited schema as changed
- ✔ Update: the result says 'Updated in the repository' for the edited schema and 'Already identical' for the other
- ✔ Idempotent: pushing again with nothing changed says the repository already holds the same schemas and writes nothing
- ✔ Idempotent: the repository file still declares exactly two schemas (no duplicates)
- ✔ Device B (independent profile, own token): the published schemas are retrieved, decrypted and validated — both are offered
- ✔ Device B: 'Schema pulled and validated successfully.' — imported and activated
- ✔ Device B: tables, columns, modules, relationships, version and CASE/DECODE definitions arrived exactly as on Device A (including the edit made on Device A)
- ✔ Device B: Manual Selectors and the SQL generator use the pulled schema and its definitions straight away
- ✔ Update: an update published from Device A is retrieved by Device B (Q = Quarantined) — the unchanged schema is not rewritten
- ✔ Failure — incorrect passphrase: 'The passphrase is incorrect. The existing local schema has not been changed.'
- ✔ Failure — network failure: reported with the next step; local schema intact
- ✔ Failure — incompatible schema file: the format cannot be read, update SQL Assistant; local schema intact
- ✔ Failure — repository access failure (token rejected): named; local schema intact
- ✔ Recovery: after the failures a correct pull works again and shows no stale error
- ✔ Cross-device: the other files in the shared repository were never modified by any of this
- ✔ Rotation: a different passphrase is refused when the repository file is protected with another one — explained, repository file unchanged
- ✔ Rotation: with the explicit replacement the file is re-encrypted under the new passphrase and verified
- ✔ Rotation: the OLD passphrase no longer opens the file ('The passphrase is incorrect. The existing local schema has not been changed.')
- ✔ Rotation: the NEW passphrase opens it
- ✔ Rotation: the device now holds the new passphrase (ciphertext only)
- ✔ Security: no plaintext passphrase (old or new), token or Base64 of them in any repository file or request body the shared remote received
- ✔ Security: nothing the user typed (passphrases, tokens, Admin Password) reached any console message
- ✔ Security: no secret appears in the page text or the URL
- ✔ Security: the built application and the source contain no credential, no hard-coded passphrase and no key material
- ✔ Compatibility: an encrypted schema file written by V17.5.2 is still read with the same workflow
- ✔ Responsive (desktop 1366px): the Push and Pull tabs, the plan table and the result fit without horizontal scroll
- ✔ Responsive (tablet 768px): the Push and Pull tabs, the plan table and the result fit without horizontal scroll
- ✔ Responsive (phone 390px): the Push and Pull tabs, the plan table and the result fit without horizontal scroll
- ✔ No console errors or uncaught exceptions in any V17.5.3 flow

### V17.5.2 regression browser checks (97)
- ✔ Tables: selecting a table sets the tick and the count inside the click itself
- ✔ Tables: the selected-table count, the tick and the generated SQL agree a moment later
- ✔ Tables: deselecting removes the tick immediately and the table leaves the SQL
- ✔ Tables: several tables stay selected; count and SQL list the same tables
- ✔ Race: 25 rapid clicks on one table end in the correct parity (odd → selected); no duplicates; count, ticks and SQL agree
- ✔ Race: a burst of clicks on every table leaves ticks = count = tables in the state (checked through the SQL) — no stale or duplicate selection
- ✔ Search: the list is filtered by the text
- ✔ Search: ticks inside a filtered list are immediate and counted
- ✔ Filter: tables selected while a search / module filter was active stay selected after it is cleared; count covers hidden selections
- ✔ Tabs: switching tabs and returning keeps ticks, columns, options and SQL
- ✔ Select all ticks every listed table at once; Clear removes them at once
- ✔ Clear: no tick remains
- ✔ Schema switch: tables that exist in the new schema stay ticked; the picker lists the new schema's tables
- ✔ Latency (77-table schema, 4× CPU throttle): the click handler returns within 25 ms and the tick is painted in the next frame (V17.5.1 measured 47–113 ms and 34–91 ms)
- ✔ Latency: after the deferred refresh, ticks = count (16) and the SQL refresh completed
- ✔ Valid CASE definition: a column with a valid schema definition starts on 'From Schema', shows table.column, value count and the mapping
- ✔ Valid CASE definition: the generated SQL uses it and validates
- ✔ Valid DECODE definition: the same stored definition is written as DECODE on Oracle and validates
- ✔ Same column name in two tables: both decoded columns get distinct, table-qualified aliases and the SQL passes all checks
- ✔ Manual + schema together: a manual DECODE on one column and a schema CASE/DECODE on another both reach the SQL, once each, nothing replaced
- ✔ Manual + schema together: the SQL still validates
- ✔ Definitions for only some columns: a column without a definition (ORDERS.KIND) starts on Manual and 'From Schema' is disabled with the reason shown
- ✔ Switching to a schema WITHOUT definitions: the open picker shows the message, 'From Schema' is disabled, and the SQL uses the plain column
- ✔ Switching to a schema without definitions: the builder warns and nothing is invented
- ✔ Without a schema definition the Manual option is still available
- ✔ Switching to a schema with a definition for ORDERS.STATUS only: that column offers it again; CUSTOMERS.STATUS does not
- ✔ Invalid definition (empty label): 'From Schema' is disabled, the reason is shown, and no SQL is generated from it
- ✔ Incomplete definition (labels without a code): reported as incomplete with the unmapped labels named; not used
- ✔ Invalid / incomplete: the builder shows a clear validation message and keeps the rest of the query
- ✔ Describe What You Need with an invalid definition: reported in the plan and never fabricated
- ✔ Switching back to the valid schema: the definition is available again and the SQL uses it
- ✔ Describe What You Need with a valid definition uses it, the plan says so, and the SQL validates
- ✔ Refresh: the selections and the CASE/DECODE choice survive a page reload
- ✔ Device A: the repository and token entered in the Secret Vault are used by the real GitHub client (no test override)
- ✔ Local edit: the confirmation says it is saved ON THIS DEVICE and NOT yet published — it does not claim remote synchronization
- ✔ Sync status: the edited schema is listed as 'changes not yet published'; no publish has happened
- ✔ Publish (Device A): the encrypted schema file reaches the SHARED repository through an authenticated PUT
- ✔ Publish: nothing readable is in the remote — no schema name, table, column, decode label, passphrase or token
- ✔ Sync status after publishing: nothing waiting; the last publish time is shown
- ✔ Device B (Schema menu): no repository connection yet — the status says so and offers a way to fix it
- ✔ Missing credentials: pulling without a repository connection explains what to do and changes nothing
- ✔ Missing credentials: 'Open Settings → Secret Vault' leads to Settings (Admin Password protected)
- ✔ Device B: after configuring, the status shows the connection and that no schema passphrase is saved yet
- ✔ Pull (Device B): the repository file is retrieved, decrypted and validated; the schema is offered as an update with its contents
- ✔ Pull: success is confirmed, the schema is imported and ACTIVE
- ✔ Pull: the CASE/DECODE definition edited on Device A is present on Device B (X = Cancelled)
- ✔ Pull: Manual Selectors on Device B offer the pulled definition and generate SQL from it
- ✔ Pull: Device B now shows the saved passphrase (masked), nothing pending
- ✔ Update on Device A: the new local edit is pending again (not published)
- ✔ Update on Device A: 'Sync with GitHub Now' publishes the encrypted update
- ✔ Update on Device A: after publishing, nothing is pending
- ✔ Update on Device B: the newer repository version is detected and offered
- ✔ Update on Device B: the update arrived (Z = Archived)
- ✔ Repeated pull: 'already up to date' — nothing duplicated, nothing rewritten
- ✔ Conflict: a schema changed on both devices is flagged with what to do — neither side is overwritten
- ✔ Conflict: the result is a PARTIAL result (not 'success'), names the schema, and the local edit is kept
- ✔ Conflict: Settings → Schema Management lists it with Use Local / Use Remote and the status counts it
- ✔ Conflict: 'Use Remote' applies Device A's version and clears the conflict
- ✔ Failure — incorrect passphrase: clear message, local schema unchanged
- ✔ Failure — missing / unusable passphrase: refused before the repository is contacted
- ✔ Failure — empty passphrase: no request reached the repository
- ✔ Failure — authentication: the rejected token (401) is named, the next step is given, local schema unchanged
- ✔ Failure — permission (403): reported with the right class and next step
- ✔ Failure — network interruption: the retrieval message with a next step; local schema unchanged
- ✔ Failure — timeout: a request that never answers ends with a clear message within the time limit; the app stays usable
- ✔ After a timeout the very next pull works (the synchronization queue was not blocked)
- ✔ Failure — corrupted file: decryption failure reported, local schema unchanged
- ✔ Failure — incompatible format: says the format cannot be read and to update SQL Assistant
- ✔ Failure — invalid schema content: validation failure with the location of the problem; local schema unchanged
- ✔ Failure — missing schema file: reported with the path and what to ask for
- ✔ Recovery: with the file restored the pull works again and no stale error remains
- ✔ Failure — the device cannot save the schema (storage refuses): reported as a SAVE failure (not 'validation'), the working schema is kept
- ✔ Cancel: leaves the local schema exactly as it was
- ✔ Secrecy: no passphrase or token reached the console, the URL or any page text in the failure flows
- ✔ Plain synchronization (no schema passphrase): Device D publishes to the shared remote; the status shows the plain file
- ✔ Plain synchronization: Device E retrieves it ('Sync with GitHub Now'), the schema is validated and the definition is present
- ✔ Plain synchronization failure (token rejected): reported with the failing stage; local schema untouched
- ✔ Hamburger menu: 'Schema' is present
- ✔ Schema page: the 'Pull Schema' option is available as a tab next to Tables and Stored Schemas
- ✔ Instructions: the 8 steps (menu → Schema → passphrase → pull → authenticate → choose → wait → verify) are visible
- ✔ Instructions: the original three sentences are still there (what to do, why a passphrase, keep it secure)
- ✔ Instructions stay compact: the help box is unchanged in height and the steps are two columns
- ✔ Status: connection, passphrase and sync state are shown without revealing any secret
- ✔ Vault Sync Passphrase: the page says it is never stored (so it cannot be shown) and where to enter it
- ✔ Passphrase: masked by default; the eye button reveals and hides it
- ✔ Passphrase: show → visible, hide → masked again
- ✔ Missing passphrase configuration: pulling with an empty field is handled with a clear message
- ✔ No published schema yet: reported as unavailable with the file path and the next step
- ✔ Pull with a saved-nothing device: preview works with the typed passphrase
- ✔ Passphrase status: after a successful pull the passphrase is saved (encrypted) and shown masked; it is not in the page text
- ✔ Passphrase storage: only AES-256-GCM ciphertext on the device — never plaintext or Base64
- ✔ Passphrase management: 'Remove saved passphrase' works and the status updates
- ✔ Secrecy: the shared repository files and every request body contain no passphrase and no token
- ✔ Responsive (desktop 1366px): Pull Schema with status and steps, the CASE/DECODE controls and the Schema Management status fit without horizontal scroll
- ✔ Responsive (tablet 768px): Pull Schema with status and steps, the CASE/DECODE controls and the Schema Management status fit without horizontal scroll
- ✔ Responsive (phone 390px): Pull Schema with status and steps, the CASE/DECODE controls and the Schema Management status fit without horizontal scroll
- ✔ No console errors or uncaught exceptions in any V17.5.2 flow

### V17.5.1 regression browser checks (59)
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
- ✔ No definition: 'From Schema' is not available (disabled) and the reason is shown; the SQL stays plain
- ✔ No definition: the plain column is used and no CASE/DECODE is invented
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
- ✔ Version 17.5.3 in footer; no old product name
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
- ✔ Republished: writer 17.5.3, all 437 decode entries
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
