import { icon } from './icons';
import { syncService } from '../services/syncService';
import { store } from '../state/store';
import { escapeHtml as e } from '../utils/dom';
export function renderConflictBanner(container: HTMLElement, onResolved?: () => void): void {
  function draw(): void {
    const cs = syncService.getPendingConflicts(); if (!cs.length) { container.innerHTML = ''; return; }
    container.innerHTML = `<div class="conflict-banner-wrap"><div class="conflict-banner-head">${icon('shield-alert', 16)} <strong>${cs.length} unresolved synchronization conflict${cs.length > 1 ? 's' : ''}</strong></div>${cs.map((c) => `<div class="conflict-card"><div class="conflict-card-head">${icon('shield-alert', 15)} <strong>${e(c.schemaName)}</strong></div><p class="hint">Local version: ${e(c.localVersion)} · Remote version: ${e(c.remoteVersion)} · Detected: ${new Date(c.detectedAt).toLocaleString()}</p><p class="hint">Changed: ${e(c.changedPaths.slice(0, 6).join(', '))}${c.changedPaths.length > 6 ? ` and ${c.changedPaths.length - 6} more…` : ''}</p><div class="row-actions"><button type="button" class="btn btn-outline btn-sm conflict-use-local" data-conflict-id="${c.id}">Use Local (keep my changes)</button><button type="button" class="btn btn-primary btn-sm conflict-use-remote" data-conflict-id="${c.id}">Use Remote (apply theirs)</button></div></div>`).join('')}</div>`;
    container.querySelectorAll<HTMLElement>('.conflict-use-local').forEach((b) => b.addEventListener('click', () => { syncService.resolvePendingConflict(b.dataset.conflictId!, 'local'); store.pushToast('info', 'Kept the local version — the repository will be updated on the next sync.'); onResolved?.(); }));
    container.querySelectorAll<HTMLElement>('.conflict-use-remote').forEach((b) => b.addEventListener('click', () => { syncService.resolvePendingConflict(b.dataset.conflictId!, 'remote'); store.pushToast('success', 'Applied the remote version.'); onResolved?.(); }));
  }
  const un = syncService.subscribe(draw); draw(); (container as any)._cleanup = un;
}
