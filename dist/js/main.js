/** SQL Assistant — application entry point. */
import { state } from './state/store.js';
import { APP, schemas, sync, reloadSecrets, setRepositoryOverride, learning, vault } from './ui/context.js';
import { esc, toast } from './ui/dom.js';
import { renderReadOnly } from './ui/pages/readonly.js';
import { renderSettings } from './ui/pages/settings.js';
import { renderQuickstart, renderAbout, renderSchemaUsed, renderErrorRectifier, renderCr } from './ui/pages/other.js';
import { memoryRepository } from './v17/services/githubClient.js';
import { migrationMessage, rejectionMessage } from './v17/sync/syncService.js';
import { redactSecrets } from './v17/errors/appErrors.js';
const NAV = [['quickstart', 'Quick Start'], ['readonly', 'Read Only Query Builder'], ['cr', 'Query Builder for CR'], ['schema-used', 'Schema Used'], ['error-rectifier', 'Error Rectifier'], ['settings', 'Settings'], ['about', 'About']];
const RENDER = { quickstart: renderQuickstart, readonly: renderReadOnly, cr: renderCr, 'schema-used': renderSchemaUsed, 'error-rectifier': renderErrorRectifier, settings: renderSettings, about: renderAbout };
function routeFromHash() { const h = location.hash.replace(/^#\/?/, ''); return NAV.some(([r]) => r === h) ? h : 'quickstart'; }
function shell() {
    document.title = APP.name;
    document.getElementById('app').innerHTML = `<header class="app-header"><span class="brand" id="appName">${esc(APP.name)}</span><span class="ver">V${esc(APP.version)}</span><span class="spacer"></span><span class="sync-pill" id="activeSchemaPill"></span></header>
  <div class="layout"><nav class="side" aria-label="Main navigation">${NAV.map(([r, l]) => `<a href="#${r}" data-route="${r}">${esc(l)}</a>`).join('')}</nav><main id="page" tabindex="-1"></main></div>`;
}
function render() {
    state.route = routeFromHash();
    document.querySelectorAll('nav.side a').forEach((a) => a.classList.toggle('active', a.dataset.route === state.route));
    const pill = document.getElementById('activeSchemaPill');
    if (pill)
        pill.textContent = `Active Schema: ${schemas.active().name}`;
    const page = document.getElementById('page');
    try {
        RENDER[state.route](page);
    }
    catch (e) {
        page.innerHTML = `<div class="issue-box error">This page could not be displayed: ${esc(redactSecrets(e.message, vault.knownSecrets()))}</div>`;
        console.error('[SQL Assistant] render failed', e.message);
    }
}
let timer = null;
function scheduleAutoSync() {
    if (timer)
        clearInterval(timer);
    const v = localStorage.getItem('sqla.autoSync') || 'manual';
    const ms = { '15m': 9e5, '30m': 18e5, '1h': 36e5, '4h': 144e5 }[v];
    if (!ms)
        return;
    timer = window.setInterval(async () => { const r = await sync.synchronize(); if (r.pull.migrated.length)
        toast('success', migrationMessage(r.pull.migrated[0]).split('\n').slice(0, 3).join('\n')); if (r.pull.rejected.length)
        toast('warning', rejectionMessage(r.pull.rejected[0])); render(); }, ms);
}
async function boot() {
    shell();
    await reloadSecrets();
    schemas.subscribe(() => render());
    window.addEventListener('hashchange', render);
    window.addEventListener('sqla:autosync-changed', scheduleAutoSync);
    if (schemas.loadDiagnostics.migrated.length)
        toast('info', `Legacy schema detected in local storage — ${schemas.loadDiagnostics.migrated.length} schema(s) migrated to the current format.`);
    render();
    scheduleAutoSync();
    if (new URLSearchParams(location.search).get('e2e') === '1') {
        // Browser-test hooks (only with ?e2e=1): in-memory repository instead of GitHub. Never exposes secrets.
        window.__sqla = { schemas, sync, learning, memoryRepository, setRepositoryOverride, render };
    }
}
boot().catch((e) => { document.getElementById('app').innerHTML = `<div class="issue-box error" style="margin:20px">SQL Assistant could not start: ${esc(e.message)}</div>`; });
//# sourceMappingURL=main.js.map