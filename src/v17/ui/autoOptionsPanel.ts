/**
 * V17.0 — Manual Selectors → Advanced Options: automatic vs manual indicator.
 * Added ABOVE the existing V16.5 Advanced Options controls (which are left
 * untouched). Shows what the description engine applied automatically and
 * which options the user controls manually; editing any existing control marks
 * it as manual so later descriptions never overwrite it.
 */
import { icon } from '../../components/icons';
import { advancedOverrides, ADVANCED_INPUT_KEYS, type ManualOptionKey } from '../engines/advancedOptionsResolver';
import type { AutoOption } from '../engines/nluEngine';
import { escapeHtmlV17 as esc } from '../errors/appErrors';

const LABELS: Record<ManualOptionKey, string> = { distinct: 'DISTINCT', groupBy: 'GROUP BY', having: 'HAVING', limit: 'LIMIT', sorts: 'ORDER BY', recursive: 'WITH RECURSIVE', ctes: 'CTEs', columns: 'Column list' };

export function mountAutoOptionsPanel(panel: HTMLElement, getAutoOptions: () => AutoOption[] | null): void {
  panel.querySelector('[data-v17-auto-options]')?.remove();
  const box = document.createElement('div'); box.setAttribute('data-v17-auto-options', '');
  panel.prepend(box);
  function draw(): void {
    const autos = (getAutoOptions() || []).filter((a) => a.kind !== 'table');
    const manual = advancedOverrides.list();
    const applied = autos.filter((a) => a.applied); const suggested = autos.filter((a) => !a.applied);
    box.innerHTML = `<div class="notes-box"><div style="width:100%">
      <div class="hint">${icon('sparkles', 13)} Filtering, conditions, date filtering, joins, aggregation, grouping, sorting, DISTINCT and result limits are detected automatically from <strong>Describe What You Need</strong>. Changing any option below takes manual control of it — manual settings are never overwritten.</div>
      ${applied.length ? `<div class="tiny-label mt"><strong>Applied automatically</strong></div><div class="chip-row">${applied.map((a) => `<span class="chip" title="Confidence ${Math.round(a.confidence * 100)}%">${icon('zap', 11)} ${esc(a.description)}</span>`).join('')}</div>` : ''}
      ${suggested.length ? `<div class="tiny-label mt"><strong>Not applied (low confidence — set manually if needed)</strong></div><div class="chip-row">${suggested.map((a) => `<span class="chip chip-inactive">${esc(a.description)}</span>`).join('')}</div>` : ''}
      ${manual.length ? `<div class="tiny-label mt"><strong>Under manual control</strong></div><div class="chip-row">${manual.map((k) => `<span class="chip">${icon('sliders', 11)} ${LABELS[k]} <button type="button" class="btn-link" data-v17-release="${k}">use automatic</button></span>`).join('')}</div>` : ''}
    </div></div>`;
    box.querySelectorAll<HTMLButtonElement>('[data-v17-release]').forEach((b) => b.addEventListener('click', () => advancedOverrides.release(b.dataset.v17Release as ManualOptionKey)));
  }
  const onUserEdit = (e: Event) => { const id = (e.target as HTMLElement | null)?.id || ''; const key = ADVANCED_INPUT_KEYS[id]; if (key) advancedOverrides.mark(key); };
  panel.addEventListener('input', onUserEdit); panel.addEventListener('change', onUserEdit);
  panel.addEventListener('v17-manual', (e) => { const k = (e as CustomEvent).detail as ManualOptionKey; if (k) advancedOverrides.mark(k); });
  panel.addEventListener('click', (e) => { const id = (e.target as HTMLElement | null)?.closest('button')?.id || ''; const key = ADVANCED_INPUT_KEYS[id]; if (key) advancedOverrides.mark(key); });
  const unsub = advancedOverrides.subscribe(draw);
  (box as any)._cleanup = unsub;
  draw();
}
