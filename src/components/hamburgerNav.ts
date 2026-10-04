import { icon, type IconName } from './icons';
import { logoMarkSvg } from './logoMark';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { syncService } from '../services/syncService';
import { isBrowserOnline } from '../services/onlineNlpService';
import { escapeHtml as e } from '../utils/dom';
import type { Route, Theme, SyncSource, SyncTimeOption } from '../types';
interface NavLeaf { id: Route; label: string; icon: IconName; tourSelector?: string; }
interface NavGroup { id: string; label: string; icon: IconName; children: NavLeaf[]; tourSelector?: string; }
const NAV: (NavLeaf | NavGroup)[] = [
  { id: 'quickstart', label: 'Quick Start', icon: 'compass' },
  { id: 'query-builder-group', label: 'Query Builder', icon: 'code', tourSelector: 'nav-query-builder', children: [{ id: 'readonly', label: 'Read Only Query Builder', icon: 'table', tourSelector: 'nav-readonly' }, { id: 'cr', label: 'Query Builder for CR', icon: 'edit', tourSelector: 'nav-cr' }] },
  { id: 'schema-used', label: 'Schema', icon: 'database', tourSelector: 'nav-schema' },
  { id: 'error-rectifier', label: 'Error Rectifier', icon: 'bug', tourSelector: 'nav-error' },
  { id: 'settings', label: 'Settings', icon: 'settings', tourSelector: 'nav-settings' },
  { id: 'about', label: 'About', icon: 'info' }
];
const isGroup = (x: NavLeaf | NavGroup): x is NavGroup => 'children' in x;
const SRC: Record<SyncSource, string> = { 'shared-location': 'Shared Location', github: 'GitHub' };
const TIME: Record<SyncTimeOption, string> = { manual: 'Manual', '15m': 'Every 15 minutes', '30m': 'Every 30 minutes', '1h': 'Every 1 hour', '4h': 'Every 4 hours', '6h': 'Every 6 hours', daily: 'Daily', custom: 'Custom' };
export function renderNavbar(container: HTMLElement, onNavigate: (r: Route) => void, onStartTour: () => void, signatureName: string): void {
  let menuOpen = false; let expanded: string | null = null; let srcOpen = false; let timeOpen = false; let themeOpen = false;
  function draw(): void {
    const active = schemaService.getActiveSchema(); const cfg = syncService.getConfig(); const lockIcon: IconName = store.settingsUnlocked ? 'unlock' : 'lock'; const online = isBrowserOnline(); const conflicts = syncService.getPendingConflicts().length; const themeIcon: IconName = store.theme === 'light' ? 'sun' : store.theme === 'dark' ? 'moon' : 'monitor';
    container.innerHTML = `<nav class="navbar"><div class="container-fluid navbar-inner"><div class="navbar-left-cluster"><button class="navbar-toggler" id="navToggle" type="button" aria-label="Toggle navigation menu" aria-expanded="${menuOpen}" data-tour="hamburger-btn">${icon('menu', 22)}</button><button class="hero-brand-row" id="logoHomeBtn" type="button" aria-label="Go to Quick Start" data-tour="brand"><span class="app-logo-badge">${logoMarkSvg(26)}</span><span class="brand-text"><span class="builder-heading">AP-SQL Assistant</span><span class="small">V17</span></span></button></div>
    <div class="navbar-sync-cluster" data-tour="navbar-sync"><div class="sync-dropdown-wrap"><button class="sync-dropdown-btn" id="syncSourceBtn" type="button" aria-haspopup="true" aria-expanded="${srcOpen}">${icon('folder-sync', 15)} ${SRC[cfg.source]} ${icon('chevron-down', 13)}</button>${srcOpen ? `<div class="sync-dropdown-menu"><button type="button" data-source="shared-location">${icon('folder', 14)} Shared Location</button><button type="button" data-source="github">${icon('github', 14)} GitHub</button></div>` : ''}</div><div class="sync-dropdown-wrap"><button class="sync-dropdown-btn" id="syncTimeBtn" type="button" aria-haspopup="true" aria-expanded="${timeOpen}">${icon('clock', 15)} ${TIME[cfg.time]} ${icon('chevron-down', 13)}</button>${timeOpen ? `<div class="sync-dropdown-menu">${(Object.keys(TIME) as SyncTimeOption[]).map((t) => `<button type="button" data-time="${t}">${TIME[t]}</button>`).join('')}</div>` : ''}</div>${conflicts ? `<span class="conflict-nav-badge" title="${conflicts} unresolved sync conflict(s)">${icon('shield-alert', 13)} ${conflicts}</span>` : ''}</div>
    <div class="navbar-right-cluster"><span class="schema-badge" data-tour="active-schema-badge" title="Active schema: ${e(active.name)}">${icon('database', 14)} ${e(active.name)}</span><span class="net-status-badge" title="${online ? 'Browser reports online' : 'Browser reports offline — the offline engine is used'}">${icon(online ? 'wifi' : 'wifi-off', 14)}</span><span class="settings-lock-badge ${store.settingsUnlocked ? 'is-unlocked' : ''}" title="Settings ${store.settingsUnlocked ? 'unlocked' : 'locked'}">${icon(lockIcon, 14)}</span><div class="theme-toggle-wrap" data-tour="theme-toggle"><button id="themeBtn" class="btn btn-ghost btn-sm" type="button" aria-haspopup="true" aria-expanded="${themeOpen}" title="Theme">${icon(themeIcon, 18)}</button>${themeOpen ? `<div class="theme-menu"><button data-theme-choice="system" type="button">${icon('monitor', 15)} System Default</button><button data-theme-choice="light" type="button">${icon('sun', 15)} Light</button><button data-theme-choice="dark" type="button">${icon('moon', 15)} Dark</button></div>` : ''}</div><button class="btn btn-outline btn-sm navbar-tour-btn" id="tourBtnNav" type="button" data-tour="guided-walkthrough-btn">${icon('play', 15)}<span class="tour-btn-label">Guided Walkthrough</span></button><span class="navbar-signature" data-tour="signature" title="Crafted by ${e(signatureName)}">${icon('user', 14)} <span>${e(signatureName)}</span></span></div></div></nav>
    ${menuOpen ? `<div class="hamburger-overlay open" id="hamburgerOverlay"><div class="hamburger-panel" role="dialog" aria-modal="true" aria-label="Navigation menu" data-tour="hamburger-panel"><div class="hamburger-panel-header"><span class="hamburger-panel-title">${icon('menu', 18)} Navigation</span><button type="button" class="icon-btn" id="hamburgerCloseBtn" aria-label="Close menu">${icon('x', 18)}</button></div><div class="hamburger-panel-body">${NAV.map((n) => { if (isGroup(n)) { const inG = n.children.some((c) => c.id === store.route); const ex = expanded === n.id || inG; return `<div class="hb-group"><button type="button" class="hb-group-toggle ${inG ? 'active' : ''}" data-group="${n.id}" ${n.tourSelector ? `data-tour="${n.tourSelector}"` : ''} aria-expanded="${ex}"><span class="hb-group-toggle-main">${icon(n.icon, 18)}<span>${n.label}</span></span><span class="hb-group-chevron">${icon('chevron-down', 15, ex ? 'rotated' : '')}</span></button>${ex ? `<div class="hb-group-children">${n.children.map((c) => `<a href="#${c.id}" data-route="${c.id}" ${c.tourSelector ? `data-tour="${c.tourSelector}"` : ''} class="hb-link hb-link-child ${store.route === c.id ? 'active' : ''}">${icon(c.icon, 16)}<span>${c.label}</span></a>`).join('')}</div>` : ''}</div>`; } return `<a href="#${n.id}" data-route="${n.id}" ${n.tourSelector ? `data-tour="${n.tourSelector}"` : ''} class="hb-link ${store.route === n.id ? 'active' : ''}">${icon(n.icon, 18)}<span>${n.label}</span>${n.id === 'settings' ? icon(lockIcon, 14, 'hb-lock-icon') : ''}</a>`; }).join('')}<div class="hb-divider"></div><div class="hb-mobile-sync"><label class="hb-mobile-sync-label" for="hbSyncSourceSelect">${icon('folder-sync', 14)} Sync Source</label><select id="hbSyncSourceSelect" class="hb-mobile-sync-select"><option value="shared-location" ${cfg.source === 'shared-location' ? 'selected' : ''}>Shared Location</option><option value="github" ${cfg.source === 'github' ? 'selected' : ''}>GitHub</option></select><label class="hb-mobile-sync-label mt" for="hbSyncTimeSelect">${icon('clock', 14)} Sync Time</label><select id="hbSyncTimeSelect" class="hb-mobile-sync-select">${(Object.keys(TIME) as SyncTimeOption[]).map((t) => `<option value="${t}" ${cfg.time === t ? 'selected' : ''}>${TIME[t]}</option>`).join('')}</select></div><div class="hb-divider"></div><button type="button" class="hb-link hb-tour-btn" id="tourBtnHb">${icon('play', 18)}<span>Guided Walkthrough</span></button><div class="hb-signature">${icon('user', 14)} ${e(signatureName)}</div></div></div></div>` : ''}`;
    wire();
  }
  const closeAll = () => { srcOpen = false; timeOpen = false; themeOpen = false; };
  function wire(): void {
    const q = <T extends HTMLElement>(s: string) => container.querySelector<T>(s);
    q('#navToggle')?.addEventListener('click', (ev) => { ev.stopPropagation(); menuOpen = !menuOpen; closeAll(); draw(); });
    q('#hamburgerCloseBtn')?.addEventListener('click', () => { menuOpen = false; draw(); });
    q('#hamburgerOverlay')?.addEventListener('click', (ev) => { if (ev.target === q('#hamburgerOverlay')) { menuOpen = false; draw(); } });
    q('#logoHomeBtn')?.addEventListener('click', () => onNavigate('quickstart'));
    container.querySelectorAll<HTMLElement>('.hb-group-toggle').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); expanded = expanded === b.dataset.group ? null : b.dataset.group!; draw(); }));
    container.querySelectorAll<HTMLAnchorElement>('[data-route]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); menuOpen = false; onNavigate(a.dataset.route as Route); draw(); }));
    q('#tourBtnHb')?.addEventListener('click', () => { menuOpen = false; draw(); onStartTour(); });
    q('#tourBtnNav')?.addEventListener('click', () => onStartTour());
    q('#themeBtn')?.addEventListener('click', (ev) => { ev.stopPropagation(); const o = !themeOpen; closeAll(); themeOpen = o; draw(); });
    container.querySelectorAll<HTMLElement>('[data-theme-choice]').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); themeOpen = false; store.setTheme(b.dataset.themeChoice as Theme); }));
    q('#syncSourceBtn')?.addEventListener('click', (ev) => { ev.stopPropagation(); const o = !srcOpen; closeAll(); srcOpen = o; draw(); });
    container.querySelectorAll<HTMLElement>('[data-source]').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); srcOpen = false; syncService.setSource(b.dataset.source as SyncSource); store.pushToast('info', `Sync source set to ${SRC[b.dataset.source as SyncSource]}.`); }));
    q('#syncTimeBtn')?.addEventListener('click', (ev) => { ev.stopPropagation(); const o = !timeOpen; closeAll(); timeOpen = o; draw(); });
    container.querySelectorAll<HTMLElement>('[data-time]').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); timeOpen = false; syncService.setTime(b.dataset.time as SyncTimeOption); store.pushToast('info', `Sync time set to ${TIME[b.dataset.time as SyncTimeOption]}.`); }));
    q<HTMLSelectElement>('#hbSyncSourceSelect')?.addEventListener('change', (ev) => syncService.setSource((ev.target as HTMLSelectElement).value as SyncSource));
    q<HTMLSelectElement>('#hbSyncTimeSelect')?.addEventListener('change', (ev) => syncService.setTime((ev.target as HTMLSelectElement).value as SyncTimeOption));
  }
  document.addEventListener('click', () => { if (srcOpen || timeOpen || themeOpen) { closeAll(); draw(); } });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && menuOpen) { menuOpen = false; draw(); } });
  store.subscribe(draw); schemaService.subscribe(draw); syncService.subscribe(draw);
  window.addEventListener('online', draw); window.addEventListener('offline', draw);
  draw();
}
