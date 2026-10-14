## Deployment and upgrade (V17.6.9)

No new feature, no new endpoint, no new storage key. The application files are the same shape as V17.6.8 (`release/` → GitHub Pages / IIS / Azure Static Web Apps).

**Pipeline** (`.github/workflows/deploy-pages.yml`): checkout → setup Node → install (project-pinned TypeScript **5.8.3**, checked) → typecheck → lint → **repository hygiene** (`npm run check:stale`: orphaned / stale files, reported by name) → production build → security scan (source **and every generated output**) → **artifact verification** (`npm run verify:artifact`) → tests → final build → publish → verify the published artifact → **deploy**. The `deploy` job has `needs: build` and runs only when the whole build job (including the tests) succeeded; no step uses `continue-on-error`; a failing run writes a GitHub Actions error annotation and a job summary naming the failing stage.

**Publication artifact** (`release/`): `index.html`, `404.html` (refresh / deep-link fallback), `.nojekyll`, `version.json`, `staticwebapp.config.json` (Azure Static Web Apps: navigation fallback → `/index.html`), `web.config` (IIS: 404 → `/index.html`) and, when the repository variable `SQLA_BROKER_URL` is set, `sql-assistant-data/repo-broker.config.json` (a public address only). The root `index.html`, `dist/index.html`, `release/index.html` and `release/404.html` are byte-identical (one build). The page is self-contained (inline script with a matching CSP hash, no module / external script / external stylesheet, no absolute `/…` asset path), so it works under any base path. The publishing-zone repository `basware/dh-zone` (`bw-publish-zone`) could **not** be read from the build environment; nothing in this release claims details of that target. The release is a static, relative, self-contained folder; whether `bw-publish-zone` accepts that structure has to be confirmed against the zone's own documentation by the person who owns it.

### Repository access service deployment (`deploy-broker.yml`) — required configuration
| Key | Kind | Where | Purpose |
|---|---|---|---|
| `AZURE_CREDENTIALS` | **secret** | repository secret, or a secret of the environment `central-repository-access` | service-principal JSON for `azure/login`. **Required**: without it no Azure deployment can happen and none is attempted. |
| `SQLA_GITHUB_PAT` | secret | Actions secrets | the central PAT (one repository, Contents: Read and write) |
| `SQLA_SESSION_SECRET` | secret | Actions secrets | ≥ 32 random characters |
| `SQLA_BROKER_APP_NAME` | variable | Actions variables | Azure App Service name |
| `SQLA_GITHUB_CLIENT_ID` | variable | Actions variables | public client ID of the GitHub App (device flow) |
| `SQLA_ALLOWED_ORIGINS` | variable | Actions variables | origin that serves SQL Assistant |

The preflight step reports **every** missing key at once, by name only, e.g. `Deployment blocked: AZURE_CREDENTIALS is not configured.` (stage, component, retry rule and where to configure it are in the annotation) and stops the job before any Azure step. Azure authentication is never bypassed and no secret value is printed. This must be configured in the target repository / environment before a real Azure broker deployment can succeed.

### PAT verification failure (HTTP 403)
`verify-repo-pat.yml` / `scripts/verify-pat.mjs` report `Repository credential verification failed with HTTP 403. Review the enterprise authorization and Conditional Access diagnostic.` plus GitHub's own message, safe upstream identifiers (error code, trace / correlation id when supplied) and the *possible* causes, explicitly marked as not verified. A 403 is never a successful verification and the authorization is never weakened. If an organization policy (for example Conditional Access) keeps blocking the token, an administrator has to change the policy or authorization — see `docs/PUBLISHED_DATA.md` → "Troubleshooting a 403". Reading and publishing the data folder does **not** need this PAT (`publish-data.yml`, built-in `GITHUB_TOKEN`).

### Upgrading from V17.6.8
Replace the application files (or deploy `release/`). Browser storage, the Secret Vault, repository configuration and the central Admin Password record are unchanged and compatible. **Then remove the leftovers of earlier versions from the repository** (copying a package over a repository never deletes them):
```
node scripts/check-stale.mjs                 # lists them by name (CI runs this and fails while any exist)
node scripts/prune-orphans.mjs --delete      # the unreferenced src/ files
node scripts/prune-stale.mjs --delete        # the reviewed list in scripts/stale-files.json
git add -A && git commit -m "Remove stale files of earlier versions"
```
Rollback to V17.6.8: see `docs/ROLLBACK_V17.6.9.md`.

## Deployment and upgrade (V17.6.5)

* **Upgrade V17.6.4 → V17.6.5:** deploy the new `release/` exactly as before (`deploy-pages.yml` is unchanged). No repository setting, secret, variable, workflow or configuration file changes.
* **Admin Password after the upgrade:** the first device that has a custom password and a repository connection publishes it (`sql-assistant-data/security/admin-password.json`, revision 1, encrypted marker only); every other device applies it at its next synchronization or at its next unlock attempt. With *Publish SQL Assistant data* enabled, devices that read the published copy see the file after the next publication; devices **without a write credential** cannot publish a change (they say so and keep it pending) — change the password on a device that can write (token, or central access service).
* **Check after deployment (about 5 minutes):** Device 1 → Settings → Security → *Central synchronization* shows *synchronized (revision N)*; the repository contains `sql-assistant-data/security/admin-password.json` with no readable password; on Device 2 the same password unlocks Settings. Do **not** test the reset on production unless intended — it resets the password on every device.
* **Forgotten password:** `npm run reset-admin-password` in a clone, commit, push (see `docs/ADMIN_PASSWORD.md`).
* **Rollback to V17.6.4:** redeploy the V17.6.4 package; nothing to undo. The local marker keeps its V17.6.4 format and the last synchronized password; the new file is ignored.

---

## Deployment and upgrade (V17.6.3)

* **Upgrading from V17.6.2:** replace the app — nothing to export, migrate or re-enter; no storage key, file format or encryption parameter changed. **Until a publication marker exists the app behaves exactly as V17.6.2.**
* **Turn on published reads:** follow `PUBLISHED_DATA.md` §3 — commit V17.6.3, confirm with the zone owners how `dist/` is served and republished, run **Actions → Publish SQL Assistant data**, check `<site>/sql-assistant-data/published.json`.
* **`npm run build` keeps `dist/sql-assistant-data/**`** (the published copy and any administrator-placed configuration file) — it is not build output. Commit `dist/` after a build as before.
* **Rollback:** delete `dist/sql-assistant-data/published.json` (or publish V17.6.2). Devices stop using the published copy at once and keep all local data.
* **Optional:** `publish-data.yml` can also publish the central token vault (`PUBLISHED_DATA.md` §4). The V17.6.2 broker (`CENTRAL_PAT.md`) remains available for authenticated writes.

## Deployment and upgrade (V17.6.2)

* **Upgrading from V17.6.1:** replace the app — nothing to export, migrate or re-enter. No storage key, file format or encryption parameter changed. **Until an administrator deploys central repository access the app behaves exactly as V17.6.1** (token on the device, the optional V17.6.1 sign-in recovery).
* **Turning on central repository access:** follow `CENTRAL_PAT.md` — create the fine-grained PAT, store it as the repository secret **`SQLA_GITHUB_PAT`**, create / reuse the GitHub App (device flow), set the variables, run *Deploy the repository access service*, then *Build, test and deploy … to GitHub Pages* (publishes `sql-assistant-data/repo-broker.config.json` from the variable `SQLA_BROKER_URL`), then run *Verify the central GitHub PAT*. The broker needs a Node ≥ 20 host (GitHub Pages cannot run it).
* **Rollback:** publish `SQL-Assistant-V17.6.1.zip` again, or simply delete `sql-assistant-data/repo-broker.config.json` — the app then stops using central access at once (devices keep their local data; sessions in `sessionStorage` are ignored).
* **Devices:** nothing to do. A device signs in with GitHub when a repository action needs it; it never holds the PAT.
* **`npm run build` empties `release/`**; the Pages workflow writes the configuration file after the build. If you deploy `release/` by hand, place `repo-broker.config.json` (`docs/repo-broker.config.example.json`) in `release/sql-assistant-data/` yourself. On Azure Static Web Apps make sure `/sql-assistant-data/*` is not rewritten to `index.html` (an HTML answer is detected and means "not central").

## Deployment and upgrade (V17.6.1)

* **Upgrading from V17.5.7:** replace the app — nothing to export, migrate or re-enter. No file format, encryption parameter, setting or storage key changed. Schemas, the Secret Vault, saved tokens, the Admin Password and the administrator's repository configuration are read as they are. Until an administrator enables *GitHub sign-in* (below) *Retrieve from Repository* behaves as in V17.5.7, with clearer messages and the stricter token checks.
* **Rollback:** keep `SQL-Assistant-V17.5.7.zip` (delivered unchanged as `SQL-Assistant-V17.5.7-rollback.zip`) and publish / open it again. V17.6.1 adds **no** storage key and rewrites nothing, so there is nothing to undo; the optional files you deployed under `sql-assistant-data/` are simply ignored by V17.5.7.

### Vault recovery sign-in — restoring the Secret Vault on a device that has no token (V17.6.1)

**Why a sign-in is needed.** The GitHub token is inside the encrypted vault; the vault is in a **private** repository; the vault passphrase decrypts the file but is **not** a credential for GitHub. A device with no token therefore cannot read the vault until it is authorized. V17.6.1 uses the OAuth **device authorization flow**: the user opens `github.com/login/device`, types the code the application shows, and signs in as themselves — GitHub's own access control decides whether that user may read the repository. The resulting short-lived token is kept in memory for one read of the vault file and then dropped.

#### What you set up (once)
1. **GitHub App** (owned by the organization): *Settings → Developer settings → GitHub Apps → New*.
   * Permissions: **Repository → Contents: Read-only** (nothing else). Webhook: off.
   * *Identifying and authorizing users*: tick **Enable Device Flow**; keep *Expire user authorization tokens* on.
   * *Where can this app be installed?* only your organization; then **install it on `basware/sk-ap-sql-assistant` only**.
   * Copy the **Client ID** (public). **Do not create or deploy a client secret** — the device flow needs none and nothing in SQL Assistant uses one.
   * A GitHub App user token can do what the app **and** the signed-in user may both do: the user must be able to read the repository, and the app must be installed on it. If your organization enforces SAML SSO the user needs an active SSO session; the card reports "the account cannot read the repository" if GitHub answers 404.
2. **The relay** — `scripts/github-device-relay.mjs` (Node ≥ 20, no dependencies):
   ```
   ALLOWED_CLIENT_IDS=<client id>  ALLOWED_ORIGINS=https://tools.example.org  PORT=8787  node scripts/github-device-relay.mjs      # or: npm run relay
   ```
   Put it behind **HTTPS** (reverse proxy, App Service / Container Apps, tunnel). It forwards exactly `POST /device/code` and `POST /device/token` to github.com, answers only the allow-listed client ID(s) for the allow-listed page origin(s), has a body limit, a rate limit (`RATE_LIMIT_PER_MINUTE`, default 120), drops refresh tokens, holds **no secret** and **prints nothing about any exchange**. You may re-implement the same contract as a serverless function (`POST /device/code {client_id}` → GitHub `/login/device/code`; `POST /device/token {client_id, device_code}` → GitHub `/login/oauth/access_token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`; JSON in / JSON out; CORS only for your page origin).
   **Trust:** the relay **sees the short-lived sign-in token** in the `/device/token` response. Run it yourself, over HTTPS, without request/response logging; never use a relay operated by someone else.
3. **The configuration file** `sql-assistant-data/vault-bootstrap.config.json` next to `index.html` (copy `docs/vault-bootstrap.config.example.json`):
   ```json
   { "githubSignIn": { "enabled": true, "clientId": "Iv1.…", "relayUrl": "https://sql-assistant-relay.example.org" } }
   ```
   Public values only (client ID, relay address). It works at the domain root and under any sub-path (it is looked up next to the page; query and hash are ignored). `relayUrl` must be `https` (`http` only for `localhost`). An invalid file is **reported to the user**, not silently ignored; no file (or `"enabled": false`) means the feature is off. `release/` ships **no** such file — and `npm run build` empties `release/`, so place it again after each build. On Azure Static Web Apps make sure `/sql-assistant-data/*` is not rewritten to `index.html` (a missing file is detected either way); `web.config` already declares the `.json` MIME type.
   The application's content-security policy already allows `https:` requests (and `'self'` since V17.6.1); nothing else is needed.

#### What the user sees (Hamburger → Schema → Pull Schema → Pull Secret Vault to Repository)
Passphrase (pre-filled with the default, editable) → **Retrieve from Repository** → the card tries what needs no sign-in (saved token if GitHub accepts it; anonymous read) → if the repository answers like a private one: *"Authorize on GitHub — open github.com/login/device, enter the code …"* with **Cancel** → the user approves in the other tab → the page continues by itself: reads the vault, checks it, decrypts it, asks GitHub whether the restored token works, restores it, and says so. Pull Schema and Push work immediately. **Import encrypted file** (download the vault under your own GitHub sign-in) is unchanged and needs no setup.

#### Which route gets a new device its token
| Situation | Route | Needs |
|---|---|---|
| Device already has a working token | *Retrieve from Repository* (authenticated read) | passphrase |
| Public repository | *Retrieve from Repository* (anonymous read) | passphrase |
| **Private repository, no token** | *Retrieve from Repository* → **GitHub sign-in** (this release) | passphrase + a GitHub sign-in + the one-time setup above |
| Private repository, no setup | *Import encrypted file* (vault file downloaded where you are signed in) | passphrase + that sign-in |
| Saved token expired / revoked | *Retrieve from Repository* notes it and continues with the other routes | passphrase (+ sign-in if private) |

#### Before you rely on it — acceptance check on your real systems (about 10 minutes)
1. Device A: *Set Token* (Admin Password) → *Settings → Secret Vault* → push with **your own** passphrase. Confirm the repository file contains only the encrypted envelope.
2. Another computer or a new browser profile (no token): open the application → *Hamburger → Schema → Pull Schema* → type the passphrase → *Retrieve from Repository*. The card shows a code; open the shown github.com page, enter it, approve with an account that may read the repository.
3. The card says *Secret Vault imported and validated*; *Pull Schema* succeeds; the GitHub Access Token section shows the masked token.
4. Repeat with a wrong passphrase (message, nothing changes, **no second sign-in** when you correct it) and with an account that has no access (message names the repository access, nothing changes).
5. In the browser developer tools (Network, Console) confirm that no passphrase, token or device code appears in any URL or console message, and that the only requests are to your relay, `api.github.com` and your own host.

## Deployment and upgrade (V17.5.7)

* **Upgrading from V17.5.5 (or a V17.5.6 build):** replace the app — nothing to export, migrate or re-enter. Schemas, the Secret Vault, saved tokens, the Admin Password and every other setting are read as they are. Every device keeps using the default repository until an administrator changes it (Schema → Pull Schema → *Show configuration* → *Edit configuration (administrator)*).
* **Rollback:** keep `SQL-Assistant-V17.5.5.zip` (unchanged, delivered alongside as `SQL-Assistant-V17.5.5-rollback.zip`) and publish / open it again. V17.5.7 adds **one** storage key (`sqla.repoconfig.v1756`, the administrator's repository override), which V17.5.5 ignores — nothing else was migrated or rewritten, so nothing has to be undone. To drop the override on V17.5.7 use *Restore application defaults* or clear the site's stored data.
* **A new device without a token:** Schema → Pull Schema → *Pull Secret Vault to Repository* → *Import encrypted file* with the Vault Sync Passphrase (the default is pre-filled; use the one you pushed with). See `PULL_SCHEMA.md` (V17.5.7) and `SECURITY.md`.
* **Moving a device to another repository:** an administrator edits the configuration on that device (validated against GitHub with the saved token before saving).

### Earlier upgrades (V17.5.5 and before)

* **Build:** `npm install && npm run verify` produces `dist/index.html`, the root `index.html` and `release/`. To build without the tests use `npm run build`.
* **Publish** one of: **GitHub Pages** (push to `main`; the workflow publishes `release/`) · **IIS / Azure Static Web Apps / other** (copy the contents of `release/`) · **a single shared file** (`dist/index.html`).
* **Upgrading from V17.5.4:** replace the app — nothing to export, migrate or re-enter. The repository configuration is now hidden until *Show configuration* is used (still fixed and read-only); *Pull Schema from GitHub* is a single *Pull Schema* button. A device pulls a plain schema file without any passphrase; a passphrase-protected file can only be pulled by a device that already has a Vault passphrase saved. Publish schemas for such devices with *Sync with GitHub Now* from a device that has no passphrase saved.
* **Upgrading from V17.5.3:** replace the app — nothing to export, migrate or re-enter. The GitHub repository card and *Pull Secret Vault to Repository* moved to **Schema → Pull Schema**; the repository is now fixed (`basware/sk-ap-sql-assistant`, `main`, `sql-assistant-data/schemas/registry.json`) — an older stored repository is kept as data but ignored. Each device needs only the access token (Schema → Pull Schema → *Set Token*, Admin Password) or can retrieve it with *Pull Secret Vault to Repository*. *Push to GitHub* and the *Schema passphrase* card no longer exist.
* **Upgrading from V17.5.2:** replace the app — nothing to export, migrate or re-enter (no format, key, path or setting changed). The Schema page gains a *Push to GitHub* tab. To use it, a device needs a repository connection with a token that has **Contents: Read and write** (Settings → Secret Vault); devices that only pull need **Read**. Every publication (also *Sync with GitHub Now* and the Settings action) is now confirmed by reading the file back.
* **Upgrading from V17.5.1:** replace the app — nothing to export, migrate or re-enter (no format, key or setting changed). Schemas, the Secret Vault, the schema passphrase, learned queries, the Admin Query Library and the admin message are read as they are. The Pull Schema page and Schema Management now show the synchronization status; a schema you edited stays *not yet published* until you press *Sync with GitHub Now*.
* **Upgrading from V17.5.1:** replace the app — nothing to export, migrate or re-enter (no format, key or setting changed). Schemas, the Secret Vault, the schema passphrase, learned queries, the Admin Query Library and the admin message are read as they are. The Pull Schema page and Schema Management now show the synchronization status; a schema you edited stays *not yet published* until you press *Sync with GitHub Now*.
* **Upgrading from V17.5:** replace the app — nothing to export, migrate or re-enter. The admin message is off until an administrator publishes one (Settings → Synchronization → Admin message); devices that have not been upgraded ignore the new file `sql-assistant-data/messages/admin-message.json`.
* **Upgrading from V17.4:** replace the app — nothing to export, migrate or re-enter. Schemas, learned queries, the Admin Query Library, the Secret Vault, GitHub settings, the Admin Password and all other settings are read as they are. Synchronization stays **plain** (exactly as in V17.4) until an administrator sets a schema passphrase.
* **Protect the synchronized schema with a passphrase (optional, recommended):** see `PULL_SCHEMA.md`. Administrator: Settings → Schema Management → Schema passphrase → *Save passphrase and publish encrypted schema*. Everyone else: hamburger menu → Schema → *Pull Schema*. Afterwards remove the old plain `…/schemas/registry.json` from the repository by hand.
* **Upgrading from V17.3.1:** replace the app; nothing needs to be exported or re-entered. On first start V17.4 migrates the learned queries automatically (Settings → Synchronization → *Data migrations*). Schemas, the Secret Vault, GitHub settings, the Admin Password and all other settings are read as they are. The V17.3.1 learned-query data is **kept** next to the new store, so going back to V17.3.1 is possible.
* **Each device, first run:** Settings → Secret Vault: check owner/repository, branch and schema file path (`sql-assistant-data/schemas/registry.json`). Then Settings → Schema Management → *Sync with GitHub Now*.
* **Share learned queries and the Admin Query Library:** Settings → Synchronization → *Sync knowledge now* (also in the Admin Query Library tab). The data is one file, `sql-assistant-data/knowledge/knowledge.json`, in the same repository. Records are merged per item; a deletion on one device reaches the others on their next sync.
* **A new device without the vault:** Settings → Secret Vault → enter the repository and a token that can read it, enter the *Vault Sync Passphrase* and press *Retrieve from Repository* (or *Import encrypted file*).
* **Local model (optional):** run Ollama / LM Studio / llama.cpp with its OpenAI-compatible server, then Settings → AI/LLM Model → provider *Local model*, enter the model name, *Test connection*, *Enable*, *Save*. Everything keeps working offline if the model is not running.
* **Replace every older copy of the app** — V17.0 and earlier publish schemas without validation.

SharePoint and OneDrive usually *download* `.html` files instead of displaying them; use them to distribute the file, not to host it.


## V17.7 — production build vs. browser-test build
* `npm run build` produces the deployable artifacts (`dist/index.html`, `index.html`, `release/**`). They contain **no** browser-test hook; `npm run verify:artifact` fails if one appears.
* `npm run build:test` produces `test-dist/index.html` for the Chromium suites only (`src/testHooks.ts`, `?e2e=1`). **Never deploy `test-dist/`.** It is not part of `release/`, and the workflows do not build it.
* The Admin Password flow needs no Node.js / npm on any device (see `docs/ADMIN_PASSWORD.md`, "No NPM at runtime"); the Pages / IIS / Static Web Apps / publishing-zone host only serves static files.
