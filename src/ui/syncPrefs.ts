/** Navbar "Sync Source" and "Sync Time" (V17.2, same storage key sqla.syncconfig.v15). Background pulls never block the UI. */
export type SyncSource = 'github' | 'shared-location';
export type SyncTimeOption = 'manual' | '15m' | '30m' | '1h' | '4h' | '6h' | 'daily';
export const SRC: Record<SyncSource, string> = { github: 'GitHub', 'shared-location': 'Shared Location' };
export const TIME: Record<SyncTimeOption, string> = { manual: 'Manual', '15m': 'Every 15 minutes', '30m': 'Every 30 minutes', '1h': 'Every 1 hour', '4h': 'Every 4 hours', '6h': 'Every 6 hours', daily: 'Daily' };
const KEY = 'sqla.syncconfig.v15';
const MS: Record<SyncTimeOption, number | null> = { manual: null, '15m': 9e5, '30m': 18e5, '1h': 36e5, '4h': 144e5, '6h': 216e5, daily: 864e5 };
let cfg: { source: SyncSource; time: SyncTimeOption } = (() => { try { const r = JSON.parse(localStorage.getItem(KEY) || '{}'); return { source: r.source === 'shared-location' ? 'shared-location' : 'github', time: (Object.keys(TIME).includes(r.time) ? r.time : 'manual') as SyncTimeOption }; } catch { return { source: 'github' as SyncSource, time: 'manual' as SyncTimeOption }; } })();
const listeners = new Set<() => void>(); let timer: ReturnType<typeof setInterval> | null = null; let tick: (() => void) | null = null;
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ ...cfg, customTime: null })); } catch { /* */ } listeners.forEach((l) => l()); };
export const getSyncPrefs = () => cfg;
export function setSyncSource(s: SyncSource): void { cfg = { ...cfg, source: s }; save(); }
export function setSyncTime(t: SyncTimeOption): void { cfg = { ...cfg, time: t }; save(); reschedule(); }
export function subscribeSyncPrefs(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
export function startSyncScheduler(fn: () => void): void { tick = fn; reschedule(); }
function reschedule(): void { if (timer) clearInterval(timer); timer = null; const ms = MS[cfg.time]; if (ms && tick) timer = setInterval(tick, ms); }
