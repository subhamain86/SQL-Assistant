### SQL Assistant 17.6.5 — test report

**Baseline** (`SQL-Assistant-V17.6.4.zip`, run unchanged before any change): lint, build, `npm run security`, 172/172 Node tests, 795/795 browser checks (11 suites). **Final run on V17.6.5** (clean → typecheck → lint → dev build → production build → security → Node tests → browser suites → UI comparison), TypeScript 5.8.3, Node 24, Chromium 145:

| Stage | Result |
|---|---|
| TypeScript compile (strict), lint (89 files, no import cycles) | pass |
| `npm run security` (extended scan, run on the production build) | pass |
| Node tests (`test/*.test.mjs`) | **207 / 207** (172 existing + 35 new in `test/v1765.test.mjs`) |
| Browser suites (existing, version expectations only changed) | 56 + 120 + 84 + 59 + 89 + 47 + 75 + 112 + 57 + 63 + 33 = **795 / 795** |
| Browser suite V17.6.5 (`scripts/browser_test_v1765.py`) | **76 / 76** |
| UI comparison with V17.6.4 (`scripts/compare_v1765.py`, 16 pages × 2 widths + style sheet) | **34 / 34**: identical except About (1 entry), Settings → Security and the Danger Zone hint; every V17.6.4 CSS rule unchanged, one block added |

No test was weakened. Two existing checks failed against my first implementation and were fixed in the **application**, not in the tests: V17.5.7 "nothing stored on a wrong Admin Password" (the lock-out counter now lives in memory until a lock-out engages) and V17.5.7 "no 'admin' in stored data of an ordinary session" (new storage keys renamed; a device with no central record writes nothing new). Existing tests were edited only for version strings (`v1763`, `v1764`, browser scripts).

#### Targeted tests required by the request
| # | Requirement | Where |
|---|---|---|
| 1 | Password saved on A is accepted on a clean B after sync; the old one is rejected | Node `B/T1` (×2); browser "B: …accepted on clean device B", "OLD password rejected" |
| 2 | Repository file has no plaintext / Base64 / reversible password; decrypts only with the correct one | Node `B/T2` (plain, Base64, base64url, hex, URL-encoded, reversed, case variants; wrong passwords; storage of both devices); browser "exact keys, no plaintext…" |
| 3 | Device with no token verifies against the published copy | Node `B/T3` (also: a copy whose SHA-256 differs from the marker is refused); browser device B |
| 4 | Tampered, damaged, unknown-version or rolled-back record refused, device unchanged | Node `A` (20 malformed records, parser and broker agree) and `C/T4` (7 attack kinds: told once, cache byte-identical, last good password still works); browser rollback publication |
| 5 | Lock-out after repeated wrong attempts | Node `D/T5` (60 s doubling to 15 min, correct password refused while locked, survives reload, reset by success) and `D`; browser device C |
| 6 | Reset needs current password or write-capable sign-in; refused for read-only sign-in and wrong password; afterwards `admin` works on both devices and the old password fails | Node `E/T6`, `E` (second path); browser A/B reset flow, wrong password, Cancel, Escape |
| 7 | Save after reset replaces the default record | Node `E/T7`; browser "first Save after a reset" |
| 8 | Failed write (network down, 401 / 403 / 404, conflict, rate limit, read-back failure) leaves everything unchanged and names the failed step | Node `F/T8` (12 failure kinds: repository and device byte-identical, message "Failed at \"…\" (kind)"), `F`; browser 3 injected failures |
| 9 | Regression: V17.6.4 behaviour unchanged with no central record | Node `G/T9` (policy, default, local reset, storage keys), browser device C; all 795 existing browser checks; UI comparison |

Also covered: real broker over HTTP (valid record accepted; plaintext / extra field / forged `isDefault` → 422; read-only caller → 403; save → reset → save through it; no password reached the GitHub stub), `publish-data` (valid record published; invalid one never replaces the last good copy; removal), the workflow's own check step executed with `bash`, the extended `npm run security` (each new rule proven to fail on a bad sample), escaping (hostile error text in the browser), keyboard use, ARIA, 375 px layout, no password in console, requests, URLs or storage.

#### Verified ONLY against stubs — needs a real-environment check
* **Real GitHub**: the repository is emulated (in-memory repository and `test/support/github-stub.mjs`): contents API, 401/403/404/409, permissions, device flow. Real branch protection, SSO, rate limits and token scopes were not exercised.
* **Real zone hosting**: the "site" is `scripts/serve.mjs` on localhost serving the real `publish-data.mjs` output. Real CDN caching, authentication in front of the site, and how `dist/**` is republished on a push to `main` were not exercised.
* **Real publication latency**: the publication step is run by the test right after each change. In reality a device with no sign-in learns of a change only after `publish-data.yml` and the site republication have run; the lag handling is tested, the actual delay is not measured.
* **GitHub Actions**: workflow YAML is parsed and the new check step is run with `bash`; no Actions run happened.
* **Real broker host**: the broker is the real code on localhost, not the Azure deployment (`deploy-broker.yml` unchanged; the server-side credential check only takes effect after redeployment).
* **Browsers other than Chromium**, real password managers (autocomplete behaviour), screen readers and real touch devices.
* `package-lock.json` still cannot be generated here (npm registry blocked).

Run it yourself: `npm run verify` (needs `npm install`, Chromium for Playwright).
