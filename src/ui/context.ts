/** Services are created inside boot() AFTER the page markup is on screen, so no service failure can blank the page. */
import { SchemaService } from '../services/schemaService';
import { browserStore, type KeyValueStore } from '../services/storage';
import { SecretVault, EMPTY_SECRETS, type VaultSecrets } from '../v17/services/secretVault';
import { indexedDbKeyProvider } from '../v17/services/cryptoBox';
import { githubRepository, validateTokenAccess, type SchemaRepository } from '../v17/services/githubClient';
import { fetchPublishedMarker, publishedRepository, type PublishedState } from '../v17/services/publishedData';
import { fetchBrokerConfig, brokerRepository, BrokerSessionStore, type BrokerConfigState, type BrokerSession, type BrokerRepoInput } from '../v17/services/repoBroker';
import { loadRepositoryConfig, applyRepositoryConfig, DEFAULT_REPOSITORY, type RepositoryConfig } from '../v17/services/repositoryConfig';
import { SyncService } from '../v17/sync/syncService';
import { LearningStore } from '../v17/services/learningStore';
import { AdminQueryLibrary } from '../v17/services/adminLibrary';
import { KnowledgeSync, knowledgePathFor } from '../v17/services/knowledgeSync';
import { runMigrations, type MigrationState } from '../v17/services/migrations';
import { SchemaPassphraseStore } from '../v17/services/schemaPassphrase';
import { encryptedPathFor } from '../v17/services/schemaCrypto';
import { AdminMessageService, adminMessagePathFor } from '../v17/services/adminMessage';
import { loadAiConfig, DEFAULT_AI_CONFIG, type AiLlmConfig } from '../v17/services/aiLlmService';
import { AdminCredentialService, type WriteRoute } from '../v17/services/adminCredentialService';
import { setCentralProvider } from '../services/passwordService';
import { deviceTag } from '../services/storage';
import { APP_NAME, APP_VERSION } from '../v17/sync/schemaFormat';
export const APP = { name: APP_NAME, version: APP_VERSION };
export interface Services { store: KeyValueStore & { persistent: boolean }; schemas: SchemaService; vault: SecretVault; learning: LearningStore; admin: AdminQueryLibrary; knowledge: KnowledgeSync; migrations: MigrationState; sync: SyncService; /** V17.5: the passphrase saved on this device for the synchronized (encrypted) schema */ passphrase: SchemaPassphraseStore; /** V17.5.1: the short cross-device administrator message shown in the navbar */ adminMessage: AdminMessageService; /** V17.6.5: the central Admin Password record (refresh, Save, Reset) */ credential: AdminCredentialService; }
let svc: Services | null = null;
/** V17.5.6: the ONE repository configuration (defaults, or the administrator's saved override — see repositoryConfig.ts). Every synchronization reads its location from `secrets`, which is derived from this. */
export let repoConfig: RepositoryConfig = { ...DEFAULT_REPOSITORY }; export let repoConfigCustom = false; export let repoConfigProblem: string | null = null;
const locate = (s: VaultSecrets): VaultSecrets => applyRepositoryConfig(s, repoConfig);
export let secrets: VaultSecrets = locate({ ...EMPTY_SECRETS });
/** Re-reads the saved configuration and re-applies it to the secrets (called at start-up and after an administrator saved a change). */
export function refreshRepositoryConfig(): RepositoryConfig { const r = loadRepositoryConfig(services().store); repoConfig = r.config; repoConfigCustom = r.custom; repoConfigProblem = r.problem; secrets = locate(secrets); return repoConfig; }
export let aiConfig: AiLlmConfig = { ...DEFAULT_AI_CONFIG };
export let vaultProblem: string | null = null;
let override: SchemaRepository | null = null;
export const setAiConfig = (c: AiLlmConfig) => { aiConfig = c; };
/** Browser-test hook (only exposed with ?e2e=1): an in-memory repository instead of GitHub. */
export const setRepositoryOverride = (r: SchemaRepository | null) => { override = r; };
export const hasRepositoryOverride = () => !!override;
/**
 * V17.6.2 — CENTRAL REPOSITORY ACCESS. When the administrator deployed `sql-assistant-data/repo-broker.config.json`, EVERY repository operation (Pull Schema, Pull / Push Secret Vault, schema and knowledge synchronization,
 * the admin message, the live check of the repository card) goes through the repository access service, which holds the centrally managed GitHub PAT; this device holds no token. Without that file the V17.6.1 behaviour
 * (the token saved on the device) is unchanged. There is exactly one place that decides — repository() below — so no feature can have an authentication path of its own.
 */
export let brokerConfig: BrokerConfigState = { state: 'unknown' };
let sessions: BrokerSessionStore | null = null; const sessionStore = (): BrokerSessionStore => (sessions ||= new BrokerSessionStore());
export async function refreshBrokerConfig(): Promise<BrokerConfigState> { brokerConfig = await fetchBrokerConfig(); return brokerConfig; }
/** Browser-test hook (only exposed with ?e2e=1). */
export const setBrokerConfig = (c: BrokerConfigState) => { brokerConfig = c; };
/** true when repository access is central (and no test repository stands in for GitHub) */
export const brokerEnabled = (): boolean => !override && brokerConfig.state === 'enabled';
export const repoLabelNow = (): string => `${secrets.githubOwner}/${secrets.githubRepo}`;
export function brokerSession(): BrokerSession | null { if (brokerConfig.state !== 'enabled') return null; return sessionStore().get(brokerConfig.config.url, repoLabelNow()); }
export const saveBrokerSession = (s: BrokerSession): void => sessionStore().set(s);
export const clearBrokerSession = (): void => sessionStore().clear();
export function brokerInput(): BrokerRepoInput | null { if (brokerConfig.state !== 'enabled') return null; return { url: brokerConfig.config.url, owner: secrets.githubOwner, repo: secrets.githubRepo, branch: secrets.githubBranch || 'main', session: brokerSession, onSessionRejected: clearBrokerSession }; }
/**
 * V17.6.3 — PUBLISHED DATA. When the trusted workflow `publish-data.yml` has published a copy of `sql-assistant-data/` next to the app (marker `sql-assistant-data/published.json`), a device WITHOUT a token reads
 * that copy (no GitHub credential, no PAT, no sign-in). A device WITH a token, and central access (broker), are unchanged and take precedence. Writing always needs a credential. Without a marker nothing changes.
 */
export let publishedState: PublishedState = { state: 'unknown' };
export async function refreshPublished(): Promise<PublishedState> { publishedState = await fetchPublishedMarker(); return publishedState; }
export const setPublishedState = (s: PublishedState) => { publishedState = s; };
export const publishedEnabled = (): boolean => !override && brokerConfig.state !== 'enabled' && publishedState.state === 'available';
export function publishedRepo(): SchemaRepository | null { return publishedState.state === 'available' ? publishedRepository(publishedState.marker) : null; }
export function repository(): SchemaRepository | null {
  if (override) return override;
  if (brokerConfig.state === 'enabled') { const i = brokerInput(); return i && i.owner && i.repo && brokerSession() ? brokerRepository(i) : null; } // central access: no sign-in ⇒ no repository (never a silent fall-back to another credential)
  if (!secrets.githubToken || !secrets.githubOwner || !secrets.githubRepo) return publishedEnabled() ? publishedRepo() : null; return githubRepository({ owner: secrets.githubOwner, repo: secrets.githubRepo, branch: secrets.githubBranch || 'main', token: secrets.githubToken });
}
/**
 * V17.6.5 — the AUTHENTICATED route only (no published copy): the test repository, the broker session, or the token on this device. The central Admin Password record is read fresh through it when this device has one,
 * and it is the ONLY route a change of that record is written through. Nothing here falls back to another credential.
 */
export function authenticatedRepository(): SchemaRepository | null {
  if (override) return override;
  if (brokerConfig.state === 'enabled') { const i = brokerInput(); return i && i.owner && i.repo && brokerSession() ? brokerRepository(i) : null; }
  if (!secrets.githubToken || !secrets.githubOwner || !secrets.githubRepo) return null; return githubRepository({ owner: secrets.githubOwner, repo: secrets.githubRepo, branch: secrets.githubBranch || 'main', token: secrets.githubToken });
}
export function writeRoute(): WriteRoute | null {
  const repo = authenticatedRepository(); if (!repo) return null; if (override) return { repo, kind: 'test', canWrite: true };
  if (brokerConfig.state === 'enabled') return { repo, kind: 'broker', canWrite: brokerSession()?.canWrite ?? false };
  return { repo, kind: 'token', canWrite: null };
}
/** "File not found" is final for the test repository and the broker (it tells a missing file from an invisible repository); for a bare token only when GitHub shows the repository itself to that token. */
async function tokenAbsenceIsFinal(): Promise<boolean> { if (override || brokerConfig.state === 'enabled') return true; const a = await validateTokenAccess({ owner: secrets.githubOwner, repo: secrets.githubRepo, token: secrets.githubToken }); return a.state === 'ok'; }
async function probeTokenWrite(route: WriteRoute): Promise<boolean | null> { if (route.kind !== 'token') return route.canWrite; const a = await validateTokenAccess({ owner: secrets.githubOwner, repo: secrets.githubRepo, token: secrets.githubToken }); return a.state === 'ok' ? a.canWrite : a.state === 'no-access' || a.state === 'rejected' ? false : null; }
export function initServices(): Services {
  if (svc) return svc; const store = browserStore(); const migrations = runMigrations(store); const schemas = new SchemaService(store); const vault = new SecretVault(store, indexedDbKeyProvider); vault.setLocator(locate);
  { const r = loadRepositoryConfig(store); repoConfig = r.config; repoConfigCustom = r.custom; repoConfigProblem = r.problem; secrets = locate(secrets); }
  const passphrase = new SchemaPassphraseStore(store, indexedDbKeyProvider); const learning = new LearningStore(store); const admin = new AdminQueryLibrary(store, () => store.get('sqla.adminname.v174') || 'Administrator');
  const credential = new AdminCredentialService({ store, deviceId: () => deviceTag(store), authRepo: authenticatedRepository, authAbsentIsFinal: tokenAbsenceIsFinal, publishedRepo: () => (publishedState.state === 'available' ? publishedRepo() : null), writeRoute, probeWrite: probeTokenWrite, beforeUnlockRefresh: async () => { await refreshPublished(); }, secrets: () => [...vault.knownSecrets(), ...passphrase.known()] });
  svc = { store, schemas, vault, credential, learning, admin, migrations, knowledge: new KnowledgeSync(learning, admin, repository, store, () => knowledgePathFor(secrets.schemaPath), () => vault.knownSecrets()), sync: new SyncService(schemas, repository, store, () => secrets.schemaPath, () => [...vault.knownSecrets(), ...passphrase.known()], { passphrase: () => passphrase.get(), path: () => encryptedPathFor(secrets.schemaPath), saved: () => passphrase.hasSaved() }), passphrase, adminMessage: new AdminMessageService(store, repository, () => adminMessagePathFor(secrets.schemaPath), () => [...vault.knownSecrets(), ...passphrase.known()]) };
  setCentralProvider(() => svc!.credential.view());
  aiConfig = loadAiConfig(store); return svc;
}
export function services(): Services { if (!svc) throw new Error('Services are not initialised yet.'); return svc; }
export async function reloadSecrets(): Promise<VaultSecrets> { try { secrets = locate(await services().vault.load()); vaultProblem = null; } catch (e) { secrets = locate({ ...EMPTY_SECRETS }); vaultProblem = (e as Error).message; } return secrets; }
