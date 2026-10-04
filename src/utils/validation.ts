export function safeString(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback; }
export function safeTrim(value: unknown, fallback = ''): string { return safeString(value, fallback).trim(); }
export function safeUpperTrim(value: unknown, fallback = ''): string { return safeTrim(value, fallback).toUpperCase(); }
export function isNonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
export interface NameValidationResult { valid: boolean; message?: string; }
export function validateSchemaName(rawName: unknown, existingNames: string[], excludeName?: string | null): NameValidationResult {
  const name = safeTrim(rawName);
  if (!name) return { valid: false, message: 'Schema name is required.' };
  if (name.length > 80) return { valid: false, message: 'Schema name must be 80 characters or fewer.' };
  if (!/^[A-Za-z0-9][A-Za-z0-9 _\-.]*$/.test(name)) return { valid: false, message: 'Schema name may only contain letters, digits, spaces, underscores, hyphens, and periods, and must start with a letter or digit.' };
  const ex = excludeName ? safeTrim(excludeName).toLowerCase() : null;
  if (existingNames.map((n) => safeTrim(n).toLowerCase()).some((n) => n === name.toLowerCase() && n !== ex)) return { valid: false, message: `A schema named "${name}" already exists — schema names must be unique.` };
  return { valid: true };
}
export interface SyncConfigCheckField { key: string; label: string; value: unknown; required: boolean; sensitive?: boolean; }
export interface SyncConfigCheckResult { ok: boolean; missingFields: string[]; message: string | null; }
export function assertSyncConfigOrError(fields: SyncConfigCheckField[]): SyncConfigCheckResult {
  const missing = fields.filter((f) => f.required && !isNonEmptyString(f.value)).map((f) => f.label);
  if (!missing.length) return { ok: true, missingFields: [], message: null };
  return { ok: false, missingFields: missing, message: `Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: ${missing.join(', ')}.` };
}
export interface SafeSetItemResult { ok: boolean; recovered: boolean; attemptsUsed: number; error?: string; }
export function safeLocalStorageSet(key: string, value: string | (() => string), onQuotaExceeded?: (attempt: number) => void, maxAttempts = 4): SafeSetItemResult {
  const getValue = () => (typeof value === 'function' ? value() : value); let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try { localStorage.setItem(key, getValue()); return { ok: true, recovered: attempt > 0, attemptsUsed: attempt + 1 }; }
    catch (e) { lastError = e; if (!isQuotaExceededError(e) || !onQuotaExceeded || attempt === maxAttempts) return { ok: false, recovered: false, attemptsUsed: attempt + 1, error: describeStorageError(e) }; onQuotaExceeded(attempt); }
  }
  return { ok: false, recovered: false, attemptsUsed: maxAttempts + 1, error: describeStorageError(lastError) };
}
export function isQuotaExceededError(e: unknown): boolean { if (!e || typeof e !== 'object') return false; const err = e as { name?: string; code?: number }; return err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014; }
export function describeStorageError(e: unknown): string { if (isQuotaExceededError(e)) return 'Browser storage quota exceeded — the local schema cache is too large for this browser to store.'; return (e as Error)?.message || 'The browser rejected the local storage write (storage may be disabled or full).'; }
export function estimateStringBytes(s: string): number { try { return new TextEncoder().encode(s).length; } catch { return s.length; } }
export function readJsonStorage<T>(key: string, fallback: T): T { try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; } }
