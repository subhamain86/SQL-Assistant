### SQL Assistant 17.6.3 — what changed

**Goal.** Make private-repository access work end to end with the **least new infrastructure**, deliver the requested Schema → Pull Schema layout, and give a device with no token a way to obtain repository access **without anyone typing or copying a token** — while the central PAT that returned HTTP 403 stops being a prerequisite for reading.

#### Baseline (stated, not assumed)
* **`SQL-Assistant-V17.6.2.zip`** — attached; the actual source baseline and (per your links) the last-known-good UI. Extracted, type-checked, built and tested **unchanged first** (155 Node tests green) before any change. The V17.6.1 ZIP was not attached to this session, so the UI comparison is against V17.6.2 (which is itself 14/16 pages byte-identical to V17.6.1). The SharePoint folders cannot be browsed from the build environment.

#### Already satisfied by the V17.6.2 baseline (verified again, not rebuilt)
Schema → Pull Schema has exactly three cards in the requested order (*GitHub repository (schema synchronization)* · *Pull Schema from GitHub* · *Pull Secret Vault to Repository*); the repository (`basware/sk-ap-sql-assistant`, `main`, `sql-assistant-data/schemas/registry.json`) is hidden, read-only and editable only after the existing Admin Password check (validated before saving, previous value kept on failure); Pull Schema is one button with no passphrase; Card 3 keeps its label, its real direction (**repository → this device, read-only**), the pre-filled masked editable default passphrase `xG71lfp1NHZVZ4WVWCPe` (defined once; never GitHub authentication; never logged); the *Schema passphrase — encrypted synchronization* card is gone from Settings → Schema Management; Settings → Secret Vault has no repository card and keeps *Push Secret Vault to Repository*. All of this is asserted again by `test/v1763.test.mjs` and `scripts/browser_test_v1763.py`.

#### Design decision (section 4 of the request) — see `docs/PUBLISHED_DATA.md` §1
| | Chosen | Why |
|---|---|---|
| **B — publish from Actions, no extra host** | **for reads** | A workflow using only the built-in `GITHUB_TOKEN` mirrors `sql-assistant-data/**` into the folder the site is served from; devices read it same-origin with **no credential**. No PAT, no approval, no SSO, no sign-in, no new host. |
| A — V17.6.2 broker | kept, optional | needs a Node host that does not exist; still the strongest option for *writes* |
| C — GitHub App installation tokens | documented only | tokens live 1 hour, so they cannot sit in a static vault; worth it only if org policy forbids PATs and device writes are needed |

**Consequence you must know:** a browser cannot **write** to a private repository without a credential. Reading is now token-free; writing (publish schemas, *Push Secret Vault*) still needs a token on the device, the broker, or a Git clone.

#### What is new
| Area | Change |
|---|---|
| **Published copy** | `scripts/publish-data.mjs` + `.github/workflows/publish-data.yml` (GITHUB_TOKEN only): mirrors `sql-assistant-data/**.json`, writes the marker `sql-assistant-data/published.json` **last** with SHA-256 per file. Never publishes `*.config.json`, dot-files, symlinks, non-JSON, > 8 MB; **fails the run if a file contains a token or private key**; removes files that left the repository; leaves foreign files alone; idempotent (no commit churn). `npm run build` now **preserves** `dist/sql-assistant-data/**`. |
| **Browser side** | `src/v17/services/publishedData.ts`: strict marker parser; a file is accepted only if the site's bytes hash to the marker's value (a half-finished / stale / tampered publication is refused); the SPA fallback page is "not published"; 401/403 → "sign in to the site"; **read-only**. `repository()` order: test repository → central broker → **token on the device** → **published copy** → none. Without a marker nothing changes. |
| **Token auto-population (Card 1)** | A device with no token reads the published central vault, opens it with the built-in default passphrase and restores the token through the existing validated import (stored encrypted, shown masked). A vault under its own passphrase is **not guessed**: the card tells the user to use Card 3. One attempt per page load; every failure leaves the device unchanged. |
| **Card 3** | *Retrieve from Repository* reads the published copy when the device has no token (and falls back to it when a saved token is unusable), with its own source line; validation, direction, passphrase behaviour unchanged. |
| **Settings → Secret Vault** | an explanatory *Published copy* sentence; *Push* on a device with no token stops before encrypting and says why. Existing controls unchanged. |
| **Central token vault** | `scripts/build-central-vault.mjs` (run on request by the workflow): checks the token with GitHub, **refuses a token that can write**, refuses the public default passphrase unless explicitly allowed, writes the **same envelope** the app writes/reads, prints no secret. |
| **PAT diagnostics** | `scripts/verify-pat.mjs` prints GitHub's own message and the `X-GitHub-SSO` / accepted-permission headers (never the token) and names the Enterprise causes (approval pending, policy, SSO, IP allow list, wrong resource owner). |
| **Workflows** | all four moved to `actions/checkout@v5`, `actions/setup-node@v5`, Node 24 (the Node 20 deprecation warning). |

#### Files
| File | Change |
|---|---|
| `src/v17/services/publishedData.ts` | **new** |
| `scripts/publish-data.mjs`, `scripts/build-central-vault.mjs`, `.github/workflows/publish-data.yml` | **new** |
| `src/ui/context.ts` | `publishedState`, `refreshPublished()`, `publishedEnabled()`, `publishedRepo()`; `repository()` order |
| `src/ui/pages/schemaRepoCards.ts` | published hint + auto-populate (Card 1), published route (Card 3) |
| `src/ui/pages/schemaPull.ts`, `settings.ts` | messages for the published route; push stops with the real reason |
| `src/v17/services/vaultRetrieval.ts` | `repository-published` route label; the reason is carried in `notes` |
| `src/main.ts` | reads the marker at start-up; e2e hooks |
| `scripts/build.mjs` | preserves `dist/sql-assistant-data/**` |
| `scripts/verify-pat.mjs` | diagnostics |
| `.github/workflows/{deploy-broker,verify-repo-pat,deploy-pages}.yml` | Node 24 actions |
| `src/ui/pages/other.ts`, `schemaFormat.ts`, `nluEngine.ts`, `package.json` | version 17.6.3, About entry |
| `test/v1763.test.mjs`, `scripts/browser_test_v1763.py`, `scripts/compare_v1763.py` | new tests (see `TEST_REPORT_V17.6.3.md`) |
| older tests | version expectations only |
| docs | this file, `PUBLISHED_DATA.md`, `TEST_REPORT_V17.6.3.md`, `REGRESSION_BASELINE_V17.6.3.md`, `SECURITY.md`, `DEPLOYMENT.md`, `PULL_SCHEMA.md`, `SOURCE_PROVENANCE.md`, `README.md` |

**Not changed:** the vault envelope / key derivation, the default passphrase, the repository configuration and its administrator-only editing, Pull Schema's validated transactional pull, schema synchronization, SQL generation, selectors, the hamburger menu, `public/styles.css` (byte-identical), the V17.6.2 broker and its tests.

#### What could NOT be done (stated, not hidden)
* **Real GitHub / the real site were not reachable.** The scripts run as real processes and the page runs in real Chromium against real static servers, but GitHub's REST API is emulated (`test/support/github-stub.mjs`) and **no GitHub Actions run was executed**; the workflows are validated YAML plus source tests. Run the checks in `PUBLISHED_DATA.md` §3 on your real systems.
* **Not verified, needs the zone owners:** that the site serves `dist/` as its root; how it is republished (a `GITHUB_TOKEN` commit does not trigger `push` workflows — use `SQLA_SITE_PUBLISH_WORKFLOW` with a `workflow_dispatch` trigger); whether the site requires a sign-in; whether `main` is protected against the workflow's push.
* **The 403 itself was not diagnosed** — your `curl` output was not available. Option B makes it irrelevant for reading; for the optional central token (or the broker) use the troubleshooting table.
* **The central token needs a PAT too** and is subject to the same approval; it is optional.
* **Default passphrase** (required to stay pre-filled) is public, so a central vault built with it is only as private as the site and repository — documented, and the workflow refuses it unless explicitly allowed.
* The published registry is **plain schema metadata** readable by everyone who can load the site.

#### Known limitations
* A publication lags the repository by the workflow run plus the site republication (about a minute or two). A device with a token reads the repository directly and does not lag.
* Rebuilding the central vault replaces the vault file (and any AI key pushed from a device).
* The published copy duplicates the data folder inside `dist/`.
