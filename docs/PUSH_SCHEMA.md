> **Removed in V17.5.4.** The *Push to GitHub* tab described below no longer exists (see CHANGELOG_V17.5.4.md). `SyncService.push()` and its read-back verification remain in the code and are used by *Sync with GitHub Now*. This page is kept as history.

## Push to GitHub — quick guide (V17.5.3)

### What it does
Publishes the schemas of **this device** to the shared repository — the **same** repository, branch, folder, file (`sql-assistant-data/schemas/registry.enc.json`) and encryption as *Pull Schema* and *Sync with GitHub Now*. It never creates a repository, never changes the repository location and never writes any file other than the schema file.

### Before the first push (once per device)
1. **Settings → Secret Vault** (Admin Password): enter *owner/repo*, branch and a GitHub access token with **Contents: Read and write** on that repository. *The Vault passphrase does not give access to GitHub — the token does.* (A token with *Contents: Read* is enough to **pull**.)
2. Make sure the schemas you want to share exist on this device (Settings → Manual Schema Update, or import). The built-in starter schemas are not published.

### Push
1. **Hamburger menu → Schema → Push to GitHub.**
2. Check the status and the list *What will be published*.
3. Enter the **Vault passphrase** (masked; use the eye to check it) — at least 10 characters; type it twice the first time — and the **Admin Password**.
4. **Push / Populate GitHub Repository.** The schemas are validated, encrypted, written, then **read back from GitHub and compared**. Only then you see *"Schema published to GitHub and verified."* with the schemas that were *added*, *updated* or were *already identical*.
5. Give the Vault passphrase to your colleagues through a secure channel. They use **Schema → Pull Schema from GitHub** with it and a repository connection of their own.

### What you may see instead
| Situation | Message (short) | Repository |
|---|---|---|
| No repository connection | *No repository connection is set up on this device* → Settings → Secret Vault | untouched |
| Token rejected (401) | *The repository rejected the access token* | untouched |
| Token cannot write (403) | *The access token is not allowed to write … needs Contents: Read and write* | untouched |
| Repository / branch not found | *The repository, branch or folder was not found* | untouched |
| Network / timeout | *GitHub could not be reached* / *did not answer in time* | untouched |
| File changed while publishing | *Pull the latest schema, then publish again* | untouched |
| Different passphrase on the file | *protected with a different Vault passphrase* → enter the right one, or tick **Replace** to rotate | untouched |
| Damaged repository file | *could not be read* → tick **Replace** to replace it on purpose | untouched |
| A schema is invalid | *failed validation and was not published* → fix it first | untouched |
| Conflict with the repository | *Publishing is paused* → Settings → Schema Management → Use Local / Use Remote | untouched |
| Would remove repository-only schemas | *Publishing would remove …* → Pull first | untouched |
| Write not confirmed by the read-back | *The repository did not confirm the update* (**not** a success) | may hold the new file — use Pull Schema to check |

### Rotating the Vault passphrase
Type the new passphrase, tick **Replace the repository file …**, confirm. Other devices get *"The passphrase is incorrect"* with the old one and must enter the new one under Pull Schema. Earlier commits of the repository still hold the old ciphertext (readable with the old passphrase).

### Good to know
* Pushing twice with nothing changed writes nothing.
* A local edit stays **not yet published** until a push has been *verified*.
* The passphrase is saved on this device only after a verified push (tick *Remember*), only as ciphertext.
