/** V17.0 — "Accept & Learn": adjust the generated SQL, then confirm it. Validated before it is used or learned. */
import { icon } from '../../components/icons';
import { openModal } from '../../components/modal';
import type { SchemaModel } from '../../types';
import { analyzeSqlAgainstSchema, type LearningStore } from '../services/learningStore';
import { renderErrorListHtml, escapeHtmlV17 as esc, makeError } from '../errors/appErrors';
export function openAcceptLearnModal(args: { sql: string; nlText: string; schema: SchemaModel; learning: LearningStore; learningId: string | null; onAccepted: (finalSql: string, modified: boolean) => void; toast: (k: 'success' | 'error' | 'info' | 'warning', t: string) => void }): void {
  const body = `<p class="hint">Review or adjust the SQL, then accept it. Accepted queries are validated against the Active Schema <strong>${esc(args.schema.name)}</strong> and become <em>confirmed</em> learned knowledge that improves future results for similar descriptions. One-off generated queries are never used as knowledge until repeated or confirmed.</p>
    <label class="block-label">Final SQL<textarea id="v17AcceptSql" rows="12" spellcheck="false" style="font-family:'Cascadia Code',Consolas,monospace;font-size:12.5px">${esc(args.sql)}</textarea></label>
    <div id="v17AcceptErrors"></div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" id="v17AcceptCancel">Cancel</button><button type="button" class="btn btn-primary" id="v17AcceptOk">${icon('check', 14)} Accept &amp; Learn</button></div>`;
  const modal = openModal(`${icon('check', 18)} Accept &amp; Learn`, body, { wide: true, closeOnBackdrop: false });
  const ta = modal.element.querySelector<HTMLTextAreaElement>('#v17AcceptSql')!; const errBox = modal.element.querySelector<HTMLElement>('#v17AcceptErrors')!;
  ta.addEventListener('input', () => { errBox.innerHTML = ''; });
  modal.element.querySelector('#v17AcceptCancel')?.addEventListener('click', () => modal.close());
  modal.element.querySelector('#v17AcceptOk')?.addEventListener('click', () => {
    const finalSql = ta.value.trim();
    const analysis = analyzeSqlAgainstSchema(finalSql, args.schema);
    if (!analysis.valid) { errBox.innerHTML = renderErrorListHtml([makeError('SQL_VALIDATION_FAILED', 'This SQL cannot be accepted.', analysis.problems.length ? analysis.problems : ['No table from the Active Schema was found in the SQL.'])], esc); return; }
    let id = args.learningId;
    if (!id && args.nlText.trim()) id = args.learning.recordGeneration({ nlText: args.nlText, schema: args.schema, generatedSql: args.sql }).id;
    const modified = finalSql.replace(/\s+/g, ' ').trim() !== args.sql.replace(/\s+/g, ' ').trim();
    if (id) { const res = args.learning.recordAcceptance(id, finalSql, args.schema); if (!res.ok && res.error) { errBox.innerHTML = renderErrorListHtml([res.error], esc); return; } args.toast('success', modified ? 'Modified SQL accepted and learned as confirmed knowledge.' : 'SQL accepted and learned as confirmed knowledge.'); }
    else args.toast('info', 'SQL accepted. (Nothing was learned because there is no description in "Describe What You Need" to learn it against.)');
    args.onAccepted(finalSql, modified); modal.close();
  });
}
