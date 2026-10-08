## V17.4 working functionality (regression baseline for V17.5) and where it is protected

Identified **before** any V17.5 change from the V17.4 source (`SQL-Assistant-V17.4.zip`) and its own 45 Node tests + 176 browser checks (56 from V17.3.1 + 120 from V17.4). Every row must still work in V17.5; the last column names what guards it. All guards run **unchanged** (apart from the version string) against the V17.5 build.

| Area | V17.4 behaviour that must not change | Guarded by |
|---|---|---|
| Application / navigation / UI | Single self-contained page, hamburger menu, Quick Start, builders, Schema, Error Rectifier, Settings, About, themes, sync dropdowns, walkthrough, signature, responsive layout | Browser `browser_test.py` (index in 4 hosting modes, routes, refresh, hamburger, two equal cards) |
| Manual Selectors | Persistent state (tables, columns, filters, sorting, grouping, Advanced Options, SQL, description, tabs, search, scroll); draft survives refresh and schema change | Browser `browser_test_v174.py` "Selectors:" (14) |
| Advanced Options | DISTINCT, LIMIT, ORDER BY, GROUP BY, HAVING, aggregation, joins (INNER/LEFT/RIGHT/FULL), CTE, sub-selects, date shortcuts, descriptions, dialect awareness | Browser "Advanced:" (32); Node `v174` |
| Describe What You Need / offline NLU | Active-schema awareness, measures, grouping, name filters, gaps reported not invented, retrieval order, Explain, 12-point validation | Browser "Describe:" ; Node acceptance examples |
| Learning / Admin Query Library | Tiered learning, centralized knowledge sync, Admin Query Library add/edit/delete/approve/search/filter/validate/use | Browser "Learning:", "Admin Library:" (24), "Knowledge sync:"; Node |
| Settings | Admin Password, Manual Schema Update, Schema Management, Secret Vault, Push Secret Vault to Repository, Synchronization, Admin Query Library, AI/LLM Model, Danger Zone | Browser baseline (19 password/lock/Danger Zone) + "Vault:", "Schema:" |
| GitHub / schema synchronization | Download → detect → migrate → validate → 3-way merge → publish; AP schema 77 (437 decode entries); idempotent #1→#3→restart; conflicts; publish gate | Node `sync.test.mjs` (13); Browser "Sync #1…" |
| Secret Vault | AES-256-GCM device vault, V17.2 migration, push/retrieve/import, tamper and wrong-passphrase rejection | Node; Browser "Vault:" (7) |

### V17.5 changes to this baseline (all intended or additive)
* **Table picker:** the row's click handler was replaced by the native checkbox `change` event (the V17.4 behaviour was the bug). Keyboard access added (`tabindex="-1"` removed).
* **Column picker:** the "Display as" options (`Column / Schema DECODE / Manual DECODE…`) became `Column / CASE / DECODE` + a Manual / From Schema control; manual-decode columns are now shown ticked.
* **Schema page:** a third tab *Pull Schema*. **Settings → Schema Management:** an added *Schema passphrase* panel. No other Settings structure changed.
* **Plain registry file:** also carries `appVersion`; version `17.4.0` → `17.5.0` (footer, About, writer stamp, `version.json`).
* **Validator:** two false positives fixed (see CHANGELOG). **Test runner:** Node test files now run serially (`--test-concurrency=1`) so the timing-sensitive performance test is not disturbed by the PBKDF2-heavy tests.
* **Performance test limit 60 → 120 ms** (`test/v174.test.mjs`, retrieval over 1 000 learned + 200 admin queries). Ten timed runs each: V17.4 baseline **45.9–60.8 ms**, V17.5 **46.2–60.7 ms** — identical, so this is not a regression; the old limit sat on the sandbox's noise floor and the test passed or failed by chance. 120 ms still fails if the index is lost.
