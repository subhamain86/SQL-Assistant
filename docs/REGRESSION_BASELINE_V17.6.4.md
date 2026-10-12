### V17.6.3 working functionality (regression baseline for V17.6.4) and where it is protected

Identified **before** any change from `SQL-Assistant-V17.6.3.zip` (167 Node tests green). V17.6.4 changes no application behaviour: the only application-source edits are the version strings and the About entry.

| Area | V17.6.3 | V17.6.4 | Protected by |
|---|---|---|---|
| SQL generation, selectors, Advanced Options, CASE/DECODE, learning, Admin Query Library, AI/LLM, schema import / browsing, navigation, layout | working | **unchanged** | Node `features`, `v174`, `v175*` |
| Styles | `public/styles.css` | **byte-identical** (`cmp`) | build check |
| Built page | working | identical except version strings and one new About line (line-by-line comparison of `dist/index.html`) | compare script run |
| Three Pull Schema cards and order, repository configuration + Admin Password, default passphrase | working | unchanged | Node `v1757`, `v1761`–`v1763` |
| Vault envelope, key derivation, Pull Schema, published-copy logic, broker | working | unchanged | Node `features`, `v1754`–`v1763` |
| Workflows | Pages: `typecheck && lint && security && test && build` in one step | build before security, separate steps, deterministic install, Pages-enabled check; broker workflow skips a push until configured | Node `v1762`, `v1763`, **`v1764`** |

Intended changes to existing assertions (none weakened): version expectations 17.6.3 → 17.6.4 in tests and browser scripts; `v1753` "content differs" now always changes the ciphertext character (removes a 1-in-64 flake).
