# Release notes — V17.7.5

V17.7.5 removes npm and Azure dependencies from the GitHub workflows. SQL Assistant now builds, tests, verifies and deploys with Node and the default GitHub token only. Optional services are packaged by credential-free workflows and run on any host. SQL Assistant behaviour, automatic token synchronization, security controls and usage-analytics privacy are unchanged.

## What changed
* **Workflows:** `deploy-pages.yml` calls `node` directly (the stages of `node scripts/ci.mjs`), verifies the committed compiler instead of installing anything, and has a new **Workflow guard** stage. No package manager, no package download, no cloud login, no secret.
* **Guard:** `scripts/check-workflows.mjs` + `scripts/workflow-policy.mjs` (the one documented allow-list).
* **Optional services** are packaged by `package-analytics-service.yml` and `package-repo-broker.yml` (artifact only; README, Dockerfile, systemd unit, `env.example`; the packaged copy is started once as a self test). They run on any host with Node ≥ 20.
* **Removed:** `deploy-analytics.yml` and `deploy-broker.yml` (they deployed to Azure).
* **Fixed:** `test/v1763` no longer copies a non-existent `node_modules` (it failed in a registry-free checkout).

## Token synchronization — not changed
The in-app token / Secret Vault / central-access / central-configuration synchronization, `publish-data.yml`, `verify-repo-pat.yml`, `scripts/publish-data.mjs`, `build-central-vault.mjs`, `verify-pat.mjs`, `github-device-relay.mjs` and `server/repo-broker.mjs` are byte-identical to V17.7.4 (only the `APP_VERSION` stamp differs). The workflows `publish-data.yml` and `verify-repo-pat.yml` still read their own secrets (`SQLA_DEVICE_TOKEN`, `SQLA_VAULT_PASSPHRASE`, `SQLA_GITHUB_PAT`); they are optional and not required for building or deploying.

## Broker token delivery — the one token-delivery behaviour that changed
The automatic delivery of the central PAT (`SQLA_GITHUB_PAT`) and the session secret to an **Azure-hosted** broker by the former `deploy-broker.yml` **no longer exists**; it required Azure credentials. The operator now sets `SQLA_GITHUB_PAT`, `SQLA_SESSION_SECRET`, `SQLA_GITHUB_CLIENT_ID` and `SQLA_ALLOWED_ORIGINS` as environment variables on their own host (names and meanings unchanged). An existing broker keeps working. See `docs/CENTRAL_PAT.md`.

## Upgrade and rollback
Replace the deployed `release/` folder; repository variables for Pages are unchanged. Remove any use of the retired workflows' variables (`SQLA_BROKER_APP_NAME`, `SQLA_ANALYTICS_APP_NAME`) and secret `AZURE_CREDENTIALS` if you no longer host on Azure. Rollback: `docs/ROLLBACK_V17.7.5.md`.

## Not verified here
GitHub Actions runs (the workflows were parsed, statically checked and their run steps executed locally), a real Pages deployment, a real GitHub repository (`docs/VERIFICATION_REPORT_V17.7.5.md`).
