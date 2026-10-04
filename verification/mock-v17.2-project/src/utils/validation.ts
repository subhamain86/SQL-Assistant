import * as __v1721 from '../v1721/index'; /* V17.2.1-PATCH */
/** Mock of the V17.2 strict validator (rejects empty decode raw values, like the real one). */
function __v1721_base_sanitizeIncomingSchema(schema: any): any { return { ...schema, relationships: schema.relationships || [] }; }
function __v1721_base_validateIncomingRegistryFile(file: any): { valid: boolean; perSchema: { index: number; ok: boolean; errors: string[] }[] } {
  const perSchema = (file?.schemas || []).map((s: any, index: number) => {
    const errors: string[] = [];
    (s.tables || []).forEach((t: any) => (t.columns || []).forEach((c: any) => (c.decode || []).forEach((d: any, i: number) => { if (!d || typeof d.rawValue !== 'string' || !d.rawValue.trim()) errors.push(`Invalid column definition: Column "${t.name}.${c.name}" has a decode entry (#${i + 1}) with an empty raw value.`); })));
    return { index, ok: errors.length === 0, errors };
  });
  return { valid: perSchema.every((p: any) => p.ok), perSchema };
}

/* V17.2.1-PATCH: legacy schema migration runs before the unchanged validateIncomingRegistryFile */
export function validateIncomingRegistryFile(...args: any[]): any { __v1721.beforeValidateRegistryFile(args[0]); return (__v1721_base_validateIncomingRegistryFile as any)(...args); }

/* V17.2.1-PATCH: legacy schema migration runs before the unchanged sanitizeIncomingSchema */
export function sanitizeIncomingSchema(...args: any[]): any { return (__v1721_base_sanitizeIncomingSchema as any)(__v1721.beforeSanitizeSchema(args[0]), ...args.slice(1)); }
