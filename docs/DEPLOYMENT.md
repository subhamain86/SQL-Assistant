# Deploying AP-SQL Assistant V17.1

## Option A — use the built file (no tools needed)
`dist/index.html` is the whole application in one self-contained file. It needs no server, and no internet for the core features.
- **Local:** double-click `dist/index.html`.
- **Static web host** (GitHub Pages, Azure Static Web Apps, IIS, nginx, SharePoint library): copy `dist/index.html` to the host.

**Existing data is kept.** Schemas, the Active Schema, the Admin Password, the local Secret Vault, learned queries and the AI / LLM settings use the same browser storage keys as V17.0.

## Option B — build from source (any machine with Node.js 18+)
```
npm install          # TypeScript is the only build dependency (no Vite/webpack)
npm run verify       # clean → typecheck → tests → build  (writes dist/index.html)
npm run smoke        # optional: real-browser end-to-end test
                     # (needs: pip install playwright && playwright install chromium)
```

## After upgrading: clear the synchronization error once
1. Open **Settings → Schema Management** on the device with the most complete schemas, then press **Sync with GitHub Now**.
2. If the health panel lists a local schema as invalid, press **Repair…**, review the changes, and apply. The schema is published automatically.
   - If only the repository copy is invalid, press **Publish my local copies**.
3. On the other devices, press **Sync with GitHub Now**.

To inspect the repository file without the app:
```
npm run diagnose -- path/to/registry.json
```

## Security note (unchanged from V17.0)
If the legacy `sql-assistant-data/vault/secret-vault.enc.json` (written by V16, encrypted only with the Admin Password) exists in your repository:
1. Rotate the GitHub token.
2. Delete the file.
3. Use the V17 passphrase-based **Push Secret Vault Now**.
