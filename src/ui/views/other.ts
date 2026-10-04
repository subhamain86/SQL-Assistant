/** Quick Start, Query Builder for CR, Used Schema, Update Schema, Error Rectifier, About, schema status strips. */
import type { CrQueryState, Dialect, SchemaModel } from '../../types';
import { services, APP, secrets } from '../context';
import { $, esc, val, on, toast, options, highlightSql, modal } from '../dom';
import { buildCrSQL, parseCrDescription } from '../../engines/crEngine';
import { validateCrState } from '../../engines/validationEngine';
import { rectify } from '../../engines/errorRectifierEngine';
import { legacyLeftovers, summarizeMigration, normalizeSchema } from '../../v17/sync/schemaFormat';
import { EXAMPLES } from '../../data/defaultSchemas';
import { downloadBlob } from '../../utils/dom';
import { makeId } from '../../utils/id';
import { filterRowsHtml, bindFilterRows, later } from './builder';
import { NLU_ENGINE_VERSION } from '../../v17/engines/nluEngine';
const active = (): SchemaModel => services().schemas.active();
export function renderStrips(): void {
  const s = active(); const m = services().sync.meta(); const l = legacyLeftovers(s);
  const level = !secrets.githubToken ? 'level-warn' : m.lastPullAt ? 'level-ok' : 'level-checking';
  const html = `<i class="bi bi-hdd-stack-fill"></i><span>Active Schema: <strong>${esc(s.name)}</strong> · ${s.tables.length} tables</span>${s.migration ? '<span class="badge text-bg-info-subtle text-info-emphasis">Migrated from legacy format</span>' : ''}${l.unmappedLabels ? `<span class="badge text-bg-warning-subtle text-warning-emphasis">${l.unmappedLabels} decode label(s) without code</span>` : ''}<span class="ms-auto text-body-secondary">${secrets.githubToken ? `Repository sync: ${m.lastPullAt ? `last download ${esc(m.lastPullAt.replace('T', ' ').slice(0, 16))}` : 'not synchronized yet'}` : 'Repository sync not configured'} · <a href="#settings/schema-management">Schema Management</a></span>`;
  document.querySelectorAll<HTMLElement>('.shared-schema-strip').forEach((el) => { el.className = `shared-schema-strip ${level}`; el.innerHTML = html; });
  $('navActiveSchema').textContent = `Active Schema: ${s.name}`;
}
export function renderQuickstart(): void {
  const s = active(); const counts = new Map<string, number>(); s.tables.forEach((t) => counts.set(t.module, (counts.get(t.module) || 0) + 1));
  $('qsModuleChips').innerHTML = [...counts].map(([m, n]) => `<span class="badge rounded-pill text-bg-primary">${esc(m)} · ${n}</span>`).join('');
  const ex = s.id === 'schema-core-ap-p2p' ? EXAMPLES : [{ title: `Rows from ${s.tables[0]?.name}`, text: `show ${s.tables[0]?.name.toLowerCase().replace(/_/g, ' ')}` }, ...(s.tables[1] ? [{ title: `Count per ${s.tables[1].name}`, text: `count of ${s.tables[0].name.toLowerCase().replace(/_/g, ' ')} per ${s.tables[1].name.toLowerCase().replace(/_/g, ' ')}` }] : [])];
  $('qsExampleGrid').innerHTML = ex.map((e, i) => `<div class="col"><div class="card h-100"><div class="card-body"><div class="small fw-semibold">${esc(e.title)}</div><div class="small text-body-secondary mb-2">“${esc(e.text)}”</div><button class="btn btn-outline-primary btn-sm" data-example="${i}" type="button"><i class="bi bi-play-fill me-1"></i>Try it</button></div></div></div>`).join('');
  document.querySelectorAll<HTMLElement>('[data-example]').forEach((b) => b.addEventListener('click', () => { location.hash = '#builder'; setTimeout(() => window.dispatchEvent(new CustomEvent('sqla:example', { detail: ex[+b.dataset.example!].text })), 0); }));
}
// ── Query Builder for CR ──
const cr: CrQueryState = { dialect: 'Oracle', naturalLanguageText: '', queryType: 'INSERT', table: null, values: [], filters: [], confirmNoWhere: false, generatedSql: '' };
export function renderCr(): void {
  const s = active(); if (cr.table && !s.tables.some((t) => t.name === cr.table)) { cr.table = null; cr.values = []; cr.filters = []; }
  document.querySelectorAll<HTMLElement>('#crCommandSelector [data-command]').forEach((b) => b.classList.toggle('active', b.dataset.command === cr.queryType));
  $<HTMLSelectElement>('crTableSelect').innerHTML = `<option value="">— choose a table —</option>${options(s.tables.map((t) => t.name), cr.table)}`;
  const t = s.tables.find((x) => x.name === cr.table);
  $('crColumnsBody').innerHTML = cr.queryType === 'DELETE' ? '<p class="small text-body-secondary mb-0">DELETE does not set column values.</p>' : t ? t.columns.map((c) => { const v = cr.values.find((x) => x.column === c.name);
    return `<div class="d-flex gap-2 align-items-center mb-1"><input class="form-check-input" type="checkbox" data-crcol="${esc(c.name)}"${v ? ' checked' : ''}><span class="small flex-grow-1">${esc(c.name)}</span>${c.decode?.length ? `<select class="form-select form-select-sm w-auto" data-crval="${esc(c.name)}"><option value=""></option>${c.decode.map((d) => `<option value="${esc(d.rawValue)}"${v?.value === d.rawValue ? ' selected' : ''}>${esc(d.label)} (${esc(d.rawValue)})</option>`).join('')}</select>` : `<input class="form-control form-control-sm w-auto" style="max-width:140px" data-crval="${esc(c.name)}" value="${esc(v?.value || '')}" placeholder="value">`}</div>`; }).join('') : '<p class="small text-body-secondary mb-0">Pick a table first.</p>';
  const cols = t ? t.columns.map((c) => `${t.name}.${c.name}`) : []; const fg = $('crFilterGroup'); fg.innerHTML = filterRowsHtml(cr.filters, cols, 'cr'); bindFilterRows(fg, cr.filters, 'cr', later(renderCr));
  $('crWherePanel').classList.toggle('d-none', cr.queryType === 'INSERT'); $('crWhereRequiredWarning').classList.toggle('d-none', !(cr.queryType !== 'INSERT' && !cr.filters.length && !cr.confirmNoWhere));
  $<HTMLInputElement>('crAllowNoWhere').checked = cr.confirmNoWhere;
  const issues = cr.generatedSql ? validateCrState(cr) : [];
  $('crResultBody').innerHTML = cr.generatedSql ? `<pre class="sql-output" id="crSqlOutput">${highlightSql(cr.generatedSql)}</pre>${issues.length ? `<div class="small text-danger mt-2">${esc(issues.map((i) => i.message).join(' '))}</div>` : '<div class="small text-success mt-2"><i class="bi bi-shield-check me-1"></i>Generated for review only — not executed.</div>'}` : '<p class="text-body-secondary small mb-0">Choose a query type, select a table, and click Build Query.</p>';
  $('crCopyBtn').classList.toggle('d-none', !cr.generatedSql || cr.generatedSql.startsWith('--'));
}
export function bindCr(): void {
  document.querySelectorAll<HTMLElement>('#crCommandSelector [data-command]').forEach((b) => b.addEventListener('click', () => { cr.queryType = b.dataset.command as CrQueryState['queryType']; cr.generatedSql = ''; renderCr(); }));
  on('crTableSelect', 'change', () => { cr.table = val('crTableSelect') || null; cr.values = []; cr.filters = []; cr.generatedSql = ''; later(renderCr)(); });
  $('crColumnsBody').addEventListener('change', (e) => { const el = e.target as HTMLInputElement; const c = el.dataset.crcol || el.dataset.crval; if (!c) return; let v = cr.values.find((x) => x.column === c);
    if (el.dataset.crcol) { if (el.checked && !v) cr.values.push({ id: makeId('v'), column: c, value: '' }); if (!el.checked) cr.values = cr.values.filter((x) => x.column !== c); } else { if (!v) { v = { id: makeId('v'), column: c, value: '' }; cr.values.push(v); } v.value = el.value; } later(renderCr)(); });
  on('crAddFilterBtn', 'click', () => { const t = active().tables.find((x) => x.name === cr.table); if (!t) { toast('info', 'Pick a table first.'); return; } cr.filters.push({ id: makeId('f'), table: t.name, column: (t.columns.find((c) => c.isPrimaryKey) || t.columns[0]).name, operator: '=', value: '', combinator: 'AND' }); renderCr(); });
  on('crClearFiltersBtn', 'click', () => { cr.filters = []; renderCr(); }); on('crAllowNoWhere', 'change', () => { cr.confirmNoWhere = (document.getElementById('crAllowNoWhere') as HTMLInputElement).checked; later(renderCr)(); });
  on('crDialectSel', 'change', () => { cr.dialect = val('crDialectSel') as Dialect; });
  on('crBuildBtn', 'click', () => { cr.generatedSql = buildCrSQL(cr); renderCr(); });
  on('crGenerateFromDescriptionBtn', 'click', () => { const text = val('crDescriptionInput').trim(); if (text) { const r = parseCrDescription(text, active()); cr.naturalLanguageText = text; if (r.queryType) cr.queryType = r.queryType; if (r.table) { cr.table = r.table; cr.values = r.values; cr.filters = r.filters; }
      $('crDescriptionInterpretationBox').innerHTML = `${r.notes.map((n) => esc(n)).join('<br>')}${r.values.length ? `<br>SET: ${esc(r.values.map((v) => `${v.column} = ${v.value}`).join(', '))}` : ''}${r.filters.length ? `<br>WHERE: ${esc(r.filters.map((f) => `${f.column} ${f.operator} ${f.value}`).join(' AND '))}` : ''}`; }
    cr.generatedSql = buildCrSQL(cr); renderCr(); });
  on('crCopyBtn', 'click', async () => { try { await navigator.clipboard.writeText(cr.generatedSql); toast('success', 'SQL copied to the clipboard.'); } catch { toast('warning', 'Clipboard is not available.'); } });
}
// ── Used Schema ──
export function renderUsedSchema(): void {
  const s = active(); const cols = s.tables.reduce((n, t) => n + t.columns.length, 0); const l = legacyLeftovers(s);
  const card = (label: string, v: string | number, color: string) => `<div class="col-6 col-md-3"><div class="card"><div class="card-body py-2"><div class="small text-body-secondary">${label}</div><div class="h5 mb-0 text-${color}">${esc(v)}</div></div></div></div>`;
  $('usedSchemaSummary').innerHTML = card('Schema', s.name, 'primary') + card('Tables', s.tables.length, 'body') + card('Columns', cols, 'body') + card('Relationships', s.relationships.length + s.tables.reduce((n, t) => n + t.columns.filter((c) => c.isForeignKey).length, 0), 'body') + (l.unmappedLabels ? card('Decode labels without code', l.unmappedLabels, 'warning') : '');
  const q = val('schemaSearchInput').toLowerCase(); let shown = 0;
  $('schemaTree').innerHTML = s.tables.map((t) => { const cs = t.columns.filter((c) => !q || `${t.name} ${c.name} ${c.alias || ''} ${c.description} ${t.description}`.toLowerCase().includes(q)); if (!cs.length) return ''; shown++;
    return `<details class="card mb-2"${q ? ' open' : ''}><summary class="card-body py-2"><strong>${esc(t.name)}</strong> <span class="small text-body-secondary">${esc(t.module)} · ${t.columns.length} columns — ${esc(t.description)}</span></summary><div class="px-3 pb-2"><table class="table table-sm small mb-0"><thead><tr><th>Column</th><th>Type</th><th>Key</th><th>Decode</th><th>Description</th></tr></thead><tbody>${cs.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.type)}${c.length ? `(${c.length})` : ''}</td><td>${c.isPrimaryKey ? '<span class="badge text-bg-primary">PK</span> ' : ''}${c.references ? `<span class="badge text-bg-secondary">FK → ${esc(c.references.table)}.${esc(c.references.column)}</span>` : ''}${c.unresolvedReference ? `<span class="small text-body-secondary">ref ${esc(c.unresolvedReference.table)} (outside schema)</span>` : ''}</td><td>${esc((c.decode || []).map((d) => `${d.rawValue}=${d.label}`).join(', '))}${c.unmappedDecodeLabels?.length ? ` <span class="badge text-bg-warning-subtle text-warning-emphasis">${c.unmappedDecodeLabels.length} without code</span>` : ''}</td><td>${esc(c.description)}</td></tr>`).join('')}</tbody></table></div></details>`; }).join('') || '<div class="alert alert-secondary py-2">No tables or columns match your search.</div>';
  $('schemaSearchResultCount').textContent = q ? `${shown} table(s) match “${q}”.` : '';
}
// ── Update Schema ──
function csvToSchema(text: string): unknown {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let qd = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i]; if (qd) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') qd = false; else cell += ch; } else if (ch === '"') qd = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...data] = rows.filter((r) => r.some((x) => x.trim())); const ix = (n: string) => head.findIndex((h) => h.trim().toLowerCase() === n.toLowerCase());
  const tables = new Map<string, { name: string; module: string; description: string; columns: unknown[] }>();
  data.forEach((r) => { const tn = r[ix('Table Name')]?.trim(); if (!tn) return; if (!tables.has(tn)) tables.set(tn, { name: tn, module: r[ix('Module')] || 'General', description: r[ix('Table Description')] || '', columns: [] });
    const fk = (r[ix('Foreign Key')] || '').trim(); const [ft, fc] = fk.split('.'); const dec = (r[ix('Decode')] || '').split(/[;|]/).map((x) => x.trim()).filter(Boolean).map((p) => { const [a, ...b] = p.split('='); return { code: a.trim(), label: b.join('=').trim() || a.trim() }; });
    tables.get(tn)!.columns.push({ name: r[ix('Column Name')], description: r[ix('Column Description')] || '', type: r[ix('Data Type')], length: r[ix('Length')] || undefined, precision: r[ix('Precision')] || undefined, nullable: !/^(n|no|false|0)$/i.test(r[ix('Nullable')] || 'Y'), alias: r[ix('Alias')] || '', primary_key: /^(y|yes|true|1)$/i.test(r[ix('Primary Key')] || ''), ...(fk && fc ? { foreign_key: { table: ft, column: fc } } : {}), ...(dec.length ? { decode: dec } : {}) }); });
  return { name: '', tables: [...tables.values()] };
}
export function bindUpdateSchema(): void {
  on('downloadCurrentJsonBtn', 'click', () => downloadBlob(`${active().name.replace(/\W+/g, '_')}.json`, JSON.stringify(active(), null, 2), 'application/json'));
  on('downloadCurrentCsvBtn', 'click', () => { const s = active(); const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`; const lines = ['Module,Table Name,Table Description,Column Name,Column Description,Data Type,Length,Precision,Nullable,Alias,Decode,Primary Key,Foreign Key', ...s.tables.flatMap((t) => t.columns.map((c) => [t.module, t.name, t.description, c.name, c.description, c.type, c.length ?? '', c.precision ?? '', c.nullable ? 'Y' : 'N', c.alias ?? '', (c.decode || []).map((d) => `${d.rawValue}=${d.label}`).join(';'), c.isPrimaryKey ? 'Y' : 'N', c.references ? `${c.references.table}.${c.references.column}` : ''].map(q).join(',')))]; downloadBlob(`${s.name.replace(/\W+/g, '_')}.csv`, lines.join('\n'), 'text/csv'); });
  on('toggleExpectedStructureBtn', 'click', () => $('expectedStructureBox').classList.toggle('d-none'));
  on('updateSchemaProcessBtn', 'click', async () => { const f = $<HTMLInputElement>('updateSchemaFileInput').files?.[0]; if (!f) { toast('warning', 'Choose a schema file first.'); return; }
    let text = await f.text(); if (/\.csv$/i.test(f.name)) text = JSON.stringify(csvToSchema(text));
    const r = services().schemas.importSchemaJson(text, val('importSchemaName') || f.name.replace(/\.(json|csv)$/i, ''));
    $('updateSchemaResult').innerHTML = r.ok ? `<div class="alert alert-success py-2 small mb-0"><strong>Imported “${esc(r.schema!.name)}”</strong> (${r.schema!.tables.length} tables). It is saved and validated; activate it in <a href="#settings/schema-management">Schema Management</a>.${r.summary.length ? `<ul class="mb-0">${r.summary.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>` : `<div class="alert alert-danger py-2 small mb-0">${r.errors.map((e) => `${esc(e.message)}${e.details?.length ? `<ul class="mb-0">${e.details.slice(0, 10).map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}`).join('')}</div>`; });
  on('deleteSchemaBtn', 'click', () => { const s = active(); if (!confirm(`Delete schema "${s.name}" from this device? A backup is downloaded first.`)) return; downloadBlob('schema-backup-before-delete.json', JSON.stringify(s, null, 2), 'application/json'); const r = services().schemas.deleteSchema(s.id); toast(r.ok ? 'success' : 'error', r.ok ? 'Schema deleted from this device.' : r.errors.map((e) => e.message).join(' ')); });
}
export function renderUpdateSchema(): void { const d = services().schemas.loadDiagnostics; $('schemaPersistenceStatus').innerHTML = `<div class="alert ${services().store.persistent ? 'alert-success' : 'alert-warning'} py-2 small mb-0"><i class="bi bi-hdd me-1"></i>${services().store.persistent ? `Schemas are saved in this browser (${services().schemas.schemas().length} schema(s)).` : 'Browser storage is unavailable — changes are kept for this session only.'}${d.unreadable ? ` Stored data could not be read (${esc(d.unreadable)}); a backup was kept as ${esc(d.backupKey || '')}.` : ''}</div>`; void normalizeSchema; void summarizeMigration; }
// ── Error Rectifier ──
export function bindErrorRectifier(): void {
  on('errRectifyBtn', 'click', () => { const r = rectify(val('errErrorInput'), val('errSqlInput')); if (r.dialect) $<HTMLSelectElement>('errDialectSel').value = r.dialect;
    $('errRectifiedSqlBody').innerHTML = val('errSqlInput').trim() ? `<pre class="sql-output" id="errRectifiedSql">${highlightSql(r.correctedSql)}</pre>` : '<p class="small text-danger mb-0">Paste the SQL that produced the error.</p>';
    $('errExplanationBody').innerHTML = `<p class="small mb-1">${esc(r.explanation)}</p><div class="result-section-title">What Changed</div><ul class="small mb-0">${r.whatChanged.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`; });
}
export function showAbout(): void {
  const s = active(); $('aboutList').innerHTML = [['Application', APP.name], ['Version', APP.version], ['Primary engine', `Offline NLU (${NLU_ENGINE_VERSION})`], ['Active Schema', `${s.name} (${s.tables.length} tables)`], ['Schema file', secrets.schemaPath], ['Created by', 'Subham Ain']].map(([a, b]) => `<li class="list-group-item d-flex justify-content-between"><span class="text-body-secondary">${esc(a)}</span><strong>${esc(b)}</strong></li>`).join('');
  modal('aboutModal').show();
}
