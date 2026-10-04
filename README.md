# AP-SQL Assistant — V17.0 (deployable package)

**Deploy:** open or host **`dist/index.html`**. It is one self-contained file and works offline from disk (file://) or from any static host. See `docs/DEPLOYMENT.md`.

**Rebuild:** `npm install && npm run typecheck && npm test && npm run build` (see `docs/DEPLOYMENT.md`).

## What V17.0 adds (baseline V16.x)
- **Describe What You Need — offline, self-training NLU.**
  - Generates SQL from the Active Schema only: joins (including FK paths), conditions, dialect-aware dates, aggregation, GROUP BY / HAVING, sorting, DISTINCT and limits.
  - Learns from repeated or accepted queries (**Accept & Learn**). Learned patterns are re-validated against the schema each time and synchronized through the repository.
- **Advanced Options.** Every existing option is kept. The panel shows what was applied automatically; manual settings are never overwritten.
- **Manual Schema Update.**
  - Edit, save or delete exactly one record, saved to the central registry.
  - Dependency checks stop broken relationships.
  - Records are validated before saving, and a record's real data type is preserved when editing.
- **Secret Vault push.** Sends an AES-256-GCM encrypted copy to the repository, keyed by a separate Vault Sync Passphrase that is never stored in the repository. Pull, export and import are included. Pushing is an explicit action only.
- **AI / LLM Model.** Replaces the Online AI/NLP Endpoint and supports OpenAI-compatible, Azure OpenAI, Anthropic or a custom endpoint. The API key lives only in the encrypted vault. Model SQL is validated before it is used, and the offline engine always remains available.
- **Error messages.** Specific, coded messages; secrets are redacted from every message.
- **Carried forward:** V16.3 – V16.5 fixes (GitHub timeout, Active Schema sync across devices) and all V16 features.

## Layout
| Path | Contents |
|---|---|
| `dist/index.html` | **The application** (deploy this) |
| `src/` | TypeScript source (`src/v17/` = V17 modules) |
| `scripts/` | `build.mjs`, `run-tests.mjs`, `smoke_test.py` |
| `test/` | Unit / integration tests |
| `docs/` | CHANGELOG_V17.0, DEPLOYMENT, TEST_REPORT_V17.0, SOURCE_PROVENANCE, screenshots |

Please read `docs/SOURCE_PROVENANCE.md`. The page markup was rebuilt because the V16.5 source files could not be opened.
