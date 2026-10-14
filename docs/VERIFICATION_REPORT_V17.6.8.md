### Verification report — SQL Assistant 17.6.8

**Baseline:** `SQL-Assistant-V17.6.7.zip` (latest and sole baseline). Full results: `TEST_REPORT_V17.6.8.md`; changes: `CHANGELOG_V17.6.8.md`; comparison: `REGRESSION_BASELINE_V17.6.8.md`.

#### 1. Root cause of the centralized Admin Password defect
`verifyPassword()` accepted the default `admin` whenever a device had no local marker and the central read had not succeeded (new device, slow / failed read, invalid record, published copy without the record, a token for which GitHub answers "not found"). The central state was consulted *as an optional refresh* around the check instead of *as the authority of the check*; no bootstrap state existed, so a check could run before the central record was loaded; Settings authorization lived in UI state that anyone could set and that only one case re-locked; *Change / Reset* applied locally before publishing. V17.6.5–V17.6.7 added synchronization around this; none closed the boundary.

#### 2. Exact Admin authentication changes
1. `verifyPassword(candidate, purpose)` asks the registered `PasswordAuthority` first; `loading` ⇒ blocked; no authority ⇒ fail closed; the default is tried only when the authority says `defaultAllowed`.
2. `AdminPasswordService` is the authority: states `loading → central-applied | local-fallback | default-unverified | error`; `bootstrap()` once per page session on every start; `resolve()` waits for it and refreshes a stale verifier.
3. Default allowed only for: a central reset record · a repository / hash-verified published copy that answered "no record" (an authoritative "not found" is verified first) · a standalone device with no central source · a device whose own repository credential is refused (provisional, invalidated when a central password is applied). Never for: a new device by itself, loading, a failed/slow read, an invalid record.
4. Settings open only with the one-time ticket of a successful `verifyPassword(…, 'settings-unlock')` (`AppStore.unlockSettings()`); one unlock door in `settings.ts`.
5. A central verifier that differs from the one held calls `invalidateAdminSession()` → Settings re-lock, ticket and basis cleared, repository-configuration editor drops its in-memory password.
6. Change / Reset: central state known → current password verified → new verifier built (same PBKDF2-SHA-256 → AES-256-GCM format) → published as revision + 1 with optimistic concurrency and read back → applied locally; failure leaves the device untouched; a stale device cannot overwrite a newer revision; an unreachable repository never creates a default record.
7. Unchanged: `sqla.pwvault.v15`, `sqla.adminpwmeta.v1765`, record format, path, PBKDF2 / AES-GCM, rollback compatibility; no plaintext password is stored, sent, bundled or logged (tests B7, L1, L3, Node 1).

**Admin credential files in the CI log.** `adminCredential.ts`, `adminCredentialService.ts`, `adminCredentialSync.ts` (with `Services.credential`, `checkPassword`, `recordAttempt`, `adminCredential` storage keys …) are an abandoned parallel design that exists only in the repository. In V17.6.7/V17.6.8 the credential service is `AdminPasswordService`, registered as `services().adminPassword` and as the `PasswordAuthority`; no second service exists. They are listed by `prune-orphans` for deletion.

#### 3. Files changed
Source: `src/services/passwordService.ts`, `src/v17/services/adminPassword.ts`, `src/ui/state.ts`, `src/ui/context.ts`, `src/main.ts`, `src/ui/pages/settings.ts`, `src/ui/pages/schemaRepoCards.ts`, `src/ui/pages/adminLibrary.ts`, `src/v17/services/repositoryConfig.ts` (message only), `src/ui/components/navbar.ts`, **new** `src/v17/sync/centralSync.ts`; version: `src/v17/sync/schemaFormat.ts`, `src/v17/engines/nluEngine.ts`, `src/ui/pages/other.ts` (About). Style: `public/styles.css` (appended only). Build/config: `tsconfig.json`, `package.json`, `scripts/lint.mjs`, `scripts/security_check.mjs`, **new** `scripts/source-set.mjs`, `scripts/prune-orphans.mjs`, `scripts/verify-no-npm.mjs`. Tests/scripts: **new** `test/v1768.test.mjs`, `scripts/browser_test_v1768.py`, `scripts/compare_v1768.py`; updated expectations listed in `REGRESSION_BASELINE_V17.6.8.md`. Docs. Generated: `dist/`, `index.html`, `release/`.

#### 4. Build / type errors discovered and their corrections
See CHANGELOG §1 and the before/after in TEST_REPORT. Cause: 33 left-over files in the repository, not in the package. Correction: `tsconfig` compiles from the entry point with all strict options unchanged; lint and security scan the same set and name every orphan; `prune-orphans` removes them; `verify` builds before the security scan. No `@ts-ignore` / `@ts-nocheck`, no `any` widening, no strictness change, no removed test, no changed workflow, no CI exit-code change.
**Please run once in the repository:** `npm run prune-orphans -- --delete`, commit. (If you prefer the type-check to fail on leftovers, tell me and I will make `lint` fail on orphans.)

#### 5. Sync-button implementation
`centralSync.ts` runs the existing services in order (Admin Password → schemas + metadata → knowledge → admin message), reports the Secret Vault, one run at a time, per-step status, overall Synced / Partly synced / Sync failed / Skipped (never "Synced" if a required operation failed). It reuses `ensureRepositoryAccess` (central session → published copy → device token). A new central verifier applied during the run invalidates stale Settings sessions.

#### 6. New-device / cross-device results
Browser B1–B7 (clean device: `admin` rejected, central password accepted, applied before authentication, no cached password), C1–C4 (stale cache refreshed, stale device cannot overwrite), D1–D4 (session opened with the default is invalidated), J1–J2 (startup race on the real published copy), K1 (existing V17.6.7 device). All pass.

#### 7. Security
Security scan passed; bundle / artifact secret scans passed; no console output, no dynamic code, CSP unchanged; Sync module has no network / storage / credential code (Node S7); messages redacted.

#### 8. Known limitations
* A standalone device (no central access service, no publication, no token) must accept the default or the first device could never be configured; it is provisional and re-locked when a central password is applied. Likewise a device whose own repository credential is refused can still repair it with the default.
* A published-copy device sees a changed password only after the *Publish SQL Assistant data* workflow ran; it cannot publish (no token).
* Real GitHub / Azure / Actions were not exercised here; after deploying, on a clean browser profile configure the repository and open Settings — `admin` must be rejected.
* `package-lock.json` is absent.

#### 9. Unrelated changes
None: SQL generation, query logic, schema formats, Secret Vault, repository configuration and paths, GitHub authentication architecture, offline NLU, learning, Admin Query Library, Settings controls, workflows are unchanged; the V17.6.7 UI is identical except for the Sync control (35 / 35 comparison checks).
