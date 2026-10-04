/**
 * SQL Assistant entry point. Start-up order (V17.3):
 *   1. render the shell (header + navigation) — needs no services
 *   2. initialise services (storage, schemas, vault)  — failures are shown in the page, never a blank screen
 *   3. render the route (hash routing; unknown or empty hash → Quick Start, so "/" and any deployment base path work)
 *   4. schema synchronization only on user action / schedule — never blocks rendering
 */
import { state } from './state/store';
import type { Route } from './types';
import { APP, initServices, services, reloadSecrets, setRepositoryOverride } from './ui/context';
import { esc, toast } from './ui/dom';
import { renderReadOnly } from './ui/pages/readonly';
import { renderSettings } from './ui/pages/settings';
import { renderQuickstart, renderAbout, renderSchemaUsed, renderErrorRectifier, renderCr } from './ui/pages/other';
import { memoryRepository } from './v17/services/githubClient';
export const NAV: [Route, string][] = [['quickstart', 'Quick Start'], ['readonly', 'Read Only Query Builder'], ['cr', 'Query Builder for CR'], ['schema-used', 'Schema Used'], ['error-rectifier', 'Error Rectifier'], ['settings', 'Settings'], ['about', 'About']];
const RENDER: Record<Route, (el: HTMLElement) => void> = { quickstart: renderQuickstart, readonly: renderReadOnly, cr: renderCr, 'schema-used': renderSchemaUsed, 'error-rectifier': renderErrorRectifier, settings: renderSettings, about: renderAbout };
export function routeFromHash(hash: string): Route { const h = hash.replace(/^#!?\/?/, '').split(/[?/]/)[0] as Route; return NAV.some(([r]) => r === h) ? h : 'quickstart'; }
let ready = false;
function shell(): void {
  document.title = APP.name;
  document.getElementById('app')!.innerHTML = `<header class="app-header"><span class="brand" id="appName">${esc(APP.name)}</span><span class="ver">V${esc(APP.version)}</span><span class="spacer"></span><span class="sync-pill" id="activeSchemaPill"></span></header><div class="layout"><nav class="side">${NAV.map(([r, l]) => `<a href="#${r}" data-route="${r}">${esc(l)}</a>`).join('')}</nav><main id="page"><div class="boot">Loading…</div></main></div>`;
}
function render(): void {
  state.route = routeFromHash(location.hash);
  document.querySelectorAll<HTMLElement>('nav.side a').forEach((a) => a.classList.toggle('active', a.dataset.route === state.route));
  const page = document.getElementById('page'); if (!page || !ready) return;
  const pill = document.getElementById('activeSchemaPill'); if (pill) pill.textContent = `Active Schema: ${services().schemas.active().name}`;
  try { RENDER[state.route](page); } catch (e) { page.innerHTML = `<div class="issue-box error">This page could not be displayed: ${esc((e as Error).message)}</div>`; }
}
export async function boot(): Promise<void> {
  shell(); window.addEventListener('hashchange', render);
  const page = document.getElementById('page')!;
  let svc; try { svc = initServices(); } catch (e) { page.innerHTML = `<div class="issue-box error">SQL Assistant could not initialise its services: ${esc((e as Error).message)}. Navigation is still available; clear this site's stored data and reload if the problem persists.</div>`; document.documentElement.setAttribute('data-sqla-ready', '1'); return; }
  await reloadSecrets(); ready = true; svc.schemas.subscribe(render); render();
  if (!svc.store.persistent) toast('warning', 'Browser storage is unavailable in this context — changes are kept for this session only.');
  if (svc.schemas.loadDiagnostics.migrated.length) toast('info', `Legacy schema detected in local storage — ${svc.schemas.loadDiagnostics.migrated.length} schema(s) migrated to the current format.`);
  if (svc.schemas.loadDiagnostics.recoveredFrom.length) toast('info', 'Schemas saved by SQL Assistant V17.2.1/V17.2.2 were recovered into the standard storage.');
  if (new URLSearchParams(location.search).get('e2e') === '1') (window as unknown as Record<string, unknown>).__sqla = { services, memoryRepository, setRepositoryOverride, render, reloadSecrets };
  document.documentElement.setAttribute('data-sqla-ready', '1');
}
