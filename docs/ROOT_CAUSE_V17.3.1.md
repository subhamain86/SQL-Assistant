# V17.3.1: root cause analysis

## 1. Schema synchronization

### Where each version failed
| Version | What failed in the pipeline | Why the earlier fix did not hold |
|---|---|---|
| V16.x / V17.0 | Publish wrote schemas **without validating them**. Dangling foreign keys and `{code,label}` decode entries entered the repository. | V17.1 added a publish gate, but V17.0 copies still in use kept publishing. |
| V17.1 / V17.2 | **Parse/normalise:** the decode raw value was taken from the first *present* key, so `rawValue: ""` next to the real `code` produced *"decode entry (#n) with an empty raw value … and 434 more"*. | The schema was rejected, so it was never rewritten, and the error came back on every sync. |
| V17.2.1 (package) | Fixed the reader, but changed the **storage key** (`sqla.schemaRegistry.v15`), the **repository path** (`schemas/schema-registry.json`) and the GitHub settings layout (`owner/repo` in one field). | Upgraded devices synchronized against a different (empty) file. The real file with AP schema 77 was never migrated, so V17.2 devices kept reporting the same error. |
| V17.3 (package) | Restored the key and path. However, the lossless `code` rule still applied only to files without a writer stamp. | A V17.1 or V17.2 device that re-published the mangled entries in a **stamped** file still failed. |

### Fixes in V17.3.1, by pipeline stage
- **Persistence (local)**
  - Uses the V15–V17.2 key `sqla.registry.v15`.
  - Data found under the key used by V17.2.1–V17.3 is merged back in.
  - A corrupt registry is backed up to `sqla.registry.v15.corrupt-<time>`.
  - Invalid entries are listed in `sqla.registry.quarantine.v17`.
- **Location**
  - The V17.2 GitHub settings (owner, repository, branch, path) are restored. The V17.2.1 `owner/repo` form is also accepted.
  - The default path is `sql-assistant-data/schemas/registry.json`.
  - The wrong path written by the packages is corrected automatically.
  - If the configured file is missing but a known path holds one, sync stops with stage **Remote file location** and names that path. It does not create a second file.
- **Download:** `cache: 'no-store'`. Files over 1 MB are read through the blob API.
- **Parse:** a byte-order mark (BOM), an HTML sign-in page, invalid JSON and a newer format are each reported with their stage.
- **Format detection:** a file without a writer stamp is treated as **legacy** and goes through migration. It is never rejected for the missing stamp alone.
- **Migration / normalisation:**
  - **L1** (lossless): the first *non-empty* value of `rawValue`, `raw`, `value`, `code`, `key` or `id`. Applies to **every** file.
  - **L2–L6**: apply to legacy files only.
- **Validation:** unchanged and strict. Every error gives the schema, table, column, array index, property and reason.
- **Merge:** each schema is handled independently (3-way merge). An invalid remote schema never replaces a valid local copy, and the Active Schema is kept.
- **Publish:**
  - The publish gate validates every schema first.
  - Every publish carries the writer stamp `SQL Assistant 17.3.1` and format 2.
  - Untouched built-in starter schemas are not pushed.
  - Publishing is postponed if it would delete unreadable repository schemas. **Publish my local copies** replaces them deliberately.
- **Idempotence:** content hashes ignore volatile metadata. Sync #2 and #3 and a restart are all "Up to date" (tested).

### What an empty decode value means
| Case | Meaning | Rule |
|---|---|---|
| `rawValue: ""` next to `code`/`value`/`key` | Serialization defect in older writers | **L1**: use the non-empty value (nothing is lost) |
| Raw value and label both empty | Placeholder row | **L2**: removed (legacy files only) and reported |
| Label present, code missing everywhere | Incomplete export | **L3**: label kept in `unmappedDecodeLabels`, never used in SQL, never invented. It can be restored with **Recover decode codes** or a row edit. |
| Exact duplicate entry | Export defect | **L4**: removed and reported |
| Empty string or NULL as a meaningful mapping | Not supported by this model (NULL uses an *Is empty* filter) | Remains a validation error |

## 2. Blank index page
| Cause | V17.2 (good) | V17.2.1 (broken) | V17.3.1 |
|---|---|---|---|
| Entry page | Deploy `dist/index.html`: one self-contained page | The project-root `index.html` loaded `/src/main.ts`. Browsers cannot run TypeScript, so the page stayed blank (reproduced in the browser test). | The build writes the same self-contained app to `dist/index.html`, the root `index.html` and `release/`. The build fails if a page references `src/`, a module script or a CDN. |
| Scripts | Inline | Module script, blocked on `file://` | Inline classic scripts, allowed by CSP hashes |
| Start-up | Services ran before the UI | A start-up error left the page empty | The markup renders first, then services start. A sync failure is shown in Schema Management and never blocks start-up. If start-up itself fails, the page shows "SQL Assistant could not start" with the error. |
| Routing | Views switched with `data-view` | n/a | The same views, plus hash routes (`#builder`, `#settings/vault`). These work at `/`, under `/<repo>/` (GitHub Pages), on `file://`, on refresh and with direct links. `404.html` serves deep links. |
| Assets | Inline stylesheet and favicon | n/a | The V17.2 stylesheet, icons (inline SVG) and favicon are inlined into the single page. Nothing is fetched from outside, so there are no 404s for assets. |
