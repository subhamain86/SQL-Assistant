export interface TabDef { id: string; label: string; render: (panel: HTMLElement) => void; }
export interface TabOptions { /** Tab ids that are rendered once and then only hidden/shown — their DOM, search boxes, scroll and focus survive tab switches. */ persist?: string[]; }
/**
 * Tab strip + panels. A tab listed in `persist` stays mounted while another tab is shown (no remount, no state loss);
 * every other tab is rendered again each time it is shown (V17.3.1 behaviour — Settings tabs rely on it to show fresh data).
 */
export function renderTabs(container: HTMLElement, tabs: TabDef[], initialId?: string, tourAttr?: Record<string, string>, onTabChange?: (id: string) => void, opts: TabOptions = {}): void {
  let activeId = tabs.some((t) => t.id === initialId) ? initialId! : tabs[0]?.id; const mounted = new Set<string>(); const persist = new Set(opts.persist || []);
  container.innerHTML = `<div class="tabs-strip" role="tablist">${tabs.map((t) => `<button type="button" role="tab" class="tab-btn" data-tab="${t.id}" ${tourAttr?.[t.id] ? `data-tour="${tourAttr[t.id]}"` : ''}>${t.label}</button>`).join('')}</div>${tabs.map((t) => `<div class="tab-panel" role="tabpanel" data-panel="${t.id}" hidden></div>`).join('')}`;
  const panelOf = (id: string) => container.querySelector<HTMLElement>(`.tab-panel[data-panel="${id}"]`)!;
  function show(id: string): void {
    activeId = id;
    container.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((b) => { const on = b.dataset.tab === id; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    tabs.forEach((t) => { panelOf(t.id).hidden = t.id !== id; });
    const panel = panelOf(id); if (persist.has(id) && mounted.has(id)) return; mounted.add(id);
    try { tabs.find((t) => t.id === id)?.render(panel); } catch (err) { panel.innerHTML = `<div class="issue-box">This tab could not be displayed: ${String((err as Error)?.message || err).replace(/</g, '&lt;')}</div>`; }
  }
  container.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((b) => b.addEventListener('click', () => { onTabChange?.(b.dataset.tab!); show(b.dataset.tab!); }));
  show(activeId);
}
