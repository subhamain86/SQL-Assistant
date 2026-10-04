export const safeTrim = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
export function validateSchemaName(raw: unknown, existing: string[], exclude?: string | null): { valid: boolean; message?: string } {
  const n = safeTrim(raw); if (!n) return { valid: false, message: 'Schema name is required.' };
  if (n.length > 80) return { valid: false, message: 'Schema name must be 80 characters or fewer.' };
  if (!/^[A-Za-z0-9][A-Za-z0-9 _\-./]*$/.test(n)) return { valid: false, message: 'Schema name may only contain letters, digits, spaces, _ - . / and must start with a letter or digit.' };
  const ex = exclude ? exclude.trim().toLowerCase() : null;
  if (existing.some((e) => e.trim().toLowerCase() === n.toLowerCase() && e.trim().toLowerCase() !== ex)) return { valid: false, message: `A schema named "${n}" already exists.` };
  return { valid: true };
}
