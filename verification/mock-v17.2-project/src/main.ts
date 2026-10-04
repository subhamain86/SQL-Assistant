import './v1721/ui'; /* V17.2.1-PATCH: schema sync diagnostics */
import { mountAppShell } from './layouts/appShell';
import { pullRegistry, local } from './services/syncService';
function boot(): void { const root = document.getElementById('app'); if (!root) throw new Error('#app missing'); mountAppShell(root); document.title = 'SQL Assistant';
  (window as any).__sync = (file: any) => { const m = pullRegistry(file); document.getElementById('syncMsg')!.textContent = m; return { message: m, local }; }; }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
