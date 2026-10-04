import { icon } from './icons';
import { escapeHtml as e } from '../utils/dom';
export interface DataTableColumn<T> { key: string; label: string; render?: (row: T) => string; sortValue?: (row: T) => string | number; width?: string; }
export interface DataTableOptions<T> { columns: DataTableColumn<T>[]; rows: T[]; getRowId: (row: T) => string; pageSize?: number; searchPredicate?: (row: T, term: string) => boolean; onRowClick?: (row: T) => void; selectedRowId?: string | null; emptyMessage?: string; }
export function renderDataTable<T>(container: HTMLElement, opts: DataTableOptions<T>): { refresh: (rows: T[], keepSelectedId?: string | null) => void; getSelectedId: () => string | null } {
  const pageSize = opts.pageSize ?? 50; let all = opts.rows; let term = ''; let sortKey: string | null = null; let dir: 'asc' | 'desc' = 'asc'; let page = 0; let selected: string | null = opts.selectedRowId ?? null;
  const rowsNow = () => { let r = all; if (term) r = r.filter((x) => opts.searchPredicate?.(x, term.toLowerCase())); if (sortKey) { const c = opts.columns.find((x) => x.key === sortKey); if (c?.sortValue) r = [...r].sort((a, b) => { const av = c.sortValue!(a); const bv = c.sortValue!(b); const cmp = av < bv ? -1 : av > bv ? 1 : 0; return dir === 'asc' ? cmp : -cmp; }); } return r; };
  function body(): void {
    const tbody = container.querySelector('tbody'); if (!tbody) return; const f = rowsNow(); const pages = Math.max(1, Math.ceil(f.length / pageSize)); page = Math.min(page, pages - 1);
    const slice = f.slice(page * pageSize, page * pageSize + pageSize);
    tbody.innerHTML = slice.length ? slice.map((r) => { const id = opts.getRowId(r); return `<tr data-row-id="${e(id)}" class="${id === selected ? 'is-selected' : ''}" aria-selected="${id === selected}" tabindex="0">${opts.columns.map((c) => `<td>${c.render ? c.render(r) : e(String((r as any)[c.key] ?? ''))}</td>`).join('')}</tr>`; }).join('') : `<tr><td class="data-table-empty" colspan="${opts.columns.length}">${e(opts.emptyMessage || 'No rows found.')}</td></tr>`;
    container.querySelector('.data-table-count')!.textContent = `${f.length} row(s)${term ? ` matching "${term}"` : ''}`;
    container.querySelector('.dt-page-label')!.textContent = `Page ${page + 1} of ${pages}`;
    (container.querySelector('#dtPrevBtn') as HTMLButtonElement).disabled = page === 0; (container.querySelector('#dtNextBtn') as HTMLButtonElement).disabled = page >= pages - 1;
    tbody.querySelectorAll<HTMLElement>('tr[data-row-id]').forEach((tr) => { const act = () => { selected = tr.dataset.rowId!; const row = all.find((x) => opts.getRowId(x) === selected); if (row) opts.onRowClick?.(row); body(); }; tr.addEventListener('click', act); tr.addEventListener('keydown', (ev) => { if ((ev as KeyboardEvent).key === 'Enter') act(); }); });
  }
  container.innerHTML = `<div class="data-table-toolbar">${icon('search', 14)}<input type="text" class="data-table-search" placeholder="Search…" aria-label="Search rows"/><span class="data-table-count hint"></span></div><div class="data-table-scroll-wrap"><table class="data-table"><thead><tr>${opts.columns.map((c) => `<th class="${c.sortValue ? 'sortable' : ''}" data-key="${c.key}" ${c.width ? `style="width:${c.width}"` : ''}>${e(c.label)}</th>`).join('')}</tr></thead><tbody></tbody></table></div><div class="data-table-pagination"><button type="button" id="dtPrevBtn" class="btn btn-ghost btn-sm">${icon('chevron-left', 14)} Prev</button><span class="dt-page-label hint"></span><button type="button" id="dtNextBtn" class="btn btn-ghost btn-sm">Next ${icon('chevron-right', 14)}</button></div>`;
  container.querySelector('.data-table-search')!.addEventListener('input', (ev) => { term = (ev.target as HTMLInputElement).value; page = 0; body(); });
  container.querySelectorAll<HTMLElement>('th.sortable').forEach((th) => th.addEventListener('click', () => { const k = th.dataset.key!; if (sortKey === k) dir = dir === 'asc' ? 'desc' : 'asc'; else { sortKey = k; dir = 'asc'; } body(); }));
  container.querySelector('#dtPrevBtn')!.addEventListener('click', () => { page = Math.max(0, page - 1); body(); });
  container.querySelector('#dtNextBtn')!.addEventListener('click', () => { page += 1; body(); });
  body();
  return { refresh: (rows, keepSelectedId = null) => { all = rows; selected = keepSelectedId && rows.some((r) => opts.getRowId(r) === keepSelectedId) ? keepSelectedId : null; body(); }, getSelectedId: () => selected };
}
