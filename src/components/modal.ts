import { trapFocus } from '../utils/dom';
export interface ModalHandle { close: () => void; element: HTMLDivElement; }
export function openModal(titleHtml: string, bodyHtml: string, opts: { closeOnBackdrop?: boolean; wide?: boolean } = {}): ModalHandle {
  const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal-card ${opts.wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true"><div class="modal-header"><span class="modal-title">${titleHtml}</span><button type="button" class="modal-close-btn" aria-label="Close">×</button></div><div class="modal-body">${bodyHtml}</div></div>`;
  document.body.appendChild(backdrop); document.body.style.overflow = 'hidden';
  const card = backdrop.querySelector('.modal-card') as HTMLDivElement; const untrap = trapFocus(card);
  function close(): void { untrap(); document.body.style.overflow = ''; backdrop.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e: KeyboardEvent): void { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey); backdrop.querySelector('.modal-close-btn')?.addEventListener('click', close);
  if (opts.closeOnBackdrop !== false) backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  requestAnimationFrame(() => card.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-close-btn)')?.focus());
  return { close, element: backdrop };
}
