### V17.5.3 working functionality (regression baseline for V17.5.4) and where it is protected

Identified **before** any V17.5.4 change from the V17.5.3 source (`SQL-Assistant-V17.5.3.zip`, built and tested unchanged: production build, **88/88** Node tests) and its **497** real-browser checks. All guards run against the V17.5.4 build.

| Area | V17.5.3 behaviour | V17.5.4 |
|---|---|---|
| Manual Selectors, tick-marks, Advanced Options, CASE/DECODE, Describe What You Need, learning, Admin Query Library, AI/LLM, Admin Password, Danger Zone, admin message, navigation, responsive layout | unchanged | unchanged — guarded by the V17.3.1 (56), V17.4 (120), V17.5.1 (59) suites and the unaffected parts of V17.5 / V17.5.2 |
| Schema synchronization (plain + encrypted, conflicts, typed errors, status, request time limit) | unchanged | unchanged — V17.5.2 suite (97) + Node (`sync`, `v175`, `v1752`, `v1753`) |
| **Pull Schema** (preview → apply, failures, older schema, passphrase change) | unchanged | unchanged — V17.5 (pull flow + failure scenarios) and V17.5.2 suites |
| Push to GitHub tab | present | **removed on request** — its 63 browser checks were removed with it; `SyncService.push()` and `publishPlan()` stay covered by `test/v1753.test.mjs` (10) |
| Schema passphrase card (Settings → Schema Management) | present | **removed on request** — the 6 V17.5 browser checks of the card (panel, masked fields, short / mismatching passphrase, status ON, reveal) were removed; the publication itself is still exercised through `SyncService.push()` (triggered from the page) so the cross-device pull flows still pull a genuinely published encrypted file |
| Secret Vault tab | repository card + token + Push + Retrieve / Import | **Push only**; repository / token / pull in Schema → Pull Schema — suites that configured the token or pulled the vault now do it through the Schema page (V17.3.1, V17.4, V17.5.2); V17.5 asserts the new split |

#### Intended changes to existing assertions (none weakened)
* Version strings 17.5.3 → 17.5.4 (footer, writer stamp, header `appVersion`).
* The shared remote of the V17.5.2 suite serves **basware/sk-ap-sql-assistant** (was acme/sql-data) because the location is now fixed; the status chip text changed accordingly.
* *Missing credentials* check: the pointer button now moves focus to the token field on the same page instead of opening Settings.
* V17.5.1 *Schema Management content* check no longer lists the removed passphrase card.
