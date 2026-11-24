import { escapeHtml } from '../utils/dom';
export const e = escapeHtml;
export const esc = escapeHtml;
export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
export const val = (sel: string, root: ParentNode = document) => ($<HTMLInputElement>(sel, root)?.value ?? '');
export const options = (v: string[], sel: string | null | undefined, labels?: Record<string, string>) => v.map((x) => `<option value="${e(x)}"${x === sel ? ' selected' : ''}>${e(labels?.[x] ?? x)}</option>`).join('');
export function trapFocus(container: HTMLElement): () => void {
  function onKey(ev: KeyboardEvent): void { if (ev.key !== 'Tab') return; const f = Array.from(container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((el) => !el.hasAttribute('disabled')); if (!f.length) return; const first = f[0]; const last = f[f.length - 1]; if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); } else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); } }
  container.addEventListener('keydown', onKey); return () => container.removeEventListener('keydown', onKey);
}
export function copyText(text: string): Promise<void> { if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => fallback(text)); fallback(text); return Promise.resolve(); }
function fallback(text: string): void { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch { /* ignore */ } ta.remove(); }
