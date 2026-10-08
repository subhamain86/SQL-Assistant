## SQL Assistant — V17.5.1

SQL Assistant writes read-only and Change Request SQL from your **Active Schema**.
Its primary engine is an **offline, self-training natural-language model** that also learns from SQL you confirm and from an **Admin Query Library** of trusted queries. An AI/LLM Model (including a model running on your own computer) can optionally be added; nothing requires it.

### What is new in V17.5.1
* **Admin message in the navbar.** An administrator publishes one short plain-text message (up to 140 characters, *Information* or *Warning*) under **Settings → Synchronization → Admin message**. Every device shows it as a slim row inside the navbar — it appears when SQL Assistant starts, when the tab becomes active again, at the scheduled synchronization and on **Sync with GitHub Now**. Users can hide it on their own device; a new message appears again; **Clear message on all devices** removes it everywhere. It travels through the same repository connection as the schemas (`sql-assistant-data/messages/admin-message.json`), is shown as plain text only, refuses credential-like text and never affects schema synchronization. See `docs/ADMIN_MESSAGE.md`.

### What was new in V17.5
* **Table tick-marks appear immediately** when you select (or remove) a table under Manual Selectors → Tables — nothing else is reset.
* **Schema-based CASE / DECODE for columns.** Under a selected column choose *Display as → CASE / DECODE* and then **Manual** (your own mapping, as before) or **From Schema** (the definition stored in the active schema, e.g. `1 = Open · 2 = Approved · 3 = Rejected`). No definition in the schema → a clear message and no invented SQL. Works in Manual Selectors, Describe What You Need, learned patterns and the Admin Query Library.
* **Pull Schema** (hamburger menu → Schema → *Pull Schema*): bring a schema published from another device onto this one with a **passphrase** (masked, with a show/hide button). The file is **AES-256-GCM encrypted**, validated before anything is replaced, compared with your local version, applied only when you confirm, and a failed pull never touches your working schema. Administrators set the passphrase under Settings → Schema Management. See `docs/PULL_SCHEMA.md`.

### Run it

| Where | Use |
|---|---|
| Your own computer | Double-click **index.html** (project root) or **dist/index.html**. Each is one self-contained file. |
| GitHub Pages | Push to main. `.github/workflows/deploy-pages.yml` type-checks, lints, tests, builds and publishes `release/`. In the repository set Settings → Pages → Source to **GitHub Actions**. |
| IIS, Azure Static Web Apps, other web servers | Copy the contents of `release/` to the server (`index.html`, `404.html`, `web.config`, `staticwebapp.config.json`, `.nojekyll`). |

### Develop
```
npm install
npm run dev            # development build at http://localhost:5173, rebuilt when files change
npm run verify         # clean → typecheck → lint → security → Node tests → dev build → production build → real-browser tests
npm run security       # static security review of src/ and dist/
npm run serve          # serve release/ like GitHub Pages (BASE=/SQL-Assistant/ PORT=8080)
npm run diagnose -- path/to/registry.json   # check a repository schema file without opening the app
```
The browser tests need `pip install playwright && playwright install chromium`; alternatively set `CHROME_PATH` to an installed Chrome / Chromium.

### Settings and the Admin Password
Settings are locked behind the **Admin Password** (default `admin` — change it under **Settings → Security**; they lock again after 5 minutes of inactivity). Tabs: Security · Manual Schema Update · Schema Management · Secret Vault · Synchronization · Admin Query Library · AI/LLM Model · Danger Zone.

### Documents

| File | Contents |
|---|---|
| `docs/CHANGELOG_V17.5.1.md` | Everything that changed in V17.5.1 |
| `docs/ADMIN_MESSAGE.md` | Step-by-step guide to the admin message, behaviour table, file format |
| `docs/CHANGELOG_V17.5.md` | Everything that changed in V17.5 |
| `docs/PULL_SCHEMA.md` | Step-by-step guide (administrator and users), messages, file format |
| `docs/REGRESSION_BASELINE_V17.5.md`, `docs/REGRESSION_BASELINE_V17.4.md` | The functionality that was protected, and which test guards each part |
| `docs/TEST_REPORT_V17.5.1.md`, `docs/TEST_REPORT_V17.5.md` | Test results |
| `docs/SECURITY.md` | Security model; V17.5 passphrase review (V17.4 review unchanged) |
| `docs/DEPLOYMENT.md` | Upgrade and deployment steps |
| `docs/SOURCE_PROVENANCE.md` | Which baseline was used and what could not be accessed |
| `docs/CHANGELOG_V17.4.md`, `docs/CHANGELOG_V17.3.1.md`, `docs/ROOT_CAUSE_V17.3.1.md` | History |
