export interface TabDef { id: string; label: string; render: (panel: HTMLElement) => void; }
export function renderTabs(container: HTMLElement, tabs: TabDef[], initialId?: string, tourAttr?: Record<string, string>, onTabChange?: (id: string) => void): void {
  let activeId = tabs.some((t) => t.id === initialId) ? initialId! : tabs[0]?.id;
  function draw(): void {
    container.innerHTML = `<div class="tabs-strip" role="tablist">${tabs.map((t) => `<button type="button" role="tab" class="tab-btn ${t.id === activeId ? 'active' : ''}" data-tab="${t.id}" aria-selected="${t.id === activeId}" ${tourAttr?.[t.id] ? `data-tour="${tourAttr[t.id]}"` : ''}>${t.label}</button>`).join('')}</div><div id="tabPanel" class="tab-panel" role="tabpanel"></div>`;
    container.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((b) => b.addEventListener('click', () => { activeId = b.dataset.tab!; onTabChange?.(activeId); draw(); }));
    const panel = container.querySelector<HTMLElement>('#tabPanel')!;
    try { tabs.find((t) => t.id === activeId)?.render(panel); } catch (err) { panel.innerHTML = `<div class="issue-box">This tab could not be displayed: ${String((err as Error)?.message || err).replace(/</g, '&lt;')}</div>`; }
  }
  draw();
}
