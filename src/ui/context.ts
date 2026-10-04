/** Application services (single instances shared by all pages). */
import { SchemaService } from '../services/schemaService';
import { browserStore } from '../services/storage';
import { SecretVault, EMPTY_SECRETS, type VaultSecrets } from '../v17/services/secretVault';
import { GitHubClient, githubRepository, type SchemaRepository } from '../v17/services/githubClient';
import { SyncService } from '../v17/sync/syncService';
import { LearningStore } from '../v17/services/learningStore';
import { loadAiConfig, type AiLlmConfig } from '../v17/services/aiLlmService';
import { APP_NAME, APP_VERSION } from '../v17/sync/schemaFormat';
export const APP = { name: APP_NAME, version: APP_VERSION };
export const schemas = new SchemaService(browserStore);
export const vault = new SecretVault(browserStore);
export const learning = new LearningStore(browserStore);
export let secrets: VaultSecrets = { ...EMPTY_SECRETS };
export let aiConfig: AiLlmConfig = loadAiConfig(browserStore);
export function setAiConfig(c: AiLlmConfig): void { aiConfig = c; }
export async function reloadSecrets(): Promise<VaultSecrets> { try { secrets = await vault.load(); } catch { secrets = { ...EMPTY_SECRETS }; } return secrets; }
let repoOverride: SchemaRepository | null = null;
/** Test hook: browser tests inject an in-memory repository (no network). */
export function setRepositoryOverride(r: SchemaRepository | null): void { repoOverride = r; }
export function repository(): SchemaRepository | null {
  if (repoOverride) return repoOverride;
  if (!secrets.githubToken || !secrets.githubRepo) return null;
  return githubRepository(new GitHubClient({ token: secrets.githubToken, repo: secrets.githubRepo, branch: secrets.githubBranch || 'main' }));
}
export const sync = new SyncService(schemas, repository, browserStore, () => secrets.schemaPath || 'schemas/schema-registry.json', () => vault.knownSecrets());
