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
