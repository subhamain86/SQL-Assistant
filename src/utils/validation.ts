export function validateSchemaName(raw: unknown, existing: string[], exclude?: string | null): { valid: boolean; message?: string } {
  const n = typeof raw === 'string' ? raw.trim() : ''; if (!n) return { valid: false, message: 'Schema name is required.' };
  if (n.length > 80) return { valid: false, message: 'Schema name must be 80 characters or fewer.' };
  const ex = exclude ? exclude.trim().toLowerCase() : null;
  if (existing.some((e) => e.trim().toLowerCase() === n.toLowerCase() && e.trim().toLowerCase() !== ex)) return { valid: false, message: `A schema named "${n}" already exists.` };
  return { valid: true };
}
