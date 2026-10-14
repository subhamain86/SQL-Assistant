# Test report — V17.6.9

Environment of this run: Node v24.16.0 · project-pinned TypeScript 5.8.3 (`node_modules/typescript`) · Chromium 145 via Playwright (headless) · Linux container. **Not** GitHub Actions, **not** real GitHub / Azure.

## Node tests (`node --test --test-concurrency=1 test/*.test.mjs`, after `node scripts/build.mjs`)
**291 tests · 291 passed · 0 failed** (123 s). Baseline V17.6.8: 266/266. Added: 25 tests in `test/v1769.test.mjs`. Rewritten (policy change, same intent): the V17.6.8 tests that encoded the provisional default (`password`, `v1757`, `v1763` version stamp, `v1764` deploy-broker wording, `v1765`, `v1766`, `v1767`, `v1768`). Log: `results/node-tests.txt`.

## Browser suites (sequential, one Chromium per suite, production build `dist/index.html`)
| Suite | Scope | Checks | Result |
|---|---|---|---|
| `scripts/browser_test.py` | V17.2–V17.3 base + routes + password | 56/56 | PASS |
| `scripts/browser_test_v174.py` | V17.4 | 120/120 | PASS |
| `scripts/browser_test_v175.py` | V17.5 | 84/84 | PASS |
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

**Total: 959/959 browser checks.**

Honest notes on the harness (details in `docs/VERIFICATION_REPORT_V17.6.9.md`): the legacy suites up to V17.5.7 / V17.6.2 / V17.6.3 drive the *first-time default* on devices that have no repository connection. Under the V17.6.9 policy the default must be confirmed by an authoritative repository, so those suites give such a device a temporary EMPTY test repository for the duration of the Admin Password check (the application is untouched). The dedicated authentication suites (`v1765`–`v1769`) use no such helper; `v1767` and `v1769` never seed Device B.

## Not run / not possible here
Real GitHub Actions run · real GitHub Pages / `bw-publish-zone` publication · real Azure broker deployment · real GitHub device-flow sign-in · real organization policy (Conditional Access). See `docs/VERIFICATION_REPORT_V17.6.9.md` → "Outstanding external blockers".
