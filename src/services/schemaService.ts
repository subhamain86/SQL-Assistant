/**
 * Centralized schema registry (localStorage key sqla.registry.v15 — unchanged since V15).
 * V17.1:
 *  - Load normalises legacy shapes with the shared format module but NEVER drops a schema because it is
 *    invalid; invalid schemas stay visible and are reported by getLocalHealth() with exact reasons.
 *  - A corrupted (unparseable) local registry is backed up before defaults are used (V17.0 silently
 *    replaced it and the next save destroyed it).
 *  - Import, Manual Schema Update and repair use the same validator as repository synchronisation.
 */
import type { SchemaModel, SchemaRegistry, DecodeEntry, TableDef, SchemaEditorRow } from '../types';
import { DEFAULT_SCHEMAS, DEFAULT_ACTIVE_SCHEMA_ID } from '../data/defaultSchemas';
import { validateDecodeEntries } from '../engines/decodeEngine';
import { stampNewVersion, sameLogicalSchema } from '../engines/schemaVersionEngine';
import { upsertSchemaRecord, deleteSchemaRecord } from '../v17/engines/schemaRecordEngine';
import { checkRegistry, normalizeSchema, validateSchemaModel, repairSchema, describeIssue, type SchemaIssue } from '../v17/sync/schemaFormat';
import { makeId } from '../utils/id';
import { validateSchemaName, safeLocalStorageSet, estimateStringBytes } from '../utils/validation';
const STORAGE_KEY = 'sqla.registry.v15';
const QUARANTINE_KEY = 'sqla.registry.quarantine.v17';
function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }
export interface StorageHealth { bytesUsed: number; lastPersistOk: boolean; lastError: string | null; lastRecovered: boolean; }
export interface LocalSchemaHealth { id: string; name: string; valid: boolean; errors: SchemaIssue[]; warnings: SchemaIssue[]; allErrorsRepairable: boolean; }
export class SchemaService {
  private registry: SchemaRegistry;
  private listeners = new Set<() => void>();
  private storageHealth: StorageHealth = { bytesUsed: 0, lastPersistOk: true, lastError: null, lastRecovered: false };
  private loadMessages: string[] = [];
  constructor() { this.registry = this.load(); }
  private load(): SchemaRegistry {
    const defaults = (): SchemaRegistry => ({ schemas: clone(DEFAULT_SCHEMAS), activeSchemaId: DEFAULT_ACTIVE_SCHEMA_ID, activeSchemaUpdatedAt: null });
    let raw: string | null = null; try { raw = localStorage.getItem(STORAGE_KEY); } catch { return defaults(); }
    if (!raw) return defaults();
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch {
      const backupKey = `${STORAGE_KEY}.corrupt-${Date.now()}`;
      try { localStorage.setItem(backupKey, raw); this.loadMessages.push(`The locally stored schema registry could not be read (corrupted JSON). It was preserved under "${backupKey}" and the default schemas were loaded. Use Sync with GitHub Now to recover your schemas from the repository.`); }
      catch { this.loadMessages.push('The locally stored schema registry could not be read (corrupted JSON) and could not be backed up (storage full). The default schemas were loaded.'); }
      return defaults();
    }
    const report = checkRegistry({ value });
    if (report.fileProblem || !report.schemas.some((s) => s.schema)) { if (report.fileProblem) this.loadMessages.push(`The locally stored schema registry has an unexpected structure (${report.fileProblem.message}); the default schemas were loaded and the original data was kept under "${QUARANTINE_KEY}".`); try { localStorage.setItem(QUARANTINE_KEY, raw); } catch { /* ignore */ } return defaults(); }
    const unusable = report.schemas.filter((s) => !s.schema);
    if (unusable.length) { try { localStorage.setItem(QUARANTINE_KEY, JSON.stringify((value as any).schemas?.filter((_: unknown, i: number) => unusable.some((u) => u.index === i)) ?? [])); } catch { /* ignore */ } this.loadMessages.push(`${unusable.length} locally stored schema entr${unusable.length === 1 ? 'y is' : 'ies are'} not readable and ${unusable.length === 1 ? 'was' : 'were'} kept aside under "${QUARANTINE_KEY}".`); }
    const schemas = report.schemas.filter((s) => s.schema).map((s) => s.schema!);
    const seen = new Set<string>(); const unique = schemas.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
    const activeSchemaId = report.activeSchemaId && unique.some((s) => s.id === report.activeSchemaId) ? report.activeSchemaId : unique[0].id;
    unique.forEach((s) => { if (s.id === activeSchemaId) s.status = 'active'; else if (s.status === 'active') s.status = 'inactive'; });
    return { schemas: unique, activeSchemaId, activeSchemaUpdatedAt: report.activeSchemaUpdatedAt };
  }
  private static readonly PRUNE_ESCALATION_CAPS = [12, 6, 3, 1];
  private persist(): void {
    const result = safeLocalStorageSet(STORAGE_KEY, () => { const s = JSON.stringify(this.registry); this.storageHealth.bytesUsed = estimateStringBytes(s); return s; }, (attempt) => { this.pruneForSpace(SchemaService.PRUNE_ESCALATION_CAPS[Math.min(attempt, SchemaService.PRUNE_ESCALATION_CAPS.length - 1)]); }, SchemaService.PRUNE_ESCALATION_CAPS.length);
    this.storageHealth.lastPersistOk = result.ok; this.storageHealth.lastRecovered = result.recovered; this.storageHealth.lastError = result.error || null;
    this.listeners.forEach((l) => l());
  }
  pruneForSpace(maxInactive = 12): { removedCount: number; freedApproxBytes: number } {
    const cap = Math.max(1, maxInactive); const before = estimateStringBytes(JSON.stringify(this.registry));
    const byName = new Map<string, SchemaModel[]>(); this.registry.schemas.forEach((s) => { const k = s.name.trim().toLowerCase(); byName.set(k, [...(byName.get(k) || []), s]); });
    const keep: SchemaModel[] = []; byName.forEach((g) => { if (g.length === 1) { keep.push(g[0]); return; } const a = g.find((s) => s.status === 'active'); const rest = g.filter((s) => s !== a).sort((x, y) => new Date(y.updatedAt).getTime() - new Date(x.updatedAt).getTime()); if (a) keep.push(a); if (rest.length) keep.push(rest[0]); });
    const inactive = keep.filter((s) => s.status !== 'active').sort((x, y) => new Date(y.updatedAt).getTime() - new Date(x.updatedAt).getTime()); const active = keep.filter((s) => s.status === 'active');
    const final = [...active, ...inactive.slice(0, cap)]; const removedCount = this.registry.schemas.length - final.length;
    if (!final.length) return { removedCount: 0, freedApproxBytes: 0 };
    this.registry = { ...this.registry, schemas: final };
    if (!final.some((s) => s.id === this.registry.activeSchemaId)) { this.registry.activeSchemaId = final[0].id; final[0].status = 'active'; }
    return { removedCount, freedApproxBytes: Math.max(0, before - estimateStringBytes(JSON.stringify(this.registry))) };
  }
  getStorageHealth(): StorageHealth { return { ...this.storageHealth }; }
  getLoadMessages(): string[] { return [...this.loadMessages]; }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  getRegistry(): SchemaRegistry { return this.registry; }
  getActiveSchema(): SchemaModel { return this.registry.schemas.find((s) => s.id === this.registry.activeSchemaId) || this.registry.schemas[0]; }
  getAllSchemas(): SchemaModel[] { return this.registry.schemas; }
  getSchemaById(id: string): SchemaModel | undefined { return this.registry.schemas.find((s) => s.id === id); }
  getModulesForSchema(schemaId: string): string[] { const s = this.getSchemaById(schemaId); return s ? Array.from(new Set(s.tables.map((t) => t.module))).sort() : []; }
  getTablesForModule(schemaId: string, module: string | null): TableDef[] { const s = this.getSchemaById(schemaId); if (!s) return []; return module ? s.tables.filter((t) => t.module === module) : s.tables; }
  getAllSchemaNames(excludeId?: string): string[] { return this.registry.schemas.filter((s) => s.id !== excludeId).map((s) => s.name); }
  getActiveSchemaUpdatedAt(): string | null { return this.registry.activeSchemaUpdatedAt ?? null; }
  /** V17.1 — validation status of every local schema with the same rules used for synchronisation. */
  getLocalHealth(): LocalSchemaHealth[] { return this.registry.schemas.map((s) => { const v = validateSchemaModel(s); return { id: s.id, name: s.name, valid: v.valid, errors: v.errors, warnings: v.warnings, allErrorsRepairable: v.errors.length > 0 && v.errors.every((e) => e.repairable) }; }); }
  /** V17.1 — explicit, user-confirmed repair of referential leftovers in one local schema. */
  async repairLocalSchema(schemaId: string): Promise<{ ok: boolean; changes: string[]; remaining: string[]; error?: string }> {
    const s = this.getSchemaById(schemaId); if (!s) return { ok: false, changes: [], remaining: [], error: 'Schema not found.' };
    const r = repairSchema(s);
    if (!r.changes.length) return { ok: false, changes: [], remaining: r.remainingErrors.map(describeIssue), error: 'Nothing could be repaired automatically; the remaining problems must be corrected in Manual Schema Update.' };
    const errs = await this.v17CommitRecordChange(schemaId, r.schema);
    return errs.length ? { ok: false, changes: [], remaining: [], error: errs.join(' ') } : { ok: true, changes: r.changes, remaining: r.remainingErrors.map(describeIssue) };
  }
  switchActiveSchema(schemaId: string): void {
    if (!this.registry.schemas.some((s) => s.id === schemaId)) return;
    this.registry.schemas.forEach((s) => { s.status = s.id === schemaId ? 'active' : (s.status === 'active' ? 'inactive' : s.status); });
    this.registry.activeSchemaId = schemaId; this.registry.activeSchemaUpdatedAt = new Date().toISOString(); this.persist();
  }
  applyRemoteActivePointer(schemaId: string, at: string): boolean {
    if (!this.registry.schemas.some((s) => s.id === schemaId)) return false;
    this.registry.schemas.forEach((s) => { s.status = s.id === schemaId ? 'active' : (s.status === 'active' ? 'inactive' : s.status); });
    this.registry.activeSchemaId = schemaId; this.registry.activeSchemaUpdatedAt = at; this.persist(); return true;
  }
  resetToDefaultSchema(): void { this.switchActiveSchema(DEFAULT_ACTIVE_SCHEMA_ID); }
  validateNewSchemaName(name: unknown, excludeId?: string): string | null { const r = validateSchemaName(name, this.getAllSchemaNames(excludeId)); return r.valid ? null : (r.message || 'Invalid schema name.'); }
  importSchema(schema: unknown, customName: string, originalFileName?: string): { ok: boolean; error?: string; schemaId?: string; replacedExisting?: boolean; notes?: string[] } {
    const n = normalizeSchema(schema);
    if (!n.schema) return { ok: false, error: `Invalid schema file: ${n.issues.map(describeIssue).join(' ')}` };
    const v = validateSchemaModel(n.schema);
    const blocking = [...n.issues.filter((i) => i.severity === 'error'), ...v.errors];
    if (blocking.length) return { ok: false, error: `Schema validation failed: ${blocking.slice(0, 8).map(describeIssue).join(' ')}${blocking.length > 8 ? ` …and ${blocking.length - 8} more.` : ''}` };
    const sanitized = n.schema; const name = customName.trim();
    const existing = this.registry.schemas.find((s) => s.status !== 'active' && sameLogicalSchema(s, { name }));
    if (existing) { existing.tables = sanitized.tables; existing.relationships = sanitized.relationships || []; existing.updatedAt = new Date().toISOString(); existing.originalFileName = originalFileName || existing.originalFileName; this.persist(); return { ok: true, schemaId: existing.id, replacedExisting: true, notes: n.notes }; }
    const err = this.validateNewSchemaName(customName); if (err) return { ok: false, error: err };
    const id = makeId('schema');
    this.registry.schemas.push({ id, name, version: sanitized.version || '1.0', status: 'inactive', updatedAt: new Date().toISOString(), lastSyncedAt: null, tables: sanitized.tables, relationships: sanitized.relationships || [], originalFileName: originalFileName || undefined });
    this.persist(); return { ok: true, schemaId: id, notes: n.notes };
  }
  addNewSchema(name: string): { ok: boolean; error?: string; schema?: SchemaModel } { const err = this.validateNewSchemaName(name); if (err) return { ok: false, error: err }; const fresh: SchemaModel = { id: makeId('schema'), name: name.trim(), version: '1.0', status: 'inactive', updatedAt: new Date().toISOString(), lastSyncedAt: null, tables: [], relationships: [] }; this.registry.schemas.push(fresh); this.persist(); return { ok: true, schema: fresh }; }
  renameSchema(schemaId: string, newName: string): { ok: boolean; error?: string } { const s = this.getSchemaById(schemaId); if (!s) return { ok: false, error: 'Schema not found.' }; const err = this.validateNewSchemaName(newName, schemaId); if (err) return { ok: false, error: err }; s.name = newName.trim(); s.updatedAt = new Date().toISOString(); this.persist(); return { ok: true }; }
  deleteSchema(schemaId: string): { ok: boolean; error?: string } {
    if (this.registry.schemas.length <= 1) return { ok: false, error: 'Cannot delete the only remaining schema.' };
    const wasActive = this.registry.activeSchemaId === schemaId; this.registry.schemas = this.registry.schemas.filter((s) => s.id !== schemaId);
    if (wasActive) { this.registry.activeSchemaId = this.registry.schemas[0].id; this.registry.schemas[0].status = 'active'; this.registry.activeSchemaUpdatedAt = new Date().toISOString(); }
    this.persist(); return { ok: true };
  }
  saveDecodeDefinition(schemaId: string, tableName: string, columnName: string, entries: DecodeEntry[]): string[] { const issues = validateDecodeEntries(entries); if (issues.length) return issues; const s = this.getSchemaById(schemaId); const c = s?.tables.find((t) => t.name === tableName)?.columns.find((x) => x.name === columnName); if (!c || !s) return ['Column not found.']; c.decode = entries; s.updatedAt = new Date().toISOString(); this.persist(); return []; }
  exportSchemaJson(schemaId: string): string { return JSON.stringify(this.getSchemaById(schemaId), null, 2); }
  exportSchemaCsv(schemaId: string): string {
    const s = this.getSchemaById(schemaId); if (!s) return '';
    const header = 'Module,Table Name,Object Type,Table Description,Column Name,Column Description,Data Type,Length,Precision,Nullable,Alias,Primary Key,Foreign Key,Decode';
    return [header, ...s.tables.flatMap((t) => t.columns.map((c) => [t.module, t.name, t.objectType || 'TABLE', t.description, c.name, c.description, c.type, c.length ?? '', c.precision ?? '', c.nullable ? 'Y' : 'N', c.alias ?? '', c.isPrimaryKey ? 'Y' : 'N', c.references ? `${c.references.table}.${c.references.column}` : '', c.decode ? c.decode.map((d) => `${d.rawValue}=${d.label}`).join(';') : ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')))].join('\n');
  }
  getFlattenedRows(schemaId: string, moduleFilter: string | null = null, tableFilter: string | null = null): SchemaEditorRow[] {
    const s = this.getSchemaById(schemaId); if (!s) return [];
    return s.tables.filter((t) => (!moduleFilter || t.module === moduleFilter) && (!tableFilter || t.name === tableFilter)).flatMap((t) => t.columns.map((c) => ({ rowId: `${t.name}::${c.name}`, module: t.module, tableName: t.name, tableDescription: t.description, columnName: c.name, columnDescription: c.description, dataType: c.type as any, length: c.length ?? null, precision: c.precision ?? null, nullable: c.nullable, alias: c.alias ?? '', decodeText: c.decode ? c.decode.map((d) => `${d.rawValue}=${d.label}`).join('\n') : '', isPrimaryKey: !!c.isPrimaryKey, isForeignKey: !!c.isForeignKey, fkTable: c.references?.table ?? '', fkColumn: c.references?.column ?? '' })));
  }
  /* Single-record edit/delete with dependency checks; persists to the centralized registry. */
  async upsertRow(schemaId: string, row: SchemaEditorRow, originalRowId: string | null, originalRow: SchemaEditorRow | null = null): Promise<string[]> {
    const schema = this.getSchemaById(schemaId);
    if (!schema) return ['Schema update failed: the selected schema no longer exists (it may have been removed on another device). Reload the editor.'];
    const result = upsertSchemaRecord(schema, row, originalRowId, originalRow);
    if (!result.ok || !result.schema) return result.errors.flatMap((e) => [e.message, ...(e.details || [])]);
    return this.v17CommitRecordChange(schemaId, result.schema);
  }
  async deleteRow(schemaId: string, rowId: string, opts: { cascade?: boolean } = {}): Promise<{ ok: boolean; error?: string; requiresCascade?: boolean; dependencies?: string[]; changes?: string[] }> {
    const schema = this.getSchemaById(schemaId);
    if (!schema) return { ok: false, error: 'Schema update failed: the selected schema no longer exists (it may have been removed on another device).' };
    const result = deleteSchemaRecord(schema, rowId, opts);
    if (!result.ok || !result.schema) return { ok: false, error: result.errors.map((e) => [e.message, ...(e.details || [])].join(' ')).join(' '), requiresCascade: result.errors.some((e) => e.code === 'SCHEMA_DEPENDENCY_BLOCKED'), dependencies: result.dependencies.map((d) => d.description) };
    const errs = await this.v17CommitRecordChange(schemaId, result.schema);
    return errs.length ? { ok: false, error: errs.join(' ') } : { ok: true, changes: result.changes };
  }
  private async v17CommitRecordChange(schemaId: string, next: SchemaModel): Promise<string[]> {
    const target = this.registry.schemas.find((s) => s.id === schemaId);
    if (!target) return ['Schema update failed: the selected schema no longer exists. Reload the editor.'];
    const before = JSON.stringify({ tables: target.tables, relationships: target.relationships, updatedAt: target.updatedAt, versionMeta: target.versionMeta ?? null });
    target.tables = next.tables; target.relationships = next.relationships; target.updatedAt = new Date().toISOString();
    target.versionMeta = await stampNewVersion(target, 'local');
    this.persist();
    if (!this.storageHealth.lastPersistOk) {
      const prev = JSON.parse(before); target.tables = prev.tables; target.relationships = prev.relationships; target.updatedAt = prev.updatedAt; target.versionMeta = prev.versionMeta ?? undefined; this.persist();
      return [`Schema update failed: the change could not be saved to browser storage (${this.storageHealth.lastError || 'storage write rejected'}). No change was applied.`];
    }
    return [];
  }
  deleteAllSchemaContents(schemaId: string): string { const s = this.getSchemaById(schemaId); if (!s) return ''; const backup = JSON.stringify(s, null, 2); s.tables = []; s.relationships = []; s.updatedAt = new Date().toISOString(); this.persist(); return backup; }
  /** Replaces one schema's content with an already-validated copy (conflict resolution "Use Remote"). */
  replaceSchemaContent(schemaId: string, incoming: SchemaModel): void { const idx = this.registry.schemas.findIndex((s) => s.id === schemaId); if (idx === -1) return; const wasActive = this.registry.schemas[idx].status === 'active'; this.registry.schemas[idx] = { ...clone(incoming), id: schemaId, status: wasActive ? 'active' : (incoming.status === 'active' ? 'inactive' : incoming.status), lastSyncedAt: new Date().toISOString() }; this.persist(); }
  /** Adds an already-validated remote schema that is not present locally. */
  addSchemaFromRemote(incoming: SchemaModel): 'added' | 'updated' | 'skipped' {
    const s = clone(incoming);
    if (this.registry.schemas.some((x) => x.id === s.id)) return 'skipped';
    const ex = this.registry.schemas.find((x) => x.status !== 'active' && sameLogicalSchema(x, s));
    if (ex) { ex.tables = s.tables; ex.relationships = s.relationships; ex.lastSyncedAt = new Date().toISOString(); ex.versionMeta = s.versionMeta || ex.versionMeta; this.persist(); return 'updated'; }
    this.registry.schemas.push({ ...s, status: 'inactive', lastSyncedAt: new Date().toISOString() }); this.persist(); return 'added';
  }
  markAllSynced(): void { const now = new Date().toISOString(); this.registry.schemas.forEach((s) => { s.lastSyncedAt = now; }); this.persist(); }
}
export const schemaService = new SchemaService();
