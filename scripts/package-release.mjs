#!/usr/bin/env node
/** Assembles release/ - the exact folder to publish to any static host. */
import { readFile, writeFile, mkdir, rm, copyFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist', 'index.html'), out = path.join(root, 'release'), tpl = path.join(root, 'deploy');
try { await stat(dist); } catch { console.error('\u2716 release: dist/index.html not found - run "npm run build" first.'); process.exit(1); }
const html = await readFile(dist, 'utf8');
if (!html.includes('sqla-boot-guard:start')) { console.error('\u2716 release: dist/index.html is not hardened - run "node scripts/harden-dist.mjs".'); process.exit(1); }
await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
await copyFile(dist, path.join(out, 'index.html'));
try { for (const f of await readdir(tpl)) await copyFile(path.join(tpl, f), path.join(out, f)); } catch {}
await writeFile(path.join(out, '.nojekyll'), '');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await writeFile(path.join(out, 'version.json'), JSON.stringify({ name: pkg.name, version: pkg.version, builtAt: new Date().toISOString() }, null, 2));
console.log(`\u2714 release: ${(await readdir(out)).join(', ')} -> release/`);
