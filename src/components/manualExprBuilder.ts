import { icon } from './icons';
import { openModal } from './modal';
import { buildManualCaseExpression, buildManualDecodeExpression } from '../engines/decodeEngine';
import type { Dialect, SelectedColumnSpec } from '../types';
import { makeId } from '../utils/id';
import { escapeHtml as e } from '../utils/dom';
import { validateAlias } from '../utils/sqlIdentifier';
export interface ManualPrefill { table: string; column: string; }
const issuesHtml = (list: string[]) => `<div class="issue-box mini">${icon('alert-triangle', 14)}<ul>${list.map((i) => `<li>${e(i)}</li>`).join('')}</ul></div>`;
export function openManualCaseBuilder(_dialect: Dialect, onAdd: (spec: SelectedColumnSpec) => void, prefill?: ManualPrefill): void {
  const seed = prefill ? `${prefill.table}.${prefill.column} = 'X'` : '';
  const modal = openModal(`${icon('code', 18)} Manual CASE Expression${prefill ? ` — ${e(prefill.table)}.${e(prefill.column)}` : ''}`, `<p class="hint">Build a CASE expression manually — useful when the column you need doesn't already have a schema-defined CASE/DECODE.</p><div id="whenRows" class="filter-rows"></div><button type="button" id="addWhenBtn" class="btn btn-outline btn-sm">${icon('plus', 14)} Add WHEN</button><div class="form-row-2"><label class="block-label">ELSE value<input type="text" id="caseElse"/></label><label class="block-label">Alias *<input type="text" id="caseAlias"/></label></div><div id="caseIssues"></div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="caseCancel">Cancel</button><button type="button" class="btn btn-primary" id="caseSave">${icon('save', 14)} Add Column</button></div>`, { wide: true });
  const rows = modal.element.querySelector<HTMLElement>('#whenRows')!; const whens = [{ whenExpr: seed, thenValue: '' }];
  const render = () => { rows.innerHTML = whens.map((w, i) => `<div class="mini-row" data-idx="${i}"><span>WHEN</span><input type="text" class="when-expr" value="${e(w.whenExpr)}" placeholder="TABLE.COLUMN = 'X'"/><span>THEN</span><input type="text" class="when-then" value="${e(w.thenValue)}" placeholder="Label"/><button type="button" class="icon-btn remove-when" aria-label="Remove">${icon('trash', 14)}</button></div>`).join(''); rows.querySelectorAll<HTMLElement>('.mini-row').forEach((r) => { const i = +r.dataset.idx!; r.querySelector('.when-expr')!.addEventListener('input', (ev) => { whens[i].whenExpr = (ev.target as HTMLInputElement).value; }); r.querySelector('.when-then')!.addEventListener('input', (ev) => { whens[i].thenValue = (ev.target as HTMLInputElement).value; }); r.querySelector('.remove-when')!.addEventListener('click', () => { whens.splice(i, 1); render(); }); }); };
  render();
  modal.element.querySelector('#addWhenBtn')!.addEventListener('click', () => { whens.push({ whenExpr: '', thenValue: '' }); render(); });
  modal.element.querySelector('#caseCancel')!.addEventListener('click', () => modal.close());
  modal.element.querySelector('#caseSave')!.addEventListener('click', () => {
    const alias = modal.element.querySelector<HTMLInputElement>('#caseAlias')!.value.trim(); const elseVal = modal.element.querySelector<HTMLInputElement>('#caseElse')!.value; const box = modal.element.querySelector<HTMLElement>('#caseIssues')!;
    const issues: string[] = []; if (!alias) issues.push('Alias is required.'); else { const v = validateAlias(alias); if (!v.valid) issues.push(v.message!); }
    const valid = whens.filter((w) => w.whenExpr.trim() && w.thenValue.trim()); if (!valid.length) issues.push('Add at least one complete WHEN / THEN pair.');
    if (issues.length) { box.innerHTML = issuesHtml(issues); return; }
    onAdd({ id: makeId('col'), table: '', column: alias, alias, useDecode: false, aggregate: null, manualExpr: buildManualCaseExpression(valid, elseVal, alias) }); modal.close();
  });
}
export function openManualDecodeBuilder(dialect: Dialect, onAdd: (spec: SelectedColumnSpec) => void, prefill?: ManualPrefill, replaceSpecId?: string, seedAliasOverride?: string): void {
  const seedSource = prefill ? `${prefill.table}.${prefill.column}` : ''; const seedAlias = seedAliasOverride || (prefill ? `${prefill.column}_DESC` : '');
  const modal = openModal(`${icon('sparkles', 18)} Manual DECODE Expression${prefill ? ` — ${e(prefill.table)}.${e(prefill.column)}` : ''}`, `<p class="hint">Build a DECODE (Oracle) / CASE (other dialects) expression manually.</p><label class="block-label">Source column/expression *<input type="text" id="decodeSource" value="${e(seedSource)}"/></label><div id="pairRows" class="filter-rows mt"></div><button type="button" id="addPairBtn" class="btn btn-outline btn-sm">${icon('plus', 14)} Add raw=label pair</button><div class="form-row-2"><label class="block-label">ELSE value<input type="text" id="decodeElse"/></label><label class="block-label">Alias *<input type="text" id="decodeAlias" value="${e(seedAlias)}"/></label></div><div id="decodeIssues"></div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="decodeCancel">Cancel</button><button type="button" class="btn btn-primary" id="decodeSave">${icon('save', 14)} ${replaceSpecId ? 'Apply' : 'Add Column'}</button></div>`, { wide: true });
  const rows = modal.element.querySelector<HTMLElement>('#pairRows')!; const pairs = [{ rawValue: '', label: '' }];
  const render = () => { rows.innerHTML = pairs.map((p, i) => `<div class="mini-row" data-idx="${i}"><input type="text" class="pair-raw" value="${e(p.rawValue)}" placeholder="raw value"/><span>=</span><input type="text" class="pair-label" value="${e(p.label)}" placeholder="label"/><button type="button" class="icon-btn remove-pair" aria-label="Remove">${icon('trash', 14)}</button></div>`).join(''); rows.querySelectorAll<HTMLElement>('.mini-row').forEach((r) => { const i = +r.dataset.idx!; r.querySelector('.pair-raw')!.addEventListener('input', (ev) => { pairs[i].rawValue = (ev.target as HTMLInputElement).value; }); r.querySelector('.pair-label')!.addEventListener('input', (ev) => { pairs[i].label = (ev.target as HTMLInputElement).value; }); r.querySelector('.remove-pair')!.addEventListener('click', () => { pairs.splice(i, 1); render(); }); }); };
  render();
  modal.element.querySelector('#addPairBtn')!.addEventListener('click', () => { pairs.push({ rawValue: '', label: '' }); render(); });
  modal.element.querySelector('#decodeCancel')!.addEventListener('click', () => modal.close());
  modal.element.querySelector('#decodeSave')!.addEventListener('click', () => {
    const source = modal.element.querySelector<HTMLInputElement>('#decodeSource')!.value.trim(); const alias = modal.element.querySelector<HTMLInputElement>('#decodeAlias')!.value.trim(); const elseVal = modal.element.querySelector<HTMLInputElement>('#decodeElse')!.value; const box = modal.element.querySelector<HTMLElement>('#decodeIssues')!;
    const issues: string[] = []; if (!source) issues.push('Source column/expression is required.'); if (!alias) issues.push('Alias is required.'); else { const v = validateAlias(alias); if (!v.valid) issues.push(v.message!); }
    const valid = pairs.filter((p) => p.rawValue.trim() && p.label.trim()); if (!valid.length) issues.push('Add at least one complete raw=label pair.');
    if (issues.length) { box.innerHTML = issuesHtml(issues); return; }
    onAdd({ id: replaceSpecId || makeId('col'), table: replaceSpecId ? (prefill?.table || '') : '', column: replaceSpecId ? (prefill?.column || alias) : alias, alias, useDecode: false, aggregate: null, manualExpr: buildManualDecodeExpression(source, valid, elseVal, alias, dialect), displayMode: 'manual-decode' }); modal.close();
  });
}
