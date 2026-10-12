## V17.5.1 working functionality (regression baseline for V17.5.2) and where it is protected

Identified **before** any V17.5.2 change from the V17.5.1 source (`SQL-Assistant-V17.5.1.zip`, built and tested unchanged: production build, **67/67** Node tests) and its **337** real-browser checks (56 V17.3.1 + 120 V17.4 + 102 V17.5 + 59 V17.5.1). All guards run **unchanged** (apart from version strings and the one change listed below) against the V17.5.2 build.

| Area | V17.5.1 behaviour that must not change | Guarded by |
|---|---|---|
| Describe What You Need, offline NLU, validation, Explain, learning, Admin Query Library | unchanged | Browser V17.4 suite (120) |
| Manual Selectors, Advanced Options | state persistence, options, filters | V17.4 "Selectors:" / "Advanced:"; V17.5 "Tables:" |
| CASE/DECODE (Manual + From Schema), Pull Schema + passphrase, encrypted sync | unchanged | V17.5 suite (102) |
| Admin message (navbar), plain-text rendering, offline publish | unchanged | V17.5.1 suite (59) |
| Settings, Admin Password, Secret Vault, Danger Zone, deployment (4 hosting modes) | unchanged | V17.3.1 suite (56) |
| GitHub schema + knowledge synchronization | unchanged | Node `sync.test.mjs` (13), `v174`, `v175`, `v1751` |

### V17.5.2 changes to this baseline
* **Intentional:** the SQL / validation refresh after a table or column click runs one frame after the tick (see CHANGELOG A). One V17.5 browser assertion ("SQL contains FROM VENDOR *in the same task* as the click") now waits for the SQL; the tick and count are still asserted inside the click.
* **Intentional (requirement B):** for a column without a *valid* schema definition, *From Schema* is now **disabled** with the reason shown (V17.5.1 let the user select it and then showed the message). Two V17.5 browser checks ("No definition: 'From Schema' says clearly …" and "…the builder warns …") were rewritten to assert the new behaviour; the builder warning itself still appears when a definition *disappears* (schema switch) and is covered by the V17.5.2 suite.
* **Additive:** status block and 8-step list on *Schema → Pull Schema*; status block on *Settings → Schema Management*; "not available" state of *From Schema*; typed repository errors and a request time limit; `decodeDefinition.ts`.
* **Behavioural fixes:** duplicate default alias, numeric-coded ELSE branch (non-Oracle), silent use of malformed / incomplete definitions, conflict-only preview, partial pulls shown as success.
* **Version** 17.5.1 → 17.5.2 (footer, About, writer stamp, `version.json`, NLU label).
