#!/usr/bin/env node
/**
 * V17.6.9 — checks that the INSTALLED TypeScript is exactly the one pinned in package.json devDependencies (5.8.3). Resolved from this project (node_modules, or $NODE_PATH) — never from an
 * environment-specific absolute path. A different major (TypeScript 6 rejects "moduleResolution": "node", TS5107) or minor is an error, not a warning.
 */
import { readFileSync } from 'node:fs'; import { dirname, resolve } from 'node:path'; import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')); const pin = pkg.devDependencies?.typescript;
const fail = (m) => { process.stderr.write(`::error title=Toolchain::${m}\n`); process.exit(1); };
import { resolveTypeScript, verifyCommitted } from './toolchain.mjs';
// V17.7.5: `--committed-only` is the CI Install step: it verifies tools/typescript/ against CHECKSUMS.json and NOTHING else — no TSC_PATH, no node_modules, no registry, no fallback.
if (process.argv.includes('--committed-only')) { const c = verifyCommitted(root); if (!c.ok) fail(c.message); process.stdout.write(`Install OK: the committed TypeScript ${c.version} in tools/typescript is intact (${c.files} files verified against CHECKSUMS.json) — no registry, no credentials, no fallback.\n`); process.exit(0); }
const t = resolveTypeScript(root); if (!t.ok) fail(t.message);
process.stdout.write(`Toolchain OK: project-pinned TypeScript ${t.version} (${t.source}) — no npm, no registry needed.\n`);
