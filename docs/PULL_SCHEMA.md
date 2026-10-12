## Pull Schema — quick guide (V17.5)

### For the administrator (once)
1. **Settings → Schema Management → Schema passphrase.** Enter a passphrase (at least 10 characters) twice. Use the eye button to check what you typed.
2. Press **Save passphrase and publish encrypted schema**. The schemas on this device are validated, encrypted and written to `sql-assistant-data/schemas/registry.enc.json` in the configured repository.
3. Give the passphrase to your colleagues through a secure channel (not e-mail or chat).
4. **Changing the passphrase:** enter the new one, publish again, tell your colleagues. Devices that still have the old one are told *"The passphrase is incorrect"* and update it under *Pull Schema*.

### For everyone else
1. Open the **hamburger menu → Schema → Pull Schema** (or `#schema-used/pull`).
2. Type the passphrase (hidden by default — use the eye to check it) and press **Pull Schema**.
3. Review the comparison — this device, repository, version, updated date, contents, action — then **Apply to this device** (or **Cancel**; nothing has been changed until you apply).
4. The schema is imported, becomes the active schema, and Manual Selectors, Describe What You Need, the offline NLU, SQL generation and the schema CASE/DECODE definitions use it immediately.
5. Leave *Remember this passphrase on this device* ticked and the passphrase is kept encrypted on the device; **Sync with GitHub Now** then keeps the schema up to date automatically. *Remove saved passphrase* returns the device to plain synchronization.

The repository connection (owner/repo/token) is set once by an administrator in **Settings → Secret Vault** (or retrieved from the encrypted vault file). Pull Schema uses that same connection.

### What you will see when something is wrong
| Situation | Message | Local schema |
|---|---|---|
| Wrong passphrase | *The passphrase is incorrect. The existing local schema has not been changed.* | unchanged |
| Passphrase empty / too short | *Schema pull failed because the passphrase could not be validated. Your existing local schema has not been changed.* | unchanged |
| No file / no network / no connection | *The synchronized schema could not be retrieved. Please verify the repository connection and try again.* (+ detail) | unchanged |
| Damaged or modified file | *The schema could not be decrypted using the supplied passphrase. The existing local schema has not been changed.* | unchanged |
| Invalid schema content | *The synchronized schema failed validation. The existing local schema has not been changed.* (+ where) | unchanged |
| Repository copy older than local | *The synchronized schema is older than the current local schema and was not applied.* | unchanged |
| Cancelled | *Pull cancelled. The existing local schema has not been changed.* | unchanged |
| Success | *Schema pulled and validated successfully.* | updated, activated |

### File format (`sqla-schema-sync` v1)
Clear header (format, versions, writer, application version, schema format version, time, device, number of schemas — **no** table or column names) + `cipher` (AES-256-GCM, PBKDF2-SHA-256, iterations, salt, IV, ciphertext) + `check`. The header is bound to the ciphertext as additional authenticated data.


#### V17.5.2 — status, messages and the 8 steps
The Pull Schema tab opens with a status block: repository connection (token *saved*, never shown), schema passphrase (*saved (encrypted)* / *not saved* / *unreadable here*), last download and publish, **schemas with changes not yet published**, unresolved conflicts, and the latest problem. A schema you edited on this device stays *not yet published* until a publish succeeded.

Steps: **1** hamburger menu → **Schema** → **Pull Schema** · **2** check the status (connection; passphrase if your administrator uses one; missing connection → *Open Settings → Secret Vault*) · **3** type the schema passphrase · **4** **Pull Schema** · **5** if GitHub refuses, the message tells you why · **6** check which schemas will be added / replaced (a file can hold several) · **7** **Apply to this device** — retrieved, decrypted, validated, imported · **8** verify the active schema.

| Situation | What you see | Local schema |
|---|---|---|
| Token rejected (401) | *The repository rejected the access token …* → create a token with *Contents: read*, Secret Vault | unchanged |
| No permission / rate limit (403, 429) | *The access token is not allowed to read the repository …* | unchanged |
| No answer within 20 s | *GitHub did not answer in time.* → check the network | unchanged |
| Network down / no connection | *The synchronized schema could not be retrieved …* + next step | unchanged |
| Newer / unsupported format | *… uses a format this version cannot read* → update SQL Assistant | unchanged |
| Changed on both devices | conflict named in the preview; **Record the conflict for resolution**; result *completed only partly*; resolve with *Use Local / Use Remote* | both kept |
| Some schemas kept (local copy newer) | *completed only partly* (not "success") | kept |

The **Vault Sync Passphrase** (used only to retrieve the repository connection from the Secret Vault file) is never stored on any device, so it cannot be shown; enter it in Settings → Secret Vault.


#### V17.5.3
The page is now titled **Pull Schema from GitHub**; the passphrase is called the **Vault passphrase** in the status chips ("Vault passphrase available on this device (encrypted)" / "No Vault passphrase on this device"). Publishing from the Schema section is described in `PUSH_SCHEMA.md` (hamburger menu → Schema → *Push to GitHub*).


##### V17.5.4 — the repository and the Secret Vault pull now live on this page
**Hamburger menu → Schema → Pull Schema** now has three parts:
1. **GitHub repository (schema synchronization)** — repository `basware/sk-ap-sql-assistant`, branch `main` and schema file `sql-assistant-data/schemas/registry.json` are fixed and read-only; **Show repository details** reveals what is read / written there (hidden by default). Set or change the **access token** here (asks for the Admin Password).
2. **Pull Schema from GitHub** — unchanged (the 8 steps, preview → apply, failures).
3. **Pull Secret Vault to Repository** — retrieves the encrypted Secret Vault from the repository onto this device with the **Vault Sync Passphrase** (pre-filled with the default, masked, eye button) or imports an encrypted file. The repository is only read.

The *Schema passphrase — encrypted synchronization* card (Settings → Schema Management) and the *Push to GitHub* tab were removed; the passphrase section "For the administrator (once)" above describes the V17.5–V17.5.3 interface. A saved passphrase still makes *Sync with GitHub Now* use the encrypted file. *Push Secret Vault to Repository* stays in Settings → Secret Vault.


##### V17.5.5 — Pull Schema is a single button
**Hamburger menu → Schema → Pull Schema** has three cards: **GitHub repository (schema synchronization)** (values hidden until *Show configuration*; read-only; set the access token here), **Pull Schema from GitHub** and **Pull Secret Vault to Repository**.
The *Pull Schema from GitHub* card has **one** action, **Pull Schema**, and no passphrase field. One click retrieves the schema file of the configured repository, validates it and synchronizes this device (the same validated, transactional pull as before: a failure never changes your schema, a newer local copy is kept, a change on both sides becomes a conflict, success is shown only when everything was applied).
If the repository file is passphrase-protected, the pull needs the Vault passphrase that is **already saved on this device**; otherwise it tells you so (it never reports an empty repository). The steps, the comparison table, *Apply* / *Cancel* and the passphrase controls described above belong to V17.5–V17.5.4. Messages: see CHANGELOG_V17.5.5.md.


##### V17.5.7 — recovering the GitHub token on a new device
1. **Device A (once):** Schema → Pull Schema → *Set Token* (Admin Password). SQL Assistant asks GitHub whether the token works and with which permission (rejected ⇒ not saved; read-only ⇒ warning). Then Settings → Secret Vault → enter **your own** Vault Sync Passphrase twice → *Push Secret Vault to Repository*.
2. **Device B:** open Schema → Pull Schema. In *Pull Secret Vault to Repository* enter the passphrase and either *Import encrypted file* (the vault file `sql-assistant-data/vault/secret-vault.v17.enc.json`, downloaded from GitHub) or — for a public repository, or when the device already has a token — *Retrieve from Repository*. The vault is decrypted and validated on the device, GitHub is asked about the token, and it is stored encrypted (never displayed). *Pull Schema* and *Push* work immediately.
3. If GitHub rejects the token inside the vault (revoked / expired) the import says recovery is not possible and changes nothing — create a new token and push the vault again from a working device.

Repository settings (see V17.5.6 notes above): hidden, read-only for everybody, changeable only by an administrator (Admin Password); the same values serve schema pull / sync and vault pull / push.


##### V17.6.1 — recovering the Secret Vault on a device that has no GitHub token
1. **Device A (once):** Schema → Pull Schema → *Set Token* (Admin Password; GitHub checks it) → Settings → Secret Vault → push with **your own** Vault Sync Passphrase.
2. **Device B (no token):** Schema → Pull Schema → *Pull Secret Vault to Repository*. Type the passphrase (the masked field is pre-filled with the application default — it opens only a vault pushed with it) → **Retrieve from Repository**.
   * A public repository, or a token already saved and accepted by GitHub, is read straight away.
   * For a **private** repository the card shows a **code** and the **github.com/login/device** address (where your administrator enabled *GitHub sign-in*): open it, enter the code, approve with your own GitHub account. This page continues by itself; **Cancel** stops it. Without that setup the card tells you so and offers **Import encrypted file** (the vault file downloaded where you are signed in to GitHub).
3. The vault file is checked (existence, structure, version), decrypted with the passphrase, its token is validated with GitHub and only then restored (encrypted; shown masked). Pull Schema and Push work at once. A **wrong passphrase** changes nothing, and after a sign-in you can correct it without signing in again.
4. Every failure — no setup, denied or expired sign-in, an account without access, a missing / HTML / unsupported / corrupted vault, network — says what to do and leaves the device exactly as it was.

##### V17.6.2 — central repository access
When central access is deployed (`CENTRAL_PAT.md`), **Hamburger → Schema → Pull Schema** still has the same three cards in the same order:
1. **GitHub repository (schema synchronization)** — repository, branch and schema file path as before (hidden until *Show configuration*, read-only, editable only by an administrator after the Admin Password check). The *GitHub Access Token* row becomes **Repository access (central)**: *Sign in with GitHub* / *Check central access* (state and expiry of the central PAT) / *Sign out*. No token is stored on the device.
2. **Pull Schema from GitHub** — one button, no passphrase. If no sign-in is active, pressing it shows a code and the real github.com address (with *Cancel*); after you approve, the page continues by itself: the schema is retrieved through the central service, validated and applied, and success is reported only when all of that finished.
3. **Pull Secret Vault to Repository** — **direction: repository → this device** (it only reads). Passphrase field pre-filled with the default, masked, editable. *Retrieve from Repository* reuses the sign-in (or starts it), reads the vault through the service, checks it, decrypts it, restores the AI key and leaves the GitHub token inside the vault unrestored (central access needs none). *Import encrypted file* is unchanged.

**Settings → Secret Vault → Push Secret Vault to Repository** is the only action that writes the vault; it signs in if needed, is written by the service and no longer includes a GitHub token. A read-only GitHub account is told so and nothing is written.
**New device:** Pull Schema → sign in → done — no token typed or copied.

##### V17.6.3 — reading needs no token
When the site publishes a copy of the repository data (`PUBLISHED_DATA.md`), **Hamburger → Schema → Pull Schema** still has the same three cards in the same order:
1. **GitHub repository (schema synchronization)** — unchanged (hidden, read-only, Admin Password to edit). Above the *GitHub Access Token* row a line says *"Reading needs no token"* and shows the publication (time, commit, file count). A device with **no token** restores the central read-only token automatically when a central vault is published (default passphrase); a vault under its own passphrase is restored with Card 3.
2. **Pull Schema from GitHub** — one button, no passphrase. A device with a token reads through the GitHub API (as before); a device with none reads the published copy, checks it against the publication record, validates it and applies it. Success is reported only after that.
3. **Pull Secret Vault to Repository** — direction repository → this device (read-only); passphrase pre-filled with the default, masked, editable; reads the published copy when the device has no token.
**Settings → Secret Vault → Push Secret Vault to Repository** still needs a credential (token on the device, or the broker): a device that has none is told so before anything is encrypted.
