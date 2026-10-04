import { renderNavbar } from '../components/hamburgerNav';
import { mountToastContainer } from '../components/toast';
import { renderQuickstartPage } from '../pages/quickstartPage';
import { renderReadOnlyBuilderPage } from '../pages/readOnlyBuilderPage';
import { renderCrBuilderPage } from '../pages/crBuilderPage';
import { renderSchemaPage } from '../pages/schemaPage';
import { renderErrorRectifierPage } from '../pages/errorRectifierPage';
import { renderSettingsPage } from '../pages/settingsPage';
import { renderAboutPage } from '../pages/aboutPage';
import { GuidedTour } from '../components/tourOverlay';
import { store } from '../state/store';
import { initAutoSync, setAutoSyncToastHandler, performPublicDiscovery } from '../services/autoSyncService';
import { APP_VERSION } from '../v17/sync/schemaFormat';
import type { Route } from '../types';
const VALID: Route[] = ['quickstart', 'readonly', 'cr', 'schema-used', 'error-rectifier', 'settings', 'about'];
const SIGNATURE_NAME = 'Subham Ain';
export function mountAppShell(root: HTMLElement): void {
  root.innerHTML = ''; const shell = document.createElement('div'); shell.className = 'app-shell'; const navSlot = document.createElement('div'); const main = document.createElement('main'); main.className = 'app-main'; shell.appendChild(navSlot); shell.appendChild(main); root.appendChild(shell);
  const footer = document.createElement('footer'); footer.className = 'app-footer'; footer.innerHTML = `<span>AP-SQL Assistant · Version ${APP_VERSION}</span><span>Crafted by ${SIGNATURE_NAME}</span>`; root.appendChild(footer);
  mountToastContainer(root); setAutoSyncToastHandler((k, t) => store.pushToast(k, t)); initAutoSync(); performPublicDiscovery('app-load').catch(() => {});
  const routeFromHash = (): Route => { const h = window.location.hash.replace('#', '') as Route; return VALID.includes(h) ? h : 'quickstart'; };
  const navigate = (r: Route) => { if (window.location.hash === `#${r}`) renderAll(); else window.location.hash = r; };
  const tour = new GuidedTour(navigate);
  function renderPage(route: Route): void {
    const prev = main.firstElementChild as any; if (prev && typeof prev._cleanup === 'function') prev._cleanup();
    const el = document.createElement('div'); el.className = 'page-mount'; main.innerHTML = ''; main.appendChild(el);
    switch (route) { case 'readonly': renderReadOnlyBuilderPage(el); break; case 'cr': renderCrBuilderPage(el); break; case 'schema-used': renderSchemaPage(el); break; case 'error-rectifier': renderErrorRectifierPage(el); break; case 'settings': renderSettingsPage(el); break; case 'about': renderAboutPage(el); break; default: renderQuickstartPage(el, navigate); }
    window.scrollTo(0, 0);
  }
  function renderAll(): void { const r = routeFromHash(); store.setRoute(r); renderPage(r); }
  window.addEventListener('hashchange', renderAll);
  let lastLock = store.settingsUnlocked; store.subscribe(() => { if (store.settingsUnlocked !== lastLock) { lastLock = store.settingsUnlocked; if (store.route === 'settings') renderPage('settings'); } });
  renderNavbar(navSlot, navigate, () => tour.start(), SIGNATURE_NAME); renderAll();
}
