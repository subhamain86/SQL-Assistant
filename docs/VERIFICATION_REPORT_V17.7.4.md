# Verification report — V17.7.4 against the requirements

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Feasibility check first, honest about what cannot be met | Done | `docs/ANALYTICS_SERVERLESS.md` §1: server-side validation, brute-force lock-out, remote session revocation and anonymous telemetry from every user **cannot be met without a server**; closest safe alternatives named |
| 2 | Provider "repository" (V17.7.3 service provider stays working and tested) | Implemented, tested | `analyticsRepo.ts`, `analyticsCrypto.ts`, `analyticsAggregate.ts`; 41 `v1773` tests and 84 browser checks pass on the V17.7.4 build |
| 2 | Cryptographic authentication, WebCrypto only, ECDH P-256, public key in the config, private key wrapped (AES-GCM, PBKDF2-SHA-256 ≥ 600 000, random salt), exact "Invalid administrator password", no password / hash / verifier stored | Implemented, tested | crypto tests; browser A11, B1–B5 |
| 2 | Telemetry encrypted on the device (ephemeral ECDH + AES-GCM); nobody with repository access can read it without the password | Implemented, tested (see limits) | sink / privacy tests; browser C3, C4 inspect every file in the repository |
| 2 | Dashboard decrypts and aggregates in memory only; nothing stored; reload needs the password | Implemented, tested | browser B4, B5, C6, C7; source scan |
| 2 | In-app Set up, Change password (old data readable), Rotate keys (old key kept) — admin-only | Implemented, tested | browser A3–A13, D1–D14 |
| 2 | Per-device random-named files `events/…/<random>.json`, no write conflicts, bounded queue without write access, names / sizes reveal no identity | Implemented, tested (one folder per UTC day, not per month — GitHub lists 1000 files per folder) | sink tests; browser E1 |
| 2 | Compaction into encrypted monthly roll-ups; retention | Implemented, tested | compaction tests; `analytics.retentionDays` |
| 2 | All V17.7.3 behaviour kept (KPIs, views, date range, Lock, inactivity lock, active-time, unique users, privacy, failure isolation) | Verified | parity tests; browser B3, C7–C10, D16, D17, E1–E5 |
| 3 | Configuration: V17.7.3 keys + provider "repository" + `repositoryPath`, `retentionDays` (+ optional `publicKey`); a public file with a password / token / private key refused | Implemented, tested | config tests |
| 4 | No npm / Azure in the build and test path; pinned compiler checksum-verified; Pages workflow needs only `GITHUB_TOKEN`; credentialed workflows marked optional; real favicon; hygiene passes | Implemented, tested | `tools/typescript`, `scripts/toolchain.mjs`; empty-environment build; 428/428 |
| 5 | Privacy and security statements, including the honest limit (offline guessing, visible timing and sizes) | Documented | `ANALYTICS_SERVERLESS.md` §7, `SECURITY.md` |
| 6 | Version V17.7.3 → V17.7.4 everywhere | Verified | package, `APP_VERSION`, footer, navbar badge, About, metadata, `version.json`, README, notes, NLU label, test constants — Node + browser F4, F5, F7 |
| 7 | Release note, exact | Verified | About, dashboard, README, notes (a test asserts the exact text) |
| 8 | Validation list | See `docs/TEST_REPORT_V17.7.4.md`; every item maps to a check there |
| — | Rollback to V17.7.3 | Delivered, **with a caveat** | see below |

## Caveats you should know
* **The V17.7.3 rollback package is a rebuild, not the original zip.** The original V17.7.3 delivery was no longer available (the previous session's files were gone; only the V17.7.2 bundles remained). V17.7.3 was rebuilt from V17.7.2 plus the recorded change set and verified before V17.7.4 work began (41 Node tests, 84/84 browser checks). It behaves as V17.7.3 specifies; byte identity with the original cannot be claimed. If you still hold the original V17.7.3 zip, prefer it for rollback. The same holds for `rollback/SQL-Assistant-V17.7.2.zip` of the previous delivery: it is the V17.7.2 source as supplied.
* **Offline password guessing.** The wrapped key file is readable by whoever can read the repository. Strength of the password and the PBKDF2 cost are the only protection. Keep the repository private; use a long passphrase.
* **Commit history is visible**: which GitHub account wrote each batch, and when.
* **Only devices whose token can write report.**
* **Telemetry is not authenticated**: anyone with write access can add forged batches or replace the public key — pin it in `analytics.config.json`.
* **No server-side lock-out, revocation or audit.**
* **Central repository access (broker) cannot list or delete**, so the dashboard and Compact need a device with a personal GitHub token.

## Not verified here
A real GitHub repository and its permissions, rate limits and branch protection; a real GitHub Pages deployment; the GitHub Actions runs of the changed workflows (they were parsed as YAML and the configuration step was run locally); other browsers; real users and scale; the 18 historical Python browser suites.
