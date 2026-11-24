/**
 * V17.4 — versioned, idempotent, non-destructive data migrations. Runs at start-up; a failing step never blocks the app
 * and is retried next time. Old data is never deleted (the V17.3.1 keys stay in place so a downgrade keeps working).
 */
import { KEYS, readJson, writeJson, type KeyValueStore } from '../../services/storage';
import { tokenize } from '../engines/textTokens';
import { containsSecret } from '../errors/appErrors';
import { APP_VERSION } from '../sync/schemaFormat';
import type { LearningRecord } from './learningStore';
export interface MigrationRecord { id: string; at: string; result: 'applied' | 'skipped' | 'failed'; detail: string; }
export interface MigrationState { schemaVersion: 1; appVersion: string; applied: MigrationRecord[]; }
interface Step { id: string; description: string; run: (s: KeyValueStore) => { result: 'applied' | 'skipped'; detail: string }; }
const STEPS: Step[] = [
  { id: 'learning-v17-to-v174', description: 'Learned queries (V17.0–V17.3.1) → centralized tiered knowledge store', run: (s) => {
    const raw = s.get(KEYS.learning); if (!raw) return { result: 'skipped', detail: 'No V17.3.1 learned queries on this device.' };
    let old: unknown[]; try { const p = JSON.parse(raw); old = Array.isArray(p) ? p : []; } catch { throw new Error('The V17.3.1 learned-query data could not be read; it was left untouched.'); }
    const cur = readJson<{ records: LearningRecord[] }>(s, KEYS.learning174, { records: [] }); const have = new Set((cur.records || []).map((r) => r.id)); let n = 0;
    const out = [...(cur.records || [])];
    old.forEach((o) => { const r = o as Record<string, any>; if (!r || typeof r.id !== 'string' || have.has(r.id) || typeof r.requestText !== 'string' || containsSecret(`${r.requestText} ${r.generatedSql || ''} ${r.finalSql || ''}`)) return;
      const at = typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(); const confirmed = r.status === 'confirmed';
      out.push({ id: r.id, schemaId: String(r.schemaId || ''), schemaName: '', schemaVersion: '', schemaFingerprint: String(r.schemaFingerprint || ''), dialect: '', requestText: String(r.requestText).slice(0, 600), tokens: tokenize(r.requestText), generatedSql: String(r.generatedSql || '').slice(0, 8000), modifiedSql: r.modifiedSql ? String(r.modifiedSql).slice(0, 8000) : null, finalSql: r.finalSql ? String(r.finalSql).slice(0, 8000) : null,
        tables: Array.isArray(r.tables) ? r.tables.map(String) : [], columns: Array.isArray(r.columns) ? r.columns : [], sorts: Array.isArray(r.sorts) ? r.sorts : [], limit: typeof r.limit === 'number' ? r.limit : null, joins: [], filters: [], advanced: { distinct: false, groupBy: [], having: false, limit: typeof r.limit === 'number' ? r.limit : null, joinType: null, tableAliases: false }, pattern: null,
        count: r.status === 'repeated' ? Math.max(3, Number(r.count) || 3) : Math.max(1, Number(r.count) || 1), status: confirmed ? (r.modifiedSql ? 'modified' : 'confirmed') : 'generated', resultStatus: 'unknown', feedback: 'none', feedbackNote: '', rejected: false, createdAt: at, updatedAt: at, device: 'migrated-from-v17.3.1' }); n++; });
    if (!n) return { result: 'skipped', detail: 'Everything was already migrated.' }; if (!writeJson(s, KEYS.learning174, { schemaVersion: 1, records: out })) throw new Error('Browser storage rejected the migrated learning data; the old data is untouched.');
    return { result: 'applied', detail: `${n} learned quer${n === 1 ? 'y' : 'ies'} migrated (the V17.3.1 copy was kept).` }; } },
  { id: 'ai-llm-config-defaults', description: 'AI/LLM Model settings: new V17.4 fields get safe defaults', run: () => ({ result: 'applied', detail: 'Existing AI/LLM settings are read as-is; missing V17.4 fields use defaults (offline stays primary).' }) },
];
export function readMigrations(s: KeyValueStore): MigrationState { const m = readJson<MigrationState | null>(s, KEYS.migrations, null); return m && Array.isArray(m.applied) ? m : { schemaVersion: 1, appVersion: APP_VERSION, applied: [] }; }
export function runMigrations(s: KeyValueStore, now: () => string = () => new Date().toISOString()): MigrationState {
  const st = readMigrations(s); let changed = false;
  for (const step of STEPS) {
    const done = st.applied.find((x) => x.id === step.id && x.result !== 'failed'); if (done && step.id !== 'learning-v17-to-v174') continue; // the learning step re-checks ids on every start (idempotent) so data from an older device synced later is still picked up
    try { const r = step.run(s); if (!done || r.result === 'applied') { st.applied = [...st.applied.filter((x) => x.id !== step.id), { id: step.id, at: now(), result: r.result, detail: r.detail }]; changed = true; } }
    catch (e) { st.applied = [...st.applied.filter((x) => x.id !== step.id), { id: step.id, at: now(), result: 'failed', detail: (e as Error).message }]; changed = true; }
  }
  st.appVersion = APP_VERSION; if (changed) writeJson(s, KEYS.migrations, st); return st;
}
export const MIGRATION_DESCRIPTIONS = Object.fromEntries(STEPS.map((x) => [x.id, x.description]));
