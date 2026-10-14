### Source provenance (V17.6.7)

#### Baseline used
* **`SQL-Assistant-V17.6.6.zip`** — the attachment; the sole implementation baseline and last-known-good UI (the SharePoint links point to the same file). Extracted, built and tested unchanged first (216/216 Node tests) before any change. Nothing was copied from any other version.

#### What could NOT be accessed or done (stated, not simulated)
* **No real GitHub, GitHub Actions run, Azure broker or deployed site.** Repositories were emulated: an in-memory repository (Node); `test/support/github-stub.mjs` (a private repository, tokens, the real GitHub client); the **real** repository access service (`server/repo-broker.mjs`, separate process); the **real** publication script and a real static server (published copy). The user's actual deployment path (token / central access / published copy / file opened from disk) is **not known** to the build environment — see "Still to check" in `TEST_REPORT_V17.6.7.md`.
* The SharePoint folders were not browsable; `package-lock.json` is still absent (registry blocked).

#### Interpretation notes for V17.6.7
* The request says the default keeps being accepted "on a newly installed device". The V17.6.6 code already rejected it at the moment of a check wherever the repository was reachable; what remained reproducible is the **Settings session opened with the default before the repository was reachable** (and the misleading lock-screen hint). That is what was fixed; where the repository is not reachable at all the default stays valid by design (V17.6.2 contract) and is now reported as unverified.
* "Temporary validation" = the in-memory, secret-free authentication trace (`adminAuth.diagnostics()`, e2e only) and the automated tests; no logging to the console or to storage was added.

---

### Source provenance (V17.6.6)

#### Baseline used
* **`SQL-Assistant-V17.6.5.zip`** — the attachment; the sole implementation baseline and last-known-good UI (the SharePoint links point to the same file). Extracted, built and tested unchanged first (195/195 Node tests) before any change. Nothing was copied from any other version.

#### What could NOT be accessed or done (stated, not simulated)
* **No real GitHub, GitHub Actions run, Azure broker or deployed site.** The repository is an in-memory emulation (Node) or the **real publication script + static server** (browser test: a new device reads the published copy exactly as in production). Whether the real *Publish SQL Assistant data* workflow has published the record, and a device's real GitHub sign-in, are **unverified**.
* The SharePoint folders were not browsable; `package-lock.json` is still absent (registry blocked).

---

### Source provenance (V17.6.5)

#### Baseline used
* **`SQL-Assistant-V17.6.4.zip`** — the attachment (229 files); named by the request as the baseline and last-known-good UI (the SharePoint links point to the same file). Extracted, type-checked, built and tested unchanged first (172/172 Node tests) before any change. Nothing was copied from any other version.

#### What could NOT be accessed or done (stated, not simulated)
* **No real GitHub, GitHub Actions run, Azure broker or site** was reachable. The repository is an in-memory emulation (Node tests; one live shared repository for several Chromium "devices" in the browser test). Whether the central file can be written by your real repository access service / token, and published by the real *Publish SQL Assistant data* workflow, is **unverified** — see "Still to check" in `TEST_REPORT_V17.6.5.md`.
* The SharePoint folders (TypeScript / Raw archives) were not browsable; only the attached ZIP was used.
* The npm registry is blocked; TypeScript 5.8.3 (the pinned version, pre-installed) was run directly. `package-lock.json` is still absent.

#### Interpretation notes for V17.6.5
* **"Maintain a single authoritative encrypted Admin Password"** = one record in the repository holding the *existing encrypted verification marker* (not the password, not a reversible copy). That keeps "never store or expose the password in plaintext" and "preserve existing encryption" literally true.
* **"Reset … to default" while the reset must be central:** a reset is a record with `isDefault: true`. Deleting the repository file is deliberately not a reset (it would let a stale publication downgrade devices); `npm run reset-admin-password` is the recovery path.
* **"Do not modify any other security settings":** the reset touches only the marker and the new synchronization meta; the browser test proves the rest of browser storage is byte-identical. The Danger Zone's existing *Reset password* button was routed through the same central reset (otherwise it would create exactly the device-specific divergence the request forbids).
* **Synchronization is not gated by the "Sync Source" selection** (default GitHub): whenever a repository connection exists the Admin Password converges on the central record.

---

### Source provenance (V17.6.4)

#### Baseline used
* **`SQL-Assistant-V17.6.3.zip`** — the attachment; named by the request as both the last-known-good UI and the latest version (the two SharePoint links point to the same file, `Project/Raw/SQL-Assistant-V17.6.3.zip`). Extracted, then lint, production build and the Node tests (167/167) were run **unchanged** before any change. It is returned unchanged as `SQL-Assistant-V17.6.3-rollback.zip`.
* Nothing was copied from any other version.

#### What could NOT be accessed or done (stated, not simulated)
* **The failing GitHub Actions run logs** were not available (only the notification e-mails: build job failed in 11 / 22 s, deploy skipped). The root cause on GitHub is therefore **not confirmed**; the defects fixed are those reproduced locally (see `CHANGELOG_V17.6.4.md`).
* **No GitHub Actions run, no real GitHub and no real site** were reachable. Workflow YAML was parsed and asserted by source tests; the stages were run as the underlying `node` commands in the workflow's order.
* **The npm registry is blocked** (HTTP 403): `npm install` could not run and **`package-lock.json` could not be generated**. TypeScript 5.8.3 (pre-installed, the exact version now pinned) was used through `node_modules/typescript`; the shipped package does not contain `node_modules`.
* **No Chromium / Playwright browser** was available: the browser test scripts were updated to 17.6.4 but **not run**.
* The SharePoint folders were not browsable from the build environment.

---

### Source provenance (V17.6.1)

#### Baseline used
* **`SQL-Assistant-V17.5.7.zip`** — the attachment (165 files), named by the request as the latest source and the last-known-good UI. Extracted, type-checked, built and tested unchanged before any change; V17.6.1 modifies only the files listed in `CHANGELOG_V17.6.1.md`. It is returned unchanged as `SQL-Assistant-V17.5.7-rollback.zip`. `scripts/compare_v1761.py` renders both builds side by side.
* The V17.5.8 / V17.5.9 / V17.6 packages mentioned earlier in this conversation were **not available** in this session; nothing was copied from them. A OneDrive search showed `SQL-Assistant-V17.5.8.zip` (text index only, not downloadable here) — it was not used.

#### What could NOT be accessed or done (stated, not simulated)
* The **SharePoint folders** (all TypeScript versions / all project versions) were not browsable from the build environment.
* **github.com** and a real **GitHub App / SAML-SSO organization** were not reachable. The relay ran for real (separate process, real HTTP / CORS) against a local stub of github.com's two device endpoints; the repository API is an emulation (private repository, Bearer auth, 401 / 403 / 404, read-only and no-access tokens). "Device A / B" are separate Chromium contexts (isolated localStorage, IndexedDB device key, cookies), not two physical machines. **No request reached github.com.**
* The project has **no Vite** and no `package-lock.json`; the pre-installed TypeScript compiler is the only build dependency. `npm` cannot reach the registry here, so the npm scripts were run as the underlying `node` / `python3` commands in the same order as `npm run verify`.

---

### Source provenance (V17.5.5)

#### Baseline used
* **`SQL-Assistant-V17.5.4.zip`** — the package placed in the chat's upload folder (the "last known good UI / latest version" named in the request: it points to V17.5.4). Its complete source, tests, scripts and documents were extracted and used as the baseline; V17.5.5 changes only what the request names (docs/CHANGELOG_V17.5.5.md). Before any change it was **built and tested unchanged** (production build, 94/94 Node tests).
* The archive was also reachable as a text index (Microsoft 365 search); only the uploaded binary was used. **No older version was needed and nothing was ported from one.**

#### What could NOT be accessed or done (stated, not simulated)
* The **SharePoint links** (TypeScript versions, all application versions) cannot be opened from the build environment; no other version was read or modified.
* **github.com** is not reachable and no credentials exist here. The tests run the app's **real GitHub client** against an **emulation of the GitHub Contents API** (Bearer auth, 401 / 403 / 404 / 409 / 422, sha concurrency, base64 content, outages, hung connections) that serves only `basware/sk-ap-sql-assistant`; each browser profile is configured through the UI and nothing is shared through browser storage. **No repository on github.com was read or written.**
* **package-lock.json does not exist** and the npm registry is blocked; the pre-installed TypeScript compiler (the only dev dependency) was used. A clean rebuild from the final ZIP is byte-identical to the shipped build (verified).
* No database was available (SQL is validated, not executed).

#### Interpretation notes for V17.5.5
* **Much of the request was already implemented in V17.5.4** (cards moved, passphrase card removed, push retained, default passphrase). V17.5.5 adds what was new: hidden configuration with a reveal button, a Pull Schema card with only the Pull button, version 17.5.5. See the table in CHANGELOG_V17.5.5.md.
* **"Pull Schema … no passphrase field … must not bypass any existing security validation"**: implemented as a one-click pull that uses a Vault passphrase only when one is already saved on the device and a protected file exists, and reports every file it cannot open; schema validation, the transactional write, conflict and older-schema rules are unchanged.
* **"Hidden" configuration** means not visible and not in the page text until revealed — including the status line — not a security control.
* **"Pull Secret Vault to Repository"** is the requested card name; the operation is the existing *Retrieve from Repository* / *Import encrypted file* (vault → this device). The card says so.
* **"Default passphrase"** = the pre-filled, masked Vault Sync Passphrase of that card (unchanged from V17.5.4).

---

#### Earlier provenance (V17.5.4, unchanged)


#### Baseline used
* **`SQL-Assistant-V17.5.3.zip`** — the package placed in the chat's upload folder (the "latest version / last known good UI" named in the request). Its complete source, tests, scripts and documents were extracted and used as the baseline; V17.5.4 changes only what the request names (docs/CHANGELOG_V17.5.4.md). Before any change it was **built and tested unchanged** (production build, 88/88 Node tests).
* The V17.5.3 archive was also reachable as a text index (Microsoft 365 search); only the uploaded binary was used. No older version was needed, nothing from an older version was ported.

#### What could NOT be accessed or done (stated, not simulated)
* The **SharePoint links** (TypeScript versions, all project versions) cannot be opened from the build environment; no older version was read or modified.
* **github.com** is not reachable and no credentials exist here. The tests run the app's **real GitHub client** against an **emulation of the GitHub Contents API** (Bearer auth, 401 / 403 / 404 / 409 / 422, sha concurrency, base64 content, outages, hung connections) that serves only `basware/sk-ap-sql-assistant`; each browser profile is configured through the UI and nothing is shared through browser storage. **No repository on github.com was read or written.**
* **package-lock.json does not exist** and the npm registry is blocked; the pre-installed TypeScript compiler (the only dev dependency) was used. A clean rebuild from the final ZIP is byte-identical to the shipped build (verified).
* No database was available (SQL is validated, not executed).

#### Interpretation notes for V17.5.4
* **"Default value" of the Pull Secret Vault card** = the Vault Sync Passphrase field (the only input of that card that takes such a value). It was implemented as a pre-filled, masked value; see SECURITY.md for the consequence of shipping it in the application.
* **"Pull Secret Vault to Repository"** is the requested card name; the operation is the existing *Retrieve from Repository* / *Import encrypted file* (vault → this device). The card says so.
* **"Non-editable"** repository values are read-only fields and are also enforced where the secrets are consumed, so a stale stored value cannot be used.
* **Token on the Schema page** asks for the Admin Password (Settings, where the token used to live, was password-protected).

---

#### Earlier provenance (V17.5.3, unchanged)

## Source provenance (V17.5.3)

### Baseline used
* **`SQL-Assistant-V17.5.2.zip`** — the package placed in the chat's upload folder (the V17.5.2 deliverable named in the instructions). Its complete TypeScript source, configuration, tests, build scripts, assets and documentation were extracted and used as the **authoritative source-code, functionality and UI baseline**. V17.5.3 was implemented incrementally on that architecture — nothing was rebuilt.
* Before any change the V17.5.2 package was **built and tested unchanged** (production build, 78/78 Node tests).
* A first attempt in this conversation could not use the archive because only a **text index** of it was reachable (it drops the HTML inside the source's template strings); the real binary was used as soon as it was available. No file was reconstructed from the text index.

### What could NOT be accessed or done (stated, not simulated)
* The **SharePoint links** cannot be opened from the build environment; only the uploaded ZIP was used. No other historical version was read or modified.
* **github.com** is not reachable and no GitHub credentials exist here. Publication and cross-device tests therefore run the app's **real GitHub client** against an **emulation of the GitHub Contents API** (Bearer auth, 401 / 403 / 404 / 409 / 422, sha concurrency, base64 content, outages, hung connections, a repository that cannot confirm a write) shared by independent browser profiles; nothing is shared through browser storage. **No repository was populated or updated on github.com** and no real token was used. Real-service behaviour (branch protection, SSO-authorized tokens, secondary rate limits, eventual consistency beyond the 2 read-back retries) was not exercised.
* **No passphrase was supplied** in the request (only the statement that one exists). None is embedded in the project, the tests use throw-away strings, and the application has no way to ship a production secret: each device receives the passphrase through the supported workflow. If a real passphrase has already been shared outside a secure channel, rotate it (docs/SECURITY.md).
* **`package-lock.json` does not exist** in the project and the npm registry is blocked, so "install from the lockfile" was not possible; the pre-installed TypeScript compiler (the only dev dependency) was used. A clean rebuild from the final ZIP is byte-identical to the shipped build (verified).
* **No database** was available; generated SQL is validated, not executed.

### Interpretation notes for V17.5.3
* **"Vault passphrase"** = the passphrase that encrypts the synchronized schema file (*Schema passphrase* in Settings). The *Vault Sync Passphrase* of the Secret Vault file is a different secret and is never stored, so it cannot be displayed (stated in the UI).
* **"Hamburger Menu → Schema"** = the existing *Schema* page; *Pull Schema* and the new *Push to GitHub* are its tabs. The menu structure is unchanged.
* **"Authenticate to GitHub"** = the repository connection (owner / repo / token) entered once per device in Settings → Secret Vault (Admin Password). The Vault passphrase alone never grants repository access.
* **"Push/Populate"** = publish the *schemas of this device* (not the Secret Vault file, which has its own push in Settings → Secret Vault, and not the knowledge file, which has its own synchronization).

---

## Earlier provenance (V17.5.2, unchanged)

### Baseline used
* **`SQL-Assistant-V17.5.1.zip`** — the package attached to the chat (the V17.5.1 deliverable named in the instructions). Its complete TypeScript source, configuration, tests, build scripts, assets and documentation were extracted and used as the **authoritative source-code and UI baseline**. V17.5.2 was implemented incrementally on that architecture — nothing was rebuilt and no older version was needed.
* Before any change the V17.5.1 package was **built and tested unchanged** (production build, 67/67 Node tests); the tick-mark latency, the duplicate alias, the numeric `ELSE` branch, the silent use of malformed definitions, the missing request time limit, the conflict-only preview and the partial-success message were each **reproduced on that unchanged build** before being fixed.

### What could NOT be accessed or done (stated, not simulated)
* The **SharePoint links** (TypeScript versions, all archives, V17.5.1) cannot be opened from the build environment. The attached ZIP is the file that was used; **no other historical version was read or modified**, and no fix was taken from one.
* **github.com** is not reachable and no GitHub credentials exist here. The cross-device tests therefore run the app's **real GitHub client** against an **emulation of the GitHub Contents API** (Bearer auth, 401 / 403 / 404 / 409 / 422, sha concurrency, base64 content, outages, hung connections) shared by independent browser profiles; **nothing is shared through browser storage**. Behaviour against the real service (rate-limit headers, large-file blobs, branch protection, SSO-enforced tokens) was not exercised.
* **`package-lock.json` does not exist** in the project and the npm registry is blocked, so "install from the lockfile" was not possible; the pre-installed TypeScript compiler (the only dev dependency) was used. A clean rebuild from the final ZIP is byte-identical to the shipped build (verified).
* **No database was available**: generated SQL is checked by the app's 12-point validator and unit tests, not executed on Oracle / SQL Server / PostgreSQL / MySQL.

### Interpretation notes for V17.5.2
* **"Valid CASE/DECODE definition":** the schema format stores code → label pairs, not an expression; CASE vs DECODE is rendered by the engine (DECODE on Oracle only). "Valid / incomplete / invalid" therefore describes that mapping.
* **"Vault passphrase … revealable":** the schema passphrase saved on a device (V17.5) can be shown and hidden. The *Vault Sync Passphrase* is never stored by design (V17.4) and cannot be shown; the page says so. The Admin Password gate on repository settings is deliberately not bypassed.
* **"Schema section of the hamburger menu":** the existing *Schema* page and its *Pull Schema* tab were extended; no second Schema page exists.

---

## Earlier provenance (V17.5.1, unchanged)

### Baseline used
* **`SQL-Assistant-V17.5.zip`** — the package attached to the chat (the file named in the instructions: `…/Project/Raw/SQL-Assistant-V17.5.zip`, the V17.5 deliverable). Its complete TypeScript source, configuration, tests, build scripts, assets and documentation were extracted and used as the **primary code, functionality and UI baseline**. V17.5.1 was implemented **incrementally** on that architecture — nothing was rebuilt.
* Before any change the V17.5 package was **built and tested unchanged** (production build, 59/59 Node tests), so every later difference is attributable to V17.5.1.
* The SharePoint link cannot be opened from the build environment; the attached zip is the same file. The Microsoft 365 text index of the archive loses the HTML inside template strings, so the attached binary was the only reliable source.
* **Clean install:** the npm registry is blocked in the build environment, so `npm install` was not run; the pre-installed TypeScript compiler (the only dev dependency) was used. The shipped build is byte-identical to a clean rebuild from the ZIP (verified).

### Interpretation notes for V17.5.1
* **"Short":** limited to 140 characters, one line, plain text.
* **"Cross device":** delivered through the repository connection every device already uses for schemas (a separate small file), not a new channel.
* **"In the nav bar":** a slim row inside the `<nav>` element, below the control row. A chip in the control row was built first and rejected: at 1366 px it squeezed the existing schema badge ("AP / P2P Cor…"), which would have changed the V17.5 navbar.
* **Unencrypted file:** chosen so that devices need no passphrase to read a notice; stated in the panel and the docs. (The schema file remains passphrase-protected exactly as in V17.5.)
* **No automatic expiry:** a message stays until an administrator clears it — there was no requirement for an expiry time.

---

## Earlier provenance (V17.5, unchanged)

### Baseline used
* **`SQL-Assistant-V17.4.zip`** — the package attached to the chat (the file named in the instructions: `…/Project/Raw/SQL-Assistant-V17.4.zip`). Its complete TypeScript source, configuration, tests, build scripts, assets and documentation were extracted and used as the **primary code, functionality and UI baseline**. V17.5 was implemented **incrementally on that architecture** — nothing was rebuilt from scratch, and no older version was needed.
* Before any change the V17.4 package was **built and tested unchanged** (production build, 45/45 Node tests) so that every later difference could be attributed to V17.5. The table tick-mark defect was **reproduced in a real browser on this unchanged build** before it was fixed.

### Not accessible
* The **SharePoint link** itself cannot be opened from the build environment (the sandbox has no route to SharePoint). The attached zip is the same file and was used instead. The Microsoft 365 text index of the archive loses the HTML inside template strings, so the attached binary was the only reliable source.
* **Clean install:** the npm registry is blocked in the build environment, so `npm install` was not run; the pre-installed TypeScript compiler was used (it is the only dev dependency). The shipped build is byte-identical to a clean rebuild from the ZIP (verified).

### Interpretation notes
* **"Passphrase" (singular):** V17.5 introduces one **schema passphrase** that protects the synchronized schema file. It is separate from the existing *Vault Sync Passphrase* (which protects the vault file) so that disclosing one never discloses the other; an administrator may choose the same text for both.
* **"Active passphrase display":** the passphrase saved on a device is shown **masked** with a show/hide button (Schema → Pull Schema, and Settings → Schema Management). It is stored on the device only as ciphertext under the device key.
* **Where the encrypted file lives:** `…/schemas/registry.enc.json` beside the plain registry, written and read by the existing synchronization service. An encrypted file cannot be addressed without the existing repository connection (owner / repository / token), which an administrator sets in the Secret Vault — Pull Schema deliberately does not introduce a second credential path.
* **Plain file left in place:** when an administrator switches to encryption, a plain `registry.json` already in the repository is **not deleted** (the app never deletes repository files). Remove it manually once every device has moved to the encrypted file.


### Source provenance (V17.5.7)

#### Baseline used
* **`SQL-Assistant-V17.5.5.zip`** — the package attached to the chat; both links of the request ("last known good UI" and "latest available project version") point to `…/Project/Raw/SQL-Assistant-V17.5.5.zip`. Built and tested unchanged first (102/102 Node tests, 75/75 browser checks) before any change.
* **A V17.5.6 package exists in your OneDrive but its source could not be read.** Microsoft 365 search lists a folder named *SQL-Assistant-V17.5.6* with its `.md` documents, but opening it returns "file not found", and the build environment was reset between sessions. V17.5.7 therefore re-implements the V17.5.6 requirements (which are repeated in the V17.5.7 request) **and** the V17.5.7 additions on top of V17.5.5, following the data flow found in the V17.5.5 source. **Please diff against your V17.5.6 build** if it contains changes that are not in the request; nothing was guessed about its contents.
* No older version was needed and nothing was ported from one. The partial implementations already present were corrected / extended, not duplicated.

#### What could NOT be accessed or done (stated, not simulated)
* The SharePoint folders (TypeScript versions, all project versions) cannot be browsed from the build environment.
* **github.com is not reachable** and no real token exists here; repository operations were verified against an in-memory repository (Node) and an HTTP emulation of the GitHub REST API used by the real GitHub client in a real browser (two separate profiles for the cross-device test). One real-GitHub smoke test is listed in TEST_REPORT_V17.5.7.md.
* `npm install` was not run (registry blocked); the pre-installed TypeScript compiler (the only dev dependency) was used.

### Source provenance (V17.6.2)

#### Baseline used
* **`SQL-Assistant-V17.6.1.zip`** — the package attached to the request (165+ files). It is the actual source baseline and the last-known-good UI. Extracted, type-checked, built and tested unchanged first (132 Node tests; browser suites V17.4 → V17.6.1 green) before any change. The request's "all TypeScript versions / all project versions" SharePoint folders could not be browsed from the build environment; no other version was read and nothing was ported.

#### What could NOT be accessed or done (stated, not simulated)
* **github.com, Azure and the GitHub Actions runtime are not reachable.** The broker was run as a real process with real HTTP and CORS against `test/support/github-stub.mjs`, a local model of a private repository, a fine-grained PAT, the device flow and the contents API. The two new workflows were validated as YAML and by source tests; they were **not executed** on GitHub. Run the acceptance check in `CENTRAL_PAT.md` on the real systems before relying on them.
* `npm install` was not run (registry blocked); the pre-installed TypeScript compiler (the only dev dependency, TypeScript 6.0.2 here — run `tsc --ignoreDeprecations 6.0` because `tsconfig.json` still uses `moduleResolution: node` as in V17.6.1; the project's own `build` is unaffected) was used.

### Source provenance (V17.6.3)

#### Baseline used
* **`SQL-Assistant-V17.6.2.zip`** — attached to the request; the actual source baseline. Built and tested unchanged first (155 Node tests) before any change. `SQL-Assistant-V17.6.1.zip` was not attached to this session; the UI comparison is against V17.6.2 (itself 14/16 pages identical to V17.6.1). The SharePoint folders could not be browsed; nothing was ported from another version.

#### What could NOT be accessed or done (stated, not simulated)
* github.com, GitHub Actions and the zone platform are not reachable from the build environment. The publication scripts were run as real processes and the application in real Chromium against real static servers; the GitHub REST API was emulated (`test/support/github-stub.mjs`); **no workflow was executed**.
* `npm install` was not run (registry blocked); the pre-installed TypeScript (6.0.2) was used with `--ignoreDeprecations 6.0` because `tsconfig.json` still uses `moduleResolution: node`.
