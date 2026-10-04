import { icon } from './icons';
import { openModal } from './modal';
import { schemaService } from '../services/schemaService';
import { escapeHtml as e } from '../utils/dom';
/** #schemaNameError is an empty container; markup is inserted only when there is a real error. */
export function openSchemaNameModal(opts: { title: string; suggestedName?: string; originalFileName?: string; onConfirm: (name: string) => void }): void {
  const modal = openModal(`${icon('edit', 18)} ${e(opts.title)}`, `<p class="hint">${opts.originalFileName ? `Uploaded file: <code>${e(opts.originalFileName)}</code> — this filename will NOT be used as the schema name.` : 'Choose a meaningful name for this schema — it will be shown throughout SQL Assistant and preserved across every synchronized device.'}</p><label class="block-label">Schema Name *<input type="text" id="schemaNameInput" value="${e(opts.suggestedName || '')}"/></label><div id="schemaNameError"></div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="schemaNameCancel">Cancel</button><button type="button" class="btn btn-primary" id="schemaNameConfirm">${icon('check', 14)} Confirm Name</button></div>`, { closeOnBackdrop: false });
  const input = modal.element.querySelector<HTMLInputElement>('#schemaNameInput')!; const err = modal.element.querySelector<HTMLElement>('#schemaNameError')!;
  const show = (m: string | null) => { err.innerHTML = m ? `<div class="issue-box mini">${icon('alert-triangle', 14)} ${e(m)}</div>` : ''; };
  input.addEventListener('input', () => show(schemaService.validateNewSchemaName(input.value)));
  modal.element.querySelector('#schemaNameCancel')!.addEventListener('click', () => modal.close());
  modal.element.querySelector('#schemaNameConfirm')!.addEventListener('click', () => { const m = schemaService.validateNewSchemaName(input.value); if (m) { show(m); return; } opts.onConfirm(input.value.trim()); modal.close(); });
}
