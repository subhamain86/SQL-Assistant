/**
 * V17.2.1 — non-intrusive sync diagnostics for Settings → Schema Management.
 * Listens for the migration report emitted by the sync pipeline and renders status badges next to the
 * existing sync error indicator (#syncErrorMount). No existing markup is changed; when there is nothing
 * to report the container stays empty (V16.2 empty-error-container pattern).
 */
import type { RegistryMigrationReport } from './legacySchemaMigration';
import { badgesFor, describeResult, summarizeReport } from './diagnostics';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
let last: RegistryMigrationReport | null = null;
export function getLastMigrationReport(): RegistryMigrationReport | null { return last; }
export function renderMigrationReport(rep: RegistryMigrationReport | null): string {
  if (!rep || (!rep.migrated && !rep.rejected)) return '';
  const items = rep.results.filter((r) => r.status !== 'current').map((r) => `<div class="v1721-item" style="margin-top:6px"><div>${badgesFor(r).map((b) => `<span class="badge" style="display:inline-block;margin:0 4px 4px 0;padding:1px 8px;border-radius:10px;font-size:11px;border:1px solid currentColor;${/failed|Invalid/.test(b) ? 'color:#c0392b' : /successful|Migrated|Current/.test(b) ? 'color:#1e8e3e' : 'color:#b26a00'}">${esc(b)}</span>`).join('')}</div><pre style="white-space:pre-wrap;margin:4px 0 0;font:inherit;font-size:12.5px">${esc(describeResult(r))}</pre></div>`).join('');
  return `<div data-v1721-migration style="margin:8px 0;padding:10px 12px;border:1px solid var(--border,#e1e6f0);border-radius:8px;background:var(--bg-card,#fff)"><strong>Schema synchronization</strong> — ${esc(summarizeReport(rep))}${items}</div>`;
}
function paint(): void {
  const anchor = typeof document !== 'undefined' ? document.querySelector('#syncErrorMount') : null;
  if (!anchor || !anchor.parentElement) return;
  anchor.parentElement.querySelector('[data-v1721-migration]')?.remove();
  const html = renderMigrationReport(last); if (html) anchor.insertAdjacentHTML('beforebegin', html);
}
if (typeof window !== 'undefined') {
  window.addEventListener('sqla:v1721-migration', (e) => { last = (e as CustomEvent).detail as RegistryMigrationReport; paint(); });
  if (typeof MutationObserver !== 'undefined') new MutationObserver(() => { if (last && document.querySelector('#syncErrorMount') && !document.querySelector('[data-v1721-migration]')) paint(); }).observe(document.documentElement, { childList: true, subtree: true });
}
