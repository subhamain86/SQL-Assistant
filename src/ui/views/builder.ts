/** Read Only Query Builder — Describe What You Need (offline NLU) + Manual Selectors + Advanced Options. */
import type { ReadOnlyQueryState, FilterCondition, FilterOperator, Dialect, SchemaModel } from '../../types';
import { services, aiConfig, secrets } from '../context';
import { $, esc, val, checked, on, toast, options, highlightSql } from '../dom';
import { generateFromDescription } from '../../v17/services/queryOrchestrator';
import { buildSelect, type BuildResult } from '../../engines/sqlEngine';
import { computeAutoJoinPlan } from '../../engines/joinAutoEngine';
import { withFkRelationships } from '../../v17/engines/joinGraph';
import { validateFullReadOnly } from '../../engines/validationEngine';
import { validateSqlAgainstSchema } from '../../engines/sqlSchemaValidator';
import { FILTER_OPERATORS, requiresValue } from '../../engines/filterEngine';
import { optimizeSuggestions } from '../../engines/optimizeEngine';
import { advancedOverrides, completeGroupBy, type ManualOptionKey } from '../../v17/engines/advancedOptionsResolver';
import { makeId } from '../../utils/id';
export function emptyReadOnly(): ReadOnlyQueryState { return { dialect: 'Oracle', naturalLanguageText: '', selectedTables: [], selectedColumns: [], filters: [], sorts: [], advanced: { distinct: false, groupByColumns: [], havingClause: '', limit: null, viewName: '', tableAliases: false, joinType: 'INNER JOIN' }, generatedSql: '' }; }
let st: ReadOnlyQueryState = emptyReadOnly(); let viewTable = ''; let lastBuild: BuildResult | null = null; let baseline = ''; let interp = ''; let autoKeys = new Set<string>();
const schema = (): SchemaModel => services().schemas.active();
/** 'change' fires during blur; re-rendering the focused element synchronously throws, so re-render after the event. */
export const later = (f: () => void) => () => { setTimeout(f, 0); };
const opOptions = (sel: string) => FILTER_OPERATORS.map((o) => `<option value="${esc(o.op)}"${o.op === sel ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
export function filterRowsHtml(filters: FilterCondition[], cols: string[], prefix: string): string {
  return filters.map((f, i) => `<div class="filter-row" data-fid="${esc(f.id)}">${i ? `<select class="form-select form-select-sm" data-${prefix}-f="combinator" style="flex:0 0 72px">${options(['AND', 'OR'], f.combinator)}</select>` : '<span class="small text-body-secondary" style="width:72px">WHERE</span>'}
    <select class="form-select form-select-sm" data-${prefix}-f="column">${options(cols, `${f.table}.${f.column}`)}</select><select class="form-select form-select-sm" data-${prefix}-f="operator">${opOptions(f.operator)}</select>
    ${requiresValue(f.operator) ? `<input class="form-control form-control-sm" data-${prefix}-f="value" value="${esc(f.value)}" placeholder="${f.operator.includes('IN') ? '10, 20, 40' : 'value'}">` : ''}${f.operator === 'BETWEEN' ? `<input class="form-control form-control-sm" data-${prefix}-f="value2" value="${esc(f.value2 || '')}" placeholder="and">` : ''}
    <button class="btn btn-outline-danger btn-sm" data-${prefix}-f="remove" type="button" aria-label="Remove filter"><i class="bi bi-x"></i></button></div>`).join('') || '<p class="small text-body-secondary mb-0">No filters yet.</p>';
}
export function bindFilterRows(container: HTMLElement, filters: FilterCondition[], prefix: string, changed: () => void): void {
  container.querySelectorAll<HTMLElement>(`[data-${prefix}-f]`).forEach((el) => { const row = el.closest<HTMLElement>('[data-fid]')!; const f = filters.find((x) => x.id === row.dataset.fid)!; const kind = el.getAttribute(`data-${prefix}-f`)!;
    if (kind === 'remove') { el.addEventListener('click', () => { filters.splice(filters.indexOf(f), 1); changed(); }); return; }
    el.addEventListener('change', () => { const v = (el as HTMLInputElement).value; if (kind === 'column') { const [t, c] = v.split('.'); f.table = t; f.column = c; } else if (kind === 'operator') f.operator = v as FilterOperator; else if (kind === 'combinator') f.combinator = v as 'AND'; else if (kind === 'value') f.value = v; else f.value2 = v; changed(); }); });
}
function mark(id: string, key: ManualOptionKey, auto: boolean): void { const el = $(id); if (el) el.innerHTML = advancedOverrides.isManual(key) ? '<span class="manual-badge">manual</span>' : auto ? '<span class="auto-badge">auto</span>' : ''; }
function allCols(): string[] { const s = schema(); return st.selectedTables.flatMap((t) => (s.tables.find((x) => x.name === t)?.columns || []).map((c) => `${t}.${c.name}`)); }
export function renderBuilder(): void {
  const s = schema(); st.selectedTables = st.selectedTables.filter((t) => s.tables.some((x) => x.name === t)); st.selectedColumns = st.selectedColumns.filter((c) => c.manualExpr || st.selectedTables.includes(c.table)); st.filters = st.filters.filter((f) => st.selectedTables.includes(f.table));
  // Drop grouping/sorting/HAVING that reference tables which are no longer selected (e.g. left over from an earlier description).
  const refsOk = (expr: string) => [...expr.matchAll(/\b([A-Za-z_][A-Za-z0-9_$#]*)\.[A-Za-z_]/g)].every((m) => st.selectedTables.includes(m[1]));
  st.advanced.groupByColumns = st.advanced.groupByColumns.filter(refsOk); st.sorts = st.sorts.filter((x) => (x.expression ? refsOk(x.expression) : st.selectedTables.includes(x.table)));
  if (st.advanced.havingClause && !refsOk(st.advanced.havingClause)) st.advanced.havingClause = '';
  if (!st.selectedColumns.some((c) => c.aggregate || /\(/.test(c.manualExpr || ''))) { st.sorts = st.sorts.filter((x) => !x.expression); if (st.advanced.groupByColumns.length && !advancedOverrides.isManual('groupBy')) st.advanced.groupByColumns = []; }
  $('promptInput').hidden = false; $('aiEngineHint').textContent = aiConfig.enabled ? ' · AI/LLM Model fallback enabled' : '';
  // Pick Tables
  const modules = Array.from(new Set(s.tables.map((t) => t.module))).sort(); const msel = $<HTMLSelectElement>('moduleFilterSel'); const curMod = msel.value; msel.innerHTML = `<option value="">All modules (${s.tables.length} tables)</option>${options(modules, curMod)}`;
  const q = val('tableSearchInput').toLowerCase(); const mod = msel.value;
  const visible = s.tables.filter((t) => (!mod || t.module === mod) && (!q || `${t.name} ${t.description}`.toLowerCase().includes(q)));
  $('tableListGrid').innerHTML = visible.slice(0, 300).map((t) => `<label class="table-pick${st.selectedTables.includes(t.name) ? ' selected' : ''}"><input class="form-check-input" type="checkbox" data-table="${esc(t.name)}"${st.selectedTables.includes(t.name) ? ' checked' : ''}><span><strong class="small">${esc(t.name)}</strong><br><small>${esc(t.module)} · ${t.columns.length} columns</small></span></label>`).join('') + (visible.length > 300 ? `<p class="small text-body-secondary">${visible.length - 300} more — refine the search.</p>` : '');
  $('tableSelCount').textContent = `${st.selectedTables.length} table${st.selectedTables.length === 1 ? '' : 's'} selected`;
  // Pick Columns
  if (!st.selectedTables.includes(viewTable)) viewTable = st.selectedTables[0] || '';
  $<HTMLSelectElement>('selectedTableDropdown').innerHTML = st.selectedTables.length ? options(st.selectedTables, viewTable) : '<option value="">Select a table first</option>';
  const t = s.tables.find((x) => x.name === viewTable); const cq = val('columnSearchInput').toLowerCase();
  $('columnListBody').innerHTML = t ? t.columns.filter((c) => !cq || `${c.name} ${c.description}`.toLowerCase().includes(cq)).map((c) => { const sel = st.selectedColumns.find((x) => x.table === t.name && x.column === c.name && !x.manualExpr); const k = `${t.name}.${c.name}`;
    return `<div class="column-row-grid"><input class="form-check-input" type="checkbox" data-col="${esc(k)}"${sel ? ' checked' : ''}><span title="${esc(c.description)}">${esc(c.name)} <small class="text-body-secondary">${esc(c.type)}</small></span><input class="form-control form-control-sm" data-alias="${esc(k)}" value="${esc(sel?.alias || '')}" placeholder="alias"><span>${c.decode?.length ? `<input class="form-check-input" type="checkbox" data-decode="${esc(k)}"${sel?.useDecode ? ' checked' : ''} title="Translate codes to labels">` : '<span class="text-body-secondary small">—</span>'}</span></div>`; }).join('') : '';
  $('columnListEmpty').textContent = t ? '' : 'Pick at least one table to choose columns (or leave columns empty for SELECT *).';
  // Filters
  const fg = $('readOnlyFilterGroup'); fg.innerHTML = filterRowsHtml(st.filters, allCols(), 'ro'); bindFilterRows(fg, st.filters, 'ro', later(rebuildAndRender));
  // Advanced
  $<HTMLInputElement>(st.advanced.joinType === 'LEFT JOIN' ? 'optJoinLeft' : 'optJoinInner').checked = true; $<HTMLInputElement>('optTableAliases').checked = st.advanced.tableAliases;
  const plan = st.selectedTables.length > 1 ? computeAutoJoinPlan(withFkRelationships(s), st.selectedTables[0], st.selectedTables.slice(1)) : null;
  $('joinPreviewBox').innerHTML = plan ? [...plan.description.map((d) => `<div><i class="bi bi-link-45deg"></i> ${esc(d)}</div>`), ...plan.unresolvedWarnings.map((w) => `<div class="text-danger">${esc(w)}</div>`)].join('') : '<span class="text-body-secondary">Select two or more tables.</span>';
  $('sortRowsContainer').innerHTML = st.sorts.map((x, i) => `<div class="filter-row"><select class="form-select form-select-sm" data-sort-col="${i}">${x.expression ? `<option>${esc(x.expression)}</option>` : options(allCols(), `${x.table}.${x.column}`)}</select><select class="form-select form-select-sm" data-sort-dir="${i}" style="flex:0 0 90px">${options(['ASC', 'DESC'], x.direction)}</select><button class="btn btn-outline-danger btn-sm" data-sort-rm="${i}" type="button"><i class="bi bi-x"></i></button></div>`).join('') || '<p class="small text-body-secondary mb-0">No sorting.</p>';
  $<HTMLInputElement>('optLimit').value = st.advanced.limit ? String(st.advanced.limit) : ''; $<HTMLInputElement>('optGroupBy').value = st.advanced.groupByColumns.join(', '); $<HTMLInputElement>('optHaving').value = st.advanced.havingClause; $<HTMLInputElement>('optView').value = st.advanced.viewName;
  $<HTMLInputElement>('optDistinct').checked = st.advanced.distinct; $<HTMLInputElement>('optDistinct2').checked = st.advanced.distinct; $<HTMLSelectElement>('dialectSel').value = st.dialect;
  mark('joinMark', 'joinType', autoKeys.has('join')); mark('aliasMark', 'tableAliases', autoKeys.has('alias')); mark('sortMark', 'sorts', autoKeys.has('sort')); mark('limitMark', 'limit', autoKeys.has('limit')); mark('groupMark', 'groupBy', autoKeys.has('group-by')); mark('havingMark', 'having', autoKeys.has('having')); mark('distinctMark', 'distinct', autoKeys.has('distinct'));
  document.querySelectorAll<HTMLElement>('[data-sort-col]').forEach((el) => el.addEventListener('change', () => { const x = st.sorts[+el.dataset.sortCol!]; if (!x.expression) { const [a, b] = (el as HTMLSelectElement).value.split('.'); x.table = a; x.column = b; } advancedOverrides.mark('sorts'); later(rebuildAndRender)(); }));
  document.querySelectorAll<HTMLElement>('[data-sort-dir]').forEach((el) => el.addEventListener('change', () => { st.sorts[+el.dataset.sortDir!].direction = (el as HTMLSelectElement).value as 'ASC'; advancedOverrides.mark('sorts'); later(rebuildAndRender)(); }));
  document.querySelectorAll<HTMLElement>('[data-sort-rm]').forEach((el) => el.addEventListener('click', () => { st.sorts.splice(+el.dataset.sortRm!, 1); advancedOverrides.mark('sorts'); rebuildAndRender(); }));
  // Requirements summary
  $('requirementsSummaryBody').innerHTML = `<div class="card"><div class="card-body"><dl class="row mb-0"><dt class="col-sm-3">Description</dt><dd class="col-sm-9">${esc(st.naturalLanguageText || '—')}</dd><dt class="col-sm-3">Tables</dt><dd class="col-sm-9">${esc(st.selectedTables.join(', ') || '—')}</dd><dt class="col-sm-3">Columns</dt><dd class="col-sm-9">${esc(st.selectedColumns.map((c) => c.manualExpr ? c.alias : `${c.table}.${c.column}`).join(', ') || 'All (*)')}</dd><dt class="col-sm-3">Filters</dt><dd class="col-sm-9">${esc(st.filters.map((f) => `${f.table}.${f.column} ${f.operator} ${f.value}`).join('; ') || '—')}</dd><dt class="col-sm-3">Manual overrides</dt><dd class="col-sm-9">${esc(advancedOverrides.list().join(', ') || 'none')}</dd></dl></div></div>`;
  $('descriptionInterpretationBox').innerHTML = interp;
  renderResult();
}
function renderResult(): void {
  const s = schema(); const has = !!st.generatedSql && !st.generatedSql.startsWith('--');
  if (!st.generatedSql) { $('resultBody').innerHTML = '<p class="text-body-secondary small mb-0">Your generated SQL will appear here as soon as you click Build Query.</p>'; ['copyBtn', 'acceptLearnBtn', 'optimizeBtn'].forEach((b) => $(b).classList.add('d-none')); return; }
  const v = validateFullReadOnly(st); const sv = validateSqlAgainstSchema(st.generatedSql, s); const b = lastBuild;
  $('resultBody').innerHTML = `<pre class="sql-output" id="sqlOutput">${highlightSql(st.generatedSql)}</pre>
    <div class="mt-2 small ${v.valid && sv.valid ? 'text-success' : 'text-danger'}" id="sqlValidation"><i class="bi ${v.valid && sv.valid ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'} me-1"></i>${v.valid && sv.valid ? 'Read-only SQL, validated against the Active Schema.' : esc([...v.issues.map((i) => i.message), ...sv.warnings, ...(b?.warnings || [])].join(' '))}</div>
    ${b && has ? `<div class="result-section-title">Tables Used</div><div class="small">${esc(b.tablesUsed.join(', '))}</div><div class="result-section-title">Columns Used</div><div class="small">${esc(b.columnsUsed.join(', ') || 'All columns (*)')}</div>${b.applied.length ? `<div class="result-section-title">Filters Applied</div><ul class="small mb-0">${b.applied.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}${st.naturalLanguageText ? `<div class="result-section-title">Assumptions</div><div class="small">Built from: “${esc(st.naturalLanguageText)}”</div>` : ''}` : ''}`;
  ['copyBtn', 'acceptLearnBtn', 'optimizeBtn'].forEach((x) => $(x).classList.toggle('d-none', !has));
}
function rebuildAndRender(): void { completeGroupBy(st); lastBuild = buildSelect(st, schema()); st.generatedSql = lastBuild.sql; baseline = st.generatedSql; renderBuilder(); }
function readAdvanced(): void {
  st.advanced.joinType = checked('optJoinLeft') ? 'LEFT JOIN' : 'INNER JOIN'; st.advanced.tableAliases = checked('optTableAliases'); const l = parseInt(val('optLimit'), 10); st.advanced.limit = l > 0 ? l : null;
  st.advanced.groupByColumns = val('optGroupBy').split(',').map((x) => x.trim()).filter(Boolean); st.advanced.havingClause = val('optHaving').trim(); st.advanced.viewName = val('optView').trim(); st.advanced.distinct = checked('optDistinct'); st.dialect = val('dialectSel') as Dialect;
}
export function bindBuilder(): void {
  document.querySelectorAll<HTMLElement>('#manualTabs [data-tab]').forEach((b) => b.addEventListener('click', () => { document.querySelectorAll('#manualTabs .nav-link').forEach((x) => x.classList.toggle('active', x === b)); ['tables', 'advanced', 'requirements'].forEach((k) => $(`pane-${k}`).classList.toggle('d-none', k !== b.dataset.tab)); }));
  on('moduleFilterSel', 'change', later(renderBuilder)); on('tableSearchInput', 'input', renderBuilder); on('columnSearchInput', 'input', renderBuilder);
  on('selectedTableDropdown', 'change', () => { viewTable = val('selectedTableDropdown'); later(renderBuilder)(); });
  $('tableListGrid').addEventListener('change', (e) => { const el = e.target as HTMLInputElement; const t = el.dataset.table; if (!t) return; st.selectedTables = el.checked ? [...st.selectedTables, t] : st.selectedTables.filter((x) => x !== t); if (el.checked) viewTable = t; later(rebuildAndRender)(); });
  on('tableSelectAllBtn', 'click', () => { document.querySelectorAll<HTMLInputElement>('#tableListGrid [data-table]').forEach((el) => { if (!st.selectedTables.includes(el.dataset.table!)) st.selectedTables.push(el.dataset.table!); }); rebuildAndRender(); });
  on('tableUnselectAllBtn', 'click', () => { st.selectedTables = []; st.selectedColumns = []; st.filters = []; rebuildAndRender(); });
  $('columnListBody').addEventListener('change', (e) => { const el = e.target as HTMLInputElement; advancedOverrides.mark('columns');
    if (el.dataset.col) { const [t, c] = el.dataset.col.split('.'); if (el.checked) st.selectedColumns.push({ id: makeId('col'), table: t, column: c, alias: '', useDecode: false, aggregate: null }); else st.selectedColumns = st.selectedColumns.filter((x) => !(x.table === t && x.column === c && !x.manualExpr)); }
    else { const k = el.dataset.alias || el.dataset.decode; if (!k) return; const [t, c] = k.split('.'); let sp = st.selectedColumns.find((x) => x.table === t && x.column === c && !x.manualExpr); if (!sp) { sp = { id: makeId('col'), table: t, column: c, alias: '', useDecode: false, aggregate: null }; st.selectedColumns.push(sp); } if (el.dataset.alias) sp.alias = el.value.trim().replace(/[^A-Za-z0-9_]/g, '_'); else sp.useDecode = el.checked; }
    later(rebuildAndRender)(); });
  on('columnSelectAllBtn', 'click', () => { const t = schema().tables.find((x) => x.name === viewTable); if (!t) return; advancedOverrides.mark('columns'); t.columns.forEach((c) => { if (!st.selectedColumns.some((x) => x.table === t.name && x.column === c.name)) st.selectedColumns.push({ id: makeId('col'), table: t.name, column: c.name, alias: '', useDecode: false, aggregate: null }); }); rebuildAndRender(); });
  on('columnUnselectAllBtn', 'click', () => { st.selectedColumns = st.selectedColumns.filter((x) => x.table !== viewTable); rebuildAndRender(); });
  on('readOnlyAddFilterBtn', 'click', () => { const c = allCols()[0]; if (!c) { toast('info', 'Pick a table first.'); return; } const [t, col] = c.split('.'); st.filters.push({ id: makeId('f'), table: t, column: col, operator: '=', value: '', combinator: 'AND' }); renderBuilder(); });
  on('readOnlyClearFiltersBtn', 'click', () => { st.filters = []; rebuildAndRender(); });
  const manual = (id: string, key: ManualOptionKey) => on(id, 'change', () => { advancedOverrides.mark(key); readAdvanced(); later(rebuildAndRender)(); });
  manual('optJoinInner', 'joinType'); manual('optJoinLeft', 'joinType'); manual('optTableAliases', 'tableAliases'); manual('optLimit', 'limit'); manual('optGroupBy', 'groupBy'); manual('optHaving', 'having'); manual('optDistinct', 'distinct'); on('optView', 'change', () => { readAdvanced(); later(rebuildAndRender)(); });
  on('optDistinct2', 'change', () => { advancedOverrides.mark('distinct'); $<HTMLInputElement>('optDistinct').checked = checked('optDistinct2'); readAdvanced(); later(rebuildAndRender)(); });
  on('optLimitClearBtn', 'click', () => { advancedOverrides.mark('limit'); st.advanced.limit = null; rebuildAndRender(); }); on('optHavingClearBtn', 'click', () => { advancedOverrides.mark('having'); st.advanced.havingClause = ''; rebuildAndRender(); }); on('optViewClearBtn', 'click', () => { st.advanced.viewName = ''; rebuildAndRender(); });
  on('addSortRowBtn', 'click', () => { const c = allCols()[0]; if (!c) return; const [t, col] = c.split('.'); advancedOverrides.mark('sorts'); st.sorts.push({ id: makeId('s'), table: t, column: col, direction: 'ASC' }); rebuildAndRender(); });
  on('clearSortBtn', 'click', () => { advancedOverrides.mark('sorts'); st.sorts = []; rebuildAndRender(); });
  on('releaseManualBtn', 'click', () => { advancedOverrides.clear(); toast('info', 'All Advanced Options returned to automatic inference.'); renderBuilder(); });
  on('dialectSel', 'change', () => { st.dialect = val('dialectSel') as Dialect; if (st.selectedTables.length) later(rebuildAndRender)(); });
  on('generateBtn', 'click', () => { readAdvanced(); const text = val('promptInput').trim(); if (text && text !== st.naturalLanguageText) void describeAndBuild(); else rebuildAndRender(); });
  on('generateFromDescriptionBtn', 'click', () => { void describeAndBuild(); });
  $('promptInput').addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter' && ((e as KeyboardEvent).ctrlKey || (e as KeyboardEvent).metaKey)) void describeAndBuild(); });
  on('copyBtn', 'click', async () => { try { await navigator.clipboard.writeText(st.generatedSql); toast('success', 'SQL copied to the clipboard.'); } catch { toast('warning', 'Clipboard is not available — select the SQL and copy it manually.'); } });
  on('optimizeBtn', 'click', () => { $('optimizeReportBox').innerHTML = `<div class="small"><strong>Optimization suggestions</strong><ul class="mb-0">${optimizeSuggestions(st).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`; });
  on('acceptLearnBtn', 'click', () => { const s = schema(); const { learning } = services(); const chk = validateSqlAgainstSchema(st.generatedSql, s); if (!chk.valid) { toast('error', `Not learned — ${chk.warnings.join(' ')}`); return; } const text = st.naturalLanguageText || val('promptInput');
    if (!text.trim()) { toast('info', 'Accepted. (No description to learn from.)'); return; }
    const ok = learning.confirm(text, s, st.generatedSql, st.generatedSql !== baseline ? st.generatedSql : null) || learning.record({ schema: s, accepted: true, requestText: text, generatedSql: baseline, modifiedSql: null, finalSql: st.generatedSql, tables: st.selectedTables, columns: st.selectedColumns.filter((c) => !c.manualExpr).map((c) => ({ table: c.table, column: c.column })), sorts: st.sorts.filter((x) => !x.expression).map((x) => ({ table: x.table, column: x.column, direction: x.direction })), limit: st.advanced.limit });
    toast(ok ? 'success' : 'warning', ok ? 'Accepted — this pattern will help future requests on this schema.' : 'This request was not learned (it may contain credentials).'); });
}
async function describeAndBuild(): Promise<void> {
  const text = val('promptInput').trim(); readAdvanced();
  if (!text) { rebuildAndRender(); return; }
  try {
    const r = await generateFromDescription(text, { ...st, naturalLanguageText: text }, schema(), st.dialect, services().learning, aiConfig.enabled ? { config: aiConfig, apiKey: secrets.aiApiKey } : null);
    st = r.state; lastBuild = r.build; baseline = st.generatedSql; autoKeys = new Set(r.requirement.autoOptions.map((o) => o.kind)); viewTable = st.selectedTables[0] || '';
    interp = `<div><strong>Understood (${r.engine === 'online' ? 'AI/LLM Model' : 'offline NLU'}):</strong></div><ul class="mb-1">${r.requirement.autoOptions.map((o) => `<li>${esc(o.description)}</li>`).join('') || '<li>No table or condition recognised.</li>'}</ul>${r.keptManual.length ? `<div>Manual settings kept: ${esc(r.keptManual.join(', '))}</div>` : ''}${r.requirement.notes.map((n) => `<div class="text-warning-emphasis">${esc(n)}</div>`).join('')}${r.onlineNote ? `<div>${esc(r.onlineNote)}</div>` : ''}`;
    renderBuilder();
  } catch (e) { toast('error', `The offline model could not process the request: ${(e as Error).message}`); }
}
export function resetBuilderForSchema(): void { st = { ...emptyReadOnly(), dialect: st.dialect }; lastBuild = null; interp = ''; autoKeys.clear(); advancedOverrides.clear(); }
export function setPrompt(text: string): void { $<HTMLTextAreaElement>('promptInput').value = text; void describeAndBuild(); }
