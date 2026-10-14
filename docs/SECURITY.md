## Added in V17.6.5 — centralized Admin Password

* **What is stored where.** The repository file `…/security/admin-password.json` and the device entry `sqla.pwvault.v15` hold the same thing as in V17.6.4: an AES-256-GCM encrypted fixed marker whose key is derived from the password (PBKDF2-SHA-256, 150 000 iterations, random salt and IV). **No password, no key and no hash of the password is stored or transmitted.** A reset record (`isDefault: true`) holds no marker at all.
* **Same channel, no new credential.** The file is read and written only through the existing repository connection (central access service / saved token / published copy). The service's path prefix, the publication rules and the safety scan (no token or private key in published files) apply unchanged; the build and security checks scan the new code (no console output, no dynamic code, no credential-like string).
* **Fail-safe.** An invalid, tampered or newer-format record is ignored (the local password keeps working); an absent record never resets a device; a record can only be adopted after structural validation (base64 fields, bounded sizes, integer revision, ISO time). A failed fetch or publication never throws and never changes the password.
* **Unlock-time fetch.** A password that does not match the local marker triggers at most one central fetch every 4 seconds and a second check. A wrong password is still rejected; the fetch only makes a legitimately changed password work at once.
* **Reset to default** is a deliberate, confirmed action inside the unlocked Settings; it re-locks Settings, warns that `admin` is insecure and publishes the reset immediately; it modifies no other storage entry (browser test compares the storage before and after).
### Limitations (V17.6.5)
* Write access to the data repository is sufficient to replace the Admin Password record (including with the default). Restrict it; every write by the central access service is audited there.
* The marker can be attacked offline by anyone who can read the repository (as the V17.6.4 marker could by anyone who could read the browser's storage). Use a long password.
* A device that is offline keeps accepting its last known password until it synchronizes.

---

# Security model and review (V17.5 — the V17.4 review below is unchanged)

## Secret Vault (unchanged cryptography, stronger flow)
* **On the device:** GitHub settings, token and AI/LLM key are stored AES-256-GCM encrypted with a **non-extractable** key held in IndexedDB. If IndexedDB is unavailable a session-only key is used. If the key is lost the data is **kept** (backed up under `sqla.vault.local.v17.unreadable-<time>`) and the UI explains how to recover.
* **Push Secret Vault to Repository:** validate → AES-256-GCM (authenticated, random salt + IV, AAD) with a key derived by **PBKDF2-SHA-256, 310 000 iterations** from a *Vault Sync Passphrase* that is never stored or uploaded → the output is asserted to contain **no plaintext, Base64 or URL-encoded copy** of any secret → push → **read back, decrypt, compare**. No universal key exists anywhere in the source.
* The token is sent only to `api.github.com` over HTTPS and redacted from every error and log.

## Review checklist (requirement 23) — `npm run security` + browser tests
| Requirement | Result | Evidence |
|---|---|---|
| No credentials in source code | ✔ | `security_check.mjs`, `lint.mjs`, build refuses output containing a credential |
| No access tokens in frontend bundles | ✔ | build check + `security_check.mjs` scan `dist/index.html` |
| No secrets in console logs | ✔ | `console.*` is forbidden in `src/` (lint + security check); browser suite asserts no console errors |
| No plaintext Secret Vault data in the repository | ✔ | Node: "Secret Vault …"; Browser: "the repository file contains no plaintext or Base64 token" |
| No sensitive information in error messages | ✔ | `redactSecrets` on every GitHub / vault / model error; tested |
| No unsafe HTML injection | ✔ | every dynamic value goes through `e()`; Browser: hostile description and a hostile query name render as text |
| No arbitrary script execution | ✔ | CSP `script-src` is the SHA-256 of the single inline script, no `unsafe-eval`; `eval` / `new Function` / `document.write` forbidden by lint |
| No insecure local storage of credentials | ✔ | token / key only inside the AES-GCM envelope; Browser: token not found in `localStorage` or `sessionStorage` |

## Added in V17.4
* **Knowledge files** (learned queries, Admin Query Library) are untrusted input: every record is re-validated and size-capped on import; ids must match `^[A-Za-z0-9_-]{1,64}$`; credentials (`ghp_`, `github_pat_`, `sk-`, Bearer …) and non-read-only SQL are rejected; tokens are recomputed locally, never trusted.
* **Learned and Admin SQL is never executed** (SQL Assistant has no database connection). Sub-select filters, CTE bodies and admin queries are validated as read-only SELECT before they can reach the generated SQL.
* **Builder draft** (`sessionStorage`) holds only query configuration (no secrets); it is cleared by *Clear* and ends with the browser session.
* The optional **local model** endpoint may be `http://localhost` / `127.0.0.1` only; any other endpoint must be `https://`. Model output must pass the same 12-point validation before it can be shown.

## Limitations
Anyone with both the device and an unlocked browser profile can use the stored token; use a fine-grained token limited to the data repository (**Contents: Read and write**). Storing an encrypted secret in a repository is not equivalent to a server-side vault — use a strong passphrase and rotate the token if the passphrase may have been disclosed. A browser cannot hide a secret from code running in the same origin; the safest practical design (non-extractable keys, no secret in the bundle, strict CSP) is used.


---

## Added in V17.5 — schema passphrase and encrypted synchronization

### Design
| Concern | Implementation |
|---|---|
| Real encryption | AES-256-GCM (authenticated). Key derived with PBKDF2-SHA-256, **310 000 iterations**, random 16-byte salt, random 12-byte IV **per write** (`schemaCrypto.ts`, primitives in `cryptoBox.ts`). No Base64-as-encryption, no obfuscation, no plaintext. |
| Tamper detection | The clear header (format, versions, writer, time, schema count) is bound to the ciphertext as AAD: changing any header field makes decryption fail. A second GCM seal (`check`) under the same key distinguishes **wrong passphrase** from **damaged file** without exposing anything. |
| Domain separation | Different AAD strings for the schema file, its check value and the Secret Vault, so one kind of file can never be opened as another. |
| Downgrade protection | KDF parameters in a file are range-checked (100 000 … 2 000 000 iterations); a downgraded cost is refused. |
| Nothing readable in the repository | The header contains **no table or column names**, only counts and versions. Asserted by tests (no schema name, table, column, decode label, passphrase, or Base64/URL-encoded forms of them in the file). |
| Where the passphrase lives | On a device **only as AES-256-GCM ciphertext** under the same non-extractable device key (IndexedDB) that protects the vault (`schemaPassphrase.ts`). If that key is lost the value is reported unreadable and **kept** — never silently deleted. Never in the repository, the vault file, a URL, browser history, a log, an error message, the page text or the source. |
| No hard-coded secret | No key, passphrase or token exists in the source or the bundle (`npm run security` scans both; the browser suite checks the bundle for the test passphrases). |
| UI | Passphrase inputs are `type=password`, `autocomplete=off`, no spell-check; the value is assigned as a property, never written into markup; the eye button toggles `type` and exposes `aria-pressed` / `aria-label`. Hidden by default. |
| Errors | Messages never contain the passphrase (verified for every failure kind); network/repository errors pass through `redactSecrets` with the passphrase and tokens as known secrets. |
| Transactional import | Preview writes nothing (no schema, no sync metadata, no log). *Apply* uses the existing validated registry write with rollback; every failure mode was tested to leave the local schema, active schema and sync state unchanged. |
| Authorization | Pulling needs the passphrase (possession of the secret) and the repository connection. Publishing/changing the passphrase is in Settings (Admin Password). |

### Review checklist (requirement 15 / 23)
| Requirement | Result | Evidence |
|---|---|---|
| Passphrase used for real encryption/decryption | ✔ | Node "V17.5 crypto"; Browser "real AES-256-GCM (PBKDF2)" |
| No Base64 / plaintext / obfuscation / hard-coded key or passphrase | ✔ | Node (file and storage contain none of them); `npm run security` |
| Not in console logs, URLs, browser history, error messages, source, unencrypted repository files | ✔ | Browser "never in the page text, the URL or the console"; "nothing … reached any console message"; Node "never echoed" |
| Passphrase masked by default, reveal on click, hide on click | ✔ | Browser "Show reveals…, Hide masks it again" |
| Existing Secret Vault / GitHub synchronization unchanged | ✔ | Browser baseline suites unchanged and green |

### Limitations
* The repository connection token is still required to *download* the encrypted file from a private repository; the passphrase protects the **content**, not access to the repository.
* A passphrase typed on a device is, like any secret in a browser, readable by code running in that origin; the safest practical design is used (non-extractable device key, strict CSP, no secret in the bundle). Use a long, unique passphrase and share it only through a secure channel.
* When a passphrase is introduced, a plain `registry.json` already in the repository is **not deleted** by the app — remove it manually.


---

## Added in V17.5.1 — admin message
| Concern | Implementation |
|---|---|
| Rendering | The text is escaped by `e()` in every place it is shown (navbar row, admin panel). It is never assigned as HTML, never turned into a link, never evaluated. Browser tests publish `<img onerror>` / `<script>` payloads and assert that no element is created and no script runs. |
| What may be written | One line, ≤ 140 characters (counted as characters), control characters removed. Text that matches the credential patterns used elsewhere in the app (GitHub / API tokens, bearer tokens) or reads like `password: …`, `passphrase = …`, `token: …`, `secret: …` is refused **before** anything is stored or published. |
| Untrusted input | The repository file and the local copy are validated field by field (`sanitizeMessage`): format marker, format version (newer → ignored), id pattern, date, boolean flag, level (unknown → *information*), text rules (a record that violates them is dropped). A hostile or damaged file never replaces the message already shown. |
| Confidentiality | The file is **plain JSON** by design (it is a public notice). It is in the same repository as the schemas, so it is as visible as the repository is. The panel and `docs/ADMIN_MESSAGE.md` say so. Nothing secret is stored locally (the message, its id, the dismissed id and a sync marker only). |
| Authorization | Publishing and clearing live in Settings (Admin Password). Reading needs no extra permission beyond the existing repository connection; the app sends the token only to api.github.com as before. |
| Errors | Repository errors pass through `redactSecrets` (known vault secrets + the saved schema passphrase). A failed download is silent for users; for the administrator the result states the stage and what happens next. |
| Isolation | Separate file and separate storage keys (`sqla.adminmsg.v1751`, `…meta…`, `…dismissed…`). Tested: the schema file stays byte-identical and the sync metadata unchanged after publish / clear / pull. |

### Limitation
Anyone with write access to the repository can publish a message (the file is not signed). Treat it as a convenience notice, not as an authenticated instruction — for example, do not ask users to take a security-sensitive action solely because a message says so.


---

## Added in V17.5.2 — repository client hardening and status

| Concern | Implementation |
|---|---|
| Availability | Every GitHub request has a 20-second limit (`AbortController`). Previously one request that never answered blocked every later synchronization because they are serialized (denial of service of one's own sync queue). Tested: a hung request ends with a typed `timeout` error and the next pull runs normally. |
| Input to the URL | `owner` and `repository` must match `[A-Za-z0-9_.-]` (≤ 100) and the branch may not contain whitespace, `?` or `#`; anything else is refused as a `config` error **before** any request is made (the token is sent only to `api.github.com`, as before). |
| Error handling | Typed `RepositoryError` (`auth`, `permission`, `not-found`, `conflict`, `timeout`, `network`, `config`, `http`). Messages never contain the token (tested with a token inside the underlying network error). The Pull tab maps each class to a next step. |
| Secrets in the UI | The new status block shows only *whether* a connection, a token and a passphrase exist — never the values. Verified in the browser tests: no passphrase or token in page text, URL, console, any repository file or any request body received by the shared remote. |
| Encryption / formats | **Unchanged.** AES-256-GCM + PBKDF2-SHA-256 (310 000), `sqla-schema-sync` v1, plain registry format 2, vault envelope. V17.5.1-style files are read as before (tested). No migration. |
| Misleading state | A local edit is shown as *not yet published* until a push succeeded; a pull that did not apply everything is reported as partial. |

### Limitations
* The schema passphrase is stored on a device only as ciphertext under the non-extractable device key, but *Remember this passphrase* is ticked by default on the Pull tab (V17.5 behaviour, kept so as not to change the workflow). On a shared computer, untick it or use *Remove saved passphrase*.
* Anyone who holds a token with write access to the repository can publish a file; files are validated on import, but authenticity is not signed.


---

## Added in V17.5.3 — Push to GitHub and verified publication

| Concern | Implementation |
|---|---|
| Two different secrets | **GitHub access token** (authorizes reading / writing the repository; stored in the Secret Vault, AES-256-GCM, non-extractable device key) and **Vault passphrase** (encrypts the schema file; AES-256-GCM, PBKDF2-SHA-256 310 000). The Vault passphrase never grants GitHub access and a token never decrypts the schema file. The UI says so where it matters. |
| No secret in source / bundle | Verified by `npm run security`, by the build (refuses output with a credential) and by browser test: neither the passphrases used in the tests nor any token-shaped string is in `src/` or `dist/index.html`. **No production passphrase exists anywhere in the project** — a passphrase has to be entered on each device. |
| Passphrase handling during a publication | The typed passphrase is used for that one publication, is redacted from every message and log, is never placed in a URL / history / title / markup, and is saved on the device (ciphertext only) **only after the publication was verified**. A failed or unconfirmed publication never changes the saved passphrase. |
| Privileged action | Publishing asks for the **Admin Password** (checked before any network call), like the Settings action. |
| What is written | Exactly one file (`…/schemas/registry.enc.json`). Verified against the emulated repository: every other file is byte-identical afterwards. The encrypted file contains no table, column, schema name, label, passphrase or token (tested). |
| Integrity of the result | Success requires a read-back that decrypts and equals what was written. Otherwise: *"The repository did not confirm the update"*, nothing is recorded, nothing is called synchronized. |
| Repository protection | Never publishes an invalid schema; refuses to drop repository-only schemas; pauses on unresolved conflicts; never replaces an unreadable file unless the administrator ticks *Replace the repository file* (and confirms). |

### If a passphrase may have been disclosed (for example pasted into a chat or e-mail)
1. Treat it as **compromised**. Do not reuse it.
2. On a device that can publish: *Schema → Push to GitHub*, type a **new** Vault passphrase, tick **Replace the repository file …**, confirm. Tell colleagues the new passphrase through a secure channel; they enter it under *Pull Schema*.
3. **Limits of rotation:** earlier commits of the repository still hold the old ciphertext. Anyone with the old passphrase **and** read access to the repository history can read *old versions* of the schema. If that matters, restrict repository access, and consider rewriting the repository history (a GitHub operation SQL Assistant does not perform).
4. If a **token** was disclosed, revoke it in GitHub and enter a new one under *Settings → Secret Vault*. Rotating the Vault passphrase does not revoke a token and revoking a token does not rotate the passphrase.
SQL Assistant never rotates a passphrase by itself, so existing encrypted data cannot become unreadable by accident.

### Limitations
* The repository token is stored on the device encrypted under a non-extractable key; anyone who can use an unlocked browser profile can use it. Use a fine-grained token limited to the data repository (**Contents: Read and write** to publish, **Read** to pull).
* A browser cannot hide a secret from code running in its own origin; the safest practical design is used (no secret in the bundle, non-extractable keys, strict CSP).
* *Replace the repository file* overwrites the previous file in the repository's *current* version (earlier commits remain, as above).
* Real-GitHub behaviours that the test environment could not exercise (branch protection rules, SSO-authorized tokens, secondary rate limits) will surface as typed errors (*permission*, *http*) but were not tested against github.com.


---

## Added in V17.5.4 — fixed repository, pre-filled Vault Sync Passphrase, relocated cards

| Concern | Implementation / result |
|---|---|
| **Pre-filled Vault Sync Passphrase (as requested)** | The value is a constant in `src/v17/services/repositoryDefaults.ts` and therefore **ships inside the application's JavaScript** (`dist/index.html`): anyone who can load SQL Assistant can read it. It protects the encrypted vault file only against people who cannot also read the repository (`basware/sk-ap-sql-assistant`). It is defined in one file only (tested), is assigned to the masked field as a *property* (never written into markup, storage, logs, URLs or the repository — tested), and can be replaced by typing. **To stop pre-filling it set `DEFAULT_VAULT_PASSPHRASE` to `''`; to rotate it, push a Secret Vault under a new passphrase and update the constant.** If the value has been shared outside a secure channel, treat it as exposed. |
| Fixed repository location | `withLockedLocation()` is applied to the secrets that all synchronization reads. The values are read-only in the UI. Stored data from older versions is never modified or deleted — it is ignored. A retrieved vault cannot change the location. |
| Access token | Unchanged storage (AES-256-GCM, non-extractable device key). Setting or changing it is now on the Schema page, which is not password-protected like Settings, therefore **it requires the Admin Password** (wrong password → nothing changes). The token is never shown, logged, stored in the markup or written to the repository. |
| Pull Secret Vault | Read-only against the repository (tested: no write, no changed file). A wrong passphrase, a missing file, a rejected token, a network failure and a timeout each report the cause and change nothing on the device. A busy flag prevents duplicate requests. |
| Push Secret Vault | Unchanged: validated, encrypted, read back and verified; the file contains no plaintext or Base64 token / passphrase. |
| Removed UI | The Push-to-GitHub tab and the Schema-passphrase card are gone; no secret handling was removed from the shared logic. |


---

## Added in V17.5.5 — hidden configuration, passphrase-free Pull Schema

| Concern | Implementation / result |
|---|---|
| Hidden repository configuration | Repository, branch and schema path are hidden by default behind a reveal button and are read-only when revealed. **This is a presentation choice, not a security boundary**: the values are constants in the application's JavaScript (`repositoryDefaults.ts`) and are not secrets. The toggle never reads or writes saved data (tested: storage is byte-identical). |
| Pull Schema without a passphrase | The decryption requirement is **not** removed: a passphrase-protected file is opened only with a Vault passphrase already saved on the device (ciphertext under the non-extractable device key, unchanged). A file that cannot be opened is reported — never treated as missing, never opened with another passphrase. The default Secret Vault passphrase is **never** used for schemas (tested with a schema file encrypted under it). |
| What is published by default | With no passphrase saved on a device, *Sync with GitHub Now* publishes the **plain** schema file (the V17.4 behaviour). Schema files contain table / column / label metadata, not credentials. If that metadata is confidential, keep the repository private; there is no longer a screen to start encrypted publication (the *Schema passphrase* card and the Push tab were removed in V17.5.4). |
| Default Vault Sync Passphrase | Unchanged from V17.5.4: one constant, used only by *Pull Secret Vault to Repository*, masked, never in markup / storage / logs / URLs / repository files / messages; it is in the application bundle, so treat it as known to anyone who can load the application and rotate it (push a vault under a new passphrase and update the constant) if it may be exposed. |
| Messages | No token or passphrase in any pull / vault message (tested against 401, 403, network, timeout, damaged, incompatible and invalid files). |


## Added in V17.5.7 — token validation, cross-device recovery, administrator-only configuration

| Concern | Implementation / result |
|---|---|
| Responsibilities kept apart | **Encryption / decryption:** `cryptoBox.ts` + `secretVault.ts` (no network code — tested). **Token validation / network:** `githubClient.ts` (`validateTokenAccess`, `checkRepositoryLocation`; no crypto, no password code — tested). **Authentication of administrators:** `passwordService.ts`, called by `repositoryConfig.saveRepositoryConfig()` and the token card. **Location:** `repositoryConfig.ts`. The UI only collects input and shows messages. |
| Token validation | Save Token and vault import ask GitHub (`GET /repos/{owner}/{repo}`, Bearer, 8 s limit, sent only to api.github.com). 401 ⇒ rejected and never replaces a working token; read-only (`permissions.push` false) ⇒ saved with a warning; 403 / 404 ⇒ saved with an explanation; offline ⇒ saved with "saved anyway". When GitHub does not report permissions the message says so instead of claiming write access. The token is never in a message, URL or log (tested with the real token string). |
| Where the token lives | Typed or imported, it is stored only as AES-256-GCM ciphertext under the non-extractable device key (existing mechanism); the page shows `••••••••` + last 4 characters. **Never** in the repository in clear: the pushed vault is ciphertext only and is asserted to contain no plaintext / Base64 / URL-encoded copy of any secret (tested in Node and in the browser). No credential in source, bundle or build output (the build refuses credential-looking strings). |
| **The default passphrase is not a secret** | `xG71…` ships inside the application bundle, so a vault protected only by it can be decrypted by anyone who can read the repository **and** load the application. It is preserved (requirement) and still pre-filled; pushing with it now shows a warning, the Pull Secret Vault card says so, and the cross-device test uses an administrator-chosen passphrase and proves the default cannot open it. Treat the token as protected by repository privacy + token scope in that case: use a fine-grained token limited to this repository, keep the repository private, push with your own passphrase (min. 10 characters), rotate the token if exposed. |
| Crafted vault file (found while tracing the data flow) | Because the default passphrase is public, a vault file can be fabricated by anyone who can write to the repository. An imported vault can therefore **not** influence where later pushes write (its vault path is ignored; its repository location is overridden by the authoritative configuration), and push validation refuses a vault path that equals the schema registry / its encrypted twin, lies in a schemas / knowledge / messages folder, or is not `.json`. A fabricated vault can still deliver a *token chosen by the attacker* to a device that imports it: the token is checked with GitHub (a token that does not work is not used) and the card shows it only masked — keep write access to the repository restricted. |
| Who may change the repository configuration | Only a caller that passes the **existing Admin Password check**; the check is the first statement of `saveRepositoryConfig()` (service level). Tested: wrong / empty / null passwords, a throwing verifier, in the browser the fields stay read-only. The unlocked editor locks itself after 5 minutes. An import never reveals or alters the configuration card (tested). |
| **Security limitation (documented, not hidden)** | SQL Assistant is a client-side application with no server. The configuration, like every setting, lives in `localStorage`. Anyone who can run JavaScript in the origin (developer tools) can write that key **without** the Admin Password. The Admin Password protects against ordinary use, not against a determined local user. The record is validated on every read, holds no secret, and a repository still needs the token. **No new authentication model was introduced.** A stronger boundary needs a server component (managed configuration, identity-aware proxy). |
| Cross-device recovery limits | A new device has no credential, so it cannot read a **private** repository by itself: it needs the vault file (downloadable from GitHub) or a token already on the device. Zero-interaction recovery without a user-supplied secret would require a backend / key-management service and is **not** implemented. The passphrase is never stored or uploaded. |
| Push safeguards | Reads the repository vault first; unreadable-with-this-passphrase or would-remove-a-secret ⇒ explicit confirmation (declining writes nothing); `sha` concurrency (409 / 422 refused); read-back verification; one push at a time; only ciphertext is uploaded. |


## Added in V17.6.1 — Secret Vault recovery without a pre-existing token (GitHub sign-in)

| Concern | Implementation / result |
|---|---|
| **What decrypts what** | The **Vault Sync Passphrase** decrypts the Secret Vault (AES-256-GCM, PBKDF2-SHA-256, 310 000 iterations — unchanged). It does **not** authenticate to a private repository and is never treated as a credential. The card says so. |
| **How a device with no token is authorized** | The OAuth **device authorization flow** (RFC 8628): the user signs in on github.com **as themselves**; the repository's own access control decides. No privileged token, client secret or long-lived credential exists anywhere in the source, the bundle, the public configuration or browser storage (tested: bundle scan, storage scan, every request inspected). The only deployed values are the GitHub App's **public client ID** and the relay address. |
| **The sign-in token** | Short-lived, per user, limited by the GitHub App's own permissions (recommended **Contents: Read-only**, installed on the one repository). Held in a local variable for **one** Contents read of the vault file, never written to storage / the vault / a URL / a log / a message, then dropped (tested: only a GET of the vault path ever carries it; no write; absent from DOM, storage, console, URLs and request bodies). It is registered for redaction while it exists. |
| **What the user is shown** | A short user code and the **real** `github.com/login/device` address. The address is validated by the client (`https`, host exactly `github.com`, no credentials / port, `/login/…`): a relay or anything in between cannot send the user elsewhere. The device code is never shown or logged. |
| **The relay** (`scripts/github-device-relay.mjs`) | Forwards exactly two requests; allow-listed client ID **and** page origin (no CORS header otherwise; requests without an allowed origin are refused); 2 KB body limit; per-origin rate limit; whitelist of response fields (refresh tokens dropped); `GITHUB_BASE` override only for localhost; no client secret; **no logging of bodies, addresses, codes or tokens** (tested: the process output contains none). **Trust assumption:** it sees the short-lived sign-in token in the `/device/token` response — operate it yourself, over HTTPS, without body logging. |
| **No bypass** | A private repository still answers 404 to anonymous requests and the card reports that; only a successful sign-in changes it. An account without access gets "cannot read the configured repository", an expired authorization gets "sign in again". Nothing is retried with another credential or passphrase. |
| **Validated before it changes anything** | (1) the file's existence, JSON structure and **version / algorithm / iteration bounds** (an HTML login page is recognised) **before** decryption; (2) authenticated decryption; (3) the decrypted contents (a token must be present and plausible); (4) **GitHub is asked whether the restored token works for the repository**: *rejected* → refused; *cannot use the repository* → refused; *read-only* → restored with a warning; *unconfirmed* (offline) → never replaces a saved token. Every refusal leaves the saved token, the stored vault and all settings byte-identical (tests compare the whole storage). |
| **Wrong passphrase after a sign-in** | The retrieved **ciphertext** (no secret) is kept in memory for 10 minutes so the passphrase can be corrected without signing in again; it is discarded on success and with the page. |
| **Passphrase** | Asked for before anything is requested; never stored, uploaded, logged, placed in a URL, message or markup; never retried with another value; the default (`DEFAULT_VAULT_PASSPHRASE`) is preserved unchanged and pre-fills the masked, editable field — **it ships in the application, so it is not a secret**. A vault read **without any GitHub credential** that opens with it carries a warning. |
| **Leaving the page / Cancel** | Both stop the polling at once (tested); the device code expires in ≤ 15 minutes anyway. |

### Limitations (V17.6.1)
* The feature needs the administrator's one-time setup (GitHub App + relay + configuration file). Without it the card reports honestly what a private repository requires.
* The relay is a trusted component (see above). A compromised relay could capture a short-lived, read-only, per-user token while it is valid — which is why the GitHub App should have **Contents: Read-only** and be installed on the one repository only.
* A restored token is stored like a typed one: anyone who can use that unlocked browser profile can use it; clearing site data removes the device key and the token. It is not "permanently available across devices": each device restores it once.
* Verified against an emulated GitHub API and a local stub of github.com's device endpoints, **not** against github.com or a real SAML-SSO organization.

---

## Added in V17.6.2 — a centrally managed GitHub PAT that never reaches a device

| Concern | Implementation / result |
|---|---|
| **Where the PAT lives** | One copy: the GitHub Actions repository secret `SQLA_GITHUB_PAT` (fine-grained, one repository, *Contents: Read and write*). A repository secret cannot be read by a browser, GitHub Pages or any GitHub API; it is delivered by `deploy-broker.yml` — the only workflow that sees it — to the repository access broker as an application setting. It is **not** in the repository, in the bundle (tested: no PAT, user token, device code or client-ID value in `dist/index.html` or `src/`), in browser storage, in a URL, in a response, in a log or in an artifact. |
| **What the broker can be asked to do** | Read / write **one `*.json` file at a time below `sql-assistant-data/`** of an allow-listed repository. There is **no endpoint that returns the PAT**. Everything else is refused: other repositories, other folders (so `.github/workflows` can never be written), non-JSON, > 8 MB, a body that contains a GitHub token, a private key or the PAT itself, oversized or malformed requests. |
| **Who may use it** | Only a caller that holds a **broker session**, which is issued only after GitHub's own device flow showed that the caller's GitHub account may read the repository (the broker runs the flow: the browser never sees a GitHub token or the device code; the user's token is used for two requests and dropped). Writing additionally needs write permission on the repository (fail-closed when unknown). Sessions are HMAC-SHA-256 signed (`SQLA_SESSION_SECRET`), expire (8 h default), are bound to the repository they proved, and are **not** GitHub credentials. They live in `sessionStorage` only. |
| **Admin Password** | Unchanged and **separate**: it protects the repository configuration card on the device; it is never sent to the broker and is never treated as GitHub authorization. The broker re-enforces the repository / path allow-lists server-side, so a tampered local configuration cannot point the PAT at anything else. |
| **No silent fall-back** | With central access deployed, `repository()` returns `null` without a sign-in — it never falls back to a token on the device; with it not deployed the V17.6.1 behaviour is untouched. A single function decides, so no feature has an authentication path of its own (tested by source scan). |
| **Secret Vault** | Cryptography and envelope unchanged. With central access a pushed vault contains **no GitHub token** and a retrieved vault's token is **not restored** (it is neither needed nor wanted on a device). The structural check → authenticated decryption → content check → restore order is unchanged; every refusal leaves the device byte-identical (whole-storage comparison, Node and browser). |
| **Audit** | One JSON line per sign-in and write (time, GitHub login, repository, path, outcome); each commit message names the signed-in user. No body, token, code or content is ever logged (tested). |
| **Failure reporting** | missing · invalid / expired / revoked · insufficient (no Contents permission, repository not granted, SSO) · read-only · repository invisible · rate limit · no sign-in · account without access / without write · service unreachable — each with its own message, none containing a secret. `verify-repo-pat.yml` warns weekly, 14 days before expiry. |
| **Broker hardening** | allow-listed browser origins (CORS), per-session / per-origin rate limit, request size limits, `redirect: 'error'` on every GitHub call, no exception text in answers, GitHub base URLs overridable only for localhost (tests), refuses to start with unusable public settings. |

### Limitations (V17.6.2)
* The broker is a **trusted component**: whoever controls its host or its application settings controls the PAT. Protect it like the secret itself (HTTPS, restricted deployment, an Environment with required reviewers for `deploy-broker.yml`).
* Anyone who can read the repository can read the encrypted vault; its passphrase (the built-in default is public) is the protection — use your own.
* The Admin Password is still a client-side control (V17.5.7 note).
* Verified against a local model of GitHub, not against github.com, a real GitHub App, SAML SSO or an Azure host (see `TEST_REPORT_V17.6.2.md`).

---

## Added in V17.6.3 — published data: reading the private repository with no credential

| Concern | Implementation / result |
|---|---|
| **No PAT for reading** | The publication workflow uses only the built-in `GITHUB_TOKEN` (`contents: write`, `actions: write`). The central PAT (`SQLA_GITHUB_PAT`) is **not** used by any V17.6.3 path (tested: the workflow does not reference it; the emulated GitHub saw no PAT use from the page). |
| **Integrity** | `published.json` (written last) lists the SHA-256 of every file. The page accepts a file only if the bytes served hash to the listed value; a mismatch, a listed-but-unserved file, the SPA fallback page and a 401/403 are refused with a specific message and **nothing is applied** (whole-storage comparison in the tests). The marker itself is strictly validated (format, version, commit, repository, paths, hashes). |
| **What can be published** | Only `*.json` below `sql-assistant-data/`; never `*.config.json` (a repository write could otherwise redirect the sign-in / broker address of every device), dot-files, symlinks, > 8 MB, > 500 files. A forged `published.json` in the repository is ignored (the script writes its own). **A file with a GitHub token or private key in readable form fails the run.** |
| **Who can read it** | Everyone who can load the site. The registry is plain schema metadata; the vault is AES-256-GCM. The site's own access rules apply (a 401/403 is reported). |
| **Write path** | Unchanged and credential-based: the published repository throws on write; a device with no token cannot publish and is told why. |
| **Central token vault** | Built only on request in a trusted run: the token must be fine-grained, single-repository and **read-only** (a writing token is refused); the public default passphrase is refused unless explicitly allowed; the file is the standard envelope (no readable token — asserted, including Base64); GitHub's message and the SSO header are printed on refusal, never the token. **A token restored on a device is stored like a typed one** (encrypted, non-extractable device key). |
| **Auto-population** | Uses only the built-in default passphrase and the normal validated import (GitHub is asked about the token; a token GitHub rejects is not restored). It never tries another passphrase, runs once per page load, and every failure leaves the device byte-identical. |
| **Precedence** | test repository → central broker → token on the device → published copy → none: a stronger credential is never silently replaced by a weaker route, and with the broker deployed there is no fall-back to the published copy. |

### Limitations (V17.6.3)
* The default passphrase is public, so an auto-restorable central vault is only as private as the site and repository. Prefer `SQLA_VAULT_PASSPHRASE`.
* A publication can briefly lag or be inconsistent (the page refuses an inconsistent one and the user retries).
* Verified against an emulated GitHub API and static servers, not github.com, GitHub Actions or the zone platform (see `TEST_REPORT_V17.6.3.md`).

## V17.7 — what the browser can and cannot protect
* **No test back door in production.** The browser-test hooks (an in-memory repository, the store, the module registry) exist only in `test-dist/` (`npm run build:test`), never in `dist/`, `index.html` or `release/`; `verify:artifact` fails on any trace. In V17.6.9 the production page created them whenever the address contained `?e2e=1`.
* **The default password has one door** (`verifyDefault`) and is confirmed by evidence only (`docs/ADMIN_PASSWORD.md`).
* **Honest limit.** SQL Assistant is a client-side application. A person who controls the browser (developer tools, a modified copy of the page, edited browser storage) controls everything that runs there; the Admin Password protects the Settings of the **application as deployed**, it is not a server-side access control, and the central verifier can be attacked offline by anyone who can read the repository (see `ADMIN_PASSWORD.md`, limitations). Protect write access to the data repository and use a long Admin Password.
