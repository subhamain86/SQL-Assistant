/**
 * V17.2 — the repository LOCATION used for schema synchronisation (repo / branch / file path). These values are
 * not secret, so the last configured location is remembered in plain localStorage. Unauthenticated discovery
 * (Secret Vault locked) therefore reads the SAME file that authenticated pushes write — V17.1 always read the
 * built-in default location, which could hold an old, invalid registry forever.
 */
export interface SyncLocation { repo: string; branch: string; path: string; }
export const DEFAULT_SYNC_LOCATION: SyncLocation = { repo: 'subhamain86/Basware-AP-SQL-Assistant', branch: 'main', path: 'sql-assistant-data/schemas/registry.json' };
const KEY = 'sqla.synclocation.v17';
const valid = (l: Partial<SyncLocation> | null | undefined): l is SyncLocation => !!l && typeof l.repo === 'string' && /^[^/\s]+\/[^/\s]+$/.test(l.repo) && typeof l.path === 'string' && !!l.path.trim() && typeof l.branch === 'string';
export function rememberSyncLocation(l: Partial<SyncLocation>): void { const v = { repo: String(l.repo || '').trim(), branch: String(l.branch || '').trim() || 'main', path: String(l.path || '').trim() }; if (!valid(v)) return; try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* non-fatal */ } }
export function rememberedSyncLocation(): SyncLocation { try { const raw = localStorage.getItem(KEY); const v = raw ? JSON.parse(raw) : null; return valid(v) ? v : DEFAULT_SYNC_LOCATION; } catch { return DEFAULT_SYNC_LOCATION; } }
export function locationKey(l: SyncLocation): string { return `${l.repo}|${l.branch}|${l.path}`; }
