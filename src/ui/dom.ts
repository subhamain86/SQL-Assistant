import { escapeHtml } from '../utils/dom';
export const esc = escapeHtml;
export const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';
export const checked = (id: string) => !!(document.getElementById(id) as HTMLInputElement | null)?.checked;
export const multiline = (t: string) => esc(t).replace(/\n/g, '<br>');
export const options = (v: string[], sel: string | null, labels?: Record<string, string>) => v.map((x) => `<option value="${esc(x)}"${x === sel ? ' selected' : ''}>${esc(labels?.[x] ?? x)}</option>`).join('');
export function toast(kind: 'success' | 'error' | 'info' | 'warning', text: string): void { const h = document.getElementById('toasts'); if (!h) return; const d = document.createElement('div'); d.className = `toast toast-${kind}`; d.setAttribute('role', kind === 'error' ? 'alert' : 'status'); d.textContent = text; h.appendChild(d); setTimeout(() => d.remove(), kind === 'error' ? 9000 : 4500); }
