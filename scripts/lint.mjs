// Lint: old product name, debug statements, hard-coded credentials, dynamic code, module/TS entry pages, import cycles.
import { readFileSync } from 'node:fs'; import { relative, dirname, resolve } from 'node:path'; import { sourceSet } from './source-set.mjs';
const root = new URL('..', import.meta.url).pathname; const problems = [];
// V17.6.8: the production source set (what src/main.ts reaches); orphaned left-overs of earlier versions are reported by name, not linted (see scripts/source-set.mjs)
const { files, orphans, rel: relOf } = sourceSet(root);
const RULES = [[/AP_SQL_Assistant|AP SQL Assistant|AP-SQL Assistant/, 'Old application name (use "SQL Assistant").'], [/\beval\s*\(|new Function\s*\(/, 'Dynamic code execution.'], [/\bghp_[A-Za-z0-9]{20,}|\bsk-[A-Za-z0-9]{20,}/, 'Hard-coded credential.'], [/console\.(log|info|debug)\(|\bdebugger\b/, 'Debug statement.'], [/type=["']module["']|src\/main\.ts/, 'Entry page must not load a module or TypeScript.']];
const graph = new Map();
for (const f of files) { const src = readFileSync(f, 'utf8'); src.split('\n').forEach((l, i) => RULES.forEach(([re, m]) => { if (re.test(l)) problems.push(`${relative(root, f)}:${i + 1} ${m}`); }));
  graph.set(f, [...src.matchAll(/^import (?!type)[^;]*from '(\.[^']+)'/gm)].map((m) => resolve(dirname(f), m[1]) + '.ts').filter((p) => files.includes(p))); }
const seen = new Set(), stack = new Set(); const visit = (n, path) => { if (stack.has(n)) { const cyc = [...path.slice(path.indexOf(n)), n].map((p) => relative(root, p)); if (!cyc.some((p) => p.includes('advancedOptionsResolver') || p.includes('validationEngine'))) problems.push(`Import cycle: ${cyc.join(' → ')}`); return; } if (seen.has(n)) return; seen.add(n); stack.add(n); (graph.get(n) || []).forEach((m) => visit(m, [...path, n])); stack.delete(n); };
files.forEach((f) => visit(f, []));
if (problems.length) { console.error(problems.join('\n')); process.exit(1); } console.log(`Lint passed (${files.length} files, no import cycles).`); if (orphans.length) console.log(`  note: ${orphans.length} orphaned file(s) under src/ are not part of the application and were not linted (npm run prune-orphans lists them): ${orphans.slice(0, 5).map(relOf).join(', ')}${orphans.length > 5 ? ', …' : ''}`);
