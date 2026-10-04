# V17.0 (summary)
- **Offline self-training NLU** for Describe What You Need: joins (including FK paths), conditions, dialect-aware dates, aggregation, GROUP BY/HAVING, sorting, DISTINCT and limits. Names not in the Active Schema are reported, never invented.
- **Controlled learning** (Accept & Learn): only repeated or confirmed patterns are used, always re-validated against the Active Schema.
- **Advanced Options:** every option kept; automatic options are listed and manual settings always win.
- **Manual Schema Update:** single-record edit/delete with dependency checks.
- **Push Secret Vault to Repository:** AES-256-GCM with a separate passphrase (see `SECURITY.md`).
- **AI/LLM Model** replaces the Online AI/NLP Endpoint (OpenAI-compatible, Azure OpenAI, Anthropic, custom). The key lives in the encrypted vault; model SQL is validated before use.
