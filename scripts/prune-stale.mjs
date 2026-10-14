#!/usr/bin/env node
/**
 * V17.6.9 — lists (and, with --delete, removes) the REVIEWED stale files named in scripts/stale-files.json: left-overs of earlier versions (historical test files, orphaned sources) that the current package does not contain.
 *   node scripts/prune-stale.mjs            list only
 *   node scripts/prune-stale.mjs --delete   delete them (then commit the deletion)
 * Safety: only paths NAMED in the reviewed list, only inside this repository, only regular files; a .ts file is deleted only if src/main.ts still does not reach it; a test file only if package.json does not run it.
 */
import { readFileSync, existsSync, lstatSync, rmSync, readdirSync, rmdirSync } from 'node:fs'; import { join, dirname, resolve, sep } from 'node:path'; import { sourceSet } from './source-set.mjs';
const root = new URL('..', import.meta.url).pathname; const del = process.argv.includes('--delete');
const list = JSON.parse(readFileSync(join(root, 'scripts/stale-files.json'), 'utf8')).files || []; const { files, rel } = sourceSet(root); const prod = new Set(files.map(rel)); const pkgText = readFileSync(join(root, 'package.json'), 'utf8');
let n = 0, kept = 0;
for (const e of list) {
  const abs = resolve(root, e.path); if (!abs.startsWith(resolve(root) + sep) || !existsSync(abs)) continue; if (!lstatSync(abs).isFile()) { process.stdout.write(`skipped (not a regular file) ${e.path}\n`); continue; }
  if (prod.has(e.path)) { process.stdout.write(`KEPT (reachable from src/main.ts — not stale) ${e.path}\n`); kept++; continue; }
  if (e.kind === 'stale-test' && pkgText.includes(e.path)) { process.stdout.write(`KEPT (package.json runs it) ${e.path}\n`); kept++; continue; }
  process.stdout.write(`${del ? 'deleted ' : 'stale   '}${e.path}\n`); n++;
  if (del) { rmSync(abs); let d = dirname(abs); try { while (d !== resolve(root, 'src') && d !== resolve(root, 'test') && d !== resolve(root) && readdirSync(d).length === 0) { rmdirSync(d); d = dirname(d); } } catch { /* ignore */ } }
}
process.stdout.write(n || kept ? `${n} stale file(s)${del ? ' deleted.' : ' — run with --delete to remove them.'}${kept ? ` ${kept} kept.` : ''}\n` : 'No stale files from the reviewed list.\n');
