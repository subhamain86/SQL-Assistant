## Deployment and upgrade (V17.6.5)

* **Upgrading from V17.6.4:** replace the app (`SQL-Assistant-V17.6.5.zip`) — nothing to migrate or re-enter. No existing storage key, file format or encryption parameter changes (the device's own Admin Password marker `sqla.pwvault.v15` is never touched). **Until a central record exists the app behaves exactly as V17.6.4** (local password, default `admin`). New browser-storage keys: `sqla.credrec.v1765` (cached central record), `sqla.credmeta.v1765`, `sqla.pwlock.v1765` (lock-out counter). None holds a password.
* **Zone platform:** keep the build compatible with the platform — `dist/**` is republished on a push to `main`. **Do not rely on GitHub Pages.** `npm run build` keeps `dist/sql-assistant-data/**` (the published copy is not build output). Commit `dist/` after a build as before.
* **First use:** open **Settings → Security**, enter the current password, choose a new one (at least 10 characters) and select **Save (all devices)**. The first Save creates `sql-assistant-data/security/admin-credential.json` (through the repository access service or a device token); the **publish-data.yml** workflow (`.github/workflows/publish-data.yml`) then publishes it next to the app so devices with no token can verify. It runs on every push that touches `sql-assistant-data/**` (including `security/**`) and its last step fails, by name, if the record is not published. If the site is not republished by a push event, set the variable `SQLA_SITE_PUBLISH_WORKFLOW` (see the workflow header).
* **Branch protection:** Save and Reset write directly to `main`. If direct pushes are forbidden the write fails and the app names the step; let the repository access service's PAT (or the GitHub App) bypass the rule for `sql-assistant-data/security/**`, or do not require pull requests for that path.
* **Recommended once:** branch protection on `main` and a `CODEOWNERS` rule `sql-assistant-data/security/** @<owners-team>` (see `SECURITY.md`).
* **Repository access service (V17.6.2 broker):** redeploy `server/repo-broker.mjs` (the workflow *Deploy the repository access service* does it on a push to `server/**` once `SQLA_BROKER_APP_NAME` exists). Without the new broker everything still works, but the server-side check of the credential record is missing. Nothing else changes (no new setting, secret or variable).
* **Rollback — either:**
  1. **publish V17.6.4 again** (`SQL-Assistant-V17.6.4-rollback.zip`): it ignores the central record; every device then uses its own local password (V17.6.4 behaviour); **or**
  2. **delete `sql-assistant-data/security/*`** from the repository (the next publication removes the published copy): every device that reads a fresh copy or the publication drops the central record and uses its local password again. Devices that cannot reach any source keep their cached record until they can.
  A device that never had a local password falls back to the default `admin` in both cases — set a local one first if that matters (Settings → Security → Change Password while no central record exists).
* **Forgotten password:** Settings → Security → **Reset to default**, leave the password empty and sign in to GitHub with an account that has **write** access (or use the current password). Then unlock with `admin` and Save a new password at once.

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
