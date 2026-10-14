# Test report — V17.7

Environment of this run: Node v24.16.0 · project-pinned TypeScript 5.8.3 (`node_modules/typescript`) · Chromium (Playwright, headless) · Linux container. **Not** GitHub Actions, **not** real GitHub / Azure.

## Node tests (`node --test --test-concurrency=1 test/*.test.mjs`, after `node scripts/build.mjs`)
**303 tests · 303 passed · 0 failed** (136 s), run by `node scripts/verify-no-npm.mjs --skip-browser` after a clean rebuild (full output: `test-results-v17.7/node-tests.txt`).

Baseline V17.6.9: 291/291. Added: `test/v177.test.mjs` (current-version assertions, the six weaknesses, one authentication service, no hook in production, no Node / npm API in the application).

Two assertions of this verification pass were corrected, both test-design defects and not application defects: (1) the `V17.7` "no Node API / bare-specifier import" detector matched the words `from "` inside a user-facing message of `schemaFormat.ts` (unchanged since V17.6.9); it now matches only `import` / `export … from` statements, `import "x"` and `import("x")` (checked against eight positive / negative samples); (2) the `V17.5` schema-metadata test pinned the writer label to `17.5|17.6` and now accepts `17.5`–`17.7`.

## Browser suites (sequential, one Chromium per suite; the suites load the browser-test build `test-dist/index.html` with `?e2e=1`, the production build `dist/index.html` is verified separately to contain no hook)
| Suite | Scope | Checks | Result |
|---|---|---|---|
| `scripts/browser_test.py` | V17.2–V17.3 base + routes + password | 56/56 | PASS |
| `scripts/browser_test_v174.py` | V17.4 | 120/120 | PASS |
| `scripts/browser_test_v175.py` | V17.5 | 84/84 | PASS |
| `scripts/browser_test_v177.py` | V17.7 authority, no test hook in production, no Node / npm at run time | 28/28 | PASS |
| `scripts/browser_test_v1751.py` | V17.5.1 admin message | 59/59 | PASS |
| `scripts/browser_test_v1752.py` | V17.5.2 | 89/89 | PASS |
| `scripts/browser_test_v1754.py` | V17.5.4 | 47/47 | PASS |
| `scripts/browser_test_v1755.py` | V17.5.5 | 75/75 | PASS |
| `scripts/browser_test_v1757.py` | V17.5.7 | 112/112 | PASS |
| `scripts/browser_test_v1761.py` | V17.6.1 | 57/57 | PASS |
| `scripts/browser_test_v1762.py` | V17.6.2 central access / broker | 64/64 | PASS |
| `scripts/browser_test_v1763.py` | V17.6.3 published data | 33/33 | PASS |
| `scripts/browser_test_v1765.py` | V17.6.5 central Admin Password | 35/35 | PASS |
| `scripts/browser_test_v1766.py` | V17.6.6 new device | 34/34 | PASS |
| `scripts/browser_test_v1767.py` | V17.6.7 stale session | 33/33 | PASS |
| `scripts/browser_test_v1768.py` | V17.6.8 boundary + navbar Sync | 43/43 | PASS |
| `scripts/browser_test_v1769.py` | V17.6.9 cross-device acceptance | 18/18 | PASS |

**Total: 987/987 browser checks** (V17.6.9: 959; added: 28 in `browser_test_v177.py`).

Harness fix made in this pass: the suites V17.6.1, V17.6.2, V17.6.3, V17.6.6 (and V17.6.7 / V17.6.8, which reuse its helpers) serve a copy of `release/` — the *production* page, which has no test hook. Their `site()` helpers now also copy `test-dist/index.html` next to `scripts/serve.mjs`, which serves it **only** for URLs carrying `?e2e=1` (as designed in V17.7). Production hosts never run `serve.mjs` and never carry the hook. Before the fix those six suites failed in their set-up (`window.__sqla` undefined); after it all six pass with unchanged assertions.

## Not run / not possible here
Real GitHub Actions run · real GitHub Pages / `bw-publish-zone` publication · real Azure broker deployment · real GitHub device-flow sign-in · real organization policy (Conditional Access). See `docs/VERIFICATION_REPORT_V17.7.md` → "Outstanding external blockers".
