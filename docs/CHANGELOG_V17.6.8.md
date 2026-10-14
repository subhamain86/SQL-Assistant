### SQL Assistant 17.6.8 — centralized Admin Password enforced at the authentication boundary + navbar Sync button + CI build fix

**Baseline.** `SQL-Assistant-V17.6.7.zip` (latest and sole implementation baseline). Nothing was rebuilt from an older release. Run unchanged first: type-check (TypeScript 5.8.3), lint, security scan, production build, 236 Node tests, browser suites V17.0 → V17.6.7 — all passed.

#### 1. The CI failure in `logs_103717775423.zip`
`npm run typecheck` (TypeScript 5.8.3, exit 2) reports **247 errors in 33 files** — `src/components/*`, `src/pages/*`, `src/engines/{schemaIntegrity,schemaVersion,…}Engine.ts`, `src/state/store.ts`, `src/services/{syncService,aiService,…}.ts`, `src/ui/views/*`, `src/ui/adminCredentialSync.ts`, `src/v17/services/adminCredential.ts`, `src/v17/services/adminCredentialService.ts` …
**None of those files exists in the V17.6.7 package** (checked file by file: 0 of 33), and nothing in `src/main.ts` imports them. They are left-overs of earlier versions (and of a partial admin-credential attempt) that live in the GitHub repository, because publishing a version by copying a package over the repository never deletes what the new version dropped. `tsconfig.json` had `include: ["src/**/*.ts"]`, so `tsc` compiled the left-overs and failed. The "missing exports" in the log (`schemaService`, `Route`, `Theme`, `checkPassword`, `adminCredential` storage keys, …) belong to that older architecture — the V17.6.7 contract never had them, so nothing was re-invented.

| Item | Change |
|---|---|
| `tsconfig.json` | `include: ["src/**/*.ts"]` → `files: ["src/main.ts"]` (the application entry point; every import is followed). **Every compiler option is unchanged** (`strict`, `noImplicitReturns`, target, module, `moduleResolution`, TypeScript 5.8.3). No `@ts-ignore`, no `any` widening, no `noImplicitAny` change, no test removed. |
| `scripts/source-set.mjs` (new) | The production source set = what `src/main.ts` imports; the rest are **orphans**. |
| `scripts/lint.mjs`, `scripts/security_check.mjs` | Scan exactly that set and **print every orphan by name** (a note, never silent). |
| `scripts/prune-orphans.mjs` (new), `npm run prune-orphans` | Lists the orphans; `-- --delete` removes them. **Recommended once, in the repository:** `npm run prune-orphans -- --delete`, commit. |
| `package.json` `verify` | `build` runs **before** `security` (as `deploy-pages.yml` already does): the security scan reads `dist/index.html`, which `clean` had just deleted. |
| `scripts/verify-no-npm.mjs` (new), `npm run verify:no-npm` | The same stages without npm (registry 403 / a global TypeScript 6 that rejects `moduleResolution: node`). |

#### 2. Centralized Admin Password — root cause
V17.6.5–V17.6.7 each added a synchronization step *around* the check; none changed what the check itself may accept.
1. **The boundary was open.** `verifyPassword()` fell back to the default whenever the device had no local marker *and* the central read did not succeed — a new device, a slow/failed read, an invalid record, a published copy without the record, or a token for which GitHub answers "not found" (a private repository the token cannot see looks exactly like "no record"). A new-device state was treated as proof that `admin` is valid.
2. **No explicit bootstrap state.** The unlock could run before, or independently of, the start-up synchronization.
3. **Authorization lived in UI state.** `unlockSettings()` could be called by anyone; the re-lock existed only for a *default* session and a *changed, non-reset* record; a repository-configuration editor unlocked in memory, or a session opened with an older central password, survived.
4. **Changes were applied locally first.** *Change / Reset* wrote the local marker, then tried to publish; a device that was behind or offline could create local state that later raced the central record.

#### 3. Fix (at the authentication layer — no further synchronization workaround)
| File | Change |
|---|---|
| `src/services/passwordService.ts` | `verifyPassword(candidate, purpose)` is THE boundary: asks the registered `PasswordAuthority` first and obeys `defaultAllowed`; `loading` blocks; no authority ⇒ fail closed. One-time **unlock ticket** (30 s). `invalidateAdminSession()` / `onAdminSessionInvalidated()` — one door for every cached authorization. `authBlockedMessage()`. `buildVerifier()` / `validateNewPassword()` (same PBKDF2-SHA-256 → AES-256-GCM format). Marker format and local primitives unchanged. |
| `src/v17/services/adminPassword.ts` | `AdminPasswordService` is the authority: explicit bootstrap state `loading → central-applied \| local-fallback \| default-unverified \| error`; `bootstrap()` (one run per page session) → `resolve()` waits for it and refreshes a stale verifier. The default is allowed only for a central reset record, a repository/published copy that answered "no record" (an authoritative "not found" must be verified), a standalone device with no central source, or a device whose **own credential is refused** (it must stay repairable) — provisional, and invalidated when a central password is applied. **Publish-first** `change()` / `reset()` (revision + 1, optimistic concurrency, read back, applied locally only afterwards; a higher revision that appears meanwhile wins; refused when the central state cannot be read or the connection is read-only). Record format, paths, merge rules unchanged. |
| `src/ui/state.ts` | `unlockSettings()` consumes the ticket (returns `null` without one); `lockSettings()` clears the session basis. |
| `src/ui/pages/settings.ts` | The unlock first uses the existing repository authorization path (sign-in when central access has no session), then `verifyPassword(…, 'settings-unlock')`; a blocked check says why and names the Sync button; the "default is admin" hint appears only when the authority allows it; reset failures are reported. No markup/layout change. |
| `src/ui/pages/schemaRepoCards.ts`, `adminLibrary.ts`, `src/v17/services/repositoryConfig.ts` | Honest message when a check is blocked; the repository-configuration editor drops its in-memory password when the admin session is invalidated. |
| `src/ui/context.ts`, `src/main.ts` | Source (authoritative / published / none) and standalone state decided in the one place that decides the repository; authority registered; bootstrap on **every** start; one invalidation listener re-locks Settings. |

#### 4. Navbar Sync
`src/v17/sync/centralSync.ts` (new) calls the **existing** services in a fixed order — Admin Password, schemas + synchronization metadata, knowledge, admin message — and *reports* the Secret Vault (never changes it: it needs its passphrase). It contains no synchronization, network, storage or credential code. One run at a time; each step has its own status; overall `Synced / Partly synced / Sync failed / Skipped`. `src/ui/components/navbar.ts` adds one button + status chip in the existing sync cluster and the same action as the first entry of the sync block in the responsive panel; `public/styles.css` gains 1 440 appended characters (no existing rule changed).

#### 5. Behaviour changes (intended)
* The default `admin` is no longer accepted by a managed device that cannot read the central record (previously: accepted as "unverified"); the lock screen says why. A standalone device (no central access service, no publication, no token) and a device whose own credential is refused still accept it, provisionally.
* *Change / Reset Admin Password* with an unreachable / read-only / unreadable central record is refused instead of being applied locally; nothing changes on the device.
* A central verifier that differs from the one the device held re-locks Settings whatever the session was opened with.

**Not changed:** SQL generation, query logic, schema formats, Secret Vault formats and security, repository configuration and paths, GitHub authentication architecture, offline NLU, learning, Admin Query Library, Settings controls and tabs, workflows (`.github/workflows/*`), styles other than the appended Sync rules.
