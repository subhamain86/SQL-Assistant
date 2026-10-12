### V17.5.4 working functionality (regression baseline for V17.5.5) and where it is protected

Identified **before** any V17.5.5 change from the V17.5.4 source (`SQL-Assistant-V17.5.4.zip`, built and tested unchanged: production build, **94/94** Node tests) and its **475** real-browser checks (56 V17.3.1 + 120 V17.4 + 96 V17.5 + 59 V17.5.1 + 97 V17.5.2 + 47 V17.5.4). All guards run against the V17.5.5 build.

| Area | V17.5.4 behaviour | V17.5.5 |
|---|---|---|
| SQL generation, query editing, Manual Selectors, Advanced Options, CASE/DECODE, Describe What You Need, learning, Admin Query Library, AI/LLM, schema import, Manual Schema Update, admin message, navigation, responsive layout, walkthrough | unchanged | unchanged — V17.3.1 (56), V17.4 (120), V17.5.1 (59) and the unaffected parts of V17.5 / V17.5.2; plus new integration checks after a pull (module selection, search, SQL, Advanced Options, NLU) |
| Cards 1 / 3, fixed repository, Settings → Secret Vault (Push only), Schema Management without the passphrase card, no Push tab | present | present — V17.5.4 suite (47), V17.5.5 suite |
| Schema synchronization (plain + encrypted, conflicts, typed errors, status, request time limit), *Sync with GitHub Now* | unchanged | unchanged — V17.5.2 suite, Node (`sync`, `v175`, `v1752`, `v1753`) |
| Pull Schema | passphrase field → preview table → Apply / Cancel, "Remember passphrase", "Remove saved passphrase" | **one button**; same validation / transaction / conflict / older-schema rules (service unchanged apart from `pullSchema()`) |
| Repository values | visible, details message hidden behind a button | **hidden by default** behind one reveal button; read-only |

#### Intended changes to existing assertions (none weakened)
* Version strings 17.5.4 → 17.5.5.
* **V17.5 / V17.5.2 suites:** the checks of the removed Pull-card UI (typed passphrase, short / empty passphrase, eye button, the comparison table, *Apply to this device*, *Cancel*, "Remember", "Remove saved passphrase", the 8 steps) were **removed with the UI**. Their intent is kept where it still applies: success / failure messages, local schema untouched after every failure, older-schema and conflict handling, secrecy, and cross-device pull of an encrypted file by a device with a saved passphrase (simulated through the service, as such a device exists after earlier versions). Wrong-passphrase checks became "the saved passphrase does not open the repository file".
* **V17.5.4 suite:** checks that read or edited the repository values now reveal them first; the "details message hidden by default" check became "configuration hidden by default".
* The status chip text on the Pull card is *"GitHub repository connected · token saved"* (no repository name).
