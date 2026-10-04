# AP-SQL Assistant V17.2.1: deployment kit

## Why the page was black
The application is built by `scripts/build.mjs` into one self-contained file: **`dist/index.html`**.
The `index.html` in the project root loads `src/main.ts`. Browsers cannot run TypeScript, so when the
root page (or the source folder) is published, no script runs, `#app` stays empty, and only the background is painted.
A runtime error before the app mounted would also leave the screen empty, because the error was never shown.

## What this kit changes
| File | Purpose |
|---|---|
| `index.html` (root) | Forwards to `dist/index.html`, so opening the project root never shows a blank page |
| `scripts/harden-dist.mjs` | Runs after the build. Rejects a dist that still points at `src/main.ts`, guarantees `#app`, and injects a loading screen plus a visible error panel |
| `scripts/package-release.mjs` | Creates `release/` (index.html, 404.html, .nojekyll, web.config, staticwebapp.config.json, version.json) |
| `.github/workflows/deploy-pages.yml` | Typecheck, test, build, release, then GitHub Pages |
| `package.json` scripts | `build` = original build + hardening, `build:raw`, `release`, `deploy` |

No file in `src/` is modified. App behaviour, storage keys and data are unchanged.

## Apply
```bash
node tools/apply-deploy-kit.mjs <path>/SQL-Assistant-V17.2.1            # dry run
node tools/apply-deploy-kit.mjs <path>/SQL-Assistant-V17.2.1 --write    # apply (backup in .deploy-kit-backup/)
cd <path>/SQL-Assistant-V17.2.1
npm install
npm run deploy        # typecheck + test + build + release
```
Rollback: copy the files from `.deploy-kit-backup/<timestamp>/` back.

## Publish `release/`
- **Local / file share:** double-click `release/index.html`.
- **GitHub Pages:** go to Settings, then Pages, set Source to **GitHub Actions**, and push to `main`. The workflow does the rest.
- **Azure Static Web Apps:** set the app location to `release` (it includes `staticwebapp.config.json`).
- **IIS / Azure App Service:** copy the contents of `release/` to the site root (it includes `web.config`).
- **SharePoint / OneDrive:** SharePoint usually *downloads* .html files instead of rendering them. Use it for distributing the file, not for hosting it.

## If something still fails
The page now shows **"AP-SQL Assistant could not start"** with the actual error, instead of a black screen.
Common causes:
- You opened the source `index.html` and no build exists yet: run `npm run build`.
- Corrupt stored data from an older version: clear site data for that origin and reload.
- `harden-dist` reports `src/main.ts`: the build copied the source page. Check `scripts/build.mjs`.
