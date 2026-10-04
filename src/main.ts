/**
 * SQL Assistant entry point (V17.3.1 with the V17.2 UI). Start-up order:
 *   1. render the app shell (navbar, main, footer, toasts) — needs no services
 *   2. initialise services (storage, schemas, vault) — failures are shown in the page; navigation keeps working
 *   3. route (hash routing: works at "/", any sub-path such as GitHub Pages /<repo>/, file://, refresh and direct links)
 *   4. schema synchronization runs only on user action or the chosen Sync Time — it never blocks or crashes the UI
 */
import { APP, initServices, services, reloadSecrets, setRepositoryOverride, repository } from './ui/context';
import { store, ROUTES, type Route } from './ui/state'; import { e } from './ui/dom'; import { icon } from './ui/components/icons';
import { renderNavbar } from './ui/components/navbar'; import { mountToastContainer } from './ui/components/toast'; import { GuidedTour } from './ui/components/tourOverlay';
import { renderReadOnlyPage } from './ui/pages/readonly'; import { renderQuickstartPage, renderCrPage, renderSchemaPage, renderErrorRectifierPage, renderAboutPage } from './ui/pages/other'; import { renderSettingsPage } from './ui/pages/settings';
import { startSyncScheduler, getSyncPrefs } from './ui/syncPrefs'; import { memoryRepository } from './v17/services/githubClient';
const ALIASES: Record<string, Route> = { builder: 'readonly', crbuilder: 'cr', usedschema: 'schema-used', schema: 'schema-used', errorrectifier: 'error-rectifier', home: 'quickstart' };
export function parseRoute(hash: string): Route { const h = hash.replace(/^#!?\/?/, '').split(/[?/]/)[0]; const r = (ALIASES[h] || h) as Route; return ROUTES.includes(r) ? r : 'quickstart'; }
let ready = false; let main: HTMLElement; let lastRendered = ''; let lastSchemaFp = '';
function renderPage(force = false): void {
  const route = parseRoute(location.hash); const changedRoute = route !== store.route; store.route = route;
  const key = `${route}|${store.settingsUnlocked}`; if (!force && !changedRoute && key === lastRendered) return; lastRendered = key;
  if (!ready) { main.innerHTML = '<div class="page"><p class="hint">Starting…</p></div>'; return; }
  try { ({ quickstart: () => renderQuickstartPage(main, navigate), readonly: () => renderReadOnlyPage(main), cr: () => renderCrPage(main), 'schema-used': () => renderSchemaPage(main), 'error-rectifier': () => renderErrorRectifierPage(main), settings: () => renderSettingsPage(main), about: () => renderAboutPage(main) } as Record<Route, () => void>)[route](); }
  catch (err) { main.innerHTML = `<div class="page"><div class="issue-box">${icon('alert-triangle', 15)} This page could not be displayed: ${e((err as Error).message)}</div></div>`; }
  if (changedRoute) window.scrollTo(0, 0);
}
export function navigate(r: Route): void { if (parseRoute(location.hash) === r) renderPage(true); else location.hash = `#${r}`; }
function applyTheme(): void { const t = store.theme; const dark = t === 'dark' || (t === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches); document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light'); }
export async function boot(): Promise<void> {
  const app = document.getElementById('app')!; document.title = APP.name; applyTheme();
  app.innerHTML = `<div class="app-shell"><div id="navMount"></div><main class="app-main" id="mainContent"></main></div><footer class="app-footer"><span>SQL Assistant · Version ${e(APP.version)}</span><span class="creator-signature">Crafted by Subham Ain</span></footer>`;
  main = document.getElementById('mainContent')!; mountToastContainer(document.body);
  const tour = new GuidedTour(navigate);
  renderNavbar(document.getElementById('navMount')!, navigate, () => tour.start(), 'Subham Ain');
  window.addEventListener('hashchange', () => renderPage()); window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  store.subscribe(() => { applyTheme(); renderPage(); });
  renderPage(true); // the shell is visible before any service starts
  let svc; try { svc = initServices(); } catch (err) { main.innerHTML = `<div class="page"><div class="issue-box">${icon('alert-triangle', 15)} SQL Assistant could not initialise its services: ${e((err as Error).message)}. Clear this site's stored data and reload if the problem persists.</div></div>`; document.documentElement.setAttribute('data-sqla-ready', '1'); return; }
  await reloadSecrets(); ready = true;
  svc.schemas.subscribe(() => { const fp = `${svc!.schemas.active().id}|${svc!.schemas.active().updatedAt}`; if (fp !== lastSchemaFp) { lastSchemaFp = fp; if (store.route !== 'settings') renderPage(true); } (document.getElementById('navMount') as unknown as { redraw?: () => void }).redraw?.(); });
  renderPage(true); (document.getElementById('navMount') as unknown as { redraw?: () => void }).redraw?.();
  startSyncScheduler(() => { if (getSyncPrefs().source === 'github' && repository()) services().sync.synchronize().then((r) => { if (r.pull.migrated.length) store.pushToast('success', 'Legacy schema migrated and synchronized in the background.'); else if (r.pull.rejected.length) store.pushToast('warning', `${r.pull.rejected.length} repository schema(s) failed validation; your local copies were kept. Details: Settings → Schema Management.`); }).catch(() => undefined); });
  if (!svc.store.persistent) store.pushToast('warning', 'Browser storage is unavailable in this context — changes are kept for this session only.');
  if (svc.schemas.loadDiagnostics.migrated.length) store.pushToast('info', `Legacy schema detected in local storage — ${svc.schemas.loadDiagnostics.migrated.length} schema(s) migrated to the current format.`);
  if (svc.schemas.loadDiagnostics.recoveredFrom.length) store.pushToast('info', 'Schemas saved by SQL Assistant V17.2.1–V17.3 were recovered into the standard storage.');
  if (new URLSearchParams(location.search).get('e2e') === '1') (window as unknown as Record<string, unknown>).__sqla = { services, memoryRepository, setRepositoryOverride, reloadSecrets, store, render: () => renderPage(true) };
  if (!store.hasSeenWalkthrough && !location.search.includes('e2e')) setTimeout(() => store.pushToast('info', 'New here? Select "Guided Walkthrough" in the navbar for a 12-step tour.'), 600);
  document.documentElement.setAttribute('data-sqla-ready', '1');
}
