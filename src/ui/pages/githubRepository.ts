/**
 * V17.7.1 — Hamburger → GitHub Repository. The GitHub configuration and the schema pull used to be reachable only inside Schema → Pull Schema. This page puts the SAME three cards at one address of their own —
 * the GitHub repository card, Pull Schema from GitHub and Pull Secret Vault — by rendering the existing Pull Schema panel (renderSchemaPullTab). There is no second implementation and no second state: the repository
 * configuration, the token (Secret Vault) and the connection state are the ones the Pull Schema tab and the Home page use, and Schema → Pull Schema keeps working exactly as before.
 * Above the cards: the live connection status (githubState.ts), which SQL Assistant initialises when it opens — nothing has to be opened first.
 */
import { icon } from '../components/icons'; import type { Route } from '../state'; import { renderSchemaPullTab } from './schemaPull'; import { mountGithubStatus } from './githubStatus';
export function renderGithubPage(c: HTMLElement, nav: (r: Route) => void): void {
  c.innerHTML = `<div class="page"><h1 class="page-title">${icon('github')} GitHub Repository</h1><p class="page-subtitle">The repository connection, the schema pull and the Secret Vault of this device. SQL Assistant checks the connection by itself when it opens; the same cards are also available under Schema → Pull Schema.</p><div id="githubPageStatus"></div><div id="githubPagePanel" class="mt"></div></div>`;
  mountGithubStatus(c.querySelector<HTMLElement>('#githubPageStatus')!, nav, { onGithubPage: true }); renderSchemaPullTab(c.querySelector<HTMLElement>('#githubPagePanel')!);
}
