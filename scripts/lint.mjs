// Project lint: TypeScript strictness is enforced by tsc; this adds project rules.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const root = new URL('..', import.meta.url).pathname; const problems = [];
const files = []; (function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|html|css)$/.test(p)) files.push(p); } })(join(root, 'src')); files.push(join(root, 'public/index.html'));
const RULES = [
  [/AP_SQL_Assistant|AP SQL Assistant/, 'Old application name — the application is "SQL Assistant".'],
  [/\beval\s*\(|new Function\s*\(/, 'Dynamic code execution is not allowed.'],
  [/\bghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9]{20,}/, 'Hard-coded secret.'],
  [/console\.(log|info|debug)\(/, 'Use toasts/sync log instead of console logging (no secrets in browser logs).'],
  [/localStorage\.setItem\([^)]*(token|apiKey|aiApiKey|passphrase)/i, 'Secrets must be stored via the encrypted Secret Vault.'],
  [/\bdebugger\b/, 'Remove debugger statements.']
];
for (const f of files) { const lines = readFileSync(f, 'utf8').split('\n'); lines.forEach((l, i) => RULES.forEach(([re, msg]) => { if (re.test(l)) problems.push(`${relative(root, f)}:${i + 1}  ${msg}`); })); }
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`Lint passed (${files.length} files).`);
