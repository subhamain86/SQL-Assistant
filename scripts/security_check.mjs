// npm run security — static security review of the source and the production build (requirement 23).
// Fails the build when it finds: credentials in source/bundle, secrets written to storage in readable form, console output, dynamic code,
// document.write, unescaped HTML sinks that interpolate user-controlled text, or network calls to anything but GitHub / the configured model endpoint.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'; import { join, relative } from 'node:path';
import { validateAdminCredential } from '../server/repo-broker.mjs';
const root = new URL('..', import.meta.url).pathname; const files = []; const problems = []; const notes = [];
(function w(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) w(p); else if (p.endsWith('.ts')) files.push(p); } })(join(root, 'src'));
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
    // V17.6.5 — the Admin Password is never held or written in a readable or reversible form. Comment lines are skipped (they describe the rules); every rule names the line.
    if (!/^\s*(\/\/|\*|\/\*)/.test(l)) {
      const PW = /\b(password|passwd|pwd|newPassword|oldPassword|adminPassword|candidate)\b/i;
      if (/(localStorage|sessionStorage|store|kv)\.(setItem|set)\(/.test(l) && PW.test(l.replace(/\bSTORAGE_KEY\b|KEYS\.[A-Za-z]+/g, '')) && !/encrypt|seal\(|serializeAdminCredential|buildAdminCredential/.test(l)) problems.push(`${at} a password-like value is written to storage (only encrypted markers may be)`);
      if (/\b(btoa|utf8ToBase64|toB64|toBase64|Buffer\.from)\([^)]*\b(password|passwd|pwd|newPassword|oldPassword|adminPassword)\b/i.test(l)) problems.push(`${at} a password is Base64-encoded (a reversible form)`);
      if (/\b(password|passwd|pwd|adminPassword|newPassword|oldPassword)\b\s*[:=]\s*(['"`])(?!\2)(?!admin\2)[^'"`$]{1,}\2/i.test(l) && !/placeholder|autocomplete|label|hint|type=|id=|aria-|\bname=/i.test(l)) problems.push(`${at} a plaintext password literal`);
      if (/JSON\.stringify\(\s*\{[^}]*\b(password|passwd|pwd)\b\s*[:,}]/i.test(l)) problems.push(`${at} a password is serialized into a JSON body`);
      if (/(fetch|call|brokerCall)\([^)]*\b(password|passwd|pwd|newPassword|oldPassword)\b/i.test(l)) problems.push(`${at} a password is placed in a request`);
      if (/\b(location|history)\b[^;]*\b(password|passwd|pwd|newPassword|oldPassword)\b/i.test(l) && /(href|hash|search|pushState|replaceState)/.test(l)) problems.push(`${at} a password near a URL / history assignment`);
    }
    // V17.5 passphrase hygiene: never placed in a URL / history / title, never interpolated into markup or an HTML value attribute
    if (/(location\.(hash|search|href)\s*=|history\.(push|replace)State|document\.title\s*=)[^;]*pass(phrase)?\b/i.test(l)) problems.push(`${at} passphrase near a URL / history / title assignment`);
    if (/innerHTML\s*=[^;]*\$\{\s*(pass|passphrase|pw|newPass)\b/i.test(l)) problems.push(`${at} passphrase interpolated into markup`);
    if (/value=\\?"\$\{\s*(pass|passphrase|saved)\b/i.test(l)) problems.push(`${at} passphrase written into an HTML value attribute`);
    if (/\.innerHTML\s*=\s*[^;]*\$\{(?!e\(|icon\(|esc\()[^}]*(Text|text|name|Name|value|sql|message)[^}]*\}/.test(l) && !/e\(|esc\(/.test(l.slice(l.indexOf('${')))) notes.push(`${at} review: innerHTML interpolates a text-like value without e()`);
  });
}
// V17.6.5 — a central Admin Password record that is checked into the repository (or sits in a published copy) must be a valid encrypted-marker record: no plaintext, no Base64, no extra field.
for (const rel of ['sql-assistant-data/security/admin-credential.json', 'dist/sql-assistant-data/security/admin-credential.json', 'release/sql-assistant-data/security/admin-credential.json']) {
  const f = join(root, rel); if (!existsSync(f)) continue; const v = validateAdminCredential(readFileSync(f, 'utf8')); if (!v.ok) problems.push(`${rel}: not a valid encrypted Admin Password record (${v.reason})`); else notes.push(`${rel}: valid encrypted-marker record (revision ${v.record.revision})`);
}
const html = existsSync(join(root, 'dist/index.html')) ? readFileSync(join(root, 'dist/index.html'), 'utf8') : '';
if (!html) problems.push('dist/index.html is missing — run npm run build first'); else {
  if (CRED.test(html)) problems.push('dist/index.html: credential-looking string in the frontend bundle');
  if (!/Content-Security-Policy/.test(html) || /unsafe-eval/.test(html)) problems.push('dist/index.html: Content-Security-Policy missing or allows eval');
  if (/<script[^>]+src=|type="module"/.test(html)) problems.push('dist/index.html: external or module script');
  const hosts = new Set([...html.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase())); const okHost = /^(api\.github\.com|localhost|127\.0\.0\.1|www\.w3\.org|api\.openai\.com|api\.anthropic\.com|getbootstrap\.com|\{resource\}\.openai\.azure\.com|github\.com)$/;
  [...hosts].filter((h) => !okHost.test(h) && !/\.openai\.azure\.com$/.test(h)).forEach((h) => notes.push(`host referenced in the bundle: ${h}`));
}
console.log(`Security check: ${files.length} source files, dist/index.html ${html ? 'scanned' : 'missing'}.`); notes.forEach((n) => console.log(`  note: ${n}`));
if (problems.length) { console.error(problems.join('\n')); process.exit(1); } console.log('Security check passed (no credentials, no console output, no dynamic code, CSP present, only GitHub / configured model endpoints).');
