import { store, type Route } from '../state'; import { e } from '../dom';
export interface WalkthroughStep { id: string; route: Route; targetSelector: string; title: string; body: string; }
export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  { id: 'w1', route: 'quickstart', targetSelector: '[data-tour="brand"]', title: 'Welcome to SQL Assistant', body: "This tool writes read-only and Change Request SQL for you, using your organization's active schema as the single source of truth. Select the logo any time to return here." },
  { id: 'w2', route: 'quickstart', targetSelector: '[data-tour="hamburger-btn"]', title: 'Hamburger Menu', body: 'All page navigation lives behind this button on the left of the navbar.' },
  { id: 'w3', route: 'quickstart', targetSelector: '[data-tour="navbar-sync"]', title: 'Sync Source & Sync Time', body: 'Schema synchronization runs once the Secret Vault is configured — these dropdowns control WHERE and HOW OFTEN background pulls happen.' },
  { id: 'w4', route: 'readonly', targetSelector: '[data-tour="describe-card"]', title: 'Describe What You Need', body: 'Describe a requirement in plain language. The offline NLU engine converts it into SQL using only the Active Schema, learns from SQL you accept, and can optionally consult an AI/LLM Model.' },
  { id: 'w5', route: 'readonly', targetSelector: '[data-tour="module-selector"]', title: 'Module → Search → Select', body: 'Narrow the table list by Module, then search.' },
  { id: 'w6', route: 'readonly', targetSelector: '[data-tour="tab-tables-columns"]', title: 'Select Columns — Search + Select All', body: '"Select All" always selects every column for the selected table(s) regardless of the search filter.' },
  { id: 'w7', route: 'readonly', targetSelector: '[data-tour="tab-advanced"]', title: 'Advanced Options', body: 'Filtering, joins, aggregation, grouping, sorting, DISTINCT, aliases and limits are detected automatically from your description; anything you set here manually is never overwritten.' },
  { id: 'w8', route: 'cr', targetSelector: '[data-tour="cr-query-type"]', title: 'Query Builder for CR', body: 'Same layout and stability as Read Only, with a mandatory WHERE safeguard.' },
  { id: 'w9', route: 'schema-used', targetSelector: '[data-tour="schema-module-selector"]', title: 'Schema — Module & Search', body: 'Filter Tables (and Views) in the Active Schema.' },
  { id: 'w10', route: 'error-rectifier', targetSelector: '[data-tour="error-rectifier-form"]', title: 'Error Rectifier', body: 'Paste a database error and the SQL that caused it — always grounded in the active schema.' },
  { id: 'w11', route: 'settings', targetSelector: '[data-tour="settings-lock-screen"]', title: 'Settings is password protected', body: 'Enter the Admin Password to unlock Settings — Security, Manual Schema Update, Schema Management, Secret Vault, Synchronization, AI/LLM Model and Danger Zone live here.' },
  { id: 'w12', route: 'about', targetSelector: '[data-tour="about-panel"]', title: 'About', body: 'Version history and architecture notes for SQL Assistant.' }];
export class GuidedTour {
  private index = 0; private overlay?: HTMLDivElement;
  constructor(private navigate: (r: Route) => void, private steps: WalkthroughStep[] = WALKTHROUGH_STEPS) {}
  start(): void { this.index = 0; this.showStep(); }
  private cleanup(): void { this.overlay?.remove(); this.overlay = undefined; }
  exit(): void { this.cleanup(); store.markWalkthroughSeen(); }
  private showStep(): void { const step = this.steps[this.index]; if (!step) { this.exit(); return; } if (store.route !== step.route) this.navigate(step.route); setTimeout(() => requestAnimationFrame(() => this.render(step)), 80); }
  private render(step: WalkthroughStep): void {
    this.cleanup(); const target = document.querySelector<HTMLElement>(step.targetSelector); const ov = document.createElement('div'); ov.className = 'tour-overlay'; ov.id = 'tourOverlay'; const r = target?.getBoundingClientRect();
    const spot = r && r.width ? `top:${Math.max(4, r.top - 6)}px;left:${Math.max(4, r.left - 6)}px;width:${r.width + 12}px;height:${r.height + 12}px;` : 'display:none;';
    const w = Math.min(420, window.innerWidth - 32); let top = r && r.width ? r.bottom + 16 : window.innerHeight / 2 - 100; const left = r && r.width ? Math.min(Math.max(16, r.left), window.innerWidth - w - 16) : (window.innerWidth - w) / 2;
    if (top + 220 > window.innerHeight) top = Math.max(16, (r?.top || window.innerHeight / 2) - 236);
    ov.innerHTML = `<div class="tour-spotlight" style="${spot}"></div><div class="tour-popup" role="dialog" aria-label="Guided walkthrough" style="top:${top}px;left:${left}px;width:${w}px;"><div class="tour-step-label" id="tourStepLabel">Step ${this.index + 1} of ${this.steps.length}</div><h4>${e(step.title)}</h4><p>${e(step.body)}</p><div class="tour-dots">${this.steps.map((_, i) => `<span class="tour-dot ${i === this.index ? 'active' : ''}"></span>`).join('')}</div><div class="tour-actions"><button id="tourExit" class="btn btn-ghost" type="button">Exit</button><div class="tour-actions-right"><button id="tourPrev" class="btn btn-ghost" type="button" ${this.index === 0 ? 'disabled' : ''}>Back</button><button id="tourNext" class="btn btn-primary" type="button">${this.index === this.steps.length - 1 ? 'Finish' : 'Next'}</button></div></div></div>`;
    document.body.appendChild(ov); this.overlay = ov; target?.scrollIntoView({ block: 'center' });
    ov.querySelector('#tourExit')!.addEventListener('click', () => this.exit());
    ov.querySelector('#tourPrev')!.addEventListener('click', () => { this.index = Math.max(0, this.index - 1); this.showStep(); });
    ov.querySelector('#tourNext')!.addEventListener('click', () => { if (this.index === this.steps.length - 1) { this.exit(); return; } this.index += 1; this.showStep(); });
  }
}
