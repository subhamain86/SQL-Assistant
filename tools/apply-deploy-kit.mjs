#!/usr/bin/env node
/**
 * Applies the V17.2.1 deploy kit to an AP-SQL Assistant project.
 *   node tools/apply-deploy-kit.mjs <path-to-SQL-Assistant-V17.2.1>           dry run (writes nothing)
 *   node tools/apply-deploy-kit.mjs <path-to-SQL-Assistant-V17.2.1> --write   applies; backup goes to .deploy-kit-backup/<timestamp>/
 * Behaviour: all-or-nothing preflight, idempotent, original files backed up.
 */
import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] && path.resolve(process.argv[2]);
const write = process.argv.includes('--write');
const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };
const die = (m) => { console.error(`\u2716 ${m}`); process.exit(1); };
if (!target) die('Usage: node tools/apply-deploy-kit.mjs <project-path> [--write]');

// Preflight
const pkgPath = path.join(target, 'package.json');
if (!(await exists(pkgPath))) die(`package.json not found in ${target}`);
if (!(await exists(path.join(target, 'scripts', 'build.mjs')))) die('scripts/build.mjs not found. This kit targets the V17 single-file build.');
if (!(await exists(path.join(target, 'src', 'main.ts')))) die('src/main.ts not found.');
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
if (!pkg.scripts?.build) die('package.json has no "build" script.');

const files = [
  'index.html',
  'scripts/harden-dist.mjs',
  'scripts/package-release.mjs',
  'deploy/web.config',
  'deploy/staticwebapp.config.json',
  'deploy/404.html',
  '.github/workflows/deploy-pages.yml',
  'docs/DEPLOYMENT_V17.2.1.md',
];
const HARDEN = 'node scripts/harden-dist.mjs';
const newScripts = { ...pkg.scripts };
if (!newScripts.build.includes(HARDEN)) newScripts.build = `${newScripts.build} && ${HARDEN}`;
newScripts['build:raw'] = newScripts['build:raw'] || pkg.scripts.build.replace(` && ${HARDEN}`, '');
newScripts.release = 'node scripts/package-release.mjs';
newScripts.deploy = 'npm run typecheck && npm test && npm run build && npm run release';

console.log(`${write ? 'Applying' : 'Dry run'}: ${target}`);
for (const f of files) console.log(`  ${(await exists(path.join(target, f))) ? 'replace' : 'add    '}  ${f}`);
for (const [k, v] of Object.entries(newScripts)) if (pkg.scripts[k] !== v) console.log(`  script   ${k}: ${v}`);
if (!write) { console.log('\nNothing written. Re-run with --write to apply.'); process.exit(0); }

const backup = path.join(target, '.deploy-kit-backup', new Date().toISOString().replace(/[:.]/g, '-'));
for (const f of [...files, 'package.json']) {
  const src = path.join(target, f);
  if (await exists(src)) { await mkdir(path.dirname(path.join(backup, f)), { recursive: true }); await copyFile(src, path.join(backup, f)); }
}
for (const f of files) { await mkdir(path.dirname(path.join(target, f)), { recursive: true }); await copyFile(path.join(kit, f), path.join(target, f)); }
pkg.scripts = newScripts;
await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const gi = path.join(target, '.gitignore');
let g = (await exists(gi)) ? await readFile(gi, 'utf8') : '';
for (const line of ['release/', '.deploy-kit-backup/']) if (!g.split(/\r?\n/).includes(line)) g += (g.endsWith('\n') || !g ? '' : '\n') + line + '\n';
await writeFile(gi, g);

console.log(`\n\u2714 Applied. Backup: ${path.relative(target, backup)}`);
console.log('Next: npm install && npm run deploy   ->  publish the release/ folder');
