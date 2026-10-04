import type { SchemaModel, SelectedColumnSpec, ColumnDef } from '../types';
import { icon } from './icons';
import { makeId } from '../utils/id';
import { validateAlias } from '../utils/sqlIdentifier';
import { escapeHtml as e } from '../utils/dom';
export interface ColumnPickerCallbacks { onChange: (next: SelectedColumnSpec[]) => void; onRequestManualDecodeForColumn: (table: string, column: ColumnDef, existingSpecId: string) => void; }
export function renderColumnPicker(container: HTMLElement, schema: SchemaModel, selectedTables: string[], selectedColumns: SelectedColumnSpec[], cb: ColumnPickerCallbacks): void {
  let searchTerm = ''; let current = [...selectedColumns];
  const scope = () => selectedTables.flatMap((tn) => { const t = schema.tables.find((x) => x.name === tn); return t ? t.columns.map((c) => ({ table: tn, column: c })) : []; });
  const spec = (t: string, c: string) => current.find((x) => x.table === t && x.column === c && !x.manualExpr);
  function row(tn: string, c: ColumnDef): string {
    const s = spec(tn, c.name); const mode = s?.displayMode ?? 'raw';
    const controls = s ? `<div class="column-row-controls"><label class="column-inline-label">Alias<input type="text" class="column-alias-input" value="${e(s.alias)}" placeholder="optional"/></label><label class="column-inline-label">Display as<select class="column-mode-select"><option value="raw" ${mode === 'raw' ? 'selected' : ''}>Column</option>${c.decode?.length ? `<option value="schema-decode" ${mode === 'schema-decode' ? 'selected' : ''}>Schema DECODE</option>` : ''}<option value="manual-decode" ${mode === 'manual-decode' ? 'selected' : ''}>Manual DECODE…</option></select></label></div><div class="column-alias-error"></div>` : '';
    return `<div class="column-row ${s ? 'is-selected' : ''}" data-table="${e(tn)}" data-column="${e(c.name)}"><label class="column-row-checkbox-label"><input type="checkbox" class="column-checkbox" ${s ? 'checked' : ''}/><span class="picker-row-main"><strong>${e(c.name)}</strong><span class="hint">${e(c.type)}${c.length ? `(${c.length})` : ''}${c.isPrimaryKey ? ' · PK' : ''}${c.isForeignKey ? ' · FK' : ''}</span></span></label>${controls}</div>`;
  }
  function renderList(): void {
    const list = container.querySelector('.picker-list'); const count = container.querySelector('.picker-count'); const all = container.querySelector<HTMLInputElement>('.select-all-checkbox'); if (!list) return;
    if (!selectedTables.length) { list.innerHTML = '<p class="hint">Select one or more tables first.</p>'; if (count) count.textContent = ''; if (all) { all.checked = false; all.disabled = true; } return; }
    const sc = scope(); if (all) { all.disabled = false; all.checked = sc.length > 0 && sc.every((r) => !!spec(r.table, r.column.name)); }
    const term = searchTerm.toLowerCase();
    list.innerHTML = selectedTables.map((tn) => { const t = schema.tables.find((x) => x.name === tn); if (!t) return ''; const cols = t.columns.filter((c) => !term || c.name.toLowerCase().includes(term) || (c.label || '').toLowerCase().includes(term)); return cols.length ? `<div class="picker-group-label">${e(tn)}</div>${cols.map((c) => row(tn, c)).join('')}` : ''; }).join('') || '<p class="hint">No columns match your search.</p>';
    if (count) count.textContent = `${current.filter((c) => !c.manualExpr).length} selected`;
    list.querySelectorAll<HTMLElement>('.column-row').forEach((r) => {
      const t = r.dataset.table!; const cn = r.dataset.column!; const def = schema.tables.find((x) => x.name === t)?.columns.find((x) => x.name === cn); if (!def) return;
      r.querySelector('.column-checkbox')?.addEventListener('click', (ev) => { ev.stopPropagation(); current = spec(t, cn) ? current.filter((x) => !(x.table === t && x.column === cn && !x.manualExpr)) : [...current, { id: makeId('col'), table: t, column: cn, alias: '', useDecode: false, aggregate: null, displayMode: 'raw' }]; cb.onChange([...current]); renderList(); });
      r.querySelector('.column-alias-input')?.addEventListener('input', (ev) => { const v = (ev.target as HTMLInputElement).value; const s = spec(t, cn); if (!s) return; const val = validateAlias(v); const box = r.querySelector('.column-alias-error'); if (box) box.innerHTML = val.valid ? '' : `<span class="hint" style="color:#d64550">${e(val.message || '')}</span>`; if (val.valid) { s.alias = v.trim(); cb.onChange([...current]); } });
      r.querySelector('.column-mode-select')?.addEventListener('change', (ev) => { const v = (ev.target as HTMLSelectElement).value as 'raw' | 'schema-decode' | 'manual-decode'; const s = spec(t, cn); if (!s) return; if (v === 'manual-decode') { cb.onRequestManualDecodeForColumn(t, def, s.id); return; } s.displayMode = v; s.useDecode = v === 'schema-decode'; cb.onChange([...current]); renderList(); });
    });
  }
  container.innerHTML = `<div class="picker"><div class="picker-search">${icon('search', 14)}<input type="text" class="picker-search-input" placeholder="Search columns…" aria-label="Search columns"/></div><label class="select-all-row"><input type="checkbox" class="select-all-checkbox"/> ${icon('checkbox-checked', 14)} Select All (all columns for the selected table(s) — search only filters what's shown)</label><div class="picker-actions"><button type="button" class="btn-link" data-action="clear">Clear</button><span class="picker-count"></span></div><div class="picker-list"></div></div>`;
  container.querySelector('.picker-search-input')!.addEventListener('input', (ev) => { searchTerm = (ev.target as HTMLInputElement).value; renderList(); });
  container.querySelector('.select-all-checkbox')!.addEventListener('change', (ev) => { if ((ev.target as HTMLInputElement).checked) scope().forEach((r) => { if (!spec(r.table, r.column.name)) current.push({ id: makeId('col'), table: r.table, column: r.column.name, alias: '', useDecode: false, aggregate: null, displayMode: 'raw' }); }); else { const set = new Set(selectedTables); current = current.filter((c) => c.manualExpr || !set.has(c.table)); } cb.onChange([...current]); renderList(); });
  container.querySelector('[data-action="clear"]')!.addEventListener('click', () => { current = current.filter((c) => c.manualExpr); cb.onChange([...current]); renderList(); });
  renderList();
}
