import { state } from '../../state/store.js';
import { schemas, APP } from '../context.js';
import { esc, val, toast, options } from '../dom.js';
import { parseCrRequirement } from '../../engines/crNlpEngine.js';
import { buildCrSQL } from '../../engines/crEngine.js';
import { validateCrState } from '../../engines/validationEngine.js';
import { rectify } from '../../engines/errorRectifierEngine.js';
import { decodeLegend } from '../../engines/decodeEngine.js';
import { legacyLeftovers } from '../../v17/sync/schemaFormat.js';
import { makeId } from '../../utils/id.js';
export function renderQuickstart(root) {
    const s = schemas.active();
    root.innerHTML = `<h1>Welcome to ${esc(APP.name)}</h1><div class="card"><p>${esc(APP.name)} turns plain-English requirements into SQL using an <strong>offline natural-language model</strong> grounded in your Active Schema.</p>
  <ol><li>Pick or import a schema in <a href="#settings">Settings → Schema Management</a>. Active Schema: <strong>${esc(s.name)}</strong> (${s.tables.length} tables).</li>
  <li>Open the <a href="#readonly">Read Only Query Builder</a> and describe what you need.</li><li>Adjust with Manual Selectors / Advanced Options, then Accept to teach the model.</li>
  <li>Configure the GitHub repository in Settings → Secret Vault to synchronize schemas across devices.</li></ol></div>`;
}
export function renderAbout(root) { root.innerHTML = `<h1>About</h1><div class="card"><p><strong>${esc(APP.name)}</strong> version ${esc(APP.version)}</p><p class="small muted">Offline NLU · schema-aware learning · legacy schema migration · encrypted Secret Vault · optional AI/LLM Model.</p></div>`; }
export function renderSchemaUsed(root) {
    const s = schemas.active();
    const left = legacyLeftovers(s);
    root.innerHTML = `<h1>Schema Used</h1><div class="card"><div class="row"><strong>${esc(s.name)}</strong><span class="chip active">Active</span>${s.migration ? '<span class="chip migrated">Migrated from legacy format</span>' : '<span class="chip current">Current format</span>'}<span class="muted small">${s.tables.length} tables · ${s.tables.reduce((n, t) => n + t.columns.length, 0)} columns · ${s.relationships.length} relationships</span></div>
  ${left.unmappedLabels ? `<div class="issue-box">${left.unmappedLabels} legacy decode label(s) have no raw code yet (see Settings → Schema Management).</div>` : ''}
  <input id="schemaFilter" placeholder="Filter tables / columns" style="width:100%;margin:8px 0"><div class="scroll" style="max-height:600px"><table class="grid"><thead><tr><th>Table</th><th>Column</th><th>Type</th><th>Key</th><th>Decode</th><th>Description</th></tr></thead><tbody id="schemaRows">
  ${s.tables.flatMap((t) => t.columns.map((c) => `<tr data-k="${esc(`${t.name} ${c.name} ${c.description}`.toLowerCase())}"><td>${esc(t.name)}</td><td>${esc(c.name)}</td><td>${esc(c.type)}</td><td>${c.isPrimaryKey ? 'PK ' : ''}${c.isForeignKey && c.references ? `FK→${esc(c.references.table)}.${esc(c.references.column)}` : ''}${c.unresolvedReference ? `<span class="small muted">ref ${esc(c.unresolvedReference.table)}.${esc(c.unresolvedReference.column)} (outside schema)</span>` : ''}</td><td class="small">${esc(decodeLegend(c))}${c.unmappedDecodeLabels?.length ? ` <span class="chip legacy">${c.unmappedDecodeLabels.length} unmapped</span>` : ''}</td><td class="small">${esc(c.description)}</td></tr>`)).join('')}</tbody></table></div></div>`;
    root.querySelector('#schemaFilter').addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); root.querySelectorAll('#schemaRows tr').forEach((tr) => { tr.style.display = !q || tr.dataset.k.includes(q) ? '' : 'none'; }); });
}
export function renderErrorRectifier(root) {
    root.innerHTML = `<h1>Error Rectifier</h1><div class="card"><label for="errText">Database error message</label><textarea id="errText" placeholder="ORA-00904: &quot;X&quot;: invalid identifier"></textarea><label for="errSql">SQL</label><textarea id="errSql"></textarea><button class="primary" id="rectifyBtn">Rectify</button><div id="rectifyOut"></div></div>`;
    root.querySelector('#rectifyBtn').addEventListener('click', () => { const r = rectify(val('errText'), val('errSql')); root.querySelector('#rectifyOut').innerHTML = `<p>${esc(r.explanation)}</p><ul>${r.whatChanged.map((w) => `<li>${esc(w)}</li>`).join('')}</ul><pre class="sql">${esc(r.correctedSql)}</pre>`; });
}
export function renderCr(root) {
    const s = schemas.active();
    const st = state.cr;
    const t = s.tables.find((x) => x.name === st.table);
    const issues = st.generatedSql ? validateCrState(st) : [];
    root.innerHTML = `<h1>Query Builder for CR</h1><div class="card"><label for="crText">Describe the change</label><textarea id="crText">${esc(st.naturalLanguageText)}</textarea><button id="crParse">Interpret</button></div>
  <div class="card"><div class="row"><div><label>Statement</label><select id="crType">${options(['INSERT', 'UPDATE', 'DELETE'], st.queryType)}</select></div><div><label>Table</label><select id="crTable"><option value=""></option>${options(s.tables.map((x) => x.name), st.table)}</select></div></div>
  <h3>Values</h3>${st.values.map((v, i) => `<div class="row small"><code>${esc(v.column)} = ${esc(v.value)}</code><button data-rmv="${i}">✕</button></div>`).join('')}
  <div class="row"><select id="crCol">${options(t?.columns.map((c) => c.name) || [], null)}</select><input id="crVal" placeholder="value"><button id="crAddVal">Add</button></div>
  <h3>WHERE</h3>${st.filters.map((f, i) => `<div class="row small"><code>${esc(`${f.table}.${f.column} ${f.operator} ${f.value}`)}</code><button data-rmw="${i}">✕</button></div>`).join('')}
  <div class="row"><select id="crWCol">${options(t?.columns.map((c) => c.name) || [], null)}</select><input id="crWVal" placeholder="value"><button id="crAddWhere">Add</button></div>
  <label><input type="checkbox" id="crNoWhere"${st.confirmNoWhere ? ' checked' : ''}> I confirm this statement has no WHERE condition</label>
  <button class="primary" id="crBuild">Build SQL</button><pre class="sql" id="crSql">${esc(st.generatedSql)}</pre>${issues.length ? `<div class="issue-box error"><ul>${issues.map((i) => `<li>${esc(i.message)}</li>`).join('')}</ul></div>` : ''}</div>`;
    const re = () => renderCr(root);
    root.querySelector('#crParse').addEventListener('click', () => { const r = parseCrRequirement(val('crText'), s); st.naturalLanguageText = val('crText'); if (r.queryType)
        st.queryType = r.queryType; if (r.matchedTable)
        st.table = r.matchedTable; st.values = r.values; st.filters = r.filters; toast('info', r.notes.join(' ')); re(); });
    root.querySelector('#crType').addEventListener('change', () => { st.queryType = val('crType'); re(); });
    root.querySelector('#crTable').addEventListener('change', () => { st.table = val('crTable') || null; st.values = []; st.filters = []; re(); });
    root.querySelector('#crAddVal').addEventListener('click', () => { if (val('crCol')) {
        st.values.push({ id: makeId('crv'), column: val('crCol'), value: val('crVal') });
        re();
    } });
    root.querySelector('#crAddWhere').addEventListener('click', () => { if (val('crWCol') && st.table) {
        st.filters.push({ id: makeId('f'), table: st.table, column: val('crWCol'), operator: '=', value: val('crWVal'), combinator: 'AND' });
        re();
    } });
    root.querySelectorAll('[data-rmv]').forEach((b) => b.addEventListener('click', () => { st.values.splice(+b.dataset.rmv, 1); re(); }));
    root.querySelectorAll('[data-rmw]').forEach((b) => b.addEventListener('click', () => { st.filters.splice(+b.dataset.rmw, 1); re(); }));
    root.querySelector('#crNoWhere').addEventListener('change', (e) => { st.confirmNoWhere = e.target.checked; });
    root.querySelector('#crBuild').addEventListener('click', () => { st.generatedSql = buildCrSQL(st).sql; st.lastGeneratedAt = new Date().toISOString(); re(); });
}
//# sourceMappingURL=other.js.map