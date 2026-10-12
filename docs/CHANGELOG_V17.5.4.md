### SQL Assistant 17.5.4 — what changed

V17.5.4 is a targeted change of **V17.5.3** (`SQL-Assistant-V17.5.3.zip` is the baseline — see SOURCE_PROVENANCE.md; it was built and tested unchanged first: production build, 88/88 Node tests). Only the screens named in the request changed; no file format, storage key, encryption or repository path changed.

#### What moved, what was removed
| Where | V17.5.3 | V17.5.4 |
|---|---|---|
| **Hamburger → Schema → Pull Schema** | Pull Schema panel only | **Card 1** *GitHub repository (schema synchronization)* · the Pull Schema panel (unchanged) · **Card 2** *Pull Secret Vault to Repository* |
| **Hamburger → Schema** | tabs: Tables · Stored Schemas · Pull Schema · **Push to GitHub** | tabs: Tables · Stored Schemas · Pull Schema — **no push action** |
| **Settings → Schema Management** | had the card *Schema passphrase — encrypted synchronization* | card **removed** (repository sync, status, conflicts, stored schemas unchanged) |
| **Settings → Secret Vault** | GitHub repository card + *Push Secret Vault to Repository* (+ Retrieve / Import buttons) | **only *Push Secret Vault to Repository*** (+ a note pointing to Schema → Pull Schema) |

##### Card 1 — GitHub repository (schema synchronization)  (Schema → Pull Schema)
* **Fixed, read-only values:** repository `basware/sk-ap-sql-assistant`, branch `main`, schema file `sql-assistant-data/schemas/registry.json` (`readonly` + `aria-readonly`; typing, paste, Backspace and Delete change nothing). Defined once in `src/v17/services/repositoryDefaults.ts`.
* **Hidden information message** (repository synchronization details: which files are read / written, token permissions, what pulling does) behind a **Show / Hide repository details** button (`aria-expanded`). It is hidden by default, every time the page is shown. It contains no secret.
* **The access token** (set / change, masked) moved here with its original handler and element ids. Because the Schema page — unlike Settings — is not password-protected, **changing the token asks for the Admin Password** (a wrong password changes nothing).
* **The location is applied everywhere.** `context.ts` applies `withLockedLocation()` to the secrets every synchronization reads (schemas, encrypted schema, knowledge, admin message, Secret Vault), so no screen can disagree. A device that has another repository / branch / path stored keeps that stored data untouched (nothing is deleted or rewritten) but it is ignored; a retrieved vault cannot move the location either. Tested: every request goes to `basware/sk-ap-sql-assistant`, GETs read `ref=main`, only the schema file is written.

##### Card 2 — Pull Secret Vault to Repository  (Schema → Pull Schema)
* **The operation is a pull:** *Retrieve from Repository* (and *Import encrypted file*) — the original handlers, now with a busy flag (the button is disabled and "Retrieving and decrypting…" shows while GitHub works; a double click starts one request). The repository is only **read**: tested to cause no write request and no change to any file.
* **Vault Sync Passphrase** is pre-filled with the default value you specified (masked, eye button to reveal / hide, assigned as a property — never written into markup, storage or logs; replace it by typing). See *Security* below.
* **Naming:** the card is titled exactly as requested, *Pull Secret Vault to Repository*, but what it does is the reverse of its wording — it pulls the vault **from** the repository **to this device**. The card text says so. If you prefer, renaming it to "Pull Secret Vault from Repository" is a one-line change in `schemaRepoCards.ts`.

##### Removed
* **Schema → Push to GitHub** (tab, `schemaPush.ts`) and **Settings → Schema Management → Schema passphrase — encrypted synchronization** (`schemaPassphraseAdmin.ts`). The shared logic is **kept** because it is still used and tested: `SyncService.push()` (read-back verification, `PushOptions`), `publishPlan()`, the encrypted pull, `schemaCrypto`, `SchemaPassphraseStore`, and *Sync with GitHub Now* (which publishes encrypted when a passphrase is saved on the device, plain otherwise).
* **Consequence to be aware of:** with both UIs gone, an administrator can no longer *start* encrypted publication or rotate the schema passphrase from the interface. Devices that already have a saved passphrase (saved by a successful *Pull Schema*) keep synchronizing encrypted. Re-adding a push action is a small change on top of the retained logic if you need it.

#### Files modified and why
| File | Reason |
|---|---|
| `src/v17/services/repositoryDefaults.ts` (new) | One central place for the fixed repository location, the default passphrase and `withLockedLocation()` |
| `src/ui/pages/schemaRepoCards.ts` (new) | Card 1 and Card 2 (moved handlers; Admin Password for the token; busy flag; hidden message) |
| `src/ui/pages/schemaPull.ts` | Pull Schema tab = repository card + schema pull + vault card (three independent mounts); help text and pointers now lead to the card on the same page |
| `src/ui/pages/settings.ts` | Secret Vault tab reduced to *Push Secret Vault to Repository* (+ note); *Schema passphrase* card and its wiring removed from Schema Management; the vault file path is saved before a push |
| `src/ui/pages/other.ts` | *Push to GitHub* tab and deep link removed; About lists 17.5.4 |
| `src/ui/context.ts` | applies the fixed location to the secrets all synchronization reads |
| `src/ui/components/tourOverlay.ts`, `src/v17/sync/syncService.ts`, `src/v17/services/knowledgeSync.ts`, `src/v17/services/adminMessage.ts`, `src/v17/services/secretVault.ts` | messages that pointed to *Settings → Secret Vault* / *Push to GitHub* now point to the new location (no logic change) |
| `src/ui/pages/schemaPush.ts`, `src/ui/pages/schemaPassphraseAdmin.ts` (deleted) | removed features; no remaining reference |
| `src/v17/sync/schemaFormat.ts`, `src/v17/engines/nluEngine.ts`, `package.json` | version 17.5.3 → 17.5.4 (footer, About, writer stamp, `version.json`, NLU label) |
| `public/styles.css` | the V17.5.3 rule for the removed tab replaced by one rule for read-only fields |
| `test/v1754.test.mjs` (new), `test/sync.test.mjs`, `test/v1753.test.mjs` | 6 new Node tests; two version assertions updated |
| `scripts/browser_test_v1754.py` (new) | 47 real-browser checks of the relocated cards |
| `scripts/browser_test.py`, `browser_test_v174.py`, `browser_test_v175.py`, `browser_test_v1751.py`, `browser_test_v1752.py` | updated for the relocated UI (see REGRESSION_BASELINE_V17.5.3.md) |
| `scripts/browser_test_v1753.py` (deleted) | it tested only the removed Push tab; the publish logic keeps its Node tests (`test/v1753.test.mjs`, 10) |

#### Security (details in SECURITY.md)
* **The default Vault Sync Passphrase is part of the application's JavaScript.** Anyone who can load SQL Assistant can read it (it is in `dist/index.html`). It protects the encrypted vault file only against people who cannot also read the repository. It is defined in one place; set `DEFAULT_VAULT_PASSPHRASE` to `''` to stop pre-filling it, and rotate it (push a vault with a new passphrase) if it may have been exposed. It never appears in rendered markup, browser storage, logs, the repository or the documents.
* No token is shown, logged or written to the repository; the vault file in the repository contains no token or passphrase (tested, including Base64 forms).

#### Compatibility
No migration. Existing schemas, learned data, vaults, passphrases and settings are read as they are. Version 17.5.3 → 17.5.4.
