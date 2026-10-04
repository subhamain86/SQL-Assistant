# Changelog

## 17.2.1
### Fixed — schema synchronization of schemas written by V17.0 or older
* Root cause: legacy files store decode entries as `{code, label}` (and old devices could write an empty
  `rawValue` beside `code`); the reader took the first *present* key, so every entry looked empty
  ("decode entry (#1) with an empty raw value … and 434 more") and the whole schema was rejected forever.
* New per-schema pipeline: detect writer stamp → migrate legacy representation (explicit rules L1–L6) →
  strict validation (unchanged) → persist → republish with the current writer stamp. No migration loop.
* AP schema 77: all 437 decode entries, 77 tables and 1,561 columns preserved.
* Legacy foreign keys to tables outside the schema are kept as documentation (`unresolvedReference`).
* Lost decode codes (label only) are preserved as `unmappedDecodeLabels`; *Recover decode codes from
  source file* restores them from the original export.
* Each repository schema is processed independently; invalid remote data never replaces a valid local schema;
  publishing is postponed when it would delete unreadable repository schemas.
### Added
* Schema Management statuses: Current, Legacy, Migration required, Migration successful, Migration failed,
  Invalid, Migrated schema — with exact location/reason diagnostics.
* Writer metadata on publish: `formatVersion`, `writtenBy`, `writtenByDevice`, `writtenAt`.
* NLU: module-prefix aware table matching (e.g. `IA_INVOICE` ↔ "invoices"), decode-value vs table
  disambiguation, HAVING-count inference, country-name → ISO code filters, safer date-column choice.
### Changed
* Application name is **SQL Assistant** everywhere (title, header, metadata, package name, messages).
* "Online AI/NLP Endpoint" is now **AI/LLM Model** (provider, model, endpoint, API key, authentication,
  model-specific JSON). Old endpoint settings are migrated automatically.
