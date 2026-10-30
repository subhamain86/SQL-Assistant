# Verification report — V17.7.2 against the requirements

| Requirement | Status | Evidence |
|---|---|---|
| Central, version-controlled configuration; admin save persisted in the repository | Implemented, tested on an emulated repository | `docs/CENTRAL_CONFIG.md`; browser E4–E6; unit "administrator saves …" |
| New machines initialise from the central configuration | Implemented, tested | browser E8–E10; unit |
| Existing machines synchronize | Implemented, tested | browser E12, E16 (Sync, Check for updated configuration); unit |
| Local settings never overwrite a newer central one; validated before save; failed sync does not corrupt | Implemented, tested | unit "hostile / transactional / first set-up / concurrent"; browser E13 |
| Error handling and logging | Implemented | local activity log; browser E14 |
| No secrets; credentials separate; existing authentication preserved; only authorized users write | Implemented, tested | unit security test; line-level pin of `schemaRepoCards.ts`; single repository builder; browser E6, E15 |
| Describe What You Need as separate hamburger options (Read Only / CR) with two cards each | Implemented, tested | browser A, C, D |
| Result card: formatting, copy, loading / success / error, regenerate; no misleading success | Implemented, tested | browser C4–C13, D |
| CR uses the CR / Active Schema, not Read Only's | Implemented, tested | browser D13; unit "never share an engine path" |
| Generated SQL directly below Manual Selectors in both builders; Manual Selectors preserved | Implemented, tested | browser B1–B7 |
| Root-cause review of NL SQL quality | Done | `docs/NL_SQL_ROOT_CAUSE_V17.7.2.md` |
| Error-log review | **Partly** — archives unreadable here | `docs/ERROR_LOG_REVIEW_V17.7.2.md` |
| UI preserved (style sheet, theme, components) | Verified except the favicon byte-check (placeholder) | UI baseline pins; screenshots |
| Complete release ZIP, screenshots, test results | ZIP is an **overlay on your V17.7.1 folder** (see `INSTALL.txt`); screenshots delivered | — |
| Live GitHub verification, older Python suites, cross-browser | **Not done** | `docs/TEST_REPORT_V17.7.2.md` |
