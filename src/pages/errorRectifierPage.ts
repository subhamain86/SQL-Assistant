import { icon } from '../components/icons';
import { aiService } from '../services/aiService';
import { store } from '../state/store';
import { copyTextToClipboard } from '../components/sqlCodeBlock';
import { escapeHtml as e } from '../utils/dom';
import type { Dialect } from '../types';
export function renderErrorRectifierPage(container: HTMLElement): void {
  const dialects: Dialect[] = ['SQL Server', 'Oracle', 'PostgreSQL', 'MySQL', 'Generic'];
  container.innerHTML = `<div class="page"><h1 class="page-title">${icon('bug')} Error Rectifier</h1><p class="page-subtitle">SQL generated for review only. Never executes database changes. Always grounded in the current active schema.</p>
  <div class="builder-grid-top" data-tour="error-rectifier-form"><div class="builder-panel"><h2>1. Paste SQL</h2><textarea id="errSqlText" rows="9" spellcheck="false" placeholder="SELECT …"></textarea></div><div class="builder-panel"><h2>2. Paste the database/schema validation error</h2><textarea id="errText" rows="5" placeholder="ORA-00904: …"></textarea><label class="block-label">SQL dialect (auto-detected where possible)<select id="errDialectSelect">${dialects.map((d) => `<option ${d === 'Oracle' ? 'selected' : ''}>${d}</option>`).join('')}</select></label><div class="row-actions"><button type="button" id="rectifyBtn" class="btn btn-primary">${icon('wand', 15)} Identify problem &amp; suggest correction</button></div></div></div>
  <div class="builder-panel mt"><h2>3. Review the suggested correction</h2><pre class="sql-output" id="rectifiedOutput">—</pre><div class="row-actions"><button type="button" id="copySqlBtn" class="btn btn-outline btn-sm">${icon('copy', 14)} Copy corrected SQL</button></div><h2>Explanation</h2><div class="explanation-box" id="explanationBox">—</div><h2>What Changed</h2><ul id="whatChangedList"><li>—</li></ul></div></div>`;
  const q = <T extends HTMLElement>(s: string) => container.querySelector<T>(s)!;
  container.querySelector('#rectifyBtn')!.addEventListener('click', () => {
    const err = q<HTMLTextAreaElement>('#errText').value.trim(); const sql = q<HTMLTextAreaElement>('#errSqlText').value.trim();
    if (!err || !sql) { q('#rectifiedOutput').textContent = 'Please provide both the SQL query and the database error it produced.'; q('#explanationBox').textContent = '—'; q('#whatChangedList').innerHTML = '<li>—</li>'; return; }
    const r = aiService.rectifySQL(err, sql); if (r.detectedDialect) q<HTMLSelectElement>('#errDialectSelect').value = r.detectedDialect;
    q('#rectifiedOutput').textContent = r.correctedSql; q('#explanationBox').textContent = r.explanation; q('#whatChangedList').innerHTML = r.whatChanged.length ? r.whatChanged.map((c) => `<li>${e(c)}</li>`).join('') : '<li>No changes were necessary.</li>';
    store.pushToast('info', 'Error analyzed — review the suggested correction before applying it.');
  });
  container.querySelector('#copySqlBtn')!.addEventListener('click', () => { copyTextToClipboard(q('#rectifiedOutput').textContent || ''); store.pushToast('success', 'Corrected SQL copied to clipboard.'); });
}
