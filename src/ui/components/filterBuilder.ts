import type { SchemaModel, FilterCondition, FilterOperator, Dialect } from '../../types'; import { icon } from './icons'; import { FILTER_OPERATORS, requiresValue } from '../../engines/filterEngine'; import { makeId } from '../../utils/id'; import { e } from '../dom';
import { agoExpr, startOfExpr, todayExpr } from '../../v17/engines/dateExpressions'; import { isDateType } from '../../v17/engines/schemaContext';
import { selectorUi } from '../selectorState';
export interface FilterBuilderCtl { update(selectedTables: string[], filters: FilterCondition[]): void; }
const PRESETS: { id: string; label: string; expr: (d: Dialect) => string }[] = [
  { id: 'today', label: 'Today', expr: (d) => todayExpr(d) }, { id: 'd7', label: 'Last 7 days', expr: (d) => agoExpr(7, 'DAY', d) }, { id: 'd30', label: 'Last 30 days', expr: (d) => agoExpr(30, 'DAY', d) }, { id: 'd90', label: 'Last 90 days', expr: (d) => agoExpr(90, 'DAY', d) },
  { id: 'week', label: 'This week', expr: (d) => startOfExpr('WEEK', 0, d) }, { id: 'month', label: 'This month', expr: (d) => startOfExpr('MONTH', 0, d) }, { id: 'year', label: 'This year', expr: (d) => startOfExpr('YEAR', 0, d) }];
/**
 * V17.4: mounted once. Filters on tables that are not selected right now are KEPT (they return when the table is selected again) and
 * simply not shown; typing in a value never rebuilds the list. DATE columns get a "date shortcut" for date filtering / ranges.
 */
export function renderFilterBuilder(container: HTMLElement, schema: SchemaModel, initialTables: string[], filters: FilterCondition[], onChange: (next: FilterCondition[]) => void, getDialect: () => Dialect = () => 'Oracle'): FilterBuilderCtl {
  let tables = [...initialTables]; let all = filters.map((f) => ({ ...f }));
  const cols = () => tables.flatMap((t) => (schema.tables.find((x) => x.name === t)?.columns || []).map((c) => ({ table: t, column: c.name, label: `${t}.${c.name}`, date: isDateType(c.type) })));
  const isDate = (f: FilterCondition) => { const c = schema.tables.find((x) => x.name === f.table)?.columns.find((x) => x.name === f.column); return !!c && isDateType(c.type); };
  function draw(): void {
    const keep = container.querySelector<HTMLElement>('.filter-rows')?.scrollTop ?? selectorUi.filterScroll; const cs = cols(); if (!tables.length) { container.innerHTML = '<p class="hint">Select one or more tables first.</p>'; return; }
    const rows = all.map((f, idx) => ({ f, idx })).filter((x) => tables.includes(x.f.table)); const hidden = all.length - rows.length;
    container.innerHTML = `<div class="filter-rows">${rows.map(({ f, idx }, vis) => `<div class="filter-row" data-idx="${idx}">${vis > 0 ? `<select class="combinator-select" aria-label="Combinator" title="AND = both conditions must be true · OR = either one" style="flex:0 0 72px"><option ${f.combinator === 'AND' ? 'selected' : ''}>AND</option><option ${f.combinator === 'OR' ? 'selected' : ''}>OR</option></select>` : '<span class="filter-where-label" title="WHERE keeps only the rows that match your conditions">WHERE</span>'}<select class="col-select" aria-label="Column">${cs.map((c) => `<option value="${e(`${c.table}::${c.column}`)}" ${c.table === f.table && c.column === f.column ? 'selected' : ''}>${e(c.label)}</option>`).join('')}</select><select class="op-select" aria-label="Operator">${FILTER_OPERATORS.map((o) => `<option value="${e(o.op)}" title="${e(o.label)}" ${o.op === f.operator ? 'selected' : ''}>${e(o.op)}</option>`).join('')}</select>${requiresValue(f.operator) ? `<input type="text" class="val-input" value="${e(f.value)}" placeholder="${f.operator.includes('IN') ? 'a, b, c' : 'value'}" aria-label="Value">` : ''}${f.operator === 'BETWEEN' ? `<span>and</span><input type="text" class="val2-input" value="${e(f.value2 || '')}" aria-label="Second value">` : ''}${isDate(f) ? `<select class="date-preset" aria-label="Date shortcut" title="Fill in a date condition for this dialect"><option value="">Date shortcut…</option>${PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')}</select>` : ''}<button type="button" class="icon-btn remove-btn" aria-label="Remove filter">${icon('trash', 14)}</button></div>`).join('')}</div>${hidden ? `<p class="hint">${hidden} filter(s) on tables that are not selected are kept and become active again when you select those tables.</p>` : ''}<button type="button" class="btn btn-outline btn-sm add-filter-btn">${icon('plus', 14)} Add filter</button>`;
    const box = container.querySelector<HTMLElement>('.filter-rows'); if (box) box.scrollTop = keep;
    container.querySelectorAll<HTMLElement>('.filter-row').forEach((row) => { const i = parseInt(row.dataset.idx || '0', 10);
      row.querySelector('.combinator-select')?.addEventListener('change', (ev) => { all[i].combinator = (ev.target as HTMLSelectElement).value as 'AND' | 'OR'; onChange([...all]); });
      row.querySelector('.col-select')?.addEventListener('change', (ev) => { const [t, c] = (ev.target as HTMLSelectElement).value.split('::'); all[i].table = t; all[i].column = c; onChange([...all]); draw(); });
      row.querySelector('.op-select')?.addEventListener('change', (ev) => { all[i].operator = (ev.target as HTMLSelectElement).value as FilterOperator; onChange([...all]); draw(); });
      row.querySelector('.val-input')?.addEventListener('input', (ev) => { all[i].value = (ev.target as HTMLInputElement).value; onChange([...all]); });
      row.querySelector('.val2-input')?.addEventListener('input', (ev) => { all[i].value2 = (ev.target as HTMLInputElement).value; onChange([...all]); });
      row.querySelector('.date-preset')?.addEventListener('change', (ev) => { const p = PRESETS.find((x) => x.id === (ev.target as HTMLSelectElement).value); if (!p) return; all[i].operator = '>='; all[i].value = p.expr(getDialect()); all[i].value2 = undefined; onChange([...all]); draw(); });
      row.querySelector('.remove-btn')?.addEventListener('click', () => { all.splice(i, 1); onChange([...all]); draw(); }); });
    container.querySelector('.add-filter-btn')?.addEventListener('click', () => { if (!cs.length) return; all.push({ id: makeId('filt'), table: cs[0].table, column: cs[0].column, operator: '=', value: '', combinator: 'AND' }); onChange([...all]); draw(); });
  }
  draw();
  return { update(t, f) { tables = [...t]; all = f.map((x) => ({ ...x })); draw(); } };
}
