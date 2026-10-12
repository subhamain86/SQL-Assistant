/**
 * V17.5.4 — the ONE place where the shared repository location and the pre-filled Vault Sync Passphrase are defined.
 *
 * LOCKED_REPOSITORY: owner/repo, branch and schema file path are fixed by the application. They are shown (read-only) under Schema → Pull Schema and are applied by
 * withLockedLocation() to the secrets that every synchronization (schemas, encrypted schema, knowledge, admin message, Secret Vault) reads — so no screen can disagree.
 * Nothing stored on a device is deleted or rewritten: the stored values are simply ignored in favour of these.
 *
 * DEFAULT_VAULT_PASSPHRASE: pre-fills the masked "Vault Sync Passphrase" field of the "Pull Secret Vault to Repository" card (the user can still overwrite it).
 * SECURITY NOTE: this value ships inside the application's JavaScript, so anybody who can load the application can read it. It only protects the encrypted vault file
 * against people who cannot also read the repository. Set it to '' to remove the pre-filled value; rotate it (push a new vault with a new passphrase) if it is exposed.
 */
import type { VaultSecrets } from './secretVault';
export const LOCKED_REPOSITORY = { owner: 'basware', repo: 'sk-ap-sql-assistant', branch: 'main', schemaPath: 'sql-assistant-data/schemas/registry.json' } as const;
export const LOCKED_REPOSITORY_LABEL = `${LOCKED_REPOSITORY.owner}/${LOCKED_REPOSITORY.repo}`;
export const DEFAULT_VAULT_PASSPHRASE = 'xG71lfp1NHZVZ4WVWCPe';
/** V17.5.7: true when a passphrase is the built-in default. That value ships in the application bundle, so a vault protected only by it is NOT secret from anyone who can read the repository and load the application. */
export const isDefaultVaultPassphrase = (p: string) => p === DEFAULT_VAULT_PASSPHRASE;
/** Returns a copy of the secrets whose repository location is the locked one. The token, AI key and vault file path are untouched. */
export function withLockedLocation(s: VaultSecrets): VaultSecrets { return { ...s, githubOwner: LOCKED_REPOSITORY.owner, githubRepo: LOCKED_REPOSITORY.repo, githubBranch: LOCKED_REPOSITORY.branch, schemaPath: LOCKED_REPOSITORY.schemaPath }; }
