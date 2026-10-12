### V17.6.1 working functionality (regression baseline for V17.6.2) and where it is protected

Identified **before** any change from `SQL-Assistant-V17.6.1.zip` (extracted, type-checked, built and tested unchanged first: 132 Node tests, all nine browser suites green). All guards run against the V17.6.2 build; `scripts/compare_v1762.py` additionally loads **both** builds side by side.

| Area | V17.6.1 | V17.6.2 | Protected by |
|---|---|---|---|
| SQL generation, query editing, Manual Selectors, Advanced Options, CASE/DECODE, Describe What You Need, learning, Admin Query Library, AI/LLM, schema import / browsing / search, Manual Schema Update, admin message, walkthrough, navigation, layout, styles | working | **unchanged** (no engine file was modified; `public/styles.css` is byte-identical) | all earlier Node + browser suites; `compare_v1762.py` (14 of 16 pages identical, both widths) |
| Hamburger menu, Schema page with three tabs, the three cards of *Pull Schema* (same headings, ids, buttons, order) | working | unchanged without central access; one added sentence ("Direction: repository → this device.") in the vault card | V17.5.4 / V17.5.7 / V17.6.1 / V17.6.2 browser suites, comparison |
| Repository configuration card (hidden, read-only, administrator-only editing via the existing Admin Password, validation, previous value kept on failure) | working | unchanged; with central access its live check goes through the broker | Node `v1757`; browser V17.5.7 and V17.6.2 (A) |
| Pull Schema (validated, transactional), Sync with GitHub Now, sync service | working | unchanged logic (`syncService.ts`: four new error-kind names only); an authorization step precedes each action | Node `sync`, `v175*`; browser V17.5 / 17.5.2 / 17.5.5; V17.6.2 (A, B, failures) |
| Secret Vault format and cryptography, default passphrase | working | unchanged (`cryptoBox.ts` not modified; passphrase defined once, still pre-filled, masked, editable) | Node `features`, `password`, `v1754`, `v1757`, `v1761`, `v1762` |
| Push Secret Vault to Repository | working | unchanged without central access; with it the push is written by the broker and carries no GitHub token | Node `v1757`; browser V17.5.7; V17.6.2 (A, B) |
| Retrieve from Repository / Import encrypted file | working | unchanged without central access (token → anonymous → V17.6.1 sign-in routes); with it: broker route, token not restored | Node `v1761`, `v1762`; browser V17.6.1, V17.6.2 |
| V17.6.1 GitHub sign-in relay and device-flow client | working | kept, unchanged (used only when central access is not deployed) | Node `v1761`; browser V17.6.1 |

#### Intended changes to existing assertions (none weakened)
* **Versions** 17.6.1 → 17.6.2 in the browser suites; the Node assertion that pinned 17.6.1 now accepts any 17.6.x patch and checks the three stamps agree.
* No other existing assertion was changed.
