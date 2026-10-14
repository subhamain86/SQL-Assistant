/**
 * V17.6.8 — the PRODUCTION SOURCE SET: the TypeScript modules that src/main.ts reaches through relative imports, and the ORPHANS (files under src/ that nothing imports).
 *
 * Why. Publishing a version by copying a package over the repository never removes files that an EARLIER version had and the new one no longer has. Such leftovers (in the supplied CI log:
 * src/components/*, src/pages/*, src/state/store.ts, src/ui/adminCredentialSync.ts, src/v17/services/adminCredential*.ts …, 33 files) are not part of the application, but `tsc -p` with `include: src/**` compiled
 * them and failed the GitHub Pages "Typecheck" step. tsconfig.json now compiles from the entry point (files: src/main.ts) with every strict option unchanged, and lint / security scan exactly the same set.
 * Orphans are REPORTED by name (never silently ignored): scripts/prune-orphans.mjs lists them and deletes them on request.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'; import { join, dirname, resolve, relative } from 'node:path';
const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.ts')) out.push(p); } return out; };
const IMPORT = /(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*['"](\.[^'"]+)['"]|(?:^|[\s;])import\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g;
/** V17.7: modules of the browser-test build only (never imported by src/main.ts, never part of dist/, index.html or release/). */
export const TEST_ONLY = ['src/testHooks.ts'];
export function sourceSet(root) {
  const srcDir = join(root, 'src'); const all = walk(srcDir).sort(); const entry = join(srcDir, 'main.ts'); const seen = new Set(); const stack = existsSync(entry) ? [entry] : [];
  while (stack.length) { const f = stack.pop(); if (seen.has(f)) continue; seen.add(f); const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(IMPORT)) { const spec = m[1] || m[2] || m[3]; const base = resolve(dirname(f), spec); for (const c of [`${base}.ts`, join(base, 'index.ts')]) if (existsSync(c)) { stack.push(c); break; } } }
  // V17.7: files that are compiled ONLY into the browser-test build (tsconfig.test.json) are declared here. They are neither production nor orphans; check-stale fails if the production graph ever reaches one.
  const rel = (f) => relative(root, f).split('\\').join('/'); const testOnly = all.filter((f) => TEST_ONLY.includes(rel(f)));
  const files = all.filter((f) => seen.has(f)); const orphans = all.filter((f) => !seen.has(f) && !testOnly.includes(f)); return { files, orphans, testOnly, rel };
}
