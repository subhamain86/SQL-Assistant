### SQL Assistant 17.6.5 — central Admin Password

**Goal.** A change of the Admin Password on one device applies to all devices; Settings → Security gets **Save (all devices)** and **Reset to default** (central). Everything else is unchanged.

#### Baseline
`SQL-Assistant-V17.6.4.zip` (attached; the latest source and the last-known-good UI). Run unchanged first: lint, production build, `npm run security`, **172/172** Node tests and **795/795** browser checks (11 suites, Chromium) passed. Only the files below were changed; nothing was taken from an older version. The V17.6.2 central PAT broker, the V17.6.3 published data and vault and the V17.6.4 fixes and workflows are kept.

#### What changed
| Requirement | Implementation |
|---|---|
| **A. Central record (encrypted)** | `sql-assistant-data/security/admin-credential.json` — a versioned envelope (`format`, `formatVersion`, `revision`, `updatedAt`, `updatedBy`, `isDefault`) around the **existing** encrypted marker (PBKDF2-SHA-256 + AES-256-GCM, same format as `sqla.pwvault.v15`). The password is never stored in any form. Verification is unchanged (the entered password must decrypt the marker). **Strict parser** (`adminCredential.ts`): exact keys / types / Base64 sizes, ≤ 4 KB, `isDefault` ⇔ marker; a damaged, unknown-version or tampered record is refused and the device keeps its last good record. |
| **B. Sync** | Read: the published copy (V17.6.3, SHA-256 checked) so a device with no token can verify; a device with a sign-in / token reads a fresh copy. Write: only through the authenticated route (broker session or device token), **read back and compared** before success. Refresh at app start, when the tab becomes visible, at the scheduled sync, on *Sync with GitHub Now*, and **once when an unlock fails** (a password changed elsewhere works at once and does not count as a wrong attempt). Last good record cached for offline use. **Rollback protection** (higher revision, time stamp not older; older revision or same revision with other content refused; told once). **Migration:** no central record ⇒ exactly V17.6.4; first Save creates it; a differing local password is never overwritten (the central one wins, explained once, and the old local password is recognised only to say so). 5-minute re-lock and every protected action kept. **Lock-out:** after 5 wrong attempts 60 s, doubling to 15 min (kept across reloads). |
| **C. Save** | *Save (all devices)* verifies the current password, applies the policy (≥ 10 characters, not `admin`), writes, reads back, then reports success; a failure names the step and kind (sign-in, permission, network, conflict, …) and leaves this device and the repository unchanged. Strength indicator, Show/Hide, `autocomplete="new-password"`. With no write route it says so plainly; the V17.6.4 *Change Password* (device only, 4 characters) remains — and is refused while a central record exists, because it would be ignored. |
| **D. Reset to default** | Button + confirmation ("This sets the Admin Password to the default `admin` on every device."). Authorized by the **current Admin Password** or a **GitHub sign-in with write access** (forgotten password); refused for a read-only sign-in and for a wrong password. Writes a new record (`isDefault: true`, higher revision), read back and published like any change. Afterwards every device shows the default-password warning; an unlocked session on another device ends at its next refresh; the first Save replaces the default record. The Danger Zone reset uses the same flow when a central record exists, else its V17.6.4 local behaviour. |
| **Security constraints** | `npm run security` now also fails on a plaintext password literal, a password-like value written to storage, a Base64-encoded password, a password in a JSON body / request / URL, and an invalid `admin-credential.json`. The broker refuses (422) any non-conforming write to the credential path. `publish-data.mjs` publishes the record only when valid (an invalid one never replaces the published copy; the last good one stays listed). No password in console, requests, logs, the vault export, the schema file or the admin message (tests). CSP unchanged. All dynamic text goes through `e()` (checked in source and with a hostile message in the browser). |
| **Deployment** | `publish-data.yml` publishes `security/admin-credential.json` (trigger includes `sql-assistant-data/security/**`; last step fails by name if it is not published). No GitHub Pages dependency. Rollback in `DEPLOYMENT.md`. |

#### Files
| File | Change |
|---|---|
| `src/v17/services/adminCredential.ts` | **new** — record format, strict parser, serializer, builder, consistency check, rollback rule, policy, strength |
| `src/v17/services/adminCredentialService.ts` | **new** — refresh, verify-with-refresh, Save, Reset (injectable I/O) |
| `src/ui/adminCredentialSync.ts` | **new** — triggers, toasts, ends an unlocked session after a remote reset |
| `src/services/passwordService.ts` | central-aware verification, lock-out; V17.6.4 behaviour when no record; local marker never touched |
| `src/ui/pages/settings.ts` | Security tab (Save, Reset + dialog, strength, status line), lock screen messages, Danger Zone reset, lock-out notes |
| `src/ui/context.ts`, `src/main.ts` | service wiring, authenticated route / write route, refresh triggers |
| `src/ui/components/passphraseField.ts` | optional `noun` / `autocomplete` (defaults byte-identical) |
| `src/ui/pages/schemaRepoCards.ts`, `adminLibrary.ts` | lock-out note on the existing password prompts |
| `src/services/storage.ts`, `src/v17/services/repoBroker.ts` | two storage keys; one broker error text |
| `server/repo-broker.mjs` | server-side check of the credential record |
| `scripts/publish-data.mjs`, `scripts/security_check.mjs`, `.github/workflows/publish-data.yml` | publish / scan / workflow |
| `public/styles.css` | **additive** rules only (strength meter, mobile buttons); no existing rule changed |
| `test/v1765.test.mjs` (35 tests), `scripts/browser_test_v1765.py` (76 checks), `scripts/compare_v1765.py` | new; older tests / browser scripts: version expectations only |
| `package.json` | version 17.6.5; `test:browser` includes the new suite; `compare` points to `compare_v1765.py`; `verify` now builds **before** `npm run security` (the scan reads `dist/index.html`; the V17.6.4 order failed after `clean`) |
| docs | this file, `TEST_REPORT_V17.6.5.md`, `REGRESSION_BASELINE_V17.6.5.md`, `SECURITY.md`, `DEPLOYMENT.md`, `SOURCE_PROVENANCE.md`, `README.md` |

**Not changed:** SQL generation, selectors, NLU, learning, Admin Query Library, schema handling, the three Pull Schema cards, repository configuration, vault envelope and key derivation, published-copy logic, the broker's sign-in / read / write logic, every existing storage key, file format and encryption parameter.

#### Limitations (also in `SECURITY.md`)
Anyone with write access to the repository can replace the central record (including a reset to default) — enable branch protection and a `CODEOWNERS` rule on `sql-assistant-data/security/**`; while a reset is in force the password is publicly known by design; the published record can be attacked offline, so use a long password; the lock-out protects the UI only. Verified against emulated GitHub / site / broker host, not the real ones — see `TEST_REPORT_V17.6.5.md`.
