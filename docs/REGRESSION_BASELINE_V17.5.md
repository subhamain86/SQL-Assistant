## V17.5 working functionality (regression baseline for V17.5.1) and where it is protected

Identified **before** any V17.5.1 change from the V17.5 source (`SQL-Assistant-V17.5.zip`) and its own 59 Node tests + 278 real-browser checks (56 from V17.3.1 + 120 from V17.4 + 102 from V17.5). The V17.5.1 package must keep every one of them green; all guards run **unchanged** (apart from the version string) against the V17.5.1 build.

| Area | V17.5 behaviour that must not change | Guarded by |
|---|---|---|
| Table tick-marks / Manual Selector state | Native checkbox is the single source of truth; nothing resets | Browser `browser_test_v175.py` "Tables:" (13) + V17.4 "Selectors:" (14) |
| Schema CASE/DECODE | Manual / From Schema, DECODE only on Oracle, never invented, learned + admin patterns | Browser "CASE/DECODE" (24); Node `v175` (CASE/DECODE tests) |
| Pull Schema + passphrase | AES-256-GCM, masked field + eye, preview → apply, transactional, versioned, failure messages | Browser "Pull:" (24), "Failure —" (11), "Admin:" (16); Node `v175` crypto / cross-device / failure / versioning |
| GitHub schema + knowledge synchronization, Secret Vault | Unchanged | Node `sync.test.mjs` (13) + `v174`; Browser baseline suites |
| Settings tabs / Admin Password / Danger Zone | 8 tabs, password-gated | Browser baseline (19 + 4 checks) |
| Navbar and hamburger menu | Sync dropdowns, schema badge, status icons, theme, walkthrough, signature, responsive | Browser baseline "Hamburger navigation", responsive checks; V17.5.1 "existing navbar is untouched" |

### V17.5.1 changes to this baseline (all additive)
* **Navbar:** one optional row (`#adminMsgBar`) rendered **only while a message is active** — with no message the markup is byte-identical to V17.5.
* **Settings → Synchronization:** one added panel (*Admin message*); the existing panels, order and ids are unchanged.
* **Synchronization triggers:** the existing scheduler tick, the start-up sequence and *Sync with GitHub Now* additionally pull the admin message (fire-and-forget, errors swallowed).
* **Version** 17.5.0 → 17.5.1 (footer, About, writer stamp, `version.json`); three test assertions that compare the version string were updated.
