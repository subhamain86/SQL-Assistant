## SQL Assistant 17.5.3 — what changed

V17.5.3 is an incremental upgrade of **V17.5.2** (the attached `SQL-Assistant-V17.5.2.zip` is the baseline — see `SOURCE_PROVENANCE.md`). UI, architecture, file formats, encryption, repository paths and the deployment workflow are unchanged. One capability was added and the one that already existed was made verifiable.

### What was investigated first (V17.5.2, built and tested unchanged: 78/78 Node tests)
* **Pull** already worked across devices (hamburger menu → Schema → Pull Schema), and an **administrator** could already publish — but only from *Settings → Schema Management* (behind the Admin Password), not from the Schema section.
* **Gap 1 — no push in the Schema section.** The request was to populate / synchronize the repository from *Hamburger menu → Schema*.
* **Gap 2 — success was not confirmed.** `SyncService.push()` returned success as soon as GitHub accepted the `PUT`. It never read the file back, so an accepted-but-not-confirmed write was reported as a success, and the result did not say *which* schemas were added or updated.
* **Gap 3 — the passphrase was saved before the publication succeeded** (Settings flow), so a failed publish could leave a device holding a passphrase the repository did not use.
* **Gap 4 — failure messages for publishing** were plain strings; the UI could not say *what* failed (token, permission, network …) or *what to do*.

### Added — Schema → Push to GitHub ("Push / Populate GitHub Repository")
* A **fourth tab on the existing Schema page** (deep link `#schema-used/push`); the hamburger menu is unchanged. *Pull Schema* is now labelled **Pull Schema from GitHub**.
* The tab shows: short instructions, the **status** (repository connection, **Vault passphrase available on this device / not available**, last pull / publish, schemas not yet published, conflicts, latest problem), **what will be published** (every schema with tables / columns / CASE-DECODE entries and whether it is *new*, *changed* or *already exchanged*; invalid schemas; the built-in starter schemas that stay local), the **Vault passphrase** (masked, eye button; saved passphrase shown masked), its confirmation, the **Admin Password**, and the button.
* **Vault passphrase** is the passphrase that protects the synchronized schema file (called *Schema passphrase* in Settings → Schema Management). It is **not** the *Vault Sync Passphrase* of the Secret Vault file. The status chips now say "Vault passphrase available on this device (encrypted)" / "No Vault passphrase on this device".
* **Publishing is privileged**, like the corresponding Settings action: it asks for the **Admin Password** (checked before anything is contacted).

### Changed — publication is verified (also for *Sync with GitHub Now* and the Settings action)
`validate every schema → read + decrypt the repository file → merge what changed there → compare → encrypt (AES-256-GCM) → write → READ BACK, decrypt and compare → record the exchange → report success`.
* **Success only after confirmation.** If the file cannot be read back, differs, or cannot be decrypted, the result is *"The repository did not confirm the update"* (stage *Verify*), nothing is recorded, the schemas stay **not yet published** and the passphrase is **not** saved. A mismatch is re-checked twice (0.6 s apart) because GitHub can briefly serve the previous version right after a write.
* **Per-schema result:** *Added to the repository / Updated in the repository / Already identical*, plus the file path and revision.
* **Idempotent:** with nothing changed the repository already holds the same schemas — nothing is written (no empty commit); repeated pushes never duplicate a schema.
* **Only the schema file is written.** Knowledge, admin-message, README and every other file in the repository are untouched (asserted byte-for-byte).
* **No incomplete overwrite:** publishing from the Schema section refuses — with an explanation and nothing changed — when it would **remove a schema that exists in the repository but not on this device**; invalid schemas are never published; unresolved conflicts pause publishing; unreadable repository schemas are never silently replaced.
* **Typed failures with the next step:** no connection, token rejected (401), no write permission (needs *Contents: Read and write*), repository / branch not found, network, timeout, file changed on the server, different passphrase, unreadable file, validation, unresolved conflict, would-remove, verification. None of them shows a success message.
* **The typed passphrase is used for one publication.** It is saved on the device (ciphertext under the non-extractable device key) only **after** the publication was verified, and only if "Remember" is ticked. It is redacted from every message and log.

### Passphrase rotation (explicit, never automatic)
Type the new passphrase and tick **"Replace the repository file …"**. The file is re-encrypted and verified; the **old** passphrase then no longer opens it and other devices must enter the new one (tested). Without the tick a different passphrase is **refused** and the repository file is left untouched. **Nothing rotates by itself**, so existing encrypted data can never become unreadable by accident. Old *commits* of the repository still contain the old ciphertext, readable with the old passphrase — if a passphrase may have been disclosed, rotate **and** treat the content of earlier versions as exposed (see `SECURITY.md`).

### Unchanged (guarded by the earlier suites)
Describe What You Need, Manual Selectors, CASE/DECODE (manual and schema-based), Advanced Options, schema management and modules, Pull Schema, Secret Vault, AI/LLM Model, learning, Query Library, Settings, Admin Password, navigation, responsive layout and deployment. **No file format, storage key or repository path changed.**

### Compatibility
No migration. V17.5.2 schemas, the V17.5.2 encrypted file (`sqla-schema-sync` v1), the plain registry (format 2), the vault and every setting are read as they are (tested). A V17.5.2 device that is not upgraded keeps working with the same files.

### Version
17.5.2 → 17.5.3 (footer, About, writer stamp, `version.json`, offline NLU label).
