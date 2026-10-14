#!/usr/bin/env node
/**
 * SQL Assistant V17.6.5 — administrator recovery: reset the CENTRAL Admin Password to the default ("admin") from a clone of the repository, with no network and without knowing the current password.
 *
 * Writes `sql-assistant-data/security/admin-password.json` as a reset record whose revision is the current revision + 1 (so every device — even one that never saw the old record — adopts it at its
 * next synchronization). The record holds no password and no verifier. Commit and push the file; the "Publish SQL Assistant data" workflow then makes it visible to devices that read the published copy.
 * Anyone who can write to the repository can do this — protect the repository accordingly (docs/SECURITY.md).
 *   usage: node scripts/reset-admin-password.mjs [--repo <path to the clone, default .>] [--file <relative path>]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'; import { join, dirname, resolve } from 'node:path'; import { fileURLToPath } from 'node:url';
export function resetRecord({ repo = '.', file = 'sql-assistant-data/security/admin-password.json', now = () => new Date().toISOString(), version = '17.6.5' } = {}) {
  if (!/^[A-Za-z0-9._\-/]+$/.test(file) || file.includes('..') || file.startsWith('/') || !file.endsWith('.json')) throw new Error('--file must be a relative *.json path inside the repository.');
  const full = join(resolve(repo), file); let revision = 1;
  if (existsSync(full)) { try { const j = JSON.parse(readFileSync(full, 'utf8').replace(/^\uFEFF/, '')); if (Number.isInteger(j.revision) && j.revision >= 1 && j.revision < 1_000_000_000) revision = j.revision + 1; } catch { /* a damaged file is simply replaced */ } }
  const rec = { format: 'sqla-admin-password', formatVersion: 1, revision, isDefault: true, verifier: null, updatedAt: now(), updatedByDevice: 'recovery-script', appVersion: version };
  mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, `${JSON.stringify(rec, null, 1)}\n`); return { file, revision };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = process.argv.slice(2); const get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  try { const r = resetRecord({ repo: get('--repo', '.'), file: get('--file', 'sql-assistant-data/security/admin-password.json') }); process.stdout.write(`Central Admin Password reset record written: ${r.file} (revision ${r.revision}). Commit and push it; devices apply it at their next synchronization.\n`); }
  catch (e) { process.stderr.write(`${e.message}\n`); process.exit(1); }
}
