/** Application services (single instances shared by all pages). */
import { SchemaService } from '../services/schemaService.js';
import { browserStore } from '../services/storage.js';
import { SecretVault, EMPTY_SECRETS } from '../v17/services/secretVault.js';
import { GitHubClient, githubRepository } from '../v17/services/githubClient.js';
import { SyncService } from '../v17/sync/syncService.js';
import { LearningStore } from '../v17/services/learningStore.js';
import { loadAiConfig } from '../v17/services/aiLlmService.js';
import { APP_NAME, APP_VERSION } from '../v17/sync/schemaFormat.js';
export const APP = { name: APP_NAME, version: APP_VERSION };
export const schemas = new SchemaService(browserStore);
export const vault = new SecretVault(browserStore);
export const learning = new LearningStore(browserStore);
export let secrets = { ...EMPTY_SECRETS };
export let aiConfig = loadAiConfig(browserStore);
export function setAiConfig(c) { aiConfig = c; }
export async function reloadSecrets() { try {
    secrets = await vault.load();
}
catch {
    secrets = { ...EMPTY_SECRETS };
} return secrets; }
let repoOverride = null;
/** Test hook: browser tests inject an in-memory repository (no network). */
export function setRepositoryOverride(r) { repoOverride = r; }
export function repository() {
    if (repoOverride)
        return repoOverride;
    if (!secrets.githubToken || !secrets.githubRepo)
        return null;
    return githubRepository(new GitHubClient({ token: secrets.githubToken, repo: secrets.githubRepo, branch: secrets.githubBranch || 'main' }));
}
export const sync = new SyncService(schemas, repository, browserStore, () => secrets.schemaPath || 'schemas/schema-registry.json', () => vault.knownSecrets());
//# sourceMappingURL=context.js.map