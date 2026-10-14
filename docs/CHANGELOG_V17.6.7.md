### SQL Assistant 17.6.7 — new-device Admin Password: Settings authentication (single-defect release)

**Baseline.** `SQL-Assistant-V17.6.6.zip` (attached; sole baseline and last-known-good UI). Run unchanged first: type-check, lint, production build, **216/216** Node tests.

#### Defect
On a newly installed device, Settings authentication kept accepting the default `admin` although a centrally synchronized Admin Password existed.

#### Root cause (reproduced on the unchanged V17.6.6 build, in a real browser)
The complete workflow was reviewed (start-up, first run, new-device initialization, login validation, Settings unlock, verification service, synchronization start-up sequence, repository download, central password loading, cached credentials, local storage, security bootstrap). V17.6.6 already asks the central record before it accepts the default **at the moment a password is checked** — and that part works in every connection mode (token, published copy, central access): MyCentralPassword unlocks and `admin` is rejected. The defect is in what happens **around** that check:

1. **The unlocked Settings session outlived the moment the central password became known.** A clean device has no repository connection, so — to be able to configure one at all (token, repository, GitHub sign-in) — the default is accepted and Settings are unlocked with `admin`. Configuring the repository and pressing *Sync with GitHub Now* (which lives **inside** Settings, so the user is necessarily in a session opened with `admin`) then applied the central password — but the already-unlocked session was never invalidated. "Open Settings" showed Settings unlocked: the application kept **authenticating with `admin`**. Reproduced: V17.6.6, token mode and published-copy mode (`repro_base.py`, section 3 of the report): after the sync the status reads *synchronized (revision 1)* and Settings are still unlocked on the default session; only a fresh unlock rejects `admin`.
2. **The lock screen told the user that `admin` is the password** ("First use: the default password is admin…") on a device that had simply not yet fetched the central record — an invitation to type it.
3. **No visibility.** Nothing recorded whether the default had been accepted *because no central record exists* or *because the central record could not be reached*, so neither the user nor a test could tell the cases apart.
4. **Not a code defect, but a real limit:** a device that cannot reach the repository at all (no token, no GitHub sign-in, not served from a published copy) cannot know that a central password exists. There the default must stay valid or the first device could never be configured (the V17.6.2 contract: "the administrator authentication works without any GitHub token and no sign-in"). The fix makes this case explicit instead of silent.

#### Fix
| File | Change |
|---|---|
| `src/services/passwordService.ts` | Records the **basis** of every accepted check (`central` / `local` / `default-confirmed` = the central read succeeded and no record exists / `default-unverified` = accepted without a successful central read); remembers the basis of the Settings session; secret-free in-memory authentication trace (diagnostics). `verifyPassword()` logic and the marker format are unchanged. |
| `src/v17/services/adminPassword.ts` | `onAdopt()` event (a central record was applied and it changed the local state); `refreshForLogin()` now reports whether the central state is known; `recheckSession()` (one throttled synchronization when Settings are shown on a default session); `diagnostics()`; trace events. Record format, paths, merge rules, publication: unchanged. |
| `src/main.ts` | One listener: when a central (non-reset) password is applied while the Settings session was opened with the default, **Settings are locked again** with an explanatory toast; e2e-only diagnostics hook. |
| `src/ui/pages/settings.ts` | The unlock marks the session basis and — when the default was accepted without a successful central read — says so (toast: could not be checked, why, retry with *Sync with GitHub Now*); the lock screen asks for the central record straight away and removes the (now wrong) "default password is admin" hint when it was applied; the unlocked Settings page re-checks on a default session. No markup, layout or style change. |
| Version 17.6.7 | `package.json`, `APP_VERSION` (→ footer, writer stamp, `release/version.json`), `offline-nlu-17.6.7`, About, README, docs, test / script expectations. |
| Tests | `test/v1767.test.mjs` (20), `scripts/browser_test_v1767.py`, `scripts/compare_v1767.py`; `v1765` browser script: the V17.6.6 lock-screen-hint assertion now expects the hint to disappear (intended); `v1766` Node test: version-stamp assertions moved to `v1767`; version expectations 17.6.6 → 17.6.7. |

**Not changed:** UI design / layout / styles (`public/styles.css` byte-identical; page markup identical), Secret Vault, repository settings and structure, GitHub integration, broker, schema synchronization, SQL generation, query engine, NLU, learning, Admin Query Library, workflows, deployment logic, the encrypted marker (`sqla.pwvault.v15`, PBKDF2-SHA-256 150 000 / AES-GCM), the record format and path, the migration logic.

#### Authentication precedence (as implemented)
1. A valid central record (applied on this device before the password is checked; the unlock waits for a running synchronization).
2. A valid local marker (an existing installation).
3. The default `admin` — only when no record exists anywhere (central read succeeded, none found) **or** the central record cannot be read at all; in the second case it is recorded as unverified, the user is told, and the session is locked again the moment a central password is applied. `admin` never takes precedence over a central password that is known.
