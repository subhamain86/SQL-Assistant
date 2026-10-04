/** Browser storage access (keys kept stable across versions so existing data is preserved). */
import { safeLocalStorageSet, readJsonStorage } from '../utils/validation';
export const KEYS = {
  registry: 'sqla.schemaRegistry.v15', syncBase: 'sqla.syncBase.v17', syncMeta: 'sqla.syncMeta.v17', syncConfig: 'sqla.syncConfig.v15', syncLog: 'sqla.syncLog.v17',
  conflicts: 'sqla.conflicts.v15', vaultLocal: 'sqla.vault.local.v17', aiConfig: 'sqla.aiLlmModel.v17', learning: 'sqla.learning.v17', theme: 'sqla.theme', walkthrough: 'sqla.walkthroughDone'
} as const;
export interface KeyValueStore { get(key: string): string | null; set(key: string, value: string): boolean; remove(key: string): void; }
export const browserStore: KeyValueStore = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { return safeLocalStorageSet(k, v).ok; },
  remove(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
};
export function memoryStore(seed: Record<string, string> = {}): KeyValueStore { const m = new Map(Object.entries(seed)); return { get: (k) => (m.has(k) ? m.get(k)! : null), set: (k, v) => { m.set(k, v); return true; }, remove: (k) => { m.delete(k); } }; }
export function readJson<T>(store: KeyValueStore, key: string, fallback: T): T { if (store === browserStore) return readJsonStorage(key, fallback); try { const r = store.get(key); return r ? (JSON.parse(r) as T) : fallback; } catch { return fallback; } }
export function writeJson(store: KeyValueStore, key: string, value: unknown): boolean { return store.set(key, JSON.stringify(value)); }
