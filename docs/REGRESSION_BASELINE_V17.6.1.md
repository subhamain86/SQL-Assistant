### V17.5.7 working functionality (regression baseline for V17.6.1) and where it is protected

Identified **before** any change from `SQL-Assistant-V17.5.7.zip` (built and tested unchanged first). All guards run against the V17.6.1 build; `scripts/compare_v1761.py` additionally loads **both** builds side by side.

| Area | V17.5.7 | V17.6.1 | Protected by |
|---|---|---|---|
| SQL generation, query editing, Manual Selectors, Advanced Options, CASE/DECODE, Describe What You Need, learning, Admin Query Library, AI/LLM, schema import / browsing / search, Manual Schema Update, admin message, walkthrough, navigation, layout, styles | working | **unchanged — no source file of these areas was modified** | all earlier Node + browser suites; `compare_v1761.py` (13 unrelated pages × 2 widths identical; style sheet byte-identical) |
| Hamburger menu, Schema page with three tabs, the three cards of *Pull Schema* (same headings, ids, buttons) | working | unchanged (one added sentence in the vault card; result texts) | V17.5.4 / V17.5.7 / V17.6.1 browser suites, comparison |
| Pull Schema, Sync with GitHub Now, sync service, transactional write / rollback | working | unchanged (`syncService.ts` not modified); *Pull Schema works independently of vault recovery* | Node `sync`, `v175`, `v1752`, `v1753`, `v1755`; browser V17.5 / V17.5.2 / V17.5.5; V17.6.1 scenarios A, B |
| Secret Vault format and cryptography, default passphrase | working | unchanged (`cryptoBox.ts` not modified; passphrase defined once, still pre-filled) | Node `features`, `password`, `v1754`, `v1757`, `v1761` |
| Push Secret Vault to Repository | working | unchanged | V17.5.7 / V17.6.1 browser suites |
| Repository configuration (administrator-only editing) | working | unchanged | Node `v1757`; browser V17.5.7 |
| Import encrypted file | working | unchanged (same messages) | browser V17.5.4 / V17.5.5 / V17.5.7 / V17.6.1 |

#### Intended changes to existing assertions (none weakened)
* **Versions** 17.5.7 → 17.6.1 in the browser suites and in the Node assertions that pinned them.
* **A token GitHub accepts but cannot use for the repository:** V17.5.7 saved it with a warning (`test/v1757.test.mjs`); V17.6.1 does **not** restore it ("insufficiently privileged tokens are rejected safely"). An unconfirmed (offline) token with nothing saved yet is still restored, as before.
* Wording of the retrieval failures (`Retrieve from Repository`): the V17.5.7 suites that asserted the old sentences were updated to the new, more specific ones where they changed (listed in `TEST_REPORT_V17.6.1.md` if any).
