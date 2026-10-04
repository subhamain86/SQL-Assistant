# AP-SQL Assistant V17.2.1: deployment-ready kit

Fixes the black/blank page and makes V17.2.1 deployable to GitHub Pages, Azure Static Web Apps, IIS or a local file.

**Quick start**
```bash
node tools/apply-deploy-kit.mjs <path>/SQL-Assistant-V17.2.1 --write
cd <path>/SQL-Assistant-V17.2.1 && npm install && npm run deploy
# publish the release/ folder
```
See `docs/DEPLOYMENT_V17.2.1.md`.
