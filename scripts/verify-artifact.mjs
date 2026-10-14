#!/usr/bin/env node
/**
 * V17.7 adds: no browser-test hook (`__sqla`, `?e2e=1`, testHooks) and no global module loader in any published page.
 * V17.6.9 — GENERATED-ARTIFACT INTEGRITY (npm run verify:artifact). Run AFTER `npm run build`; deployment must not start when it fails.
 *   · root index.html, dist/index.html and release/index.html + release/404.html are BYTE-IDENTICAL (one build, three places) and carry the package version;
 *   · release/ holds the complete publication structure: index.html, 404.html (deep-link / refresh fallback), .nojekyll, version.json (name + version = package.json), staticwebapp.config.json (navigationFallback → /index.html), web.config (IIS 404 → /index.html);
 *   · the page is SELF-CONTAINED and base-path independent: no module / external script, no external stylesheet, no src/main.ts, no absolute same-site path in src / href attributes, a CSP whose script hash matches the inline script;
 *   · NO SECRET in any published file (GitHub tokens, private keys, API keys) and none of the synthetic test values;
 *   · the published data folder (release/sql-assistant-data) contains only *.json files.
 * Output: GitHub Actions annotations (::error file=…,title=…::…). Exit 1 on any problem.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'; import { join, resolve, relative } from 'node:path'; import { createHash } from 'node:crypto'; import { fileURLToPath } from 'node:url';
const CRED = /\bgh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); } return out; };
export function verifyArtifact(root) {
  const problems = []; const bad = (file, title, msg) => problems.push({ file, title, msg }); const read = (p) => readFileSync(join(root, p), 'utf8');
  let pkg; try { pkg = JSON.parse(read('package.json')); } catch { return { problems: [{ file: 'package.json', title: 'Artifact', msg: 'package.json is missing or not valid JSON.' }], checked: 0 }; }
  const need = ['index.html', 'dist/index.html', 'release/index.html', 'release/404.html', 'release/.nojekyll', 'release/version.json', 'release/staticwebapp.config.json', 'release/web.config'];
  for (const f of need) if (!existsSync(join(root, f))) bad(f, 'Missing generated file', 'Run npm run build; the publication structure is incomplete.');
  if (problems.length) return { problems, checked: 0 };
  const html = read('dist/index.html'); const h = (s) => createHash('sha256').update(s).digest('hex');
  for (const f of ['index.html', 'release/index.html', 'release/404.html']) if (h(read(f)) !== h(html)) bad(f, 'Generated outputs differ', 'This file is not identical to dist/index.html — the outputs were not produced by one build.');
  if (!html.includes(`SQL Assistant ${pkg.version}`)) bad('dist/index.html', 'Version stamp', `The page does not carry SQL Assistant ${pkg.version}.`);
  let v = {}; try { v = JSON.parse(read('release/version.json')); } catch { bad('release/version.json', 'Release metadata', 'Not valid JSON.'); } if (v.version !== pkg.version || v.name !== 'SQL Assistant') bad('release/version.json', 'Release metadata', `Expected SQL Assistant ${pkg.version}, found ${v.name} ${v.version}.`);
  try { if (JSON.parse(read('release/staticwebapp.config.json'))?.navigationFallback?.rewrite !== '/index.html') bad('release/staticwebapp.config.json', 'Deep links', 'navigationFallback must rewrite to /index.html (refresh / deep-link behaviour on Azure Static Web Apps).'); } catch { bad('release/staticwebapp.config.json', 'Deep links', 'Not valid JSON.'); }
  if (!/<error statusCode="404" path="\/index\.html"/.test(read('release/web.config'))) bad('release/web.config', 'Deep links', 'IIS must answer 404 with /index.html (refresh / deep-link behaviour).');
  if (/type="module"|<script[^>]+src=|src\/main\.ts|<link[^>]+stylesheet[^>]+href=/i.test(html)) bad('dist/index.html', 'Self-contained', 'The page loads a module / external script / external stylesheet / src/main.ts.');
  if (/\b(?:src|href)="\/(?!\/)/i.test(html)) bad('dist/index.html', 'Base path', 'The page uses an absolute same-site path (src/href starting with "/"); it must work under any base path.');
  const script = (html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/) || [])[1]; const csp = (html.match(/script-src 'sha256-([A-Za-z0-9+/=]+)'/) || [])[1];
  if (!script || !csp || createHash('sha256').update(script, 'utf8').digest('base64') !== csp) bad('dist/index.html', 'Content-Security-Policy', 'The CSP script hash does not match the inline script.'); if (/unsafe-eval/.test(html)) bad('dist/index.html', 'Content-Security-Policy', 'unsafe-eval is allowed.');
  const files = [...walk(join(root, 'release')), join(root, 'index.html'), join(root, 'dist/index.html'), ...(existsSync(join(root, 'dist/sql-assistant-data')) ? walk(join(root, 'dist/sql-assistant-data')) : [])];
  // V17.7: the browser-test seam (src/testHooks.ts → test-dist/) must leave NO trace in a published artifact, and the script must run in a closure (no global `define`, no module registry on `window`).
  const HOOK = /\b__sqla\b|__sqlaRequire|installTestHooks|testHooks|BROWSER-TEST BUILD|[?&]e2e=1|get\('e2e'\)|window\.define\s*=/;
  for (const f of [join(root, 'index.html'), join(root, 'dist/index.html'), ...walk(join(root, 'release')).filter((x) => /\.html$/i.test(x))]) { const t = readFileSync(f, 'utf8'); const r = relative(root, f).split('\\').join('/'); const m = t.match(HOOK); if (m) bad(r, 'Test hook in a production artifact', `The production page contains "${m[0]}": the browser-test hooks must exist only in test-dist/ (npm run build:test).`); const sc = (t.match(/<script>([\s\S]*)<\/script>\s*<\/body>/) || [])[1] || ''; if (!sc.startsWith('(function(){') || !sc.trimEnd().endsWith('})();')) bad(r, 'Script scope', 'The inline script must run inside one function scope (no global module loader).'); }
  for (const f of files) { const t = readFileSync(f, 'utf8'); const r = relative(root, f).split('\\').join('/'); if (CRED.test(t)) bad(r, 'Secret in a published artifact', 'A credential-looking string is present. The artifact must not be published.'); if (/SYNTHETIC-|MyCentralPassword|Third-Device-Pw/.test(t)) bad(r, 'Test value in a published artifact', 'A synthetic test value is present.'); }
  const data = join(root, 'release/sql-assistant-data'); if (existsSync(data)) for (const f of walk(data)) { const r = relative(root, f).split('\\').join('/'); if (!/\.json$/i.test(f)) bad(r, 'Published data', 'Only *.json files may be published.'); }
  return { problems, checked: files.length + need.length };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = resolve(process.argv[2] || new URL('..', import.meta.url).pathname); const r = verifyArtifact(root);
  if (r.problems.length) { for (const p of r.problems) process.stderr.write(`::error file=${p.file},title=${p.title}::${p.msg}\n`); process.stderr.write(`\nArtifact verification FAILED (${r.problems.length} problem(s)) — nothing may be published.\n`); process.exit(1); }
  process.stdout.write(`Artifact verification passed: root index.html = dist/index.html = release/index.html = release/404.html, release structure complete, version.json matches package.json, self-contained, base-path independent, ${r.checked} file(s) scanned, no secret.\n`);
}
