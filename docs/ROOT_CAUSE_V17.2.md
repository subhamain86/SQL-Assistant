# V17.2 — Why "Schema synchronization failed: the remote schema file failed validation" kept coming back

## Summary
V17.1 fixed the original source of invalid data: schemas were published without validation and then rejected by every other device. The error could still reappear for four reasons. None of them is a validation rule; they are problems in **which file**, **which copy**, and **how it was merged**.

| # | Root cause | Effect | V17.2 fix |
|---|---|---|---|
| 1 | **Stale copies of the repository file.** GitHub Contents API responses are cacheable for 60 s, and the browser was allowed to serve them from its HTTP cache. | Right after a repair was published, the next discovery could receive the **old, invalid** file and show the error again. Worse, the just-pushed schemas were marked as synced, so the device could fast-forward back to the old copy. | Every GitHub request uses `cache: 'no-store'`. Each device also remembers the file versions (shas) it has already replaced, and never applies such a copy again (`stale` result, logged). |
| 2 | **Discovery read the wrong location.** App-load/page-mount discovery always read the built-in default `repo / main / sql-assistant-data/schemas/registry.json`, while pushes went to the location configured in the Secret Vault. | If the location had ever been changed (branch or path), an old invalid file at the default path was re-validated on **every app start** and could never be fixed by publishing. | One location for discovery, pull, push and diagnostics: the configured location. The last configured repo/branch/path (not secret) is remembered, so even a locked device reads the right file. |
| 3 | **No merge base.** A device could not tell "remote is older than my edit" from "remote has newer changes". | Normal syncs produced false conflicts, or fast-forwarded over local edits. A device could re-publish data another device had just fixed. | Each schema stores a **base** (content hash at the last sync). 3-way rule: remote = local → nothing to do; remote = base → local is ahead (published next); local = base → fast-forward; both changed → conflict for the user. |
| 4 | **Races.** Pull, push and discovery could interleave. A push rejected by another device's write (409/422) stopped automatic sync. | Intermittent "paused" syncs and stale state after concurrent page mounts. | All sync operations are serialised. A rejected push recovers by itself: pull (3-way merge) → push again. Discovery is throttled (90 s) and de-duplicated. |

## Important: the exact error text comes from an old build
V17.1 and V17.2 never produce the wording *"the remote schema file failed validation"*.
- V17.1 reports *"N of M schema(s) in the repository failed validation …"* or *"the remote schema file could not be loaded — …"*.
- V17.2 adds the failing stage to those messages.

If that exact sentence is still shown somewhere, a **V17.0-or-older copy of the app is still running**: a cached tab, an old `index.html` on a share, or another device. Such a copy also publishes schemas **without** validation. V17.2 helps find it:
- **Rejected data names its writer.** A file without a writer stamp is reported as *"written by SQL Assistant V17.0 or older … a device that has not been updated"*. Newer files show the writer version and device id, plus the device and time of the schema's last edit.
- **Out-of-date copies are flagged.** If the repository file was written by a newer version than the running copy, it shows *"…newer than this copy … reload or install the latest version"*.
- **Settings → Schema Management → Validate repository file** shows the writer, this device's id, and every problem with its JSON path.

## Diagnostic messages now name the failing stage
| Stage | Example trigger |
|---|---|
| Remote file retrieval failed | network/proxy failure, timeout, 401/403/404/5xx |
| Remote file could not be parsed | empty file, HTML page, Git LFS pointer, merge markers, JSON syntax (line/column) |
| Schema structure is invalid | valid JSON that is not a schema registry |
| Schema version is unsupported | file written by a newer format |
| Required schema property is missing | schema without a `tables` list |
| Invalid table definition | missing/invalid table name, invalid objectType |
| Invalid column definition | missing type, dangling foreign key, bad decode list |
| Invalid relationship definition | incomplete relationship |
| Duplicate schema object | duplicate table, column or schema id |
| Schema normalization failed | unexpected data shape during conversion |
| Schema persistence failed | browser storage full while saving a synced schema |

## What was not changed
- **Validation is not relaxed.** Malformed remote data is still rejected, and a valid local copy is never overwritten by invalid remote data.
- **One correction to the rules:** decode raw values are now compared exactly, so `'a'` and `'A'` are different database codes. Exact duplicates are still rejected.

All four root causes are reproduced, and their fixes verified, in `test/v172.test.cjs` and in the browser test (`scripts/smoke_test.py`, "Stale copy of the old invalid file is ignored").
