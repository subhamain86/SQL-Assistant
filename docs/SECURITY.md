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
