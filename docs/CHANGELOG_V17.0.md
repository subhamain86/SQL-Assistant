# V17.0 — Offline self-training NLU, Advanced Options automation, safe schema record editing, encrypted vault sync, AI / LLM Model

**Baseline:** V16.5. Incremental upgrade; no V16.5 feature was removed.

- **Describe What You Need — offline NLU** (`src/v17/engines/nluEngine.ts`)
  - Generates SQL from the Active Schema only: joins (including FK paths), conditions, dialect-aware dates, aggregation, GROUP BY/HAVING, sorting, DISTINCT and limits.
  - Names that are not in the schema are reported, never invented.
- **Controlled learning** (`src/v17/services/learningStore.ts`)
  - Only repeated or confirmed (**Accept & Learn**) patterns are used, always re-validated against the Active Schema.
  - Learned queries sync to the repository; literals can be masked.
- **Advanced Options:** every option kept. Automatically applied options are listed, and manual settings always win.
- **Manual Schema Update:** single-record edit/delete with dependency checks; persisted to the central registry.
- **Secret Vault push** (`src/v17/services/vaultSyncService.ts`)
  - AES-256-GCM, with the key derived (PBKDF2-SHA-256, 600k iterations) from a separate passphrase that is never stored in the repository.
  - Explicit push only; Pull, Export and Import included.
- **AI / LLM Model** replaces the Online AI/NLP Endpoint (OpenAI-compatible, Azure OpenAI, Anthropic, custom).
  - The key is stored only in the encrypted vault.
  - Model SQL is validated before use; offline remains primary.
- **Errors:** specific, coded messages; secrets are redacted from every message.
