# SQL Assistant — V17.3.1

SQL Assistant writes read-only and Change Request SQL from your **Active Schema**.
Its primary engine is an **offline, self-training natural-language model**. An AI/LLM Model can optionally be added.

## Run it
| Where | Use |
|---|---|
| Your own computer | Double-click **`index.html`** (project root) or **`dist/index.html`**. Each is one self-contained file. |
| GitHub Pages | Push to `main`. `.github/workflows/deploy-pages.yml` type-checks, tests, builds and publishes `release/`. In the repository, set Settings → Pages → Source to **GitHub Actions**. |
| IIS, Azure Static Web Apps or another web server | Copy the contents of `release/` to the server. The folder includes `index.html`, `404.html`, `web.config`, `staticwebapp.config.json` and `.nojekyll`. |

## Develop
```
npm install
npm run dev            # development build at http://localhost:5173, rebuilt when files change
npm run verify         # clean → typecheck → lint → 23 Node tests → dev build → production build → 81 real-browser checks
npm run serve          # serve release/ like GitHub Pages (BASE=/SQL-Assistant/ PORT=8080)
npm run diagnose -- path/to/registry.json   # check a repository schema file without opening the app
```
The browser tests need `pip install playwright && playwright install chromium`. Alternatively, set `CHROME_PATH` to an installed Chrome or Chromium.

## Settings and the Admin Password
Settings are locked behind the **Admin Password**. The default is `admin`; change it under **Settings → Security**. Settings lock again after 5 minutes of inactivity. The password is also required for deleting schema rows and schemas, and for every Danger Zone action.

## Documents
| File | Contents |
|---|---|
| `docs/ROOT_CAUSE_V17.3.1.md` | Why sync kept failing and why the page was blank, and the fixes |
| `docs/CHANGELOG_V17.3.1.md` | Everything that changed |
| `docs/DEPLOYMENT.md` | Steps to take after upgrading, per hosting option |
| `docs/SECURITY.md` | The Secret Vault security model |
| `docs/TEST_REPORT_V17.3.1.md` | Test results |
| `docs/SOURCE_PROVENANCE.md` | Which reference material was used and what could not be accessed |
