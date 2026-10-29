# SQL Assistant V17.7.1 — change log

V17.7.1 is an **incremental, backward-compatible** upgrade of V17.7.0. The V17.7 package was the only implementation baseline (reconstructed, type-checked, built and tested unchanged first); the V17.7 UI is the visual baseline.

## 1. GitHub connection is initialised when SQL Assistant opens
* New `src/ui/githubState.ts` — the ONE shared GitHub connection state. `boot()` calls `startGithubConnection()` (not awaited, after the secrets are loaded). It validates what already exists with **read-only requests**: a saved token (GitHub repository lookup), the central sign-in (access-service status) or the published copy. It **never** writes, publishes, pulls or merges by itself, **never** starts the GitHub device sign-in by itself and **never** blocks or fails start-up; every problem is a state with a message and an action (`not-configured`, `signin-required`, `connected`, `published`, `rejected`, `no-access`, `unreachable`, `error`).
* No second token store: the token stays in the Secret Vault (`secrets` in `context.ts`). The state keeps only a one-way 32-bit fingerprint to notice a change. `context.ts` gained one notification door (`onSecretsChanged`) fired by `reloadSecrets()` / `refreshRepositoryConfig()`, so a saved or replaced token / changed repository re-checks by itself; unrelated reloads cause no request.
* One check at a time (concurrent callers share it), a fresh answer is reused for 5 minutes, *Check connection* forces a new one, and a check whose inputs changed while it ran is repeated (found by test: a token saved while the start-up check was running used to leave a stale "not set up").
* A token is never shown, logged, stored in the state or placed in a message (`redactSecrets` on every network message; tested, also in the browser).

## 2. GitHub repository on the Home page and in the hamburger menu
* **Home**: a compact "GitHub repository" panel (existing panel / chip / hint / button styles — **no CSS change**): status, repository, write access, synchronization line, last successful synchronization, result of the last pull, actions *Pull Schema*, *Sign in to GitHub* (central access only), *Check connection*, *GitHub repository settings*.
* **Hamburger menu → GitHub Repository** (route `github`): the status plus the **same** repository card, *Pull Schema from GitHub* and *Pull Secret Vault* cards, by rendering the existing `renderSchemaPullTab`. **Schema → Pull Schema is unchanged**; both places share one configuration, one token and one state.
* `schemaPull.ts`: `pullSummary()` and `pullSchemaFromHome()` (same sequence as the tab: repository authorization first, then `SyncService.pullSchema()` — validated and transactional).

## 3. Query Library (hamburger menu, top level)
* **Add New Query** (`queryLibrary.ts`): form → *Check query* → *Review & submit* → **Pending approval**. A submission is **not** a library entry (own store `sqla.querysubs.v1771`, own repository file `…/knowledge/submissions.json`) and is never read by the NLU / retrieval / trusted-example logic.
* **View Query Library**: approved **and** enabled queries in the administrator list presentation, **read-only** (search, filters, details, copy SQL). No edit / approve / reject / delete / enable / import / export control exists in the code that renders it.
* **Administrator**: Settings → Admin Query Library → *Query submissions awaiting review* (`adminSubmissions.ts`). Approval creates an ordinary library entry through the **existing** `AdminQueryLibrary.upsert()` + `approve()` (validated against the Active Schema, SELECT / WITH only).
* **Authorization**: `passwordService.ts` gained a one-time **action ticket** (`verifyPassword(…, 'admin-action')` → `takeActionTicket()`; single use, 30 s; same construction as the Settings unlock ticket). `QuerySubmissions.approve()` / `.reject()` refuse without it. See `docs/QUERY_LIBRARY.md`.
* `scripts/publish-data.mjs` does not publish `knowledge/submissions.json` to the site.

## 4. Version
`package.json`, `APP_VERSION`, writer label, NLU label, About, README and release metadata: `17.7.1`; the navbar badge now shows `V17.7.1` (it showed the first two components, `V17.7`). Historical references (V17.7 documents, fixtures, the V17.7 sections) are kept.

## 5. Deliberately NOT changed
Style sheet, favicon, Settings, the repository / token / vault cards (`schemaRepoCards.ts`), the builders, every engine, Admin Password service logic, GitHub client, broker, secret vault, knowledge sync, schema sync. Six UI modules changed (`test/fixtures/ui-baseline-v177.json`); everything else is byte-identical to V17.7.0 (tested).
