/** Browser storage access (keys kept stable across versions so existing data is preserved). */
import { safeLocalStorageSet, readJsonStorage } from '../utils/validation.js';
export const KEYS = {
    registry: 'sqla.schemaRegistry.v15', syncBase: 'sqla.syncBase.v17', syncMeta: 'sqla.syncMeta.v17', syncConfig: 'sqla.syncConfig.v15', syncLog: 'sqla.syncLog.v17',
    conflicts: 'sqla.conflicts.v15', vaultLocal: 'sqla.vault.local.v17', aiConfig: 'sqla.aiLlmModel.v17', learning: 'sqla.learning.v17', theme: 'sqla.theme', walkthrough: 'sqla.walkthroughDone'
};
export const browserStore = {
    get(k) { try {
        return localStorage.getItem(k);
    }
    catch {
        return null;
    } },
    set(k, v) { return safeLocalStorageSet(k, v).ok; },
    remove(k) { try {
        localStorage.removeItem(k);
    }
    catch { /* ignore */ } }
};
export function memoryStore(seed = {}) { const m = new Map(Object.entries(seed)); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, v); return true; }, remove: (k) => { m.delete(k); } }; }
export function readJson(store, key, fallback) { if (store === browserStore)
    return readJsonStorage(key, fallback); try {
    const r = store.get(key);
    return r ? JSON.parse(r) : fallback;
}
catch {
    return fallback;
} }
export function writeJson(store, key, value) { return store.set(key, JSON.stringify(value)); }
//# sourceMappingURL=storage.js.map