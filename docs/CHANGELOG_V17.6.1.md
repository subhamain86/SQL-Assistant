### SQL Assistant 17.6.1 — what changed

**Goal.** On a clean browser profile or a new device — where **no GitHub token has ever been saved** — the user can start *Hamburger → Schema → Pull Schema → Pull Secret Vault to Repository*, complete a legitimate GitHub authorization, retrieve the encrypted Secret Vault from the private repository, decrypt it with the Vault Sync Passphrase and restore the validated secrets.

#### Baseline (stated, not assumed)
* **`SQL-Assistant-V17.5.7.zip`** — the package attached to the request and the only project source available in this session (165 files). Following the request, it is the **actual source baseline and the last-known-good UI**. It was extracted, type-checked, built and tested unchanged first, and only the files listed below were modified.
* Earlier answers in this conversation produced V17.5.9 / V17.6 packages. They are **not** in this session (the working folder was reset, and the V17.5.8 / V17.5.9 / V17.6 sources were not available to read), so nothing was carried over from them: everything below is implemented on V17.5.7. A few ideas that exist there (structural vault check, token validation before restore) were re-implemented for V17.6.1 where the request asks for them.
* The SharePoint folders could not be browsed from here; no other version was read.

#### The root cause this release addresses (traced in the V17.5.7 source)
`Retrieve from Repository` started from `repository()` (`context.ts`), which exists **only when a token is saved**. With none, the only fallback was one anonymous request — and GitHub answers **404 Not Found to every anonymous request for a private repository**, so the retrieval ended with "use *Import encrypted file*". The circle: *no token ⇒ no vault ⇒ no token*. A saved but **rejected** token (expired / revoked — exactly when the fresh token inside the vault is wanted) stopped the retrieval at the 401 as well. And the vault passphrase cannot help: it decrypts the file; it is not a credential for GitHub.

#### What was implemented
| Step of the requested workflow | Implementation |
|---|---|
| 3 · check whether a usable credential exists | `retrieveVaultFile()` (`vaultRetrieval.ts`): the saved token is used when GitHub still accepts it |
| 4 · credential exists → existing authenticated workflow | unchanged read of the configured repository / branch / vault path |
| 5 · no credential → secure bootstrap | an anonymous read first (a public repository); if that fails the way a private repository fails — and the administrator enabled it — **GitHub sign-in** (`bootstrapAuth.ts`): the OAuth **device authorization flow** (RFC 8628). The card shows a short code and the real `github.com/login/device` address; the user signs in **as themselves**, so the repository's own access control (membership, SSO, GitHub App installation) decides. |
| 6 · retrieve the encrypted vault with an authorized mechanism | `retrieveVaultAuthorized()` reads **only the vault file** with the short-lived token the sign-in returned; the token lives in a local variable, is **never stored**, and is dropped as soon as the file was read |
| 7 · validate that the file exists and has the expected structure / version | `validateVaultPayload()` runs **before** anything is decrypted: HTML login page, not JSON, not a vault, newer / unknown version or algorithm, device-key envelope, incomplete or damaged envelope, implausible iteration count — each with its own message |
| 8–9 · decrypt, validate the decrypted contents before changing anything | the existing `SecretVault.importSecrets()` (cryptography and file format untouched) |
| 10–11 · restore; confirm only afterwards | the existing encrypted device-key save path; the success message is produced only after the restore completed, and GitHub has been asked whether the restored token works |

**Also fixed on the way** (each has a test): a token GitHub accepts but that **cannot use the repository** is no longer restored (V17.5.7 saved it with a warning and could replace a working token); an **unconfirmed** token (GitHub unreachable) never replaces a saved token (a device with none still restores it, with a warning); the passphrase is asked for **before** anything is requested or the user is sent to sign in; a wrong passphrase after a sign-in keeps only the **ciphertext** in memory for 10 minutes so correcting the passphrase does not need a second sign-in; every failure message states that nothing on the device was changed.

#### What the administrator must provide (and why)
* A **GitHub App** (recommended: *Contents: Read-only*, installed only on `basware/sk-ap-sql-assistant`, *Enable Device Flow* on). Its **client ID** is public; the device flow needs **no client secret**.
* A tiny **relay** — `scripts/github-device-relay.mjs` (no dependencies, no secret, allow-listed client ID and origin) — because `github.com/login/device/code` and `/login/oauth/access_token` send no CORS headers, so a browser page cannot call them directly. The relay is the "trusted backend" the request allows for; it forwards exactly two requests.
* A deployed file `sql-assistant-data/vault-bootstrap.config.json` next to `index.html` (`docs/vault-bootstrap.config.example.json`). **Without it nothing changes**: the feature is off and the card says so honestly.
Details, security trade-offs and the 10-minute acceptance check: `docs/DEPLOYMENT.md` → *Vault recovery sign-in*.

#### Files
| File | Change |
|---|---|
| `src/v17/services/bootstrapAuth.ts` | **new** — configuration parsing, device-flow client (no crypto, no storage, no vault code) |
| `src/v17/services/vaultRetrieval.ts` | **new** — retrieval routes and failure classification; `validateVaultPayload()` |
| `src/v17/services/secretVault.ts` | `importSecrets()`: a token GitHub cannot use is not restored; an unconfirmed token never replaces a saved one. **Cryptography, envelope and defaults untouched.** |
| `src/ui/pages/schemaRepoCards.ts` | Retrieve flow (passphrase first, routes, sign-in box with Cancel, structural check, wrong-passphrase handling, ciphertext cache); one added sentence in the card text. Layout, ids and classes unchanged; no new card or permanent button. |
| `scripts/github-device-relay.mjs` | **new** — the relay (+ `npm run relay`) |
| `scripts/build.mjs` | CSP `connect-src` gains `'self'` (the same-origin configuration file); `web.config` declares the `.json` MIME type |
| `src/ui/pages/other.ts`, `src/v17/sync/schemaFormat.ts`, `src/v17/engines/nluEngine.ts`, `package.json` | About entry; version 17.6.1 |
| `test/v1761.test.mjs`, `scripts/browser_test_v1761.py`, `scripts/compare_v1761.py` | new tests (see `TEST_REPORT_V17.6.1.md`) |
| older tests | version expectations; the V17.5.7 assertion that a *no-access* token is saved with a warning was changed on purpose (see `REGRESSION_BASELINE_V17.6.1.md`) |
| docs | this file, `TEST_REPORT_V17.6.1.md`, `REGRESSION_BASELINE_V17.6.1.md`, `SECURITY.md`, `DEPLOYMENT.md`, `PULL_SCHEMA.md`, `SOURCE_PROVENANCE.md`, `README.md`, `vault-bootstrap.config.example.json` |

**Not changed:** the vault envelope / key derivation, the default passphrase (`xG71lfp1NHZVZ4WVWCPe`: one definition, still pre-filled, masked, editable, never used implicitly), Push Secret Vault, the repository configuration (`basware/sk-ap-sql-assistant`, `main`, `sql-assistant-data/schemas/registry.json`, vault path `sql-assistant-data/vault/secret-vault.v17.enc.json`) and its administrator-only editing, Pull Schema, schema synchronization, SQL generation, selectors, the hamburger menu, `public/styles.css` (byte-identical).

#### Requirement conflicts and what could NOT be done (stated, not hidden)
* **"Recovery without a pre-existing GitHub token" vs "do not claim tokenless access to a private repository".** Both are honoured: *no token has to be saved in advance*, but **an authorization is required** — the GitHub sign-in. The passphrase is never treated as a credential.
* **A browser alone cannot do the sign-in.** It needs the relay (above). The relay **sees the short-lived sign-in token** in the response, so it must be run by your organization over HTTPS and must not log bodies (the reference relay logs nothing). This is the one trust assumption the feature adds; it is documented in `SECURITY.md`.
* **Tested against emulations, not github.com.** This environment has no network access to github.com. The relay is run for real (separate process, real HTTP and CORS) against a local stub of github.com's two device endpoints; the repository API is an emulation (private repository, Bearer auth, 401 / 403 / 404). "Device A / B" are separate Chromium contexts (no shared storage, device key or cookies), not two physical machines. **Run the 10-minute check in `DEPLOYMENT.md` against your real GitHub App and repository before relying on it.** The request asks to test "the deployed application and the actual repository-access workflow, not only mocked API responses": that part could not be done here.
* **Default passphrase.** Required to be preserved and pre-filled, so it ships in the bundle and **is not a secret**. A vault protected only by it is only as private as the repository. When a vault read **without any GitHub credential** opens with it, the result carries a warning.
* A **GitHub App user token** is the intersection of the app's permissions and the signed-in user's own: the user must be able to read the repository and the app must be installed on it. SSO behaviour for your organization could not be verified here; if GitHub answers 404, the card says the account cannot read the repository.

#### Known limitations
* Nothing is available without the administrator's one-time setup (GitHub App + relay + config file); until then the card behaves as in V17.5.7 plus the clearer messages.
* A restored token is stored like a typed one (AES-256-GCM, non-extractable device key): anyone who can use that unlocked browser profile can use it; clearing site data removes it (recover again). It is **not** "permanently available across devices": each device restores it once.
* The sign-in must be completed in a browser tab on github.com (the user types the code). Opening the app from `file://` has no deployed configuration, so use *Import encrypted file* there.
* The passphrase is still entered once per device (it is the only secret not in the file).
