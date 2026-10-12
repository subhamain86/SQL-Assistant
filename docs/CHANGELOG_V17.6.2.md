### SQL Assistant 17.6.2 — what changed

**Goal.** Make the repository workflows consistent and secure with **one centrally managed GitHub PAT** (a GitHub Actions repository secret) that no device ever holds or copies, while keeping the V17.6.1 UI and every working feature.

#### Baseline (stated, not assumed)
* **`SQL-Assistant-V17.6.1.zip`** — the package attached to the request; it is the actual source baseline and the last-known-good UI. It was extracted, type-checked, built and tested **unchanged first** (132 tests, 9 browser suites green) and only the files listed below were changed.
* The SharePoint folders named in the request could not be browsed from here; no other version was read.

#### What was already true in V17.6.1 (verified, not re-done)
Items 1–4 and 7 of the request were already delivered by V17.5.4–V17.6.1 and were **verified** against the source and in a real browser rather than rebuilt:
* **Schema → Pull Schema** has exactly three cards in this order: *GitHub repository (schema synchronization)* · *Pull Schema from GitHub* · *Pull Secret Vault to Repository*. The repository card (`basware/sk-ap-sql-assistant` · `main` · `sql-assistant-data/schemas/registry.json`) is hidden/read-only by default and editable only after the **existing** Admin Password check (enforced in `saveRepositoryConfig()`, validated before saving, previous value kept on any failure; no new password, no credential in the front end).
* *Pull Schema from GitHub* holds one button and its status area — no passphrase field — and is independent of the vault.
* The *Schema passphrase — encrypted synchronization* card is gone from Settings → Schema Management; Settings → Secret Vault keeps *Push Secret Vault to Repository* and has **no** copy of the repository configuration (it links to the card on the Pull Schema page).
* **Direction of *Pull Secret Vault to Repository*: it reads the repository and imports onto this device** (verified in code and by test: it never writes). *Push Secret Vault to Repository* (Settings) is the only action that writes. The label was kept exactly as specified; V17.6.2 only adds the words **"Direction: repository → this device."** to the card so the label can no longer be misread. Nothing was reversed or duplicated.
* The default passphrase `xG71lfp1NHZVZ4WVWCPe` is defined once (`repositoryDefaults.ts`), pre-fills the masked, editable field, is used only for the vault's encryption/decryption, is never a GitHub credential and is never logged.

#### What is new — the central PAT (requirements 5, 6 and section 4)
**The constraint that shapes the design.** A GitHub Actions repository secret cannot be read by browser code, by GitHub Pages or through any GitHub API. So the PAT can only be used in a *trusted execution environment*. V17.6.2 adds one:

| New piece | Purpose |
|---|---|
| **GitHub Actions secret `SQLA_GITHUB_PAT`** | the single copy of the PAT (fine-grained, one repository, *Contents: Read and write*) |
| **`server/repo-broker.mjs`** — the *repository access broker* (Node ≥ 20, no dependency) | holds the PAT (environment variable fed from the secret); after a caller proved through GitHub's device flow that their GitHub account may read the repository, it reads/writes **one JSON file at a time below `sql-assistant-data/`** and returns only the file text + sha / a sha / a status. **It has no endpoint that returns the PAT.** Allow-lists for repositories and paths, size limit, refusal of bodies containing a token/key, rate limit, audit lines, no body logging. |
| **`.github/workflows/deploy-broker.yml`** | the trusted workflow that consumes the secret: refuses to run without it, verifies it, delivers it to the service as an application setting (Azure App Service reference implementation; any Node host works), health-checks |
| **`.github/workflows/verify-repo-pat.yml`** + `scripts/verify-pat.mjs` | weekly / on-demand check in Actions: missing · rejected (invalid / expired / revoked) · insufficient · read-only · expiring |
| **`src/v17/services/repoBroker.ts`** | browser client: configuration file, broker session (sessionStorage, not a GitHub token), `brokerRepository()` (a drop-in `SchemaRepository`), location check, PAT status, sign-in |
| **`src/ui/repoAccess.ts`** | `ensureRepositoryAccess()` — *is authorization available? reuse the session; otherwise start the supported sign-in* — one implementation used everywhere |
| **`sql-assistant-data/repo-broker.config.json`** | public file next to `index.html` holding the broker's address; written by `deploy-pages.yml` from the repository variable `SQLA_BROKER_URL`. **Without it V17.6.2 behaves exactly like V17.6.1.** |

**One mechanism for every repository operation.** `repository()` in `context.ts` is the only place that decides how the repository is reached: with central access it returns a broker-backed repository (and **`null` when there is no sign-in — never a silent fall-back to another credential**); without it, the V17.6.1 token behaviour is unchanged. Pull Schema from GitHub, Pull Secret Vault, Push Secret Vault, *Sync with GitHub Now* and the advanced schema actions, knowledge sync, the admin message, the Admin Query Library sync and the live check of the repository card all go through it, and each calls `ensureRepositoryAccess()` first.

**Cross-device without copying a token.** A new device / clean profile: *Pull Schema* (or *Retrieve from Repository*, or *Sign in with GitHub*) → the card shows a code and the real github.com address → the user approves → the page continues by itself. The sign-in is run by the broker (the browser never sees a GitHub token or the device code) and yields a short-lived broker session (8 h, HMAC-signed, bound to the repository, kept in sessionStorage). A valid session is reused; nothing is asked twice.

**Secret Vault with central access.** *Retrieve from Repository* reads the vault through the broker, validates it (structure / version before decryption, then authenticated decryption, then the decrypted content) and restores the AI key; the GitHub token inside a vault is **not restored** (not needed — and not wanted — on a device). *Push Secret Vault to Repository* is written by the broker and **no GitHub token is put into the vault** any more (central mode only); the read-back verification is unchanged. Without central access both behave as in V17.6.1.

**Clear errors** for: PAT missing · invalid/expired/revoked · insufficient (no Contents permission, repository not granted, SSO) · read-only · repository invisible · rate limit · no sign-in · account without access · account without write permission · service unreachable. Each leaves local data untouched and contains no secret.

#### Files
| File | Change |
|---|---|
| `server/repo-broker.mjs` | **new** |
| `scripts/verify-pat.mjs` | **new** |
| `.github/workflows/deploy-broker.yml`, `verify-repo-pat.yml` | **new** |
| `.github/workflows/deploy-pages.yml` | + one step: publishes the **public** broker address (variable `SQLA_BROKER_URL`) |
| `src/v17/services/repoBroker.ts`, `src/ui/repoAccess.ts` | **new** |
| `src/ui/context.ts` | `repository()` is broker-aware; broker configuration / session helpers |
| `src/ui/pages/schemaRepoCards.ts` | token row ⇒ *Repository access* (sign in / check central PAT / sign out) when central; live check through the broker; vault card reads through the broker and does not restore the token; "Direction: repository → this device" |
| `src/ui/pages/schemaPull.ts` | authorization step before the pull; messages for the new failure kinds |
| `src/ui/pages/settings.ts`, `adminMessagePanel.ts`, `adminLibrary.ts` | authorization step before every repository action; push in central mode |
| `src/v17/services/secretVault.ts` | optional `central` / `skipToken` parameters (defaults = V17.6.1 behaviour). **Cryptography, envelope and defaults untouched.** |
| `src/v17/services/vaultRetrieval.ts` | override route labelled `repository-broker`; new failure kinds / messages |
| `src/v17/services/githubClient.ts`, `src/v17/sync/syncService.ts` | four new error kinds |
| `src/v17/services/bootstrapAuth.ts` | `deployedFileUrl()` extracted (same lookup rule, `bootstrapConfigUrl()` unchanged) |
| `src/main.ts` | reads the configuration at start-up; e2e hooks |
| `src/ui/pages/other.ts`, `schemaFormat.ts`, `nluEngine.ts`, `package.json` | version 17.6.2, About entry |
| `test/v1762.test.mjs`, `test/support/github-stub.mjs`, `scripts/browser_test_v1762.py`, `scripts/compare_v1762.py` | new tests (see `TEST_REPORT_V17.6.2.md`) |
| older tests | version expectations only |
| docs | this file, `CENTRAL_PAT.md`, `TEST_REPORT_V17.6.2.md`, `REGRESSION_BASELINE_V17.6.2.md`, `SECURITY.md`, `DEPLOYMENT.md`, `PULL_SCHEMA.md`, `SOURCE_PROVENANCE.md`, `README.md`, `repo-broker.config.example.json` |

**Not changed:** the vault envelope / key derivation, the default passphrase, the repository configuration and its administrator-only editing, Pull Schema's validated transactional pull, schema synchronization, SQL generation, selectors, the hamburger menu, `public/styles.css` (byte-identical), the V17.6.1 relay and device-flow code (kept for deployments that do not enable central access).

#### Requirement conflicts and what could NOT be done (stated, not hidden)
* **"Use the GitHub Actions secret" vs "do not read it from the browser".** Resolved as the request itself prescribes: a trusted workflow + backend mediate. This **requires a host for the broker** (GitHub Pages cannot run it). Nothing works centrally until an administrator creates the secret, the GitHub App, deploys the broker and sets `SQLA_BROKER_URL` (`docs/CENTRAL_PAT.md`). Until then the app behaves as V17.6.1.
* **Not tested against github.com or a real Azure host.** This environment has no network access to either. The broker was run **for real** (separate process, real HTTP/CORS) against `test/support/github-stub.mjs`, a local model of a private repository, a fine-grained PAT, the device flow and the contents API. **Run the 5-minute check in `CENTRAL_PAT.md` against your real GitHub before relying on it.** In particular unverified against the real thing: GitHub-App user-token behaviour with SAML SSO, the `github-authentication-token-expiration` header format, the Azure steps of `deploy-broker.yml` (YAML validated, steps not executed).
* **"Verify no passphrase / PAT / admin password in compiled assets".** Verified for the PAT, user tokens, device code and sign-in client ID. The built-in default passphrase **is** in the bundle — it is required to be pre-filled — and is therefore not a secret (as documented since V17.5.4).
* **The Admin Password is still a client-side control** (documented since V17.5.7): it protects the repository card against ordinary use, not against someone with developer tools. V17.6.2 adds the server-side counterpart that matters for the PAT: the broker only ever uses it for the allow-listed repository and folder, whatever the page asks.
* **Repository settings changed by an administrator** must name a repository in the broker's `SQLA_ALLOWED_REPOSITORIES`; otherwise the broker refuses (with a message naming the setting).

#### Known limitations
* A signed-in user's session lasts 8 hours (configurable); after that one more sign-in is needed.
* Anyone who can read the repository can read the (encrypted) vault. Use your own vault passphrase.
* A read-only GitHub account can pull but not publish; the broker decides from GitHub's own answer and fails closed.
* The PAT is the single point of failure for central access: if it expires every device's pull fails until an administrator replaces the secret (the weekly workflow warns 14 days ahead).
