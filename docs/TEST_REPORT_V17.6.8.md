### Test report — SQL Assistant 17.6.8

Environment: Node 24, TypeScript **5.8.3** (pinned; the machine's global `tsc` is 6.0.2, which rejects `moduleResolution: node` — so the stages were run as `node scripts/…` / `tsc` 5.8.3 directly, equal to `npm run verify`; `npm install` is blocked by the registry, 403), Chromium 145 (Playwright). Browser suites run one script after the other (two streams at most); a timing-sensitive check in `browser_test_v1752.py` (CPU-throttled latency, 82.7 ms vs 25 ms) failed once while another suite ran in parallel and passed **89 / 89** in isolation — the same behaviour documented for V17.6.6 / V17.6.7.

| Stage | Result |
|---|---|
| TypeScript 5.8.3 `tsc -p tsconfig.json --noEmit` | **passed** (88 files from `src/main.ts`) |
| Lint | **passed** (88 files, no import cycles) |
| Security scan (source + `dist/index.html`) | **passed** |
| Production build / development build | **passed** (dist = root = release; `version.json` 17.6.8) |
| Node tests | **266 / 266** (236 existing + 30 new in `test/v1768.test.mjs`) |
| Browser V17.0 `browser_test.py` | 56 / 56 |
| Browser V17.4 / V17.5 / V17.5.1 / V17.5.2 / V17.5.4 / V17.5.5 | 120 / 120 · 84 / 84 · 59 / 59 · 89 / 89 · 47 / 47 · 75 / 75 |
| Browser V17.5.7 / V17.6.1 / V17.6.2 / V17.6.3 | 112 / 112 · 57 / 57 · 64 / 64 · 33 / 33 |
| Browser V17.6.5 / V17.6.6 / V17.6.7 | 35 / 35 · 34 / 34 · 33 / 33 |
| **Browser V17.6.8 `browser_test_v1768.py`** | **43 / 43** |
| UI comparison with V17.6.7 (`compare_v1768.py`, 16 pages × 2 widths + responsive panel) | **35 / 35** |
| Generated-artifact secret scan (`dist/`, `index.html`, `release/`) | passed — no credential pattern, no test password (Node test, browser L1, separate scan) |

#### Before / after TypeScript (the supplied CI log)
* **Before** (log `logs_103717775423.zip`, TypeScript 5.8.3, `include: src/**`): `npm run typecheck` → **247 errors in 33 files**, exit 2. Those 33 files are not in the V17.6.7 package (0 of 33 present) — they exist only in the repository.
* **Reproduced:** restoring 33 stand-in files at the logged paths in a copy of the package: V17.6.7's `tsconfig` → 127 errors of the same classes (`TS2305`, `TS2724`, `TS2339`, `TS7006`); V17.6.8's `tsconfig` → **0 errors**, exit 0; lint passes and names all 33 as orphans; `prune-orphans` lists them.
* **On the package itself:** V17.6.7 type-check 0 errors → V17.6.8 0 errors (88 files).

#### Admin Password tests → request
| Request | Node (`v1768`) | Browser (`v1768`) |
|---|---|---|
| 1 A saves centrally | `1.` | A1, A2 |
| 2–6 clean B: retrieves, applies before auth, central unlocks, `admin` rejected | `2./3./4./5./6.` | B1–B7 |
| 7 UI cannot bypass | `7.` (one unlock door, no literal comparison anywhere, ticket one-time / expiring, fail-closed) | — |
| 8 stale cached verifier refreshed | `8.` | C1–C3 |
| 9 default session invalidated | `9.` | D1–D4 |
| 10 change invalidates the previous password | `10.` | C3, F1 |
| 11 stale device cannot overwrite | `11.` | C4 |
| 12 unavailable repository: no default record | `12.` | G1–G4 |
| 13 invalid record does not enable `admin` | `13.` | I1, I2 |
| 14 compatible local records | `14.` | K1 |
| 15 V17.6.7 repositories compatible | `15.` | K1 |
| Startup race | `START-UP RACE`, bootstrap | J1, J2 |
| Manual Sync 1–9 | `S1`–`S9` | D3, E1–E6, F1, G1–G4, H1–H4 |

Also: publish-first change/reset; credential-refused provisional default; policy matrix; CI-log rectification; version stamps; unrelated source untouched.

#### Manual checks in a real browser
Desktop 1366 px: one Sync button between the existing sync controls; status chip Synced / Partly synced / Sync failed / Skipped with a tooltip per step. 390 px: the button moves into the navigation panel next to Sync Source / Sync Time. 800 px: no horizontal overflow.

#### Not exercised (stated, not simulated)
Real GitHub, the repository access service on Azure and the GitHub Actions run were not reachable from the build environment; repositories were emulated (in-memory, a GitHub stub, the real broker process, the real publication script). `package-lock.json` is still absent (registry blocked).
