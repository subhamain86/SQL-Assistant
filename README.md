## SQL Assistant — V17.7

SQL Assistant writes read-only and Change Request SQL from your **Active Schema**.
Its primary engine is an **offline, self-training natural-language model** that also learns from SQL you confirm and from an **Admin Query Library** of trusted queries. An AI/LLM Model (including a model running on your own computer) can optionally be added; nothing requires it.

### What is new in V17.7.1
* **The GitHub connection is initialised when SQL Assistant opens.** `src/ui/githubState.ts` validates what already exists — a saved token (GitHub repository lookup), the central sign-in (access-service status) or the published copy — with **read-only requests** and reports the real state on the Home page. It never writes, never pulls or publishes by itself, never starts a sign-in by itself and never blocks start-up; it re-checks only when the token / repository changes or on *Check connection*. No second token store: the token stays in the Secret Vault.
* **GitHub repository on Home and in the hamburger menu.** Home: status, repository, write access, synchronization, last synchronization, *Pull Schema*, *Check connection*. Hamburger → *GitHub Repository*: the same repository card, Pull Schema and Pull Secret Vault cards (Schema → Pull Schema is unchanged).
* **Query Library (hamburger, top level).** *Add New Query*: a tested SELECT / WITH is checked, reviewed and saved as **Pending approval** (never a library entry; refused: destructive SQL, credentials, duplicates). *View Query Library*: the approved, enabled queries in the administrator's list presentation, read-only (search, details, copy SQL). Administrator: Settings → Admin Query Library → *Query submissions awaiting review* — approve / reject need the Admin Password again (a one-time action ticket enforced by the service, not by button visibility). See `docs/QUERY_LIBRARY.md` (including the architectural limit of a static application).
* Stamped `17.7.1`. See `docs/CHANGELOG_V17.7.1.md`, `docs/RELEASE_NOTES_V17.7.1.md`, `docs/VERIFICATION_REPORT_V17.7.1.md`, `docs/TEST_REPORT_V17.7.1.md`, `docs/REGRESSION_BASELINE_V17.7.1.md`, `docs/ERROR_LOG_REVIEW_V17.7.1.md`, `docs/CHANGED_FILES_V17.7.1.md`, `docs/ROLLBACK_V17.7.1.md`, `docs/QUERY_LIBRARY.md`.

### What was new in V17.7
* **Fix — the Admin Password authority confirms the default by evidence, and the production page has no test back door.** The browser-test hooks (`window.__sqla`, reachable in V17.6.9 through `?e2e=1`) moved to `src/testHooks.ts`, which is compiled only into the separate test build (`npm run build:test` → `test-dist/`); the production page runs in one function scope (no global `define` / module registry) and `npm run verify:artifact` fails on any trace of a hook. The default `admin` has one door (`verifyDefault`, only from the confirmed-default state); an empty marker, a marker that vanished after a central verifier was applied, a central record that vanished from the repository, a pending local "reset" and a missing marker can no longer turn into "use admin", and synchronization never publishes a reset.
* **No NPM at runtime.** Password retrieval / synchronization / validation / change / reset use only the repository, central access service or published copy; verified against plain static hosting (`scripts/browser_test_v177.py`).
* **Error logs reviewed** — `docs/ERROR_LOG_REVIEW_V17.7.md` separates the repository defect (59 stale files, remove once) from the external blockers (`AZURE_CREDENTIALS`, PAT Conditional Access 403).
* Stamped `17.7.0`. See `docs/CHANGELOG_V17.7.md`, `docs/RELEASE_NOTES_V17.7.md`, `docs/VERIFICATION_REPORT_V17.7.md`, `docs/TEST_REPORT_V17.7.md`, `docs/ERROR_LOG_REVIEW_V17.7.md`, `docs/STALE_FILES_V17.7.md`, `docs/ROLLBACK_V17.7.md`, `docs/CHANGED_FILES_V17.7.md`, `docs/ADMIN_PASSWORD.md`.

### What was new in V17.6.9
* **Fix — the default `admin` is confirmed, never presumed.** `admin` is accepted only in the explicit state `confirmed-default`: an administrator reset record, or the authoritative repository answering that no Admin Password was ever set. A new device, a missing connection, a refused credential, a failed read, an invalid record, a published copy that lists no record, or a synchronization in progress never enable it. States: `loading → central-applied | local-fallback | confirmed-default | error`. Storage keys, record format, revisions and the publish-first order are unchanged. See `docs/ADMIN_PASSWORD.md`.
* **Pipeline.** Tests, lint, security and the build start from `src/main.ts`; orphaned / stale files are detected separately (`npm run check:stale`, reviewed list `scripts/stale-files.json`, explicit removal); the project-pinned TypeScript 5.8.3 is used everywhere (no absolute path); `npm run verify:artifact` checks the generated outputs; deployment cannot start after a failed stage; missing deployment configuration (`AZURE_CREDENTIALS` …) blocks with `Deployment blocked: <KEY> is not configured.`; an HTTP 403 PAT check is a failed verification with the upstream diagnostic.
* **Tests.** Current-version assertions live in one place (since V17.7: `test/v177.test.mjs`); historical tests use explicit fixtures.
* See `docs/CHANGELOG_V17.6.9.md`, `docs/RELEASE_NOTES_V17.6.9.md`, `docs/VERIFICATION_REPORT_V17.6.9.md`, `docs/TEST_REPORT_V17.6.9.md`, `docs/STALE_FILES_V17.6.9.md`, `docs/ROLLBACK_V17.6.9.md`, `docs/CHANGED_FILES_V17.6.9.md`, `docs/DEPLOYMENT.md`.

### What was new in V17.6.8
* **Fix — the centralized Admin Password is enforced at the authentication boundary.** Every Admin Password check (Settings unlock, Security, repository configuration, token change, Admin Query Library) ends in ONE function, `verifyPassword()`, which asks the central-password authority first and obeys it. The default `admin` is accepted only for a central reset record, a repository (or published copy) that answered "no record exists", a standalone device that has no central source at all, or a device whose own repository credential is refused (it must be repairable) — never because a device is new, still loading, unable to read the record, or reading an invalid one. Settings open only with the one-time ticket of a successful check; no UI component compares passwords.
* **Explicit start-up states** `loading → central-applied | local-fallback | default-unverified | error` (renamed `confirmed-default` in V17.6.9); a check that arrives while the central record is loading waits. A central verifier that replaces a different one invalidates every Settings session (and the repository-configuration editor) at once.
* **Central changes publish first**: a new password or a reset is written to `sql-assistant-data/security/admin-password.json` (revision + 1, read back) and applied locally only after that succeeded; a stale device can never overwrite a newer revision; an unreachable repository never creates a default record. Formats, keys (`sqla.pwvault.v15`, `sqla.adminpwmeta.v1765`) and paths are unchanged.
* **Sync button in the navigation bar** — one run of the existing centralized synchronization (Admin Password, schemas and metadata, knowledge, admin message; the Secret Vault is reported, never changed). It reuses the existing repository authorization path, refuses duplicate runs, shows a syncing state and reports success / partial / skipped / failure honestly. In the responsive layout it is the first entry of the navigation panel's sync block.
* **CI build fix** for the supplied GitHub Actions log (247 TypeScript errors in 33 files that exist only in the repository: `src/components/*`, `src/pages/*`, `src/state/store.ts`, `src/ui/adminCredentialSync.ts`, `src/v17/services/adminCredential*.ts` …): `tsconfig.json` compiles from `src/main.ts` (all strict options unchanged), lint / security scan the same set and **name** every leftover; `npm run prune-orphans` lists them and `-- --delete` removes them. `node scripts/verify-no-npm.mjs` runs the whole verification without npm.
* See `docs/CHANGELOG_V17.6.8.md`, `docs/VERIFICATION_REPORT_V17.6.8.md`, `docs/TEST_REPORT_V17.6.8.md`, `docs/REGRESSION_BASELINE_V17.6.8.md`, `docs/ADMIN_PASSWORD.md`.

### What was new in V17.6.7
* **Fix — the default `admin` can no longer stay authorized after the central Admin Password exists.** A Settings session opened with the default on a device that could not yet reach the central record (no connection configured yet, or the read failed) is **locked again** when the central password is applied (start-up, scheduled sync, *Sync with GitHub Now*, or when Settings is shown); the unlock says honestly when the central record could not be checked; the lock screen asks for the central record straight away and drops the now-wrong "default password is admin" hint. Diagnostics: `docs/ADMIN_PASSWORD.md`. Nothing else changed. See `docs/CHANGELOG_V17.6.7.md`, `docs/TEST_REPORT_V17.6.7.md`, `docs/REGRESSION_BASELINE_V17.6.7.md`.

### What was new in V17.6.6
* **Fix — a new device now uses the central Admin Password.** A device that has no local Admin Password yet asks the central record (`sql-assistant-data/security/admin-password.json`) before it accepts anything, so the default `admin` is rejected whenever a valid central password exists; the unlock check waits for a synchronization that is already running instead of skipping it; a central record that cannot be read is reported (never as "synchronized") and changes nothing; and a repository connection that appears after start-up (GitHub sign-in, token / vault restore) is used by the very next unlock check. Nothing else changed. See `docs/CHANGELOG_V17.6.6.md`, `docs/TEST_REPORT_V17.6.6.md`, `docs/REGRESSION_BASELINE_V17.6.6.md`.

### What was new in V17.6.5
* **The Admin Password is central.** One encrypted record in the repository (`sql-assistant-data/security/admin-password.json`, no password in it) is the single authority; every device applies it at start-up, at every synchronization, on *Sync with GitHub Now* and — for a device that has not synchronized yet — at the unlock check. A change or reset on one device reaches all of them; no device can keep a different password after it synchronizes. Fresh installs and V17.6.4 upgrades are supported; the local marker keeps its V17.6.4 format (rollback-safe). See `docs/ADMIN_PASSWORD.md`.
* **Settings → Security → Reset Admin Password to Default** — confirmation dialog, password `admin`, published to the central repository at once, Settings lock again, a warning that the default is insecure. No other setting changes. Forgotten password and no device unlocked: `npm run reset-admin-password` (docs).
* Everything else is unchanged. See `docs/CHANGELOG_V17.6.5.md`, `docs/TEST_REPORT_V17.6.5.md`, `docs/REGRESSION_BASELINE_V17.6.5.md`.

### What was new in V17.6.4
* **Deployment fix, no feature or UI change.** The GitHub Pages workflow builds before its security check, runs each stage as its own named step, installs deterministically and checks that Pages is enabled; TypeScript is pinned to 5.8.3; the repository-access-service workflow is skipped on a push until it is configured. See `docs/CHANGELOG_V17.6.4.md`, `docs/TEST_REPORT_V17.6.4.md`, `docs/REGRESSION_BASELINE_V17.6.4.md`.

### What was new in V17.6.3
* **Reading the private repository needs no token.** A trusted workflow (`publish-data.yml`, built-in `GITHUB_TOKEN` only — no PAT) publishes a hash-checked copy of `sql-assistant-data/` next to the app; Pull Schema, Pull Secret Vault and synchronization read it on any device with no credential, no sign-in and nothing copied. Writing still needs a credential.
* **A device with no token restores the central read-only token automatically** when a central token vault is published (`docs/PUBLISHED_DATA.md` §4); a vault under its own passphrase is restored with *Pull Secret Vault to Repository*.
* **Opt-in:** without `sql-assistant-data/published.json` the app behaves exactly as V17.6.2. Same UI, same three Pull Schema cards in the same order. PAT check now prints GitHub's own message and SSO headers; workflows moved to Node 24 actions.
* See `docs/CHANGELOG_V17.6.3.md`, `docs/PUBLISHED_DATA.md`, `docs/TEST_REPORT_V17.6.3.md`, `docs/SECURITY.md`.

### What was new in V17.6.2
* **Central GitHub PAT.** The token that reads and writes the data repository is stored **once**, as the GitHub Actions repository secret **`SQLA_GITHUB_PAT`**; no device holds it and nobody copies it. A secret like that cannot be read by a browser, so a small trusted **repository access broker** (`server/repo-broker.mjs`, Node ≥ 20, no dependency) uses it — only after the user proved with GitHub's own sign-in that their account may read the repository — and returns file contents, never the PAT.
* **One mechanism for every repository action:** Pull Schema from GitHub, Pull / Push Secret Vault, *Sync with GitHub Now*, knowledge sync, the admin message. *Hamburger → Schema → Pull Schema* shows *Repository access (central)* — *Sign in with GitHub* once per browser session; a new device needs no token.
* **Opt-in:** nothing changes until an administrator follows `docs/CENTRAL_PAT.md` (secret, GitHub App, `deploy-broker.yml`, `SQLA_BROKER_URL`). Without `sql-assistant-data/repo-broker.config.json` the app behaves exactly as V17.6.1. Same UI, same three Pull Schema cards in the same order; only a "Direction: repository → this device." sentence was added to the vault card.
* **Clear errors** for a missing, invalid / expired / revoked, insufficiently privileged or read-only PAT; `verify-repo-pat.yml` warns weekly and 14 days before it expires.
* See `docs/CHANGELOG_V17.6.2.md`, `docs/CENTRAL_PAT.md`, `docs/TEST_REPORT_V17.6.2.md`, `docs/SECURITY.md`, `docs/SOURCE_PROVENANCE.md`.

### What was new in V17.6.1
* **Secret Vault recovery on a device that has no GitHub token.** *Hamburger → Schema → Pull Schema → Pull Secret Vault to Repository → Retrieve from Repository*: after the routes that need no sign-in (a saved token GitHub still accepts; an anonymous read of a public repository), a **private** repository asks for a legitimate authorization — **GitHub sign-in** (OAuth device flow). The card shows a short code and the real `github.com/login/device` address; you approve with your own GitHub account; the page continues by itself, reads **only the encrypted vault**, checks it, decrypts it with the passphrase, asks GitHub whether the restored token works and restores it. The short-lived sign-in is kept in memory for that one read and never stored. **The passphrase decrypts the vault; it never replaces GitHub authentication.**
* **Needs a one-time administrator setup** — a GitHub App (Contents: Read-only, device flow on), the small relay `scripts/github-device-relay.mjs` (no secret) and `sql-assistant-data/vault-bootstrap.config.json`. Without it nothing changes and the card says so honestly; *Import encrypted file* always works. See `docs/DEPLOYMENT.md` → *Vault recovery sign-in*.
* **Safer restore:** the vault file's existence, structure and version are checked before decryption (an HTML login page is recognised); a token GitHub cannot use is not restored; an unconfirmed token never replaces a saved one; the passphrase is asked for first; a wrong passphrase after a sign-in can be corrected without signing in again; every failure leaves the device unchanged. The default passphrase, the vault format, Push, Pull Schema and the UI are unchanged.
* See `docs/CHANGELOG_V17.6.1.md`, `docs/TEST_REPORT_V17.6.1.md`, `docs/SECURITY.md`, `docs/SOURCE_PROVENANCE.md`.

### What was new in V17.5.7
* **Schema → Pull Schema → GitHub repository:** repository, branch and schema file path are hidden, read-only for everybody, and changeable **only by an administrator** (Edit configuration → Admin Password → validated, and checked against GitHub when a token exists). One configuration serves Pull Schema, Sync with GitHub Now, Pull Secret Vault and Push Secret Vault.
* **Pull Schema from GitHub** shows only the **Pull Schema** button (and its result) — no passphrase.
* **Secret Vault across devices:** importing the vault on a new device restores the GitHub token without it ever being shown; GitHub is asked whether the token works (a rejected or empty token never replaces a saved one); Pull Schema and Push work right after. Push asks before replacing a vault it cannot open, refuses colliding vault paths and warns when the built-in default passphrase is used.
* See `docs/CHANGELOG_V17.5.7.md`, `docs/TEST_REPORT_V17.5.7.md`, `docs/SECURITY.md` (limitations — a private repository cannot be read by a brand-new device without the vault file or a token) and `docs/DEPLOYMENT.md` (rollback).

### What was new in V17.5.5
* **Schema → Pull Schema:** the repository configuration (repository, branch, schema file path) is now **hidden by default** behind a *Show configuration / Hide configuration* button and stays **read-only**; **Pull Schema from GitHub** is a single **Pull Schema** button with no passphrase field (same validated, transactional pull; a passphrase-protected file can only be opened with a passphrase already saved on the device, otherwise it is reported); **Pull Secret Vault to Repository** keeps the default Vault Sync Passphrase (masked). A race that left the card on "Retrieving…" after a successful pull was fixed. See `docs/CHANGELOG_V17.5.5.md`.

### What was new in V17.5.4
* **Schema → Pull Schema** now holds the **GitHub repository (schema synchronization)** card (repository `basware/sk-ap-sql-assistant`, branch `main`, schema file `sql-assistant-data/schemas/registry.json` — fixed and read-only; a hidden details message with a Show / Hide button; the access token is set here with the Admin Password) and the **Pull Secret Vault to Repository** card (Vault Sync Passphrase pre-filled and masked; retrieves the encrypted Secret Vault onto this device; the repository is only read).
* **Settings → Secret Vault** keeps only **Push Secret Vault to Repository**. The separate **Push to GitHub** tab and the **Schema passphrase — encrypted synchronization** card were removed. See `docs/CHANGELOG_V17.5.4.md` (including the security note about the pre-filled passphrase).

### What was new in V17.5.3
* **Schema → Push to GitHub** (hamburger menu → Schema → *Push to GitHub*): publish the schemas of this device to the shared repository — validated, encrypted with the **Vault passphrase** (masked, with an eye button), written, **read back and compared**, and only then reported as successful, with the list of schemas that were added / updated / already identical. Other files in the repository are never touched; failures name the cause and the next step and never look like a success. *Pull Schema* is now **Pull Schema from GitHub**. Rotation of the passphrase is explicit. See `docs/PUSH_SCHEMA.md` and `docs/CHANGELOG_V17.5.3.md`.

### What was new in V17.5.2
* **Table tick-marks are painted immediately** — even on the 77-table schema and slower computers (the expensive SQL refresh now runs after the paint).
* **Schema-based CASE / DECODE only from valid definitions.** *From Schema* is offered only when the active schema holds a complete definition; incomplete or invalid ones are explained and never used; distinct aliases for same-named columns; correct types in PostgreSQL / MySQL.
* **Honest cross-device synchronization.** A status block shows what is published and what is *not yet published*; every GitHub request has a time limit; failures name the cause (token rejected, no permission, timeout, incompatible format …) and the next step; conflicts are never overwritten and a partial pull is never shown as success. *Schema → Pull Schema* also shows the 8 steps and the passphrase / connection status. See `docs/CHANGELOG_V17.5.2.md`.

### What was new in V17.5.1
* **Admin message in the navbar.** An administrator publishes one short plain-text message (up to 140 characters, *Information* or *Warning*) under **Settings → Synchronization → Admin message**. Every device shows it as a slim row inside the navbar — it appears when SQL Assistant starts, when the tab becomes active again, at the scheduled synchronization and on **Sync with GitHub Now**. Users can hide it on their own device; a new message appears again; **Clear message on all devices** removes it everywhere. It travels through the same repository connection as the schemas (`sql-assistant-data/messages/admin-message.json`), is shown as plain text only, refuses credential-like text and never affects schema synchronization. See `docs/ADMIN_MESSAGE.md`.

### What was new in V17.5
* **Table tick-marks appear immediately** when you select (or remove) a table under Manual Selectors → Tables — nothing else is reset.
* **Schema-based CASE / DECODE for columns.** Under a selected column choose *Display as → CASE / DECODE* and then **Manual** (your own mapping, as before) or **From Schema** (the definition stored in the active schema, e.g. `1 = Open · 2 = Approved · 3 = Rejected`). No definition in the schema → a clear message and no invented SQL. Works in Manual Selectors, Describe What You Need, learned patterns and the Admin Query Library.
* **Pull Schema** (hamburger menu → Schema → *Pull Schema*): bring a schema published from another device onto this one with a **passphrase** (masked, with a show/hide button). The file is **AES-256-GCM encrypted**, validated before anything is replaced, compared with your local version, applied only when you confirm, and a failed pull never touches your working schema. Administrators set the passphrase under Settings → Schema Management. See `docs/PULL_SCHEMA.md`.

### Run it

| Where | Use |
|---|---|
| Your own computer | Double-click **index.html** (project root) or **dist/index.html**. Each is one self-contained file. |
| GitHub Pages | Push to main. `.github/workflows/deploy-pages.yml` type-checks, lints, tests, builds and publishes `release/`. In the repository set Settings → Pages → Source to **GitHub Actions**. |
| IIS, Azure Static Web Apps, other web servers | Copy the contents of `release/` to the server (`index.html`, `404.html`, `web.config`, `staticwebapp.config.json`, `.nojekyll`). |

### Develop
```
npm install
npm run dev            # development build at http://localhost:5173, rebuilt when files change
npm run verify         # clean → typecheck → lint → security → Node tests → dev build → production build → real-browser tests
npm run security       # static security review of src/ and dist/
npm run serve          # serve release/ like GitHub Pages (BASE=/SQL-Assistant/ PORT=8080)
npm run diagnose -- path/to/registry.json   # check a repository schema file without opening the app
```
The browser tests need `pip install playwright && playwright install chromium`; alternatively set `CHROME_PATH` to an installed Chrome / Chromium.

### Settings and the Admin Password
Settings are locked behind the **Admin Password** (default `admin` — change it under **Settings → Security**, where it can also be reset to the default; since V17.6.5 it is one central password synchronized to every device; they lock again after 5 minutes of inactivity). Tabs: Security · Manual Schema Update · Schema Management · Secret Vault · Synchronization · Admin Query Library · AI/LLM Model · Danger Zone.

### Documents

| File | Contents |
|---|---|
| `docs/ADMIN_PASSWORD.md` | Centralized Admin Password: file format, rules, reset, recovery, limitations (V17.6.5) |
| `docs/CHANGELOG_V17.6.5.md`, `docs/TEST_REPORT_V17.6.5.md`, `docs/REGRESSION_BASELINE_V17.6.5.md` | V17.6.5 changes, test results, protected functionality |
| `docs/CHANGELOG_V17.5.7.md` | Everything that changed in V17.5.7 (files, reasons, security, limitations) |
| `docs/CHANGELOG_V17.5.5.md` | Everything that changed in V17.5.5 (files, reasons, security, limitations) |
| `docs/CHANGELOG_V17.5.4.md` | Everything that changed in V17.5.4 |
| `docs/CHANGELOG_V17.5.3.md` | Everything that changed in V17.5.3 |
| `docs/PUSH_SCHEMA.md` | History: the Push to GitHub tab (removed in V17.5.4) |
| `docs/CHANGELOG_V17.5.2.md` | Everything that changed in V17.5.2 |
| `docs/CHANGELOG_V17.5.1.md` | Everything that changed in V17.5.1 |
| `docs/ADMIN_MESSAGE.md` | Step-by-step guide to the admin message, behaviour table, file format |
| `docs/CHANGELOG_V17.5.md` | Everything that changed in V17.5 |
| `docs/PULL_SCHEMA.md` | Step-by-step guide (administrator and users), messages, file format |
| `docs/REGRESSION_BASELINE_V17.5.4.md`, `docs/REGRESSION_BASELINE_V17.5.3.md`, `docs/REGRESSION_BASELINE_V17.5.2.md`, `docs/REGRESSION_BASELINE_V17.5.1.md`, `…V17.5.md`, `…V17.4.md` | The functionality that was protected, and which test guards each part |
| `docs/TEST_REPORT_V17.5.7.md`, `docs/TEST_REPORT_V17.5.5.md`, `docs/TEST_REPORT_V17.5.4.md`, `docs/TEST_REPORT_V17.5.3.md`, `docs/TEST_REPORT_V17.5.2.md`, `docs/TEST_REPORT_V17.5.1.md`, `docs/TEST_REPORT_V17.5.md` | Test results |
| `docs/SECURITY.md` | Security model; V17.5 passphrase review (V17.4 review unchanged) |
| `docs/DEPLOYMENT.md` | Upgrade and deployment steps |
| `docs/SOURCE_PROVENANCE.md` | Which baseline was used and what could not be accessed |
| `docs/CHANGELOG_V17.4.md`, `docs/CHANGELOG_V17.3.1.md`, `docs/ROOT_CAUSE_V17.3.1.md` | History |

