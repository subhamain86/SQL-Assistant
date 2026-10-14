### V17.6.6 working functionality (regression baseline for V17.6.7) and where it is protected

Identified **before** any change from `SQL-Assistant-V17.6.6.zip` (216 Node tests green). V17.6.7 is a single-defect release.

| Area | V17.6.6 | V17.6.7 | Protected by |
|---|---|---|---|
| UI, layout, styles, navigation, every page (including Settings → Security, Danger Zone) | working | **unchanged** (only the About history gains one entry) | `scripts/compare_v1767.py` (16 pages × 2 widths); `public/styles.css` byte-identical |
| Encrypted marker `sqla.pwvault.v15`, PBKDF2-SHA-256 150 000 / AES-GCM, record format + path, revisions, reset, recovery script, merge / conflict / pending rules | working | unchanged | Node `password`, `v1765`, `v1766`, `v1767`; browser `v1765`, `v1766`, `v1767` |
| Unlock check asks the central record first on a device without a marker; waits for a running synchronization | working | unchanged | Node `v1766`, `v1767`; browser `v1766` |
| Pull Schema / vault / sign-in request contracts (no Admin Password request) | working | unchanged — their code does not reference the fix | Node `v1767` (module isolation); browser `v1754`, `v1755`, `v1762`, `v1763` |
| Secret Vault, broker, published copy, schema synchronization, SQL, NLU, learning, Admin Query Library, workflows | working | unchanged | all Node and browser suites |
| Existing V17.6.6 installations | marker + meta on the device | kept byte-for-byte | Node `v1767` (R6/R7/R8); browser `v1767` C1 (marker + meta created by the real V17.6.6 build) |

Intended changes to existing assertions (none weakened): `browser_test_v1765.py` — a not-yet-synchronized device whose central record is reachable no longer shows the "default password is admin" hint (it asks for the record and drops the hint); version expectations 17.6.6 → 17.6.7; the V17.6.6 version-stamp test became a history test.
