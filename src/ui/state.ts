/**
 * UI state (V17.2 AppStore): route, theme, toasts, and the password-protected Settings session.
 * Settings lock automatically after 5 minutes without activity (V17.2 behaviour).
 */
import { makeId } from '../utils/id';
export type Route = 'quickstart' | 'readonly' | 'cr' | 'schema-used' | 'error-rectifier' | 'settings' | 'about';
export type Theme = 'system' | 'light' | 'dark';
export interface ToastMessage { id: string; kind: 'success' | 'error' | 'info' | 'warning'; text: string; }
export const ROUTES: Route[] = ['quickstart', 'readonly', 'cr', 'schema-used', 'error-rectifier', 'settings', 'about'];
export const SETTINGS_INACTIVITY_MS = 5 * 60 * 1000;
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };
class AppStore {
  private listeners = new Set<() => void>();
  route: Route = 'quickstart'; theme: Theme = (['light', 'dark', 'system'].includes(get('sqla.theme.v15') || '') ? get('sqla.theme.v15') : 'system') as Theme;
  toasts: ToastMessage[] = []; hasSeenWalkthrough = get('sqla.tourseen.v15') === '1';
  settingsUnlocked = false; settingsTab = 'security';
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor() { if (typeof document !== 'undefined') ['click', 'keydown', 'mousemove'].forEach((ev) => document.addEventListener(ev, () => this.bumpActivity(), { passive: true })); }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  notify(): void { this.listeners.forEach((l) => l()); }
  setRoute(r: Route): void { this.route = r; this.notify(); }
  setTheme(t: Theme): void { this.theme = t; set('sqla.theme.v15', t); this.notify(); }
  markWalkthroughSeen(): void { this.hasSeenWalkthrough = true; set('sqla.tourseen.v15', '1'); }
  pushToast(kind: ToastMessage['kind'], text: string): void { const t = { id: makeId('toast'), kind, text }; this.toasts.push(t); this.notify(); setTimeout(() => { this.toasts = this.toasts.filter((x) => x.id !== t.id); this.notify(); }, kind === 'error' ? 9000 : 4500); }
  unlockSettings(): void { this.settingsUnlocked = true; this.bumpActivity(); this.notify(); }
  lockSettings(): void { this.settingsUnlocked = false; if (this.timer) { clearTimeout(this.timer); this.timer = null; } this.notify(); }
  private bumpActivity(): void { if (!this.settingsUnlocked) return; if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => { this.lockSettings(); this.pushToast('info', 'Settings locked automatically after inactivity.'); }, SETTINGS_INACTIVITY_MS); }
}
export const store = new AppStore();
