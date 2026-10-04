# V17.1 — Schema synchronization stability release

**Baseline:** V17.0. **Type:** stability and reliability release. No features were removed and there was no UI redesign. See `ROOT_CAUSE_V17.1.md` for the investigation.

## Fixed
- **"Schema synchronization failed: the remote schema file failed validation"** — root cause fixed (see `ROOT_CAUSE_V17.1.md`):
  - Push now validates first (publish gate).
  - Remote data is normalised before it is validated.
  - Each schema in the repository file is judged on its own, and the reason is reported precisely.
- **Large schema files (> 1 MB)** now download through GitHub's raw-content path. Before, they arrived empty.
- **A corrupted local registry** is backed up (`sqla.registry.v15.corrupt-<time>`) instead of being silently overwritten. Unreadable entries are kept aside (`sqla.registry.quarantine.v17`).
- **Remote updates reach other devices.** An existing schema with no unsynced local edits is fast-forwarded to the newer valid repository copy. Schemas with local edits still go through Conflict Management, as before.
- **Conflict detection** now also notices relationship changes.
- **"Use Remote"** re-validates the stored remote copy before applying it.
- **Schema Management keeps push/pull/validation results visible** after the redraw the sync triggers. The "Advanced" section stays open.
- **Manual Schema Update:**
  - Legacy names (e.g. created by V16 with spaces) and real-world data types can be edited.
  - A legacy problem elsewhere in the schema no longer blocks unrelated edits.
  - Changes that *introduce* a new error are still blocked.
- **Relationships pointing at deleted columns** are ignored for JOINs (reported as warnings), so SQL never joins on a missing column.
- **Offline NLU:** a single word that is a business value of an in-scope column (e.g. "active contracts") is treated as a condition, not as a column of an unrelated table.
- **Describe What You Need** no longer stays stuck on "Processing…" if the engine throws.
- **Schema page** table list refreshes after a background sync.
- **GitHub messages** now distinguish:
  - invalid/expired token (401)
  - missing read or write permission (403)
  - rate limit (403 + `x-ratelimit-remaining: 0`)
  - repository or branch not found
  - 5xx errors
  - timeouts
  - non-JSON proxy pages
  - corrupted base64
  - non-UTF-8 content

## Added (minimal UI, shown only when needed)
- **Settings → Schema Management → schema health panel.** Renders nothing unless:
  - a local schema is invalid,
  - a repository schema was rejected, or
  - local data had to be set aside on load.

  It offers Repair… (with a preview of every change), Restore from repository, Review repaired repository copy, Publish my local copies, and Download repository file.
- **"Validate repository file"** button inside the existing *Advanced: manual push/pull* section.
- **Import** shows which legacy conversions were applied.
- **`npm run diagnose -- <file|url> [--repair-out fixed.json]`** runs the app's own validator from the command line.
- **`npm run clean`** and **`npm run verify`** (clean → typecheck → test → build), plus `scripts/check-imports.mjs` (unresolved imports, import cycles, duplicate exports).

## Format and compatibility
- **Read:** V15 bare lists, single-schema files, wrapped registries, V16.x and V17.0 registries, and V17.1 registries.
- **Legacy conversions** (lossless and reported):
  - `dataType` / `data_type` → `type`
  - map-shaped tables and columns → lists
  - text/number flags (`"Y"`, `"true"`, `1`) → booleans
  - numeric text → numbers
  - decode maps or `"A=Active;I=Inactive"` text → decode lists
  - `"TABLE.COLUMN"` references → `{table, column}`
  - missing module, label, kind or relationship id → filled in
  - a UTF-8 byte-order mark → removed
- **Written:** the same `schemas` list plus `formatVersion: 2` and `writtenBy`. V17.0 devices ignore these extra fields and can still read the file. A file from a *newer* format is refused with a clear "update this device" message.

## Unchanged
Layout, navigation, cards, buttons, tabs, menus and labels. Also: SQL generation, Manual Selectors, Advanced Options, offline NLU, learning, AI / LLM Model, Secret Vault (including encrypted push), M365 Copilot, CR builder, Error Rectifier, import/export, themes, walkthrough, and responsive behaviour.
