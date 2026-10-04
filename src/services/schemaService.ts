/** Centralized saved schema data + Active Schema. Every write is validated first; load never prevents start-up. */
import type { SchemaModel, SchemaRegistry, SchemaEditorRow } from '../types';
import { DEFAULT_SCHEMAS, DEFAULT_ACTIVE_SCHEMA_ID } from '../data/defaultSchemas';
import { KEYS, type KeyValueStore } from './storage';
import { checkRegistry, validateSchemaModel, normalizeSchema, recoverDecodeFromSource, describeIssue, summarizeMigration, WRITER_LABEL, SCHEMA_FORMAT_VERSION, type SchemaReport } from '../v17/sync/schemaFormat';
import { upsertSchemaRecord, deleteSchemaRecord, type RecordChangeResult, type Dependency } from '../v17/engines/schemaRecordEngine';
import { invalidateSchemaContext } from '../v17/engines/schemaContext';
import { makeError, type AppError } from '../v17/errors/appErrors';
import { validateSchemaName } from '../utils/validation';
const defaults = (): SchemaRegistry => ({ schemas: JSON.parse(JSON.stringify(DEFAULT_SCHEMAS)), activeSchemaId: DEFAULT_ACTIVE_SCHEMA_ID, activeSchemaUpdatedAt: null });
type R = { ok: boolean; errors: AppError[] };
export class SchemaService {
  private reg: SchemaRegistry; private listeners = new Set<() => void>();
  readonly loadDiagnostics: { migrated: SchemaReport[]; rejected: SchemaReport[]; unreadable: string | null; recoveredFrom: string[] } = { migrated: [], rejected: [], unreadable: null, recoveredFrom: [] };
  constructor(private store: KeyValueStore) { this.reg = this.load(); }
  private load(): SchemaRegistry {
    const sources = [KEYS.registry, KEYS.registryAlt].map((k) => ({ k, text: this.store.get(k) })).filter((x) => !!x.text) as { k: string; text: string }[];
    if (!sources.length) return defaults();
    const merged: SchemaModel[] = []; let active: string | null = null; let activeAt: string | null = null; let legacySeen = false;
    for (const s of sources) {
      let r; try { r = checkRegistry({ text: s.text }); } catch (e) { this.loadDiagnostics.unreadable = (e as Error).message; continue; }
      if (r.fileProblem || !r.validSchemas.length) { this.loadDiagnostics.unreadable = r.fileProblem?.message || 'No valid schema in stored data.'; this.store.set(`${s.k}.backup`, s.text); this.loadDiagnostics.rejected.push(...r.invalidSchemas); continue; }
      this.loadDiagnostics.migrated.push(...r.migratedSchemas); this.loadDiagnostics.rejected.push(...r.invalidSchemas); legacySeen = legacySeen || r.writer.legacy || s.k !== KEYS.registry;
      if (s.k !== KEYS.registry) this.loadDiagnostics.recoveredFrom.push(s.k);
      r.validSchemas.forEach((v) => { const i = merged.findIndex((m) => m.name.trim().toLowerCase() === v.name.trim().toLowerCase()); if (i < 0) merged.push(v); else if ((v.updatedAt || '') > (merged[i].updatedAt || '')) merged[i] = { ...v, id: merged[i].id }; });
      if (!active && r.activeSchemaId) { active = r.activeSchemaId; activeAt = r.activeSchemaUpdatedAt; }
    }
    if (!merged.length) return defaults();
    const reg: SchemaRegistry = { schemas: merged, activeSchemaId: active && merged.some((m) => m.id === active) ? active : merged[0].id, activeSchemaUpdatedAt: activeAt };
    if (legacySeen || this.loadDiagnostics.migrated.length) { this.persist(reg, true); if (this.loadDiagnostics.recoveredFrom.length) this.store.remove(KEYS.registryAlt); }
    return reg;
  }
  private persist(reg: SchemaRegistry, silent = false): boolean { const ok = this.store.set(KEYS.registry, JSON.stringify({ ...reg, formatVersion: SCHEMA_FORMAT_VERSION, writtenBy: WRITER_LABEL })); if (ok && !silent) { invalidateSchemaContext(); this.listeners.forEach((l) => l()); } return ok; }
  subscribe(l: () => void): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  registry(): SchemaRegistry { return this.reg; } schemas(): SchemaModel[] { return this.reg.schemas; }
  active(): SchemaModel { return this.reg.schemas.find((s) => s.id === this.reg.activeSchemaId) || this.reg.schemas[0]; }
  byId(id: string): SchemaModel | undefined { return this.reg.schemas.find((s) => s.id === id); }
  replaceRegistry(next: SchemaRegistry): R {
    const bad = next.schemas.map((s) => ({ s, v: validateSchemaModel(s) })).filter((x) => !x.v.valid);
    if (bad.length) return { ok: false, errors: bad.map((b) => makeError('INVALID_SCHEMA_RECORD', `Schema "${b.s.name}" failed validation and was not saved.`, b.v.errors.slice(0, 10).map(describeIssue))) };
    const prev = this.reg; this.reg = next; if (!this.persist(next)) { this.reg = prev; return { ok: false, errors: [makeError('SCHEMA_UPDATE_FAILED', 'Browser storage rejected the schema write; the previous schemas were kept.')] }; } return { ok: true, errors: [] };
  }
  saveSchema(s: SchemaModel): R { const u = { ...s, updatedAt: new Date().toISOString() }; return this.replaceRegistry({ ...this.reg, schemas: this.reg.schemas.some((x) => x.id === s.id) ? this.reg.schemas.map((x) => (x.id === s.id ? u : x)) : [...this.reg.schemas, u] }); }
  setActive(id: string): boolean { return !!this.byId(id) && this.replaceRegistry({ ...this.reg, activeSchemaId: id, activeSchemaUpdatedAt: new Date().toISOString() }).ok; }
  deleteSchema(id: string): R { if (this.reg.schemas.length <= 1) return { ok: false, errors: [makeError('SCHEMA_UPDATE_FAILED', 'At least one schema must remain.')] }; const s = this.reg.schemas.filter((x) => x.id !== id); return this.replaceRegistry({ ...this.reg, schemas: s, activeSchemaId: this.reg.activeSchemaId === id ? s[0].id : this.reg.activeSchemaId }); }
  upsertRow(schemaId: string, row: SchemaEditorRow, orig: string | null): RecordChangeResult { const s = this.byId(schemaId); if (!s) return { ok: false, changes: [], errors: [makeError('ACTIVE_SCHEMA_UNAVAILABLE', 'The selected schema no longer exists.')] }; const r = upsertSchemaRecord(s, row, orig); if (!r.ok || !r.schema) return r; const v = this.saveSchema(r.schema); return v.ok ? r : { ok: false, changes: [], errors: v.errors }; }
  deleteRow(schemaId: string, rowId: string, cascade = false): RecordChangeResult & { dependencies: Dependency[] } { const s = this.byId(schemaId); if (!s) return { ok: false, changes: [], errors: [makeError('ACTIVE_SCHEMA_UNAVAILABLE', 'The selected schema no longer exists.')], dependencies: [] }; const r = deleteSchemaRecord(s, rowId, cascade); if (!r.ok || !r.schema) return r; const v = this.saveSchema(r.schema); return v.ok ? r : { ...r, ok: false, errors: v.errors }; }
  importSchemaJson(text: string, name?: string): { ok: boolean; schema?: SchemaModel; errors: AppError[]; summary: string[] } {
    let raw: unknown; try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) { return { ok: false, errors: [makeError('INVALID_SCHEMA_RECORD', `The file is not valid JSON (${(e as Error).message}).`)], summary: [] }; }
    const n = normalizeSchema(Array.isArray((raw as { schemas?: unknown[] })?.schemas) ? (raw as { schemas: unknown[] }).schemas[0] : raw, { legacy: true, basePath: 'file' });
    if (!n.schema) return { ok: false, errors: [makeError('INVALID_SCHEMA_RECORD', 'The file does not contain a schema.')], summary: [] };
    if (name?.trim()) n.schema.name = name.trim(); if (!n.schema.name) n.schema.name = `Imported schema ${this.reg.schemas.length + 1}`;
    const nc = validateSchemaName(n.schema.name, this.reg.schemas.map((x) => x.name)); if (!nc.valid) return { ok: false, errors: [makeError('INVALID_SCHEMA_RECORD', nc.message!)], summary: [] };
    n.schema.id = `schema-${Date.now().toString(36)}`; n.schema.status = 'inactive';
    const errs = [...n.issues.filter((i) => i.severity === 'error'), ...validateSchemaModel(n.schema, 'file').errors];
    if (errs.length) return { ok: false, errors: [makeError('INVALID_SCHEMA_RECORD', `The schema could not be imported (${errs.length} problem(s)).`, errs.slice(0, 20).map(describeIssue))], summary: [] };
    const v = this.saveSchema(n.schema); return { ok: v.ok, schema: n.schema, errors: v.errors, summary: summarizeMigration(n.notes) };
  }
  recoverFromSource(id: string, text: string): { ok: boolean; restored: number; stillUnmapped: number; errors: AppError[] } {
    const s = this.byId(id); if (!s) return { ok: false, restored: 0, stillUnmapped: 0, errors: [makeError('ACTIVE_SCHEMA_UNAVAILABLE', 'Schema not found.')] };
    let raw: unknown; try { raw = JSON.parse(text); } catch (e) { return { ok: false, restored: 0, stillUnmapped: 0, errors: [makeError('INVALID_SCHEMA_RECORD', `Not valid JSON (${(e as Error).message}).`)] }; }
    const r = recoverDecodeFromSource(s, raw); if (!r.restored) return { ok: true, restored: 0, stillUnmapped: r.stillUnmapped, errors: [] }; const v = this.saveSchema(r.schema); return { ok: v.ok, restored: r.restored, stillUnmapped: r.stillUnmapped, errors: v.errors };
  }
  exportRegistryJson(): string { return JSON.stringify(this.reg, null, 2); }
}
