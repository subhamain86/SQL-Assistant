# Deploying SQL Assistant V17.2

## Option A — use the built file (no tools needed)
`dist/index.html` is the whole application in one self-contained file.
- **Local:** double-click it.
- **Static web host:** copy it to SharePoint, IIS, nginx, GitHub Pages or Azure Static Web Apps.

All saved data is kept: schemas, the Active Schema, the Admin Password, the Secret Vault, learned queries and settings (same browser storage keys as V17.0/V17.1). **Replace every old copy** of `index.html` on shares and devices. A V17.0-or-older copy still publishes schemas without validation (see `ROOT_CAUSE_V17.2.md`).

## Option B — build from source (Node.js 18+)
```
npm install
npm run verify           # clean → typecheck → lint → tests → production + development builds
npm run dev              # development server on http://localhost:5173 (rebuilds on change)
npm run smoke            # real-browser test (pip install playwright && playwright install chromium)
```

## After upgrading every device
1. Open **Settings → Schema Management** on any device and press **Sync with GitHub Now**. Normal sync now merges and publishes by itself.
2. If the health panel lists a problem:
   - Read its **Source** line. If it says *"V17.0 or older"*, find and update that device or copy.
   - Use **Repair…** or **Publish my local copies** to fix the data.
3. **Validate repository file** shows the writer of the current file and every remaining problem. You can also run `npm run diagnose -- registry.json` from source.
