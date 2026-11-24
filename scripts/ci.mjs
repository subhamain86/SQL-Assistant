#!/usr/bin/env node
/**
 * V17.7.5 — THE CI STAGE LIST. A developer and the GitHub Pages workflow run exactly the same ordered stages, each one a plain `node` call — no package manager, no registry, no network, no node_modules, no secret:
 *
 *   install → typecheck → lint → hygiene → workflows → build → security → artifact → tests → final → artifact-final
 *
 * .github/workflows/deploy-pages.yml has ONE step per stage (same id, same command) so a failure still names the stage; test/v1775.test.mjs asserts that the workflow and this list stay identical.
 * (The workflow's "Publish … configuration" steps sit between `final` and `artifact-final`; they write public settings from repository variables and have no local equivalent.)
 *
 *   node scripts/ci.mjs                    run every stage; stops at the first failure and says which stage failed
 *   node scripts/ci.mjs --list             print the stages
 *   node scripts/ci.mjs --only=lint,build  run only these stages          node scripts/ci.mjs --from=build --until=artifact
 */
import { spawnSync } from 'node:child_process'; import { readdirSync, appendFileSync } from 'node:fs'; import { join, resolve, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TEST_ARGS = ['--test', '--test-concurrency=1'];
const listTests = () => readdirSync(join(root, 'test')).filter((f) => /\.test\.mjs$/.test(f)).sort().map((f) => `test/${f}`);
/** id, display name, the node arguments. `tests` expands test/*.test.mjs (the workflow's shell does the same). */
export const STAGES = [
  { id: 'install', name: 'Install (verify the committed TypeScript)', args: ['scripts/check-toolchain.mjs', '--committed-only'], hint: 'Restore tools/typescript from the repository; there is no registry fallback.' },
  { id: 'typecheck', name: 'Typecheck', args: ['scripts/tsc.mjs', '-p', 'tsconfig.json', '--noEmit'], hint: 'Fix the type errors listed above.' },
  { id: 'lint', name: 'Lint', args: ['scripts/lint.mjs'], hint: 'Fix the lint findings / import cycles listed above.' },
  { id: 'hygiene', name: 'Repository hygiene (orphaned / stale files)', args: ['scripts/check-stale.mjs'], hint: 'Review the named files, then: node scripts/prune-orphans.mjs --delete && node scripts/prune-stale.mjs --delete' },
  { id: 'workflows', name: 'Workflow guard (Node and GITHUB_TOKEN only)', args: ['scripts/check-workflows.mjs'], hint: 'A workflow broke the policy in scripts/workflow-policy.mjs: see the file, line and rule above.' },
  { id: 'build', name: 'Build (dist/index.html, release/)', args: ['scripts/build.mjs'], hint: 'Fix the build error above.' },
  { id: 'security', name: 'Security check', args: ['scripts/security_check.mjs'], hint: 'Fix the security findings above.' },
  { id: 'artifact', name: 'Verify the generated artifact', args: ['scripts/verify-artifact.mjs'], hint: 'The generated output is wrong or incomplete: rebuild and read the named file.' },
  { id: 'tests', name: 'Tests', args: [...TEST_ARGS, 'test/*.test.mjs'], hint: 'Fix the failing tests; none is skipped.' },
  { id: 'final', name: 'Final production build', args: ['scripts/build.mjs'], hint: 'Fix the build error above.' },
  { id: 'artifact-final', name: 'Verify the artifact that will be published', args: ['scripts/verify-artifact.mjs'], hint: 'The artifact is wrong or incomplete.' },
];
/** the argument list as it is actually passed to node (the test stage's glob is expanded) */
export const expand = (st) => st.args.flatMap((a) => (a === 'test/*.test.mjs' ? listTests() : [a]));
/** the command line a workflow step runs for this stage (the shell expands the glob) */
export const commandOf = (st) => `node ${st.args.join(' ')}`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
  if (process.argv.includes('--list')) { STAGES.forEach((s, i) => process.stdout.write(`${String(i + 1).padStart(2)}. ${s.id.padEnd(15)} ${commandOf(s)}\n`)); process.exit(0); }
  let list = STAGES; const only = arg('only').split(',').filter(Boolean); const from = arg('from'); const until = arg('until');
  if (only.length) list = STAGES.filter((s) => only.includes(s.id)); if (from) list = list.slice(Math.max(0, list.findIndex((s) => s.id === from))); if (until) { const k = list.findIndex((s) => s.id === until); if (k >= 0) list = list.slice(0, k + 1); }
  const unknown = only.filter((o) => !STAGES.some((s) => s.id === o)); if (unknown.length) { process.stderr.write(`Unknown stage(s): ${unknown.join(', ')}. Stages: ${STAGES.map((s) => s.id).join(', ')}\n`); process.exit(2); }
  const results = []; let failed = null;
  for (const st of list) {
    process.stdout.write(`\n=== ${st.id}: ${st.name} ===\n  $ ${commandOf(st)}\n`); const t0 = Date.now();
    const r = spawnSync(process.execPath, expand(st), { cwd: root, stdio: 'inherit' }); const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (r.status === 0) results.push([st.id, 'pass', secs]); else { results.push([st.id, 'FAIL', secs]); failed = st; break; }
  }
  process.stdout.write('\n=== summary ===\n'); for (const [id, status, secs] of results) process.stdout.write(`  ${status === 'pass' ? 'PASS' : 'FAIL'}  ${id.padEnd(15)} ${secs}s\n`);
  if (failed) {
    const lines = ['## CI failed — nothing was published', '', `- **Failing stage:** \`${failed.id}\` — ${failed.name}`, `- **Command:** \`${commandOf(failed)}\``, `- **What to do:** ${failed.hint}`, '', 'No package manager, registry or secret was used by any stage.'];
    process.stderr.write(`\n::error title=CI failed at stage ${failed.id}::${failed.name} — ${failed.hint}\n${lines.join('\n')}\n`); if (process.env.GITHUB_STEP_SUMMARY) { try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`); } catch { /* the summary is best effort */ } }
    process.exit(1);
  }
  process.stdout.write(`\nCI passed: ${results.length} stage(s), Node only.\n`);
}
