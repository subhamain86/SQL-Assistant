/**
 * V17.4 — centralized UI state for the Manual Selectors and the Read Only builder.
 * Everything the user can lose by a re-render lives here, not in component closures: module filter, search boxes, scroll positions,
 * the active tab. A draft of the whole builder (query state + this UI state) is kept in sessionStorage so a page reload does not lose it either.
 * Only non-sensitive query configuration is stored; nothing here is synchronized or persisted beyond the browser session.
 */
import type { ReadOnlyQueryState } from '../types';
export interface SelectorUi { tableModule: string; tableSearch: string; columnSearch: string; tableScroll: number; columnScroll: number; filterScroll: number; activeTab: string; }
export const selectorUi: SelectorUi = { tableModule: '', tableSearch: '', columnSearch: '', tableScroll: 0, columnScroll: 0, filterScroll: 0, activeTab: 'tables-columns' };
export interface BuilderDraft { v: 1; schemaId: string; st: ReadOnlyQueryState; ui: SelectorUi; manual: string[]; autoInfo: string[]; }
const KEY = 'sqla.builderdraft.v174';
let timer: ReturnType<typeof setTimeout> | null = null; let pending: (() => BuilderDraft) | null = null;
const write = () => { if (!pending) return; const get = pending; pending = null; try { sessionStorage.setItem(KEY, JSON.stringify(get())); } catch { /* storage blocked or full — the draft is a convenience only */ } };
/** Debounced; also flushed when the page is hidden or closed so a reload right after a change never loses it. */
export function saveDraftSoon(get: () => BuilderDraft): void { pending = get; if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; write(); }, 250); }
if (typeof window !== 'undefined') { window.addEventListener('pagehide', write); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') write(); }); }
export function loadDraft(): BuilderDraft | null {
  try { const raw = sessionStorage.getItem(KEY); if (!raw) return null; const d = JSON.parse(raw) as BuilderDraft; return d && d.v === 1 && d.st && Array.isArray(d.st.selectedTables) && d.st.advanced ? d : null; } catch { return null; }
}
export function clearDraft(): void { pending = null; try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }
