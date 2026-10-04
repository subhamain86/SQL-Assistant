# SQL Assistant — Security model

## What is protected, and how

| Data | Where it lives | Protection |
|---|---|---|
| Admin Password | Never stored; only an encrypted marker (`sqla.pwvault.v15`) is kept | Verified by decrypting the marker (PBKDF2-SHA-256, 150,000 iterations → AES-256-GCM) |
| Local Secret Vault: GitHub token, repository settings, AI/LLM API key, M365 Copilot settings | Browser localStorage (`sqla.secretvault.v15`) | AES-256-GCM. Key derived from the Admin Password (PBKDF2-SHA-256, random salt). Unlocked only in memory while Settings is unlocked; locks after 5 minutes of inactivity. |
| Synchronised Secret Vault (Settings → Secret Vault → Push Secret Vault to Repository) | `sql-assistant-data/vault/secret-vault.v17.enc.json` in the repository | AES-256-GCM (authenticated: any modification is detected) with additional authenticated data `sqla-vault-sync:v2`. Key derived with PBKDF2-SHA-256, 600,000 iterations, random 128-bit salt, from a separate **Vault Sync Passphrase**. Also covered by a SHA-256 integrity checksum. |
| Non-secret configuration (repo, branch, schema path, AI/LLM endpoint, model, options) | localStorage | Not secret; not encrypted |
| Schemas and learned query knowledge | localStorage and the repository | Not secret. Learning refuses any request or SQL that looks like a credential, token or password. Literals can be masked when pushing. |

## Separation of the four elements
1. **Encrypted secret data.** Only the token, the API key and the Copilot settings appear in the ciphertext.
2. **Non-secret configuration.** Kept outside the ciphertext (plain settings).
3. **Encryption/decryption process.** Web Crypto API in the browser (`src/v17/services/vaultSyncService.ts`); nothing is sent to a server.
4. **Key material.** The Vault Sync Passphrase:
   - is never written to the repository and never hard-coded;
   - is never stored outside the local encrypted vault ("Remember on this device" is optional).

   The encryption key is therefore never committed next to the encrypted secret.

## What the build enforces
- Before writing the repository file, the push checks that no secret appears in readable or base64 form. If one does, it refuses to write.
- The envelope is validated before decryption. Unknown algorithms, modified parameters or weakened key-derivation settings (fewer than 100,000 iterations) are rejected as possible tampering.
- Error messages pass through `redactSecrets()`: GitHub tokens, API keys, Bearer values and password fields are masked everywhere (UI, log, console).
- `npm run build` refuses to write `index.html` if it contains anything that looks like a real credential. `npm run lint` checks the source the same way.
- Tokens are shown masked (`••••••••1234`) and are never logged.

## Honest limitations
- **Storing an encrypted secret in a repository is not equivalent to a server-side secret vault** (GitHub Actions secrets, Azure Key Vault, HashiCorp Vault). Anyone who can read the repository can copy the ciphertext and try to guess a weak passphrase offline. The 600,000 PBKDF2 iterations slow this down, but a strong passphrase is what really protects the secret. The app enforces at least 12 characters, 3 character types, and no common words.
- A browser-only application cannot protect secrets from someone who controls the unlocked browser session or the device.
- The local vault is only as strong as the Admin Password. **Change the default password** (the app warns while it is in use).
- Rotate the GitHub token if a passphrase may have been disclosed. Use a fine-grained token limited to the schema repository with "Contents: Read and write".
- V16 wrote `sql-assistant-data/vault/secret-vault.enc.json`, encrypted only with the Admin Password. If it still exists: delete it, rotate the token, and use the V17 passphrase-based push instead.
