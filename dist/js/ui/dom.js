import { escapeHtml } from '../utils/dom.js';
import { makeId } from '../utils/id.js';
import { state } from '../state/store.js';
export const esc = escapeHtml;
export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
export function val(id) { return (document.getElementById(id)?.value ?? ''); }
export function checked(id) { return !!document.getElementById(id)?.checked; }
export function toast(kind, text) {
    const t = { id: makeId('t'), kind, text };
    state.toasts.push(t);
    const host = document.getElementById('toasts');
    if (!host)
        return;
    const d = document.createElement('div');
    d.className = `toast toast-${kind}`;
    d.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    d.textContent = text;
    host.appendChild(d);
    setTimeout(() => { d.remove(); state.toasts = state.toasts.filter((x) => x.id !== t.id); }, kind === 'error' ? 9000 : 4500);
}
export function multiline(text) { return esc(text).replace(/\n/g, '<br>'); }
export function options(values, selected, labels) { return values.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(labels?.[v] ?? v)}</option>`).join(''); }
//# sourceMappingURL=dom.js.map