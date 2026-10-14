### Admin Password — V17.7: how the default is confirmed (read this first; the sections below describe the history)

**Rule.** `admin` is compared with a candidate in exactly one function (`verifyDefault`, `src/services/passwordService.ts`), reachable only when `AdminPasswordService` reports the state `confirmed-default`. Everything else compares the stored marker (`verifyStored`), which never falls back to the default. UI modules never decide about `admin` (a test scans every production module).

**The default is allowed only by evidence:**
| Evidence | Default? |
|---|---|
| The **authoritative** repository (central access service, a token that sees the repository, a test repository) answered "no record" **and this device never applied a central record** | yes — first-time installation |
| The central record is an explicit reset (`isDefault: true`), applied or already in force | yes |
| New / clean device, empty local storage, no connection yet, synchronization pending or running | **no** |
| Network / repository / credential failure, repository not verifiable, record unavailable, record invalid or newer format, tampered published copy | **no** |
| Published copy lists no record (it can be older than the repository) | **no** |
| Authoritative repository answers "no record" **but this device applied a central record before** (a vanished record is not a reset) | **no** |
| An applied central **verifier** and no marker on this device (cleared / damaged storage) | **no** — the verifier is applied again at once |
| A stale or empty local marker | **no** |

**One service.** Settings login / unlock, Security tab, protected Admin functions, Admin Query Library, repository configuration, token change, password change and reset all end in `verifyPassword()`. Start-up, manual Sync, automatic synchronization, tab visibility and reload only *synchronize* (they apply the central record through the same service and re-lock a session that rests on a replaced verifier). Settings open only with the one-time ticket of a successful `verifyPassword(…, 'settings-unlock')`.

**Fail closed.** While the central state is unknown (`loading`, `error`) Settings stay locked; "unknown" is never turned into "use admin".

**No NPM at runtime.** Retrieving, synchronizing, validating, changing and resetting the Admin Password uses only the repository abstraction: the central access service, a saved token, or the published copy (same-origin static files). The deployed page is a self-contained HTML file; it needs no Node.js, npm, `npx`, TypeScript, `node_modules` or development server (tested in a real browser against a plain static file server, `scripts/browser_test_v177.py`). npm remains a build / test tool only.

**Production page.** It contains no test hook: `?e2e=1` does nothing, `window.__sqla` / `window.__sqlaRequire` / `window.define` do not exist. The hooks are in `src/testHooks.ts` and only in the test build (`npm run build:test` → `test-dist/`, never deployed).

**Locked out because the central record vanished?** A device that applied a central record before refuses the default when the record disappears from the repository. Restore the record, or publish a reset (`npm run reset-admin-password`, commit, push), or — for one device — clear the site data (it then behaves as a new device).

---

### Admin Password — centralized and synchronized (V17.6.5; new-device rules V17.6.6)

**What changed.** Until V17.6.4 every device kept its own Admin Password marker in browser storage, so a password changed on one device did not exist on the others. From V17.6.5 there is **one authoritative, encrypted record in the repository**, and every device converges on it.

| | |
|---|---|
| File | `sql-assistant-data/security/admin-password.json` (derived from the schema path: `…/schemas/registry.json` → `…/security/admin-password.json`) |
| Travels through | the same repository connection as every other synchronization — the central access service, a saved token, or the published copy (`repository()` in `src/ui/context.ts`). No new credential, no new endpoint, no new authentication path. The broker's path prefix, the publication rules (`*.json` below `sql-assistant-data/`) and the repository safety scan already allow it. |
| Content | `format`, `formatVersion`, `revision`, `isDefault`, `verifier`, `updatedAt`, `updatedByDevice`, `appVersion`. **No password.** `verifier` is the encrypted verification marker V17.6.4 already kept in browser storage (PBKDF2-SHA-256 150 000 → AES-256-GCM of a fixed marker, random salt and IV). A reset-to-default record has `isDefault: true` and `verifier: null` — nothing to decrypt. |
| On the device | unchanged: `sqla.pwvault.v15` (same format) + one new small entry `sqla.adminpwmeta.v1765` (revision, pending flag, last sha). **V17.6.4 ignores the new entry and the new file, so a rollback keeps the last synchronized password.** |

#### New devices (V17.6.6)
A device that has no local Admin Password marker asks the central record **before** it accepts any password (including the default `admin`). Precedence: **valid central record → valid compatible local record → default `admin`** (only when neither exists, or the central record cannot be read). While the start-up synchronization is still running the unlock check waits for it. A central record that cannot be read (unavailable, invalid, unreadable) is never overwritten or deleted; the device keeps its local behaviour, the Security status line and a toast name the reason, and nothing is reported as synchronized; *Sync with GitHub Now* retries. A repository connection that appears after start-up (GitHub sign-in, token / vault restore) is used by the very next unlock check (Pull Schema, vault and sign-in make no extra request). Devices that read the **published copy** re-read the publication marker for this file, so a password changed later reaches an open page at the next synchronization. The record is published by the *Publish SQL Assistant data* workflow after a change — until it has run, a published-copy device cannot see the change.

#### Settings session opened with the default (V17.6.7)
Every accepted check records its **basis** — `central`, `local`, `default-confirmed` (the central read succeeded and no record exists anywhere) or `default-unverified` (accepted without a successful central read: no repository connection yet, or the read failed). A Settings session opened on a default basis **is locked again** when a central (non-reset) password is applied — at start-up, at a scheduled synchronization, on *Sync with GitHub Now*, when the Settings page is shown, or at the next unlock check — with a toast explaining why. When the default is accepted unverified the unlock says so (reason + retry). The lock screen asks for the central record as soon as it is shown and removes the "default password is admin" hint once the central password was applied.

**Diagnostics.** `window.__sqla.adminAuth.diagnostics()` (V17.7: available only in the separate test build `test-dist/` with `?e2e=1`; the production page has no such object) returns the status line, revision, pending flag, whether the central state is known, the last read problem and a secret-free authentication trace, for example: `sync:start → central:downloaded → central:loaded rev=1 default=false changed=true → login:central-state-known → auth:rejected / auth:accepted basis=central`. The trace holds event names and numbers only — never a password, marker or token. In normal use the same information is visible on **Settings → Security → Central synchronization** and in the unlock toast.

**Limit (superseded since V17.6.9).** *(V17.6.5–V17.6.8: a device that cannot reach the repository at all cannot know that a central password exists; there `admin` stayed valid — this no longer applies, see the table above.)* Original text: `admin` stayed valid (otherwise the first device could never be configured). Reach the repository first: a token (Schema → Pull Schema → GitHub repository), the GitHub sign-in (central access), or a site that serves the published copy.

#### Rules
1. **The central record is authoritative.** A device adopts it when its revision is newer, or equal but different. A device that never published (a fresh installation, or a V17.6.4 device) always adopts it.
2. **Changes are local first, then published.** *Change Admin Password* and *Reset to default* update this device, raise the revision and publish at once (optimistic concurrency: the file's sha is sent; a concurrent change is re-read and re-evaluated once). If publishing is impossible (offline, read-only published copy, no token) the change stays **pending** — the Security tab says so — and is retried at every synchronization.
3. **A pending change never overwrites a newer central record.** If the password was already changed centrally, the central one wins and the user is told.
4. **Where it is synchronized:** at start-up, at every scheduled synchronization, when the tab becomes visible again (throttled), on *Sync with GitHub Now*, and — so that a new password works immediately on a device that has not synchronized yet — **at the unlock check**: a password that does not match the local marker first fetches the central record once (throttled to once per 4 seconds) and is then checked again.
5. **Nothing is ever downgraded.** An absent or unreadable central file never resets a device: a device that holds a password republishes it; an invalid file (wrong format, newer format, bad fields) is ignored and the local password keeps working.
6. **Upgrade from V17.6.4.** A device with a custom password and no central record publishes it as revision 1; the first device to synchronize defines the central password and every other device adopts it (a device that had a *different* custom password is told that it was replaced). A fresh installation (default password, no record) publishes nothing.
7. **No secret leaves the device in readable form.** The record carries only the encrypted marker; the password is never stored, logged, placed in a URL or written to the repository.

#### Settings → Security → Reset Admin Password to Default
Opens a confirmation dialog (what happens, that the default is insecure, that nothing else changes). On confirmation: the Admin Password becomes `admin` on this device, the reset is **published to the central repository immediately** (`isDefault: true`), Settings **lock again**, and a warning says that the default password is insecure and must be changed immediately. **No other setting is touched** — repository configuration, Secret Vault, synchronization and application settings keep their values (browser test: storage snapshot before/after). The Danger Zone's *Reset password* button uses the same central reset, so no device-specific divergence is possible.

#### Administrator recovery (forgotten password, no device unlocked)
Run from a clone of the repository: `node scripts/reset-admin-password.mjs` (or `npm run reset-admin-password`). It writes a default record with revision *current + 1*; commit and push it (the *Publish SQL Assistant data* workflow then makes it visible to devices that read the published copy). Every device applies it at its next synchronization. Deleting the file does **not** reset anything (rule 5).

#### Limitations (honest)
* **Anyone who can write to the repository can replace the record** (that includes setting the default). Protect write access to the data repository; the broker only writes for callers GitHub reports as writers.
* The verifier is an *offline-attackable* artefact like the V17.6.4 marker: anyone who can read the repository can try passwords against it offline (PBKDF2 150 000 iterations). Use a long password; the default `admin` provides no protection at all. This is a property of the unchanged V17.6.4 marker, not new.
* A device that is **offline** keeps accepting the old password until it synchronizes; a device **without a write credential** (published copy only) can read and apply the central password but cannot publish a change (it stays pending and says so).
* If several V17.6.4 devices had *different* passwords, the first to synchronize after the upgrade defines the central one.
* Verified with an in-memory repository (Node, Chromium); **not** against real GitHub / Azure — see `TEST_REPORT_V17.6.5.md`.


#### V17.6.8 — enforced at the authentication boundary
* **One door.** `verifyPassword()` (`src/services/passwordService.ts`) asks the registered authority (`AdminPasswordService.resolve()`) before it compares anything. States: `loading` (checks wait), `central-applied`, `local-fallback`, `default-unverified`, `error`. Precedence: valid central record → valid compatible local marker (only when no central record can be applied) → default `admin` (only for a genuine first-time default).
* **When the default is allowed:** a central reset record; a repository or hash-verified published copy that answered "no record exists" (an authoritative "not found" must first be verified — a token that cannot see a private repository gets "not found" like a missing file); a standalone device with no central source at all (otherwise the first device could never be configured); a device whose **own** repository credential is refused (expired / revoked token, wrong repository — the repair needs the Admin Password). The last two are *provisional* (`default-unverified`) and are invalidated the moment a central password is applied. **A new device, a still-loading bootstrap, a slow/failed read (timeout, network) or an invalid record never enable it.**
* **Settings open only with a ticket.** `AppStore.unlockSettings()` consumes the one-time ticket issued by a successful `verifyPassword(…, 'settings-unlock')`; there is no other way to set `settingsUnlocked`.
* **Invalidation.** A central verifier that differs from the one the device held calls `invalidateAdminSession()`: Settings lock, the session basis and any ticket are cleared, the repository-configuration editor drops its in-memory password.
* **Publish first.** Change / reset: central state known → current password verified → new verifier built → written as revision + 1 with optimistic concurrency and read back → applied locally. Failure at any step leaves the device untouched. A higher central revision that appears meanwhile wins.
* **Navbar Sync** runs the same service (`adminPassword.synchronize()`) first, then schemas + metadata, knowledge and the admin message.
* **Diagnostics** (`?e2e=1`): `window.__sqla.adminAuth.diagnostics()` now also returns the bootstrap `state`, `defaultAllowed` and the connection `source`.


#### V17.6.9 — the default is CONFIRMED, never presumed
* **States:** `loading` · `central-applied` · `local-fallback` · `confirmed-default` · `error`. The provisional `default-unverified` state of V17.6.8 is gone.
* **`confirmed-default`** (the only state in which `admin` is a candidate; only `AdminPasswordService.resolution()` can report it): (a) an explicit central **reset** record (`isDefault: true`) was applied, (b) this device holds a reset that is not yet published, or (c) the **authoritative** repository (central access service with sign-in, a token that can see the repository, a test repository) answered "no record exists" **after** the repository itself was verified.
* **Never** enables the default: a new device without a repository connection (not an uninitialized installation), a device whose connection is refused (expired / revoked token, 401/403/404), a timeout / network failure, an invalid or newer-format record, a published copy that lists no record (it can be older than the repository), a bootstrap or synchronization in progress (`loading`), a conflict or a newer revision being applied.
* **`verifyPassword()`** (`src/services/passwordService.ts`) accepts the default only when `r.defaultAllowed && r.state === 'confirmed-default'`. A bare flag is not enough. No other module compares with the default or touches the verifier primitives (asserted by test over every file in `src/`).
* **Session invalidation, publication order, storage keys, record format, revisions: unchanged from V17.6.8.** `admin` stays valid for a session opened on the confirmed default only until a different central verifier is applied; then the session is invalidated and Settings re-lock.
* **Diagnostics** (`?e2e=1`): `window.__sqla.adminAuth.diagnostics()` → `state` is one of the five names above.

##### First-time initialization and recovery under the V17.6.9 policy (read this before deploying)
The default `admin` can only be *confirmed* by the repository:
| Deployment | How the default becomes valid for the very first administrator |
|---|---|
| **Central access service** (broker) or a **token that can see the repository** | the authoritative repository answers "no record" → `confirmed-default` automatically. With the broker, Settings start the GitHub sign-in first. |
| **Published copy only** (no token, no broker) | a published copy that lists no record is *not* proof (it can be older than the repository). Publish an explicit **reset record** once: `node scripts/reset-admin-password.mjs` (`npm run reset-admin-password`), commit, let *Publish SQL Assistant data* run. Devices then report `confirmed-default`; the first administrator sets a real password under Security. |
| **No connection at all** (a brand-new standalone device) | Settings stay locked — by design, the device cannot know that no central password exists. Establish the repository access path first: *Sync* (GitHub sign-in), or import the encrypted Secret Vault (needs the vault passphrase, not the Admin Password), or use a deployment with one of the two rows above. A standalone device cannot *reset to the default*; it can change its password. |
| **Existing device with a local marker** | unchanged: its own password keeps working. |
If this is stricter than your first-time workflow can accept, the one place to adapt is `AdminPasswordService.resolution()` — it is the only code that can report `confirmed-default`.
