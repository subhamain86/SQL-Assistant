/**
 * V17.5 — masked passphrase input with a visibility button.
 * Hidden by default → click to reveal → click again to hide. The passphrase is NEVER written into the HTML string (it is assigned to the input's
 * value property), never logged, never placed in a URL, and the field opts out of autofill and spell-checking.
 */
import { icon } from './icons'; import { e } from '../dom';
/** V17.6.5: `noun` / `autocomplete` let the same masked field serve a new Admin Password (autocomplete="new-password"); the defaults keep the passphrase field byte-identical. */
export function passphraseFieldHtml(id: string, label: string, hint = '', opt: { noun?: string; autocomplete?: string } = {}): string {
  const noun = opt.noun || 'passphrase';
  return `<label class="block-label" for="${e(id)}">${e(label)}</label><div class="passphrase-row"><input type="password" id="${e(id)}" class="passphrase-input" autocomplete="${e(opt.autocomplete || 'off')}" autocapitalize="off" autocorrect="off" spellcheck="false" data-passphrase aria-describedby="${e(id)}Hint"><button type="button" class="icon-btn passphrase-eye" data-eye-for="${e(id)}"${noun === 'passphrase' ? '' : ` data-noun="${e(noun)}"`} aria-label="Show ${e(noun)}" aria-pressed="false" title="Show ${e(noun)}">${icon('eye', 16)}</button></div>${hint ? `<div class="hint" id="${e(id)}Hint">${hint}</div>` : `<div id="${e(id)}Hint"></div>`}`;
}
/** Wires every eye button under `root`; `initial` (e.g. the saved passphrase) is assigned as a value, never as markup. */
export function wirePassphraseFields(root: HTMLElement, initial: Record<string, string> = {}): void {
  Object.entries(initial).forEach(([id, v]) => { const i = root.querySelector<HTMLInputElement>(`#${id}`); if (i) i.value = v; });
  root.querySelectorAll<HTMLButtonElement>('.passphrase-eye').forEach((b) => b.addEventListener('click', () => {
    const i = root.querySelector<HTMLInputElement>(`#${b.dataset.eyeFor}`); if (!i) return; const show = i.type === 'password'; i.type = show ? 'text' : 'password';
    const noun = b.dataset.noun || 'passphrase'; b.setAttribute('aria-pressed', String(show)); b.setAttribute('aria-label', show ? `Hide ${noun}` : `Show ${noun}`); b.title = show ? `Hide ${noun}` : `Show ${noun}`; b.innerHTML = icon(show ? 'eye-off' : 'eye', 16);
  }));
}
