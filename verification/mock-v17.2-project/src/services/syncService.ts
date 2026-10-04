import { validateIncomingRegistryFile } from '../utils/validation';
export const local: { schemas: any[] } = { schemas: [{ name: 'AP schema 77', tables: [{ name: 'LOCAL_ONLY', module: 'L', description: '', columns: [] }], relationships: [] }] };
export function pullRegistry(file: any): string {
  const res = validateIncomingRegistryFile(file);
  const failed = res.perSchema.filter((p) => !p.ok);
  res.perSchema.filter((p) => p.ok).forEach((p) => { const s = file.schemas[p.index]; const i = local.schemas.findIndex((x) => x.name === s.name); if (i >= 0) local.schemas[i] = s; else local.schemas.push(s); });
  return failed.length ? `${failed.length} of ${res.perSchema.length} schema(s) in the repository failed validation and were not loaded — your local copies were kept unchanged.` : `All ${res.perSchema.length} schema(s) loaded.`;
}
