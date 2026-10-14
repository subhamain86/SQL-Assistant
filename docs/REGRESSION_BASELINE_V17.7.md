# Regression baseline — V17.7

Everything below is unchanged from V17.6.9 and is protected by the existing suites (all 291 V17.6.9 Node tests are still present; the five that encoded the old function name, the main.ts hook, the 17.6 version shape or the pinned 17.6.9 stamps were updated to the V17.7 locations — see `CHANGELOG_V17.7.md`).

Preserved: centralized synchronization · navbar Sync · schema management and synchronization · Pull Schema · Secret Vault and published-copy retrieval · knowledge synchronization · admin messages · SQL generation · Manual Selectors · CASE / DECODE · Change Request SQL · filters · Advanced Options · offline NLU · self-learning · Admin Query Library · AI/LLM integration · repository / central access service / device-flow behaviour · published-data retrieval · security validation · deployment targets · the Admin Password record format, storage keys and paths.

UI: `public/styles.css`, `public/favicon.svg` and the `src/ui` modules recorded in `test/fixtures/ui-baseline-v1768.json` are byte-identical to V17.6.8 (and therefore to V17.6.9); enforced by `test/v1769.test.mjs`. Changed in V17.7: only the version-history entry on the About page (`src/ui/pages/other.ts`). Responsive layout, navbar, Sync control, footer, modals, routes and Settings tabs untouched.

Toolchain: TypeScript 5.8.3 exactly; `strict` unchanged; production compilation from `src/main.ts` only; the test build compiles `src/main.ts` + `src/testHooks.ts` with the same options.
