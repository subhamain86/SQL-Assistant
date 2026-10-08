## Source provenance (V17.5.1)

### Baseline used
* **`SQL-Assistant-V17.5.zip`** — the package attached to the chat (the file named in the instructions: `…/Project/Raw/SQL-Assistant-V17.5.zip`, the V17.5 deliverable). Its complete TypeScript source, configuration, tests, build scripts, assets and documentation were extracted and used as the **primary code, functionality and UI baseline**. V17.5.1 was implemented **incrementally** on that architecture — nothing was rebuilt.
* Before any change the V17.5 package was **built and tested unchanged** (production build, 59/59 Node tests), so every later difference is attributable to V17.5.1.
* The SharePoint link cannot be opened from the build environment; the attached zip is the same file. The Microsoft 365 text index of the archive loses the HTML inside template strings, so the attached binary was the only reliable source.
* **Clean install:** the npm registry is blocked in the build environment, so `npm install` was not run; the pre-installed TypeScript compiler (the only dev dependency) was used. The shipped build is byte-identical to a clean rebuild from the ZIP (verified).

### Interpretation notes for V17.5.1
* **"Short":** limited to 140 characters, one line, plain text.
* **"Cross device":** delivered through the repository connection every device already uses for schemas (a separate small file), not a new channel.
* **"In the nav bar":** a slim row inside the `<nav>` element, below the control row. A chip in the control row was built first and rejected: at 1366 px it squeezed the existing schema badge ("AP / P2P Cor…"), which would have changed the V17.5 navbar.
* **Unencrypted file:** chosen so that devices need no passphrase to read a notice; stated in the panel and the docs. (The schema file remains passphrase-protected exactly as in V17.5.)
* **No automatic expiry:** a message stays until an administrator clears it — there was no requirement for an expiry time.

---

## Earlier provenance (V17.5, unchanged)

### Baseline used
* **`SQL-Assistant-V17.4.zip`** — the package attached to the chat (the file named in the instructions: `…/Project/Raw/SQL-Assistant-V17.4.zip`). Its complete TypeScript source, configuration, tests, build scripts, assets and documentation were extracted and used as the **primary code, functionality and UI baseline**. V17.5 was implemented **incrementally on that architecture** — nothing was rebuilt from scratch, and no older version was needed.
* Before any change the V17.4 package was **built and tested unchanged** (production build, 45/45 Node tests) so that every later difference could be attributed to V17.5. The table tick-mark defect was **reproduced in a real browser on this unchanged build** before it was fixed.

### Not accessible
* The **SharePoint link** itself cannot be opened from the build environment (the sandbox has no route to SharePoint). The attached zip is the same file and was used instead. The Microsoft 365 text index of the archive loses the HTML inside template strings, so the attached binary was the only reliable source.
* **Clean install:** the npm registry is blocked in the build environment, so `npm install` was not run; the pre-installed TypeScript compiler was used (it is the only dev dependency). The shipped build is byte-identical to a clean rebuild from the ZIP (verified).

### Interpretation notes
* **"Passphrase" (singular):** V17.5 introduces one **schema passphrase** that protects the synchronized schema file. It is separate from the existing *Vault Sync Passphrase* (which protects the vault file) so that disclosing one never discloses the other; an administrator may choose the same text for both.
* **"Active passphrase display":** the passphrase saved on a device is shown **masked** with a show/hide button (Schema → Pull Schema, and Settings → Schema Management). It is stored on the device only as ciphertext under the device key.
* **Where the encrypted file lives:** `…/schemas/registry.enc.json` beside the plain registry, written and read by the existing synchronization service. An encrypted file cannot be addressed without the existing repository connection (owner / repository / token), which an administrator sets in the Secret Vault — Pull Schema deliberately does not introduce a second credential path.
* **Plain file left in place:** when an administrator switches to encryption, a plain `registry.json` already in the repository is **not deleted** (the app never deletes repository files). Remove it manually once every device has moved to the encrypted file.
