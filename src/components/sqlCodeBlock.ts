import { escapeHtml } from '../utils/dom';
import { icon, type IconName } from './icons';
export interface SqlCodeBlockHandlers { onCopy?: () => void; onClear?: () => void; onValidate?: () => void; onRegenerate?: () => void; onOptimize?: () => void; }
export function renderSqlCodeBlock(container: HTMLElement, sql: string, h: SqlCodeBlockHandlers, extra: { id: string; label: string; iconName: IconName; onClick: () => void }[] = []): void {
  container.innerHTML = `<pre class="sql-output">${escapeHtml(sql)}</pre><div class="row-actions wrap">${h.onCopy ? `<button type="button" id="btnCopySql" class="btn btn-primary btn-sm">${icon('copy', 14)} Copy SQL</button>` : ''}${h.onClear ? `<button type="button" id="btnClearSql" class="btn btn-outline btn-sm">${icon('x', 14)} Clear</button>` : ''}${h.onValidate ? `<button type="button" id="btnValidateSql" class="btn btn-outline btn-sm">${icon('clipboard-check', 14)} Validate</button>` : ''}${h.onRegenerate ? `<button type="button" id="btnRegenSql" class="btn btn-outline btn-sm">${icon('refresh', 14)} Regenerate</button>` : ''}${h.onOptimize ? `<button type="button" id="btnOptimizeSql" class="btn btn-outline btn-sm">${icon('wand', 14)} Optimize</button>` : ''}${extra.map((b) => `<button type="button" id="${b.id}" class="btn btn-outline btn-sm">${icon(b.iconName, 14)} ${b.label}</button>`).join('')}</div><div id="validationMount"></div><div id="optimizeMount"></div>`;
  if (h.onCopy) container.querySelector('#btnCopySql')?.addEventListener('click', h.onCopy);
  if (h.onClear) container.querySelector('#btnClearSql')?.addEventListener('click', h.onClear);
  if (h.onValidate) container.querySelector('#btnValidateSql')?.addEventListener('click', h.onValidate);
  if (h.onRegenerate) container.querySelector('#btnRegenSql')?.addEventListener('click', h.onRegenerate);
  if (h.onOptimize) container.querySelector('#btnOptimizeSql')?.addEventListener('click', h.onOptimize);
  extra.forEach((b) => container.querySelector(`#${b.id}`)?.addEventListener('click', b.onClick));
}
export function copyTextToClipboard(text: string): Promise<void> { if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text)); fallbackCopy(text); return Promise.resolve(); }
function fallbackCopy(text: string): void { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch { /* ignore */ } ta.remove(); }
