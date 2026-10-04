/** Guided Walkthrough (translucent overlay, spotlight, Next/Back/Skip) — kept from V8+. */
import { $ } from './dom';
const STEPS: { view: string; sel: string; title: string; body: string }[] = [
  { view: 'quickstart', sel: '[data-tour="hamburger"]', title: 'Menu', body: 'Open the menu to reach the Query Builders, Schema pages, Error Rectifier, Settings and Theme.' },
  { view: 'builder', sel: '[data-tour="prompt"]', title: 'Describe What You Need', body: 'Type your requirement in plain language. The offline NLU model understands it using the Active Schema — no internet needed.' },
  { view: 'builder', sel: '[data-tour="results"]', title: 'Generated SQL', body: 'Your validated, read-only SQL appears here with the tables, columns and filters used. Copy it, or Accept & Learn to teach the model.' },
  { view: 'builder', sel: '[data-tour="tabs"]', title: 'Manual Selectors & Advanced Options', body: 'Pick tables, columns and filters by hand, or fine-tune joins, sorting, limits and grouping. Manual settings always win.' },
  { view: 'settings', sel: '#settingsTabs', title: 'Settings', body: 'Schema Management (synchronization and recovery), Manual Schema Update, Secret Vault and the optional AI/LLM Model.' }];
let i = 0; let go: (v: string) => void = () => undefined;
function show(): void { const s = STEPS[i]; go(s.view); setTimeout(() => { const el = document.querySelector<HTMLElement>(s.sel); const o = $('tourOverlay'); o.classList.add('show'); const r = el ? el.getBoundingClientRect() : { left: window.innerWidth / 2 - 100, top: 120, width: 200, height: 60 } as DOMRect;
  const sp = $('tourSpotlight'); Object.assign(sp.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
  const p = $('tourPopup'); p.style.left = `${Math.min(window.innerWidth - 360, Math.max(10, r.left))}px`; p.style.top = `${Math.min(window.innerHeight - 200, r.top + r.height + 14)}px`;
  $('tourStepLabel').textContent = `Step ${i + 1} of ${STEPS.length}`; $('tourTitle').textContent = s.title; $('tourBody').textContent = s.body; $('tourNext').textContent = i === STEPS.length - 1 ? 'Finish' : 'Next'; ($('tourPrev') as HTMLButtonElement).disabled = i === 0; }, 60); }
export function initTour(navigate: (v: string) => void): void {
  go = navigate; const close = () => $('tourOverlay').classList.remove('show');
  $('tourBtn').addEventListener('click', () => { i = 0; show(); }); $('tourNext').addEventListener('click', () => { if (i < STEPS.length - 1) { i++; show(); } else close(); });
  $('tourPrev').addEventListener('click', () => { if (i > 0) { i--; show(); } }); $('tourSkip').addEventListener('click', close); document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
