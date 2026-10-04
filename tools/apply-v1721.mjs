#!/usr/bin/env node
/**
 * Upgrades an existing SQL Assistant V17.2 project to V17.2.1.
 *   node tools/apply-v1721.mjs <project>            dry run (prints the plan, writes nothing)
 *   node tools/apply-v1721.mjs <project> --write    apply (originals backed up to .v1721-backup/<timestamp>/)
 * Steps: copy src/v1721 · hook the two schema choke points · import the diagnostics UI · branding
 *        (AP-SQL Assistant → SQL Assistant, user-facing strings only) · version 17.2.1 · add regression tests.
 * All-or-nothing: if a required anchor is missing, nothing is written.
 */
import { readFile, writeFile, mkdir, copyFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] && path.resolve(process.argv[2]);
const write = process.argv.includes('--write');
const die = (m) => { console.error(`\u2716 ${m}`); process.exit(1); };
const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };
if (!target) die('Usage: node tools/apply-v1721.mjs <project> [--write]');
if (!(await exists(path.join(target, 'package.json'))) || !(await exists(path.join(target, 'src', 'main.ts')))) die('Not a SQL Assistant project (package.json / src/main.ts missing).');

async function walk(dir, out = []) { for (const e of await readdir(dir, { withFileTypes: true })) { if (['node_modules', '.test-build', 'dist', '.v1721-backup', 'v1721'].includes(e.name)) continue; const p = path.join(dir, e.name); if (e.isDirectory()) await walk(p, out); else if (/\.ts$/.test(e.name)) out.push(p); } return out; }
const srcFiles = await walk(path.join(target, 'src'));
const edits = new Map(); // file -> new content
const get = async (f) => edits.get(f) ?? (await readFile(f, 'utf8'));
const plan = [];

// 1. Choke points
const HOOKS = [
  { fn: 'validateIncomingRegistryFile', hook: 'beforeValidateRegistryFile', call: (base) => `{ __v1721.beforeValidateRegistryFile(args[0]); return (${base} as any)(...args); }`, required: true },
  { fn: 'sanitizeIncomingSchema', hook: 'beforeSanitizeSchema', call: (base) => `{ return (${base} as any)(__v1721.beforeSanitizeSchema(args[0]), ...args.slice(1)); }`, required: true },
];
for (const h of HOOKS) {
  let found = false;
  for (const f of srcFiles) {
    const s = await get(f);
    if (s.includes(`__v1721_base_${h.fn}`)) { found = true; plan.push(`already hooked  ${h.fn} (${path.relative(target, f)})`); break; }
    const re = new RegExp(`export\\s+(async\\s+)?function\\s+${h.fn}\\s*(<[^>]*>)?\\s*\\(`);
    const m = s.match(re); if (!m) continue;
    found = true;
    const rel = path.relative(path.dirname(f), path.join(target, 'src', 'v1721', 'index')).replace(/\\/g, '/');
    const imp = `import * as __v1721 from '${rel.startsWith('.') ? rel : './' + rel}'; /* V17.2.1-PATCH */\n`;
    let next = s.replace(re, `${m[1] || ''}function __v1721_base_${h.fn}${m[2] || ''}(`);
    next = (next.includes('import * as __v1721') ? '' : imp) + next + `\n/* V17.2.1-PATCH: legacy schema migration runs before the unchanged ${h.fn} */\nexport function ${h.fn}(...args: any[]): any ${h.call(`__v1721_base_${h.fn}`)}\n`;
    edits.set(f, next); plan.push(`hook            ${h.fn} (${path.relative(target, f)})`); break;
  }
  if (!found && h.required) die(`Anchor "export function ${h.fn}(" not found in src/. Nothing was written. Send this message with your V17.2 src/utils folder.`);
}
// 2. UI diagnostics import
const mainTs = path.join(target, 'src', 'main.ts'); const mainSrc = await get(mainTs);
if (!mainSrc.includes("./v1721/ui")) { edits.set(mainTs, `import './v1721/ui'; /* V17.2.1-PATCH: schema sync diagnostics */\n` + mainSrc); plan.push('import          v1721/ui in src/main.ts'); }
// 3. Branding + version (user-facing strings only; storage keys like "sqla.*" untouched)
const brand = (s) => s.replace(/AP-SQL Assistant/g, 'SQL Assistant').replace(/AP SQL Assistant/g, 'SQL Assistant').replace(/(['"`>\s])AP_SQL_Assistant(?=['"`<\s.·])/g, '$1SQL Assistant');
const scriptFiles = (await exists(path.join(target, 'scripts'))) ? (await readdir(path.join(target, 'scripts'))).filter((x) => /\.(mjs|js|py)$/.test(x)).map((x) => path.join(target, 'scripts', x)) : [];
for (const f of [...srcFiles, ...scriptFiles, path.join(target, 'index.html'), path.join(target, 'README.md'), ...['DEPLOYMENT.md'].map((x) => path.join(target, 'docs', x))]) {
  if (!(await exists(f))) continue; const s = await get(f); let n = brand(s);
  n = n.replace(/export const APP_VERSION = '[^']*'/, "export const APP_VERSION = '17.2.1'");
  if (n !== s) { edits.set(f, n); plan.push(`branding/version ${path.relative(target, f)}`); }
}
const pkg = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
const pkgNext = { ...pkg, name: 'sql-assistant', version: '17.2.1' };
if (JSON.stringify(pkg) !== JSON.stringify(pkgNext)) plan.push(`package.json    name=sql-assistant version=17.2.1 (was ${pkg.name}@${pkg.version})`);
plan.push('add             src/v1721/* (migration, validator, writer stamp, sync hooks, diagnostics UI)');
plan.push('add             test/v1721-migration.test.cjs + test/fixtures (AP schema 77)');

console.log(`${write ? 'Applying' : 'Dry run'} V17.2.1 → ${target}\n  ${plan.join('\n  ')}`);
if (!write) { console.log('\nNothing written. Re-run with --write to apply.'); process.exit(0); }

const backup = path.join(target, '.v1721-backup', new Date().toISOString().replace(/[:.]/g, '-'));
for (const f of [...edits.keys(), path.join(target, 'package.json')]) { const b = path.join(backup, path.relative(target, f)); await mkdir(path.dirname(b), { recursive: true }); await copyFile(f, b); }
for (const [f, s] of edits) await writeFile(f, s);
await writeFile(path.join(target, 'package.json'), JSON.stringify(pkgNext, null, 2) + '\n');
await mkdir(path.join(target, 'src', 'v1721'), { recursive: true });
for (const f of await readdir(path.join(kit, 'src', 'v1721'))) await copyFile(path.join(kit, 'src', 'v1721', f), path.join(target, 'src', 'v1721', f));
await mkdir(path.join(target, 'test', 'fixtures'), { recursive: true });
await copyFile(path.join(kit, 'test', 'migration.test.cjs'), path.join(target, 'test', 'v1721-migration.test.cjs'));
await copyFile(path.join(kit, 'test', 'fixtures.cjs'), path.join(target, 'test', 'fixtures.cjs'));
await copyFile(path.join(kit, 'test', 'fixtures', 'ap-schema-77.source.json'), path.join(target, 'test', 'fixtures', 'ap-schema-77.source.json'));
console.log(`\n\u2714 Applied. Backup: ${path.relative(target, backup)}\nNext: npm install && npm run typecheck && npm test && npm run build`);
