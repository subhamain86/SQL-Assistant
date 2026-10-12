### Test report: SQL Assistant 17.5.5

Run on the **final** build (`build/`, `dist/`, `dev-dist/`, `release/`, `test-results/` and the root `index.html` were removed first; no source changed afterwards). Every figure below comes from the result files written by the runs.

| Check | Result |
|---|---|
| TypeScript validation (`tsc --noEmit`, strict) | **0 errors** |
| Lint (80 files, no import cycles) | passed |
| Security check (`npm run security`) | passed |
| Node tests (`test/*.test.mjs`, serial): V17.5.4's 94 + 8 new | **102/102** (three consecutive runs: tests 102 pass 102 fail 0 · tests 102 pass 102 fail 0 · tests 102 pass 102 fail 0) |
| Development build + production build | succeeded (single self-contained page, 645 KB) |
| Real-browser suite of V17.5.5 (`browser_test_v1755.py`) | **75/75** |
| Real-browser regression suite of V17.5.4 (`browser_test_v1754.py`) | **47/47** |
| Real-browser regression suite of V17.5.2 (`browser_test_v1752.py`) | **89/89** |
| Real-browser regression suite of V17.5.1 (`browser_test_v1751.py`) | **59/59** |
| Real-browser regression suite of V17.5 (`browser_test_v175.py`) | **85/85** |
| Real-browser regression suite of V17.4 (`browser_test_v174.py`) | **120/120** |
| Real-browser regression suite of V17.3.1 (`browser_test.py`) | **56/56** |

**531 real-browser checks in total** (Chromium / Playwright, **production** build).
**Mutation checks (not part of the totals):** with the repository configuration made visible by default, three V17.5.5 checks fail; with both duplicate-click guards removed, both duplicate-request checks fail; restored, everything passes. A third mutation (a draft bug found by the tests, not injected): after a *successful* pull the card stayed on "Retrieving…" — found by the first real two-device run and fixed (see CHANGELOG).

### What was and was not tested against the real service
* Tested: the app's **real GitHub client** against an **emulation of the GitHub Contents API** that serves only `basware/sk-ap-sql-assistant`. Each browser profile is configured through the UI; nothing is shared through browser storage; every request URL, branch and written path is inspected.
* **Not tested:** github.com itself (no network access or credentials in the build environment) — **no repository on github.com was read or written**; a real database (SQL is validated, not executed). `package-lock.json` does not exist, so a lockfile install was not possible.

### V17.5.5 browser checks by area (75)
| Area | Checks |
|---|---|
| A. The three cards, hidden + read-only configuration, Settings pages | 19 |
| B. Identity (version, name) | 2 |
| C. Pull Schema from GitHub — functional, integration, duplicate requests | 15 |
| D. Pull Schema — failures leave the local schema intact | 12 |
| E. Secret Vault: Pull (Schema) and Push (Settings) are independent | 14 |
| F. One repository for every operation, secrecy, source / bundle | 5 |
| G. Regression | 4 |
| Responsive layout | 3 |
| Console errors | 1 |

### Requested acceptance criteria → evidence
| Criterion | Evidence |
|---|---|
| The application identifies itself as V17.5.5 | "Identity: …" (title, footer, About, `version.json`) |
| UI consistent with V17.5.4 | the V17.5.4 suite (47) and screenshots; no layout / style change outside the touched cards |
| All three cards appear under Hamburger → Schema | "Cards: … exactly three cards, in this order" |
| Configuration hidden by default; revealed only through the control; stays read-only | "Hidden by default: …" (2), "Reveal: …", "Read-only even when revealed: …", "Hide / show: …", "Reveal / hide never changes the saved configuration …", "Reveal state is not kept …" |
| Pull Schema from GitHub contains only the action button | "Card 'Pull Schema from GitHub': contains ONLY the Pull Schema button …", "… no passphrase-related wording" |
| Old Schema passphrase card absent from Settings → Schema Management | "Settings → Schema Management: …" |
| Repository configuration card absent from Settings → Secret Vault; Push retained | "Settings → Secret Vault: …" (2) |
| Pull Schema uses the configured repository, branch and path | "Pull Schema uses the configured repository, branch and schema path …" (request URLs inspected), "One repository / One branch / One schema path" |
| Schema validation and synchronization work | "Pull Schema: ONE click …", "Pulled schema: …", "Repeated pull …", failures section, V17.5 / V17.5.2 pull flows |
| Pull Secret Vault uses the default passphrase and preserves the data format | "Pull Secret Vault: with the default passphrase …", "Push Secret Vault: the data format is unchanged …" |
| Push Secret Vault independent of the pull | "Push Secret Vault never invokes the pull …" |
| Repository configuration consistent across operations | "One repository: …" (schemas, knowledge, admin message, Pull Schema, Push / Pull Secret Vault) |
| Authentication, encryption and permission checks intact | failure checks (401, 403, passphrase-protected file, default passphrase not used for schemas); V17.5.2 / V17.5 suites |
| Failures give useful messages without exposing secrets | "Failure — …" (12 pull + 3 vault), "Secrecy: …" (3) |
| Repeated clicks cause no duplicate / conflicting operations | "Duplicate requests: …" (2), "Pull Secret Vault: six clicks …" |
| Regression: SQL generation, schema import / browsing / search, module and table / column selection, Advanced Options, Settings, navigation, persistence, responsive | "Integration — …" (4), "Regression: …" (4), "Responsive …" (3) and the six earlier suites (456 checks) |

### V17.5.5 browser checks (75)
- ✔ Cards: Hamburger → Schema → Pull Schema shows exactly three cards, in this order — GitHub repository (schema synchronization) · Pull Schema from GitHub · Pull Secret Vault to Repository
- ✔ Tabs: Hamburger → Schema keeps its three tabs and has no push action
- ✔ Hidden by default: neither the repository, the branch nor the schema file path appears anywhere on the page — not in the card, the status block or the instructions
- ✔ Hidden by default: the reveal button says 'Show configuration' and reports aria-expanded=false
- ✔ Reveal: the button shows the three configured values exactly (basware/sk-ap-sql-assistant · main · sql-assistant-data/schemas/registry.json)
- ✔ Read-only even when revealed: readonly + aria-readonly on all three, typing / Backspace / Delete / paste change nothing, and the browser refuses to fill them
- ✔ Reveal: the details message (which files are read and written, token permissions) appears together with the values and contains no secret
- ✔ Hide / show: repeated use is reliable (6 more presses end hidden→shown→…→shown) and the values are never changed
- ✔ Reveal / hide never changes the saved configuration: browser storage is byte-identical after revealing, trying to edit and hiding
- ✔ Reveal state is not kept: after leaving the page the configuration is hidden again
- ✔ Card 'Pull Schema from GitHub': contains ONLY the Pull Schema button (no passphrase field, eye button, remember checkbox, Apply / Cancel / Remove-passphrase button, no input at all)
- ✔ Card 'Pull Schema from GitHub': no passphrase-related wording at all (instructions, status, labels, hints)
- ✔ Card 'Pull Schema from GitHub': short instructions (3 steps) and a status line without any secret, repository name or path
- ✔ Card 'Pull Secret Vault to Repository': the default Vault Sync Passphrase is pre-filled and masked (password field, 20 characters), with Retrieve and Import actions
- ✔ Card 'Pull Secret Vault to Repository': the eye button reveals the default (xG71…) and hides it again
- ✔ Card 'Pull Secret Vault to Repository': the default passphrase is not in the rendered markup, the page text, browser storage or the console
- ✔ Settings → Schema Management: the 'Schema passphrase — encrypted synchronization' card and its controls are absent; every other panel is still there
- ✔ Settings → Secret Vault: the GitHub repository configuration card is absent; Push Secret Vault to Repository is the only operation and its fields (passphrase, confirmation, vault file path) are there
- ✔ Settings → Secret Vault: exactly one button pushes (no second push / pull action) and it says it only pushes
- ✔ Identity: the application identifies itself as SQL Assistant V17.5.5 (title, footer, About, release metadata) and the name is unchanged
- ✔ Identity: the navbar still shows 'SQL Assistant' with the version and the existing controls
- ✔ Setup (Device A): 'Sync with GitHub Now' publishes the plain schema file to the configured path — no passphrase involved
- ✔ No token yet: Pull Schema explains what to do (set the token), sends no request, changes nothing
- ✔ No token yet: the 'Go to the GitHub repository card' button moves focus to the token control on the same page
- ✔ Pull Schema: ONE click retrieves and synchronizes — success is confirmed, the schema is added / updated and ACTIVE
- ✔ Pull Schema uses the configured repository, branch and schema path: every request went to basware/sk-ap-sql-assistant, exactly ONE read of sql-assistant-data/schemas/registry.json on branch main, no write, no other file
- ✔ Pull Schema is read-only: no file in the repository changed
- ✔ Pulled schema: tables, columns and the CASE/DECODE definition edited on Device A arrived (X = Cancelled, 5 entries)
- ✔ Pull Schema: after success nothing is 'not yet published' and the status shows the new last-download time — no repository name or path
- ✔ Integration — schema browsing: Schema → Tables & Views lists the pulled schema's tables and the badge shows the active schema
- ✔ Integration — module selection and search: the modules of the pulled schema are offered, selecting one filters the tables, searching finds tables
- ✔ Integration — SQL generation and query editing: the SQL uses the pulled CASE/DECODE definition and passes validation; Advanced Options still apply
- ✔ Integration — Describe What You Need and the offline NLU work on the pulled schema
- ✔ Repeated pull: nothing to change — success, no duplicate schema, still exactly one read per click
- ✔ Duplicate requests: six clicks in the same instant start ONE retrieval (one read, no write), the button is disabled while it runs
- ✔ Duplicate requests: a double click is one retrieval too
- ✔ Failure — authorization (401): the rejected token is named with the next step; local schema intact; no success; the token is not in the message
- ✔ Failure — repository permission / rate limit (403): reported with the next step; local schema intact
- ✔ Failure — network interruption: 'could not be retrieved' with the next step; local schema intact
- ✔ Loading state is real: while GitHub does not answer the button is disabled and 'Retrieving…' shows; then the timeout is reported and the button works again; local schema intact
- ✔ Failure — no schema file in the repository: 'No schema file was found … yet' with the next step (a warning, not success); local schema intact
- ✔ Failure — the repository holds a passphrase-protected schema file: reported (not as 'missing'); NOT opened with the default Secret Vault passphrase; local schema intact
- ✔ Failure — unreadable / damaged file: reported with the next step; local schema intact
- ✔ Failure — incompatible (newer) schema format: says so and to update SQL Assistant; local schema intact
- ✔ Failure — invalid schema content: it is NOT imported, the result is a partial result that names the validation failure (never 'success'); local schema intact
- ✔ Failure — the device cannot save the schema (storage refuses): reported as a SAVE failure, not as validation; the working schema is kept
- ✔ Recovery: with the file restored the very next pull works, shows only the new result and no stale error
- ✔ Secrecy: no token or passphrase reached the console, the URL or any message in the failure flows
- ✔ Push Secret Vault (Settings): works on its own — validated, encrypted, written once, read back and verified
- ✔ Push Secret Vault never invokes the pull: it reads only the vault file (for its revision) and writes only the vault file — no schema file is read or written, and this device's own vault is not re-imported
- ✔ Push Secret Vault: the data format is unchanged (AES-256-GCM, PBKDF2-SHA256) and the file contains no token, no passphrase and no Base64 of them; no unrelated file was touched
- ✔ Push Secret Vault: it uses the repository and branch of the Schema section (every request → basware/sk-ap-sql-assistant, branch main)
- ✔ Pull Secret Vault: opening the page, using the eye and leaving the default untouched does not change anything that is saved on this device
- ✔ Pull Secret Vault: with the default passphrase it retrieves, decrypts and validates the vault — this device now holds the token that was pushed
- ✔ Pull Secret Vault: it only READS — one read of the vault file, no write, no schema file touched; every request used the Schema section's repository and branch
- ✔ Pull Secret Vault: the existing data format is read as before and the passphrase / token appear nowhere (markup, text, storage, console, URL)
- ✔ Default vs typed: the vault is now protected with another passphrase — the default is refused ('wrong or the data was modified'), nothing saved on the device changes, no success, the passphrase is not echoed
- ✔ Default vs typed: typing the right passphrase overrides the default and the pull succeeds
- ✔ Pull Secret Vault failure — authorization (401): reported, nothing saved changes, no secret in the message
- ✔ Pull Secret Vault failure — network error: reported, nothing saved changes
- ✔ Pull Secret Vault failure — no vault in the repository: reported, nothing saved changes
- ✔ Pull Secret Vault: six clicks in the same instant start ONE retrieval (one read, no write)
- ✔ One repository: schemas, knowledge, admin message, Pull Schema, Push Secret Vault and Pull Secret Vault — every one of the requests went to basware/sk-ap-sql-assistant
- ✔ One branch: every read used branch main and every write was committed to branch main
- ✔ One schema path: the plain schema file is sql-assistant-data/schemas/registry.json; knowledge, admin message and vault paths are siblings in the same folder tree
- ✔ Secrecy: no token, no default passphrase and no Base64 of them in any repository file or request body written by any operation
- ✔ Source and bundle: no GitHub token anywhere; the default passphrase is defined in ONE source file and — as disclosed — ships in the bundle
- ✔ Regression: every route renders and the 8 Settings tabs are unchanged
- ✔ Regression: Synchronization (sync source / time, shared location, knowledge, admin message, migrations, log), AI/LLM Model and the Admin Query Library are unchanged
- ✔ Regression: Manual Schema Update still edits the schema (row editor present)
- ✔ Regression: the Guided Walkthrough still starts
- ✔ Responsive (desktop 1366px): the three cards fit without horizontal scroll — configuration hidden, revealed, and with a failure message shown
- ✔ Responsive (tablet 768px): the three cards fit without horizontal scroll — configuration hidden, revealed, and with a failure message shown
- ✔ Responsive (phone 390px): the three cards fit without horizontal scroll — configuration hidden, revealed, and with a failure message shown
- ✔ No console errors or uncaught exceptions in any V17.5.5 flow

### V17.5.4 regression browser checks (47)
- ✔ UI 1: Hamburger → Schema → Pull Schema displays the GitHub repository (schema synchronization) card
- ✔ UI 4: the repository configuration (values and details message) is hidden by default
- ✔ UI 2: repository, branch and schema path show the required values (basware/sk-ap-sql-assistant · main · sql-assistant-data/schemas/registry.json)
- ✔ UI 3: the configuration values are non-editable (read-only; typing, Backspace and Delete change nothing)
- ✔ UI 3b: the browser itself refuses to fill the repository field (not editable)
- ✔ UI 5: the reveal control shows the repository details message — synchronization details, no secret (the values and the message are revealed together)
- ✔ UI 5b: the button hides it again and keeps working when pressed repeatedly
- ✔ UI 5c: after leaving the page the configuration is hidden again (hidden by default every time)
- ✔ UI 6: 'Pull Secret Vault to Repository' is available in the Schema section with its passphrase, file path and the Retrieve / Import actions
- ✔ UI 6b: the Vault Sync Passphrase field is masked by default and pre-filled with the default value
- ✔ UI 6c: the eye button reveals the default value and hides it again
- ✔ UI 6d: the default value is never written into the rendered page markup, the visible text, browser storage or the console
- ✔ UI 6e: the default value is defined in exactly ONE source file (centralized, easy to remove or rotate) and — as disclosed — ships inside the application bundle
- ✔ UI 7: no separate 'Push to GitHub' action appears in Schema (tabs: Tables & Views · Stored Schemas · Pull Schema)
- ✔ UI 7b: the old deep link #schema-used/push no longer opens anything push-related
- ✔ UI 8: Settings → Schema Management no longer displays the 'Schema passphrase — encrypted synchronization' card or its controls
- ✔ UI 9: Settings → Secret Vault no longer displays the GitHub repository (schema synchronization) card or its controls
- ✔ UI 10: Settings → Secret Vault retains Push Secret Vault to Repository — as its only action (no pull / retrieve / import there)
- ✔ UI 10b: the labels communicate the operation — Settings only pushes, and points to Schema → Pull Schema for the repository, the token and the pull
- ✔ UI 10c: the pointer button opens Schema → Pull Schema
- ✔ UI 11: all other pages and the navigation remain functional (every route renders, the 8 Settings tabs and the hamburger menu are unchanged)
- ✔ Token: before a token is saved the status says there is no repository connection
- ✔ Token: a wrong Admin Password is refused and the token is not saved
- ✔ Token: with the Admin Password it is saved encrypted, shown masked, and the status shows the fixed repository
- ✔ Token: saving the token did not change the repository values and the information message is hidden again after the re-render
- ✔ Sync: schema synchronization uses the configured repository, branch and file path — the plain schema file was written to sql-assistant-data/schemas/registry.json
- ✔ Sync: every request went to basware/sk-ap-sql-assistant, GETs read branch 'main', and only the schema file was written
- ✔ Compatibility: a device whose stored vault names another repository / branch / path still shows and uses the fixed values (nothing stored is deleted)
- ✔ Push (Settings): the passphrases must match — validated first, nothing written
- ✔ Push (Settings): Push Secret Vault to Repository still works — encrypted, written once, read back and verified
- ✔ Push (Settings): the repository file is AES-256-GCM ciphertext (no token, no passphrase, no Base64 of them) and no unrelated file was touched
- ✔ Pull Secret Vault: with the pre-filled default passphrase it retrieves, decrypts and validates the vault — the device now holds the pushed token
- ✔ Pull Secret Vault: the repository is only READ — no write request, no file changed, and only the vault file was read
- ✔ Pull Secret Vault: the token is never shown and not in the storage, markup or console of the receiving device
- ✔ Pull Secret Vault: the passphrase field kept its value and stays masked after the page re-rendered
- ✔ Failure — wrong passphrase: 'wrong or the data was modified', nothing changed, no success message
- ✔ Failure — authorization (401): the rejected token is reported, nothing changed
- ✔ Failure — network error: reported ('Could not reach GitHub'), nothing changed
- ✔ Loading state reflects the real operation: the button is disabled and 'Retrieving…' shows while GitHub does not answer; then the timeout is reported and the button is usable again
- ✔ Failure — no vault in the repository: 'No encrypted Secret Vault found', nothing changed
- ✔ No duplicate operations: a double click starts ONE retrieval (one GET, no PUT)
- ✔ Failure — no access token yet: explained, no request sent
- ✔ Import encrypted file (same card): retrieves the vault from a file with the pre-filled passphrase — the device now holds the pushed token
- ✔ Responsive (desktop 1366px): the repository card, the schema pull and the Secret Vault card fit without horizontal scroll, with the details message open
- ✔ Responsive (tablet 768px): the repository card, the schema pull and the Secret Vault card fit without horizontal scroll, with the details message open
- ✔ Responsive (phone 390px): the repository card, the schema pull and the Secret Vault card fit without horizontal scroll, with the details message open
- ✔ No console errors or uncaught exceptions in any V17.5.4 flow

### V17.5.2 regression browser checks (89)
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
- ✔ Device B (Schema menu): no repository connection yet — the status says so and the GitHub repository card above offers the way to fix it (Set Token)
- ✔ Missing credentials: pulling without an access token explains what to do and changes nothing
- ✔ Missing credentials: 'Go to the GitHub repository card' leads to the token field on the same page
- ✔ Device B: after configuring, the Pull Schema card shows the connection (repository name hidden) and has no passphrase UI
- ✔ Pull (Device B): ONE click retrieves the encrypted repository file, decrypts it with the saved Vault passphrase, validates it, imports and activates the schema — success is confirmed
- ✔ Pull: the CASE/DECODE definition edited on Device A is present on Device B (X = Cancelled)
- ✔ Pull: Manual Selectors on Device B offer the pulled definition and generate SQL from it
- ✔ Pull: Device B shows nothing waiting to be published and the card still has no passphrase field
- ✔ Update on Device A: the new local edit is pending again (not published)
- ✔ Update on Device A: 'Sync with GitHub Now' publishes the encrypted update
- ✔ Update on Device A: after publishing, nothing is pending
- ✔ Update on Device B: one click applies the newer repository version
- ✔ Update on Device B: the update arrived (Z = Archived)
- ✔ Repeated pull: nothing to change — nothing duplicated, nothing rewritten
- ✔ Conflict: a schema changed on both devices is a PARTIAL result (not 'success'), names the schema and says what to do — the local edit is kept, neither side is overwritten
- ✔ Conflict: Settings → Schema Management lists it with Use Local / Use Remote and the status counts it
- ✔ Conflict: 'Use Remote' applies Device A's version and clears the conflict
- ✔ Failure scenarios: the Pull Schema card has no passphrase field, no Apply / Cancel / Remember controls
- ✔ Failure — the Vault passphrase saved on this device does not open the repository file: clear message and next step, local schema unchanged, the passphrase is not echoed
- ✔ Failure — the repository file is passphrase-protected but no Vault passphrase is saved here: reported as protected (NOT as 'missing'), local schema unchanged
- ✔ Failure — authentication: the rejected token (401) is named, the next step is given, local schema unchanged
- ✔ Failure — permission (403): reported with the right class and next step
- ✔ Failure — network interruption: the retrieval message with a next step; local schema unchanged
- ✔ Failure — timeout: a request that never answers ends with a clear message within the time limit; the app stays usable
- ✔ Failure — the device cannot save the schema (storage refuses): reported as a SAVE failure (not 'validation'), the working schema is kept
- ✔ After the failures the very next pull works (the synchronization queue was not blocked) — and the success is not shown for a failure
- ✔ Failure — corrupted file: reported, local schema unchanged, no success message
- ✔ Failure — incompatible format: says the format cannot be read and to update SQL Assistant
- ✔ Failure — invalid schema content: it is not imported and the local schema is unchanged (a clear message names the problem)
- ✔ Failure — no schema file in the repository: reported as 'not found yet' with the next step, not as success
- ✔ Recovery: with the file restored the pull works again and no stale error remains
- ✔ Secrecy: no passphrase or token reached the console, the URL or any page text in the failure flows
- ✔ Plain synchronization (no schema passphrase): Device D publishes to the shared remote; the status shows the plain file
- ✔ Plain synchronization: Device E retrieves it ('Sync with GitHub Now'), the schema is validated and the definition is present
- ✔ Plain synchronization failure (token rejected): reported with the failing stage; local schema untouched
- ✔ Hamburger menu: 'Schema' is present
- ✔ Schema page: the 'Pull Schema' option is available as a tab next to Tables and Stored Schemas
- ✔ Instructions: three short steps (token → Pull Schema → verify) are visible and say a failure never changes the local schema
- ✔ Instructions stay compact (the help box is not a tall block)
- ✔ Status: the connection and the sync state are shown without revealing any secret — and without the repository name or the file path (hidden until revealed)
- ✔ Pull Schema from GitHub: the card contains ONLY the Pull Schema button — no passphrase field, eye button, Remember checkbox or any passphrase wording
- ✔ No published schema yet: reported as 'not found yet' with the next step — not as success, no error box
- ✔ A passphrase-protected file with no Vault passphrase saved on this device: reported with the next step (not as missing, nothing changed)
- ✔ With the passphrase saved on the device (earlier versions saved one) the same single click pulls it — and the page never shows or asks for it
- ✔ Passphrase storage (unchanged): only AES-256-GCM ciphertext on the device — never plaintext or Base64
- ✔ Secrecy: the shared repository files and every request body contain no passphrase and no token
- ✔ Responsive (desktop 1366px): Pull Schema with status, the CASE/DECODE controls and the Schema Management status fit without horizontal scroll
- ✔ Responsive (tablet 768px): Pull Schema with status, the CASE/DECODE controls and the Schema Management status fit without horizontal scroll
- ✔ Responsive (phone 390px): Pull Schema with status, the CASE/DECODE controls and the Schema Management status fit without horizontal scroll
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
- ✔ Regression: Schema Management keeps its V17.5 content (repository sync, stored schemas); the Schema passphrase card was removed in V17.5.4
- ✔ Responsive (desktop 1366px): the banner spans the navbar, shows the full text, keeps the dismiss button reachable and causes no horizontal scroll
- ✔ Responsive (small laptop 1024px): the banner spans the navbar, shows the full text, keeps the dismiss button reachable and causes no horizontal scroll
- ✔ Responsive (tablet 768px): the banner spans the navbar, shows the full text, keeps the dismiss button reachable and causes no horizontal scroll
- ✔ Responsive (phone 390px): the banner spans the navbar, shows the full text, keeps the dismiss button reachable and causes no horizontal scroll
- ✔ Dark theme: banner text uses the theme text colour and differs from the background
- ✔ Regression: the Guided Walkthrough still starts and highlights navbar controls while the banner is shown
- ✔ No console errors or uncaught exceptions in any V17.5.1 flow

### V17.5 regression browser checks (85)
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
- ✔ Publish: the schema is published as an encrypted, read-back-verified file and the result says so
- ✔ Publish: the repository file is real AES-256-GCM (PBKDF2) with versioned header metadata
- ✔ Publish: nothing readable is in the repository — no schema, table, column, decode label, passphrase or Base64 of them
- ✔ Publish: the passphrase is stored on the device only as ciphertext
- ✔ Pull: Hamburger menu → Schema opens the Schema page with a 'Pull Schema' tab
- ✔ Pull: the Pull Schema from GitHub card has ONE action (Pull Schema) and no passphrase field or any passphrase wording (V17.5.5)
- ✔ Pull: the page shows short instructions
- ✔ Pull: the instructions are compact (not a tall block)
- ✔ Pull: success is confirmed with 'Schema pulled and validated successfully.' and no stale error
- ✔ Pull: the schema is imported and ACTIVATED (the navbar badge and active schema show it)
- ✔ Pull: structure, tables, columns, data types, relationships, CASE/DECODE definitions, version, identifier and updated time are preserved
- ✔ Pull: the passphrase is never in the page text, the URL or the console
- ✔ Pull: Manual Selectors use the new schema straight away (no restart)
- ✔ Pull: the schema CASE/DECODE definitions of the pulled schema are available (1 = Open · 2 = Approved · 3 = Rejected)
- ✔ Pull: Describe What You Need and the offline NLU use the new schema and its CASE/DECODE
- ✔ Pull: the imported schema survives a page refresh
- ✔ Pull: the deep link #schema-used/pull opens the Pull Schema tab
- ✔ Pull: pulling again says nothing needed to change (no duplicates)
- ✔ Failure — the saved Vault passphrase does not open the repository file: reported with the next step, local schema unchanged, the passphrase is not echoed
- ✔ Failure — the repository file is passphrase-protected but no Vault passphrase is saved here: reported (not 'missing'), local schema unchanged
- ✔ Failure — missing schema: 'No schema file was found in the repository yet' with the next step (not success), local schema intact
- ✔ Failure — corrupted schema: reported, local schema intact, no success message
- ✔ Failure — decryption failure (header tampered with): reported, local schema intact
- ✔ Failure — unreadable file: reported, local schema intact
- ✔ Failure — a plain (unencrypted) file in the encrypted location is reported, local schema intact
- ✔ Failure — invalid schema: it is not imported ('failed validation … not loaded', with the location of the problem), the result is partial, the local schema is intact
- ✔ Failure — network / repository failure: the retrieval message, technical detail, local schema intact
- ✔ After every failed pull the user's own work is untouched
- ✔ No stale errors: after a failure, a successful retry shows only the new result
- ✔ Older schema: the repository copy is older than the local one — 'was not applied', reported as a partial result (never as success)
- ✔ Older schema: the newer local schema is not replaced
- ✔ Publish: re-publishing under a changed passphrase replaces the encrypted file (explicit replacement)
- ✔ Passphrase changed by the admin: a device still holding the OLD saved passphrase is told so, with the next step — local schema unchanged
- ✔ Passphrase changed by the admin: a device that holds the NEW passphrase pulls with the same single click
- ✔ Existing sync: 'Sync with GitHub Now' keeps working with a saved passphrase (encrypted file)
- ✔ Existing sync: the repository still holds only the encrypted file (no plain schema is written)
- ✔ Existing sync: without a passphrase the classic plain synchronization works exactly as in V17.4
- ✔ Existing sync: the plain file now also carries the app version and the writer stamp
- ✔ Existing Secret Vault: Settings → Secret Vault keeps Push Secret Vault to Repository; the repository / token / pull controls moved to Schema → Pull Schema (V17.5.4)
- ✔ Existing Settings: Admin Query Library is unchanged
- ✔ Existing Settings: Manual Schema Update is unchanged
- ✔ Existing Settings: AI/LLM Model is unchanged
- ✔ Security: no credential, no hard-coded passphrase and no key material in the production bundle
- ✔ Security: nothing the user typed as a passphrase reached any console message
- ✔ Responsive (desktop 1366px): Pull Schema, the CASE/DECODE controls and the Settings passphrase panel fit without horizontal page scroll
- ✔ Responsive (tablet 768px): Pull Schema, the CASE/DECODE controls and the Settings passphrase panel fit without horizontal page scroll
- ✔ Responsive (phone 390px): Pull Schema, the CASE/DECODE controls and the Settings passphrase panel fit without horizontal page scroll
- ✔ No console errors or uncaught exceptions in any V17.5 flow

### V17.4 regression browser checks (120)
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
- ✔ Version 17.5.5 in footer; no old product name
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
- ✔ Republished: writer 17.5.5, all 437 decode entries
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
