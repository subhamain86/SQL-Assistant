### V17.5.5 working functionality (regression baseline for V17.5.7) and where it is protected

Identified **before** any change from `SQL-Assistant-V17.5.5.zip` (built and tested unchanged: 102/102 Node tests, 75/75 browser checks). All guards run against the V17.5.7 build; `scripts/compare_v1755.py` additionally loads **both** builds side by side.

| Area | V17.5.5 | V17.5.7 | Protected by |
|---|---|---|---|
| SQL generation, query editing, Manual Selectors, Advanced Options, CASE/DECODE, Describe What You Need, learning, Admin Query Library, AI/LLM, schema import, Manual Schema Update, admin message, walkthrough, navigation, layout | working | **unchanged — no source file of these areas was modified** | V17.3.1 / V17.4 / V17.5 / V17.5.1 / V17.5.2 browser suites, Node suites, `compare_v1755.py` (13 unrelated pages × 2 widths identical; style sheet byte-identical) |
| Hamburger menu, Schema page with three tabs | working | unchanged | V17.5.4 / V17.5.7 suites, comparison |
| Sync service (plain + encrypted, conflicts, typed errors, status, limits), *Sync with GitHub Now*, `pullSchema()`, transactional write / rollback | working | unchanged (`syncService.ts` not modified) | Node `sync`, `v175`, `v1752`, `v1753`, `v1755`; browser V17.5 / V17.5.2 / V17.5.5 |
| Secret Vault format and cryptography (V17.3.1 + V17.2 envelopes) | working | unchanged format; import is now a safe merge | Node `features`, `password`, `v1754`, `v1757` |
| Schema Management without the passphrase card; Settings → Secret Vault with Push only | present | present | V17.5.4 / V17.5.7 suites |

#### Intended changes to existing assertions (none weakened)
* **Versions** 17.5.5 → 17.5.7 in `browser_test.py`, `…v1751`, `…v175`, `…v1755` and the Node assertions in `sync`, `v1753`, `v1754`.
* **Pull Schema card:** the checks of the instruction block ("How to pull the schema", 3 steps, compact height) and of the status block *inside the Pull card* became checks that the card has **no** such blocks; the status is read from Settings → Schema Management (`sm_status()` helper), so "no repository connection", "token saved", "nothing waiting to be published" are still asserted.
* **Vault import message:** "retrieved, decrypted and validated" → "Secret Vault imported and validated" (`…v174`, `…v1754`, `…v1755`).
* **No token yet (`…v1754`):** "Set the GitHub access token (card above) first" became: the message says the token need not be set first and points to *Import encrypted file*; the only request is an anonymous GET; nothing is written.
* `package.json` `test:browser` no longer lists the non-existent `browser_test_v1753.py` and adds `browser_test_v1757.py`; `compare` was added.
