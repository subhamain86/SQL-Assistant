import { icon } from '../components/icons';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { renderDataTable } from '../components/dataTable';
import { openModal } from '../components/modal';
import { verifyPassword } from '../services/passwordService';
import { syncService } from '../services/syncService';
import { secretVaultService } from '../services/secretVaultService';
import { v17DataTypeOptionsHtml, v17DeleteRowWithDependencyCheck } from '../v17/integration';
import { validateRecordFields, analyzeDependencies } from '../v17/engines/schemaRecordEngine';
import { escapeHtml as e } from '../utils/dom';
import type { SchemaEditorRow, ColumnDataType } from '../types';
const issues = (list: string[]) => `<div class="issue-box mini">${icon('alert-triangle', 14)}<ul>${list.map((m) => `<li>${e(m)}</li>`).join('')}</ul></div>`;
export function renderSchemaEditorSection(container: HTMLElement): void {
  let editingSchemaId = schemaService.getActiveSchema().id; let selModule: string | null = null; let selTable: string | null = null;
  let tableApi: ReturnType<typeof renderDataTable<SchemaEditorRow>> | null = null;
  function draw(): void {
    const all = schemaService.getAllSchemas(); const sch = schemaService.getSchemaById(editingSchemaId) || all[0]; editingSchemaId = sch.id;
    const modules = schemaService.getModulesForSchema(editingSchemaId); if (selModule && !modules.includes(selModule)) { selModule = null; selTable = null; }
    const tables = selModule ? schemaService.getTablesForModule(editingSchemaId, selModule) : []; if (selTable && !tables.some((t) => t.name === selTable)) selTable = null;
    container.innerHTML = `<label class="block-label">Select Schema<select id="editorSchemaSelect">${all.map((s) => `<option value="${s.id}" ${s.id === sch.id ? 'selected' : ''}>${e(s.name)}${s.status === 'active' ? ' (Active)' : ''}</option>`).join('')}</select></label>
    <div class="editing-schema-banner">${icon('edit', 14)} Editing Schema: <strong>${e(sch.name)}</strong> ${sch.status === 'active' ? '<span class="chip chip-active">Active — changes apply immediately</span>' : '<span class="chip chip-inactive">Inactive — activate it from Schema to use these changes</span>'} <span class="auto-sync-hint">${icon('folder-sync', 12)} Saved to the central schema registry; synchronizes automatically once the Secret Vault is unlocked</span><button type="button" id="syncNowInlineBtn" class="btn btn-outline btn-sm sync-now-inline-btn">${icon('github', 13)} Sync Now</button></div><div id="syncNowInlineResult"></div>
    <div class="form-row-2"><label class="block-label">Select Module *<select id="editorModuleSelect"><option value="">— choose a module —</option>${modules.map((m) => `<option ${m === selModule ? 'selected' : ''}>${e(m)}</option>`).join('')}</select></label><label class="block-label">Select Table *<select id="editorTableSelect" ${selModule ? '' : 'disabled'}><option value="">— choose a table —</option>${tables.map((t) => `<option value="${e(t.name)}" ${t.name === selTable ? 'selected' : ''}>${e(t.name)}${t.objectType === 'VIEW' ? ' (View)' : ''}</option>`).join('')}</select></label></div>
    ${selTable ? `<div class="row-actions"><button type="button" id="addRowBtn" class="btn btn-primary btn-sm">${icon('plus', 14)} Add New Row</button><div id="rowActionsBar" class="row-actions" style="margin-top:0" hidden><span id="selectedRowLabel" class="hint"></span><button type="button" id="editRowBtn" class="btn btn-outline btn-sm">${icon('edit', 14)} Edit</button><button type="button" id="deleteRowBtn" class="btn btn-outline btn-sm">${icon('trash', 14)} Delete</button></div></div><div id="dataTableMount" class="mt"></div>` : '<p class="hint mt">Select a Module, then a Table, to populate its schema data below.</p>'}`;
    container.querySelector('#editorSchemaSelect')!.addEventListener('change', (ev) => { editingSchemaId = (ev.target as HTMLSelectElement).value; selModule = null; selTable = null; draw(); });
    container.querySelector('#editorModuleSelect')!.addEventListener('change', (ev) => { selModule = (ev.target as HTMLSelectElement).value || null; selTable = null; draw(); });
    container.querySelector('#editorTableSelect')!.addEventListener('change', (ev) => { selTable = (ev.target as HTMLSelectElement).value || null; draw(); });
    container.querySelector('#addRowBtn')?.addEventListener('click', () => openRowForm(null));
    container.querySelector('#syncNowInlineBtn')!.addEventListener('click', async () => { const m = container.querySelector<HTMLElement>('#syncNowInlineResult')!; if (!secretVaultService.isUnlocked()) { m.innerHTML = issues(['The Secret Vault is locked — unlock Settings with the Admin Password first.']); return; } m.innerHTML = '<p class="hint">Syncing…</p>'; const r = await syncService.pushRegistryToGitHub(`Update ${sch.name} via Manual Schema Update`); m.innerHTML = r.ok ? `<div class="issue-box ok mini">${icon('check', 14)} Synced to GitHub.</div>` : issues([r.error || 'Repository synchronization failed.']); });
    if (selTable) mountTable();
  }
  function actions(row: SchemaEditorRow | null): void {
    const bar = container.querySelector<HTMLElement>('#rowActionsBar'); if (!bar) return; if (!row) { bar.hidden = true; return; } bar.hidden = false;
    container.querySelector('#selectedRowLabel')!.textContent = `Selected: ${row.tableName}.${row.columnName}`;
    (container.querySelector('#editRowBtn') as HTMLButtonElement).onclick = () => openRowForm(row); (container.querySelector('#deleteRowBtn') as HTMLButtonElement).onclick = () => startDelete(row);
  }
  function mountTable(): void {
    const m = container.querySelector<HTMLElement>('#dataTableMount'); if (!m) return;
    tableApi = renderDataTable<SchemaEditorRow>(m, { columns: [{ key: 'columnName', label: 'Column', sortValue: (r) => r.columnName, width: '16%' }, { key: 'dataType', label: 'Type', render: (r) => e(`${r.dataType}${r.length ? `(${r.length})` : ''}`), sortValue: (r) => r.dataType, width: '12%' }, { key: 'columnDescription', label: 'Description', width: '38%' }, { key: 'keys', label: 'Keys', render: (r) => e(`${r.isPrimaryKey ? 'PK' : ''}${r.isForeignKey ? ` FK→${r.fkTable}.${r.fkColumn}` : ''}`), width: '20%' }, { key: 'nullable', label: 'Null?', render: (r) => (r.nullable ? 'Yes' : 'No'), width: '8%' }], rows: schemaService.getFlattenedRows(editingSchemaId, selModule, selTable), getRowId: (r) => r.rowId, pageSize: 50, searchPredicate: (r, t) => [r.columnName, r.columnDescription, r.alias].some((v) => (v || '').toLowerCase().includes(t)), onRowClick: (r) => actions(r), emptyMessage: `No columns in ${selTable} yet. Select "Add New Row" to create the first one.` });
    actions(null);
  }
  function refreshTable(): void { if (!schemaService.getSchemaById(editingSchemaId)?.tables.some((t) => t.name === selTable)) { draw(); return; } tableApi?.refresh(schemaService.getFlattenedRows(editingSchemaId, selModule, selTable)); actions(null); }
  function openRowForm(existing: SchemaEditorRow | null): void {
    const schema = schemaService.getSchemaById(editingSchemaId)!; const isEdit = !!existing;
    const r: SchemaEditorRow = existing || { rowId: '', module: selModule || '', tableName: selTable || '', tableDescription: schema.tables.find((t) => t.name === selTable)?.description || '', columnName: '', columnDescription: '', dataType: 'VARCHAR', length: null, precision: null, nullable: true, alias: '', decodeText: '', isPrimaryKey: false, isForeignKey: false, fkTable: '', fkColumn: '' };
    const deps = existing ? analyzeDependencies(schema, existing.tableName, existing.columnName) : [];
    const body = `<form id="rowForm" novalidate>${deps.length ? `<div class="note-box mini" style="margin-top:0">${icon('info', 14)}<span>Referenced by ${deps.length} other record(s). Renaming this column also updates them; moving it to another table is blocked.</span></div>` : ''}<h6>Table Information</h6><div class="form-row-3"><label class="block-label">Module<input type="text" id="f_module" value="${e(r.module)}"/></label><label class="block-label">Table Name *<input type="text" id="f_tableName" list="tableNameList" value="${e(r.tableName)}"/><datalist id="tableNameList">${schema.tables.map((t) => `<option value="${e(t.name)}"></option>`).join('')}</datalist></label><label class="block-label">Table Description<input type="text" id="f_tableDescription" value="${e(r.tableDescription)}"/></label></div>
    <h6 class="mt">Column Information</h6><div class="form-row-2"><label class="block-label">Column Name *<input type="text" id="f_columnName" value="${e(r.columnName)}"/></label><label class="block-label">Column Description<input type="text" id="f_columnDescription" value="${e(r.columnDescription)}"/></label></div><div class="form-row-3"><label class="block-label">Data Type<select id="f_dataType">${v17DataTypeOptionsHtml(String(r.dataType))}</select></label><label class="block-label">Length<input type="number" min="0" id="f_length" value="${r.length ?? ''}"/></label><label class="block-label">Precision<input type="number" min="0" id="f_precision" value="${r.precision ?? ''}"/></label></div><label class="inline-check"><input type="checkbox" id="f_nullable" ${r.nullable ? 'checked' : ''}/> Nullable</label>
    <h6 class="mt">Metadata</h6><div class="form-row-2"><label class="block-label">Alias<input type="text" id="f_alias" value="${e(r.alias)}"/></label><label class="block-label">Decode (one "RAW=Label" per line)<textarea id="f_decode" rows="3">${e(r.decodeText)}</textarea></label></div><label class="inline-check"><input type="checkbox" id="f_isPrimaryKey" ${r.isPrimaryKey ? 'checked' : ''}/> Primary Key</label><label class="inline-check"><input type="checkbox" id="f_isForeignKey" ${r.isForeignKey ? 'checked' : ''}/> Foreign Key</label><div id="fkFields" class="form-row-2" ${r.isForeignKey ? '' : 'hidden'}><label class="block-label">References Table<input type="text" id="f_fkTable" list="tableNameList" value="${e(r.fkTable)}"/></label><label class="block-label">References Column<input type="text" id="f_fkColumn" value="${e(r.fkColumn)}"/></label></div>
    <div id="rowFormIssues"></div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="rowFormCancel">Cancel</button><button type="submit" class="btn btn-primary" id="rowFormSave">${icon('save', 14)} Save</button></div></form>`;
    const modal = openModal(`${icon(isEdit ? 'edit' : 'plus', 18)} ${isEdit ? 'Edit Row' : 'Add New Row'}`, body, { wide: true });
    const f = modal.element.querySelector<HTMLFormElement>('#rowForm')!; const v = <T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id: string) => f.querySelector<T>(`#${id}`)!;
    const box = f.querySelector<HTMLElement>('#rowFormIssues')!; f.addEventListener('input', () => { box.innerHTML = ''; });
    v<HTMLInputElement>('f_isForeignKey').addEventListener('change', (ev) => { f.querySelector<HTMLElement>('#fkFields')!.hidden = !(ev.target as HTMLInputElement).checked; });
    f.querySelector('#rowFormCancel')!.addEventListener('click', () => modal.close());
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const num = (id: string) => { const x = v<HTMLInputElement>(id).value.trim(); return x === '' ? null : Number(x); };
      const cand: SchemaEditorRow = { rowId: '', module: (v<HTMLInputElement>('f_module').value || 'General').trim(), tableName: v<HTMLInputElement>('f_tableName').value.trim(), tableDescription: v<HTMLInputElement>('f_tableDescription').value.trim(), columnName: v<HTMLInputElement>('f_columnName').value.trim(), columnDescription: v<HTMLInputElement>('f_columnDescription').value.trim(), dataType: v<HTMLSelectElement>('f_dataType').value as ColumnDataType, length: num('f_length'), precision: num('f_precision'), nullable: v<HTMLInputElement>('f_nullable').checked, alias: v<HTMLInputElement>('f_alias').value.trim(), decodeText: v<HTMLTextAreaElement>('f_decode').value, isPrimaryKey: v<HTMLInputElement>('f_isPrimaryKey').checked, isForeignKey: v<HTMLInputElement>('f_isForeignKey').checked, fkTable: v<HTMLInputElement>('f_fkTable').value.trim(), fkColumn: v<HTMLInputElement>('f_fkColumn').value.trim() };
      const pre = validateRecordFields(cand, schema); if (pre.length) { box.innerHTML = issues(pre); return; }
      const errs = await schemaService.upsertRow(editingSchemaId, cand, isEdit ? existing!.rowId : null);
      if (errs.length) { box.innerHTML = issues(errs); return; }
      store.pushToast('success', `${isEdit ? 'Updated' : 'Added'} ${cand.tableName}.${cand.columnName}. The active schema and SQL generation use this change immediately.`);
      modal.close(); if (cand.tableName !== selTable) { selModule = cand.module; selTable = cand.tableName; draw(); } else refreshTable();
    });
  }
  function startDelete(row: SchemaEditorRow): void {
    const schema = schemaService.getSchemaById(editingSchemaId)!;
    const m1 = openModal(`${icon('alert-triangle', 18)} Confirm Delete`, `<p>Are you sure you want to delete this schema record?</p><div class="modal-actions"><button type="button" class="btn btn-ghost" id="c1Cancel">Cancel</button><button type="button" class="btn btn-primary" id="c1Continue">Continue</button></div>`);
    m1.element.querySelector('#c1Cancel')!.addEventListener('click', () => m1.close()); m1.element.querySelector('#c1Continue')!.addEventListener('click', () => { m1.close(); c2(); });
    function c2(): void { const m2 = openModal(`${icon('alert-triangle', 18)} Confirm Details`, `<p>You are about to permanently delete:</p><ul><li>Schema: <strong>${e(schema.name)}</strong></li><li>Table: <strong>${e(row.tableName)}</strong></li><li>Column: <strong>${e(row.columnName)}</strong></li></ul><p>Only this record is removed. This change will modify the selected schema. Do you want to continue?</p><div class="modal-actions"><button type="button" class="btn btn-ghost" id="c2Cancel">Cancel</button><button type="button" class="btn btn-primary" id="c2Continue">Continue</button></div>`); m2.element.querySelector('#c2Cancel')!.addEventListener('click', () => m2.close()); m2.element.querySelector('#c2Continue')!.addEventListener('click', () => { m2.close(); c3(); }); }
    function c3(): void {
      const m3 = openModal(`${icon('lock', 18)} Final Confirmation`, `<p>Enter the Admin Password to permanently delete this schema record.</p><label class="block-label">Admin Password<input type="password" id="c3Password"/></label><div id="c3Error"></div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="c3Cancel">Cancel</button><button type="button" class="btn btn-danger" id="c3Delete">${icon('trash', 14)} Delete Permanently</button></div>`, { closeOnBackdrop: false });
      const pw = m3.element.querySelector<HTMLInputElement>('#c3Password')!; const err = m3.element.querySelector<HTMLElement>('#c3Error')!; pw.addEventListener('input', () => { err.innerHTML = ''; });
      m3.element.querySelector('#c3Cancel')!.addEventListener('click', () => m3.close());
      m3.element.querySelector('#c3Delete')!.addEventListener('click', async () => { if (!(await verifyPassword(pw.value))) { err.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} Incorrect password.</div>`; return; } m3.close(); const r = await v17DeleteRowWithDependencyCheck(editingSchemaId, row); if (r.ok) { store.pushToast('success', `Deleted ${row.tableName}.${row.columnName}.`); refreshTable(); } else store.pushToast(/cancelled/.test(r.error || '') ? 'info' : 'error', r.error || 'Schema update failed.'); });
    }
  }
  draw();
}
