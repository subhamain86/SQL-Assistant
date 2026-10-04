/**
 * Lint (no external dependencies): import graph checks + source rules.
 *  - no console.log / debugger / eval / new Function in src
 *  - no hard-coded credentials in src, test fixtures excluded
 *  - no old product name "AP-SQL Assistant" / "AP SQL Assistant" in user-facing source
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'; import { execFileSync } from 'node:child_process';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [path.join(root, 'scripts', 'check-imports.mjs')], { stdio: 'inherit' });
const files = []; (function walk(d) { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|css)$/.test(p)) files.push(p); } })(path.join(root, 'src'));
const rules = [
  [/\bconsole\.(log|debug)\s*\(/, 'console.log/debug left in source'], [/\bdebugger\b/, 'debugger statement'], [/\beval\s*\(|new Function\s*\(/, 'eval / new Function'],
  [/\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:ant-)?[A-Za-z0-9_-]{30,})\b/, 'hard-coded credential'],
  [/AP[- ]SQL Assistant/, 'old product name (the application is called "SQL Assistant")']
];
const problems = [];
for (const f of files) { readFileSync(f, 'utf8').split('\n').forEach((line, i) => rules.forEach(([re, msg]) => { if (re.test(line)) problems.push(`${path.relative(root, f)}:${i + 1}: ${msg}`); })); }
console.log(problems.length ? `Lint problems:\n  ${problems.join('\n  ')}` : `Lint: ${files.length} source files clean.`);
process.exit(problems.length ? 1 : 0);
