# Verification report — V17.7.1

| Area | Required result | Result |
|---|---|---|
| Baseline | V17.7 confirmed as modification baseline | **Done** — the V17.7 source was reconstructed from the supplied bundles (228 files), type-checked, linted, built and tested unchanged first; V17.7.1 was built on it. The bundles did not contain: the 17 historical browser scripts, `package-lock.json`, build outputs. |
| UI | V17.7 UI preserved | **Done, tested** — 25 of 31 pinned UI files byte-identical (style sheet, favicon, Settings, repository cards …); 6 modules changed for the new menu / Home panel only; no CSS change |
| GitHub configuration | Available from Home + hamburger menu | **Done, browser-tested** (Home panel + settings link; hamburger → GitHub Repository; Schema → Pull Schema unchanged) |
| Token sync | Initialises without opening Pull Schema | **Done, browser-tested** with an *emulated* GitHub — the saved token is validated at start-up (read-only), re-checked when it changes, never blocks start-up. A real GitHub / Conditional-Access-protected organisation was **not** reachable |
| Pull Schema | Existing behaviour preserved | **Done** — same sequence, same service; tab and Home both tested; failing pull leaves the schema unchanged |
| Query Library | Hamburger entry added | **Done, browser-tested** |
| Add New Query | User submission workflow operational | **Done, browser-tested** — pending, exact SQL, duplicates, destructive / credential refused |
| Approval | Admin approval / rejection enforced | **Done, tested at the service level** — one-time Admin-Password ticket; direct calls refused. **Limit:** see below |
| Library view | User view without Admin controls | **Done, tested** — approved + enabled only; no admin control / metadata in code or DOM |
| Admin security | Admin operations remain protected | **Done** — Settings lock unchanged; no admin route; forced client flag does not authorize a decision |
| Error logs | Reviewed and applicable defects addressed | **NOT VERIFIED.** The archives' contents could not be read in this session; classification relies on the V17.7 review. No log concerns code changed here. See `ERROR_LOG_REVIEW_V17.7.1.md` |
| Existing features | Regression-tested | **Done** for the Node suite and the new browser regression section; the 17 historical browser suites were not available and were **not run** |
| NPM | No unsupported runtime dependency introduced | **Done** — no dependency added; no runtime npm/child-process/eval in new files (tested). `scripts/verify-no-npm.mjs` (run in a copy) passed clean, toolchain, typecheck and lint, then **stopped at `check:stale`** (the 17 missing historical browser scripts), so its remaining stages did **not** run |
| Version | V17.7.1 | **Done** — package, `APP_VERSION`, writer label, NLU label, About, README, navbar badge, `release/version.json` |
| Release package | Complete build / package produced | **Done with stated gaps** — `SQL-Assistant-V17.7.1.zip` (source, `dist/`, `release/`, `dev-dist/`, tests, docs, browser results, `rollback/SQL-Assistant-V17.7.zip`). Gaps: no `package-lock.json`, no 17 historical browser scripts (not in the bundles) |
| Rollback | Previous working V17.7 recoverable | **Done** — `rollback/SQL-Assistant-V17.7.zip` (reconstructed V17.7.0 with its own built `dist/` / `release/`); `docs/ROLLBACK_V17.7.1.md` |

## Architectural limitation (must be read)
Approval is enforced **inside the application** (Admin Password check at the moment of the decision, service-level refusal, no UI path). Because SQL Assistant is a static client-side application whose shared data is JSON in a repository, **anyone whose connection can write to `sql-assistant-data/` can alter shared files directly** — this was already true for the Admin Query Library in V17.7. Real enforcement of "only administrators may publish to the shared library" is the repository's write permission (or a server-side approval API, which this project does not have). Give ordinary users read-only access. Details: `docs/QUERY_LIBRARY.md`.

## Not verified / not done
Real GitHub / GitHub Actions / Azure / deployed site · the contents of the four error-log archives · the 17 historical browser suites · `npm ci` (no lockfile; registry not reachable) · browsers other than Chromium.
