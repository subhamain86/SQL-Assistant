# Release notes — SQL Assistant 17.6.9

**What users notice**
* `admin` no longer opens Settings on a new or different device while a central Admin Password exists, nor while the central state cannot be determined. After Sync the central password works.
* A new standalone device without a repository connection keeps Settings locked and says what to do (Sync button / sign in to GitHub). Everything else looks and behaves as in 17.6.8.

**What administrators notice**
* The CI build now fails early and by name on leftovers of earlier versions (`npm run check:stale`). Remove them once: `node scripts/prune-orphans.mjs --delete && node scripts/prune-stale.mjs --delete`, then commit.
* Missing deployment configuration blocks the broker deployment with `Deployment blocked: <KEY> is not configured.`; `AZURE_CREDENTIALS` is documented as a required secret.
* An HTTP 403 from the PAT check is reported as a failed verification with the upstream diagnostic; an organization policy (Conditional Access) must be changed by an administrator.
* Published-copy-only deployments need one explicit reset record before the first administrator can use `admin` (`docs/ADMIN_PASSWORD.md`).

**Not verified here (needs your environment)** — a real GitHub Actions run, a real GitHub Pages / `bw-publish-zone` publication, a real Azure deployment, a real GitHub / central-access sign-in. See `docs/VERIFICATION_REPORT_V17.6.9.md`.
