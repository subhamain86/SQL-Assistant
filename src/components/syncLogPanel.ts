import { icon } from './icons';
import { syncService } from '../services/syncService';
import { escapeHtml as e } from '../utils/dom';
export function renderSyncLogPanel(container: HTMLElement): void {
  const draw = () => { const entries = syncService.getSyncLog(); container.innerHTML = entries.length ? `<div class="sync-log-list">${entries.map((x) => `<div class="sync-log-row ${x.kind === 'error' ? 'sync-log-error' : ''}">${icon(x.kind === 'error' ? 'alert-triangle' : x.kind === 'push' ? 'upload' : x.kind === 'pull' ? 'download' : x.kind === 'suppressed' ? 'shield' : 'folder-sync', 13)}<span class="sync-log-time">${new Date(x.timestamp).toLocaleString()}</span><span class="sync-log-msg">${e(x.message)}</span></div>`).join('')}</div>` : '<p class="hint">No synchronization activity yet.</p>'; };
  const un = syncService.subscribe(draw); draw(); (container as any)._cleanup = un;
}
