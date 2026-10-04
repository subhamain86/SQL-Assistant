/**
 * Browser storage. V17.3 restores the storage keys used by V15–V17.2 (sqla.registry.v15). The V17.2.1/V17.2.2 packages
 * wrote to sqla.schemaRegistry.v15 instead, so a device upgraded from V17.2 silently lost its schemas (defaults were shown)
 * — data in either key is read and merged into the canonical key on start-up.
 */
export const KEYS = { registry: 'sqla.registry.v15', registryAlt: 'sqla.schemaRegistry.v15', syncBase: 'sqla.syncBase.v17', syncMeta: 'sqla.syncMeta.v17', syncLog: 'sqla.syncLog.v17', conflicts: 'sqla.conflicts.v17', vaultLocal: 'sqla.vault.local.v17', aiConfig: 'sqla.aiLlmModel.v17', aiConfigV172: 'sqla.llmconfig.v17', learning: 'sqla.learning.v17', syncLocation: 'sqla.synclocation.v17' } as const;
export interface KeyValueStore { get(k: string): string | null; set(k: string, v: string): boolean; remove(k: string): void; }
export function memoryStore(seed: Record<string, string> = {}): KeyValueStore { const m = new Map(Object.entries(seed)); return { get: (k) => (m.has(k) ? m.get(k)! : null), set: (k, v) => { m.set(k, v); return true; }, remove: (k) => { m.delete(k); } }; }
let _b: (KeyValueStore & { persistent: boolean }) | null = null;
/** Never throws: if localStorage is blocked the app still starts with session-only storage. */
export function browserStore(): KeyValueStore & { persistent: boolean } {
  if (_b) return _b; let ok = false; try { localStorage.setItem('__sqla_probe__', '1'); localStorage.removeItem('__sqla_probe__'); ok = true; } catch { ok = false; }
  _b = ok ? { persistent: true, get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } }, remove: (k) => { try { localStorage.removeItem(k); } catch { /* */ } } } : { ...memoryStore(), persistent: false };
  return _b;
}
export function readJson<T>(s: KeyValueStore, k: string, fb: T): T { try { const r = s.get(k); return r ? (JSON.parse(r) as T) : fb; } catch { return fb; } }
export const writeJson = (s: KeyValueStore, k: string, v: unknown) => s.set(k, JSON.stringify(v));
