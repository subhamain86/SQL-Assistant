/** V17.0 — Extra result details under "Describe What You Need" (rendered only when there is something to show). */
import { icon } from '../../components/icons';
import { renderErrorListHtml, escapeHtmlV17 as esc } from '../errors/appErrors';
import type { DescribeResult } from '../services/v17Orchestrator';

export function renderDescribeExtras(mount: HTMLElement, r: DescribeResult | null, handlers: { onUseLlmSql: (sql: string) => void }): void {
  mount.querySelector('[data-v17-extras]')?.remove();
  if (!r) return;
  const parts: string[] = [];
  const errHtml = renderErrorListHtml(r.errors, esc); if (errHtml) parts.push(errHtml);
  if (r.applied.length) parts.push(`<div class="hint">${icon('zap', 12)} Applied automatically: ${esc(r.applied.join(', '))}.</div>`);
  if (r.keptManual.length) parts.push(`<div class="hint">${icon('sliders', 12)} Kept your manual settings: ${esc(r.keptManual.join(', '))}.</div>`);
  if (r.requirement.learnedPatternIds.length) parts.push(`<div class="hint">${icon('history', 12)} A confirmed/repeated pattern from learned query knowledge was used as a hint.</div>`);
  if (r.llmStatus !== 'not configured') parts.push(`<div class="hint">${icon('bot', 12)} AI / LLM Model: ${esc(r.llmStatus)}.</div>`);
  if (r.llmSql && !r.usedLlmSql) parts.push(`<div class="notes-box"><div style="width:100%"><strong>${icon('bot', 13)} AI / LLM suggestion (validated against the Active Schema)</strong>${r.llmExplanation ? `<div class="hint">${esc(r.llmExplanation)}</div>` : ''}<pre class="sql-output">${esc(r.llmSql)}</pre><div class="row-actions"><button type="button" class="btn btn-outline btn-sm" data-v17-use-llm>${icon('check', 14)} Use this SQL</button></div></div></div>`);
  if (!parts.length) return;
  const box = document.createElement('div'); box.setAttribute('data-v17-extras', ''); box.innerHTML = parts.join('');
  mount.appendChild(box);
  box.querySelector('[data-v17-use-llm]')?.addEventListener('click', () => { if (r.llmSql) handlers.onUseLlmSql(r.llmSql); });
}
