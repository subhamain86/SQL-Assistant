### V17.6.4 working functionality (regression baseline for V17.6.5) and where it is protected

Identified **before** any change from `SQL-Assistant-V17.6.4.zip` (172 Node tests green). V17.6.5 changes the Admin Password mechanism and one Settings tab; everything else is unchanged.

| Area | V17.6.4 | V17.6.5 | Protected by |
|---|---|---|---|
| SQL generation, selectors, Advanced Options, CASE/DECODE, learning, Admin Query Library, AI/LLM, schema import / browsing, navigation, layout | working | **unchanged** | Node `features`, `v174`, `v175*`; `compare_v1765.py` (markup identical) |
| Styles | `public/styles.css` | **byte-identical** | `compare_v1765.py`, `cmp` |
| GitHub synchronization, Secret Vault, token-free retrieval, published copy, central access service, schema synchronization | working | unchanged — these modules do not reference the new service | Node `sync`, `features`, `v1754`–`v1763`, `v1765` (module-isolation test) |
| Admin Password primitives: default `admin`, V17.2 marker unlocks, change validation (current, ≥ 4 chars, not `admin`), reset | working | unchanged behaviour; marker key and format identical | Node `password`, `v1765` |
| Pages that must be markup-identical | — | Quick Start, both builders, Error Rectifier, Schema tabs, Settings (all tabs except Security), Pull Schema, Secret Vault, navbar, footer | `compare_v1765.py` |
| Pages that change intentionally | — | **About** (one new list entry), **Settings → Security** (status line + Reset panel) | `compare_v1765.py` (expected changed), `browser_test_v1765.py` |
| Workflows, build script, TypeScript pin | working | unchanged | Node `v1762`–`v1764` |

Intended changes to existing assertions (none weakened): version expectations 17.6.4 → 17.6.5 in `test/v1763.test.mjs` and the browser scripts; `test/v1764.test.mjs` version-stamp test replaced by an About-history test (the stamps moved to `test/v1765.test.mjs`).
