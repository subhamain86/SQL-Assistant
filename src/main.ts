import { initTheme } from './components/theme';
import { mountAppShell } from './layouts/appShell';
import { handleCopilotAuthCallbackIfPresent } from './services/msalAuthService';
import { bootV17 } from './v17/integration';
function boot(): void {
  if (handleCopilotAuthCallbackIfPresent()) return;
  initTheme();
  const root = document.getElementById('app'); if (!root) throw new Error('SQL Assistant: #app root element not found in index.html');
  mountAppShell(root); bootV17();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
