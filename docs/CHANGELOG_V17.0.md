# V17.0 — Offline self-training NLU, Advanced Options automation, safe schema record editing, encrypted vault sync, AI / LLM Model

**Baseline:** V16.5 (UI and behaviour baseline). **Type:** incremental upgrade, not a rewrite.
Everything in V16.5 stays: navigation, pages, cards, Manual Selectors, every Advanced Option, the CR builder, Error Rectifier, schema import/sync, GitHub sync, M365 Copilot integration, the local Secret Vault, the V16.2 empty-error-container pattern and responsive layout. UI changes are limited to what each requirement needs (listed below).

## 1. Describe What You Need — offline, self-training NLU (`src/v17/engines/nluEngine.ts`)
- Runs entirely in the browser; no external endpoint is needed for SQL generation.
- Grounded only in the **current Active Schema**: tables, columns, labels, descriptions, data types, decode values, relationships, and foreign keys declared on columns. The schema context is cached by a content fingerprint, so any edit, delete, import or sync rebuilds it automatically.
- The V16 parser still runs first and is the starting point. V17 then re-validates and extends it:
  - word-boundary matching (fixes V16 false positives such as `PO` inside "posting")
  - aggregation (COUNT / COUNT DISTINCT / SUM / AVG / MIN / MAX), GROUP BY (entity, column, month/year), HAVING, ranking ("top 5 vendors by total amount")
  - conditions: comparisons, BETWEEN, LIKE (contains / starts / ends), IS [NOT] NULL, IN / NOT IN, negation ("not paid", "unpaid"), several values on one column merged into IN, and "invoice 336445" read as a primary-key match
  - date filtering: explicit dates, ranges, months, years, and relative periods, using dialect-aware SQL for Oracle, SQL Server, MySQL, PostgreSQL and Generic
  - sorting ("latest", "highest", "sorted by … desc"), DISTINCT, and result limits
- If you name a table or column that isn't in the Active Schema (for example `VENDOR_CODE`), you get a *Table/Column not found* error and the name is not added to the SQL.
- **Controlled learning** (`src/v17/services/learningStore.ts`) records the request, generated SQL, user-modified SQL, final accepted SQL, tables/columns used and the query options. Safeguards:
  - A one-off query is never used. A pattern is only used once it has been repeated or confirmed ("Accept & Learn").
  - Learned patterns are used only as hints. They never change the schema or the engine logic.
  - Every hint is checked again against the Active Schema each time it's used.
  - Accepted SQL must pass the read-only check and the Active Schema check.
  - Cross-device sync goes to `sql-assistant-data/learning/query-knowledge.json`. It uses per-device counters, so repeated syncs don't inflate counts, and literals are masked by default.

## 2. Manual Selectors → Advanced Options
- All existing options and controls are unchanged.
- An information strip is added above them. It lists what the description engine applied automatically (with confidence) and which options are under manual control.
- Editing any existing control (DISTINCT, GROUP BY, HAVING, LIMIT, RECURSIVE, CTE) marks it as manual. A later description never overwrites a manual setting. Choose "use automatic" to hand control back.
- New consistency checks: aggregates without a full GROUP BY, HAVING without aggregation, RECURSIVE without a CTE, and DISTINCT combined with an unselected ORDER BY column.

## 3. Settings → Manual Schema Update (`src/v17/engines/schemaRecordEngine.ts`)
- Edit, Save and Delete each act on one record only. The rest of the schema is deep-equal before and after (covered by tests).
- Records are validated before saving: identifiers, a recognisable data type, length/precision, foreign-key targets, duplicate columns and duplicate decode values.
- Renaming a referenced column updates its relationships and FK references, and lists each change.
- Moving a referenced column to another table, or deleting it, is **blocked** with a list of the dependent records. Unlinking those dependents needs an explicit confirmation.
- Changes persist to the centralized registry (the same storage and automatic GitHub sync path as V16.5) and are version-stamped. They survive a restart, and the active schema / SQL refresh immediately. If the browser storage write fails, the change is rolled back and the reason is shown.
- The editor keeps a record's real-world data type (for example VARCHAR2) instead of silently switching it to VARCHAR.

## 4. Settings → Secret Vault → Push Secret Vault to Repository (`src/v17/services/vaultSyncService.ts`)
- Encryption is AES-256-GCM. The key is derived with PBKDF2-SHA-256 (600,000 iterations, random salt) from a separate **Vault Sync Passphrase** (at least 12 characters, at least 3 character classes, and different from the Admin Password). The passphrase is never written to the repository.
- The encrypted file is written to `sql-assistant-data/vault/secret-vault.v17.enc.json`. Before every write, a plaintext/base64 leak check runs.
- Pushing is an explicit button press. The V16 implicit auto-push after saving vault settings is disabled.
- Pull & decrypt, Export encrypted file and Import encrypted file are added. The last two cover private repositories on a brand-new device.
- Wrong passphrase, tampering, unsafe KDF parameters and repository errors are reported with specific messages. Secrets are redacted from every message.
- The local Secret Vault (unlocked with the Admin Password) is unchanged.

## 5. Online AI/NLP Endpoint → AI / LLM Model (`src/v17/services/llmService.ts`)
- Settings: provider (OpenAI-compatible, Azure OpenAI, Anthropic, or Custom endpoint using the V16 contract), endpoint, API key, model name, Azure deployment/api-version, temperature, max tokens, timeout, when to use the model, and an enable/disable switch.
- The API key is stored only in the encrypted Secret Vault. It is never shown, logged or written to localStorage.
- A V16 Online AI/NLP Endpoint is migrated automatically to a "Custom endpoint" model.
- Flow: offline NLU, then learned hints, then the optional model, then validation, then presentation, then learning. Model SQL is used only if it is a single read-only statement that references only Active Schema tables and columns. Otherwise it is discarded with an explanation and the offline result stays in place.

## 6. Active schema awareness
- Every V17 generation path reads `schemaService.getActiveSchema()` at call time. Cached results are discarded when the schema fingerprint changes.

## 7. Error handling
- Errors are specific and coded (`src/v17/errors/appErrors.ts`): active schema unavailable, table/column not found, invalid schema record, dependency blocked, schema update failed, schema/repository sync failed, encryption/decryption failed, AI/LLM configuration invalid, AI/LLM request failed or response rejected, offline model unable to process the request, and no join path between tables.
- Error containers stay empty when there is no error, as in V16.2.

## Baseline defects found and fixed while upgrading
- **Relative-date filters were rendered as quoted strings.** In the V16.2 source, `filterEngine.quoteIfNeeded()` quoted values such as `CURRENT_DATE - INTERVAL '30 DAY'`. V17 lets only an exact whitelist of generated date expressions through unquoted; user values are still quoted.
- **Joins ignored FK metadata.** Tables linked only by a column-level foreign key got no JOIN. V17 derives these relationships for join planning only; the stored schema is not modified.
- **Deleting a column could leave dangling relationships.** V17 blocks this, or asks before unlinking.
- **Editing a non-standard type changed it to VARCHAR.** V17 keeps the original type.
