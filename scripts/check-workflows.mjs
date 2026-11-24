#!/usr/bin/env node
/**
 * V17.7.5 — WORKFLOW GUARD. Fails when a workflow under .github/workflows breaks the policy in scripts/workflow-policy.mjs:
 *   a package-manager CLI / registry, Azure, an az command, continue-on-error, a secret other than GITHUB_TOKEN (except the BY-NAME allow-list of the token-synchronization workflows),
 *   an action that is not pinned to a version, a run step that echoes a secret, a workflow without a permissions block.
 * Prints the file, the line and the rule for every finding (and a GitHub annotation), exits 1 when there is one.   node scripts/check-workflows.mjs [--dir <workflows folder>]
 *
 * PARSER: no YAML library exists in a Node-only checkout, so this file contains a STRICT TEXT EXTRACTOR for the block style these workflows use (jobs at 2 spaces, steps as "- " at 6 spaces, run: single-line or block).
 * test/v1775.test.mjs cross-checks the extractor against a real YAML parser (Python PyYAML) when one is installed, and says so when it is not.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'; import { join, resolve, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
import { WORKFLOW_POLICY, RULES } from './workflow-policy.mjs';

const indentOf = (l) => l.length - l.trimStart().length;
const stripQuotes = (s) => { const t = String(s ?? '').trim(); return /^(['"]).*\1$/.test(t) ? t.slice(1, -1) : t; };
const isComment = (l) => l.trimStart().startsWith('#');
/** `{ A: 'x', B: "y" }` → { A: 'x', B: 'y' } (flat inline mappings only — what these workflows use) */
function inlineMap(s) { const m = /^\{(.*)\}\s*(?:#.*)?$/.exec(s.trim()); if (!m) return null; const out = {}; for (const part of m[1].split(/,(?=\s*[A-Za-z_][\w-]*\s*:)/)) { const i = part.indexOf(':'); if (i > 0) out[part.slice(0, i).trim()] = stripQuotes(part.slice(i + 1)); } return out; }

/** → { name, onLines, permissions, topPermissions, jobs: { id: { line, needs, ifCond, permissions, steps: [{ line, name, id, uses, run, runLine, env, ifCond }] } } } */
export function parseWorkflow(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n'); const wf = { name: '', onLines: [], permissions: null, jobs: {}, lines };
  let i = 0; const n = lines.length; const top = (re) => { for (let k = 0; k < n; k += 1) if (!isComment(lines[k]) && re.test(lines[k])) return k; return -1; };
  const nm = lines.find((l) => /^name:/.test(l)); wf.name = nm ? stripQuotes(nm.slice(5)) : '';
  const on = top(/^on:/); if (on >= 0) { wf.onLines.push(lines[on]); for (let k = on + 1; k < n && (lines[k].trim() === '' || isComment(lines[k]) || indentOf(lines[k]) > 0); k += 1) if (lines[k].trim() && !isComment(lines[k])) wf.onLines.push(lines[k]); }
  const pm = top(/^permissions:/); if (pm >= 0) { const inline = lines[pm].slice(12).trim(); wf.permissions = inline ? inlineMap(inline) || { raw: inline } : {}; if (!inline) for (let k = pm + 1; k < n && indentOf(lines[k]) > 0; k += 1) { const m = /^\s+([\w-]+):\s*(\S+)/.exec(lines[k]); if (m) wf.permissions[m[1]] = m[2]; } }
  const jobsAt = top(/^jobs:/); if (jobsAt < 0) return wf;
  const jobIdx = []; for (let k = jobsAt + 1; k < n; k += 1) { if (lines[k].trim() && !isComment(lines[k]) && indentOf(lines[k]) === 0) break; const m = /^  ([A-Za-z0-9_-]+):\s*$/.exec(lines[k]); if (m) jobIdx.push([m[1], k]); }
  jobIdx.forEach(([id, start], ji) => {
    const end = ji + 1 < jobIdx.length ? jobIdx[ji + 1][1] : n; const job = { line: start + 1, needs: null, ifCond: null, permissions: null, steps: [] }; wf.jobs[id] = job; let k = start + 1;
    for (; k < end; k += 1) {
      const l = lines[k]; if (!l.trim() || isComment(l)) continue; const ind = indentOf(l);
      if (ind === 4) { let m;
        if ((m = /^    needs:\s*(.+?)\s*(?:#.*)?$/.exec(l))) job.needs = stripQuotes(m[1]); else if ((m = /^    if:\s*(.+?)\s*$/.exec(l))) job.ifCond = m[1];
        else if ((m = /^    permissions:\s*(.*)$/.exec(l))) { const inline = m[1].trim(); job.permissions = inline ? inlineMap(inline) || { raw: inline } : {}; for (let q = k + 1; q < end && indentOf(lines[q]) > 4; q += 1) { const mm = /^\s+([\w-]+):\s*(\S+)/.exec(lines[q]); if (mm) job.permissions[mm[1]] = mm[2]; } }
        else if (/^    steps:\s*$/.test(l)) { k = parseSteps(lines, k + 1, end, job.steps); k -= 1; }
      }
    }
  });
  return wf;
}
function parseSteps(lines, from, end, out) {
  let k = from; while (k < end) {
    const l = lines[k]; if (!l.trim() || isComment(l)) { k += 1; continue; } if (indentOf(l) < 6) break; if (!/^      - /.test(l)) { k += 1; continue; }
    const step = { line: k + 1, name: null, id: null, uses: null, run: null, runLine: null, env: {}, ifCond: null }; let q = k; let first = true;
    for (; q < end; q += 1) {
      let s = lines[q]; if (q > k && s.trim() && !isComment(s) && /^      - /.test(s)) break; if (q > k && s.trim() && !isComment(s) && indentOf(s) < 8) break; if (!s.trim() || isComment(s)) continue;
      if (first) { s = `        ${s.trim().replace(/^- /, '')}`; first = false; } if (indentOf(s) !== 8) continue; /* keys of a nested block (with:, env: children) are not step keys */ const body = s.trim(); let m;
      if ((m = /^name:\s*(.*)$/.exec(body))) step.name = stripQuotes(m[1].replace(/\s+#.*$/, ''));
      else if ((m = /^id:\s*(\S+)/.exec(body))) step.id = m[1];
      else if ((m = /^uses:\s*(\S+)/.exec(body))) step.uses = m[1];
      else if ((m = /^if:\s*(.*)$/.exec(body))) step.ifCond = m[1];
      else if ((m = /^run:\s*(.*)$/.exec(body))) { step.runLine = q + 1; const v = m[1].trim(); if (/^[|>][+-]?\s*$/.test(v)) { const buf = []; let r = q + 1; for (; r < end; r += 1) { if (lines[r].trim() === '') { buf.push(''); continue; } if (indentOf(lines[r]) <= 8) break; buf.push(lines[r].trim()); } step.run = buf.join('\n').trim(); q = r - 1; } else step.run = stripQuotes(v); }
      else if ((m = /^env:\s*(.*)$/.exec(body))) { const inline = m[1].trim(); if (inline) Object.assign(step.env, inlineMap(inline) || {}); else for (let r = q + 1; r < end; r += 1) { if (lines[r].trim() === '' || isComment(lines[r])) continue; if (indentOf(lines[r]) <= 8) break; const mm = /^\s+([A-Za-z_][\w]*):\s*(.*)$/.exec(lines[r]); if (mm) step.env[mm[1]] = stripQuotes(mm[2]); q = r; } }
    }
    out.push(step); k = q;
  } return k;
}

/** Findings for ONE workflow file: [{ file, line, rule, message, text }] */
export function checkWorkflowText(file, text, policy = WORKFLOW_POLICY) {
  const problems = []; const add = (line, rule, message, t) => problems.push({ file, line, rule, message, text: String(t ?? '').trim().slice(0, 160) });
  const lines = text.replace(/\r\n/g, '\n').split('\n'); const ctxBase = { bareRegistryWordAllowed: policy.bareRegistryWordAllowedIn.includes(file) };
  lines.forEach((l, k) => { for (const r of RULES) if (r.test(l, { ...ctxBase, isComment: isComment(l) })) add(k + 1, r.id, r.why, l); });
  const allowed = new Set([...policy.defaultSecrets, ...(policy.secretAllowList[file]?.secrets || [])]);
  lines.forEach((l, k) => {
    for (const m of l.matchAll(/secrets\.([A-Za-z0-9_]+)/g)) if (!allowed.has(m[1])) add(k + 1, 'secret', `secret ${m[1]} is not allowed in ${file} (only ${[...allowed].join(', ')}; the allow-list is scripts/workflow-policy.mjs)`, l);
    if (/secrets\s*\[|toJSON\(\s*secrets\s*\)/.test(l)) add(k + 1, 'secret', 'dynamic access to secrets', l); if (/secrets:\s*inherit/.test(l)) add(k + 1, 'secrets-inherit', 'secrets: inherit hands every secret to another workflow', l);
  });
  const wf = parseWorkflow(text);
  if (!wf.permissions && !Object.values(wf.jobs).every((j) => j.permissions)) add(1, 'no-permissions', 'the workflow has no permissions block (least privilege must be explicit)', lines[0]);
  for (const [jobId, job] of Object.entries(wf.jobs)) for (const s of job.steps) {
    if (s.uses && !policy.actionPin.test(s.uses)) add(s.line, 'unpinned-action', `action ${s.uses} is not pinned to a major version or a full commit SHA`, s.uses);
    if (s.run) {
      const secretVars = Object.entries(s.env).filter(([, v]) => /secrets\.|github\.token/.test(v)).map(([k]) => k); const off = s.runLine || s.line;
      for (const [i, rl] of s.run.split('\n').entries()) {
        if (/\$\{\{\s*(?:secrets\.|github\.token)/.test(rl)) add(off + i, 'echo-secret', `a run step in ${jobId} expands a secret inside the script text`, rl);
        for (const v of secretVars) if (new RegExp(`\\b(?:echo|printf|cat|tee|print|console\\.log)\\b[^\\n]*\\$\\{?${v}\\b`).test(rl) || new RegExp(`\\$\\{?${v}\\}?[^\\n]*\\|\\s*tee\\b`).test(rl)) add(off + i, 'echo-secret', `a run step echoes the secret-bearing variable ${v}`, rl);
      }
      if (/(?:^|\n)\s*set\s+-[a-z]*x/.test(s.run) && secretVars.length) add(off, 'echo-secret', 'set -x in a step that holds a secret prints the secret', s.run.split('\n')[0]);
    }
  }
  return problems;
}
export function checkWorkflows(root, opts = {}) {
  const dir = opts.dir ? resolve(opts.dir) : join(root, '.github/workflows'); const policy = opts.policy || WORKFLOW_POLICY; const problems = []; const files = [];
  if (!existsSync(dir)) return { problems: [{ file: '.github/workflows', line: 0, rule: 'missing', message: 'the workflows folder is missing', text: '' }], files };
  for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x)).sort()) { files.push(f); problems.push(...checkWorkflowText(f, readFileSync(join(dir, f), 'utf8'), policy)); }
  return { problems, files };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const di = process.argv.indexOf('--dir'); const r = checkWorkflows(root, { dir: di > 0 ? process.argv[di + 1] : undefined });
  for (const p of r.problems) { process.stderr.write(`::error file=.github/workflows/${p.file},line=${p.line},title=Workflow guard (${p.rule})::${p.message}\n`); process.stderr.write(`  ${p.file}:${p.line}  [${p.rule}]  ${p.message}\n    ${p.text}\n`); }
  if (r.problems.length) { process.stderr.write(`\nWorkflow guard FAILED: ${r.problems.length} finding(s) in ${r.files.length} workflow(s). Policy and allow-list: scripts/workflow-policy.mjs\n`); process.exit(1); }
  process.stdout.write(`Workflow guard passed: ${r.files.length} workflow(s) (${r.files.join(', ')}) — Node and GITHUB_TOKEN only; the token-synchronization workflows read only their listed secrets.\n`);
}
