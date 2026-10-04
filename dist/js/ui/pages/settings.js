/** Settings: Schema Management · Manual Schema Update · Synchronization · Secret Vault · AI/LLM Model */
import { state } from '../../state/store.js';
import { schemas, sync, vault, secrets, reloadSecrets, repository, aiConfig, setAiConfig } from '../context.js';
import { esc, val, checked, toast, options, multiline } from '../dom.js';
import { legacyLeftovers } from '../../v17/sync/schemaFormat.js';
import { rejectionMessage, migrationMessage } from '../../v17/sync/syncService.js';
import { parseRowId, diffRows, analyzeDependencies, dataTypeOptionValues } from '../../v17/engines/schemaRecordEngine.js';
import { VALID_DATA_TYPES } from '../../types/index.js';
import { maskSecret } from '../../v17/services/secretVault.js';
import { validateAiConfig, saveAiConfig, requestSqlFromModel, PROVIDER_DEFAULTS } from '../../v17/services/aiLlmService.js';
import { redactSecrets } from '../../v17/errors/appErrors.js';
import { downloadBlob } from '../../utils/dom.js';
const TABS = [['schema-management', 'Schema Management'], ['manual-update', 'Manual Schema Update'], ['sync', 'Synchronization'], ['vault', 'Secret Vault'], ['ai', 'AI/LLM Model']];
let lastPull = null;
let lastPushNote = '';
let editorSchemaId = null;
let selectedRowId = null;
let editorFilter = '';
let pendingDelete = null;
let lastChanges = [];
export function renderSettings(root) {
    root.innerHTML = `<h1>Settings</h1><div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" class="${state.settingsTab === k ? 'active' : ''}">${esc(l)}</button>`).join('')}</div><div id="settingsBody"></div>`;
    root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { state.settingsTab = b.dataset.tab; renderSettings(root); }));
    const body = root.querySelector('#settingsBody');
    const rerender = () => renderSettings(root);
    ({ 'schema-management': schemaMgmt, 'manual-update': manualUpdate, sync: syncTab, vault: vaultTab, ai: aiTab }[state.settingsTab]?.(body, rerender));
}
// ───────────── Schema Management ─────────────
const STATUS_CHIP = {
    current: ['current', 'Current schema'], 'legacy-clean': ['legacy', 'Legacy schema (no migration needed)'], migrated: ['migrated', 'Migration successful'],
    'migration-failed': ['failed', 'Migration failed'], invalid: ['invalid', 'Invalid schema'], 'local-migrated': ['migrated', 'Migrated schema']
};
function chip(k) { const [c, l] = STATUS_CHIP[k]; return `<span class="chip ${c}">${esc(l)}</span>`; }
function schemaMgmt(body, rerender) {
    const reg = schemas.registry();
    const diag = schemas.loadDiagnostics;
    body.innerHTML = `<div class="card"><h2>Schemas</h2><table class="grid" id="schemaList"><thead><tr><th>Name</th><th>Format</th><th>Tables</th><th>Legacy leftovers</th><th>Last synced</th><th></th></tr></thead><tbody>
    ${reg.schemas.map((s) => {
        const left = legacyLeftovers(s);
        return `<tr data-schema="${esc(s.id)}"><td><strong>${esc(s.name)}</strong> ${s.id === reg.activeSchemaId ? '<span class="chip active">Active</span>' : ''}</td>
      <td>${s.migration ? `${chip('local-migrated')}<div class="small muted">from ${esc(s.migration.fromFormat)} · ${esc(s.migration.migratedAt.slice(0, 10))}</div>` : chip('current')}</td>
      <td>${s.tables.length}</td><td class="small">${left.unmappedLabels ? `${left.unmappedLabels} decode label(s) without code` : ''}${left.unresolvedRefs ? `${left.unmappedLabels ? '<br>' : ''}${left.unresolvedRefs} reference(s) outside schema` : ''}${!left.unmappedLabels && !left.unresolvedRefs ? '—' : ''}</td>
      <td class="small">${esc(s.lastSyncedAt ? s.lastSyncedAt.replace('T', ' ').slice(0, 16) : 'never')}</td>
      <td class="row">${s.id !== reg.activeSchemaId ? `<button data-activate="${esc(s.id)}">Set active</button>` : ''}<button data-rename="${esc(s.id)}">Rename</button>${left.unmappedLabels ? `<button data-recover="${esc(s.id)}">Recover decode codes from source file</button>` : ''}<button class="danger" data-del="${esc(s.id)}">Delete</button></td></tr>`;
    }).join('')}
  </tbody></table>
  <div class="row" style="margin-top:10px"><input type="file" id="importFile" accept=".json,application/json"><input id="importName" placeholder="Name for imported schema (optional)"><button id="importBtn">Import schema file</button><button id="exportBtn">Export all schemas</button></div>
  <input type="file" id="recoverFile" accept=".json" style="display:none"></div>
  <div class="card" id="syncDiagnostics"><div class="row"><h2 class="grow" style="margin:0">Repository synchronization</h2><button class="primary" id="syncNow">Synchronize now</button><button id="pullOnly">Download only</button><button id="publishNow">Publish</button></div>
  <p class="small muted">Download → detect format → migrate legacy schemas → validate → save → refresh Active Schema → publish in the current format. Invalid repository data never replaces a valid local schema.</p>
  ${lastPull ? renderPull(lastPull) : '<p class="muted small">No synchronization in this session yet.</p>'}${lastPushNote ? `<div class="issue-box ${/^Published/.test(lastPushNote) ? 'ok' : ''}">${multiline(lastPushNote)}</div>` : ''}
  ${diag.migrated.length || diag.rejected.length ? `<div class="issue-box"><strong>Local storage check:</strong> ${diag.migrated.length} locally stored legacy schema(s) migrated; ${diag.rejected.length} could not be read and were skipped.</div>` : ''}
  ${conflictsHtml()}</div>`;
    body.querySelectorAll('[data-activate]').forEach((b) => b.addEventListener('click', () => { schemas.setActive(b.dataset.activate); toast('success', `Active Schema: ${schemas.active().name}`); rerender(); }));
    body.querySelectorAll('[data-rename]').forEach((b) => b.addEventListener('click', () => { const s = schemas.byId(b.dataset.rename); const n = prompt('New schema name', s.name); if (n === null)
        return; const r = schemas.rename(s.id, n); if (!r.ok)
        toast('error', r.errors.map((e) => e.message).join(' ')); rerender(); }));
    body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { const s = schemas.byId(b.dataset.del); if (!confirm(`Delete schema "${s.name}" from this device?`))
        return; const r = schemas.deleteSchema(s.id); if (!r.ok)
        toast('error', r.errors.map((e) => e.message).join(' ')); rerender(); }));
    let recoverTarget = '';
    body.querySelectorAll('[data-recover]').forEach((b) => b.addEventListener('click', () => { recoverTarget = b.dataset.recover; body.querySelector('#recoverFile').click(); }));
    body.querySelector('#recoverFile').addEventListener('change', async (e) => { const f = e.target.files?.[0]; if (!f)
        return; const r = schemas.recoverFromSource(recoverTarget, await f.text()); if (!r.ok)
        toast('error', r.errors.map((x) => x.message).join(' '));
    else
        toast(r.restored ? 'success' : 'info', `${r.restored} decode code(s) restored from the source file; ${r.stillUnmapped} label(s) still without a code.`); rerender(); });
    body.querySelector('#importBtn').addEventListener('click', async () => {
        const f = body.querySelector('#importFile').files?.[0];
        if (!f) {
            toast('warning', 'Choose a schema file first.');
            return;
        }
        const r = schemas.importSchemaJson(await f.text(), val('importName'));
        if (!r.ok)
            toast('error', `${r.errors.map((e) => `${e.message}${e.details?.length ? `\n• ${e.details.slice(0, 5).join('\n• ')}` : ''}`).join('\n')}`);
        else
            toast('success', `Imported "${r.schema.name}" (${r.schema.tables.length} tables).${r.summary.length ? `\n${r.summary.join('\n')}` : ''}`);
        rerender();
    });
    body.querySelector('#exportBtn').addEventListener('click', () => downloadBlob('sql-assistant-schemas.json', schemas.exportRegistryJson(), 'application/json'));
    const run = async (fn) => { body.querySelectorAll('button').forEach((b) => b.setAttribute('disabled', '')); try {
        await fn();
    }
    catch (e) {
        toast('error', redactSecrets(e.message, vault.knownSecrets()));
    } rerender(); };
    body.querySelector('#syncNow').addEventListener('click', () => run(async () => { const r = await sync.synchronize(); lastPull = r.pull; lastPushNote = r.push ? [...r.push.messages, ...r.push.problems].join('\n') : ''; notify(r.pull); }));
    body.querySelector('#pullOnly').addEventListener('click', () => run(async () => { lastPull = await sync.pull(); lastPushNote = ''; notify(lastPull); }));
    body.querySelector('#publishNow').addEventListener('click', () => run(async () => {
        let r = await sync.push();
        if (!r.ok && r.skipped === 'remote-invalid' && confirm(`${r.problems.join(' ')}\n\nPublish anyway?`))
            r = await sync.push({ allowReplacingInvalidRemote: true });
        lastPushNote = [...r.messages, ...r.problems].join('\n');
        toast(r.ok ? 'success' : 'error', lastPushNote);
    }));
    body.querySelectorAll('[data-cf]').forEach((b) => b.addEventListener('click', () => { sync.resolveConflict(b.dataset.cf, b.dataset.choice); rerender(); }));
}
function notify(p) {
    if (p.fileProblem) {
        toast('error', p.fileProblem);
        return;
    }
    if (p.migrated.length)
        toast('success', migrationMessage(p.migrated[0]).split('\n').slice(0, 3).join('\n'));
    if (p.rejected.length)
        toast('warning', rejectionMessage(p.rejected[0]));
    if (!p.migrated.length && !p.rejected.length)
        toast('success', `Synchronized: ${p.added.length} added, ${p.updated.length} updated, ${p.unchanged.length} unchanged.`);
}
function renderPull(p) {
    if (p.fileProblem)
        return `<div class="issue-box error">${multiline(p.fileProblem)}</div>`;
    const rows = [
        ...p.migrated.map((m) => `<tr><td>${esc(m.name)}</td><td>${chip('migrated')}</td><td class="small pre-wrap">${multiline(migrationMessage(m))}</td></tr>`),
        ...p.rejected.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.legacy ? chip('migration-failed') : chip('invalid')}</td><td class="small"><div class="pre-wrap">${multiline(rejectionMessage(r))}</div><details><summary>All ${r.total} problem(s)</summary><ul>${r.errors.map((e) => `<li>${esc(e)}</li>`).join('')}${r.total > r.errors.length ? `<li>…and ${r.total - r.errors.length} more.</li>` : ''}</ul></details></td></tr>`),
        ...[...p.added, ...p.updated, ...p.unchanged].filter((n) => !p.migrated.some((m) => m.name === n)).map((n) => `<tr><td>${esc(n)}</td><td>${p.remoteLegacy ? chip('legacy-clean') : chip('current')}</td><td class="small">${p.added.includes(n) ? 'Added' : p.updated.includes(n) ? 'Updated from repository' : 'Up to date'}</td></tr>`)
    ];
    return `<p class="small">Repository file written by: <strong>${esc(p.remoteWriter || '—')}</strong>${p.remoteLegacy ? ' — <span class="chip legacy">Legacy schema</span> <span class="chip legacy">Migration required</span>' : ''}${p.remoteMissing ? ' (no file yet)' : ''}</p>
    <table class="grid" id="pullReport"><thead><tr><th>Schema</th><th>Status</th><th>Details</th></tr></thead><tbody>${rows.join('')}</tbody></table>
    ${p.rejected.length ? `<div class="issue-box error">${esc(`${p.rejected.length} schema(s) in the repository failed validation and were not loaded — your local copies were kept unchanged.`)}</div>` : ''}
    ${p.localAhead.length ? `<p class="small">Newer on this device (will be published): ${esc(p.localAhead.join(', '))}</p>` : ''}`;
}
function conflictsHtml() {
    const c = sync.conflicts();
    if (!c.length)
        return '';
    return `<h3>Conflicts</h3>${c.map((x) => `<div class="issue-box">Schema <strong>${esc(x.schemaName)}</strong> changed both here and in the repository. <button data-cf="${esc(x.id)}" data-choice="keep-local">Keep this device's version</button> <button data-cf="${esc(x.id)}" data-choice="take-remote">Use repository version</button></div>`).join('')}`;
}
// ───────────── Manual Schema Update (row-wise) ─────────────
function rowsOf(s) {
    return s.tables.flatMap((t) => t.columns.map((c) => ({ rowId: `${t.name}::${c.name}`, module: t.module, tableName: t.name, tableDescription: t.description, columnName: c.name, columnDescription: c.description, dataType: c.type, length: c.length ?? null, precision: c.precision ?? null, nullable: c.nullable, alias: c.alias ?? '', decodeText: (c.decode || []).map((d) => `${d.rawValue}=${d.label}`).join('\n'), isPrimaryKey: !!c.isPrimaryKey, isForeignKey: !!c.isForeignKey, fkTable: c.references?.table ?? '', fkColumn: c.references?.column ?? '' })));
}
function manualUpdate(body, rerender) {
    const reg = schemas.registry();
    if (!editorSchemaId || !schemas.byId(editorSchemaId))
        editorSchemaId = reg.activeSchemaId;
    const s = schemas.byId(editorSchemaId);
    const rows = rowsOf(s);
    const isNew = selectedRowId === '__new__';
    const row = isNew ? null : rows.find((r) => r.rowId === selectedRowId) || null;
    const visible = rows.filter((r) => !editorFilter || `${r.tableName} ${r.columnName}`.toLowerCase().includes(editorFilter.toLowerCase()));
    const col = row ? s.tables.find((t) => t.name === row.tableName)?.columns.find((c) => c.name === row.columnName) : undefined;
    const f = row || { rowId: '', module: '', tableName: '', tableDescription: '', columnName: '', columnDescription: '', dataType: 'VARCHAR', length: null, precision: null, nullable: true, alias: '', decodeText: '', isPrimaryKey: false, isForeignKey: false, fkTable: '', fkColumn: '' };
    const deps = row ? analyzeDependencies(s, row.tableName, row.columnName) : [];
    body.innerHTML = `<div class="card"><div class="row"><label style="margin:0">Schema</label><select id="muSchema">${options(reg.schemas.map((x) => x.id), s.id, Object.fromEntries(reg.schemas.map((x) => [x.id, x.name])))}</select>
    <input id="muFilter" placeholder="Filter rows" value="${esc(editorFilter)}"><button id="muNew">Add row</button><span class="small muted">${rows.length} rows · select one row to edit or delete it. Changes are validated and saved to the centralized schema data.</span></div>
    <div class="scroll" style="margin-top:8px"><table class="grid" id="muGrid"><thead><tr><th>Table</th><th>Column</th><th>Type</th><th>Null</th><th>Key</th><th>Decode</th></tr></thead><tbody>
    ${visible.slice(0, 400).map((r) => `<tr data-row="${esc(r.rowId)}" class="${r.rowId === selectedRowId ? 'sel' : ''}"><td>${esc(r.tableName)}</td><td>${esc(r.columnName)}</td><td>${esc(r.dataType)}</td><td>${r.nullable ? 'Y' : 'N'}</td><td>${r.isPrimaryKey ? 'PK' : ''}${r.isForeignKey ? ' FK' : ''}</td><td class="small">${esc(r.decodeText.split('\n').slice(0, 2).join('; '))}${r.decodeText.split('\n').length > 2 ? '…' : ''}</td></tr>`).join('')}
    ${visible.length > 400 ? `<tr><td colspan="6" class="muted small">${visible.length - 400} more rows — use the filter.</td></tr>` : ''}</tbody></table></div></div>
  ${row || isNew ? `<div class="card" id="muForm"><h2>${isNew ? 'New row' : `Edit ${esc(f.tableName)}.${esc(f.columnName)}`}</h2>
    <div class="two"><div><label for="muTable">Table Name</label><input id="muTable" value="${esc(f.tableName)}" style="width:100%"><label for="muColumn">Column Name</label><input id="muColumn" value="${esc(f.columnName)}" style="width:100%">
      <label for="muType">Data Type</label><select id="muType">${options(dataTypeOptionValues(f.dataType, [...VALID_DATA_TYPES, 'VARCHAR2', 'NVARCHAR2', 'CHAR', 'INTEGER', 'BLOB', 'CLOB', 'RAW']), f.dataType)}</select>
      <div class="row"><div><label for="muLength">Length</label><input id="muLength" type="number" min="0" value="${f.length ?? ''}" size="6"></div><div><label for="muPrecision">Precision</label><input id="muPrecision" type="number" min="0" value="${f.precision ?? ''}" size="6"></div><label><input type="checkbox" id="muNullable"${f.nullable ? ' checked' : ''}> Nullable</label></div>
      <label for="muAlias">Alias</label><input id="muAlias" value="${esc(f.alias)}"><label for="muDesc">Column Description</label><textarea id="muDesc">${esc(f.columnDescription)}</textarea></div>
    <div><label><input type="checkbox" id="muPk"${f.isPrimaryKey ? ' checked' : ''}> Primary Key</label><label><input type="checkbox" id="muFk"${f.isForeignKey ? ' checked' : ''}> Foreign Key</label>
      <div class="row"><input id="muFkTable" placeholder="References table" value="${esc(f.fkTable)}"><input id="muFkColumn" placeholder="References column" value="${esc(f.fkColumn)}"></div>
      ${col?.unresolvedReference ? `<p class="small muted">Documented reference outside this schema: ${esc(col.unresolvedReference.table)}.${esc(col.unresolvedReference.column)}</p>` : ''}
      <label for="muDecode">Decode (one per line: CODE=Label)</label><textarea id="muDecode" style="min-height:120px">${esc(f.decodeText)}</textarea>
      ${col?.unmappedDecodeLabels?.length ? `<div class="issue-box small">Legacy labels without a raw code: ${esc(col.unmappedDecodeLabels.join(', '))}. Add them above as CODE=Label to restore them.</div>` : ''}
      <label for="muModule">Module (table-level)</label><input id="muModule" value="${esc(f.module)}"><label for="muTableDesc">Table Description (table-level)</label><textarea id="muTableDesc">${esc(f.tableDescription)}</textarea></div></div>
    <div class="row"><button class="primary" id="muSave">Save row</button>${row ? `<button class="danger" id="muDelete">Delete row</button>` : ''}<button id="muCancel">Cancel</button></div>
    ${deps.length ? `<p class="small muted">Depends on this row: ${esc(deps.map((d) => d.description).join('; '))}</p>` : ''}
    ${pendingDelete === row?.rowId && deps.length ? `<div class="issue-box error">This row has dependent records: <ul>${deps.map((d) => `<li>${esc(d.description)}</li>`).join('')}</ul><button class="danger" id="muDeleteCascade">Delete and unlink dependents</button></div>` : ''}
    <div id="muResult"></div></div>` : ''}
  ${lastChanges.length ? `<div class="issue-box ok" id="muChanges">Saved:<ul>${lastChanges.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}`;
    body.querySelector('#muSchema').addEventListener('change', () => { editorSchemaId = val('muSchema'); selectedRowId = null; lastChanges = []; rerender(); });
    body.querySelector('#muFilter').addEventListener('change', () => { editorFilter = val('muFilter'); rerender(); });
    body.querySelector('#muNew').addEventListener('click', () => { selectedRowId = '__new__'; pendingDelete = null; lastChanges = []; rerender(); });
    body.querySelectorAll('[data-row]').forEach((tr) => tr.addEventListener('click', () => { selectedRowId = tr.dataset.row; pendingDelete = null; lastChanges = []; rerender(); }));
    body.querySelector('#muCancel')?.addEventListener('click', () => { selectedRowId = null; pendingDelete = null; rerender(); });
    body.querySelector('#muSave')?.addEventListener('click', () => {
        const num = (id) => { const v = val(id).trim(); return v === '' ? null : Number(v); };
        const edited = { rowId: row?.rowId || '', module: val('muModule'), tableName: val('muTable'), tableDescription: val('muTableDesc'), columnName: val('muColumn'), columnDescription: val('muDesc'), dataType: val('muType'), length: num('muLength'), precision: num('muPrecision'), nullable: checked('muNullable'), alias: val('muAlias'), decodeText: val('muDecode'), isPrimaryKey: checked('muPk'), isForeignKey: checked('muFk'), fkTable: val('muFkTable'), fkColumn: val('muFkColumn') };
        if (row && !diffRows(row, edited).length) {
            toast('info', 'No changes to save.');
            return;
        }
        const r = schemas.upsertRow(s.id, edited, row ? row.rowId : null, row);
        if (!r.ok) {
            body.querySelector('#muResult').innerHTML = `<div class="issue-box error">${r.errors.map((e) => `${esc(e.message)}${e.details?.length ? `<ul>${e.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}`).join('')}</div>`;
            return;
        }
        lastChanges = r.changes;
        selectedRowId = `${edited.tableName.trim()}::${edited.columnName.trim()}`;
        toast('success', 'Row saved, validated, and the Active Schema was refreshed.');
        rerender();
    });
    body.querySelector('#muDelete')?.addEventListener('click', () => {
        if (!row)
            return;
        if (deps.length) {
            pendingDelete = row.rowId;
            rerender();
            return;
        }
        if (!confirm(`Delete ${row.tableName}.${row.columnName}?`))
            return;
        const r = schemas.deleteRow(s.id, row.rowId);
        if (!r.ok) {
            toast('error', r.errors.map((e) => e.message).join(' '));
            return;
        }
        lastChanges = r.changes;
        selectedRowId = null;
        toast('success', 'Row deleted.');
        rerender();
    });
    body.querySelector('#muDeleteCascade')?.addEventListener('click', () => { if (!row)
        return; const r = schemas.deleteRow(s.id, row.rowId, true); if (!r.ok) {
        toast('error', r.errors.map((e) => e.message).join(' '));
        return;
    } lastChanges = r.changes; selectedRowId = null; pendingDelete = null; rerender(); });
    void parseRowId;
}
// ───────────── Synchronization ─────────────
function syncTab(body, rerender) {
    const m = sync.meta();
    const log = sync.log().slice(0, 30);
    body.innerHTML = `<div class="card"><h2>Synchronization</h2><p class="small">Repository: <strong>${esc(secrets.githubRepo || '(not configured)')}</strong> · branch ${esc(secrets.githubBranch)} · file <code>${esc(secrets.schemaPath)}</code> · token ${esc(maskSecret(secrets.githubToken))}</p>
    <p class="small muted">Last download: ${esc(m.lastPullAt || 'never')} · Last publish: ${esc(m.lastPushAt || 'never')}</p>
    <label for="autoSync">Automatic synchronization</label><select id="autoSync">${options(['manual', '15m', '30m', '1h', '4h'], localStorage.getItem('sqla.autoSync') || 'manual', { manual: 'Manual only', '15m': 'Every 15 minutes', '30m': 'Every 30 minutes', '1h': 'Every hour', '4h': 'Every 4 hours' })}</select>
    <h3>Log</h3><div class="scroll small"><table class="grid"><tbody>${log.map((l) => `<tr><td>${esc(l.timestamp.replace('T', ' ').slice(0, 19))}</td><td>${esc(l.kind)}</td><td>${esc(l.message)}</td></tr>`).join('') || '<tr><td class="muted">No entries.</td></tr>'}</tbody></table></div></div>`;
    body.querySelector('#autoSync').addEventListener('change', () => { localStorage.setItem('sqla.autoSync', val('autoSync')); window.dispatchEvent(new Event('sqla:autosync-changed')); toast('success', 'Automatic synchronization updated.'); rerender(); });
}
// ───────────── Secret Vault ─────────────
function vaultTab(body, rerender) {
    const s = secrets;
    body.innerHTML = `<div class="card"><h2>Secret Vault</h2><p class="small muted">Stored encrypted on this device (AES-256-GCM, non-extractable device key). The repository copy is encrypted with your Vault Sync Passphrase (PBKDF2-SHA-256 + AES-256-GCM); the passphrase is never stored or uploaded.</p>
    <div class="two"><div><label for="vRepo">GitHub repository (owner/name)</label><input id="vRepo" value="${esc(s.githubRepo)}" style="width:100%"><label for="vBranch">Branch</label><input id="vBranch" value="${esc(s.githubBranch)}">
      <label for="vToken">GitHub access token</label><input id="vToken" type="password" autocomplete="off" placeholder="${esc(maskSecret(s.githubToken))}" style="width:100%"></div>
    <div><label for="vSchemaPath">Schema file path</label><input id="vSchemaPath" value="${esc(s.schemaPath)}" style="width:100%"><label for="vVaultPath">Vault file path</label><input id="vVaultPath" value="${esc(s.vaultPath)}" style="width:100%"><p class="small muted">AI/LLM API key: ${esc(maskSecret(s.aiApiKey))} (set in AI/LLM Model)</p></div></div>
    <button class="primary" id="vSave">Save configuration</button></div>
  <div class="card"><h2>Push Secret Vault to Repository</h2><label for="vPass">Vault Sync Passphrase (min. 10 characters)</label><input id="vPass" type="password" autocomplete="new-password" style="width:320px">
    <div class="row" style="margin-top:8px"><button id="vPush">Push Secret Vault to Repository</button><button id="vPull">Retrieve Secret Vault from Repository</button></div><div id="vResult"></div></div>`;
    const result = (kind, msg) => { body.querySelector('#vResult').innerHTML = `<div class="issue-box ${kind}">${esc(redactSecrets(msg, vault.knownSecrets()))}</div>`; };
    body.querySelector('#vSave').addEventListener('click', async () => {
        const next = { ...s, githubRepo: val('vRepo').trim(), githubBranch: val('vBranch').trim() || 'main', schemaPath: val('vSchemaPath').trim() || 'schemas/schema-registry.json', vaultPath: val('vVaultPath').trim() || 'vault/secret-vault.enc.json', githubToken: val('vToken').trim() || s.githubToken };
        if (next.githubRepo && !/^[\w.-]+\/[\w.-]+$/.test(next.githubRepo)) {
            toast('error', 'Repository must be in the form owner/name.');
            return;
        }
        try {
            await vault.save(next);
            await reloadSecrets();
            toast('success', 'Secret Vault saved (encrypted).');
            rerender();
        }
        catch (e) {
            toast('error', `Encryption failed: ${e.message}`);
        }
    });
    body.querySelector('#vPush').addEventListener('click', async () => {
        const repo = repository();
        if (!repo) {
            result('error', 'Configure the repository and token first.');
            return;
        }
        try {
            const text = await vault.exportEncrypted(val('vPass'));
            const cur = await repo.read(s.vaultPath);
            await repo.write(s.vaultPath, text, cur?.sha ?? null, 'SQL Assistant: update encrypted Secret Vault');
            result('ok', 'Encrypted Secret Vault pushed to the repository.');
        }
        catch (e) {
            result('error', `Push failed: ${e.message}`);
        }
    });
    body.querySelector('#vPull').addEventListener('click', async () => {
        const repo = repository();
        if (!repo) {
            result('error', 'Configure the repository and token first.');
            return;
        }
        try {
            const f = await repo.read(s.vaultPath);
            if (!f) {
                result('error', 'No vault file in the repository yet.');
                return;
            }
            await vault.importEncrypted(f.text, val('vPass'));
            await reloadSecrets();
            result('ok', 'Secret Vault retrieved, decrypted and validated.');
        }
        catch (e) {
            result('error', `Retrieve failed: ${e.message}`);
        }
    });
}
// ───────────── AI/LLM Model ─────────────
function aiTab(body, rerender) {
    const c = aiConfig;
    body.innerHTML = `<div class="card"><h2>AI/LLM Model</h2><p class="small muted">Optional. The offline NLU model remains the primary engine; the AI/LLM Model is used only when enabled and the offline result is uncertain. Its SQL is validated against the Active Schema, and the app keeps working if it is unavailable.</p>
    <label><input type="checkbox" id="aiEnabled"${c.enabled ? ' checked' : ''}> Enable AI/LLM Model</label>
    <div class="two"><div><label for="aiProvider">Provider</label><select id="aiProvider">${options(['openai', 'azure-openai', 'anthropic', 'custom'], c.provider, { openai: 'OpenAI', 'azure-openai': 'Azure OpenAI', anthropic: 'Anthropic', custom: 'Custom (OpenAI-compatible)' })}</select>
      <label for="aiModel">Model</label><input id="aiModel" value="${esc(c.model)}" style="width:100%"><label for="aiEndpoint">Endpoint</label><input id="aiEndpoint" value="${esc(c.endpoint || PROVIDER_DEFAULTS[c.provider].endpoint)}" style="width:100%">
      <label for="aiAuth">Authentication</label><select id="aiAuth">${options(['bearer', 'api-key-header', 'none'], c.authType, { bearer: 'Bearer token', 'api-key-header': 'API key header', none: 'None (local model)' })}</select>
      <label for="aiKey">API key (stored encrypted in Secret Vault)</label><input id="aiKey" type="password" autocomplete="off" placeholder="${esc(maskSecret(secrets.aiApiKey))}" style="width:100%"></div>
    <div><label for="aiApiVersion">API version (Azure/Anthropic)</label><input id="aiApiVersion" value="${esc(c.apiVersion)}"><div class="row"><div><label for="aiTemp">Temperature</label><input id="aiTemp" type="number" step="0.1" min="0" max="2" value="${c.temperature}" size="5"></div><div><label for="aiMax">Max tokens</label><input id="aiMax" type="number" value="${c.maxTokens}" size="6"></div><div><label for="aiTimeout">Timeout (ms)</label><input id="aiTimeout" type="number" value="${c.timeoutMs}" size="7"></div></div>
      <label for="aiExtra">Model-specific configuration (JSON)</label><textarea id="aiExtra">${esc(c.extraJson)}</textarea></div></div>
    <div class="row"><button class="primary" id="aiSave">Save</button><button id="aiTest">Test connection</button></div><div id="aiResult"></div></div>`;
    body.querySelector('#aiProvider').addEventListener('change', () => { const p = val('aiProvider'); body.querySelector('#aiEndpoint').value = PROVIDER_DEFAULTS[p].endpoint; body.querySelector('#aiAuth').value = PROVIDER_DEFAULTS[p].authType; });
    const read = () => ({ enabled: checked('aiEnabled'), provider: val('aiProvider'), model: val('aiModel').trim(), endpoint: val('aiEndpoint').trim(), authType: val('aiAuth'), apiVersion: val('aiApiVersion').trim(), temperature: Number(val('aiTemp')), maxTokens: Number(val('aiMax')), timeoutMs: Number(val('aiTimeout')) || 20000, extraJson: val('aiExtra') });
    const out = (k, m) => { body.querySelector('#aiResult').innerHTML = `<div class="issue-box ${k}">${multiline(redactSecrets(m, vault.knownSecrets()))}</div>`; };
    body.querySelector('#aiSave').addEventListener('click', async () => {
        const cfg = read();
        const key = val('aiKey').trim() || secrets.aiApiKey;
        const p = validateAiConfig(cfg, key);
        if (p.length) {
            out('error', `AI/LLM configuration invalid:\n• ${p.join('\n• ')}`);
            return;
        }
        try {
            if (key !== secrets.aiApiKey) {
                await vault.save({ ...secrets, aiApiKey: key });
                await reloadSecrets();
            }
            saveAiConfig(cfg);
            setAiConfig(cfg);
            toast('success', 'AI/LLM Model configuration saved.');
            rerender();
        }
        catch (e) {
            out('error', `Encryption failed: ${e.message}`);
        }
    });
    body.querySelector('#aiTest').addEventListener('click', async () => { const r = await requestSqlFromModel({ ...read(), enabled: true }, val('aiKey').trim() || secrets.aiApiKey, 'Return SELECT 1 FROM DUAL', 'DUAL(DUMMY)'); out('error' in r ? 'error' : 'ok', 'error' in r ? `${r.error.message}${r.error.details ? `\n• ${r.error.details.join('\n• ')}` : ''}\nThe offline NLU model remains available.` : 'The AI/LLM Model responded successfully.'); });
}
//# sourceMappingURL=settings.js.map