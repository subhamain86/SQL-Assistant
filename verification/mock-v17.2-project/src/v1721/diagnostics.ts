/** V17.2.1 — user-facing synchronization messages. Secrets are never part of schema data; tokens are redacted defensively. */
import type { RegistryMigrationReport, SchemaMigrationResult } from './legacySchemaMigration';
const redact = (s: string) => s.replace(/(gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{10,}|sk-[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9._-]+)/g, '[redacted]');

export type SchemaBadge = 'Current schema' | 'Legacy schema' | 'Migrated schema' | 'Invalid schema' | 'Migration required' | 'Migration successful' | 'Migration failed';

export function badgesFor(r: SchemaMigrationResult): SchemaBadge[] {
  if (r.status === 'current') return ['Current schema'];
  if (r.status === 'migrated') return ['Legacy schema', 'Migration successful', 'Migrated schema'];
  return r.detectedFormat === 'current' || r.detectedFormat === 'unknown' ? ['Invalid schema'] : ['Legacy schema', 'Migration required', 'Migration failed'];
}

export function describeResult(r: SchemaMigrationResult, maxLocations = 3): string {
  if (r.status === 'current') return `Schema "${r.schemaName}" is in the current format.`;
  if (r.status === 'migrated') {
    const n = r.ruleCounts.R1 || 0;
    return redact(`Legacy schema detected.\nThe schema "${r.schemaName}" was created by an older SQL Assistant version and required migration before synchronization.\n\nMigration completed successfully${n ? ` (${n} decode entr${n === 1 ? 'y' : 'ies'} restored from the legacy "code" field)` : ''}.\nThe schema was validated and synchronized using the current schema format.`);
  }
  const first = r.errors[0];
  const more = r.errors.length - Math.min(r.errors.length, maxLocations);
  const lines = r.errors.slice(0, maxLocations).map((e) => `• ${e.path}: ${e.reason}`);
  return redact(`Legacy schema migration could not be completed.\n\nSchema: ${r.schemaName}\nLocation: ${first?.location ?? '(schema)'}\nReason: ${first?.reason ?? 'unknown'}\n\n${lines.join('\n')}${more > 0 ? `\n…and ${more} more.` : ''}\n\nThe existing valid local schema was preserved.`);
}

export function summarizeReport(rep: RegistryMigrationReport): string {
  const parts = [`${rep.total} schema(s) checked`];
  if (rep.migrated) parts.push(`${rep.migrated} legacy schema(s) migrated`);
  if (rep.rejected) parts.push(`${rep.rejected} could not be migrated — local copies kept unchanged`);
  return parts.join(' · ');
}
