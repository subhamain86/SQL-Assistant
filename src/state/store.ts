import type { ReadOnlyQueryState, CrQueryState, Route, Theme, ToastMessage, Dialect, QueryRequirement, SelectedColumnSpec, FilterCondition, SortSpec } from '../types';
import { schemaService } from '../services/schemaService';
import { buildSelectSQL } from '../engines/sqlEngine';
import { buildCrSQL } from '../engines/crEngine';
import { makeId } from '../utils/id';
import { safeLocalStorageSet } from '../utils/validation';
function emptyReadOnlyState(dialect: Dialect = 'Oracle'): ReadOnlyQueryState { return { dialect, naturalLanguageText: '', selectedTables: [], selectedColumns: [], joins: [], filters: [], sorts: [], advanced: { distinct: false, groupByColumns: [], havingClause: '', limit: null, recursive: false, saveAsView: null, caseExpressions: [], decodeExpressions: [], ctes: [] }, generatedSql: '-- Select at least one table (or describe your requirement above) to generate SQL.', lastGeneratedAt: null, joinPathChoices: {} }; }
function emptyCrState(dialect: Dialect = 'Oracle'): CrQueryState { return { dialect, naturalLanguageText: '', queryType: 'UPDATE', table: null, values: [], filters: [], confirmNoWhere: false, generatedSql: '-- Choose a table for this Change Request.', lastGeneratedAt: null }; }
const SETTINGS_INACTIVITY_MS = 5 * 60 * 1000;
class AppStore {
  private listeners = new Set<() => void>();
  route: Route = 'quickstart'; theme: Theme = 'system';
  readOnly: ReadOnlyQueryState = emptyReadOnlyState(); cr: CrQueryState = emptyCrState();
  toasts: ToastMessage[] = []; hasSeenWalkthrough = false; settingsUnlocked = false;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  constructor() {
    try { const t = localStorage.getItem('sqla.theme.v15'); if (t === 'light' || t === 'dark' || t === 'system') this.theme = t; this.hasSeenWalkthrough = localStorage.getItem('sqla.tourseen.v15') === '1'; } catch { /* ignore */ }
    schemaService.subscribe(() => this.regenerateReadOnlySql());
    if (typeof document !== 'undefined') ['click', 'keydown', 'mousemove'].forEach((evt) => document.addEventListener(evt, () => this.bumpActivity(), { passive: true }));
  }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify(): void { this.listeners.forEach((l) => l()); }
  setRoute(route: Route): void { this.route = route; this.notify(); }
  setTheme(theme: Theme): void { this.theme = theme; safeLocalStorageSet('sqla.theme.v15', theme); this.notify(); }
  markWalkthroughSeen(): void { this.hasSeenWalkthrough = true; safeLocalStorageSet('sqla.tourseen.v15', '1'); }
  pushToast(kind: ToastMessage['kind'], text: string): void { const t: ToastMessage = { id: makeId('toast'), kind, text }; this.toasts.push(t); this.notify(); setTimeout(() => { this.toasts = this.toasts.filter((x) => x.id !== t.id); this.notify(); }, 4500); }
  unlockSettings(): void { this.settingsUnlocked = true; this.bumpActivity(); this.notify(); }
  lockSettings(): void { this.settingsUnlocked = false; if (this.inactivityTimer) { clearTimeout(this.inactivityTimer); this.inactivityTimer = null; } this.notify(); }
  private bumpActivity(): void { if (!this.settingsUnlocked) return; if (this.inactivityTimer) clearTimeout(this.inactivityTimer); this.inactivityTimer = setTimeout(() => { this.lockSettings(); this.pushToast('info', 'Settings locked automatically after inactivity.'); }, SETTINGS_INACTIVITY_MS); }
  /** Rebuilds SQL from the CURRENT active schema; selections that no longer exist in it are dropped (no stale schema use). */
  regenerateReadOnlySql(): void {
    const schema = schemaService.getActiveSchema(); const valid = new Set(schema.tables.map((t) => t.name));
    const hasCol = (t: string, c: string) => schema.tables.find((x) => x.name === t)?.columns.some((x) => x.name === c);
    this.readOnly.selectedTables = this.readOnly.selectedTables.filter((t) => valid.has(t));
    this.readOnly.selectedColumns = this.readOnly.selectedColumns.filter((c) => c.manualExpr || hasCol(c.table, c.column));
    this.readOnly.filters = this.readOnly.filters.filter((f) => hasCol(f.table, f.column));
    this.readOnly.sorts = this.readOnly.sorts.filter((s) => s.expression || hasCol(s.table, s.column));
    this.readOnly.joins = this.readOnly.joins.filter((j) => valid.has(j.table));
    this.readOnly.generatedSql = buildSelectSQL(this.readOnly, schema); this.readOnly.lastGeneratedAt = new Date().toISOString(); this.notify();
  }
  updateReadOnly(mutator: (s: ReadOnlyQueryState) => void): void { mutator(this.readOnly); this.regenerateReadOnlySql(); }
  resetReadOnly(): void { this.readOnly = emptyReadOnlyState(this.readOnly.dialect); this.regenerateReadOnlySql(); }
  mergeReadOnlyFromNlp(requirement: QueryRequirement): void {
    this.updateReadOnly((s) => {
      const ts = new Set(s.selectedTables); requirement.matchedTables.forEach((t) => ts.add(t)); s.selectedTables = Array.from(ts);
      const ck = (c: SelectedColumnSpec) => (c.manualExpr ? `manual:${c.id}` : `${c.table}::${c.column}`); const ek = new Set(s.selectedColumns.map(ck)); requirement.matchedColumns.forEach((c) => { if (!ek.has(ck(c))) { s.selectedColumns.push(c); ek.add(ck(c)); } });
      const fk = (f: FilterCondition) => `${f.table}::${f.column}::${f.operator}::${f.value}`; const ef = new Set(s.filters.map(fk)); requirement.matchedFilters.forEach((f) => { if (!ef.has(fk(f))) { s.filters.push(f); ef.add(fk(f)); } });
      const sk = (x: SortSpec) => `${x.table}::${x.column}`; const es = new Set(s.sorts.map(sk)); requirement.matchedSorts.forEach((x) => { if (!es.has(sk(x))) { s.sorts.push(x); es.add(sk(x)); } });
      if (requirement.limit && !s.advanced.limit) s.advanced.limit = requirement.limit; if (requirement.distinct) s.advanced.distinct = true;
    });
  }
  regenerateCrSql(): void { const schema = schemaService.getActiveSchema(); if (this.cr.table && !schema.tables.some((t) => t.name === this.cr.table)) { this.cr.table = null; this.cr.values = []; this.cr.filters = []; } const r = buildCrSQL(this.cr); this.cr.generatedSql = r.sql; this.cr.lastGeneratedAt = new Date().toISOString(); this.notify(); }
  updateCr(mutator: (s: CrQueryState) => void): void { mutator(this.cr); this.regenerateCrSql(); }
  resetCr(): void { this.cr = emptyCrState(this.cr.dialect); this.regenerateCrSql(); }
}
export const store = new AppStore();
