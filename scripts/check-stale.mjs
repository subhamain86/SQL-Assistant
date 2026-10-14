#!/usr/bin/env node
/**
 * V17.6.9 — REPOSITORY HYGIENE CHECK (npm run check:stale). It runs SEPARATELY from the tests and from compilation and answers one question: does this checkout contain files that no longer belong to the application?
 *
 * Why. Publishing a version by copying a package over the repository never deletes what an EARLIER version had and the new one does not. The supplied CI log (logs_104051351287) shows the result: 54 orphaned TypeScript files under
 * src/ and five historical test files (engines, v1756, v1758, v1759, v176) that exercise modules which are no longer part of the application — 23 failing tests, none of them in the V17.6.8 package (266/266 pass without them).
 * Compilation, lint, security and the tests all start from the real production entry point (src/main.ts); this check reports everything that does not, BY NAME, and fails. It never deletes anything:
 *   node scripts/prune-orphans.mjs --delete        removes the unreferenced TypeScript files (re-verified at the moment of deletion)
 *   node scripts/prune-stale.mjs --delete          removes the REVIEWED list in scripts/stale-files.json (re-verified)
 *
 * Checks (each failure is a GitHub Actions error annotation naming the file and the remedy):
 *   1. ORPHANS      — .ts files under src/ that src/main.ts does not reach through relative imports;
 *   2. STALE LIST   — files named in scripts/stale-files.json (the reviewed left-overs) that still exist;
 *   3. TEST IMPORTS — a test that imports a build/esm module whose source is not part of the production graph (a test of code the application does not run — or of a stub);
 *   4. BROWSER LIST — scripts named by `npm run test:browser` that do not exist.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'; import { join, resolve } from 'node:path'; import { fileURLToPath } from 'node:url'; import { sourceSet, TEST_ONLY } from './source-set.mjs';
export function checkStale(root) {
  const problems = []; const { files, orphans, rel } = sourceSet(root); const prod = new Set(files.map((f) => rel(f)));
  for (const t of TEST_ONLY) if (prod.has(t)) problems.push({ file: t, title: 'Test hook reachable from production', msg: 'src/main.ts reaches this browser-test module, so it would ship in dist/, index.html and release/. Test hooks are compiled only into the test build (npm run build:test).' }); // V17.7
  for (const f of orphans) problems.push({ file: rel(f), title: 'Orphaned TypeScript file', msg: 'Not reachable from src/main.ts, so it is not part of the application and is not compiled, linted or scanned. Review it, then remove it: node scripts/prune-orphans.mjs --delete' });
  let list = []; try { list = JSON.parse(readFileSync(join(root, 'scripts/stale-files.json'), 'utf8')).files || []; } catch { /* no list */ }
  for (const e of list) if (existsSync(join(root, e.path)) && !orphans.some((o) => rel(o) === e.path)) problems.push({ file: e.path, title: e.kind === 'stale-test' ? 'Stale test file' : 'Stale file', msg: `${e.reason} Remove it: node scripts/prune-stale.mjs --delete` });
  const testDir = join(root, 'test'); const imports = /\bimp\(\s*['"]([^'"]+?)(?:\.js)?['"]\s*\)|build\/esm\/([A-Za-z0-9_./-]+?)(?:\.js)?['"`)]/g;
  if (existsSync(testDir)) for (const f of readdirSync(testDir).filter((x) => /\.(mjs|js)$/.test(x))) {
    const text = readFileSync(join(testDir, f), 'utf8'); const bad = new Set();
    for (const m of text.matchAll(imports)) { const mod = (m[1] || m[2] || '').replace(/^\.\//, ''); if (!mod || mod.includes('..')) continue; if (!prod.has(`src/${mod}.ts`) && !prod.has(`src/${mod}/index.ts`)) bad.add(mod); }
    for (const mod of bad) problems.push({ file: `test/${f}`, title: 'Test imports code outside the production graph', msg: `src/${mod}.ts is not reachable from src/main.ts — the test exercises code that the application does not run (or that does not exist). Remove the test, or test the production module.` });
  }
  try { const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); for (const m of String(pkg.scripts?.['test:browser'] || '').matchAll(/python3 (scripts\/[A-Za-z0-9_.]+\.py)/g)) if (!existsSync(join(root, m[1]))) problems.push({ file: m[1], title: 'Missing browser suite', msg: 'package.json test:browser names a script that does not exist.' }); } catch { /* no package.json */ }
  return { problems, production: files.length, orphans: orphans.map(rel) };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = resolve(process.argv[2] || new URL('..', import.meta.url).pathname); const r = checkStale(root);
  if (!r.problems.length) { process.stdout.write(`Repository hygiene passed: ${r.production} production source files, no orphaned or stale files, every test imports production code.\n`); process.exit(0); }
  for (const p of r.problems) process.stderr.write(`::error file=${p.file},title=${p.title}::${p.msg}\n`);
  process.stderr.write(`\n${r.problems.length} problem(s). Nothing was deleted. After reviewing the names above, run:\n  node scripts/prune-orphans.mjs --delete && node scripts/prune-stale.mjs --delete\nthen commit the deletion (git add -A).\n`); process.exit(1);
}
