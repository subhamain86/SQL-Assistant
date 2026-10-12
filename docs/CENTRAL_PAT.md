> **V17.6.3 note.** This guide (the PAT-holding broker) is now **optional**. Reading the private repository needs no PAT any more: see `PUBLISHED_DATA.md`. Use the broker only if devices must **write** without holding a token. The 403 troubleshooting table is in `PUBLISHED_DATA.md` §7.

## Central GitHub PAT — setup guide (V17.6.2)

**What this gives you.** The GitHub token that reads and writes `basware/sk-ap-sql-assistant` is stored **once**, as a GitHub Actions repository secret. No device holds it, nobody copies it, and the browser never sees it. Users sign in with their own GitHub account (once per browser session); SQL Assistant then reads and writes the repository through a small trusted service that holds the PAT.

### Why a service is unavoidable (read this first)
A GitHub Actions repository secret is write-only: GitHub injects it into **workflow runs** and nothing else. It cannot be read by a browser, by GitHub Pages, or through any GitHub API. So the PAT can only ever be *used* in a trusted execution environment. V17.6.2 therefore consists of

| Piece | Where it runs | What it does |
|---|---|---|
| GitHub Actions secret **`SQLA_GITHUB_PAT`** | GitHub | the one copy of the PAT |
| `.github/workflows/deploy-broker.yml` | GitHub Actions (the only place that can read the secret) | verifies the PAT, then hands it to the service as an *application setting* |
| **Repository access broker** `server/repo-broker.mjs` | your host (Node ≥ 20, no dependencies) | holds the PAT in memory; reads / writes repository files for signed-in users; returns file text or a result — **never the PAT** |
| `.github/workflows/verify-repo-pat.yml` | GitHub Actions (weekly) | tells you when the secret is missing, rejected, read-only or about to expire |
| `sql-assistant-data/repo-broker.config.json` | next to `index.html` (public) | tells the page where the broker is; written by `deploy-pages.yml` from the repository **variable** `SQLA_BROKER_URL` |

GitHub Pages alone cannot host the broker (it serves static files). Use any Node host: Azure App Service (the workflow is written for it), Container Apps, a VM, …

### 1 · Create the PAT
GitHub → your avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token** (create it with a **service / machine account** that is a member of the organization, not a person who may leave).

| Setting | Value |
|---|---|
| Resource owner | `basware` |
| Repository access | **Only select repositories → `sk-ap-sql-assistant`** |
| Repository permissions | **Contents: Read and write** (Metadata: Read-only is added automatically). **Nothing else** — in particular not *Workflows*, *Administration* or *Actions* |
| Expiration | the shortest your process allows (maximum 1 year) — put the date in your calendar |
| Organization policy | if the organization requires approval for fine-grained tokens, an owner must approve it; if it enforces SAML SSO, authorize the token for the organization |

### 2 · Store it as the repository secret
GitHub → **`basware/sk-ap-sql-assistant` → Settings → Secrets and variables → Actions → New repository secret**

| Name (exact) | Value |
|---|---|
| **`SQLA_GITHUB_PAT`** | the token from step 1 |
| `SQLA_SESSION_SECRET` | 32+ random characters (`openssl rand -base64 48`) — signs broker sessions; without it sessions end whenever the service restarts |
| `AZURE_CREDENTIALS` | only for the Azure steps of `deploy-broker.yml` |

and under **Variables**:

| Name | Value |
|---|---|
| `SQLA_GITHUB_CLIENT_ID` | the **public** client ID of the GitHub App used for sign-in (step 3) |
| `SQLA_ALLOWED_ORIGINS` | the origin that serves SQL Assistant, e.g. `https://basware.github.io` (no path) |
| `SQLA_BROKER_APP_NAME` | Azure App Service name (Azure steps only) |
| `SQLA_BROKER_URL` | the public https address of the broker, e.g. `https://sql-assistant-broker.azurewebsites.net` — **this** is what `deploy-pages.yml` publishes as `repo-broker.config.json` |

Optional: put the secrets in an **Environment** named `central-repository-access` (the workflow uses it) and require reviewers — then the secret is only released to approved deployments.

### 3 · GitHub App for sign-in (re-use the V17.6.1 one if you created it)
*Settings → Developer settings → GitHub Apps → New*: permission **Repository → Contents: Read-only**, webhook off, tick **Enable Device Flow**, install it **only on `basware/sk-ap-sql-assistant`**. Copy the **Client ID** (public). **No client secret is created or used.** The sign-in only proves that the user's own GitHub account may read the repository; the service then discards the user's token (it is used for two requests — `GET /user` and `GET /repos/{owner}/{repo}` — and never stored or returned).

### 4 · Deploy
1. Run **Actions → Deploy the repository access service** (or push to `main`). It refuses to run without the secret and variables, verifies the PAT, sets the application settings, deploys, and health-checks `/healthz` (which reveals only *whether* a PAT is configured).
2. Run **Actions → Build, test and deploy SQL Assistant to GitHub Pages** (the `SQLA_BROKER_URL` variable makes it publish `sql-assistant-data/repo-broker.config.json`).
3. On another host: run `node server/repo-broker.mjs` with the environment variables listed in the header of that file (`SQLA_GITHUB_PAT`, `SQLA_GITHUB_CLIENT_ID`, `SQLA_ALLOWED_ORIGINS`, `SQLA_ALLOWED_REPOSITORIES`, `SQLA_SESSION_SECRET`, `PORT`) behind HTTPS, and place `repo-broker.config.json` next to `index.html` yourself (`docs/repo-broker.config.example.json`).

### 5 · Check it (about 5 minutes)
1. **Actions → Verify the central GitHub PAT → Run workflow** — green, with the expiry date.
2. Open SQL Assistant → **Hamburger → Schema → Pull Schema** → *Sign in with GitHub* (or *Pull Schema*): the card shows a code; approve it on github.com; the card says *Signed in as …*.
3. *Check central access* → *The central PAT is configured and GitHub accepts it for this repository.*
4. *Pull Schema* → *Schema pulled and validated successfully.* · *Settings → Secret Vault → Push Secret Vault to Repository* (needs an account with write access) → *pushed to the repository (ciphertext only)*.
5. A second computer / clean browser profile: *Pull Schema* → sign in → it works with **no token typed or copied**.

### What users see when the central PAT is wrong
| Problem | Message (Pull Schema / Retrieve / Push / Check) | Who acts |
|---|---|---|
| Secret missing / not delivered to the service | *The central repository access is not set up: the access service has no GitHub PAT…* | administrator: set `SQLA_GITHUB_PAT`, run *Deploy the repository access service* |
| PAT invalid, **expired** or revoked (GitHub answers 401) | *GitHub rejected the central PAT: it is invalid, expired or revoked…* | administrator: new PAT → replace the secret → redeploy |
| PAT lacks the Contents permission, repository not granted, SSO not authorized (403 / 404) | *The central PAT is not allowed to read / use the configured repository…* | administrator: fix the PAT or the repository card |
| PAT is read-only | pulls work; publishing fails with *…not allowed to do this… needs Contents: Read and write*; *Check central access* says so | administrator |
| PAT expires within 14 days | *Check central access* warns; the weekly workflow warns | administrator |
| User has no sign-in / it expired | *Repository access needs a GitHub sign-in…* and the sign-in starts | user |
| User's GitHub account cannot read the repository | *…cannot read the configured repository…* (no session is created) | repository owner |
| User's account is read-only and they push | *Your GitHub account has read-only access…* | repository owner |
| Service unreachable | *The repository access service could not be reached…* | administrator |

In every case the existing local schema, vault and settings are left exactly as they were.

### Rotating the PAT
Create the new PAT → replace the secret `SQLA_GITHUB_PAT` → run *Deploy the repository access service* → *Verify the central GitHub PAT* → revoke the old PAT. Devices need no change — they hold nothing.

### Security properties (and their limits)
* **Never exposed:** the PAT is not in the page, bundle, storage, a URL, a response or a log (tested). The broker has no endpoint that returns it.
* **What the PAT can do is bounded twice:** by GitHub (one repository, Contents only) and by the broker (only `owner/repo` values in `SQLA_ALLOWED_REPOSITORIES`; only `*.json` files below `SQLA_ALLOWED_PATH_PREFIXES`, default `sql-assistant-data/`, so `.github/workflows` can never be written; a body that contains a token or private key, or is not JSON, is refused; 8 MB limit).
* **Who may use it:** only a GitHub account that GitHub itself says may read the repository (sign-in); writing additionally needs write permission on the repository. Sessions are HMAC-signed, expire after 8 hours (`SQLA_SESSION_TTL_MINUTES`) and are valid only for the repository they were issued for. The Admin Password is **not** an authorization for GitHub and is never sent to the broker.
* **Audit:** the broker writes one JSON line per write and per sign-in (time, GitHub login, repository, path, outcome) and every commit message names the signed-in user. It never logs bodies, tokens, codes or file contents.
* **Limits:** anyone who can read the repository can read the encrypted vault; the vault is protected by its passphrase (the built-in default is public — use your own). The broker is a trusted component: protect its host and its application settings like the secret itself. The repository configuration card is still a local, administrator-password-protected setting; the broker enforces the allow-list on the server side so a tampered local setting cannot redirect the PAT.
