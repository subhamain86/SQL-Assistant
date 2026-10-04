// Inspect a repository schema file without the app:  npm run diagnose -- path/to/registry.json
import { readFileSync, existsSync } from 'node:fs'; import { execFileSync } from 'node:child_process';
const root = new URL('..', import.meta.url).pathname; if (!existsSync(`${root}build/esm/v17/sync/schemaFormat.js`)) execFileSync(process.execPath, [`${root}scripts/build.mjs`], { stdio: 'inherit' });
const F = await import(`${root}build/esm/v17/sync/schemaFormat.js`); const file = process.argv[2]; if (!file) { console.error('Usage: npm run diagnose -- <registry.json>'); process.exit(2); }
const r = F.checkRegistry({ text: readFileSync(file, 'utf8') });
console.log(`Written by: ${r.writer.label}${r.writer.legacy ? '  (legacy — migration rules apply)' : ''}`); if (r.fileProblem) { console.log(`FAILED at stage ${r.stage}: ${r.fileProblem.message}`); process.exit(1); }
for (const s of r.schemas) { console.log(`\n${s.valid ? 'OK  ' : 'FAIL'} ${s.name} — ${s.migrationStatus}`); F.summarizeMigration(s.migrationNotes).forEach((x) => console.log(`     ${x}`)); s.errors.slice(0, 15).forEach((e) => console.log(`     ✗ ${F.describeIssue(e)}`)); if (s.errors.length > 15) console.log(`     …and ${s.errors.length - 15} more`); }
process.exit(r.invalidSchemas.length ? 1 : 0);
