/** Services are created inside boot() AFTER the page markup is on screen, so no service failure can blank the page. */
import { SchemaService } from '../services/schemaService';
import { browserStore, deviceTag, type KeyValueStore } from '../services/storage';
import { SecretVault, EMPTY_SECRETS, type VaultSecrets } from '../v17/services/secretVault';
import { indexedDbKeyProvider } from '../v17/services/cryptoBox';
import { githubRepository, type SchemaRepository } from '../v17/services/githubClient';
import { fetchPublishedMarker, publishedRepository, type PublishedState } from '../v17/services/publishedData';
import { fetchBrokerConfig, brokerRepository, BrokerSessionStore, type BrokerConfigState, type BrokerSession, type BrokerRepoInput } from '../v17/services/repoBroker';
import { loadRepositoryConfig, applyRepositoryConfig, DEFAULT_REPOSITORY, type RepositoryConfig } from '../v17/services/repositoryConfig';
import { CentralConfigService, type CentralConfigOutcome } from '../v17/services/centralConfig';
import { SyncService } from '../v17/sync/syncService';
import { LearningStore } from '../v17/services/learningStore';
import { AdminQueryLibrary } from '../v17/services/adminLibrary'; import { QuerySubmissions, SubmissionSync, submissionsPathFor } from '../v17/services/querySubmissions';
import { KnowledgeSync, knowledgePathFor } from '../v17/services/knowledgeSync';
import { runMigrations, type MigrationState } from '../v17/services/migrations';
import { SchemaPassphraseStore } from '../v17/services/schemaPassphrase';
import { encryptedPathFor } from '../v17/services/schemaCrypto';
import { AdminMessageService, adminMessagePathFor } from '../v17/services/adminMessage';
import { AdminPasswordService, adminPasswordPathFor, type CentralSource } from '../v17/services/adminPassword'; import { setPasswordAuthority } from '../services/passwordService'; import { checkRepositoryLocation } from '../v17/services/githubClient';
import { loadAiConfig, DEFAULT_AI_CONFIG, type AiLlmConfig } from '../v17/services/aiLlmService'; import { CentralSync, type VaultReport } from '../v17/sync/centralSync'; import { validateVaultPayload } from '../v17/services/vaultRetrieval';
import { APP_NAME, APP_VERSION } from '../v17/sync/schemaFormat';
export const APP = { name: APP_NAME, version: APP_VERSION };
export interface Services { store: KeyValueStore & { persistent: boolean }; schemas: SchemaService; vault: SecretVault; learning: LearningStore; admin: AdminQueryLibrary; knowledge: KnowledgeSync; migrations: MigrationState; sync: SyncService; /** V17.5: the passphrase saved on this device for the synchronized (encrypted) schema */ passphrase: SchemaPassphraseStore; /** V17.5.1: the short cross-device administrator message shown in the navbar */ adminMessage: AdminMessageService; /** V17.6.5: the centralized, synchronized Admin Password */ adminPassword: AdminPasswordService; /** V17.6.8: the navigation-bar Sync button — one run of the existing centralized synchronization (it adds no synchronization logic of its own) */ centralSync: CentralSync; /** V17.7.1: user-submitted queries awaiting an administrator's decision — separate from the library, never trusted */ submissions: QuerySubmissions; /** V17.7.1: exchange of the submissions with the repository (…/knowledge/submissions.json) */ submissionSync: SubmissionSync; /** V17.7.2: the centrally maintained repository configuration (sql-assistant-data/config/repository-config.json in the bootstrap repository) */ centralConfig: CentralConfigService; }
let svc: Services | null = null;
/** V17.5.6: the ONE repository configuration (defaults, or the administrator's saved override — see repositoryConfig.ts). Every synchronization reads its location from `secrets`, which is derived from this. */
export let repoConfig: RepositoryConfig = { ...DEFAULT_REPOSITORY }; export let repoConfigCustom = false; export let repoConfigProblem: string | null = null;
const locate = (s: VaultSecrets): VaultSecrets => applyRepositoryConfig(s, repoConfig);
export let secrets: VaultSecrets = locate({ ...EMPTY_SECRETS });
/** Re-reads the saved configuration and re-applies it to the secrets (called at start-up and after an administrator saved a change). */
/** V17.7.1: ONE notification door for "the repository location or the token on this device changed" (token saved / replaced by a vault import, configuration saved). The shared GitHub connection state (githubState.ts) listens here; it holds no token of its own. */
const secretListeners = new Set<() => void>(); export const onSecretsChanged = (fn: () => void): (() => void) => { secretListeners.add(fn); return () => secretListeners.delete(fn); };
const secretsChanged = (): void => { [...secretListeners].forEach((l) => { try { l(); } catch { /* a listener must never break the repository configuration */ } }); };
export function refreshRepositoryConfig(): RepositoryConfig { const r = loadRepositoryConfig(services().store); repoConfig = r.config; repoConfigCustom = r.custom; repoConfigProblem = r.problem; secrets = locate(secrets); secretsChanged(); return repoConfig; }
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
/** THE one place that builds the GitHub repository connection (saved token, one location). V17.7.2: repository() and the central-configuration connection both go through it. */
function tokenRepository(owner: string, repo: string, branch: string): SchemaRepository { return githubRepository({ owner, repo, branch, token: secrets.githubToken }); }
export function repository(): SchemaRepository | null {
  if (override) return override;
  if (brokerConfig.state === 'enabled') { const i = brokerInput(); return i && i.owner && i.repo && brokerSession() ? brokerRepository(i) : null; } // central access: no sign-in ⇒ no repository (never a silent fall-back to another credential)
  if (!secrets.githubToken || !secrets.githubOwner || !secrets.githubRepo) return publishedEnabled() ? publishedRepo() : null; return tokenRepository(secrets.githubOwner, secrets.githubRepo, secrets.githubBranch || 'main');
}
/**
 * V17.6.6 — the repository the ADMIN PASSWORD record is read through. It is `repository()` — except when that is the PUBLISHED COPY: the copy is described by a marker that the page reads once at start-up, so a page
 * that stays open would never see a record published later (Sync with GitHub Now / the unlock check would report "does not match its publication record"). For this one file the marker is therefore read again before
 * every read; the shared published state of the other features is NOT touched. Writes and every other kind of connection are unchanged.
 */
function passwordRepository(): SchemaRepository | null {
  const r = repository(); if (!r) return null;
  const viaPublished = !override && brokerConfig.state !== 'enabled' && !(secrets.githubToken && secrets.githubOwner && secrets.githubRepo) && publishedEnabled(); if (!viaPublished) return r;
  return { describe: r.describe, write: (p, t, sha, m) => r.write(p, t, sha, m), async read(path: string) { const st = await fetchPublishedMarker(); return (st.state === 'available' ? publishedRepository(st.marker) : r).read(path); } };
}
/**
 * V17.6.8 — what the Admin Password authority needs to know about the repository connection of THIS moment (decided here, in the one place that decides — repository() above):
 *   authoritative — the real repository: the central access service (with a sign-in), a saved token, or a test repository;   published — only the read-only published copy (it can be older than the repository);   none — no connection.
 * standalone — this device has NO central source to ask at all: no central access service (config file absent), no publication marker, no token. Only then may the default password be provisional (it is needed to configure the repository);
 * a device of a centrally managed deployment that merely cannot reach it right now is NOT standalone, and the default is not accepted there.
 */
function passwordSource(): CentralSource { if (!repository()) return 'none'; if (override || brokerConfig.state === 'enabled' || (secrets.githubToken && secrets.githubOwner && secrets.githubRepo)) return 'authoritative'; return 'published'; }
function passwordStandalone(): boolean { return !override && brokerConfig.state === 'disabled' && publishedState.state === 'none' && !secrets.githubToken; }
/** Gives the authorization path one more chance before a decision is taken: the access-service configuration and the publication marker are read again when they were not found at start-up (a transient failure at start-up must not turn a managed device into a "standalone" one). */
async function rediscoverAuthorization(): Promise<void> { if (override) return; if (brokerConfig.state !== 'enabled') await refreshBrokerConfig(); if (brokerConfig.state !== 'enabled' && publishedState.state !== 'available') await refreshPublished(); }
/** An absent central record is believed only when GitHub really answered for this repository and branch (a token that cannot see a private repository gets "not found", exactly like a missing file). The central access service and test repositories need no check. */
async function confirmRepositoryReachable(): Promise<boolean> {
  if (override || brokerConfig.state === 'enabled') return true; if (!secrets.githubToken || !secrets.githubOwner || !secrets.githubRepo) return false;
  return (await checkRepositoryLocation({ owner: secrets.githubOwner, repo: secrets.githubRepo, branch: secrets.githubBranch || 'main', token: secrets.githubToken, path: secrets.schemaPath })).ok;
}
/** V17.6.8: read-only look at the repository Secret Vault file for the report of the manual Sync (it is never imported by Sync — that needs the passphrase). */
async function vaultReport(): Promise<VaultReport> {
  const r = repository(); if (!r) return { present: false, valid: false, message: 'No repository connection.' };
  try { const f = await r.read(secrets.vaultPath); if (!f) return { present: false, valid: false, message: 'The repository holds no Secret Vault file.' }; const v = validateVaultPayload(f.text); return { present: true, valid: v.ok, message: v.ok ? 'The repository holds an encrypted Secret Vault.' : `The repository vault file is not usable (${v.message}).` }; }
  catch (e) { return { present: false, valid: false, message: `The repository vault file could not be read (${(e as Error).message}).` }; }
}
/**
 * V17.7.2 — where the CENTRAL repository configuration lives. PRIMARY: the repository connection in force (repository(): the saved token / central sign-in / published copy of the location this device is set to) — it is the
 * only repository the administrator's credential is certain to be allowed to write. (An earlier V17.7.2 build always wrote to the application's default repository; with a token for another repository GitHub answers
 * "not found" — fixed.) MIRROR: the application's default (bootstrap) repository, only when it is a DIFFERENT repository and a token / sign-in exists: the record is also written there best-effort and read from there as a
 * fallback, so a machine that starts from the compiled defaults can still find it. A failure of the mirror never fails a save.
 */
function bootstrapMirror(): { repo: SchemaRepository; label: string } | null {
  if (override) return null;
  const sameRepo = repoConfig.owner === DEFAULT_REPOSITORY.owner && repoConfig.repo === DEFAULT_REPOSITORY.repo && repoConfig.branch === DEFAULT_REPOSITORY.branch; if (sameRepo) return null;
  const label = `${DEFAULT_REPOSITORY.owner}/${DEFAULT_REPOSITORY.repo}`;
  if (brokerConfig.state === 'enabled') { const url = brokerConfig.config.url; if (!sessionStore().get(url, label)) return null; return { label, repo: brokerRepository({ url, owner: DEFAULT_REPOSITORY.owner, repo: DEFAULT_REPOSITORY.repo, branch: DEFAULT_REPOSITORY.branch, session: () => sessionStore().get(url, label), onSessionRejected: clearBrokerSession }) }; }
  if (!secrets.githubToken) return null;
  return { label, repo: tokenRepository(DEFAULT_REPOSITORY.owner, DEFAULT_REPOSITORY.repo, DEFAULT_REPOSITORY.branch) };
}
/** V17.7.2: pulls the central repository configuration and, when a newer revision was applied, re-applies the location to every synchronization (refreshRepositoryConfig + reloadSecrets). Never throws. */
export async function syncCentralConfig(): Promise<CentralConfigOutcome> {
  try { const r = await services().centralConfig.pull(); if (r.changed) { refreshRepositoryConfig(); await reloadSecrets(); } return r; }
  catch (e) { return { ok: false, changed: false, published: false, revision: 0, stage: 'Configuration', message: `The repository configuration could not be synchronized (${(e as Error).message}).` }; }
}
export function initServices(): Services {
  if (svc) return svc; const store = browserStore(); const migrations = runMigrations(store); const schemas = new SchemaService(store); const vault = new SecretVault(store, indexedDbKeyProvider); vault.setLocator(locate);
  { const r = loadRepositoryConfig(store); repoConfig = r.config; repoConfigCustom = r.custom; repoConfigProblem = r.problem; secrets = locate(secrets); }
  const passphrase = new SchemaPassphraseStore(store, indexedDbKeyProvider); const learning = new LearningStore(store); const admin = new AdminQueryLibrary(store, () => store.get('sqla.adminname.v174') || 'Administrator');
  svc = { centralConfig: new CentralConfigService(store, repository, () => [...vault.knownSecrets(), ...passphrase.known()], { mirror: bootstrapMirror }), centralSync: null as unknown as CentralSync, submissions: null as unknown as QuerySubmissions, submissionSync: null as unknown as SubmissionSync, store, schemas, vault, learning, admin, migrations, knowledge: new KnowledgeSync(learning, admin, repository, store, () => knowledgePathFor(secrets.schemaPath), () => vault.knownSecrets()), sync: new SyncService(schemas, repository, store, () => secrets.schemaPath, () => [...vault.knownSecrets(), ...passphrase.known()], { passphrase: () => passphrase.get(), path: () => encryptedPathFor(secrets.schemaPath), saved: () => passphrase.hasSaved() }), passphrase, adminMessage: new AdminMessageService(store, repository, () => adminMessagePathFor(secrets.schemaPath), () => [...vault.knownSecrets(), ...passphrase.known()]), adminPassword: new AdminPasswordService(store, passwordRepository, () => adminPasswordPathFor(secrets.schemaPath), () => [...vault.knownSecrets(), ...passphrase.known()], { source: passwordSource, standalone: passwordStandalone, rediscover: rediscoverAuthorization, confirmRepository: confirmRepositoryReachable }) };
  svc.submissions = new QuerySubmissions(store, () => deviceTag(store), () => store.get('sqla.adminname.v174') || 'Administrator'); svc.submissionSync = new SubmissionSync(svc.submissions, repository, store, () => submissionsPathFor(secrets.schemaPath), () => [...vault.knownSecrets(), ...passphrase.known()]);
  svc.centralSync = new CentralSync({ adminPassword: svc.adminPassword, schemas: svc.sync, knowledge: svc.knowledge, adminMessage: svc.adminMessage, hasRepository: () => !!repository(), vaultReport, secrets: () => [...vault.knownSecrets(), ...passphrase.known()] });
  setPasswordAuthority({ resolve: () => svc!.adminPassword.resolve() }); // V17.6.8: EVERY Admin Password check asks the central state first (start-up bootstrap awaited, stale verifier refreshed) — see passwordService.verifyPassword
  aiConfig = loadAiConfig(store); return svc;
}
export function services(): Services { if (!svc) throw new Error('Services are not initialised yet.'); return svc; }
export async function reloadSecrets(): Promise<VaultSecrets> { try { secrets = locate(await services().vault.load()); vaultProblem = null; } catch (e) { secrets = locate({ ...EMPTY_SECRETS }); vaultProblem = (e as Error).message; } secretsChanged(); return secrets; }
