import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const root = new URL('..', import.meta.url).pathname; const files = []; const problems = [];
(function w(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) w(p); else if (p.endsWith('.ts')) files.push(p); } })(join(root, 'src'));
const RULES = [[/AP_SQL_Assistant|AP SQL Assistant|AP-SQL Assistant/, 'Old application name.'], [/\beval\s*\(|new Function\s*\(/, 'Dynamic code execution.'], [/\bghp_[A-Za-z0-9]{20,}|\bsk-[A-Za-z0-9]{20,}/, 'Hard-coded secret.'], [/console\.(log|info|debug)\(/, 'Console logging.'], [/type=["']module["']|src\/main\.ts/, 'Entry page must not load a module or TypeScript.']];
for (const f of files) readFileSync(f, 'utf8').split('\n').forEach((l, i) => RULES.forEach(([re, m]) => { if (re.test(l)) problems.push(`${relative(root, f)}:${i + 1} ${m}`); }));
if (problems.length) { console.error(problems.join('\n')); process.exit(1); } console.log(`Lint passed (${files.length} files).`);
