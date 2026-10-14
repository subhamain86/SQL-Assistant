### V17.6.5 working functionality (regression baseline for V17.6.6) and where it is protected

Identified **before** any change from `SQL-Assistant-V17.6.5.zip` (195 Node tests green). V17.6.6 is a single-defect release: only the Admin Password retrieval / adoption code changed.

| Area | V17.6.5 | V17.6.6 | Protected by |
|---|---|---|---|
| UI, layout, styles, navigation, every page | working | **unchanged** (only the About history gains one entry) | `scripts/compare_v1766.py` (33 comparisons, 16 pages × 2 widths); `public/styles.css` byte-identical |
| Settings → Security (change, reset, status line), Danger Zone | working | **markup-identical** | `compare_v1766.py`, `browser_test_v1765.py` |
| Admin Password marker format, key `sqla.pwvault.v15`, PBKDF2 / AES-GCM, record format and path, revisions, reset, recovery script | working | unchanged | Node `password`, `v1765`, `v1766`; browser `v1765` |
| Cross-device synchronization, pending changes, conflicts, no-downgrade | working | unchanged | Node `v1765`; browser `v1765` |
| GitHub synchronization, Secret Vault, token-free retrieval, published-copy logic (`publishedData.ts`), broker, schema synchronization, SQL generation, CASE/DECODE, NLU, learning, Admin Query Library | working | unchanged — these modules do not reference the fix | Node `features`, `v174`–`v1763`, `v1766` (module-isolation test); all browser suites |
| Workflows, build script, TypeScript pin | working | unchanged | Node `v1762`–`v1764` |
| Existing V17.6.5 installations | marker + meta on the device | kept byte-for-byte after the upgrade | Node `v1766` (10); browser `v1766` (marker / meta produced by the real V17.6.5 build) |
