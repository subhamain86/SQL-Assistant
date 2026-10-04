# Deploying AP-SQL Assistant V17.0

## Option A — use the built file (no tools needed)
`dist/index.html` is the whole application in one self-contained file (no other files, no server, no internet needed for the core features).
- **Local:** double-click `dist/index.html`.
- **SharePoint / OneDrive / Teams:** upload `dist/index.html` to a document library and open it. If SharePoint downloads the file instead of opening it, use Option B or a static web host.
- **Static web host** (GitHub Pages, Azure Static Web Apps, IIS, nginx): copy `dist/index.html` to the web root.

Existing data in the same browser is kept: schemas, the Active Schema, the Admin Password and the local Secret Vault use the same storage keys as V16. A V16 Online AI/NLP Endpoint is moved automatically to Settings → AI / LLM Model.

## Option B — rebuild from source
```
npm install            # installs TypeScript (the only build dependency)
npm run typecheck      # 0 errors expected
npm test               # unit + integration tests
npm run build          # writes dist/index.html
npm run smoke          # optional: real-browser test (pip install playwright && playwright install chromium)
```

## First-time configuration (per device)
1. **Settings** → Admin Password (the default is `admin`, change it in **Security**).
2. **Secret Vault**:
   - Set the GitHub access token and repository.
   - For cross-device use, enter a **Vault Sync Passphrase** and press **Push Secret Vault Now**.
   - On another device: unlock Settings, enter the same passphrase, then **Pull & decrypt**. For a private repository without a token on that device, use **Export / Import encrypted file** instead.
3. **AI / LLM Model** (optional): choose the provider, endpoint, model and API key, then press **Test connection**. The endpoint must allow browser (CORS) requests.

## Security note for existing repositories
V16 automatically pushed `sql-assistant-data/vault/secret-vault.enc.json`, which was encrypted only with the Admin Password. If that file exists in your repository:
1. Rotate the GitHub token.
2. Delete the file.
3. Use the V17 passphrase-based push.

V17 still reads the old file when unlocking, for compatibility, but never writes it.
