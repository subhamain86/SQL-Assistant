import { icon } from '../components/icons';
import { renderSqlCodeBlock, copyTextToClipboard } from '../components/sqlCodeBlock';
import { renderFilterBuilder } from '../components/filterBuilder';
import { renderTabs } from '../components/tabs';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { orchestrateCrNlp } from '../services/nlpOrchestrator';
import { validateCrState } from '../engines/validationEngine';
import { escapeHtml as e } from '../utils/dom';
import { makeId } from '../utils/id';
import type { CrQueryType, Dialect, SchemaModel } from '../types';
const DIALECTS: Dialect[] = ['SQL Server', 'Oracle', 'PostgreSQL', 'MySQL', 'Generic'];
export function renderCrBuilderPage(container: HTMLElement): void {
  let activeTabId = 'details'; let notesHtml = '';
  const issuesHtml = () => { const i = validateCrState(store.cr); return i.length ? `<div class="issue-box">${icon('alert-triangle', 15)}<ul>${i.map((x) => `<li>${e(x.message)}</li>`).join('')}</ul></div>` : ''; };
  function draw(): void {
    const s = store.cr;
    container.innerHTML = `<div class="page"><h1 class="page-title">${icon('code')} Query Builder for CR (Change Request)</h1><p class="page-subtitle">Generated SQL only — this application does not execute database changes. Use Natural Language and Manual Selectors independently, or combine both.</p>
    <div class="builder-grid-top"><div class="builder-panel"><h2>${icon('sparkles', 16)} Describe the Change (optional)</h2><textarea id="crNlDesc" rows="5" placeholder="e.g. Update invoice 1234 status to Approved">${e(s.naturalLanguageText)}</textarea><label class="inline-label">SQL dialect<select id="crDialectSelect">${DIALECTS.map((d) => `<option ${d === s.dialect ? 'selected' : ''}>${d}</option>`).join('')}</select></label><div class="row-actions"><button type="button" id="crNlBuildBtn" class="btn btn-primary">${icon('zap', 15)} Interpret Description</button></div><div id="crNlNotes">${notesHtml}</div></div><div class="builder-panel"><h2>${icon('code', 16)} Generated SQL</h2><div id="crSqlMount"></div></div></div>
    <div class="builder-panel manual-selectors-panel"><h2>${icon('sliders', 16)} Manual Selectors</h2><div id="crTabsMount"></div></div><div id="crIssues">${issuesHtml()}</div></div>`;
    container.querySelector('#crNlDesc')!.addEventListener('input', (ev) => { store.cr.naturalLanguageText = (ev.target as HTMLTextAreaElement).value; });
    container.querySelector('#crDialectSelect')!.addEventListener('change', (ev) => { store.updateCr((x) => { x.dialect = (ev.target as HTMLSelectElement).value as Dialect; }); renderSql(); });
    container.querySelector('#crNlBuildBtn')!.addEventListener('click', () => run());
    renderSql(); renderTabsSection();
  }
  const refresh = () => { renderSql(); const m = container.querySelector('#crIssues'); if (m) m.innerHTML = issuesHtml(); };
  async function run(): Promise<void> {
    const b = container.querySelector<HTMLButtonElement>('#crNlBuildBtn')!; b.disabled = true; b.innerHTML = `${icon('zap', 15)} Processing…`;
    const schema = schemaService.getActiveSchema(); const o = await orchestrateCrNlp(store.cr.naturalLanguageText, schema); const r = o.result;
    store.updateCr((x) => { if (r.queryType) x.queryType = r.queryType; if (r.matchedTable) x.table = r.matchedTable; if (r.values.length) x.values = r.values; if (r.filters.length) x.filters = r.filters; });
    const badge = o.engineUsed === 'copilot' ? `<span class="engine-badge engine-online">${icon('bot', 13)} M365 Copilot Enterprise + Offline Engine</span>` : `<span class="engine-badge engine-offline">${icon('wifi-off', 13)} Offline/local engine</span>`;
    notesHtml = `<div class="notes-box"><div>${badge}<div class="schema-audit-line">${icon('database', 12)} Active Schema used: ${e(schema.name)} (v${e(String(schema.versionMeta?.version ?? schema.version))})</div><ul>${r.notes.map((n) => `<li>${e(n)}</li>`).join('')}</ul></div></div>`;
    draw();
  }
  function renderSql(): void { const m = container.querySelector<HTMLElement>('#crSqlMount'); if (!m) return; renderSqlCodeBlock(m, store.cr.generatedSql, { onCopy: () => { copyTextToClipboard(store.cr.generatedSql); store.pushToast('success', 'SQL copied to clipboard.'); }, onClear: () => { store.resetCr(); notesHtml = ''; store.pushToast('info', 'CR query cleared.'); draw(); }, onRegenerate: () => { store.regenerateCrSql(); refresh(); } }); }
  function renderTabsSection(): void { const m = container.querySelector<HTMLElement>('#crTabsMount'); if (!m) return; const schema = schemaService.getActiveSchema(); renderTabs(m, [{ id: 'details', label: 'Query Details', render: (p) => details(p, schema) }, { id: 'summary', label: 'Selected / Described Requirements', render: (p) => summary(p) }], activeTabId, { details: 'cr-tab-details' }, (id) => { activeTabId = id; }); }
  function details(panel: HTMLElement, schema: SchemaModel): void {
    const s = store.cr; const cols = s.table ? (schema.tables.find((t) => t.name === s.table)?.columns || []) : []; const needsWhere = s.queryType !== 'INSERT';
    const modules = Array.from(new Set(schema.tables.map((t) => t.module)));
    panel.innerHTML = `<div class="advanced-grid"><div><h4>Query Type</h4><div class="segmented" data-tour="cr-query-type">${(['INSERT', 'UPDATE', 'DELETE'] as CrQueryType[]).map((qt) => `<button type="button" class="seg-btn ${qt === s.queryType ? 'active' : ''}" data-qt="${qt}">${qt}</button>`).join('')}</div><h4>Pick Table</h4><select id="crTableSelect"><option value="">— choose a table —</option>${modules.map((m) => `<optgroup label="${e(m)}">${schema.tables.filter((t) => t.module === m && t.objectType !== 'VIEW').map((t) => `<option ${t.name === s.table ? 'selected' : ''}>${e(t.name)}</option>`).join('')}</optgroup>`).join('')}</select>
    <h4 class="mt">${s.queryType === 'UPDATE' ? 'Columns to Set' : s.queryType === 'INSERT' ? 'Columns &amp; Values' : 'Values'}</h4>${s.queryType === 'DELETE' ? '<p class="hint">DELETE only needs a WHERE condition — no column values required.</p>' : `<div id="crValuesList" class="filter-rows"></div><button type="button" id="addCrValueBtn" class="btn btn-outline btn-sm" ${cols.length ? '' : 'disabled'}>${icon('plus', 14)} Add column</button>`}</div>
    <div><h4>Filters (WHERE Conditions)</h4><div id="crFilterMount"></div>${needsWhere ? `<div class="issue-box warn mini">⚠️ A WHERE condition is required to identify which records should be updated or deleted.</div><label class="inline-check"><input type="checkbox" id="confirmNoWhere" ${s.confirmNoWhere ? 'checked' : ''}/> I explicitly confirm this query should have no WHERE condition</label>` : ''}</div></div>`;
    panel.querySelectorAll<HTMLElement>('.seg-btn').forEach((b) => b.addEventListener('click', () => { store.updateCr((x) => { x.queryType = b.dataset.qt as CrQueryType; }); details(panel, schema); refresh(); }));
    panel.querySelector('#crTableSelect')!.addEventListener('change', (ev) => { store.updateCr((x) => { x.table = (ev.target as HTMLSelectElement).value || null; x.values = []; x.filters = []; }); details(panel, schema); refresh(); });
    panel.querySelector('#addCrValueBtn')?.addEventListener('click', () => { store.updateCr((x) => { x.values.push({ id: makeId('crv'), column: cols[0].name, value: '' }); }); renderValues(); refresh(); });
    panel.querySelector('#confirmNoWhere')?.addEventListener('change', (ev) => { store.updateCr((x) => { x.confirmNoWhere = (ev.target as HTMLInputElement).checked; }); refresh(); });
    const renderValues = () => { const l = panel.querySelector<HTMLElement>('#crValuesList'); if (!l) return; l.innerHTML = store.cr.values.map((v, i) => `<div class="mini-row" data-idx="${i}"><select class="crv-col-select">${cols.map((c) => `<option ${c.name === v.column ? 'selected' : ''}>${e(c.name)}</option>`).join('')}</select><span>=</span><input type="text" class="crv-val-input" value="${e(v.value)}" placeholder="value"/><button type="button" class="icon-btn remove-btn" aria-label="Remove">${icon('trash', 14)}</button></div>`).join(''); l.querySelectorAll<HTMLElement>('.mini-row').forEach((r) => { const i = +r.dataset.idx!; r.querySelector('.crv-col-select')!.addEventListener('change', (ev) => { store.updateCr((x) => { x.values[i].column = (ev.target as HTMLSelectElement).value; }); refresh(); }); r.querySelector('.crv-val-input')!.addEventListener('input', (ev) => { store.updateCr((x) => { x.values[i].value = (ev.target as HTMLInputElement).value; }); refresh(); }); r.querySelector('.remove-btn')!.addEventListener('click', () => { store.updateCr((x) => { x.values.splice(i, 1); }); renderValues(); refresh(); }); }); };
    renderValues();
    const fm = panel.querySelector<HTMLElement>('#crFilterMount')!; if (!s.table) fm.innerHTML = '<p class="hint">Select a table first.</p>'; else renderFilterBuilder(fm, schema, [s.table], s.filters, (next) => { store.updateCr((x) => { x.filters = next; }); refresh(); });
  }
  function summary(panel: HTMLElement): void { const s = store.cr; panel.innerHTML = `<div class="summary-grid"><div><h3>Natural-language requirement</h3><p>${e(s.naturalLanguageText || '(none provided)')}</p><h3>Query type</h3><p>${s.queryType}</p><h3>Table</h3><p>${e(s.table || '(none)')}</p></div><div><h3>Values</h3><p>${s.values.length ? s.values.map((v) => e(`${v.column} = ${v.value}`)).join('<br/>') : '(none)'}</p><h3>Filters</h3><p>${s.filters.length ? s.filters.map((f, i) => e(`${i ? f.combinator + ' ' : ''}${f.table}.${f.column} ${f.operator} ${f.value}`)).join('<br/>') : '(none)'}</p></div></div>`; }
  const unsub = schemaService.subscribe(() => { if (container.isConnected) renderTabsSection(); });
  draw(); (container as any)._cleanup = () => unsub();
}
