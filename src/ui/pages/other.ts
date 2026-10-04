import { state } from '../../state/store';
import { services, APP } from '../context';
import { esc, val, toast, options } from '../dom';
import { buildCrSQL, parseCr } from '../../engines/crEngine';
import { validateCrState } from '../../engines/validationEngine';
import { rectify } from '../../engines/errorRectifierEngine';
import { decodeLegend } from '../../engines/decodeEngine';
import { legacyLeftovers } from '../../v17/sync/schemaFormat';
import { makeId } from '../../utils/id';
import type { CrQueryType } from '../../types';
export function renderQuickstart(root: HTMLElement): void { const s = services().schemas.active(); root.innerHTML = `<h1>Welcome to ${esc(APP.name)}</h1><div class="card"><p>${esc(APP.name)} turns plain-English requirements into SQL with an <strong>offline natural-language model</strong> grounded in your Active Schema.</p><ol><li>Pick or import a schema in <a href="#settings">Settings → Schema Management</a>. Active Schema: <strong id="qsActive">${esc(s.name)}</strong> (${s.tables.length} tables).</li><li>Open the <a href="#readonly">Read Only Query Builder</a> and describe what you need.</li><li>Adjust with Manual Selectors / Advanced Options, then Accept to teach the model.</li></ol></div>`; }
export function renderAbout(root: HTMLElement): void { root.innerHTML = `<h1>About</h1><div class="card"><p><strong>${esc(APP.name)}</strong> version ${esc(APP.version)}</p><p class="small muted">Offline NLU · schema-aware learning · legacy schema migration · encrypted Secret Vault · optional AI/LLM Model.</p></div>`; }
export function renderSchemaUsed(root: HTMLElement): void {
  const s = services().schemas.active(); const l = legacyLeftovers(s);
  root.innerHTML = `<h1>Schema Used</h1><div class="card"><div class="row"><strong>${esc(s.name)}</strong><span class="chip active">Active</span>${s.migration ? '<span class="chip migrated">Migrated from legacy format</span>' : '<span class="chip current">Current format</span>'}<span class="muted small">${s.tables.length} tables · ${s.tables.reduce((n, t) => n + t.columns.length, 0)} columns</span></div>${l.unmappedLabels ? `<div class="issue-box">${l.unmappedLabels} legacy decode label(s) have no raw code yet.</div>` : ''}
  <input id="schemaFilter" placeholder="Filter tables / columns" style="width:100%;margin:8px 0"><div class="scroll" style="max-height:600px"><table class="grid"><thead><tr><th>Table</th><th>Column</th><th>Type</th><th>Key</th><th>Decode</th></tr></thead><tbody id="schemaRows">${s.tables.flatMap((t) => t.columns.map((c) => `<tr data-k="${esc(`${t.name} ${c.name}`.toLowerCase())}"><td>${esc(t.name)}</td><td>${esc(c.name)}</td><td>${esc(c.type)}</td><td>${c.isPrimaryKey ? 'PK ' : ''}${c.references ? `FK→${esc(c.references.table)}` : ''}</td><td class="small">${esc(decodeLegend(c))}</td></tr>`)).join('')}</tbody></table></div></div>`;
  root.querySelector('#schemaFilter')!.addEventListener('input', (e) => { const q = (e.target as HTMLInputElement).value.toLowerCase(); root.querySelectorAll<HTMLElement>('#schemaRows tr').forEach((tr) => { tr.style.display = !q || tr.dataset.k!.includes(q) ? '' : 'none'; }); });
}
export function renderErrorRectifier(root: HTMLElement): void { root.innerHTML = `<h1>Error Rectifier</h1><div class="card"><label for="errText">Database error message</label><textarea id="errText"></textarea><label for="errSql">SQL</label><textarea id="errSql"></textarea><button class="primary" id="rectifyBtn">Rectify</button><div id="rectifyOut"></div></div>`; root.querySelector('#rectifyBtn')!.addEventListener('click', () => { const r = rectify(val('errText'), val('errSql')); root.querySelector('#rectifyOut')!.innerHTML = `<p>${esc(r.explanation)}</p><ul>${r.whatChanged.map((w) => `<li>${esc(w)}</li>`).join('')}</ul><pre class="sql">${esc(r.correctedSql)}</pre>`; }); }
export function renderCr(root: HTMLElement): void {
  const s = services().schemas.active(); const st = state.cr; if (st.table && !s.tables.some((t) => t.name === st.table)) st.table = null; const t = s.tables.find((x) => x.name === st.table); const issues = st.generatedSql ? validateCrState(st) : [];
  root.innerHTML = `<h1>Query Builder for CR</h1><div class="card"><label for="crText">Describe the change</label><textarea id="crText">${esc(st.naturalLanguageText)}</textarea><button id="crParse">Interpret</button></div>
  <div class="card"><div class="row"><select id="crType">${options(['INSERT', 'UPDATE', 'DELETE'], st.queryType)}</select><select id="crTable"><option value=""></option>${options(s.tables.map((x) => x.name), st.table)}</select></div>
  <h3>Values</h3>${st.values.map((v) => `<div class="small"><code>${esc(v.column)} = ${esc(v.value)}</code></div>`).join('')}<div class="row"><select id="crCol">${options(t?.columns.map((c) => c.name) || [], null)}</select><input id="crVal"><button id="crAddVal">Add</button></div>
  <h3>WHERE</h3>${st.filters.map((f) => `<div class="small"><code>${esc(`${f.table}.${f.column} ${f.operator} ${f.value}`)}</code></div>`).join('')}<div class="row"><select id="crWCol">${options(t?.columns.map((c) => c.name) || [], null)}</select><input id="crWVal"><button id="crAddWhere">Add</button></div>
  <label><input type="checkbox" id="crNoWhere"${st.confirmNoWhere ? ' checked' : ''}> I confirm this statement has no WHERE condition</label><button class="primary" id="crBuild">Build SQL</button><pre class="sql" id="crSql">${esc(st.generatedSql)}</pre>${issues.length ? `<div class="issue-box error"><ul>${issues.map((i) => `<li>${esc(i.message)}</li>`).join('')}</ul></div>` : ''}</div>`;
  const re = () => renderCr(root);
  root.querySelector('#crParse')!.addEventListener('click', () => { const r = parseCr(val('crText'), s.tables.map((x) => x.name)); st.naturalLanguageText = val('crText'); if (r.queryType) st.queryType = r.queryType; if (r.table) st.table = r.table; toast('info', r.queryType ? `Detected ${r.queryType}${r.table ? ` on ${r.table}` : ''}.` : 'Could not determine INSERT, UPDATE or DELETE.'); re(); });
  root.querySelector('#crType')!.addEventListener('change', () => { st.queryType = val('crType') as CrQueryType; re(); });
  root.querySelector('#crTable')!.addEventListener('change', () => { st.table = val('crTable') || null; st.values = []; st.filters = []; re(); });
  root.querySelector('#crAddVal')!.addEventListener('click', () => { if (val('crCol')) { st.values.push({ id: makeId('v'), column: val('crCol'), value: val('crVal') }); re(); } });
  root.querySelector('#crAddWhere')!.addEventListener('click', () => { if (val('crWCol') && st.table) { st.filters.push({ id: makeId('f'), table: st.table, column: val('crWCol'), operator: '=', value: val('crWVal'), combinator: 'AND' }); re(); } });
  root.querySelector('#crNoWhere')!.addEventListener('change', (e) => { st.confirmNoWhere = (e.target as HTMLInputElement).checked; });
  root.querySelector('#crBuild')!.addEventListener('click', () => { st.generatedSql = buildCrSQL(st); re(); });
}
