#!/usr/bin/env node
/**
 * verify-no-npm.mjs — runs the same stages as `npm run verify` WITHOUT npm.
 *   node scripts/verify-no-npm.mjs [--skip-browser] [--only=typecheck,lint,security,test,build,test:browser]
 *
 * Why: in locked-down environments `npm run` / `npm install` can fail — the registry answers 403, or a global `tsc` of another major
 * version (for example TypeScript 6.x, which rejects "moduleResolution": "node") is picked up instead of the pinned 5.8.3.
 * This runner calls node / python directly and always uses a TypeScript 5.x it can find.
 *
 * TypeScript lookup (V17.6.9): ./node_modules/typescript → $NODE_PATH/typescript — the PROJECT-PINNED installation only (no environment-specific absolute path). The version must be exactly the one pinned in package.json (5.8.3).
 * Browser suites: run one after the other (they use fixed waits; parallel runs cause false timing failures). Set PLAYWRIGHT_BROWSERS_PATH if
 * Playwright wants a different Chromium revision than the one installed, or CHROME_PATH to use a specific browser executable.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const skipBrowser = args.includes('--skip-browser');
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);

const candidates = [
  join(root, 'node_modules/typescript/bin/tsc'),
  ...(process.env.NODE_PATH || '').split(':').filter(Boolean).map((p) => join(p, 'typescript/bin/tsc')),
];
const pin = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies?.typescript;
const tsc = candidates.find((c) => existsSync(c) && JSON.parse(readFileSync(join(dirname(dirname(c)), 'package.json'), 'utf8')).version === pin);
if (!tsc) { console.error(`No project-pinned TypeScript ${pin} found. Looked in:\n  ` + candidates.join('\n  ')); process.exit(2); }
console.log(`Using TypeScript ${JSON.parse(readFileSync(join(dirname(dirname(tsc)), 'package.json'), 'utf8')).version} (${tsc})`);

const node = process.execPath;
const py = process.env.PYTHON || 'python3';
const run = (cmd, a) => spawnSync(cmd, a, { cwd: root, stdio: 'inherit', env: process.env }).status === 0;
const stages = [
  ['clean', () => { for (const d of ['build', 'build-test', 'dev-dist', 'test-dist', 'release', 'test-results']) rmSync(join(root, d), { recursive: true, force: true }); if (existsSync(join(root, 'dist'))) for (const f of readdirSync(join(root, 'dist'))) if (f !== 'sql-assistant-data') rmSync(join(root, 'dist', f), { recursive: true, force: true }); /* V17.6.9: the published copy of the repository data is not build output */ return true; }],
  ['toolchain', () => run(node, ['scripts/check-toolchain.mjs'])],
  ['typecheck', () => run(node, [tsc, '-p', 'tsconfig.json', '--noEmit'])],
  ['lint', () => run(node, ['scripts/lint.mjs'])],
  ['check:stale', () => run(node, ['scripts/check-stale.mjs'])],
  ['build', () => run(node, ['scripts/build.mjs'])],
  ['security', () => run(node, ['scripts/security_check.mjs'])],
  ['verify:artifact', () => run(node, ['scripts/verify-artifact.mjs'])],
  ['test', () => run(node, ['scripts/build.mjs']) && run(node, ['--test', '--test-concurrency=1', ...readdirSync(join(root, 'test')).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => 'test/' + f)])],
  ['build:dev', () => run(node, ['scripts/build.mjs', '--dev'])],
  ['build:test', () => run(node, [tsc, '-p', 'tsconfig.test.json', '--noEmit']) && run(node, ['scripts/build.mjs', '--test'])], // V17.7: the browser-test build (src/testHooks.ts) — the production build never contains it
  ['build:final', () => run(node, ['scripts/build.mjs']) && run(node, ['scripts/verify-artifact.mjs'])],
];
if (!skipBrowser) stages.push(['test:browser', () => {
  const scripts = readdirSync(join(root, 'scripts')).filter((f) => /^browser_test.*\.py$/.test(f)).sort((a, b) => (a === 'browser_test.py' ? -1 : b === 'browser_test.py' ? 1 : a.localeCompare(b, undefined, { numeric: true })));
  return scripts.every((s) => { console.log('\n>> ' + s); return run(py, ['scripts/' + s]); });
}]);

const results = [];
for (const [name, fn] of stages) {
  if (only.length && !only.includes(name)) continue;
  console.log(`\n=== ${name} ===`);
  const ok = fn(); results.push([name, ok]); if (!ok) break;
}
console.log('\n=== Summary ===');
for (const [n, ok] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
