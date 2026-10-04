/**
 * Centralized saved schema data + Active Schema management.
 * Every write is validated (strict validator) before it is persisted; listeners refresh the
 * Active Schema everywhere (NLU context cache is fingerprint-keyed so it never goes stale).
 */
import type { SchemaModel, SchemaRegistry, SchemaEditorRow } from '../types';
import { DEFAULT_SCHEMAS, DEFAULT_ACTIVE_SCHEMA_ID } from '../data/defaultSchemas';
import { KEYS, browserStore, type KeyValueStore } from './storage';
import { checkRegistry, validateSchemaModel, normalizeSchema, recoverDecodeFromSource, describeIssue, summarizeMigration, type RegistryReport, type SchemaReport } from '../v17/sync/schemaFormat';
import { upsertSchemaRecord, deleteSchemaRecord, type RecordChangeResult, type Dependency } from '../v17/engines/schemaRecordEngine';
import { invalidateSchemaContext } from '../v17/engines/schemaContext';
import { makeError, type AppError } from '../v17/errors/appErrors';
import { validateSchemaName } from '../utils/validation';
import { getDeviceTag } from '../engines/schemaVersionEngine';

export interface LoadDiagnostics { migrated: SchemaReport[]; rejected: SchemaReport[]; }
type Listener = (reg: SchemaRegistry) => void;

export class SchemaService {
  private reg: SchemaRegistry; private listeners = new Set<Listener>(); readonly loadDiagnostics: LoadDiagnostics = { migrated: [], rejected: [] };
  constructor(private store: KeyValueStore = browserStore) { this.reg = this.load(); }

  private load(): SchemaRegistry {
    const text = this.store.get(KEYS.registry);
    if (!text) return { schemas: JSON.parse(JSON.stringify(DEFAULT_SCHEMAS)), activeSchemaId: DEFAULT_ACTIVE_SCHEMA_ID, activeSchemaUpdatedAt: null };
    const r = checkRegistry({ text });
    if (r.fileProblem || !r.validSchemas.length) { this.loadDiagnostics.rejected = r.invalidSchemas; return { schemas: JSON.parse(JSON.stringify(DEFAULT_SCHEMAS)), activeSchemaId: DEFAULT_ACTIVE_SCHEMA_ID, activeSchemaUpdatedAt: null }; }
    this.loadDiagnostics.migrated = r.migratedSchemas; this.loadDiagnostics.rejected = r.invalidSchemas;
    const reg: SchemaRegistry = { schemas: r.validSchemas, activeSchemaId: r.activeSchemaId && r.validSchemas.some((s) => s.id === r.activeSchemaId) ? r.activeSchemaId : r.validSchemas[0].id, activeSchemaUpdatedAt: r.activeSchemaUpdatedAt };
    // Locally stored legacy data that migrated cleanly is persisted immediately so it is not re-migrated on every start.
    if (r.migratedSchemas.length || r.invalidSchemas.length === 0 && r.writer.legacy) this.persist(reg, true);
    return reg;
  }
  private persist(reg: SchemaRegistry, silent = false): boolean {
    const ok = this.store.set(KEYS.registry, JSON.stringify({ ...reg, formatVersion: 2, writtenBy: 'SQL Assistant 17.2.1', writtenByDevice: getDeviceTagSafe() }));
    if (ok && !silent) { invalidateSchemaContext(); this.listeners.forEach((l) => l(this.reg)); }
    return ok;
  }
  subscribe(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  registry(): SchemaRegistry { return this.reg; }
  schemas(): SchemaModel[] { return this.reg.schemas; }
  active(): SchemaModel { return this.reg.schemas.find((s) => s.id === this.reg.activeSchemaId) || this.reg.schemas[0]; }
  byId(id: string): SchemaModel | undefined { return this.reg.schemas.find((s) => s.id === id); }

  /** Replace the whole registry (used by sync). Every schema must pass validation. */
  replaceRegistry(next: SchemaRegistry): { ok: boolean; errors: AppError[] } {
    const bad = next.schemas.map((s) => ({ s, v: validateSchemaModel(s) })).filter((x) => !x.v.valid);
    if (bad.length) return { ok: false, errors: bad.map((b) => makeError('INVALID_SCHEMA_RECORD', `Schema "${b.s.name}" failed validation and was not saved.`, b.v.errors.slice(0, 10).map(describeIssue))) };
    const prev = this.reg; this.reg = next;
    if (!this.persist(next)) { this.reg = prev; return { ok: false, errors: [makeError('SCHEMA_UPDATE_FAILED', 'Browser storage rejected the schema write; the previous schemas were kept.')] }; }
    return { ok: true, errors: [] };
  }
  saveSchema(schema: SchemaModel): { ok: boolean; errors: AppError[] } {
    const v = validateSchemaModel(schema);
    if (!v.valid) return { ok: false, errors: [makeError('INVALID_SCHEMA_RECORD', `Schema "${schema.name}" failed validation and was not saved.`, v.errors.slice(0, 15).map(describeIssue))] };
    const updated = { ...schema, updatedAt: new Date().toISOString() };
    const schemas = this.reg.schemas.some((s) => s.id === schema.id) ? this.reg.schemas.map((s) => (s.id === schema.id ? updated : s)) : [...this.reg.schemas, updated];
    return this.replaceRegistry({ ...this.reg, schemas });
  }
  setActive(id: string): boolean { if (!this.byId(id)) return false; return this.replaceRegistry({ ...this.reg, activeSchemaId: id, activeSchemaUpdatedAt: new Date().toISOString() }).ok; }
  deleteSchema(id: string): { ok: boolean; errors: AppError[] } {
    if (this.reg.schemas.length <= 1) return { ok: false, errors: [makeError('SCHEMA_UPDATE_FAILED', 'At least one schema must remain.')] };
    const schemas = this.reg.schemas.filter((s) => s.id !== id);
    return this.replaceRegistry({ ...this.reg, schemas, activeSchemaId: this.reg.activeSchemaId === id ? schemas[0].id : this.reg.activeSchemaId });
  }
  rename(id: string, name: string): { ok: boolean; errors: AppError[] } {
    const s = this.byId(id); if (!s) return { ok: false, errors: [makeError('SCHEMA_UPDATE_FAILED', 'Schema not found.')] };
    const v = validateSchemaName(name, this.reg.schemas.map((x) => x.name), s.name);
    if (!v.valid) return { ok: false, errors: [makeError('INVALID_SCHEMA_RECORD', v.message!)] };
    return this.saveSchema({ ...s, name: name.trim() });
  }

  // ── Manual Schema Update (strictly row-wise) ──
  upsertRow(schemaId: string, row: SchemaEditorRow, originalRowId: string | null, originalRow: SchemaEditorRow | null = null): RecordChangeResult {
    const s = this.byId(schemaId); if (!s) return { ok: false, changes: [], errors: [makeError('ACTIVE_SCHEMA_UNAVAILABLE', 'The selected schema no longer exists.')] };
    const r = upsertSchemaRecord(s, row, originalRowId, originalRow);
    if (!r.ok || !r.schema) return r;
    const saved = this.saveSchema(r.schema); return saved.ok ? r : { ok: false, changes: [], errors: saved.errors };
  }
  deleteRow(schemaId: string, rowId: string, cascade = false): RecordChangeResult & { dependencies: Dependency[] } {
    const s = this.byId(schemaId); if (!s) return { ok: false, changes: [], errors: [makeError('ACTIVE_SCHEMA_UNAVAILABLE', 'The selected schema no longer exists.')], dependencies: [] };
    const r = deleteSchemaRecord(s, rowId, { cascade });
    if (!r.ok || !r.schema) return r;
    const saved = this.saveSchema(r.schema); return saved.ok ? r : { ...r, ok: false, changes: [], errors: saved.errors };
  }

  // ── Import (applies legacy migration rules to external files) ──
  importSchemaJson(text: string, name?: string): { ok: boolean; schema?: SchemaModel; errors: AppError[]; summary: string[] } {
    let raw: unknown; try { raw = JSON.parse(text); } catch (e) { return { ok: false, errors: [makeError('INVALID_SCHEMA_RECORD', `The file is not valid JSON (${(e as Error).message}).`)], summary: [] }; }
    const candidate = Array.isArray((raw as { schemas?: unknown[] })?.schemas) ? (raw as { schemas: unknown[] }).schemas[0] : raw;
    const n = normalizeSchema(candidate, { legacy: true, basePath: 'file' });
    if (!n.schema) return { ok: false, errors: [makeError('INVALID_SCHEMA_RECORD', 'The file does not contain a schema.', n.issues.map(describeIssue))], summary: [] };
    if (name?.trim()) n.schema.name = name.trim();
    if (!n.schema.name) n.schema.name = `Imported schema ${this.reg.schemas.length + 1}`;
    const nameCheck = validateSchemaName(n.schema.name, this.reg.schemas.map((x) => x.name));
    if (!nameCheck.valid) return { ok: false, errors: [makeError('INVALID_SCHEMA_RECORD', nameCheck.message!)], summary: [] };
    n.schema.id = `schema-${Date.now().toString(36)}`; n.schema.status = 'inactive';
    const v = validateSchemaModel(n.schema, 'file');
    const errors = [...n.issues.filter((i) => i.severity === 'error'), ...v.errors];
    if (errors.length) return { ok: false, errors: [makeError('INVALID_SCHEMA_RECORD', `The schema could not be imported (${errors.length} problem(s)).`, errors.slice(0, 20).map(describeIssue))], summary: [] };
    const saved = this.saveSchema(n.schema);
    return { ok: saved.ok, schema: n.schema, errors: saved.errors, summary: summarizeMigration(n.notes) };
  }
  /** Restore decode codes lost by older versions from the original source file. */
  recoverFromSource(schemaId: string, text: string): { ok: boolean; restored: number; stillUnmapped: number; errors: AppError[] } {
    const s = this.byId(schemaId); if (!s) return { ok: false, restored: 0, stillUnmapped: 0, errors: [makeError('ACTIVE_SCHEMA_UNAVAILABLE', 'Schema not found.')] };
    let raw: unknown; try { raw = JSON.parse(text); } catch (e) { return { ok: false, restored: 0, stillUnmapped: 0, errors: [makeError('INVALID_SCHEMA_RECORD', `The source file is not valid JSON (${(e as Error).message}).`)] }; }
    const r = recoverDecodeFromSource(s, raw);
    if (!r.restored) return { ok: true, restored: 0, stillUnmapped: r.stillUnmapped, errors: [] };
    const saved = this.saveSchema(r.schema);
    return { ok: saved.ok, restored: saved.ok ? r.restored : 0, stillUnmapped: r.stillUnmapped, errors: saved.errors };
  }
  exportRegistryJson(): string { return JSON.stringify(this.reg, null, 2); }
}
function getDeviceTagSafe(): string { try { return getDeviceTag(); } catch { return 'device'; } }
export type { RegistryReport };
