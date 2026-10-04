/**
 * SQL Assistant V17.2.1 — schema format / writer stamp.
 * Every schema written by V17.2.1 carries `schemaFormat`. A schema WITHOUT it is treated as
 * legacy (written by V17.0 or older) and goes through migration — it is never rejected for
 * the missing stamp alone.
 */
export const APP_NAME = 'SQL Assistant';
export const APP_VERSION = '17.2.1';
export const SCHEMA_FORMAT_VERSION = 3;

export interface SchemaFormatStamp {
  app: string;
  appVersion: string;        // SQL Assistant version that wrote the schema
  formatVersion: number;     // schema format version
  writer: string;            // writer version (same as appVersion for V17.2.1)
  generatedAt: string;       // ISO timestamp of this write
  migratedFrom?: string;     // detected legacy format when the schema was migrated
  migrationRules?: string[]; // rule ids applied during migration (audit trail)
}

export function makeStamp(extra: Partial<SchemaFormatStamp> = {}): SchemaFormatStamp {
  return { app: APP_NAME, appVersion: APP_VERSION, formatVersion: SCHEMA_FORMAT_VERSION, writer: APP_VERSION, generatedAt: new Date().toISOString(), ...extra };
}

/** Reads any known writer stamp (V17.2.1 `schemaFormat`, or V17.1/V17.2 style keys). */
export function readStamp(schema: any): { present: boolean; formatVersion: number; writer: string | null } {
  if (!schema || typeof schema !== 'object') return { present: false, formatVersion: 0, writer: null };
  const sf = schema.schemaFormat;
  if (sf && typeof sf === 'object') return { present: true, formatVersion: Number(sf.formatVersion) || 0, writer: String(sf.writer ?? sf.appVersion ?? '') || null };
  for (const k of ['writerStamp', 'writer', 'writtenBy', '_writer']) {
    const v = schema[k];
    if (v) return { present: true, formatVersion: Number((v as any).formatVersion) || 2, writer: typeof v === 'string' ? v : String((v as any).version ?? (v as any).appVersion ?? '') || null };
  }
  return { present: false, formatVersion: 0, writer: null };
}
