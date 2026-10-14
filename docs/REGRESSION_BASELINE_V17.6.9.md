# Regression baseline — V17.6.9

Everything below is unchanged from V17.6.8 and is protected by the existing suites (all 266 baseline Node tests are still present; the V17.6.8 tests that encoded the provisional default were rewritten to the V17.6.9 policy, see `CHANGELOG_V17.6.9.md`).

Preserved: centralized synchronization · navbar Sync (Synced / Partly synced / Skipped / Sync failed) · schema management and synchronization · Secret Vault and published-copy retrieval · SQL generation · Manual Selectors · CASE / DECODE · Change Request SQL · offline NLU · AI/LLM integration · Admin Query Library · learning tiers · knowledge synchronization · admin messages · repository broker and device flow · published read-only data · settings · responsive layouts · GitHub Pages / IIS / Azure Static Web Apps outputs.

UI: `public/styles.css`, `public/favicon.svg` and 27 of the 29 `src/ui` modules are byte-identical to V17.6.8 (hashes in `test/fixtures/ui-baseline-v1768.json`, enforced by `test/v1769.test.mjs`). `settings.ts` changed only in the lock-screen hint and the removed provisional-default toast; `other.ts` only in the version history.
