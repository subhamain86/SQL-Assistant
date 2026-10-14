#!/usr/bin/env node
/**
 * V17.6.8 — lists (and, with --delete, removes) the ORPHANS under src/: TypeScript files that the application (src/main.ts) does not import. They are left-overs of earlier versions that were copied
 * over the repository (a copy never deletes). They are not compiled, linted or scanned any more (see scripts/source-set.mjs), but they should not stay in the repository.
 *   node scripts/prune-orphans.mjs            list only
 *   node scripts/prune-orphans.mjs --check    list them and EXIT 1 when there are any (V17.6.9)
 *   node scripts/prune-orphans.mjs --delete   delete them (then commit the deletion)
 */
import { rmSync, readdirSync, rmdirSync } from 'node:fs'; import { dirname, join } from 'node:path'; import { sourceSet } from './source-set.mjs';
const root = new URL('..', import.meta.url).pathname; const { orphans, rel } = sourceSet(root); const del = process.argv.includes('--delete'); const check = process.argv.includes('--check');
if (!orphans.length) { process.stdout.write('No orphaned source files under src/.\n'); process.exit(0); }
for (const f of orphans) { process.stdout.write(`${del ? 'deleted ' : 'orphan  '}${rel(f)}\n`); if (del) { rmSync(f); let d = dirname(f); try { while (d !== join(root, 'src') && readdirSync(d).length === 0) { rmdirSync(d); d = dirname(d); } } catch { /* ignore */ } } }
process.stdout.write(`${orphans.length} orphaned file(s)${del ? ' deleted.' : ' — run with --delete to remove them.'}\n`); if (check && !del) process.exit(1);
