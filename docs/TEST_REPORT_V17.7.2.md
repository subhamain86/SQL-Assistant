# Test report — V17.7.2

Only what was **executed** is reported as passed. Environment: Linux sandbox, Node 24, TypeScript 5.8.3, headless Chromium 149 (system build, driven by Playwright). No network access to GitHub / SharePoint.

## Technical validation (executed)
| Check | Result |
|---|---|
| `tsc -p tsconfig.json --noEmit` (strict) | pass |
| `tsc -p tsconfig.test.json --noEmit` | pass |
| `node scripts/lint.mjs` | pass (99 files, no import cycles) |
| `node scripts/check-stale.mjs` | pass (no orphan, no stale file) |
| `node scripts/build.mjs` (production) | pass — 1003 KB, SQL Assistant 17.7.2 |
| `node scripts/security_check.mjs` | pass (two review notes on `describeNeed.ts` innerHTML lines: both interpolate helper functions that escape every value; confirmed by a browser injection test, C15a) |
| `node scripts/verify-artifact.mjs` | pass |
| Application start-up / browser console | **no console error and no page error** in any of the browser sessions |

## Unit / integration — `node --test test/*.test.mjs`: 354 tests, **351 pass, 3 fail**
The 3 failures are one cause: **`public/favicon.svg` in the sandbox is a neutral placeholder** (SVG files were not in the text bundle), so the three byte-identity pins (V17.6.9, V17.7.1, V17.7.2) report a different favicon hash. With only that recorded hash neutralised in a scratch copy, `v1769`, `v1771` and `v1772` pass **75 / 75**. With your real `public/favicon.svg` they pass in your checkout; this was **not** run against the real file.

New in `test/v1772.test.mjs` (27 tests): version stamping; UI baseline (7 changed modules, style sheet untouched); line-level pin of the repository / token / vault / Pull Schema code; single GitHub repository builder; layout and navigation; honest assessment (success / review / error) on the 77-table AP schema; independence from Manual Selectors; AI/LLM context and prompt (stubbed endpoint); CR parsing and assessment; SQL formatter (whitespace-only, idempotent); central configuration (publish, new machine, existing machine, defaults, conflicts, failures, hostile records, transactional local write, first set-up, concurrency, security).

## Browser — `scripts/browser_test_v1772.py` against the test build: **97 passed, 0 failed**
* **Menu (A):** new group and both labels, opens the correct page, all ten existing destinations still reachable.
* **Layout (B):** in Read Only and CR the order is Manual Selectors → Generated SQL (immediately below, same width), no description card; Manual Selectors still generate SQL; Copy SQL works; CR WHERE safeguard intact.
* **Read Only description (C):** two cards; idle / loading / success / needs review / error states; copy, format (token-preserving, reversible), regenerate, validate; credential and over-length refusal; markup is escaped; AP schema 77 decode values, un-joinable table reported, unapplied "over 1000" flagged; independence from Manual Selectors; state kept across navigation; one-way hand-over.
* **CR description (D):** same cards; case-preserving values; INSERT / UPDATE / DELETE; missing WHERE refused; read request refused; unknown column never invented; uses the active (AP) schema.
* **Central configuration (E):** wrong password refused; invalid values refused with nothing written; administrator save → revision 1 in the repository, no secret; reload keeps it; **a new machine adopts it at start-up**; **an existing machine adopts revision 2 with *Sync***; hostile / invalid / credential-looking records ignored, local configuration unchanged, refusals logged; a read-only repository connection cannot change it; *Check for updated configuration* applies the newest revision; the rest of the GitHub page works.
* **Responsive (F):** 390 / 768 / 1366 px, no horizontal overflow on the four pages.
* Screenshots: `screenshots/` in the delivery.

## Not executed / limitations
* The 18 earlier Python browser suites (`browser_test*.py` of V17.4–V17.7.1) are **not part of the text bundle** and were not run (placeholders only). Run `npm run test:browser` in your checkout.
* Real GitHub, GitHub Actions, the central access service and the published-site deployment were not reachable: the repository was emulated (`memoryRepository`, same `sha` conflict semantics). Authentication / permission handling was tested through injected refusals (wrong password, read-only connection, permission error), not against real GitHub permissions.
* The optional AI/LLM Model was tested with a stubbed endpoint only.
* Cross-browser (Firefox / Safari / Edge) and real touch devices: not tested.
* `npm run verify` (the full chain) was not run as one command; its constituent steps above were.
