### V17.6.4 working functionality (regression baseline for V17.6.5) and where it is protected

Identified **before** any change from `SQL-Assistant-V17.6.4.zip`: lint, build, `npm run security`, 172 Node tests and 795 browser checks (11 suites) green.

| Area | V17.6.4 | V17.6.5 | Protected by |
|---|---|---|---|
| SQL generation, selectors, Advanced Options, CASE/DECODE, NLU, learning, Admin Query Library, AI/LLM, schema import / browsing, navigation, layout | working | **unchanged** | Node `features`, `v174`, `v175*`; browser `browser_test*` |
| Three Pull Schema cards and order, repository configuration (Admin Password gated), default passphrase | working | unchanged (the password prompts only add a lock-out note) | `v1757`, `v1761`–`v1763`; browser v1757 / v1761 |
| Vault envelope, key derivation, Pull Schema, published-copy logic, broker sign-in / read / write | working | unchanged (broker adds one server-side check on one path) | `v1754`–`v1763`; browser v1761–v1763 |
| Admin Password with **no central record** | local marker `sqla.pwvault.v15`, default `admin`, 4-character local policy, local reset | **identical** | `password.test.mjs`, `v1765` regression tests, `browser_test.py` |
| 5-minute inactivity re-lock, every protected action | working | unchanged (lock-out added) | browser tests |
| Styles | `public/styles.css` | existing rules unchanged; **additive** block at the end | diff |
| Settings → Security | one card (change) + Session | same card, same ids (`pwCurrent`, `pwNew`, `pwConfirm`, `changePwBtn`), plus Save, Reset, strength, status line | `v1765`, browser v1765 |
| Workflows | Pages, broker, publish-data, verify-PAT | Pages / broker / verify-PAT unchanged; publish-data: explicit credential step | `v1763`, `v1764`, `v1765` |
