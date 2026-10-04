# Deployment and upgrade

1. **Build:**
   - `npm install && npm run verify`. This produces `dist/index.html`, the root `index.html` and `release/`.
   - To build without running the tests, use `npm run build`.
2. **Publish** one of the following:
   - **GitHub Pages:** push the project to `main`. The workflow publishes `release/`.
   - **IIS, Azure Static Web Apps or another web server:** copy the contents of `release/` to the server.
   - **A single shared file:** share `dist/index.html`.
3. **First run on each device:**
   - Open Settings → Secret Vault and check the owner, repository, branch and **schema file path** (`sql-assistant-data/schemas/registry.json`).
   - If the vault was pushed from V17.2.1 or V17.3, enter the token once and save.
4. **On the device with the most complete schemas,** go to Settings → Schema Management and press **Synchronize now**.
   - Legacy schemas (for example AP schema 77) are migrated and published in format 2 with the writer stamp `SQL Assistant 17.3.1`.
   - If a repository schema is still rejected, the message names the stage, location and the **device and version that wrote it**. Use **Validate repository file** to check, and **Publish my local copies** to replace the file.
5. **Press Synchronize now on the other devices.**
6. **Replace every older copy of the app,** especially V17.0 and earlier. Those copies publish schemas without validation.

**SharePoint and OneDrive** usually *download* `.html` files instead of displaying them. Use them to distribute the file, not to host it.
