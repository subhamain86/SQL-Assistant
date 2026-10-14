### SQL Assistant 17.6.6 — new-device Admin Password fix (single-defect release)

**Baseline.** `SQL-Assistant-V17.6.5.zip` (attached; the sole source baseline and last-known-good UI). Run unchanged first: type-check, lint, production build, 195/195 Node tests passed.

#### Defect
The Admin Password could be saved and synchronized centrally, but on a **new device** SQL Assistant kept using the default `admin` instead of the saved central password.

#### Root cause (reproduced on the unchanged V17.6.5 build, see `docs/TEST_REPORT_V17.6.6.md`)
1. **The default won before the central record was consulted.** `verifyPassword()` first compared the candidate with the local marker — and a new device has none, so it compared with the built-in default marker: `admin` matched and the function returned `true`. The central record was fetched only when the candidate did **not** match the local marker, i.e. never for `admin`.
2. **The unlock check could skip a synchronization that was already running.** The start-up synchronization is fire-and-forget; the unlock-time refresh was throttled by a time stamp that was set when a read *started* (successful or not), so an unlock while the start-up read was still in flight, or right after a failed one, went on with the default.
3. **A repository connection that appeared after start-up was only used by the next scheduled / visibility synchronization** (default schedule: manual); the unlock check skipped the default case entirely (item 1).
4. **A device that reads the published copy could not see a record published after its page was opened.** The publication marker is read once at start-up; a later record failed the hash check ("does not match its publication record"), also for *Sync with GitHub Now*.
5. **"No central record" was reported as synchronized** (`synchronized: true`, "the default password is in force everywhere") although nothing is.

#### Fix (Admin Password code only)
| File | Change |
|---|---|
| `src/services/passwordService.ts` | `verifyPassword()`: on a device **without a local marker** the central record is requested **first**, then the candidate is checked (the default is accepted only when no central record exists or none can be read). Devices with a local marker behave as before. |
| `src/v17/services/adminPassword.ts` | `refreshForLogin()` waits for a running synchronization (never skips it); the throttle now counts only **successful** central reads (a failed read is retried); a failed read keeps a short, secret-free reason (`problem()`) that the status line shows; "no central record" is no longer reported as synchronized;  |
| `src/ui/context.ts` | `passwordRepository()` = `repository()`, except that for the **published copy** the marker is re-read before reading the Admin Password file (the shared published state is not touched). |
| `src/ui/pages/settings.ts` | one added toast after an unlock on a device that could not check the central record (names the reason and *Sync with GitHub Now*); nothing else. |
| Version 17.6.6 | `package.json`, `APP_VERSION` (→ footer, writer stamp, `release/version.json`), `offline-nlu-17.6.6`, About (new first entry), README, docs, test / script expectations. |
| Tests | `test/v1766.test.mjs` (21 new), `scripts/browser_test_v1766.py` (34 checks), `scripts/compare_v1766.py`; v1765 tests/scripts: version expectations and the two intended assertions below. |

**Intended changes to existing assertions (none weakened):** `test/v1765.test.mjs` / `scripts/browser_test_v1765.py` — a clean installation's first synchronization used to be asserted as `synchronized: true`; it is now `false` (requirement: never claim the default is synchronized); the wiring assertion names `passwordRepository`; the version-stamp test moved to `v1766`; version expectations 17.6.5 → 17.6.6 in `v1763` and the browser scripts.

**Not changed:** UI design / layout / styles (`public/styles.css` byte-identical; Settings → Security markup identical), Admin Password screens and controls, marker format and key `sqla.pwvault.v15`, PBKDF2-SHA-256 / AES-GCM, record format and path, repository configuration, GitHub authentication / broker, Secret Vault, schema synchronization, SQL generation, CASE/DECODE, offline NLU logic, learning, Admin Query Library, workflows, build script.

#### Behaviour after the fix
* **Precedence:** valid central record → valid compatible local record → default `admin` (only when neither exists or the central record cannot be read).
* The default is never written over a central record: a new device never publishes; `commit` paths are unchanged and still only run for a deliberate change / reset.
* Central data unavailable / invalid / unreadable: nothing is overwritten or deleted, the local behaviour is kept, the Security status line and a toast after unlock name the reason and the retry (*Sync with GitHub Now*); nothing is reported as synchronized.
