# Regression baseline — V17.7.1

The baseline is **V17.7.0, reconstructed from the supplied source bundles** and tested unchanged before any edit (303 tests, 300 pass, 3 fail for a bundle reason — see `TEST_REPORT_V17.7.1.md`).

| Area | How it is protected | Result |
|---|---|---|
| UI (style sheet, favicon, Settings, repository / token / vault cards, builders, every component not listed) | SHA-256 of 31 files recorded from V17.7.0 before the change (`test/fixtures/ui-baseline-v177.json`); byte-identical except 6 listed modules | pass |
| Admin Password authority and Settings lock | unchanged code; all V17.6.5–V17.7 tests; browser: lock screen, wrong password, forced flag | pass |
| GitHub client, token handling, Secret Vault, broker, central access | unchanged files; V17.6.x tests | pass |
| Pull Schema / schema sync / knowledge sync | unchanged services; tab pull still authorizes then `pullSchema()`; browser: tab unchanged, Home pull | pass |
| Admin Query Library | `adminLibrary.ts` service untouched; browser: Add / Export / Import / Sync / Test / Enable / Delete still present; approved submission behaves as an ordinary entry | pass |
| SQL generation, Manual Selectors, Advanced Options, CR builder, Error Rectifier | unchanged; browser regression section | pass |
| Storage keys and formats | no key or format read by V17.7.0 changed; 3 new keys (`sqla.querysubs.v1771`, `sqla.querysubssync.v1771`, `sqla.querysubmitter.v1771`) | pass |
| Repository paths and configuration | unchanged; one new file `…/knowledge/submissions.json` | pass |
| Publication | `publish-data.mjs` unchanged except it skips `knowledge/submissions.json` | pass |
