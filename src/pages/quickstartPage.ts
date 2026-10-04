import { icon } from '../components/icons';
import { schemaService } from '../services/schemaService';
import { escapeHtml as e } from '../utils/dom';
import type { Route } from '../types';
export function renderQuickstartPage(container: HTMLElement, onNavigate: (r: Route) => void): void {
  const schema = schemaService.getActiveSchema(); const modules = Array.from(new Set(schema.tables.map((t) => t.module)));
  const card = (nav: Route, ic: Parameters<typeof icon>[0], title: string, text: string) => `<div class="feature-card" data-nav="${nav}" role="button" tabindex="0"><div class="feature-icon">${icon(ic, 22)}</div><h3>${title}</h3><p>${text}</p><span class="card-link">Open ${icon('arrow-right', 16)}</span></div>`;
  container.innerHTML = `<div class="page"><div class="hero-card"><h1>Welcome — what does this tool do?</h1><p class="lead">SQL Assistant helps you describe what you need in plain language — or make manual selections, or combine both. Every request uses your currently saved Active Schema as the single source of truth. The offline NLU engine generates the SQL locally, learns from queries you accept, and can optionally consult an AI/LLM Model configured by your administrator.</p></div>
  <h2 class="section-title">${icon('database')} Active schema: ${e(schema.name)}</h2><div class="chip-row">${modules.map((m) => `<span class="chip">${e(m)}</span>`).join('')}</div>
  <h2 class="section-title">${icon('play')} Try an example</h2><div class="card-grid">
  ${card('readonly', 'table', 'Read Only Query Builder', 'Try "Top 5 vendors by total invoice amount for approved invoices this year" — joins, grouping and sorting are generated for you.')}
  ${card('cr', 'code', 'Query Builder for CR', 'Build INSERT / UPDATE / DELETE SQL, with mandatory-WHERE safeguards.')}
  ${card('settings', 'settings', 'Settings 🔒', 'Password-protected: Manual Schema Update, Schema Management, Secret Vault, AI/LLM Model.')}
  ${card('error-rectifier', 'bug', 'Error Rectifier', 'Paste a database error and the SQL that caused it to get a corrected query.')}</div>
  <div class="note-box mt">${icon('shield', 16)} <span><strong>No execution, ever.</strong> SQL Assistant only ever produces SQL text for you to review and copy.</span></div></div>`;
  container.querySelectorAll<HTMLElement>('[data-nav]').forEach((c) => { const go = () => onNavigate(c.dataset.nav as Route); c.addEventListener('click', go); c.addEventListener('keydown', (ev) => { if ((ev as KeyboardEvent).key === 'Enter') go(); }); });
}
