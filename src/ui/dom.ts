import { escapeHtml } from '../utils/dom';
import { makeId } from '../utils/id';
import { state } from '../state/store';
export const esc = escapeHtml;
export function $(sel: string, root: ParentNode = document): HTMLElement | null { return root.querySelector(sel) as HTMLElement | null; }
export function $$(sel: string, root: ParentNode = document): HTMLElement[] { return Array.from(root.querySelectorAll(sel)) as HTMLElement[]; }
export function val(id: string): string { return ((document.getElementById(id) as HTMLInputElement | null)?.value ?? ''); }
export function checked(id: string): boolean { return !!(document.getElementById(id) as HTMLInputElement | null)?.checked; }
export function toast(kind: 'success' | 'error' | 'info' | 'warning', text: string): void {
  const t = { id: makeId('t'), kind, text }; state.toasts.push(t);
  const host = document.getElementById('toasts'); if (!host) return;
  const d = document.createElement('div'); d.className = `toast toast-${kind}`; d.setAttribute('role', kind === 'error' ? 'alert' : 'status'); d.textContent = text; host.appendChild(d);
  setTimeout(() => { d.remove(); state.toasts = state.toasts.filter((x) => x.id !== t.id); }, kind === 'error' ? 9000 : 4500);
}
export function multiline(text: string): string { return esc(text).replace(/\n/g, '<br>'); }
export function options(values: string[], selected: string | null, labels?: Record<string, string>): string { return values.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(labels?.[v] ?? v)}</option>`).join(''); }
