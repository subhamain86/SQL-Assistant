# Rollback — V17.7.5 → V17.7.4

1. Deploy `SQL-Assistant-V17.7.4-rollback.zip` in place of V17.7.5 (`release/`). **It is a rebuild of V17.7.4, not the original zip** — see `RECONSTRUCTED.txt` inside it: rebuilt from the V17.7.4 text bundles you supplied, with the favicon, three compiler files (restored only at their recorded SHA-256), and the two browser suites re-created. Use the original V17.7.4 zip instead if you still hold it.
2. The rollback package contains the V17.7.4 workflows, including `deploy-analytics.yml` and `deploy-broker.yml` (Azure). They need `AZURE_CREDENTIALS` and the variables named in their headers; without them they stop at their preflight and name what is missing. Restoring them restores the automatic delivery of `SQLA_GITHUB_PAT` to an Azure-hosted broker.
3. Nothing in the application's stored data or repository files changed in V17.7.5; there is nothing to migrate back.
4. The known V17.7.4 defect (`test/v1763.test.mjs` fails in a checkout without `node_modules`) is present in the rollback package.
