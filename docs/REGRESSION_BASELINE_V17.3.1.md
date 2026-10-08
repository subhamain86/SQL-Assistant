# V17.3.1 working functionality (regression baseline) and where it is protected

Identified **before** any V17.4 change, from the V17.3.1 source (`SQL-Assistant-V17.3.1 (1).zip`, the build that includes the Admin Password) and its own 29 Node tests + 56 browser checks.
Every row must still work in V17.4. The right-hand column names the test that guards it. *Node* = `test/*.test.mjs`, *Browser* = `scripts/browser_test.py` (the unchanged V17.3.1 suite, 56 checks) or `scripts/browser_test_v174.py`.

| Area | V17.3.1 behaviour that must not change | Guarded by |
|---|---|---|
| Application / index | Single self-contained page: `dist/index.html`, root `index.html`, `release/` (GitHub Pages sub-path, file://, refresh, deep links, `404.html`) | Browser: "index loads…", "every route renders and survives refresh" (4 hosting modes) |
| Navigation | Navbar, hamburger menu, Quick Start, Query Builder ▸ (Read Only / CR), Schema, Error Rectifier, Settings, About, theme menu, sync source/time dropdowns, signature, Guided Walkthrough | Browser: "Hamburger navigation works", routes, About, walkthrough text |
| Layout | Two equal top cards (Describe What You Need / Generated SQL), Manual Selectors tabs, V17.2 styling | Browser: "two equal top cards" |
| Describe What You Need | Offline NLU: tables, joins, decode filters, aggregation, grouping, sort, limit, dates, DISTINCT, country names, table aliases | Node: "offline NLU …"; Browser: "Offline NLU: aggregation, grouping, date range, limit" |
| Manual Selectors | Pick tables / columns (alias, DECODE, aggregate) / filters; Build Query; Advanced Options (DISTINCT, GROUP BY, HAVING, LIMIT, Recursive, table aliases, join type, join paths, ORDER BY, CTEs, manual CASE/DECODE) | Browser: "Manual Selectors: table + column", "Advanced Options: DISTINCT + limit"; Node: "CTE + Recursive", "Join paths" |
| Manual vs automatic | Manual option beats inferred option; manual markers | Node: "manual settings win" |
| Generated SQL | Copy, Clear, Validate, Regenerate, Accept & Learn, Optimize | Browser: "Generated SQL validates" |
| Change Request builder | INSERT / UPDATE / DELETE with mandatory WHERE safeguard; description parsing | Node + Browser: "Query Builder for CR" |
| Error Rectifier | ORA-/SQL Server/PostgreSQL/MySQL error patterns | Node: "Error Rectifier" |
| Admin Password | Default `admin`, change, lock, 5-minute auto-lock, never stored in plaintext, required for row/schema delete and Danger Zone | Node: password tests; Browser: 19 password / lock / Danger Zone checks |
| Manual Schema Update | Row-wise select / edit / delete, current → modified, delete needs password + dependency confirmation | Node: "Manual Schema Update"; Browser: row checks |
| Schema Management | Stored schemas, activate / rename / export / delete, import, Smart Schema Import, recover decode codes | Browser + Node: sync / import tests |
| Schema synchronization | Download → detect → migrate → validate → 3-way merge → publish; AP schema 77 (437 decode entries); idempotent sync #1 → #2 → #3 → restart; conflicts; publish gate | Node: `sync.test.mjs` (13 tests); Browser: "Sync #1…", "Republished…", "Restart + sync" |
| Secret Vault | AES-256-GCM device vault, V17.2 vault migration, V17.2 envelope read, Push / Retrieve / Import, no plaintext token | Node: "Secret Vault"; Browser: "Token masked…", "Push Secret Vault…" |
| AI/LLM Model | Optional provider settings, offline stays primary, validation, offline fallback | Node: "AI/LLM Model"; Browser: "AI/LLM Model tab present" |
| Danger Zone | Clear schema contents, clean up storage, clear learned knowledge, reset vault, reset Admin Password (all password-gated) | Browser: 4 Danger Zone checks |
| Resilience | Blocked storage still starts; corrupt registry backed up; no console errors | Node: "local load…"; Browser: "Blocked storage…", "No console errors" |
| Routing | `#settings/vault` deep links, unknown route → Quick Start | Node: "routing …" |

## V17.4 changes to this baseline (all additive or explicitly intended)

* **Settings tabs:** 7 → 8 (new *Admin Query Library*). The two tests that counted tabs were updated (7 → 8).
* **Version / writer stamp:** `17.3.1` → `17.4.0` (footer, About, `version.json`, repository writer stamp). Older stamps are still read.
* **Learned-query store:** `sqla.learning.v17` → `sqla.learning.v174`. The old key is **kept** and migrated once, idempotently.
* **Push Secret Vault:** adds validation, a no-plaintext assertion and a read-back verification around the unchanged encryption; the encrypted file format is unchanged (V17.3.1 and V17.2 files are still readable).
* **Selections on an unselected table** are now *kept but not used* in the SQL (V17.3.1 kept them in the state but let them reach the SQL).
* **Bug fixed that the new validator exposed:** MySQL date shortcuts ("this year", "last month") used PostgreSQL's `DATE_TRUNC()`.
