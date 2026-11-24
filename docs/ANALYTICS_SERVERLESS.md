# Serverless Usage Analytics — V17.7.4 (provider "repository")

> V17.7.4 makes Usage Analytics deployable without a server or cloud credentials. Analytics data is encrypted on the device and can be read only in the Analytics dashboard after administrator authentication. SQL Assistant continues to capture usage metadata only and does not capture SQL content, credentials, database results, or customer data.

Analytics without an analytics server: usage is **encrypted in the browser** and written to the repository SQL Assistant already uses; the **Analytics dashboard** (Hamburger → Analytics) asks for the administrator password, which unwraps a private key **in memory only**, decrypts the data in the browser and aggregates it there. No server, no Azure, no npm registry, no new credential. The server provider of V17.7.3 (`server/analytics-service.mjs`, see `docs/ANALYTICS.md`) stays available and tested.

## 1. Feasibility check — what can be met without a server, and what cannot

Written BEFORE the code, and corrected by what the tests showed. "Met" means implemented and tested; "Cannot be met" means the requirement as worded is impossible without a server, and the closest safe alternative is named.

### How each requirement is met

| Requirement | How it is met without a server | Status |
|---|---|---|
| Analytics entry in the hamburger menu, visible but protected | The entry is visible; the page opens an **Administrator Authentication** dialog. The protection is *cryptographic*, not a UI gate: without the password the data in the repository cannot be decrypted by anybody, whatever they do to the page. | Met |
| One centralized administrator password | One administrator key pair; its private key is wrapped under one password (`admin-key.json`). | Met |
| Password never in JavaScript / HTML / configuration / localStorage / sessionStorage | The password is never stored anywhere — not even as a hash. The only artefact is the wrapped key; the password is typed, used once, the field is emptied. Tested on source, bundle, DOM and storage. | Met |
| Password **validated server-side** | **Cannot be met literally — there is no server.** Closest safe alternative: the password is the key that unwraps the private key; a wrong password fails the AES-GCM authentication tag. That check happens in the browser, against a file that anyone with repository access can read, so a reader can try passwords **offline** (see §7). The protection is the password's strength and the PBKDF2 cost (600 000 iterations), not secrecy of a stored hash. | Cannot be met as worded; alternative implemented |
| Configurable / rotatable without rebuilding | In the app: **Set up**, **Change password**, **Rotate keys**; configuration is a public file next to `index.html`. | Met |
| Normal users cannot get the password from the source or developer tools | There is nothing to find: no password, no hash, no verifier, no private key in the page or its storage. (A normal user who can **read the repository** can read the wrapped key and guess offline — §7.) | Met, with that limit |
| Failed authentication exposes nothing; "Invalid administrator password" | A wrong password yields exactly **Invalid administrator password**; no key, no data, no configuration. | Met |
| Admin session, Lock Analytics, inactivity lock, reload requires the password | Same as V17.7.3: the unwrapped keys and the decrypted data live in page memory and are dropped by Lock, the inactivity timeout (`analytics.adminSessionTimeout`), a reload or a password change. | Met |
| Brute-force lock-out of the administrator login | **Cannot be met** — nobody counts attempts (the V17.7.3 service did). Only a page-side delay would exist, and it protects nothing against someone who reads the file. Not implemented as a "protection". | Cannot be met |
| Revoking a session that is already unlocked on another device | **Cannot be met** — sessions exist only in the memory of the browser that unlocked. Change password / Rotate keys protect *future* unlocks and future data. | Cannot be met |
| Dashboard: KPIs, daily / weekly / monthly utilization, trend, features, versions, date range | Computed in the browser with the same arithmetic as the service; tests feed the same events to both and require identical dashboards. | Met |
| Active usage measurement (pauses when hidden / in the background / idle) | Unchanged tracker (`ActivityMeter`). | Met |
| Unique users are not counted per session | A random per-device id kept in browser storage: one browser profile = one unique user across sessions (as in V17.7.3). | Met |
| Privacy: no SQL, results, customer data, credentials, schema content | Same strict event allow-list, plus the data is encrypted before it leaves the device. | Met |
| Telemetry from **every** user, anonymously | **Cannot be fully met.** GitHub accepts no anonymous writes: only a device whose GitHub token can **write** to the repository can report. Devices without a write-capable token queue a bounded amount (100 events, 24 hours) and retry once an hour; they never show an error. Closest alternatives: give reporting devices a fine-grained token limited to the one repository (Contents: Read and write), or use the server provider. | Cannot be fully met |
| Analytics optional; failures never affect SQL Assistant | Off by default; every failure is a result, never an exception (§5). | Met |
| Build and test without npm registry / Azure credentials | The TypeScript compiler is committed, checksum-pinned (`tools/typescript/`); workflows need only the default `GITHUB_TOKEN`. | Met |

## 2. Design

There is **no default password** and no password is stored anywhere — not as plain text, not as a hash, not as a verifier. Until an administrator runs Set up, nobody can read anything, because nothing has been encrypted to a key yet.

**Files in the repository** (folder `analytics.repositoryPath`, default `sql-assistant-data/analytics`):

| File | Content | Who reads it |
|---|---|---|
| `public-key.json` | the administrator's PUBLIC key (ECDH P-256) and its key id | devices (to encrypt) |
| `admin-key.json` | the PRIVATE key(s), **wrapped** with AES-256-GCM under a key derived from the password with PBKDF2-HMAC-SHA-256 (≥ 600 000 iterations, random 16-byte salt, stored in the file) | the administrator's browser |
| `events/YYYY-MM-DD/<32 hex>.json` | one **encrypted batch** of usage events, written once by one device; a new random 128-bit name per batch, **create-only** (no read-modify-write, so no write conflicts and nothing that links two batches); one folder per UTC day because GitHub lists at most 1000 files per folder | the administrator's browser |
| `rollups/YYYY-MM.json` | an **encrypted monthly roll-up** written by Compact; it remembers which batch files it already contains | the administrator's browser |

**Cryptography** (WebCrypto only, no library, in `src/v17/services/analyticsCrypto.ts`): batches use a hybrid scheme — an ephemeral ECDH P-256 key pair per batch, HKDF-SHA-256, AES-256-GCM, with the key id and format bound in the additional authenticated data. The plaintext is padded with spaces to a size bucket (1 KiB, 2 KiB, 4 KiB …) so a file does not reveal how many events it holds. The wrapped private key is wrapped with AES-256-GCM (key id as AAD). An unlocked private key is imported **non-extractable**: it can be used but not read back. A key file whose cost is below 600 000 iterations (downgrade) or absurdly high (denial of service) is refused before any derivation.

**Flows**
* **Set up** (Analytics → Unlock → "Set up Analytics…", offered when Settings are unlocked): password policy (at least 14 characters; short, repeated, sequential and common-word passwords refused), key pair, `admin-key.json` first, then `public-key.json`. Refuses to run when a key file exists. An interrupted set-up is finished with **Publish public key**.
* **Unlock**: read `admin-key.json`, derive, unwrap — the GCM tag decides. Wrong password → **Invalid administrator password**. Then the dashboard lists and reads the batch files and roll-ups of the range (a week of margin before it, two days after), decrypts, validates every event with the same strict allow-list as the service and aggregates in memory. A damaged, forged or foreign-key file is skipped and counted; a hostile event never reaches the dashboard.
* **Change password**: the private keys are unwrapped with the current password and wrapped again with the new one (new salt). The key pairs do not change, so **all earlier data stays readable**; the old password stops working; Analytics locks.
* **Rotate keys**: a new key pair becomes current; the new public key is published; the old wrapped keys are kept so earlier data stays readable.
* **Compact**: batch files of days that ended more than two days ago are merged into encrypted monthly roll-ups and deleted; anything older than `analytics.retentionDays` is removed. A run handles at most 300 files and says if more remain. An interrupted run never counts a file twice (the roll-up remembers the file names it merged).

**On the device**: the tracker queues events (bounded), and the repository sink sends every 5 minutes (or at 50 queued events, never sooner than 2 minutes after the last send, and once when the page is left) — each batch is a repository commit, so the cadence is deliberately slow. No write access → one retry per hour; no repository connection → every 15 minutes; not set up → every 10 minutes.

## 3. Configuration

`sql-assistant-data/analytics.config.json` next to `index.html` (public; a password, secret, token or **private key** — a JWK with `d`, a PEM block, a wrapped key file — makes the whole file invalid). Example: `docs/analytics.config.repository.example.json`.

| Key | Default | Meaning |
|---|---|---|
| `analytics.enabled` | `false` | master switch |
| `analytics.provider` | `"service"` | `"repository"` (this document), `"service"` (V17.7.3) or `"none"` |
| `analytics.repositoryPath` | `sql-assistant-data/analytics` | folder below `sql-assistant-data/` |
| `analytics.retentionDays` | `400` | 30 … 3650; applied by Compact |
| `analytics.publicKey` | none | optional `{ "kid": …, "jwk": { kty, crv, x, y } }` — **pins** the public key |
| `analytics.inactivityTimeout` | `300` | seconds, 5 … 3600 — active time pauses after this long without interaction |
| `analytics.collectUserIdentity` | `false` | also send the GitHub login (when signed in) as the user label |
| `analytics.applicationVersion` | this build | version label reported |
| `analytics.adminAuthenticationEnabled` | `true` | `false` = the in-app dashboard is unavailable (usage is still collected) |
| `analytics.adminSessionTimeout` | `900` | seconds, 10 … 28800 — the dashboard locks after this long without interaction |

## 4. Deployment — no server, no cloud credentials

1. Deploy SQL Assistant as before (GitHub Pages with only the default `GITHUB_TOKEN`; see `docs/DEPLOYMENT.md`, "No npm, no Azure — the workflows").
2. Enable the provider: set the repository **variable** `SQLA_ANALYTICS_PROVIDER` = `repository` (optional: `SQLA_ANALYTICS_REPOSITORY_PATH`, `SQLA_ANALYTICS_RETENTION_DAYS`, `SQLA_ANALYTICS_INACTIVITY_SECONDS`, `SQLA_ANALYTICS_COLLECT_USER_IDENTITY`, `SQLA_ANALYTICS_ADMIN_AUTHENTICATION_ENABLED`, `SQLA_ANALYTICS_ADMIN_SESSION_SECONDS`, `SQLA_ANALYTICS_APPLICATION_VERSION`, `SQLA_ANALYTICS_PUBLIC_KEY_JSON`) and re-run the Pages workflow — it writes the public `analytics.config.json`. Variables, not secrets: there is no secret.
3. An administrator opens **Analytics → Set up**, chooses the password (store it safely: **nothing can recover the data if it is lost**) and optionally pins the displayed public key.
4. Reporting devices need a GitHub token that can write to the repository (they already have one if they synchronize schemas). Pushes to `sql-assistant-data/analytics/**` do **not** start the Pages build or the data-publication workflow (path filters), and the folder is **never published** to the site (`scripts/publish-data.mjs`) — encrypted data and the wrapped key stay in the repository.

## 5. Failure behaviour (analytics never affects SQL Assistant)

Analytics off, invalid configuration, no repository connection, no write access, GitHub unreachable, a damaged file, an unsupported connection (central access cannot list or delete), a browser without WebCrypto: each is a result or a message on the Analytics page; SQL generation and every other feature run as before. Unsent usage is queued (100 events, 24 hours).

## 6. Privacy

Collected: random device id, random session id, version, a time, which page / feature was used, active seconds, and for each SQL generation only the builder and whether valid SQL came out; a user label only if `analytics.collectUserIdentity` is on. **Never**: generated SQL, SQL typed, descriptions, results, schema content, customer data, credentials, passwords, connection strings. All of it is encrypted before it leaves the device and decrypted only in the dashboard after the password.

## 7. Honest limits and risks

1. **Offline password guessing.** `admin-key.json` is readable by everybody who can read the repository (everybody, if it is public). An attacker can try passwords against it without being detected or rate-limited. Each guess costs 600 000 PBKDF2 iterations; a long passphrase of unrelated words is out of reach, a short or common password is not. The policy (14 characters minimum, trivially weak values refused) is a floor, not a guarantee. **Keep the repository private and choose a long passphrase.**
2. **Metadata is visible.** Anyone who can read the repository sees the commit history: which GitHub account wrote each batch (so which users report, whatever `collectUserIdentity` says) and when. Timing of batches, the number of batches and their sizes (padded to power-of-two buckets, so only the order of magnitude shows) are visible. The content is not.
3. **Write access is required to report.** Only devices whose token can write report; coverage is the set of such devices, not all users.
4. **Telemetry and files are not authenticated.** Anyone with write access can add forged batches (they have the public key), delete or replace files, or replace `public-key.json` to redirect future data to their own key. The dashboard validates the shape of every event but cannot prove it is true. **Pin the public key** in `analytics.config.json` to defeat key replacement; protect the branch if integrity matters.
5. **No server-side lock-out, revocation or audit** (see §1). Change password / Rotate keys protect future unlocks and data only.
6. **A forgotten password cannot be recovered.** Start again with Set up on an empty folder; earlier data stays unreadable.
7. **Scale.** GitHub lists at most 1000 files per folder (hence one folder per day — about 1000 batches a day), one API request reads one file, and a load reads at most 3000 files; run **Compact** regularly. Each batch is a commit. Suitable for an internal tool with tens to a few hundred reporting devices, not for thousands.
8. **Central repository access (broker) can write batches but not list or delete**, so the dashboard and Compact need a device with a personal GitHub token.
9. **Beacon at page exit is best effort**: the final batch of a session is written through the normal repository connection and can be cut off by the browser; unsent usage stays queued for the next session.
10. **Active-time and user counts** have the V17.7.3 limits (blocked storage counts a new user per session; the same person on two browsers is two users unless the identity label is used).

## 6b. Verified here / not verified here

Verified (tests in `test/v1774.test.mjs` and `scripts/browser_test_v1774.py`): the cryptography (wrong password, tampering, downgrade, wrong key, forged public key), identical dashboards to the service, the device write path, set-up / unlock / change password / rotate keys / compaction / retention over an in-memory repository **and over HTTP against a local stand-in for the GitHub contents API**, privacy of everything a repository reader can see, the real page in Chromium, the registry-free build, the hygiene check.

Not verified here: a **real GitHub repository** (real tokens, real permissions, branch protection, API rate limits, the secondary rate limit on content creation), a real GitHub Pages deployment, GitHub Actions runs, other browsers, real users and scale, the commit-history exposure on a real repository.

## 8. Troubleshooting

| Message | Cause |
|---|---|
| "No repository connection is available on this device" | no GitHub token (or central access) on this device — configure it under Schema → GitHub Repository |
| "Analytics has not been set up in the repository yet" | `admin-key.json` is missing — an administrator runs Set up |
| "…cannot write to the repository" | the token is read-only (Contents: Read and write is needed) |
| "damaged or does not have the expected format" | the key file was edited or damaged; restore it from the repository history |
| "…cannot list or delete files" | central access (broker) in use — use a device with a personal token |
| Dashboard shows "only the most recent files were read" | too many batch files — run Compact |
