/** Static project review: unresolved imports, runtime import cycles, and duplicate exported names. */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = []; (function walk(d) { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } })(root);
const graph = new Map(); const problems = []; const exportsByName = new Map();
for (const f of files) {
  const src = readFileSync(f, 'utf8'); const deps = [];
  for (const m of src.matchAll(/^import\s+(type\s+)?[^'"]*?from\s+'([^']+)'/gm)) {
    const target = path.resolve(path.dirname(f), m[2]); const resolved = [`${target}.ts`, path.join(target, 'index.ts')].find(existsSync);
    if (!resolved) problems.push(`Unresolved import '${m[2]}' in ${path.relative(root, f)}`); else if (!m[1] && !/^import\s+\{?\s*type\s/.test(m[0])) deps.push(resolved);
  }
  graph.set(f, deps);
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/gm)) { const l = exportsByName.get(m[1]) || []; l.push(path.relative(root, f)); exportsByName.set(m[1], l); }
}
const cycles = []; const state = new Map();
function dfs(n, stack) { state.set(n, 1); stack.push(n); for (const d of graph.get(n) || []) { if (state.get(d) === 1) cycles.push([...stack.slice(stack.indexOf(d)), d].map((x) => path.relative(root, x)).join(' → ')); else if (!state.get(d)) dfs(d, stack); } stack.pop(); state.set(n, 2); }
files.forEach((f) => { if (!state.get(f)) dfs(f, []); });
const dups = [...exportsByName.entries()].filter(([, l]) => l.length > 1).map(([n, l]) => `${n}: ${l.join(', ')}`);
console.log(`${files.length} TypeScript files checked.`);
console.log(problems.length ? problems.join('\n') : 'No unresolved imports.');
console.log(cycles.length ? `Runtime import cycles:\n  ${cycles.join('\n  ')}` : 'No runtime import cycles.');
console.log(dups.length ? `Duplicate exported names:\n  ${dups.join('\n  ')}` : 'No duplicate exported names.');
process.exit(problems.length || cycles.length ? 1 : 0);
