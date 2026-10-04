/** Services are created inside boot() AFTER the page markup is on screen, so no service failure can blank the page. */
import { SchemaService } from '../services/schemaService';
import { browserStore, type KeyValueStore } from '../services/storage';
import { SecretVault, EMPTY_SECRETS, type VaultSecrets } from '../v17/services/secretVault';
import { indexedDbKeyProvider } from '../v17/services/cryptoBox';
import { githubRepository, type SchemaRepository } from '../v17/services/githubClient';
import { SyncService } from '../v17/sync/syncService';
import { LearningStore } from '../v17/services/learningStore';
import { loadAiConfig, DEFAULT_AI_CONFIG, type AiLlmConfig } from '../v17/services/aiLlmService';
import { APP_NAME, APP_VERSION } from '../v17/sync/schemaFormat';
export const APP = { name: APP_NAME, version: APP_VERSION };
export interface Services { store: KeyValueStore & { persistent: boolean }; schemas: SchemaService; vault: SecretVault; learning: LearningStore; sync: SyncService; }
let svc: Services | null = null;
export let secrets: VaultSecrets = { ...EMPTY_SECRETS };
export let aiConfig: AiLlmConfig = { ...DEFAULT_AI_CONFIG };
export let vaultProblem: string | null = null;
let override: SchemaRepository | null = null;
export const setAiConfig = (c: AiLlmConfig) => { aiConfig = c; };
/** Browser-test hook (only exposed with ?e2e=1): an in-memory repository instead of GitHub. */
export const setRepositoryOverride = (r: SchemaRepository | null) => { override = r; };
export function repository(): SchemaRepository | null { if (override) return override; if (!secrets.githubToken || !secrets.githubOwner || !secrets.githubRepo) return null; return githubRepository({ owner: secrets.githubOwner, repo: secrets.githubRepo, branch: secrets.githubBranch || 'main', token: secrets.githubToken }); }
export function initServices(): Services {
  if (svc) return svc; const store = browserStore(); const schemas = new SchemaService(store); const vault = new SecretVault(store, indexedDbKeyProvider);
  svc = { store, schemas, vault, learning: new LearningStore(store), sync: new SyncService(schemas, repository, store, () => secrets.schemaPath, () => vault.knownSecrets()) };
  aiConfig = loadAiConfig(store); return svc;
}
export function services(): Services { if (!svc) throw new Error('Services are not initialised yet.'); return svc; }
export async function reloadSecrets(): Promise<VaultSecrets> { try { secrets = await services().vault.load(); vaultProblem = null; } catch (e) { secrets = { ...EMPTY_SECRETS }; vaultProblem = (e as Error).message; } return secrets; }
