# V17.1 — Root cause of "Schema synchronization failed: the remote schema file failed validation"

## Summary
Validation itself was correct. The failure came from an **asymmetry in the synchronization pipeline**:

- Schema data was **published to the repository without being validated**.
- The same data was **validated strictly when it was read back**.

Any invalid record that reached the repository therefore made synchronization fail on *every* device, including the one that published it. One invalid schema blocked the whole file, and the message did not say which record was wrong.

The invalid records were created by the **V16.x Manual Schema Update "Delete"**. It removed a column (and a table left empty) **without checking dependencies**. Foreign keys and relationships that pointed at the deleted column were left behind ("dangling" references).

## How it happened, step by step

| # | Stage | What happened (V16.x – V17.0) | File / function |
|---|---|---|---|
| 1 | Manual Schema Update → Delete | Removed the column without checking whether other columns referenced it. Example: deleting `VENDOR.VENDOR_ID` left `INVOICE_HEADER.VENDOR_ID` and `PO_HEADER.VENDOR_ID` as foreign keys to a column that no longer exists. Deleting the last column of a table removed the table, leaving FKs to a missing table. | V16.2 `schemaService.deleteRow` |
| 2 | Local storage | The broken schema was saved. Local data was never re-validated, so the app kept working on that device. | `schemaService.persist` |
| 3 | Automatic sync → push | `autoSyncService` pushed the whole registry. **`pushRegistryToGitHub` did not validate.** The invalid data was published. | `syncService.pushRegistryToGitHub` |
| 4 | Pull / public discovery on any device | `validateIncomingRegistryFile` rejected the file because a foreign key referenced a missing table/column. This rule has been an *error* since V16.1. | `syncService.pullRegistryFromGitHub`, `discoverPublicRegistry` |
| 5 | Result | One invalid schema rejected the **whole file**. Discovery reported only *"the remote schema file failed validation"*. Re-pushing published the same invalid data again, so the error never went away. | `syncService` |

**Contributing defects** found while tracing the full pipeline (all fixed in V17.1):

| Defect | Effect |
|---|---|
| Remote data was validated **before** normalisation (`sanitizeIncomingSchema` ran afterwards). | Harmless legacy differences (e.g. pre-V16 `dataType` instead of `type`, flags stored as `"Y"`/`"N"`) were reported as errors instead of being converted. |
| Files > 1 MB: the GitHub Contents API returns `content: ""` / `encoding: "none"`. | A large schema arrived as an empty string and failed as invalid JSON. |
| Corrupted local registry JSON was silently replaced by the defaults. | The next save destroyed the original data. |
| Remote updates to an existing schema were always parked as "conflicts", and public discovery dropped them. | Other devices never received updates automatically. |
| Conflict detection ignored relationship-only changes. | Such changes never propagated. |
| Results in Schema Management were wiped by the redraw that the sync itself triggered. | The user never saw the push/pull outcome. |
| Manual Schema Update re-validated identifier formats on unchanged legacy names, and blocked any edit while an unrelated legacy problem existed elsewhere in the schema. | Users could not fix the data from the UI. |
| Offline NLU took a single word that is a business value (e.g. *active*) as a column of an unrelated table. | Wrong JOIN and a missing condition. |

## What V17.1 changes (validation stays fully enabled)

1. **One rule set** (`src/v17/sync/schemaFormat.ts`) for local load, import, Manual Schema Update, push, pull, discovery, conflict resolution and the CLI.
2. **Publish gate.** Push validates every local schema first. It refuses to publish invalid data, naming the record, its JSON path and the cause.
3. **Normalise, then validate.** Only *lossless* legacy conversions are applied, and each one is reported. Nothing is guessed, and no record is deleted.
4. **Per-schema verdict.**
   - Valid schemas in the file load normally.
   - Invalid ones are rejected individually with exact paths.
   - **A local copy is never overwritten by invalid remote data.**
5. **Explicit recovery** (Settings → Schema Management, only shown when needed):
   - Repair a local schema. The preview lists every change; FKs are unlinked but columns are kept, and only dangling relationships are removed.
   - Restore from the repository (offered as a conflict to confirm).
   - Review a repaired remote copy (offered as a conflict to confirm).
   - Publish valid local copies.
   - Download the repository file.
   - Validate the repository file.
6. **File-level diagnostics.** Specific messages for: empty file, HTML page, Git LFS pointer, merge-conflict markers, JSON syntax (with line/column and likely cause), a newer format, and "not a registry".
7. **CLI:** `npm run diagnose -- <file|url> [--repair-out fixed.json]` runs the exact same validator outside the browser.

## How to recover an affected repository
1. Install V17.1 on the device that has the most complete schemas, unlock Settings and open **Schema Management**.
2. If a local schema is listed as invalid, press **Repair…**, review the listed changes, and apply. The repaired schema is published automatically.
   - If only the repository copy is invalid, press **Publish my local copies**.
3. On every other device, press **Sync with GitHub Now**. The repository is valid again, so the error clears.

Alternative: run `npm run diagnose -- registry.json --repair-out fixed.json`, review `fixed.json`, and commit it.

**Confirming this cause on your data:** I could not read your repository from here. The cause above is reproduced by the automated tests with data exactly as V16.x wrote it, but please confirm it against your actual file. **Validate repository file**, or the CLI, will show the exact record and path for your repository.
