# Release notes — V17.7.4

V17.7.4 makes Usage Analytics deployable without a server or cloud credentials. Analytics data is encrypted on the device and can be read only in the Analytics dashboard after administrator authentication. SQL Assistant continues to capture usage metadata only and does not capture SQL content, credentials, database results, or customer data.

## What users notice
Nothing changes for ordinary users. Analytics stays off unless an administrator enables it; when it is on with the serverless provider, usage metadata is encrypted on the device before it is written to the repository. The About page lists this release.

## What administrators notice
* **No analytics server, no cloud credentials:** set the repository variable `SQLA_ANALYTICS_PROVIDER = repository`, re-run the Pages workflow, then *Analytics → Set up* (choose a long password; it cannot be recovered).
* **Analytics → Unlock** asks for that password; the dashboard is decrypted and computed in the browser; *Change password*, *Rotate keys*, *Publish public key* and *Compact now* are in the page's administrator panel.
* **Build and test with Node only** (`tools/typescript`, `scripts/tsc.mjs`); the Pages workflow needs only `GITHUB_TOKEN`; `deploy-broker.yml` and `deploy-analytics.yml` are marked optional.
* **Limits to read before relying on it:** `docs/ANALYTICS_SERVERLESS.md` §7 (offline password guessing against a readable key file, visible commit metadata, only devices with write access report, no server-side lock-out).
* Not verified here: a real GitHub repository, real Pages deployment and Actions runs (`docs/VERIFICATION_REPORT_V17.7.4.md`).
