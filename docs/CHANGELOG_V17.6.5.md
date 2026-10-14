### SQL Assistant 17.6.5 — centralized Admin Password + Reset Admin Password to Default

**Baseline.** `SQL-Assistant-V17.6.4.zip` (last known good UI). Run unchanged first: type-check, lint, production build, 172/172 Node tests passed.

#### Changes
| # | Change | Files |
|---|---|---|
| 1 | **Centralized, synchronized Admin Password.** One encrypted record in the repository (`sql-assistant-data/security/admin-password.json`); every device converges on it at start-up, scheduled sync, tab-visible, *Sync with GitHub Now* and at the unlock check. Fresh installs, V17.6.4 upgrades, offline / read-only / conflict cases handled; backward compatible (same local marker key and format). See `docs/ADMIN_PASSWORD.md`. | `src/v17/services/adminPassword.ts` (new), `src/services/passwordService.ts` (blob primitives + refresh hook; V17.6.4 behaviour kept), `src/services/storage.ts` (one key), `src/ui/context.ts`, `src/main.ts` |
| 2 | **Settings → Security → Reset Admin Password to Default**: confirmation dialog → `admin` → published centrally at once → Settings re-locked → insecure-password warning; nothing else changed. Security tab also shows a *Central synchronization* status line. The Danger Zone's reset now goes through the same central path. | `src/ui/pages/settings.ts` |
| 3 | **Recovery script** for a forgotten password: writes a default record with revision + 1. | `scripts/reset-admin-password.mjs`, `package.json` |
| 4 | **Version 17.6.5**: `package.json`, `APP_VERSION`, footer, About (new first entry), release metadata (`release/version.json`), NLU label `offline-nlu-17.6.5`, writer label, build output, docs. | see list in `docs/TEST_REPORT_V17.6.5.md` |
| 5 | Tests: `test/v1765.test.mjs` (23), `scripts/browser_test_v1765.py` (35 checks), `scripts/compare_v1765.py`; older tests / browser scripts: version expectations only (17.6.4 → 17.6.5; `v1764`'s version-stamp test now asserts the About history and `v1765` asserts the stamps). | `test/`, `scripts/` |

**Not changed (byte- or markup-identical, see `REGRESSION_BASELINE_V17.6.5.md`):** GitHub synchronization, Secret Vault (envelope, derivation, Push / Pull), token-free retrieval and published copy, central access service, schema synchronization, SQL generation, CASE/DECODE, offline NLU logic, learning engine, Admin Query Library, layouts, routing, `public/styles.css`, all workflows, build script.

#### Behaviour notes for administrators
* Opt-out is not needed: without any repository connection the Admin Password behaves exactly as in V17.6.4 (local), and the Security tab says so.
* The first device with a custom password that synchronizes after the upgrade defines the central password. Devices with other custom passwords are told they were replaced.
* A device that can only read (published copy) applies the central password but cannot publish a change; it keeps it pending and says so.

#### Rollback to V17.6.4
Deploy the V17.6.4 package. The local marker (`sqla.pwvault.v15`) keeps its V17.6.4 format and the last synchronized password; V17.6.4 ignores `sqla.adminpwmeta.v1765` and `…/security/admin-password.json`. After a rollback the password is device-local again (as in V17.6.4).
