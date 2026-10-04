#!/usr/bin/env node
/**
 * Diagnoses a schema registry file with EXACTLY the validator the app uses.
 *   npm run diagnose -- path/to/registry.json
 *   npm run diagnose -- https://raw.githubusercontent.com/<owner>/<repo>/main/sql-assistant-data/schemas/registry.json
 *   (private repo: set GITHUB_TOKEN in the environment)
 *   add --repair-out fixed.json to write an explicitly repaired copy (dangling FKs unlinked, dangling relationships removed).
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
const args = process.argv.slice(2); const target = args.find((a) => !a.startsWith('--')); const ri = args.indexOf('--repair-out'); const repairOut = ri >= 0 ? args[ri + 1] : null;
if (!target) { console.error('Usage: npm run diagnose -- <registry.json | https-url> [--repair-out fixed.json]'); process.exit(2); }
const out = path.join(root, '.diag-build'); rmSync(out, { recursive: true, force: true });
const src = path.join(root, 'src', 'v17', 'sync', 'schemaFormat.ts');
const program = ts.createProgram([src], { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, outDir: out, rootDir: path.join(root, 'src'), strict: true, skipLibCheck: true, lib: ['lib.es2020.d.ts'] });
program.emit(); writeFileSync(path.join(out, 'package.json'), '{"type":"commonjs"}');
const fmt = require(path.join(out, 'v17', 'sync', 'schemaFormat.js'));
let text;
if (/^https?:\/\//.test(target)) { const headers = process.env.GITHUB_TOKEN ? { Authorization: `token ${process.env.GITHUB_TOKEN}` } : {}; const res = await fetch(target, { headers }); if (!res.ok) { console.error(`HTTP ${res.status} fetching ${target}`); process.exit(1); } text = await res.text(); }
else text = readFileSync(target, 'utf8');
const report = fmt.checkRegistry({ text });
for (const line of fmt.formatRegistryReport(report)) console.log(line);
if (repairOut && !report.fileProblem) {
  const schemas = report.schemas.filter((s) => s.schema).map((s) => { const r = fmt.repairSchema(s.schema); r.changes.forEach((c) => console.log(`  repaired "${s.name}": ${c}`)); return r.schema; });
  writeFileSync(repairOut, fmt.serializeRegistry({ schemas, activeSchemaId: report.activeSchemaId || schemas[0]?.id || '', activeSchemaUpdatedAt: report.activeSchemaUpdatedAt }));
  console.log(`Repaired copy written to ${repairOut} — review it, then publish it from the app (Push All Schemas) or commit it.`);
}
process.exit(report.fileProblem || report.invalidSchemas.length ? 1 : 0);
