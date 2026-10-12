### SQL Assistant 17.5.5 — what changed

V17.5.5 is a targeted change of **V17.5.4** (`SQL-Assistant-V17.5.4.zip` is the baseline — see SOURCE_PROVENANCE.md; built and tested unchanged first: production build, 94/94 Node tests). UI design, file formats, encryption, storage keys and the repository paths are unchanged; no migration.

#### What was already true in V17.5.4 (kept, verified again)
Card 1 (GitHub repository) and Card 3 (Pull Secret Vault to Repository) already lived under **Hamburger → Schema → Pull Schema**; the repository / branch / schema path were fixed and read-only; the *Schema passphrase — encrypted synchronization* card and the *Push to GitHub* tab were already gone; *Push Secret Vault to Repository* was already the only push in Settings → Secret Vault; the default Vault Sync Passphrase was already pre-filled (masked). These were re-tested (see TEST_REPORT_V17.5.5.md); they were **not** rebuilt.

#### New in V17.5.5
| Requirement | V17.5.4 | V17.5.5 |
|---|---|---|
| Repository values **hidden by default**, explicit reveal / hide button, read-only even when revealed | values visible; only a details message was hidden | the three values **and** the details message are hidden behind one **Show configuration / Hide configuration** button (`aria-expanded`); hidden again every time the page is shown; the three fields stay `readonly` when revealed; the toggle never reads or writes saved data (browser storage is byte-identical before and after) |
| Nothing on the page may show the hidden values | repository name and file path were also printed in the status block | the Pull Schema card's status block shows *"GitHub repository connected · token saved"* and no path; error messages contain no repository name or path |
| **Pull Schema from GitHub = the Pull Schema button only**, no passphrase field or passphrase UI | passphrase field, eye button, "Remember" checkbox, "Remove saved passphrase", 8-step list, Vault-passphrase chip and Vault-Sync-Passphrase paragraph | **one button**. Short 3-step instructions, a status line, the button, the result. No input, no eye button, no passphrase wording in the card (tested) |
| One click retrieves **and synchronizes** | pull ⇒ comparison table ⇒ *Apply* ⇒ result | one click calls `SyncService.pullSchema()` — the existing validated, transactional pull — and shows the result |
| Version | 17.5.4 | **17.5.5** (footer, About, writer stamp, `version.json`, NLU label) |

##### How the passphrase-free Pull Schema works (and why the security validation is not bypassed)
`pullSchema()` = `doPull({ versionAware, forceActivate, detectEncryptedTwin })` — the same code *Sync with GitHub Now* uses to pull, with the Pull-Schema rules of V17.5: it reads **one** file (the configured schema path), validates it (format, version, tables, columns, data types, relationships, CASE/DECODE, required metadata), applies it in one validated registry write that is rolled back on failure, activates the repository's active schema, never replaces a newer local copy ("…older than the current local schema and was not applied"), turns a change on both sides into a **conflict** (never an overwrite), and reports success only when everything was applied — otherwise *"Schema pull completed only partly."*
* **Plain file (the default).** The configured path is a plain `registry.json`; no passphrase is involved.
* **Protected file.** A passphrase is needed only if the repository file is encrypted. The decryption requirement is **not bypassed**: it is opened only with a Vault passphrase **already saved on this device** (earlier versions saved one after a successful pull), and a file that cannot be opened is **reported, not treated as missing**:
  * encrypted file in the repository, no passphrase saved here → *"The repository file is passphrase-protected…"* with the next step;
  * saved passphrase does not open it → *"The Vault passphrase saved on this device does not open the repository file."*;
  * the default Secret Vault passphrase is **never** used for schemas (tested with a file encrypted under it).
* **Consequences you should know** (also in *Limitations*): the schema file published by *Sync with GitHub Now* is **plain** unless that device already has a saved passphrase; and with the passphrase UI gone there is no screen to set, change or remove a Vault passphrase.

##### Defect found and fixed during testing
A **successful** pull replaces the schema registry, which makes the page re-render while the pull is still finishing. The first draft then updated the old (detached) card, leaving the new one stuck on *"Retrieving…"* with a disabled button. The card is now always looked up again after the await (`liveHost()`); the browser tests cover it (a real successful pull from a second device).

##### Repeated clicks
Two independent guards: the button is disabled synchronously and `pull()` ignores re-entry; the service additionally serializes (`exclusive`). Tested: six clicks in one instant and a double click each cause exactly **one** read of the schema file and no write. With both guards removed the tests fail (mutation check).

#### Files modified and why
| File | Reason |
|---|---|
| `src/ui/pages/schemaPull.ts` | rewritten: the Pull Schema card is a single button (no passphrase UI); result / error messages; keeps the three-mount page structure |
| `src/ui/pages/schemaRepoCards.ts` | Card 1: values + details behind one Show / Hide configuration button, hidden by default, read-only; wording |
| `src/ui/components/syncStatus.ts` | options `passphrase` / `location` (default true — Settings → Schema Management is unchanged) so the Pull card can omit the passphrase chip and the repository name / path |
| `src/v17/sync/syncService.ts` | `pullSchema()`; `detectEncryptedTwin`; typed error kinds `incompatible` / `storage` / `location`, `config` and `validation` kinds on the pull's non-read failures. `previewEncryptedPull` / `applyPreview` are kept (Node-tested) but no longer used by the UI |
| `src/ui/pages/other.ts`, `src/v17/sync/schemaFormat.ts`, `src/v17/engines/nluEngine.ts`, `package.json` | About entry; version 17.5.5 |
| `test/v1755.test.mjs` (new), `test/sync.test.mjs`, `test/v1753.test.mjs`, `test/v1754.test.mjs` | 8 new Node tests; version assertions |
| `scripts/browser_test_v1755.py` (new) | 75 real-browser checks |
| `scripts/browser_test_v1754.py`, `…v1752.py`, `…v175.py`, `…v1751.py`, `browser_test.py` | updated for the hidden configuration and the one-click pull (see REGRESSION_BASELINE_V17.5.4.md) |
| docs | CHANGELOG, TEST_REPORT, REGRESSION_BASELINE, SECURITY, PULL_SCHEMA, DEPLOYMENT, SOURCE_PROVENANCE, README |

**Not changed** (no file modified): SQL generation, query building, schema import, spreadsheet handling, Manual Selectors, Advanced Options, the walkthrough, Settings → Secret Vault (Push), the Secret Vault format and handlers, `repositoryDefaults.ts`.

#### Security (details in SECURITY.md)
Hiding the configuration is a presentation choice, **not a security boundary**: the values are in the application's JavaScript and are not secrets. The default Vault Sync Passphrase is unchanged from V17.5.4 (single constant, only used by Card 3, masked, never in markup / storage / logs / repository). No token anywhere in the source or bundle.
