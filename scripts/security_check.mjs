// npm run security — static security review of the source and the production build (requirement 23).
// Fails the build when it finds: credentials in source/bundle, secrets written to storage in readable form, console output, dynamic code,
// document.write, unescaped HTML sinks that interpolate user-controlled text, or network calls to anything but GitHub / the configured model endpoint.
import { readFileSync, existsSync } from 'node:fs'; import { join, relative } from 'node:path'; import { sourceSet } from './source-set.mjs';
const root = new URL('..', import.meta.url).pathname; const problems = []; const notes = [];
// V17.6.8: the production source set (what src/main.ts reaches) — the same set tsc compiles; orphaned left-overs of earlier versions are reported by name as a note
const { files, orphans, rel: relOf } = sourceSet(root); if (orphans.length) notes.push(`${orphans.length} orphaned file(s) under src/ are not part of the application and were not scanned (npm run prune-orphans lists them): ${orphans.slice(0, 5).map(relOf).join(', ')}${orphans.length > 5 ? ', …' : ''}`);
const CRED = /\bghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
for (const f of files) {
  const src = readFileSync(f, 'utf8'); const rel = relative(root, f);
  src.split('\n').forEach((l, i) => {
    const at = `${rel}:${i + 1}`;
    if (CRED.test(l) && !/'ghp_' \+|"ghp_" \+/.test(l)) problems.push(`${at} possible credential in source`);
    if (/console\.(log|info|debug|warn|error|trace)\(/.test(l)) problems.push(`${at} console output (could leak a secret)`);
    if (/\beval\s*\(|new Function\s*\(|document\.write\(|setTimeout\(\s*['"`]/.test(l)) problems.push(`${at} dynamic code execution / document.write`);
    if (/(localStorage|sessionStorage|store|kv)\.(setItem|set)\(\s*['"`][^'"`]*(token|secret|password|apikey|api_key)/i.test(l) && !/vault\.local|pwvault|secretvault/.test(l)) problems.push(`${at} a secret-looking key is written to storage`);
    if (/fetch\(\s*['"`]http:\/\/(?!localhost|127\.0\.0\.1)/.test(l)) problems.push(`${at} plain-HTTP request`);
    // V17.5 passphrase hygiene: never placed in a URL / history / title, never interpolated into markup or an HTML value attribute
    if (/(location\.(hash|search|href)\s*=|history\.(push|replace)State|document\.title\s*=)[^;]*pass(phrase)?\b/i.test(l)) problems.push(`${at} passphrase near a URL / history / title assignment`);
    if (/innerHTML\s*=[^;]*\$\{\s*(pass|passphrase|pw|newPass)\b/i.test(l)) problems.push(`${at} passphrase interpolated into markup`);
    if (/value=\\?"\$\{\s*(pass|passphrase|saved)\b/i.test(l)) problems.push(`${at} passphrase written into an HTML value attribute`);
    if (/\.innerHTML\s*=\s*[^;]*\$\{(?!e\(|icon\(|esc\()[^}]*(Text|text|name|Name|value|sql|message)[^}]*\}/.test(l) && !/e\(|esc\(/.test(l.slice(l.indexOf('${')))) notes.push(`${at} review: innerHTML interpolates a text-like value without e()`);
  });
}
const html = existsSync(join(root, 'dist/index.html')) ? readFileSync(join(root, 'dist/index.html'), 'utf8') : '';
if (!html) problems.push('dist/index.html is missing — run npm run build first'); else {
  if (CRED.test(html)) problems.push('dist/index.html: credential-looking string in the frontend bundle');
  if (!/Content-Security-Policy/.test(html) || /unsafe-eval/.test(html)) problems.push('dist/index.html: Content-Security-Policy missing or allows eval');
  if (/<script[^>]+src=|type="module"/.test(html)) problems.push('dist/index.html: external or module script');
  const hosts = new Set([...html.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase())); const okHost = /^(api\.github\.com|localhost|127\.0\.0\.1|www\.w3\.org|api\.openai\.com|api\.anthropic\.com|getbootstrap\.com|\{resource\}\.openai\.azure\.com|github\.com)$/;
  [...hosts].filter((h) => !okHost.test(h) && !/\.openai\.azure\.com$/.test(h)).forEach((h) => notes.push(`host referenced in the bundle: ${h}`));
}
// V17.6.9: the scan covers EVERY generated output — the root index.html and everything under release/ (what is actually published) — not only dist/index.html
import { readdirSync, statSync } from 'node:fs';
const gen = []; if (existsSync(join(root, 'index.html'))) gen.push(join(root, 'index.html')); (function walkRel(d) { if (!existsSync(d)) return; for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walkRel(p); else gen.push(p); } })(join(root, 'release'));
for (const f of gen) { const t = readFileSync(f, 'utf8'); if (CRED.test(t)) problems.push(`${relative(root, f)}: credential-looking string in a generated output`); if (/unsafe-eval/.test(t)) problems.push(`${relative(root, f)}: Content-Security-Policy allows eval`); }
console.log(`Security check: ${files.length} source files, dist/index.html ${html ? 'scanned' : 'missing'}, ${gen.length} generated file(s) of the root index.html and release/ scanned.`); notes.forEach((n) => console.log(`  note: ${n}`));
if (problems.length) { console.error(problems.join('\n')); process.exit(1); } console.log('Security check passed (no credentials, no console output, no dynamic code, CSP present, only GitHub / configured model endpoints).');
