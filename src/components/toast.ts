import { store } from '../state/store';
import { icon } from './icons';
import { escapeHtml } from '../utils/dom';
export function mountToastContainer(root: HTMLElement): void {
  const c = document.createElement('div'); c.className = 'toast-container'; c.setAttribute('aria-live', 'polite'); root.appendChild(c);
  const render = () => { c.innerHTML = store.toasts.map((t) => `<div class="toast toast-${t.kind}">${icon(t.kind === 'success' ? 'check' : t.kind === 'info' ? 'info' : 'alert-triangle', 16)}<span>${escapeHtml(t.text)}</span></div>`).join(''); };
  store.subscribe(render); render();
}
