### Test report — SQL Assistant 17.6.5

Baseline: `SQL-Assistant-V17.6.4.zip` (attached). Run **unchanged first**: type-check, lint, production build, 172/172 Node tests passed.

All stages were run as the underlying `node` / `python3` commands in `npm run verify` order (the npm registry is not reachable here; nothing needs it: the only dev dependency, TypeScript **5.8.3**, is the pinned version and was run directly). The real-browser suites ran in **Chromium 1208 (Playwright 1.57)** — the first time they ran since V17.6.3 (V17.6.4 could not run them).

| Stage | Result |
|---|---|
| TypeScript 5.8.3 — `tsc -p tsconfig.json --noEmit` | passed |
| Lint (87 files, no import cycles) | passed |
| Production build (`dist/`, `index.html`, `release/`, 797 KB, 17.6.5) | passed (twice: before the tests and as the final build) |
| Development build | passed |
| Security check (after the build; scans `src/` and `dist/index.html`) | passed — no credential, no console output, no dynamic code, CSP present |
| Node tests | **195 / 195 passed** (172 existing + 23 new in `test/v1765.test.mjs`) |
| Browser regression suites V17.0 → V17.6.3 (11 scripts) | **795 / 795 checks passed** (56 + 120 + 84 + 59 + 89 + 47 + 75 + 112 + 57 + 63 + 33) |
| Browser tests for V17.6.5 (`scripts/browser_test_v1765.py`) | **35 / 35 checks passed** |
| Side-by-side with the V17.6.4 build (`scripts/compare_v1765.py`, 16 pages × 2 widths) **33 / 33 passed** (see below) |
| `public/styles.css` | byte-identical to V17.6.4 (compare script) |

#### What the new tests prove (requirement → evidence)
| Requirement | Node (`v1765`) | Browser (`browser_test_v1765.py`) |
|---|---|---|
| Single authoritative encrypted record; no plaintext anywhere | record holds only the encrypted marker; the password is searched for in the repository file and in every storage entry of every device | same, in real browser storage and in the file |
| Automatic synchronization; no device-specific divergence | change on A → B after sync; stale device; two offline changes (first publisher wins); absent file never downgrades | B unlocks with the NEW password at once (unlock-time fetch), a wrong one is rejected; A applies a reset later |
| Updates reflected on all devices | revisions 1 → 2 across devices | revision 1 → 2 → 3 → 4 across devices |
| Fresh and upgraded installations | fresh publishes nothing; upgrade seeds revision 1; a different V17.6.4 password is replaced and reported | clean profile; V17.6.4-format marker seeded in storage, three devices |
| Backward compatibility with V17.6.4 | marker key and `{salt, iv, ciphertext}` format; default = no marker | same, in the browser |
| Reset: dialog, `admin`, immediate central publication, re-lock, warning, nothing else changed | source assertions + the service (record without verifier) | dialog text, Cancel changes nothing, Confirm → revision, locked, warning toast, `admin` unlocks, **storage snapshot before/after identical** |
| Failure handling | read-only repository, no repository, read failure, invalid / newer-format / tampered files, concurrent write | read-only → pending with the reason → published later; no repository → honest message |

#### Intended changes to existing tests (none weakened)
Version expectations 17.6.4 → 17.6.5 in `test/v1763.test.mjs` and six browser scripts; `test/v1764.test.mjs` — its version-stamp test became an About-history test (the stamps are asserted by `v1765`).

#### Comparison with the V17.6.4 build
Both production builds were loaded in Chromium at 1366 px and 390 px and compared page by page (version strings and run-time stamps normalized). Result: the style sheet is byte-identical; Quick Start, both builders, Error Rectifier, Schema tabs, Pull Schema, Secret Vault, Settings (Manual Schema Update, Schema Management, Synchronization, Admin Query Library, AI/LLM Model, **Danger Zone**), navbar and footer are **markup-identical**; only **About** (one new list entry) and **Settings → Security** (the status line and the new Reset panel, 31 markup lines) differ — as intended. (Every Settings tab is in the DOM at once, so the Security tab's two additions are set aside before the other tabs are compared; Security itself is compared unmodified and is expected to differ.)

#### Still to check (cannot be done here)
1. **Real GitHub / the repository access service / the real Pages workflow were not exercised.** The central file path is allowed by the broker's default prefix, the publication rules and the repository safety scan (asserted in tests), but a real write by your service or token has not been run. After deployment: Settings → Security → *Central synchronization* should read *synchronized (revision N)* on a device that can write, and the file `sql-assistant-data/security/admin-password.json` should exist in the repository.
2. **Devices that only read the published copy cannot publish a change** (reported as pending). The published copy appears after the *Publish SQL Assistant data* workflow has run for the commit that holds the file.
3. If several V17.6.4 devices had different passwords, the first to synchronize defines the central one (documented).
4. `package-lock.json` still does not exist (registry blocked).
