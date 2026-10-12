### Test report — SQL Assistant 17.6.1

All results were produced in this build environment on the final source (`node` / `python3` run directly because `npm` cannot reach the registry; the commands and their order are those of `npm run verify`).

| Gate | Result |
|---|---|
| TypeScript (`tsc --noEmit`, strict) | **0 errors** |
| Lint (83 files, import cycles) | **passed** |
| Security check (`src/` and `dist/index.html`: no credential, no console output, no dynamic code, CSP, only GitHub / configured endpoints) | **passed** |
| Production build → `dist/index.html`, `index.html`, `release/` (also the `--dev` build) | **succeeded** — 711 KB, SQL Assistant 17.6.1; a clean rebuild from the shipped ZIP is byte-identical |
| Node tests (`test/*.test.mjs`) | **132 / 132** — 17 of them new (`v1761.test.mjs`) |
| Browser — **V17.6.1** (`browser_test_v1761.py`, scenarios A–F) | **57 / 57** |
| Browser — earlier suites on the V17.6.1 build: V17.5.7 / V17.5.5 / V17.5.4 / V17.5.2 / V17.5.1 / V17.5 / V17.4 / base | **112/112 · 75/75 · 47/47 · 89/89 · 59/59 · 84/84 · 120/120 · 56/56** |
| UI comparison with the last-known-good V17.5.7 build (`compare_v1761.py`, 16 pages × 2 widths) | **33 / 33** — style sheet byte-identical; 14 pages identical (navbar, page, footer); *About* and *Schema → Pull Schema* changed as intended |
| Console errors / unhandled exceptions in any V17.6.1 flow | **none** (expected network-status lines of the failure scenarios excluded) |

#### What was real and what was emulated (read this before relying on the numbers)
* **Real:** the production page on a real static server; **`scripts/github-device-relay.mjs` run as a separate process** with real HTTP and a real CORS preflight from the page's origin; the application's own device-flow client, GitHub client, crypto and vault code; separate Chromium contexts as "devices" (no shared localStorage, IndexedDB device key or cookies).
* **Emulated (no network access to github.com here):** github.com's two device endpoints (a local stub — the user's approval on github.com is a call the test makes while the page waits) and the GitHub REST API (private repository, Bearer auth, 401 / 403 / 404, read-only and no-access tokens).
* **Not tested:** github.com itself, a real GitHub App, SAML-SSO organizations, two physical machines. The request asks to test "the deployed application and the actual repository-access workflow, not only mocked API responses" — **that could not be done here.** Run the 10-minute acceptance check in `DEPLOYMENT.md` against your real GitHub App and repository before relying on the feature.

#### Scenarios → evidence
| Scenario | Checks (V17.6.1 browser suite #) | Node tests (`v1761.test.mjs`) |
|---|---|---|
| **A** existing authorized browser: retrieve / decrypt / validate / restore; Pull Schema still works | 3–5 | retrieval order |
| **B** clean profile: sign-in bootstrap, retrieve, decrypt with the default / explicit passphrase, restore without a stored token, schema sync, reload, push | 6–18 | device flow, retrieval with the sign-in token, cross-device chain, relay end to end |
| **C** incorrect passphrase: fails safely, credentials and vault unchanged; correction without a second sign-in | 19–23 | wrong passphrase / corrupted vault (whole storage compared) |
| **D** access failures: missing token, sign-in not enabled, misconfiguration, relay unreachable, denied / expired sign-in, Cancel, leaving the page, account without access, expired authorization, expired saved token | 24–35 | device-flow failures, `signin-*` classification, relay refusals |
| **E** invalid / corrupted vault: HTML page, not JSON, not a vault, newer version, unsupported algorithm, incomplete, bad key-derivation, tampered, missing | 36–46 | structure / version check |
| **F** regression and build; secrecy (bundle, storage, console, URLs, request bodies, relay output) | 47–57 + all earlier suites + `compare_v1761.py` | source guarantees |

#### Node tests added (`test/v1761.test.mjs`)
Version stamp · sign-in configuration (off by default; invalid values reported; https relay / localhost) · configuration lookup next to `index.html` (root, sub-path, `file://`, SPA fallback page) · device flow (code, pending, slow_down, token; only the relay is contacted, no credential) · device-flow failures (denied, expired, not enabled, client rejected, relay HTML / not JSON / unreachable / rate limited, unexpected, bad verification address, bad token) with messages free of secrets · expiry / cancel / hiccup / timeout / verification-address validation · retrieval order · private repository without a token is reported honestly · retrieval with the sign-in token (+ classification) · vault structure / version check · token GitHub cannot use is not restored; unconfirmed never replaces · wrong passphrase / corrupted / empty vault change nothing · full A → B chain with the real vault code · relay (CORS, allow-lists, whitelist of fields, no refresh token, size / rate limits, no output) · relay refusals · browser client against the real relay and a stub of github.com · source guarantees (no credential or client ID in source / bundle, modules hold no crypto / storage, the sign-in token is only a local variable, default passphrase defined once).

#### Browser checks (`scripts/browser_test_v1761.py`)
| # | Check | Result |
|---|---|---|
| 1 | Setup (device A): the existing workflow — token validated by GitHub, saved in the Secret Vault (encrypted), schema published, Push Secret Vault to Repository with the administrator's own passphrase (read-back verified) | PASS |
| 2 | Setup: the repository holds ONLY the encrypted envelope (AES-256-GCM / PBKDF2) — no token, no passphrase (own or default), no Base64 token | PASS |
| 3 | A: a device that already has a valid token uses the existing authenticated repository access — no sign-in is started, no relay or github.com device request is made | PASS |
| 4 | A: retrieval, decryption, validation and restoration worked: the token from the vault replaced the device's own (validated by GitHub first), source stated, repository only READ | PASS |
| 5 | A: the existing Pull Schema operation still works on its own with the restored token (authenticated), device A's schema arrives | PASS |
| 6 | B: a clean profile — no token, no saved vault, no device key, nothing from device A; the passphrase field is masked and pre-filled with the unchanged default, still editable | PASS |
| 7 | B: 'Retrieve from Repository' with no token first tries what needs no sign-in (an anonymous read — GitHub answers 'not found' for the private repository), then asks the user to authorize on github.com: the card shows the user code and the real github.com address, with Cancel | PASS |
| 8 | B: while it waits NOTHING is authorized: no authenticated GitHub request, no write, nothing stored, the vault is not read, and the passphrase / token / device code are not shown | PASS |
| 9 | B: the page asked the real relay (real HTTP, CORS preflight from the page's origin) for a code with ONLY the public client ID — no secret, no credential | PASS |
| 10 | B: after approval the page continues by itself: the encrypted vault is read with the short-lived sign-in, decrypted with the passphrase, validated (GitHub is asked about the restored token) and restored — 'Secret Vault imported and validated' | PASS |
| 11 | B: the sign-in token was used for exactly ONE thing — a Contents read of the vault file; never to write, never for another file | PASS |
| 12 | B: the result names the source (the user's GitHub sign-in, kept in memory only) — success was reported only after the restore completed (the token is already in the device vault) | PASS |
| 13 | B: the restored token is held only as ciphertext (shown masked as in V17.5.7); the sign-in token, the device code, the passphrase and the vault token are in no page text, markup, browser storage, console message, request URL or request body to anything but the relay / api.github.com | PASS |
| 14 | B: the sign-in token went only to api.github.com (as a Bearer header); the relay received only the client ID and the device code (never a token, never the passphrase) | PASS |
| 15 | B: the repository configuration card stayed hidden and read-only; nothing in the configuration was changed by the recovery | PASS |
| 16 | B: authorized schema synchronization then works on this profile with the RESTORED token (Bearer TOK_A, not the sign-in token) — no token was ever typed here | PASS |
| 17 | B: after a reload of the same profile the restored token is still there and Pull Schema still works (the existing device-key persistence — nothing more is claimed) | PASS |
| 18 | B: Push Secret Vault to Repository works with the restored token (one verified write of the one vault file) — recovery and push stay separate operations | PASS |
| 19 | C: the pre-filled default passphrase does not open a vault pushed with another — decryption fails SAFELY: a clear message saying what to enter, no other passphrase tried, nothing stored, the passphrase is not echoed, the field is selected for correction | PASS |
| 20 | C: the message says the vault was already retrieved — correcting the passphrase does not require signing in again (ciphertext only is kept in memory) | PASS |
| 21 | C: with the corrected passphrase the same vault is opened without a second sign-in (no new device code, no new GitHub read) and restored | PASS |
| 22 | C: with a valid token already saved, a wrong passphrase leaves the saved token, the stored vault and every setting byte-for-byte unchanged | PASS |
| 23 | C: a passphrase shorter than 10 characters is refused before anything is requested, with the cursor in the field | PASS |
| 24 | D (missing token, sign-in not enabled): the card says GitHub hides a private repository from anonymous requests and that the passphrase does not authenticate to GitHub; names Import encrypted file and the administrator's GitHub sign-in; no success, nothing changed, no github.com request | PASS |
| 25 | D: security is not bypassed — only an anonymous read was attempted (answered 404 by the private repository), no credential was invented, nothing written | PASS |
| 26 | D (misconfigured sign-in): the problem is reported to the user with what the administrator must correct; nothing changed; no request to any relay | PASS |
| 27 | D (network failure): an unreachable sign-in service is reported with the way out (Import encrypted file); nothing changed; no success | PASS |
| 28 | D (authentication required / expires): the user denies the sign-in on github.com — a clear message, the way to try again, nothing changed, no success, the vault not read | PASS |
| 29 | D (authentication required / expires): the sign-in code expires — a clear message, the way to try again, nothing changed, no success, the vault not read | PASS |
| 30 | D: Cancel ends the sign-in at once — the message says so, nothing changed, and the page stops polling (no further request after Cancel) | PASS |
| 31 | D: leaving the page ends the sign-in — the page stops polling the relay | PASS |
| 32 | D (access): the GitHub account that signed in has no access to the private repository (not a member / SSO / App not installed) → reported with who can fix it; repository permissions are not bypassed; nothing changed; no success | PASS |
| 33 | D (access): the authorization has expired / was revoked (GitHub answers 401) → reported with who can fix it; repository permissions are not bypassed; nothing changed; no success | PASS |
| 34 | D (saved token expired): GitHub rejects the saved token — it does not stop at the 401: the rejection is noted and the sign-in is offered | PASS |
| 35 | D: after the sign-in the vault's valid token replaces the rejected one (validated first) and the device works again | PASS |
| 36 | E: an HTML sign-in / error page instead of the file — refused with its own reason, before or at decryption; the existing valid token, vault and settings are byte-for-byte unchanged; no success; no secret in the message | PASS |
| 37 | E: text that is not JSON — refused with its own reason, before or at decryption; the existing valid token, vault and settings are byte-for-byte unchanged; no success; no secret in the message | PASS |
| 38 | E: JSON that is not a vault (a schema registry) — refused with its own reason, before or at decryption; the existing valid token, vault and settings are byte-for-byte unchanged; no success; no secret in the message | PASS |
| 39 | E: a vault of a newer / unknown format version — refused with its own reason, before or at decryption; the existing valid token, vault and settings are byte-for-byte unchanged; no success; no secret in the message | PASS |
| 40 | E: an unsupported algorithm — refused with its own reason, before or at decryption; the existing valid token, vault and settings are byte-for-byte unchanged; no success; no secret in the message | PASS |
| 41 | E: an incomplete envelope — refused with its own reason, before or at decryption; the existing valid token, vault and settings are byte-for-byte unchanged; no success; no secret in the message | PASS |
| 42 | E: an implausible key-derivation setting — refused with its own reason, before or at decryption; the existing valid token, vault and settings are byte-for-byte unchanged; no success; no secret in the message | PASS |
| 43 | E: a corrupted (tampered) ciphertext — refused with its own reason, before or at decryption; the existing valid token, vault and settings are byte-for-byte unchanged; no success; no secret in the message | PASS |
| 44 | E: the vault file is missing from the repository — 'No encrypted Secret Vault was found' (the repository and branch are fine), where to push it, nothing changed | PASS |
| 45 | E: the same refusals apply to 'Import encrypted file' (unchanged messages) — a vault of a newer version is rejected, nothing changed | PASS |
| 46 | E: …and the existing credential survived every refused vault of this scenario | PASS |
| 47 | F: the production bundle contains no credential, no client ID, no relay address and none of this test's secrets; the default passphrase is still defined exactly once; the CSP still allows only the page's own script | PASS |
| 48 | F: the release folder ships no configuration, no vault and no relay secret (the sign-in configuration is deployed by the administrator) | PASS |
| 49 | F: Hamburger → Schema → Pull Schema keeps exactly the three V17.5.7 cards in the same order; one Retrieve button, one Import button; no duplicate button, no new card or setting | PASS |
| 50 | F: the card explains, in one added sentence, that the passphrase does not sign you in to a private repository and where sign-in / Import come in | PASS |
| 51 | F: Settings → Secret Vault is untouched (Push Secret Vault to Repository is the only push) and the 8 Settings tabs are unchanged | PASS |
| 52 | F: version 17.6.1 in the footer and the About page (first entry, 17.5.7 still listed) | PASS |
| 53 | F: every route renders | PASS |
| 54 | F: SQL generation (Describe What You Need, offline NLU) is unchanged | PASS |
| 55 | F: 'Import encrypted file' (the route that needs no sign-in at all) is unchanged: decrypt, validate with GitHub, restore | PASS |
| 56 | The relay process printed nothing about any exchange (no code, token, client ID or address in its output) | PASS |
| 57 | No console errors or uncaught exceptions in any V17.6.1 flow (expected network-status lines of the failure scenarios excluded); no secret in any console message | PASS |

#### Intended changes to existing assertions
Listed in `REGRESSION_BASELINE_V17.6.1.md`. In addition, the emulated GitHub of the V17.5.2 browser suite now also answers the repository / branch look-ups that the application makes to validate a token (as github.com does); the V17.5.4 / V17.5.5 suites' expectations of three old failure sentences were updated to the new, more specific ones.
