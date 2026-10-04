import { icon } from '../components/icons';
import { renderTablePicker } from '../components/tablePicker';
import { renderColumnPicker } from '../components/columnPicker';
import { renderFilterBuilder } from '../components/filterBuilder';
import { renderSqlCodeBlock, copyTextToClipboard } from '../components/sqlCodeBlock';
import { renderTabs } from '../components/tabs';
import { openManualCaseBuilder, openManualDecodeBuilder } from '../components/manualExprBuilder';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { performBackgroundPull, performPublicDiscovery } from '../services/autoSyncService';
import { secretVaultService } from '../services/secretVaultService';
import { validateFullReadOnly } from '../engines/validationEngine';
import { optimizeSuggestions } from '../engines/optimizeEngine';
import { orchestrateReadOnlyNlpV17, applyV17ResultToStore, renderV17Extras, recordV17Use, openV17AcceptAndLearn, mountV17AutoOptions, clearV17ManualOverrides } from '../v17/integration';
import { escapeHtml as e } from '../utils/dom';
import { makeId } from '../utils/id';
import type { Dialect, SchemaModel } from '../types';
const DIALECTS: Dialect[] = ['SQL Server', 'Oracle', 'PostgreSQL', 'MySQL', 'Generic'];
export function renderReadOnlyBuilderPage(container: HTMLElement): void {
  let activeTabId = 'tables-columns'; let isBuilding = false; let lastNotesHtml = '';
  performPublicDiscovery('readonly-page-mount').catch(() => {}); if (secretVaultService.isUnlocked()) performBackgroundPull('readonly-page-mount').catch(() => {});
  function issuesHtml(): string {
    const v = validateFullReadOnly(store.readOnly); const err = v.issues.filter((i) => i.severity === 'error'); const warn = v.issues.filter((i) => i.severity === 'warning');
    return `${err.length ? `<div class="issue-box">${icon('alert-triangle', 15)}<ul>${err.map((i) => `<li>${e(i.message)}</li>`).join('')}</ul></div>` : ''}${warn.length ? `<div class="issue-box warn">${icon('alert-triangle', 14)}<ul>${warn.map((i) => `<li>${e(i.message)}</li>`).join('')}</ul></div>` : ''}`;
  }
  function draw(): void {
    const s = store.readOnly;
    container.innerHTML = `<div class="page"><h1 class="page-title">${icon('table')} Read Only Query Builder</h1><p class="page-subtitle">Generates validated SELECT / WITH statements only. Natural Language and Manual Selectors merge together — use either one, or both.</p>
    <div class="builder-grid-top"><div class="builder-panel" data-tour="describe-card"><h2>${icon('sparkles', 16)} Describe What You Need (optional)</h2><textarea id="nlDesc" rows="5" placeholder="e.g. Top 5 vendors by total invoice amount for approved invoices this year">${e(s.naturalLanguageText)}</textarea><label class="inline-label">SQL dialect<select id="dialectSelect">${DIALECTS.map((d) => `<option ${d === s.dialect ? 'selected' : ''}>${d}</option>`).join('')}</select></label><div class="row-actions"><button type="button" id="nlBuildBtn" class="btn btn-primary" ${isBuilding ? 'disabled' : ''}>${icon('zap', 15)} ${isBuilding ? 'Processing…' : 'Build from Description'}</button></div><div id="nlNotes">${lastNotesHtml}</div></div>
    <div class="builder-panel"><h2>${icon('code', 16)} Generated SQL</h2><div id="sqlBlockMount"></div></div></div>
    <div class="builder-panel manual-selectors-panel"><h2>${icon('sliders', 16)} Manual Selectors</h2><div id="tabsMount"></div><div class="row-actions build-query-row"><button type="button" id="buildQueryBtn" class="btn btn-primary">${icon('zap', 15)} Build Query</button><span class="hint">Regenerates the SQL from your current manual selections (this also happens automatically as you make changes).</span></div></div><div id="roIssues">${issuesHtml()}</div></div>`;
    container.querySelector<HTMLTextAreaElement>('#nlDesc')!.addEventListener('input', (ev) => { store.readOnly.naturalLanguageText = (ev.target as HTMLTextAreaElement).value; });
    container.querySelector<HTMLSelectElement>('#dialectSelect')!.addEventListener('change', (ev) => { store.updateReadOnly((x) => { x.dialect = (ev.target as HTMLSelectElement).value as Dialect; }); refresh(); });
    container.querySelector('#nlBuildBtn')!.addEventListener('click', () => runNlBuild());
    container.querySelector('#buildQueryBtn')!.addEventListener('click', () => { store.regenerateReadOnlySql(); store.pushToast('info', 'Query rebuilt from manual selections.'); refresh(); });
    renderSqlOutput(); renderTabsSection(); reattachExtras();
  }
  function reattachExtras(): void { const n = container.querySelector<HTMLElement>('#nlNotes'); if (n && lastNotesHtml) { wireClarify(n); renderV17Extras(n, () => renderSqlOutput()); } }
  function refresh(): void { renderSqlOutput(); const m = container.querySelector('#roIssues'); if (m) m.innerHTML = issuesHtml(); }
  function wireClarify(n: HTMLElement): void { n.querySelectorAll<HTMLElement>('.clarify-btn').forEach((b) => b.addEventListener('click', () => { const [t, c] = (b.dataset.col || '').split('.'); store.updateReadOnly((x) => { x.filters = x.filters.map((f) => (f.table === t || x.selectedTables.includes(f.table)) && /DATE|TIME/i.test(schemaService.getActiveSchema().tables.find((tt) => tt.name === f.table)?.columns.find((cc) => cc.name === f.column)?.type || '') ? { ...f, table: t, column: c } : f); if (!x.selectedTables.includes(t)) x.selectedTables.push(t); }); store.pushToast('info', `Date filter moved to ${b.dataset.col}.`); refresh(); renderTabsSection(); })); }
  async function runNlBuild(): Promise<void> {
    isBuilding = true; const btn = container.querySelector<HTMLButtonElement>('#nlBuildBtn'); if (btn) { btn.disabled = true; btn.innerHTML = `${icon('zap', 15)} Processing…`; }
    try {
      const schema = schemaService.getActiveSchema();
      const orchestrated = await orchestrateReadOnlyNlpV17(store.readOnly.naturalLanguageText, schema); const req = orchestrated.result;
      applyV17ResultToStore(req);
      const badge = orchestrated.engineUsed === 'copilot' ? `<span class="engine-badge engine-online">${icon('bot', 13)} M365 Copilot Enterprise + Offline NLU</span>` : orchestrated.engineUsed === 'online' ? `<span class="engine-badge engine-online">${icon('bot', 13)} Offline NLU + AI / LLM Model</span>` : `<span class="engine-badge engine-offline">${icon('wifi-off', 13)} Offline NLU (V17)${orchestrated.onlineAttempted ? ' — AI / LLM not used' : ''}</span>`;
      const active = schemaService.getActiveSchema();
      const clar = req.clarifications.length ? `<div class="issue-box warn mini">${icon('alert-triangle', 14)}${req.clarifications.map((c) => `<div>${e(c.question)} ${c.options.map((o) => `<button type="button" class="btn btn-outline btn-sm clarify-btn" data-col="${e(o)}">${e(o)}</button>`).join(' ')}</div>`).join('')}</div>` : '';
      lastNotesHtml = `<div class="notes-box"><div style="width:100%">${badge}<div class="schema-audit-line">${icon('database', 12)} Active Schema used: ${e(active.name)} (v${e(String(active.versionMeta?.version ?? active.version))})</div>${req.queryPlan.length ? `<strong>Query Plan</strong><ul class="plan-list">${req.queryPlan.map((p) => `<li>${p}</li>`).join('')}</ul>` : ''}${req.notes.length ? `<strong>Notes</strong><ul>${req.notes.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}</div></div>${clar}`;
    } catch (err) {
      lastNotesHtml = `<div class="issue-box mini">${icon('alert-triangle', 14)} Offline model unable to process request — ${e((err as Error)?.message || 'internal error')}. Manual Selectors still work.</div>`;
    } finally { isBuilding = false; }
    draw();
  }
  function renderSqlOutput(): void {
    const mount = container.querySelector<HTMLElement>('#sqlBlockMount'); if (!mount) return;
    renderSqlCodeBlock(mount, store.readOnly.generatedSql, {
      onCopy: () => { copyTextToClipboard(store.readOnly.generatedSql); recordV17Use(store.readOnly.generatedSql); store.pushToast('success', 'SQL copied to clipboard.'); },
      onClear: () => { store.resetReadOnly(); clearV17ManualOverrides(); lastNotesHtml = ''; store.pushToast('info', 'Query cleared.'); draw(); },
      onValidate: () => { const r = validateFullReadOnly(store.readOnly); const v = mount.querySelector('#validationMount'); if (v) v.innerHTML = r.valid ? `<div class="issue-box ok mini">${icon('check', 14)} SQL passed validation — no destructive statements or inconsistent options detected.</div>` : `<div class="issue-box mini">${icon('alert-triangle', 14)}<ul>${r.issues.map((i) => `<li>[${i.severity}] ${e(i.message)}</li>`).join('')}</ul></div>`; },
      onRegenerate: () => { store.regenerateReadOnlySql(); store.pushToast('info', 'SQL regenerated from current selections.'); refresh(); }
    }, [{ id: 'btnAcceptLearn', label: 'Accept & Learn', iconName: 'check', onClick: () => openV17AcceptAndLearn(() => renderSqlOutput()) }, { id: 'btnOptimizeToggle', label: 'Optimize', iconName: 'wand', onClick: () => { const o = mount.querySelector<HTMLElement>('#optimizeMount')!; if (o.innerHTML.trim()) { o.innerHTML = ''; return; } o.innerHTML = `<div class="tips-box">${icon('wand', 15)}<ul>${optimizeSuggestions(store.readOnly).map((t) => `<li>${e(t)}</li>`).join('')}</ul></div>`; } }]);
  }
  function renderTabsSection(): void {
    const mount = container.querySelector<HTMLElement>('#tabsMount'); if (!mount) return; const schema = schemaService.getActiveSchema();
    renderTabs(mount, [{ id: 'tables-columns', label: 'Tables & Columns', render: (p) => tablesTab(p, schema) }, { id: 'advanced', label: 'Advanced Options', render: (p) => advancedTab(p) }, { id: 'summary', label: 'Selected / Described Requirements', render: (p) => summaryTab(p) }], activeTabId, { 'tables-columns': 'tab-tables-columns', advanced: 'tab-advanced', summary: 'tab-summary' }, (id) => { activeTabId = id; });
  }
  function tablesTab(panel: HTMLElement, schema: SchemaModel): void {
    const s = store.readOnly;
    panel.innerHTML = `<div class="tc-grid"><div class="tc-col"><h3>${icon('list', 15)} Select Tables</h3><div id="tablePickerMount"></div></div><div class="tc-col"><h3>${icon('columns', 15)} Select Columns (Alias/DECODE appear once selected)</h3><div id="columnPickerMount"></div></div><div class="tc-col"><h3>${icon('filter', 15)} Filters</h3><div id="filterBuilderMount"></div></div></div>`;
    renderTablePicker(panel.querySelector<HTMLElement>('#tablePickerMount')!, schema, s.selectedTables, (next) => { store.updateReadOnly((x) => { x.selectedTables = next; }); tablesTab(panel, schema); refresh(); });
    renderColumnPicker(panel.querySelector<HTMLElement>('#columnPickerMount')!, schema, s.selectedTables, s.selectedColumns, { onChange: (next) => { store.updateReadOnly((x) => { x.selectedColumns = next; }); refresh(); }, onRequestManualDecodeForColumn: (table, column, specId) => openManualDecodeBuilder(s.dialect, (spec) => { store.updateReadOnly((x) => { x.selectedColumns = x.selectedColumns.map((c) => (c.id === specId ? spec : c)); }); refresh(); tablesTab(panel, schema); }, { table, column: column.name }, specId, `${column.name}_DESC`) });
    renderFilterBuilder(panel.querySelector<HTMLElement>('#filterBuilderMount')!, schema, s.selectedTables, s.filters, (next) => { store.updateReadOnly((x) => { x.filters = next; }); refresh(); });
  }
  function advancedTab(panel: HTMLElement): void {
    const s = store.readOnly;
    panel.innerHTML = `<div class="advanced-grid"><div><label class="inline-check"><input type="checkbox" id="advDistinct" ${s.advanced.distinct ? 'checked' : ''}/> DISTINCT</label><label class="block-label">GROUP BY columns (comma separated)<input type="text" id="advGroupBy" value="${e(s.advanced.groupByColumns.join(', '))}" placeholder="TABLE.COLUMN, …"/></label><label class="block-label">HAVING clause<input type="text" id="advHaving" value="${e(s.advanced.havingClause)}" placeholder="COUNT(TABLE.ID) > 1"/></label><label class="block-label">LIMIT<input type="number" id="advLimit" min="1" value="${s.advanced.limit ?? ''}"/></label><label class="inline-check"><input type="checkbox" id="advRecursive" ${s.advanced.recursive ? 'checked' : ''}/> Recursive (WITH RECURSIVE)</label>
    <h4 class="mt">${icon('sort-asc', 14)} ORDER BY</h4><div id="sortList"></div></div><div><h4>CTEs</h4><div id="cteList" class="filter-rows"></div><button type="button" id="addCteBtn" class="btn btn-outline btn-sm">${icon('plus', 14)} Add CTE</button><h4 class="mt">Manual CASE / DECODE Columns</h4><div id="manualColsList"></div><div class="row-actions"><button type="button" id="addManualCaseBtn" class="btn btn-outline btn-sm">${icon('code', 14)} Add Manual CASE</button><button type="button" id="addManualDecodeBtn" class="btn btn-outline btn-sm">${icon('sparkles', 14)} Add Manual DECODE</button></div></div></div>`;
    mountV17AutoOptions(panel);
    const q = <T extends HTMLElement>(id: string) => panel.querySelector<T>(`#${id}`)!;
    q('advDistinct').addEventListener('change', (ev) => { store.updateReadOnly((x) => { x.advanced.distinct = (ev.target as HTMLInputElement).checked; }); refresh(); });
    q('advGroupBy').addEventListener('input', (ev) => { store.updateReadOnly((x) => { x.advanced.groupByColumns = (ev.target as HTMLInputElement).value.split(',').map((v) => v.trim()).filter(Boolean); }); refresh(); });
    q('advHaving').addEventListener('input', (ev) => { store.updateReadOnly((x) => { x.advanced.havingClause = (ev.target as HTMLInputElement).value; }); refresh(); });
    q('advLimit').addEventListener('input', (ev) => { const v = (ev.target as HTMLInputElement).value; store.updateReadOnly((x) => { x.advanced.limit = v ? parseInt(v, 10) : null; }); refresh(); });
    q('advRecursive').addEventListener('change', (ev) => { store.updateReadOnly((x) => { x.advanced.recursive = (ev.target as HTMLInputElement).checked; }); refresh(); });
    const renderSorts = () => { const l = q('sortList'); const cols = store.readOnly.selectedTables.flatMap((t) => (schemaService.getActiveSchema().tables.find((x) => x.name === t)?.columns || []).map((c) => `${t}.${c.name}`)); l.innerHTML = `${store.readOnly.sorts.map((so, i) => `<div class="mini-row" data-idx="${i}">${so.expression ? `<code>${e(so.expression)}</code>` : `<select class="sort-col">${cols.map((c) => `<option ${c === `${so.table}.${so.column}` ? 'selected' : ''}>${e(c)}</option>`).join('')}</select>`}<select class="sort-dir"><option ${so.direction === 'ASC' ? 'selected' : ''}>ASC</option><option ${so.direction === 'DESC' ? 'selected' : ''}>DESC</option></select><button type="button" class="icon-btn remove-sort" aria-label="Remove sort">${icon('trash', 14)}</button></div>`).join('')}<button type="button" id="addSortBtn" class="btn btn-outline btn-sm" ${cols.length ? '' : 'disabled'}>${icon('plus', 14)} Add sort</button>`;
      const mark = () => { panel.dispatchEvent(new CustomEvent('v17-manual', { detail: 'sorts' })); };
      l.querySelectorAll<HTMLElement>('.mini-row').forEach((r) => { const i = +r.dataset.idx!; r.querySelector('.sort-col')?.addEventListener('change', (ev) => { const [t, c] = (ev.target as HTMLSelectElement).value.split('.'); store.updateReadOnly((x) => { x.sorts[i] = { ...x.sorts[i], table: t, column: c }; }); mark(); refresh(); }); r.querySelector('.sort-dir')!.addEventListener('change', (ev) => { store.updateReadOnly((x) => { x.sorts[i].direction = (ev.target as HTMLSelectElement).value as 'ASC' | 'DESC'; }); mark(); refresh(); }); r.querySelector('.remove-sort')!.addEventListener('click', () => { store.updateReadOnly((x) => { x.sorts.splice(i, 1); }); mark(); refresh(); renderSorts(); }); });
      l.querySelector('#addSortBtn')?.addEventListener('click', () => { const [t, c] = cols[0].split('.'); store.updateReadOnly((x) => { x.sorts.push({ id: makeId('sort'), table: t, column: c, direction: 'ASC' }); }); mark(); refresh(); renderSorts(); });
    };
    renderSorts();
    const renderCtes = () => { const l = q('cteList'); l.innerHTML = store.readOnly.advanced.ctes.map((c, i) => `<div class="cte-row" data-idx="${i}"><input type="text" class="cte-name-input" value="${e(c.name)}" aria-label="CTE name"/><textarea class="cte-body-input" rows="3" aria-label="CTE body" placeholder="SELECT …">${e(c.body)}</textarea><button type="button" class="icon-btn remove-cte-btn" aria-label="Remove CTE">${icon('trash', 14)}</button></div>`).join(''); l.querySelectorAll<HTMLElement>('.cte-row').forEach((r) => { const i = +r.dataset.idx!; r.querySelector('.cte-name-input')!.addEventListener('input', (ev) => { store.updateReadOnly((x) => { x.advanced.ctes[i].name = (ev.target as HTMLInputElement).value; }); refresh(); }); r.querySelector('.cte-body-input')!.addEventListener('input', (ev) => { store.updateReadOnly((x) => { x.advanced.ctes[i].body = (ev.target as HTMLTextAreaElement).value; }); refresh(); }); r.querySelector('.remove-cte-btn')!.addEventListener('click', () => { store.updateReadOnly((x) => { x.advanced.ctes.splice(i, 1); }); refresh(); renderCtes(); }); }); };
    renderCtes(); q('addCteBtn').addEventListener('click', () => { store.updateReadOnly((x) => { x.advanced.ctes.push({ id: makeId('cte'), name: `cte_${x.advanced.ctes.length + 1}`, body: '' }); }); refresh(); renderCtes(); });
    const renderManual = () => { const m = q('manualColsList'); const cols = store.readOnly.selectedColumns.filter((c) => c.manualExpr && (c.displayMode !== 'manual-decode' || !store.readOnly.selectedTables.includes(c.table))); m.innerHTML = cols.length ? cols.map((c) => `<div class="mini-row"><code>${e(c.alias)}</code><button type="button" class="icon-btn remove-manual-col" data-id="${c.id}" aria-label="Remove">${icon('trash', 14)}</button></div>`).join('') : '<p class="hint">No custom CASE/DECODE columns added yet.</p>'; m.querySelectorAll<HTMLElement>('.remove-manual-col').forEach((b) => b.addEventListener('click', () => { store.updateReadOnly((x) => { x.selectedColumns = x.selectedColumns.filter((c) => c.id !== b.dataset.id); }); refresh(); renderManual(); })); };
    renderManual();
    q('addManualCaseBtn').addEventListener('click', () => openManualCaseBuilder(s.dialect, (spec) => { store.updateReadOnly((x) => { x.selectedColumns.push(spec); }); refresh(); renderManual(); store.pushToast('success', `Manual CASE column "${spec.alias}" added.`); }));
    q('addManualDecodeBtn').addEventListener('click', () => openManualDecodeBuilder(s.dialect, (spec) => { store.updateReadOnly((x) => { x.selectedColumns.push(spec); }); refresh(); renderManual(); store.pushToast('success', `Manual DECODE column "${spec.alias}" added.`); }));
  }
  function summaryTab(panel: HTMLElement): void {
    const s = store.readOnly;
    panel.innerHTML = `<div class="summary-grid"><div><h3>Natural-language requirement</h3><p>${e(s.naturalLanguageText || '(none provided)')}</p><h3>Selected tables</h3><p>${e(s.selectedTables.join(', ') || '(none)')}</p><h3>Selected columns</h3><p>${s.selectedColumns.length ? s.selectedColumns.map((c) => e(c.manualExpr ? `Expression: ${c.alias}` : c.aggregate ? `${c.aggregate}(${c.table}.${c.column})${c.alias ? ` AS ${c.alias}` : ''}` : `${c.table}.${c.column}${c.alias ? ` AS ${c.alias}` : ''}${c.displayMode === 'schema-decode' ? ' (schema decode)' : ''}`)).join('<br/>') : '(none — SELECT * will be used)'}</p><h3>Filters</h3><p>${s.filters.length ? s.filters.map((f, i) => e(`${i ? f.combinator + ' ' : ''}${f.table}.${f.column} ${f.operator} ${f.value}${f.value2 ? ' AND ' + f.value2 : ''}`)).join('<br/>') : '(none)'}</p></div><div><h3>Advanced options</h3><ul><li>DISTINCT: ${s.advanced.distinct ? 'Yes' : 'No'}</li><li>Sort: ${e(s.sorts.length ? s.sorts.map((x) => `${x.expression || `${x.table}.${x.column}`} ${x.direction}`).join(', ') : '(none)')}</li><li>Group by: ${e(s.advanced.groupByColumns.join(', ') || '(none)')}</li><li>Having: ${e(s.advanced.havingClause || '(none)')}</li><li>Limit: ${s.advanced.limit ?? '(none)'}</li><li>CTEs: ${s.advanced.ctes.length}</li><li>Explicit joins: ${s.joins.length}</li></ul></div></div>`;
  }
  const unsub = schemaService.subscribe(() => { if (container.isConnected) { refresh(); renderTabsSection(); } });
  draw(); (container as any)._cleanup = () => unsub();
}
