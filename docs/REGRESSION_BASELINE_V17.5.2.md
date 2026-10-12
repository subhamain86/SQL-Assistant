## V17.5.2 working functionality (regression baseline for V17.5.3) and where it is protected

Identified **before** any V17.5.3 change from the V17.5.2 source (`SQL-Assistant-V17.5.2.zip`, built and tested unchanged: production build, **78/78** Node tests) and its **434** real-browser checks (56 V17.3.1 + 120 V17.4 + 102 V17.5 + 59 V17.5.1 + 97 V17.5.2). All guards run against the V17.5.3 build.

| Area | V17.5.2 behaviour that must not change | Guarded by |
|---|---|---|
| Manual Selectors: immediate tick-marks, state persistence, tabs, search / filter, schema switch | unchanged | V17.5.2 "Tables / Race / Search / Filter / Tabs / Latency" (15) + V17.5 "Tables:" + V17.4 "Selectors:" |
| CASE/DECODE (manual + schema, valid / none / partial / invalid, aliases, dialect types) | unchanged | V17.5.2 (18) + V17.5 (24); Node `v1752`, `v175` |
| Pull Schema, encrypted sync, conflicts, failure classes, status, 8 steps | unchanged (label "Pull Schema from GitHub"; status wording "Vault passphrase …") | V17.5.2 cross-device / failure / menu suites; Node `v1752`, `v175` |
| Secret Vault, Settings (8 tabs, Admin Password), AI/LLM, learning, Admin Query Library | unchanged | V17.3.1 (56), V17.4 (120) |
| Admin message in the navbar | unchanged | V17.5.1 (59) |
| Navigation, hamburger menu, responsive layout, 4 hosting modes | unchanged | V17.3.1 baseline + responsive checks in every suite |

### V17.5.3 changes to this baseline
* **Additive:** *Push to GitHub* tab on the Schema page; `schemaPush.ts`; `SyncService.publishPlan()`, `PushOptions`, verified publication, typed push errors.
* **Behavioural (intended):** every publication — also *Sync with GitHub Now* and the Settings action — is now read back and verified before it is reported as successful, and reports which schemas were added / updated / identical. The Settings publish message gains one sentence ("The file was read back from the repository and verified."). Existing assertions only use sub-strings of the old messages and still hold.
* **Wording (intended):** status chips "Schema passphrase saved on this device (encrypted)" → "Vault passphrase available on this device (encrypted)", "No schema passphrase saved" → "No Vault passphrase on this device"; the Pull Schema heading and button say "… from GitHub". The V17.5.2 browser checks that quote these texts were updated (6 assertions); their intent is unchanged.
* **Version** 17.5.2 → 17.5.3 (footer, About, writer stamp, `version.json`, NLU label).
