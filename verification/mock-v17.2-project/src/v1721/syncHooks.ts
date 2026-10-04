/**
 * V17.2.1 — hooks inserted into the existing synchronization choke points by tools/apply-v1721.mjs.
 *   validateIncomingRegistryFile(file)  → legacy schemas are migrated IN PLACE before the unchanged validator runs
 *   sanitizeIncomingSchema(schema)      → import / replace paths receive the migrated schema
 * Rejected schemas are passed through untouched, so the existing validator still rejects them and the
 * existing "local copies were kept unchanged" protection applies.
 */
import { migrateRegistryFileInPlace, migrateSchema, type RegistryMigrationReport } from './legacySchemaMigration';
export function beforeValidateRegistryFile(file: unknown): RegistryMigrationReport | null {
  try {
    const rep = migrateRegistryFileInPlace(file);
    if (rep.total && typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') window.dispatchEvent(new CustomEvent('sqla:v1721-migration', { detail: rep }));
    return rep;
  } catch { return null; } // never break the existing pipeline; the unchanged validator still runs
}
export function beforeSanitizeSchema<T>(schema: T): T {
  try { const r = migrateSchema(schema); return (r.status === 'migrated' && r.schema ? r.schema : schema) as T; } catch { return schema; }
}
