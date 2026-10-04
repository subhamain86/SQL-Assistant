import { store } from '../state';
import { icon } from './icons';
import { e } from '../dom';
export function mountToastContainer(root: HTMLElement): void {
  const c = document.createElement('div'); c.className = 'toast-container'; c.id = 'toastHost'; c.setAttribute('aria-live', 'polite'); root.appendChild(c);
  const render = () => { c.innerHTML = store.toasts.map((t) => `<div class="toast toast-${t.kind}" role="${t.kind === 'error' ? 'alert' : 'status'}">${icon(t.kind === 'success' ? 'check' : t.kind === 'info' ? 'info' : 'alert-triangle', 16)}<span>${e(t.text)}</span></div>`).join(''); };
  store.subscribe(render); render();
}
export const toast = (kind: 'success' | 'error' | 'info' | 'warning', text: string) => store.pushToast(kind, text);
