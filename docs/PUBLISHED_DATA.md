## Published data — reading the private repository without a token (V17.6.3)

### 1 · Design note (decision first, then implementation)
**Problem.** The data repository `basware/sk-ap-sql-assistant` is private (GitHub Enterprise Cloud). V17.6.2 reached it through a PAT held by a separate Node service. Two things stood in the way: (a) the deploy's PAT check was answered **HTTP 403** by GitHub, and (b) there is no host for the service — the app itself is published by Basware's zone platform, which republishes when a push to `main` changes `dist/**`. A GitHub Actions secret cannot be read by browser code, so any design needs a *trusted execution environment*.

| Option | What it is | Needs | Security impact | Verdict |
|---|---|---|---|---|
| **A** Broker (V17.6.2) | A Node service holds the PAT; users sign in with GitHub | a Node host, an approved PAT, a GitHub App | PAT never reaches a device; strongest for **writes** | **kept, optional** — unchanged, used when `repo-broker.config.json` is deployed |
| **B** Publish from Actions (**chosen for reads**) | A workflow using only the built-in `GITHUB_TOKEN` mirrors `sql-assistant-data/**` into the site folder; devices fetch it **same-origin with no credential** | nothing new: the repo, Actions and the existing site publication | no PAT, no approval, no SSO and no sign-in for reading. The published files are readable by **everyone who can load the site** (see §5) | **chosen** — least new infrastructure, and it does not depend on the PAT that returned 403 |
| **C** GitHub App installation tokens | A workflow mints short-lived tokens | an enterprise/org-owned GitHub App | best for write automation; installation tokens expire in 1 h, so they cannot sit in a static vault | documented, **not implemented** — pick it if org policy forbids PATs *and* you need device writes |

**What this means in practice**
* **Reading** (Pull Schema, Pull Secret Vault, background sync, knowledge, admin message) needs **no token at all**.
* **Writing** (publishing schemas, Push Secret Vault) still needs a credential: a token on the device (Schema → Pull Schema → *Set Token*), the broker (option A), or a Git clone / the GitHub web UI. A browser cannot write to a private repository with no credential — that is a GitHub rule, not a limitation of this app.
* **Token for devices (optional).** The workflow can also publish a **central token vault**: a **read-only** token encrypted with the standard vault envelope. A device with no token restores it automatically (§4). It is only for devices that must call the GitHub API; reading does not need it. Creating that token is subject to the same org approval that may have caused the 403.

### 2 · How it works
1. Devices (or you) change `sql-assistant-data/**` in the repository — as before.
2. **`.github/workflows/publish-data.yml`** runs on that push (permissions: `contents: write`, `actions: write`; uses `GITHUB_TOKEN` only). `scripts/publish-data.mjs` copies the folder into `dist/sql-assistant-data/` and writes the marker `published.json` **last**: commit id, time and the SHA-256 of every file. It commits `dist/sql-assistant-data/**`.
3. The zone platform republishes (see §3), and `<site>/sql-assistant-data/…` serves the files.
4. SQL Assistant reads `published.json` at start-up. **Without a valid marker nothing changes (V17.6.2 behaviour).** With one, a device that has **no token** reads the published files. A file is accepted only if what the site served hashes to the marker's value — a half-finished or stale publication is refused, never applied. A token on the device (and the broker) keep precedence.

What is never published: `*.config.json` (a repository write could otherwise redirect the sign-in or broker address), dot-files, symbolic links, non-JSON files, files over 8 MB, and **any file containing a GitHub token or private key in readable form — the run fails instead** (encrypted vault files contain none).

### 3 · One-time setup
1. Commit V17.6.3 to `main`. `dist/` is committed (zone publishes it); `npm run build` now **keeps** `dist/sql-assistant-data/**`.
2. Ask the zone owners (Ville Vainio) two things: **(a)** does the site serve `dist/` as its root, so `sql-assistant-data/` sits next to `index.html`? **(b)** is the site republished by a `push` workflow? A commit made with `GITHUB_TOKEN` does **not** trigger `push` workflows. If that is the case, give the site's publish workflow a `workflow_dispatch:` trigger and set the repository **variable** `SQLA_SITE_PUBLISH_WORKFLOW` to its file name — `publish-data.yml` then starts it.
3. If `main` is protected, allow `github-actions[bot]` to push (or publish to a branch the site uses).
4. Run **Actions → Publish SQL Assistant data → Run workflow** once. Check `<site>/sql-assistant-data/published.json` in a browser.
5. In SQL Assistant: **Hamburger → Schema → Pull Schema** shows *"Reading needs no token … published …"*; **Pull Schema** works on a clean browser profile.

### 4 · Central token vault (optional)
For devices that must use the GitHub API without anyone typing a token:
| Kind | Name | Value |
|---|---|---|
| Secret | `SQLA_DEVICE_TOKEN` | fine-grained PAT: resource owner **`basware`**, repository **`sk-ap-sql-assistant` only**, **Contents: Read-only**. Created by a service account. A token that can **write** is refused. |
| Secret | `SQLA_VAULT_PASSPHRASE` | ≥ 10 characters — **not** the public default |
| Variable (optional) | `SQLA_ALLOW_DEFAULT_VAULT_PASSPHRASE` | `true` to accept the public default `xG71lfp1NHZVZ4WVWCPe` instead — see the warning below |

Run **Publish SQL Assistant data → Run workflow → rebuild_central_vault = true**. It checks the token with GitHub (printing GitHub's own message and SSO header on a refusal, never the token), writes the standard vault envelope to `sql-assistant-data/vault/secret-vault.v17.enc.json` and publishes it.
* **Default passphrase:** the card is pre-filled with it and a vault built with it restores **automatically** — but it ships inside the application, so the vault is only as private as the site and the repository. With your own passphrase, a new device needs it typed once in *Pull Secret Vault to Repository* (the Card 1 row tells the user). This is a deliberate trade-off; prefer your own passphrase when the token matters.
* Rebuilding **replaces** the vault file (including an AI key pushed from a device).
* **Rotation / expiry:** replace `SQLA_DEVICE_TOKEN`, rerun with *rebuild_central_vault*; devices restore the new token the next time they have none or use *Retrieve from Repository*. Fine-grained tokens expire (maximum 366 days by default) — put the date in a calendar; `verify-repo-pat.yml` still checks a write PAT if you use the broker.

### 5 · Who can read the published files
Everyone who can load the site from the zone platform. I could not see the platform's access rules. If it requires a sign-in, the browser's same-origin request carries the site session and works; a 401/403 is reported to the user ("sign in to the site first") and nothing is applied. The published schema registry is **plain metadata** (table and column names, labels) — as it already is in the private repository; the vault is encrypted. If that metadata is confidential beyond the people who can use the site, do not publish it (keep option A or work from a clone).

### 6 · GitHub Enterprise Cloud checklist (for the PAT / broker routes)
* **Token:** *Settings → Developer settings → Personal access tokens → Fine-grained tokens*, **Resource owner = `basware`** (not your personal account), only `sk-ap-sql-assistant`, Contents as needed.
* **Approval:** if the organization requires it, an org owner approves under *org → Settings → Personal access tokens → Pending requests* — until then the token cannot reach non-public resources (daily e-mail to owners).
* **Policy:** enterprise / organization owners can restrict fine-grained tokens or cap their lifetime (default maximum 366 days).
* **SSO:** a fine-grained token cannot be authorized for SAML afterwards — create a new one after SSO is configured and authorize it at creation.
* **IP allow list:** applies to PATs and to `GITHUB_TOKEN`. Your PAT check failed although the earlier steps of the same run (checkout of the private repository) worked, which points *away* from an IP block of the runner and *towards* approval / policy / SSO / resource owner — a likely, not certain, reading.
* **Enterprise Managed Users:** an account name ending in `_Basware` suggests EMU; enterprise policies then also govern your account's tokens, and an app used for sign-in must be owned by the org or enterprise.

### 7 · Troubleshooting a 403 from the PAT check (`verify-pat.mjs` now prints GitHub's message and headers)
| What the log shows | Cause | Fix |
|---|---|---|
| `GitHub says: "Resource not accessible by personal access token"` | token has no access to this repository: wrong resource owner, repository not selected, or **approval pending** | recreate with Resource owner `basware` + the repository; ask an org owner to approve |
| `X-GitHub-SSO is present` / message mentions SAML | SSO authorization missing | create a **new** fine-grained token after SSO is configured |
| message about a policy or lifetime | enterprise / org PAT policy | ask the owners which policy applies |
| `rate limit exhausted` | rate limit | wait; rerun |
| 403 locally with `curl` **and** in Actions | token / policy problem | as above |
| 200 locally but 403 only in Actions | IP allow list blocks the hosted runner | static-IP / self-hosted runner, or use option B (no PAT) |
| HTTP 404 | repository not granted, wrong owner, or approval pending | as above |
| `SQLA_GITHUB_PAT` not set | secret missing | add it (only needed for option A) |
Local check without leaving the token in your shell history:
```
read -rs T; curl -s -i -H "Authorization: Bearer $T" -H "Accept: application/vnd.github+json" https://api.github.com/repos/basware/sk-ap-sql-assistant | head -30; unset T
```
Never paste the token or this output (if it contains the token) into a chat or ticket.

### 8 · Messages users may see (published route)
| Message | Meaning |
|---|---|
| *No schema file was found in the repository yet* | the file is not in the publication — publish it first |
| *…does not match its publication record* / *…publication may still be in progress* | the site serves a different or missing copy; nothing was applied; retry in a minute |
| *The site refused the published copy…* | the site wants a sign-in |
| *This device reads the published copy and holds no token, so it cannot publish* | writing needs a token (Set Token, restore the central vault, or a clone) |
| *…protected by its own Vault Sync Passphrase* | enter it in *Pull Secret Vault to Repository* |
In every case the local schema, vault and settings are left exactly as they were.

## V17.6.5 — the central Admin Password record is published too
`sql-assistant-data/security/admin-credential.json` (the encrypted verification marker of the Admin Password in a versioned envelope — never the password) is mirrored like any other `*.json` file, so a device with **no token** verifies the Admin Password against it. Only a **valid** record is published (`scripts/publish-data.mjs` applies the same strict check as the browser and the broker); an invalid one never replaces the published copy, whose last good version stays listed in `published.json`. Deleting the file from the repository removes it from the publication and every device returns to its local password. The last step of `publish-data.yml` fails by name when the record exists in the repository but is not published. See `SECURITY.md` (V17.6.5) for the limitations.

