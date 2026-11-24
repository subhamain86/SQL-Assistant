# Workflow dependencies — inventory and replacement (V17.7.5)

Taken from the V17.7.4 package **before** any V17.7.5 change (`grep` over `.github/workflows`, `package.json`, `scripts/`, `server/`, `docs/`). "Token sync" = the workflow or file implements the **automatic token synchronization**, which V17.7.5 does not change (`test/fixtures/token-sync-baseline-v1774.json`).

## 1. Workflows, step by step

### deploy-pages.yml — token sync: **no**
| Step | npm / Azure reference | Secrets / variables | V17.7.5 |
|---|---|---|---|
| `actions/checkout@v5`, `actions/setup-node@v5` (node 24, no cache) | — | — | unchanged (first-party actions, major-version pins) |
| Toolchain versions (`node --version`) | — | — | unchanged |
| **Install** | `if [ -f tools/typescript/bin/tsc ]; then … elif [ -f package-lock.json ]; then npm ci …; else npm install …; fi` then `npm run check:toolchain` | — | **verification only**: `node scripts/check-toolchain.mjs --committed-only` — every file of `tools/typescript/` against `CHECKSUMS.json`; fails naming the file; **no fallback** |
| Typecheck | `npm run typecheck` | — | `node scripts/tsc.mjs -p tsconfig.json --noEmit` |
| Lint | `npm run lint` | — | `node scripts/lint.mjs` |
| Repository hygiene | `npm run check:stale` | — | `node scripts/check-stale.mjs` |
| *(new)* Workflow guard | — | — | `node scripts/check-workflows.mjs` |
| Build | `npm run build` | — | `node scripts/build.mjs` |
| Security check | `npm run security` | — | `node scripts/security_check.mjs` |
| Verify the generated artifact | `npm run verify:artifact` | — | `node scripts/verify-artifact.mjs` |
| Tests | `npm test` (= build + node --test) | — | `node --test --test-concurrency=1 test/*.test.mjs` (the build output of the Build step is used) |
| Final production build | `npm run build` | — | `node scripts/build.mjs` |
| Publish the repository-access configuration | — | `vars.SQLA_BROKER_URL` (a public address) | unchanged |
| Publish the analytics configuration (service / serverless) | — | `vars.SQLA_ANALYTICS_*` (public settings) | unchanged |
| Verify the artifact that will be published | `npm run verify:artifact` | — | `node scripts/verify-artifact.mjs` |
| `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`, Pages check (`gh api`) | — | `github.token` | unchanged |
| Explain the failure | — | `toJSON(steps)` | unchanged (+ the new stage name) |

### deploy-analytics.yml — token sync: **no** (the usage-analytics service)
| Step | Reference | Secrets / variables | V17.7.5 |
|---|---|---|---|
| Preflight | Azure | `secrets.AZURE_CREDENTIALS`, `secrets.SQLA_ANALYTICS_ADMIN_PASSWORD_HASH`, `vars.SQLA_ANALYTICS_APP_NAME`, `vars.SQLA_ANALYTICS_ALLOWED_ORIGINS` | removed |
| Start-up self test | — | the hash secret | now runs on **synthetic** settings, no secret |
| `azure/login@v2` | Azure | `AZURE_CREDENTIALS` | **removed** |
| `azure/appservice-settings@v1` | Azure | password hash + origins as app settings | **removed** |
| Package (one file) | — | — | kept, as an **artifact** |
| `azure/webapps-deploy@v3` | Azure | — | **removed** |
| Health check | `*.azurewebsites.net` | — | **removed** (the self test starts the packaged copy locally) |
| **Replacement** | `package-analytics-service.yml` | **none** (`GITHUB_TOKEN`, `contents: read`) | builds, runs the service tests, packages, starts the packaged copy, uploads an **artifact**; deploys nothing |

### deploy-broker.yml — token sync: **partly** (the repository access broker that holds the central PAT)
| Step | Reference | Secrets / variables | V17.7.5 |
|---|---|---|---|
| Preflight | Azure | `AZURE_CREDENTIALS`, `SQLA_GITHUB_PAT`, `SQLA_SESSION_SECRET`, `vars.SQLA_GITHUB_CLIENT_ID`, `vars.SQLA_ALLOWED_ORIGINS`, `vars.SQLA_BROKER_APP_NAME` | removed |
| Start-up self test | — | public settings | runs on synthetic settings |
| `azure/login@v2`, `azure/appservice-settings@v1`, `azure/webapps-deploy@v3`, health check | Azure | **`SQLA_GITHUB_PAT`, `SQLA_SESSION_SECRET`, client id, origins, allowed repositories delivered as Azure app settings** | **removed** — see "Token delivery" below |
| **Replacement** | `package-repo-broker.yml` | **none** | same credential-free packaging as the analytics service |

### publish-data.yml — token sync: **yes (frozen)**
No npm, no Azure, no registry (the word "registry" in its first comment is the SQL Assistant *schema registry*). Secrets: `SQLA_DEVICE_TOKEN`, `SQLA_VAULT_PASSPHRASE` (central token vault, only when requested) and `vars.SQLA_ALLOW_DEFAULT_VAULT_PASSPHRASE`, `vars.SQLA_SITE_PUBLISH_WORKFLOW`. Permissions `contents: write, actions: write`; triggers `push` to `sql-assistant-data/**` (not `analytics/**`) and `workflow_dispatch`. **Byte-identical to V17.7.4.** Optional; not required for building or deploying SQL Assistant.

### verify-repo-pat.yml — token sync: **yes (frozen)**
No npm, no Azure. Secret `SQLA_GITHUB_PAT`. Schedule `17 5 * * 1` and `workflow_dispatch`; `permissions: { contents: read }`. **Byte-identical to V17.7.4.** Optional.

## 2. Token delivery — what changed and what did not (plain words)
* **Not changed:** the in-app token / vault / central-access / central-configuration synchronization; `publish-data.yml` (central token vault); `verify-repo-pat.yml` (PAT check); `scripts/publish-data.mjs`, `build-central-vault.mjs`, `verify-pat.mjs`, `github-device-relay.mjs`; `server/repo-broker.mjs` and its environment contract (`SQLA_GITHUB_PAT`, `SQLA_SESSION_SECRET`, `SQLA_GITHUB_CLIENT_ID`, `SQLA_ALLOWED_ORIGINS`, `SQLA_ALLOWED_REPOSITORIES`, `SQLA_ALLOWED_PATH_PREFIXES`, `SQLA_SESSION_TTL_MINUTES`, `SQLA_RATE_LIMIT_PER_MINUTE`, `SQLA_AUDIT_LOG`, `PORT`). An existing broker deployment keeps working.
* **Changed — the only token-delivery behaviour that changed:** the automatic delivery of the central PAT (`SQLA_GITHUB_PAT`) and the session secret from GitHub Actions secrets to an **Azure-hosted** broker, by `deploy-broker.yml`, **no longer exists**. It could only work with Azure credentials (`AZURE_CREDENTIALS`), which the project no longer assumes. The operator now sets `SQLA_GITHUB_PAT` (and the other variables) as **environment variables on their own host**; `package-repo-broker.yml` produces the one-file service plus run instructions (systemd, container, any Node ≥ 20 host). No replacement host was invented.

## 3. Everything else that mentions npm / Azure / a registry, and why it stays
| Where | What | Why it stays |
|---|---|---|
| `package.json` scripts (`npm run …`) | local convenience | no workflow depends on them; `node scripts/ci.mjs` is the workflow-equivalent |
| `scripts/security_check.mjs` message "run npm run build first", `verify-artifact.mjs` / `check-stale.mjs` / `dev.mjs` / `serve.mjs` / `diagnose.mjs` comments | wording of a hint | not a dependency; `test/v1764.test.mjs` pins the security-check message |
| `scripts/build.mjs`, `verify-artifact.mjs`, `release/staticwebapp.config.json` | a static hosting file for Azure Static Web Apps in the release folder | a static file, no Azure call; removing it would change the release artifact (not requested; pinned by tests) |
| `scripts/security_check.mjs` `.openai.azure.com` | allowed host of the optional AI/LLM feature in the application | an application feature, not a workflow dependency |
| `scripts/github-device-relay.mjs` comment | "Azure App Service / Container Apps …" as hosting examples | comment only; token-synchronization file, frozen |
| `scripts/build-central-vault.mjs` | the word "registry" (schema registry path) | not a package registry; frozen |
| `scripts/toolchain.mjs`, `verify-no-npm.mjs` | the words "npm installation" in comments / the node_modules look-up | the look-up of an optional local installation; no registry address; tested |
| `server/analytics-service.mjs` | two comments named Azure App Service | **comment-only edit in V17.7.5** (so the packaged artifact holds no Azure reference); behaviour unchanged |
| `server/repo-broker.mjs` | comment that names `deploy-broker.yml` | frozen token-synchronization file; the comment is historical (see section 2) |
| `tools/typescript/` | the vendored compiler | no registry: committed, SHA-256 verified |
| Earlier `docs/*V17.*` | history | earlier release documents are kept |

## 4. Edits to files in the frozen list
| File | Edit | Why it cannot affect behaviour |
|---|---|---|
| `src/v17/sync/schemaFormat.ts` | `APP_VERSION` 17.7.4 → 17.7.5 | the application version stamp; no logic touched (pinned by normalized hash) |
| every other file of the token-sync baseline | **none** | byte-identical (test) |

## 5. Edits to earlier test files (listed in the V17.7.5 instructions as "run unchanged")

Every edit is an exact string replacement recorded in `test/fixtures/test-adaptations-v1775.json` (old text, new text, reason, V17.7.4 baseline hash); `test/v1775.test.mjs` proves that undoing the listed replacements restores the V17.7.4 file byte for byte, so **nothing else in those files changed**. Test files `v1761`, `v1765`, `v1766`, `v1767`, `v1771`, `v1772` were not edited at all and are pinned by hash.

| Test file | Why the edit was unavoidable |
|---|---|
| `test/v1762.test.mjs` | the assertion pinned a retired workflow or behaviour (the Azure delivery of the central PAT, the npm Install fallback); replaced by the V17.7.5 equivalent of the same intent — the broker workflow no longer delivers the PAT; it reads no secret |
| `test/v1762.test.mjs` | the workflow file was renamed (deploy-broker.yml -> package-repo-broker.yml) |
| `test/v1762.test.mjs` | the assertion pinned a retired workflow or behaviour (the Azure delivery of the central PAT, the npm Install fallback); replaced by the V17.7.5 equivalent of the same intent |
| `test/v1763.test.mjs` | the workflow file was renamed (deploy-broker.yml -> package-repo-broker.yml); same two assertions (no Node-20 action versions, node-version 24) |
| `test/v1763.test.mjs` | V17.7.4 DEFECT: the copy symlinked node_modules, which a registry-free checkout does not have, so the copied build found no compiler outside an environment with a global NODE_PATH; the copy now carries the committed, checksum-pinned compiler (tools/) instead |
| `test/v1764.test.mjs` | the assertion pinned a retired workflow or behaviour (the Azure delivery of the central PAT, the npm Install fallback); replaced by the V17.7.5 equivalent of the same intent (the Install step is verification only, no package manager) |
| `test/v1764.test.mjs` | the assertion pinned a retired workflow or behaviour (the Azure delivery of the central PAT, the npm Install fallback); replaced by the V17.7.5 equivalent of the same intent (the broker packaging workflow runs on its own files and by hand; there is nothing configured that could be missing) |
| `test/v1764.test.mjs` | the assertion pinned a retired workflow or behaviour (the Azure delivery of the central PAT, the npm Install fallback); replaced by the V17.7.5 equivalent of the same intent |
| `test/v1768.test.mjs` | the workflow file was renamed (deploy-broker.yml -> package-repo-broker.yml); the existence check is otherwise unchanged |
| `test/v1769.test.mjs` | the assertion pinned a retired workflow or behaviour (the Azure delivery of the central PAT, the npm Install fallback); replaced by the V17.7.5 equivalent of the same intent (the same three stages are called as direct node commands) |
| `test/v1769.test.mjs` | the assertion pinned a retired workflow or behaviour (the Azure delivery of the central PAT, the npm Install fallback); replaced by the V17.7.5 equivalent of the same intent — this test executed the retired Azure preflight script; it is replaced by the packaging equivalent |
| `test/v1773.test.mjs` | title of a test about the retired deployment workflow: the service now has a credential-free packaging workflow (no secret, nothing deployed) |
| `test/v1773.test.mjs` | the assertion pinned a retired workflow or behaviour (the Azure delivery of the central PAT, the npm Install fallback); replaced by the V17.7.5 equivalent of the same intent |
| `test/v1774.test.mjs` | the version test became a documented historical test (the current-version assertions live in test/v1775.test.mjs), as in every earlier release |
| `test/v1774.test.mjs` | same: README heading and section names of the historical release |
| `test/v1774.test.mjs` | the assertion pinned a retired workflow or behaviour (the Azure delivery of the central PAT, the npm Install fallback); replaced by the V17.7.5 equivalent of the same intent |
| `test/v1774.test.mjs` | the assertion pinned a retired workflow or behaviour (the Azure delivery of the central PAT, the npm Install fallback); replaced by the V17.7.5 equivalent of the same intent (the retired Azure workflows are replaced by packaging workflows that deploy nothing) |

**Why this cannot be avoided without changing the requirement:** each edited assertion pins either text of the Pages workflow that V17.7.5 is required to remove (`npm ci` / `npm run …`), the file name or the Azure steps of `deploy-broker.yml` / `deploy-analytics.yml` that V17.7.5 is required to replace, or — in `v1763` — a `node_modules` symlink that a registry-free checkout cannot satisfy (**a defect of V17.7.4**: the test only passed where a global `NODE_PATH` existed). None of the edits touches a token-synchronization *assertion about the application*: they concern the retired delivery workflow and the Pages workflow's wiring. The token-synchronization **files** are pinned separately and are byte-identical.
