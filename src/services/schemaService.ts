import type { SchemaModel, SchemaRegistry, DecodeEntry, TableDef, SchemaEditorRow } from '../types';
import { DEFAULT_SCHEMAS, DEFAULT_ACTIVE_SCHEMA_ID } from '../data/defaultSchemas';
import { validateDecodeEntries } from '../engines/decodeEngine';
import { validateSchemaIntegrity } from '../engines/schemaIntegrityEngine';
import { stampNewVersion, sameLogicalSchema } from '../engines/schemaVersionEngine';
import { upsertSchemaRecord, deleteSchemaRecord } from '../v17/engines/schemaRecordEngine';
import { makeId } from '../utils/id';
import { validateSchemaName, sanitizeIncomingSchema, safeLocalStorageSet, estimateStringBytes } from '../utils/validation';
const STORAGE_KEY = 'sqla.registry.v15';
function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }
export interface StorageHealth { bytesUsed: number; lastPersistOk: boolean; lastError: string | null; lastRecovered: boolean; }
export class SchemaService {
  private registry: SchemaRegistry;
  private listeners = new Set<() => void>();
  private storageHealth: StorageHealth = { bytesUsed: 0, lastPersistOk: true, lastError: null, lastRecovered: false };
  constructor() { this.registry = this.load(); }
  private load(): SchemaRegistry {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) { const p = JSON.parse(raw) as SchemaRegistry; if (p.schemas?.length) return p; } } catch { /* fall back to defaults */ }
    return { schemas: clone(DEFAULT_SCHEMAS), activeSchemaId: DEFAULT_ACTIVE_SCHEMA_ID, activeSchemaUpdatedAt: null };
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
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  getRegistry(): SchemaRegistry { return this.registry; }
  getActiveSchema(): SchemaModel { return this.registry.schemas.find((s) => s.id === this.registry.activeSchemaId) || this.registry.schemas[0]; }
  getAllSchemas(): SchemaModel[] { return this.registry.schemas; }
  getSchemaById(id: string): SchemaModel | undefined { return this.registry.schemas.find((s) => s.id === id); }
  getModulesForSchema(schemaId: string): string[] { const s = this.getSchemaById(schemaId); return s ? Array.from(new Set(s.tables.map((t) => t.module))).sort() : []; }
  getTablesForModule(schemaId: string, module: string | null): TableDef[] { const s = this.getSchemaById(schemaId); if (!s) return []; return module ? s.tables.filter((t) => t.module === module) : s.tables; }
  getAllSchemaNames(excludeId?: string): string[] { return this.registry.schemas.filter((s) => s.id !== excludeId).map((s) => s.name); }
  getActiveSchemaUpdatedAt(): string | null { return this.registry.activeSchemaUpdatedAt ?? null; }
  switchActiveSchema(schemaId: string): void {
    if (!this.registry.schemas.some((s) => s.id === schemaId)) return;
    this.registry.schemas.forEach((s) => { s.status = s.id === schemaId ? 'active' : (s.status === 'active' ? 'inactive' : s.status); });
    this.registry.activeSchemaId = schemaId; this.registry.activeSchemaUpdatedAt = new Date().toISOString(); this.persist();
  }
  /** V16.4/16.5: apply a newer Active Schema selection made on another device (keeps the remote timestamp). */
  applyRemoteActivePointer(schemaId: string, at: string): boolean {
    if (!this.registry.schemas.some((s) => s.id === schemaId)) return false;
    this.registry.schemas.forEach((s) => { s.status = s.id === schemaId ? 'active' : (s.status === 'active' ? 'inactive' : s.status); });
    this.registry.activeSchemaId = schemaId; this.registry.activeSchemaUpdatedAt = at; this.persist(); return true;
  }
  resetToDefaultSchema(): void { this.switchActiveSchema(DEFAULT_ACTIVE_SCHEMA_ID); }
  validateNewSchemaName(name: unknown, excludeId?: string): string | null { const r = validateSchemaName(name, this.getAllSchemaNames(excludeId)); return r.valid ? null : (r.message || 'Invalid schema name.'); }
  importSchema(schema: SchemaModel, customName: string, originalFileName?: string): { ok: boolean; error?: string; schemaId?: string; replacedExisting?: boolean } {
    if (!schema || !Array.isArray(schema.tables)) return { ok: false, error: 'Invalid schema file: missing "tables" array.' };
    const sanitized = sanitizeIncomingSchema(schema) as SchemaModel;
    const blocking = validateSchemaIntegrity(sanitized.tables).issues.filter((i) => i.severity === 'error');
    if (blocking.length) return { ok: false, error: `Schema validation failed: ${blocking.map((i) => i.message).join(' ')}` };
    const name = customName.trim();
    const existing = this.registry.schemas.find((s) => s.status !== 'active' && sameLogicalSchema(s, { name }));
    if (existing) { existing.tables = sanitized.tables; existing.relationships = sanitized.relationships || []; existing.updatedAt = new Date().toISOString(); existing.originalFileName = originalFileName || existing.originalFileName; this.persist(); return { ok: true, schemaId: existing.id, replacedExisting: true }; }
    const err = this.validateNewSchemaName(customName); if (err) return { ok: false, error: err };
    const id = makeId('schema');
    this.registry.schemas.push({ id, name, version: sanitized.version || '1.0', status: 'inactive', updatedAt: new Date().toISOString(), lastSyncedAt: null, tables: sanitized.tables, relationships: sanitized.relationships || [], originalFileName: originalFileName || undefined });
    this.persist(); return { ok: true, schemaId: id };
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
  /* V17-PATCH:schema-record-methods — single-record edit/delete with dependency checks; persists to the centralized registry */
  async upsertRow(schemaId: string, row: SchemaEditorRow, originalRowId: string | null): Promise<string[]> {
    const schema = this.getSchemaById(schemaId);
    if (!schema) return ['Schema update failed: the selected schema no longer exists (it may have been removed on another device). Reload the editor.'];
    const result = upsertSchemaRecord(schema, row, originalRowId);
    if (!result.ok || !result.schema) return result.errors.flatMap((e) => [e.message, ...(e.details || [])]);
    return this.v17CommitRecordChange(schemaId, result.schema);
  }
  async deleteRow(schemaId: string, rowId: string, opts: { cascade?: boolean } = {}): Promise<{ ok: boolean; error?: string; requiresCascade?: boolean; dependencies?: string[]; changes?: string[] }> {
    const schema = this.getSchemaById(schemaId);
    if (!schema) return { ok: false, error: 'Schema update failed: the selected schema no longer exists (it may have been removed on another device).' };
    const result = deleteSchemaRecord(schema, rowId, opts);
    if (!result.ok || !result.schema) return { ok: false, error: result.errors.map((e) => e.message).join(' '), requiresCascade: result.errors.some((e) => e.code === 'SCHEMA_DEPENDENCY_BLOCKED'), dependencies: result.dependencies.map((d) => d.description) };
    const errs = await this.v17CommitRecordChange(schemaId, result.schema);
    return errs.length ? { ok: false, error: errs.join(' ') } : { ok: true, changes: result.changes };
  }
  private async v17CommitRecordChange(schemaId: string, next: SchemaModel): Promise<string[]> {
    const target = this.registry.schemas.find((s) => s.id === schemaId);
    if (!target) return ['Schema update failed: the selected schema no longer exists. Reload the editor.'];
    const before = JSON.stringify({ tables: target.tables, relationships: target.relationships, updatedAt: target.updatedAt, versionMeta: target.versionMeta ?? null });
    target.tables = next.tables;
    target.relationships = next.relationships;
    target.updatedAt = new Date().toISOString();
    target.versionMeta = await stampNewVersion(target, 'local');
    this.persist();
    if (!this.storageHealth.lastPersistOk) {
      const prev = JSON.parse(before);
      target.tables = prev.tables; target.relationships = prev.relationships; target.updatedAt = prev.updatedAt; target.versionMeta = prev.versionMeta ?? undefined;
      this.persist();
      return [`Schema update failed: the change could not be saved to browser storage (${this.storageHealth.lastError || 'storage write rejected'}). No change was applied.`];
    }
    return [];
  }

  deleteAllSchemaContents(schemaId: string): string { const s = this.getSchemaById(schemaId); if (!s) return ''; const backup = JSON.stringify(s, null, 2); s.tables = []; s.relationships = []; s.updatedAt = new Date().toISOString(); this.persist(); return backup; }
  replaceSchemaContent(schemaId: string, incoming: SchemaModel): void { const idx = this.registry.schemas.findIndex((s) => s.id === schemaId); if (idx === -1) return; const san = sanitizeIncomingSchema(incoming) as SchemaModel; const wasActive = this.registry.schemas[idx].status === 'active'; this.registry.schemas[idx] = { ...san, status: wasActive ? 'active' : (san.status === 'active' ? 'inactive' : san.status) }; this.persist(); }
  addSchemaFromRemote(incoming: SchemaModel): 'added' | 'updated' | 'skipped' {
    const san = sanitizeIncomingSchema(incoming) as SchemaModel;
    if (this.registry.schemas.some((s) => s.id === incoming.id)) return 'skipped';
    const ex = this.registry.schemas.find((s) => s.status !== 'active' && sameLogicalSchema(s, san));
    if (ex) { ex.tables = san.tables; ex.relationships = san.relationships; ex.lastSyncedAt = new Date().toISOString(); ex.versionMeta = san.versionMeta || ex.versionMeta; this.persist(); return 'updated'; }
    this.registry.schemas.push({ ...san, status: 'inactive' }); this.persist(); return 'added';
  }
  markAllSynced(): void { const now = new Date().toISOString(); this.registry.schemas.forEach((s) => { s.lastSyncedAt = now; }); this.persist(); }
}
export const schemaService = new SchemaService();
