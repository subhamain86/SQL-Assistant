// V17.6.4 — CI / deployment fix: version stamp + the workflow and toolchain properties that make the Pages build deterministic.
import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync, existsSync } from 'node:fs'; import { join, dirname } from 'node:path';
const root = join(dirname(new URL(import.meta.url).pathname), '..'); const src = (p) => readFileSync(join(root, p), 'utf8');
const stepNames = (wf) => [...wf.matchAll(/^\s+- name: (.+)$/gm)].map((m) => m[1]);
test('V17.6.4 history: the About page still lists 17.6.4 (after 17.6.5, before 17.6.3); the version stamps themselves are asserted by v1765.test.mjs', () => {
  assert.match(src('src/ui/pages/other.ts'), /<li><strong>17\.6\.5<\/strong>.*<li><strong>17\.6\.4<\/strong>.*<li><strong>17\.6\.3<\/strong>/s);
});
test('V17.6.4 TypeScript is pinned to an exact 5.x version (tsconfig uses moduleResolution node, rejected by TypeScript 6 as TS5107)', () => {
  const pkg = JSON.parse(src('package.json')); assert.match(pkg.devDependencies.typescript, /^5\.\d+\.\d+$/, 'exact version, no range');
  assert.match(src('tsconfig.json'), /"moduleResolution": "node"/);
});
test('V17.6.4 the Pages workflow builds BEFORE the security check (which scans dist/index.html), runs every stage as its own step, and keeps build → deploy', () => {
  const wf = src('.github/workflows/deploy-pages.yml'); const n = stepNames(wf);
  const at = (re) => n.findIndex((x) => re.test(x)); const [ins, tc, lint, build, sec, tests] = [/^Install/, /^Typecheck/, /^Lint/, /^Build \(dist/, /^Security check/, /^Tests/].map(at);
  assert.ok([ins, tc, lint, build, sec, tests].every((i) => i >= 0), 'all stages are named steps'); assert.ok(ins < tc && tc < lint && lint < build && build < sec && sec < tests, 'order: install, typecheck, lint, build, security, tests');
  assert.ok(!/npm run typecheck && npm run lint && npm run security/.test(wf), 'the old single-line chain is gone');
  assert.match(wf, /node scripts\/check-toolchain\.mjs --committed-only/, 'V17.7.5: the Install step verifies the committed compiler'); assert.ok(!/\bnpm\b/.test(wf), 'V17.7.5: no package manager in the workflow');
  assert.match(wf, /needs: build/); assert.match(wf, /permissions: \{ contents: read, pages: write, id-token: write \}/); assert.match(wf, /actions\/checkout@v5/); assert.match(wf, /actions\/setup-node@v5/); assert.match(wf, /node-version: 24/);
  assert.ok(!/secrets\./.test(wf), 'the Pages workflow uses no secret');
});
test('V17.6.4 the Pages workflow names a missing GitHub Pages setting, and the broker workflow skips (does not fail) a push when the service is not configured, but names every missing item on a manual run', () => {
  const wf = src('.github/workflows/deploy-pages.yml'); assert.match(wf, /GitHub Pages is not enabled/); assert.match(wf, /Source/); assert.match(wf, /GitHub Actions/);
  const db = src('.github/workflows/package-repo-broker.yml'); assert.match(db, /workflow_dispatch/); assert.match(db, /paths: \['server\/repo-broker\.mjs'/, 'V17.7.5: a push runs it only when the service or its packaging changed');
  assert.ok(!/need (secret|variable)/.test(db) && !/secrets\./.test(db), 'V17.7.5: nothing is configured, so nothing can be missing — no preflight of secrets or variables remains');
  assert.match(db, /permissions: \{ contents: read \}/);
});
test('V17.6.4 security check still fails when dist/index.html is missing (so the order in the workflow matters) and the build output is the thing it scans', () => {
  const s = src('scripts/security_check.mjs'); assert.match(s, /dist\/index\.html is missing — run npm run build first/);
});
