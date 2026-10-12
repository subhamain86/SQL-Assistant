### Test report — SQL Assistant 17.6.4

Baseline: `SQL-Assistant-V17.6.3.zip` (attached). Run **unchanged first**: lint, production build, 167/167 Node tests passed. `tsc` 6.0.2 (the only `tsc` on `PATH`) failed `tsconfig.json` with TS5107; TypeScript **5.8.3** (pre-installed, now the pinned version) passed.

The stages were run as the underlying `node` commands **in the new workflow's order** (npm cannot reach the registry here: HTTP 403).

| Stage (new workflow order) | Result |
|---|---|
| TypeScript version check (must be 5.x) | 5.8.3 — passed |
| Typecheck (`tsc -p tsconfig.json --noEmit`) | passed |
| Lint (86 files, no import cycles) | passed |
| Build | passed — `dist/index.html`, `release/`, 775 KB, 17.6.4 |
| Security check (after the build) | passed |
| Security check **before** a build on a copy without `dist/` (the old order) | **fails** with "dist/index.html is missing — run npm run build first" — reproduces the defect |
| Node tests | **172 / 172 passed** (167 existing + 5 new in `test/v1764.test.mjs`) |
| Final production build | passed |
| Workflow YAML (4 files) | parsed with a YAML parser; asserted by `v1762`, `v1763`, `v1764` tests |
| `public/styles.css` | byte-identical to V17.6.3 |
| Built page vs. V17.6.3 build | identical except version strings and the new first About entry (1 line) |

Notes
* One test (`v1753`, "content differs") is flaky in V17.6.3 — it failed in 1 of 3 full runs here and passed when re-run; fixed (see the changelog).
* **Browser tests (Playwright): NOT run** — no Chromium installed. Version expectations in the scripts were moved to 17.6.4; run `npm run test:browser`.
* **No GitHub Actions run was executed.** The fix is unverified until the workflow runs on GitHub.
