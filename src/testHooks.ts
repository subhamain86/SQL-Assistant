/**
 * V17.7 — BROWSER-TEST HOOKS. This module is NOT part of the application: nothing under src/ imports it, `tsconfig.json` (the production entry point) does not compile it, and it is absent from dist/index.html, the root
 * index.html and release/ (npm run verify:artifact fails when any trace of it is found there). It is compiled only into the separate TEST build (`npm run build:test` → test-dist/index.html, tsconfig.test.json), which the
 * Chromium suites load with `?e2e=1` to replace GitHub by an in-memory repository.
 *
 * Why it moved: in V17.6.9 the same hook object was created by main.ts of the PRODUCTION bundle whenever the address contained `?e2e=1`. Through it a page could swap the repository for an empty in-memory one (which the
 * Admin Password authority then treats as an authoritative "no record" ⇒ confirmed default) or set `store.settingsUnlocked`. A test seam that can reach the authentication boundary must not ship.
 */
import { services, secrets, setRepositoryOverride, setBrokerConfig, brokerSession, brokerEnabled, refreshBrokerConfig, refreshPublished, setPublishedState, publishedEnabled, reloadSecrets } from './ui/context';
import { store } from './ui/state';
import { lastAuthBasis, sessionAuthBasis } from './services/passwordService';
import { memoryRepository, setRepositoryTimeoutMs } from './v17/services/githubClient';
import { encryptSchemaRegistry } from './v17/services/schemaCrypto';
import { renderNow } from './main';
import { githubConn, initGithubConnection, githubChecks, lastSyncAt } from './ui/githubState';

export function installTestHooks(): void {
  if (new URLSearchParams(location.search).get('e2e') !== '1') return;
  store.hasSeenWalkthrough = true; // the first-visit toast would cover the page under test
  (window as unknown as Record<string, unknown>).__sqla = {
    adminAuth: { diagnostics: () => services().adminPassword.diagnostics(), basis: lastAuthBasis, sessionBasis: sessionAuthBasis },
    centralSync: () => services().centralSync, services, refreshPublished, setPublishedState, publishedEnabled, refreshBrokerConfig, setBrokerConfig, brokerSession, brokerEnabled, memoryRepository, setRepositoryOverride, reloadSecrets, store,
    render: () => renderNow(), setRepositoryTimeoutMs,
    /** V17.7.1: the shared GitHub connection state (no token is in it) */ github: { conn: githubConn, init: initGithubConnection, checks: githubChecks, lastSyncAt },
    /** location in force (no secret) */ repoLocation: () => [secrets.githubOwner, secrets.githubRepo, secrets.githubBranch, secrets.schemaPath],
    encryptForTest: (text: string, pass: string) => encryptSchemaRegistry(text, pass, { device: 'test-device', schemaCount: 1 }),
  };
}
