# SQL Assistant V17.3

Open **`index.html`** (project root) or **`dist/index.html`**: double-click it, or host the **`release/`** folder (GitHub Pages, IIS, Azure Static Web Apps).
GitHub Pages: `.github/workflows/deploy-pages.yml` builds, tests and deploys `release/` on every push to `main` (Settings → Pages → Source: GitHub Actions).

```
npm install
npm run verify          # clean → typecheck → lint → 20 Node tests → production build → 48 real-browser checks
npm run build:dev       # development build (comments kept)
npm run diagnose -- path/to/registry.json   # check a repository schema file without the app
```
Browser tests need `pip install playwright && playwright install chromium`, or `CHROME_PATH=...`.

Root cause and fixes: `docs/V17.3-ROOT-CAUSE.md`. Change log: `CHANGELOG.md`.

## After upgrading
1. Open Settings → Secret Vault. Check that the schema file path is `sql-assistant-data/schemas/registry.json`. Corrected V17.2.1 paths are fixed automatically.
2. On the device with the most complete schemas, press **Synchronize now**. A legacy AP schema 77 is migrated and published in the current format.
3. Press **Synchronize now** on the other devices.
4. Retire any V17.0 copy. It publishes without validation.
