# Security model: Secret Vault and repository sync

## How secrets are stored
- **On the device:**
  - GitHub settings, the token and the AI/LLM API key are stored encrypted with AES-256-GCM.
  - The key is non-extractable and kept in IndexedDB.
  - If IndexedDB is unavailable, a key for the current session only is used.
- **Push Secret Vault to Repository:**
  - AES-256-GCM, with authenticated data, a random salt and a random IV.
  - The key is derived with PBKDF2-SHA-256 (310 000 iterations) from the **Vault Sync Passphrase**.
  - The passphrase and the key are never stored or uploaded, and are not in the source code.
  - A wrong passphrase or a tampered file fails to decrypt.

## Where secrets never appear
Tokens and keys are never shown in the UI. They are redacted from errors and the sync log, never written to the console, and never learned by the NLU. The build and the lint step fail if the output contains something that looks like a credential.

## Network
The token is sent only to `api.github.com` over HTTPS. The page's Content Security Policy allows only its own two script blocks, identified by their hashes.

## Limitations
Anyone who has both the device (with an unlocked browser profile) and the page can use the stored token. Use a fine-grained token limited to the data repository, with the **Contents: Read and write** permission only.
