import type { SchemaModel } from '../types';
import { icon } from './icons';
import { escapeHtml as e } from '../utils/dom';
export function renderTablePicker(container: HTMLElement, schema: SchemaModel, selected: string[], onChange: (next: string[]) => void): void {
  let searchTerm = ''; let current = [...selected]; let selectedModule = '';
  const matches = (n: string, m: string) => !searchTerm || n.toLowerCase().includes(searchTerm.toLowerCase()) || m.toLowerCase().includes(searchTerm.toLowerCase());
  const scope = () => { const tables = schema.tables.filter((t) => (!selectedModule || t.module === selectedModule) && matches(t.name, t.module)); return { tables, modules: selectedModule ? [selectedModule] : Array.from(new Set(tables.map((t) => t.module))) }; };
  function renderList(): void {
    const list = container.querySelector('.picker-list'); const count = container.querySelector('.picker-count'); if (!list) return;
    const { tables, modules } = scope();
    list.innerHTML = modules.map((m) => { const ts = tables.filter((t) => t.module === m); if (!ts.length) return ''; return `<div class="picker-group-label">${e(m)}</div>${ts.map((t) => `<label class="picker-row" data-table="${e(t.name)}"><input type="checkbox" ${current.includes(t.name) ? 'checked' : ''}/><span class="picker-row-main"><strong>${e(t.name)}${t.objectType === 'VIEW' ? ` <span class="chip chip-view">${icon('eye', 11)} VIEW</span>` : ''}</strong><span class="hint">${e(t.description)}</span></span></label>`).join('')}`; }).join('') || '<p class="hint">No tables match your search.</p>';
    if (count) count.textContent = `${current.length} selected`;
    list.querySelectorAll<HTMLElement>('.picker-row').forEach((row) => row.addEventListener('click', (ev) => { ev.preventDefault(); const n = row.dataset.table!; current = current.includes(n) ? current.filter((x) => x !== n) : [...current, n]; onChange([...current]); renderList(); }));
  }
  const modules = Array.from(new Set(schema.tables.map((t) => t.module))).sort();
  container.innerHTML = `<div class="picker"><select class="module-select" data-tour="module-selector" aria-label="Module"><option value="">All Modules</option>${modules.map((m) => `<option value="${e(m)}">${e(m)}</option>`).join('')}</select><div class="picker-search">${icon('search', 14)}<input type="text" class="picker-search-input" placeholder="Search tables…" aria-label="Search tables"/></div><div class="picker-actions"><button type="button" class="btn-link" data-action="select-all">Select all</button><button type="button" class="btn-link" data-action="clear">Clear</button><span class="picker-count"></span></div><div class="picker-list"></div></div>`;
  container.querySelector('.picker-search-input')!.addEventListener('input', (ev) => { searchTerm = (ev.target as HTMLInputElement).value; renderList(); });
  container.querySelector('.module-select')!.addEventListener('change', (ev) => { selectedModule = (ev.target as HTMLSelectElement).value; renderList(); });
  container.querySelector('[data-action="select-all"]')!.addEventListener('click', () => { current = scope().tables.map((t) => t.name); onChange([...current]); renderList(); });
  container.querySelector('[data-action="clear"]')!.addEventListener('click', () => { current = []; onChange([...current]); renderList(); });
  renderList();
}
