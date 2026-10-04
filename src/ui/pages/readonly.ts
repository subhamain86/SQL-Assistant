/** Read Only Query Builder: Describe What You Need (offline NLU) + Manual Selectors + Advanced Options. */
import { state, emptyReadOnly } from '../../state/store';
import { schemas, learning, aiConfig, secrets } from '../context';
import { esc, val, checked, toast, options } from '../dom';
import { generateFromDescription } from '../../v17/services/queryOrchestrator';
import { buildSelectSQL } from '../../engines/sqlEngine';
import { validateFullReadOnly } from '../../engines/validationEngine';
import { validateSqlAgainstSchema } from '../../engines/sqlSchemaValidator';
import { optimizeSuggestions } from '../../engines/optimizeEngine';
import { FILTER_OPERATORS, requiresValue, requiresSecondValue } from '../../engines/filterEngine';
import { advancedOverrides, completeGroupBy, ADVANCED_INPUT_KEYS } from '../../v17/engines/advancedOptionsResolver';
import { decodeLegend } from '../../engines/decodeEngine';
import { makeId } from '../../utils/id';
import type { Dialect, FilterOperator } from '../../types';
import type { OrchestratedResult } from '../../v17/services/queryOrchestrator';
let last: OrchestratedResult | null = null; let generatedBaseline = '';
const DIALECTS: Dialect[] = ['Oracle', 'SQL Server', 'PostgreSQL', 'MySQL', 'Generic'];
function regen(): void { const s = schemas.active(); completeGroupBy(state.readOnly); state.readOnly.generatedSql = buildSelectSQL(state.readOnly, s); state.readOnly.lastGeneratedAt = new Date().toISOString(); generatedBaseline = state.readOnly.generatedSql; }
export function renderReadOnly(root: HTMLElement): void {
  const s = schemas.active(); const st = state.readOnly; const tables = s.tables.map((t) => t.name);
  const cols = st.selectedTables.flatMap((t) => (s.tables.find((x) => x.name === t)?.columns || []).map((c) => ({ t, c })));
  const v = st.generatedSql ? validateFullReadOnly(st) : null; const sv = st.generatedSql ? validateSqlAgainstSchema(st.generatedSql, s) : null;
  const manual = (k: Parameters<typeof advancedOverrides.isManual>[0]) => advancedOverrides.isManual(k) ? '<span class="manual-badge" title="Manual selection — takes precedence over automatic inference">manual</span>' : '';
  root.innerHTML = `<h1>Read Only Query Builder</h1>
  <div class="card"><div class="row"><div class="grow"><label for="nlText">Describe What You Need</label>
    <textarea id="nlText" placeholder="e.g. total invoice amount per vendor for approved invoices in the last 30 days, top 10">${esc(st.naturalLanguageText)}</textarea></div></div>
    <div class="row"><label for="dialect" style="margin:0">Dialect</label><select id="dialect">${options(DIALECTS, st.dialect)}</select>
    <button class="primary" id="nlGenerate">Generate SQL</button><button id="resetRo">Reset</button>
    <span class="muted small">Active Schema: <strong>${esc(s.name)}</strong> · Engine: offline NLU${aiConfig.enabled ? ' (AI/LLM Model fallback enabled)' : ''}</span></div>
    ${last ? `<div class="auto-opt" id="autoOptions"><h3>Automatically inferred</h3><ul>${last.requirement.autoOptions.map((o) => `<li class="${o.applied ? 'applied' : 'suggested'}">${o.applied ? '✓' : '?'} ${esc(o.description)}</li>`).join('') || '<li class="muted">Nothing inferred.</li>'}</ul>
      ${last.keptManual.length ? `<p class="small">Manual selections kept (they take precedence): ${esc(last.keptManual.join(', '))}</p>` : ''}
      ${last.requirement.schemaGaps.length ? `<div class="issue-box">Not found in the Active Schema: ${esc(last.requirement.schemaGaps.map((g) => g.term).join(', '))}</div>` : ''}
      ${last.requirement.notes.map((n) => `<p class="small muted">${esc(n)}</p>`).join('')}${last.onlineNote ? `<p class="small">${esc(last.onlineNote)}</p>` : ''}</div>` : ''}
  </div>
  <div class="two"><div class="card"><h2>Manual Selectors</h2>
    <label>Tables</label><select id="tableSelect" multiple size="6" style="width:100%">${tables.map((t) => `<option value="${esc(t)}"${st.selectedTables.includes(t) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
    <h3>Columns</h3><div class="scroll" style="max-height:220px"><table class="grid" id="colTable"><thead><tr><th></th><th>Column</th><th>Alias</th><th>Aggregate</th><th>Display</th></tr></thead><tbody>
    ${cols.map(({ t, c }) => { const sel = st.selectedColumns.find((x) => x.table === t && x.column === c.name && !x.manualExpr); const k = `${t}.${c.name}`; return `<tr><td><input type="checkbox" data-col="${esc(k)}"${sel ? ' checked' : ''}></td><td>${esc(k)}${c.decode?.length ? ` <span class="small muted" title="${esc(decodeLegend(c))}">(decode)</span>` : ''}</td><td><input data-alias="${esc(k)}" value="${esc(sel?.alias || '')}" size="10"></td><td><select data-agg="${esc(k)}">${options(['', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX'], sel?.aggregate || '')}</select></td><td><select data-disp="${esc(k)}">${options(['raw', 'schema-decode'], sel?.displayMode || 'raw')}</select></td></tr>`; }).join('')}
    ${st.selectedColumns.filter((c) => c.manualExpr).map((c) => `<tr><td></td><td colspan="4"><code>${esc(c.manualExpr!)}</code></td></tr>`).join('')}</tbody></table></div>
    <h3>Filters</h3>${st.filters.map((f, i) => `<div class="row small"><code>${esc(`${i ? f.combinator + ' ' : ''}${f.table}.${f.column} ${f.operator} ${f.value}${f.value2 ? ` AND ${f.value2}` : ''}`)}</code><button data-rmf="${i}">✕</button></div>`).join('')}
    <div class="row"><select id="fCol">${options(cols.map(({ t, c }) => `${t}.${c.name}`), null)}</select><select id="fOp">${options(FILTER_OPERATORS, '=')}</select><input id="fVal" placeholder="value" size="10"><input id="fVal2" placeholder="and" size="6"><select id="fComb">${options(['AND', 'OR'], 'AND')}</select><button id="addFilter">Add</button></div>
    <h3>Sorting</h3>${st.sorts.map((so, i) => `<div class="row small"><code>${esc(`${so.expression || `${so.table}.${so.column}`} ${so.direction}`)}</code><button data-rms="${i}">✕</button></div>`).join('')}
    <div class="row"><select id="sCol">${options(cols.map(({ t, c }) => `${t}.${c.name}`), null)}</select><select id="sDir">${options(['ASC', 'DESC'], 'ASC')}</select><button id="addSort">Add</button></div>
    <h3>Joins</h3><p class="small muted">Joins between selected tables are generated automatically from the Active Schema relationships. Explicit join:</p>
    ${st.joins.map((j, i) => `<div class="row small"><code>${esc(`${j.joinType} ${j.table} ON ${j.onLeftTable}.${j.onLeftColumn} = ${j.table}.${j.onRightColumn}`)}</code><button data-rmj="${i}">✕</button></div>`).join('')}
    <div class="row"><select id="jLeft">${options(cols.map(({ t, c }) => `${t}.${c.name}`), null)}</select><select id="jType">${options(['INNER JOIN', 'LEFT JOIN'], 'INNER JOIN')}</select><select id="jRight">${options(s.tables.flatMap((t) => t.columns.map((c) => `${t.name}.${c.name}`)), null)}</select><button id="addJoin">Add</button></div>
  </div>
  <div class="card"><h2>Advanced Options</h2><p class="small muted">Inferred automatically from your description; any value you change here is marked <span class="manual-badge">manual</span> and takes precedence.</p>
    <label><input type="checkbox" id="advDistinct"${st.advanced.distinct ? ' checked' : ''}> DISTINCT${manual('distinct')}</label>
    <label for="advGroupBy">GROUP BY (comma-separated)${manual('groupBy')}</label><input id="advGroupBy" style="width:100%" value="${esc(st.advanced.groupByColumns.join(', '))}">
    <label for="advHaving">HAVING${manual('having')}</label><input id="advHaving" style="width:100%" value="${esc(st.advanced.havingClause)}">
    <div class="row"><div><label for="advLimit">Limit${manual('limit')}</label><input id="advLimit" type="number" min="1" value="${st.advanced.limit ?? ''}" size="6"></div>
    <div><label for="advJoinType">Join type${manual('joinType')}</label><select id="advJoinType">${options(['INNER JOIN', 'LEFT JOIN'], st.advanced.joinType || 'INNER JOIN')}</select></div></div>
    <label><input type="checkbox" id="advTableAliases"${st.advanced.tableAliases ? ' checked' : ''}> Table aliases${manual('tableAliases')}</label>
    <label><input type="checkbox" id="advRecursive"${st.advanced.recursive ? ' checked' : ''}> WITH RECURSIVE${manual('recursive')}</label>
    <h3>CTEs${manual('ctes')}</h3>${st.advanced.ctes.map((c, i) => `<div class="small"><code>${esc(c.name)} AS (${esc(c.body)})</code> <button data-rmcte="${i}">✕</button></div>`).join('')}
    <div class="row"><input id="cteName" placeholder="name" size="8"><input id="cteBody" placeholder="SELECT ..." class="grow"><button id="addCteBtn">Add CTE</button></div>
    <div class="row" style="margin-top:8px"><button id="applyAdvanced">Apply</button><button id="releaseManual">Return all options to automatic</button></div>
  </div></div>
  <div class="card"><div class="row"><h2 class="grow" style="margin:0">Generated SQL</h2><button id="regenerate">Rebuild from selections</button><button id="copySql">Copy</button><button class="primary" id="acceptSql">Accept (teach the model)</button></div>
    <textarea id="sqlOut" class="sql" style="min-height:140px;font-family:Consolas,monospace">${esc(st.generatedSql)}</textarea>
    ${v ? `<div class="issue-box ${v.valid && sv?.valid ? 'ok' : 'error'}" id="sqlValidation">${v.valid && sv?.valid ? 'SQL is read-only and valid against the Active Schema.' : `<ul>${[...v.issues.map((i) => `${i.severity}: ${i.message}`), ...(sv?.warnings || [])].map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`}</div>` : ''}
    ${st.generatedSql ? `<details><summary class="small">Optimization tips</summary><ul class="small">${optimizeSuggestions(st).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>` : ''}
  </div>`;
  bind(root);
}
function bind(root: HTMLElement): void {
  const rerender = () => renderReadOnly(root); const s = schemas.active(); const st = state.readOnly;
  root.querySelector('#nlGenerate')!.addEventListener('click', async () => {
    const text = val('nlText').trim(); if (!text) { toast('warning', 'Describe what you need first.'); return; }
    st.dialect = val('dialect') as Dialect;
    try { last = await generateFromDescription(text, st, s, st.dialect, learning, aiConfig.enabled ? { config: aiConfig, apiKey: secrets.aiApiKey } : null); state.readOnly = last.state; generatedBaseline = last.state.generatedSql; rerender(); }
    catch (e) { toast('error', `Offline model unable to process request: ${(e as Error).message}`); }
  });
  root.querySelector('#resetRo')!.addEventListener('click', () => { state.readOnly = emptyReadOnly(); advancedOverrides.clear(); last = null; rerender(); });
  root.querySelector('#dialect')!.addEventListener('change', () => { st.dialect = val('dialect') as Dialect; if (st.selectedTables.length) regen(); rerender(); });
  root.querySelector('#tableSelect')!.addEventListener('change', (e) => { st.selectedTables = Array.from((e.target as HTMLSelectElement).selectedOptions).map((o) => o.value); st.selectedColumns = st.selectedColumns.filter((c) => st.selectedTables.includes(c.table)); regen(); rerender(); });
  root.querySelectorAll<HTMLInputElement>('[data-col]').forEach((cb) => cb.addEventListener('change', () => {
    advancedOverrides.mark('columns'); const [t, c] = cb.dataset.col!.split('.');
    if (cb.checked) st.selectedColumns.push({ id: makeId('col'), table: t, column: c, alias: '', useDecode: false, aggregate: null, displayMode: 'raw' }); else st.selectedColumns = st.selectedColumns.filter((x) => !(x.table === t && x.column === c && !x.manualExpr));
    regen(); rerender();
  }));
  const colAttr = (attr: string, apply: (spec: typeof st.selectedColumns[number], v: string) => void) => root.querySelectorAll<HTMLInputElement>(`[${attr}]`).forEach((el) => el.addEventListener('change', () => { const [t, c] = el.getAttribute(attr)!.split('.'); const spec = st.selectedColumns.find((x) => x.table === t && x.column === c && !x.manualExpr); if (!spec) { toast('info', 'Tick the column first.'); return; } advancedOverrides.mark('columns'); apply(spec, el.value); regen(); rerender(); }));
  colAttr('data-alias', (sp, v) => { sp.alias = v.trim(); }); colAttr('data-agg', (sp, v) => { sp.aggregate = (v || null) as typeof sp.aggregate; }); colAttr('data-disp', (sp, v) => { sp.displayMode = v as typeof sp.displayMode; });
  root.querySelector('#addFilter')!.addEventListener('click', () => { const [t, c] = val('fCol').split('.'); const op = val('fOp') as FilterOperator; if (!t) return; if (requiresValue(op) && !val('fVal').trim()) { toast('warning', 'Enter a filter value.'); return; } if (requiresSecondValue(op) && !val('fVal2').trim()) { toast('warning', 'BETWEEN needs a second value.'); return; } st.filters.push({ id: makeId('filt'), table: t, column: c, operator: op, value: val('fVal').trim(), value2: val('fVal2').trim() || undefined, combinator: val('fComb') as 'AND' | 'OR' }); regen(); rerender(); });
  root.querySelectorAll<HTMLElement>('[data-rmf]').forEach((b) => b.addEventListener('click', () => { st.filters.splice(+b.dataset.rmf!, 1); regen(); rerender(); }));
  root.querySelector('#addSort')!.addEventListener('click', () => { const [t, c] = val('sCol').split('.'); if (!t) return; advancedOverrides.mark('sorts'); st.sorts.push({ id: makeId('sort'), table: t, column: c, direction: val('sDir') as 'ASC' | 'DESC' }); regen(); rerender(); });
  root.querySelectorAll<HTMLElement>('[data-rms]').forEach((b) => b.addEventListener('click', () => { advancedOverrides.mark('sorts'); st.sorts.splice(+b.dataset.rms!, 1); regen(); rerender(); }));
  root.querySelector('#addJoin')!.addEventListener('click', () => { const [lt, lc] = val('jLeft').split('.'); const [rt, rc] = val('jRight').split('.'); if (!lt || !rt) return; st.joins.push({ id: makeId('join'), table: rt, joinType: val('jType') as 'INNER JOIN', onLeftTable: lt, onLeftColumn: lc, onRightColumn: rc }); if (!st.selectedTables.includes(lt)) st.selectedTables.push(lt); regen(); rerender(); });
  root.querySelectorAll<HTMLElement>('[data-rmj]').forEach((b) => b.addEventListener('click', () => { st.joins.splice(+b.dataset.rmj!, 1); regen(); rerender(); }));
  Object.entries(ADVANCED_INPUT_KEYS).forEach(([id, key]) => root.querySelector(`#${id}`)?.addEventListener('change', () => advancedOverrides.mark(key)));
  root.querySelector('#applyAdvanced')!.addEventListener('click', () => {
    st.advanced.distinct = checked('advDistinct'); st.advanced.groupByColumns = val('advGroupBy').split(',').map((x) => x.trim()).filter(Boolean); st.advanced.havingClause = val('advHaving').trim();
    const lim = parseInt(val('advLimit'), 10); st.advanced.limit = Number.isFinite(lim) && lim > 0 ? lim : null; st.advanced.tableAliases = checked('advTableAliases'); st.advanced.recursive = checked('advRecursive'); st.advanced.joinType = val('advJoinType') as 'INNER JOIN' | 'LEFT JOIN';
    regen(); rerender();
  });
  root.querySelector('#releaseManual')!.addEventListener('click', () => { advancedOverrides.clear(); toast('info', 'All Advanced Options returned to automatic inference.'); rerender(); });
  root.querySelector('#addCteBtn')!.addEventListener('click', () => { if (!val('cteName').trim() || !val('cteBody').trim()) return; advancedOverrides.mark('ctes'); st.advanced.ctes.push({ id: makeId('cte'), name: val('cteName').trim(), body: val('cteBody').trim() }); regen(); rerender(); });
  root.querySelectorAll<HTMLElement>('[data-rmcte]').forEach((b) => b.addEventListener('click', () => { st.advanced.ctes.splice(+b.dataset.rmcte!, 1); regen(); rerender(); }));
  root.querySelector('#regenerate')!.addEventListener('click', () => { regen(); rerender(); });
  root.querySelector('#sqlOut')!.addEventListener('change', () => { st.generatedSql = val('sqlOut'); rerender(); });
  root.querySelector('#copySql')!.addEventListener('click', async () => { try { await navigator.clipboard.writeText(val('sqlOut')); toast('success', 'SQL copied.'); } catch { toast('warning', 'Clipboard is not available — select the SQL and copy it manually.'); } });
  root.querySelector('#acceptSql')!.addEventListener('click', () => {
    const finalSql = val('sqlOut'); const text = st.naturalLanguageText || val('nlText');
    const sv = validateSqlAgainstSchema(finalSql, s); if (!sv.valid) { toast('error', `Not learned — the SQL does not match the Active Schema: ${sv.warnings.join(' ')}`); return; }
    if (!text.trim()) { toast('info', 'Accepted. (No description to learn from.)'); return; }
    const ok = learning.confirm(text, s, finalSql, finalSql !== generatedBaseline ? finalSql : null) || !!learning.record({ schema: s, accepted: true, requestText: text, generatedSql: generatedBaseline, modifiedSql: finalSql !== generatedBaseline ? finalSql : null, finalSql, tables: st.selectedTables, columns: st.selectedColumns.filter((c) => !c.manualExpr).map((c) => ({ table: c.table, column: c.column })), filters: st.filters.map((f) => `${f.table}.${f.column} ${f.operator} ${f.value}`), joins: st.selectedTables.slice(1), sorts: st.sorts.filter((x) => !x.expression).map((x) => ({ table: x.table, column: x.column, direction: x.direction })), groupBy: st.advanced.groupByColumns, aggregation: [], distinct: st.advanced.distinct, limit: st.advanced.limit });
    toast(ok ? 'success' : 'warning', ok ? 'Accepted — this pattern will help future requests on this schema.' : 'Learned query knowledge could not be saved.');
  });
}
