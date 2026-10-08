/**
 * V17.5.1 — Settings → Synchronization → "Admin message". The administrator writes one short plain-text message (140 characters) that every device shows in
 * its navbar. Published through the existing repository connection; clearing it clears it everywhere. Settings are already behind the Admin Password.
 */
import { icon } from '../components/icons'; import { store } from '../state'; import { services } from '../context'; import { e } from '../dom';
import { ADMIN_MESSAGE_MAX, checkMessageText, type AdminMessageLevel } from '../../v17/services/adminMessage';
let result = '';
const box = (kind: 'ok' | 'warn' | 'err', html: string) => `<div class="issue-box ${kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : ''} mini" role="${kind === 'err' ? 'alert' : 'status'}">${icon(kind === 'ok' ? 'check' : 'alert-triangle', 14)}<div>${html}</div></div>`;
const when = (iso: string) => iso.replace('T', ' ').slice(0, 16);
export function adminMessagePanelHtml(): string {
  const { adminMessage } = services(); const r = adminMessage.record(); const live = r && r.active ? r : null;
  return `<div class="builder-panel mt" data-v1751-admin-message><h2>${icon('info', 16)} Admin message — shown in the navbar of every device</h2>
    <p class="hint">One short plain-text message (up to ${ADMIN_MESSAGE_MAX} characters, shown as text only — no formatting or links). It is published through the same repository connection as the schemas and appears on the other devices when they open SQL Assistant or synchronize. Each user can hide it on their own device; a new message appears again. Do not write passwords or tokens here — the repository file is not encrypted.</p>
    <div class="form-row-2"><label class="block-label">Message<input type="text" id="adminMsgText" maxlength="${ADMIN_MESSAGE_MAX * 2}" autocomplete="off" spellcheck="true" aria-describedby="adminMsgCount" placeholder="e.g. Maintenance tonight 22:00–23:00 CET — schema sync may be unavailable."></label>
    <label class="block-label">Type<select id="adminMsgLevel"><option value="info">Information</option><option value="warning">Warning</option></select></label></div>
    <div class="hint" id="adminMsgCount" aria-live="polite">0 / ${ADMIN_MESSAGE_MAX}</div>
    <div class="row-actions"><button type="button" class="btn btn-primary" id="adminMsgPublish">${icon('upload', 14)} Publish message</button><button type="button" class="btn btn-outline" id="adminMsgClear" ${live ? '' : 'disabled'}>${icon('x', 14)} Clear message on all devices</button></div>
    <p class="hint" id="adminMsgCurrent">${live ? `Current message (${live.level === 'warning' ? 'warning' : 'information'}, ${e(when(live.updatedAt))} UTC${adminMessage.pendingPublish() ? ' — <strong>not yet published</strong>' : ''}): <q>${e(live.text)}</q>` : 'No message is published.'}</p>
    <div id="adminMsgResult" aria-live="polite">${result}</div></div>`;
}
export function wireAdminMessage(p: HTMLElement, rerender: () => void): void {
  const { adminMessage } = services(); const root = p.querySelector<HTMLElement>('[data-v1751-admin-message]'); if (!root) return;
  const text = root.querySelector<HTMLInputElement>('#adminMsgText')!; const level = root.querySelector<HTMLSelectElement>('#adminMsgLevel')!; const count = root.querySelector<HTMLElement>('#adminMsgCount')!; const out = root.querySelector<HTMLElement>('#adminMsgResult')!; const show = (h: string) => { result = h; out.innerHTML = h; };
  const cur = adminMessage.record(); if (cur?.active) { text.value = cur.text; level.value = cur.level; }
  const upd = () => { const n = [...checkMessageText(text.value).text].length; count.textContent = `${n} / ${ADMIN_MESSAGE_MAX}`; count.style.color = n > ADMIN_MESSAGE_MAX ? '#d64550' : ''; }; text.addEventListener('input', upd); upd();
  const busy = (on: boolean) => root.querySelectorAll('button').forEach((b) => (on ? b.setAttribute('disabled', '') : b.removeAttribute('disabled')));
  root.querySelector('#adminMsgPublish')!.addEventListener('click', async () => { const c = checkMessageText(text.value); if (c.problem) { show(box('err', e(c.problem))); return; } busy(true); show(box('warn', 'Publishing…'));
    const r = await adminMessage.publish(c.text, level.value as AdminMessageLevel); show(r.ok ? box(r.published ? 'ok' : 'warn', e(r.message)) : box('err', e(r.message))); if (r.ok) store.pushToast(r.published ? 'success' : 'warning', r.published ? 'Admin message published.' : 'Admin message saved on this device — not yet published.'); rerender(); });
  root.querySelector('#adminMsgClear')?.addEventListener('click', async () => { if (!confirm('Clear the admin message on all devices?')) return; busy(true); show(box('warn', 'Clearing…')); const r = await adminMessage.clear(); show(r.ok ? box(r.published ? 'ok' : 'warn', e(r.message)) : box('err', e(r.message))); text.value = ''; rerender(); });
}
