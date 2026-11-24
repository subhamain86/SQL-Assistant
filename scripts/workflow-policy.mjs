/**
 * V17.7.5 — THE ONE PLACE where the GitHub workflow policy and its allow-list live (documented in docs/DEPLOYMENT.md and docs/WORKFLOW_DEPENDENCIES_V17.7.5.md).
 * scripts/check-workflows.mjs enforces it; test/v1775.test.mjs proves that every rule fires on a deliberately bad copy of every workflow.
 *
 * THE POLICY. After V17.7.5 a workflow under .github/workflows may build, test, verify, package or publish SQL Assistant with Node and the default GITHUB_TOKEN ONLY:
 *   no package-manager CLI, no package registry, no Azure, no secret other than GITHUB_TOKEN, no step that may fail silently, no unpinned action, no step that echoes a secret.
 * THE ONE EXCEPTION — the AUTOMATIC TOKEN SYNCHRONIZATION. publish-data.yml (central token vault build + data publication) and verify-repo-pat.yml (PAT validity / expiry check) are frozen
 * (test/fixtures/token-sync-baseline-v1774.json): changing the secrets they read would change token synchronization. They are listed below BY NAME with the exact secrets they read — and nothing else is allowed.
 */
export const WORKFLOW_POLICY = {
  /** the only secret any workflow may read unless it is listed in `secretAllowList` */
  defaultSecrets: ['GITHUB_TOKEN'],
  /** per-workflow secrets: ONLY the token-synchronization workflows. Adding a line here is a change of token synchronization and must be justified in docs/WORKFLOW_DEPENDENCIES_V17.7.5.md. */
  secretAllowList: {
    'publish-data.yml': { secrets: ['SQLA_DEVICE_TOKEN', 'SQLA_VAULT_PASSPHRASE'], why: 'token synchronization: builds the CENTRAL TOKEN VAULT (a read-only device token, encrypted) on request; frozen' },
    'verify-repo-pat.yml': { secrets: ['SQLA_GITHUB_PAT'], why: 'token synchronization: weekly validity / expiry check of the central PAT; frozen' },
  },
  /** workflows whose comment text is frozen and contains the English word "registry" (the SQL Assistant "schema registry"), which is not a package registry. Only the package-registry patterns are checked there. */
  bareRegistryWordAllowedIn: ['publish-data.yml'],
  /** every `uses:` must be owner/name@vN (a major version) or owner/name@<40 hex> (a full commit SHA). First-party GitHub actions are used; no third-party action exists. */
  actionPin: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@(?:v\d+(?:\.\d+){0,2}|[0-9a-f]{40})$/,
};

/** The rules, in the order they are reported. `test(line)` is applied to every line (comments included) unless `codeOnly` is set. */
export const RULES = [
  { id: 'npm', why: 'no package-manager CLI (npm) — every step calls node directly', test: (l) => /\bnpm\b/i.test(l) },
  { id: 'npx', why: 'no npx (package runner)', test: (l) => /\bnpx\b/i.test(l) },
  { id: 'package-lock', why: 'no package-lock handling', test: (l) => /package-lock/i.test(l) },
  { id: 'registry-address', why: 'no package registry address or configuration', test: (l) => /registry\.npmjs|npmjs\.(?:org|com)|--registry|NPM_CONFIG|_authToken|yarnpkg|pnpm/i.test(l) },
  { id: 'registry', why: 'no package registry', test: (l, ctx) => !ctx.bareRegistryWordAllowed && /\bregistry\b/i.test(l) },
  { id: 'azure', why: 'no Azure (action, secret, host or word)', test: (l) => /azure/i.test(l) },
  { id: 'az-cli', why: 'no az CLI', test: (l) => /(?:^|[^A-Za-z0-9_-])az\s+[a-z]/.test(l) || /(?:^|[^A-Za-z0-9_-])az\s*$/.test(l) },
  { id: 'appservice', why: 'no Azure App Service', test: (l) => /app[- ]?service/i.test(l) },
  { id: 'continue-on-error', why: 'no step may fail silently', test: (l, ctx) => !ctx.isComment && /continue-on-error/.test(l) },
];
export const RULE_IDS = [...RULES.map((r) => r.id), 'secret', 'unpinned-action', 'echo-secret', 'no-permissions', 'secrets-inherit'];
