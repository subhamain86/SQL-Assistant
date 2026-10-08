import type { SchemaModel } from '../../types'; import { icon } from './icons'; import { e } from '../dom';
import { selectorUi } from '../selectorState';
export interface TablePickerCtl { update(selected: string[]): void; }
/**
 * V17.4: mounted ONCE. Module filter, search text and scroll position live in `selectorUi` (centralized) and are restored on every render;
 * a table click toggles that row natively and in place — the list is never rebuilt, so nothing the user typed or scrolled is lost.
 */
export function renderTablePicker(container: HTMLElement, schema: SchemaModel, selected: string[], onChange: (next: string[]) => void): TablePickerCtl {
  const ui = selectorUi; let current = [...selected];
  const matches = (n: string, m: string, d: string) => !ui.tableSearch || `${n} ${m} ${d}`.toLowerCase().includes(ui.tableSearch.toLowerCase());
  const scope = () => { const tables = schema.tables.filter((t) => (!ui.tableModule || t.module === ui.tableModule) && matches(t.name, t.module, t.description)); return { tables, modules: ui.tableModule ? [ui.tableModule] : Array.from(new Set(tables.map((t) => t.module))) }; };
  const count = () => { const c = container.querySelector('.picker-count'); if (c) c.textContent = `${current.length} selected`; };
  function renderList(): void {
    const list = container.querySelector<HTMLElement>('.picker-list'); if (!list) return; const keep = list.scrollTop || ui.tableScroll; const { tables, modules } = scope();
    list.innerHTML = modules.map((m) => { const ts = tables.filter((t) => t.module === m); if (!ts.length) return ''; return `<div class="picker-group-label">${e(m)}</div>${ts.slice(0, 400).map((t) => `<label class="picker-row" data-table="${e(t.name)}"><input type="checkbox" ${current.includes(t.name) ? 'checked' : ''}><span class="picker-row-main"><strong>${e(t.name)}${t.objectType === 'VIEW' ? ` <span class="chip chip-view">${icon('eye', 11)} VIEW</span>` : ''}</strong><span class="hint">${e(t.description)}</span></span></label>`).join('')}`; }).join('') || '<p class="hint">No tables match your search.</p>';
    count(); list.scrollTop = keep;
    // V17.5: the native checkbox is the single source of truth. A click on the row text or on the box toggles it natively (the tick is
    // therefore visible in the same frame) and the `change` event updates the state. Nothing calls preventDefault(), which is what made
    // the browser revert the tick when the box itself was clicked.
    list.querySelectorAll<HTMLElement>('.picker-row').forEach((row) => { const n = row.dataset.table!; const box = row.querySelector<HTMLInputElement>('input'); if (!box) return;
      box.addEventListener('change', () => { current = box.checked ? (current.includes(n) ? current : [...current, n]) : current.filter((x) => x !== n); box.checked = current.includes(n); count(); onChange([...current]); }); });
  }
  const modules = Array.from(new Set(schema.tables.map((t) => t.module))).sort();
  container.innerHTML = `<div class="picker"><select class="module-select" aria-label="Module" data-tour="module-selector"><option value="">All Modules</option>${modules.map((m) => `<option>${e(m)}</option>`).join('')}</select><div class="picker-search">${icon('search', 14)}<input type="text" class="picker-search-input" placeholder="Search tables…" aria-label="Search tables"></div><div class="picker-actions"><button type="button" class="btn-link" data-action="select-all">Select all</button><button type="button" class="btn-link" data-action="clear">Clear</button><span class="picker-count"></span></div><div class="picker-list"></div></div>`;
  const search = container.querySelector<HTMLInputElement>('.picker-search-input')!; const mod = container.querySelector<HTMLSelectElement>('.module-select')!;
  if (ui.tableModule && !modules.includes(ui.tableModule)) ui.tableModule = ''; mod.value = ui.tableModule; search.value = ui.tableSearch;
  search.addEventListener('input', () => { ui.tableSearch = search.value; renderList(); });
  mod.addEventListener('change', () => { ui.tableModule = mod.value; renderList(); });
  container.querySelector('.picker-list')!.addEventListener('scroll', (ev) => { ui.tableScroll = (ev.target as HTMLElement).scrollTop; });
  container.querySelector('[data-action="select-all"]')!.addEventListener('click', () => { current = Array.from(new Set([...current, ...scope().tables.map((t) => t.name)])); onChange([...current]); renderList(); });
  container.querySelector('[data-action="clear"]')!.addEventListener('click', () => { current = []; onChange([...current]); renderList(); });
  renderList();
  return { update(sel) { current = [...sel]; renderList(); } };
}
