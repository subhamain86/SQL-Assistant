### V17.6.2 working functionality (regression baseline for V17.6.3) and where it is protected

Identified **before** any change from `SQL-Assistant-V17.6.2.zip` (extracted, type-checked, built and tested unchanged first: 155 Node tests green). All guards run against the V17.6.3 build; `scripts/compare_v1763.py` loads **both** builds side by side.

| Area | V17.6.2 | V17.6.3 | Protected by |
|---|---|---|---|
| SQL generation, selectors, Advanced Options, CASE/DECODE, Describe What You Need, learning, Admin Query Library, AI/LLM, schema import / browsing / search, Manual Schema Update, admin message, walkthrough, navigation, layout, styles | working | **unchanged** (no engine file modified; `public/styles.css` byte-identical) | all earlier Node + browser suites; `compare_v1763.py` |
| Hamburger menu, Schema page, the three Pull Schema cards, Settings → Secret Vault / Schema Management | working | **markup identical when no publication marker exists** (compare: 15 of 16 pages identical, both widths; only About changed) | `compare_v1763.py`; V17.5.4 / V17.5.7 / V17.6.1 / V17.6.2 suites |
| Repository configuration (hidden, read-only, administrator-only editing) | working | unchanged | Node `v1757`; browser V17.5.7, V17.6.2, V17.6.3 (C) |
| Pull Schema, Sync with GitHub Now, sync service | working | unchanged logic; reads the published copy only for a device with **no token** and **with** a valid marker | Node `sync`, `v175*`, `v1763`; browser V17.5 → V17.6.3 |
| Secret Vault format, cryptography, default passphrase, Push / Retrieve / Import | working | unchanged; one added source route (published copy) | Node `features`, `v1754`, `v1757`, `v1761`, `v1762`, `v1763`; browser V17.5.4 → V17.6.3 |
| V17.6.2 central broker, V17.6.1 sign-in relay | working | unchanged, opt-in; the broker keeps precedence over the published copy | Node `v1761`, `v1762`; browser V17.6.1, V17.6.2 |

#### Intended changes to existing assertions (none weakened)
* **Versions** 17.6.2 → 17.6.3 in the browser suites; the V17.6.2 Node assertion now accepts any 17.6.x ≥ 2 and checks the three stamps agree.
* **One deliberate change to a V17.6.1 source assertion** (`test/v1761.test.mjs`): the default vault passphrase constant is referenced **three** times in `schemaRepoCards.ts` instead of two — imported, pre-filled, and (new) used once by the Card 1 token auto-population to open a published central vault. It is still defined once in the source tree (asserted).
