#!/usr/bin/env node
/**
 * V17.6.9 — checks that the INSTALLED TypeScript is exactly the one pinned in package.json devDependencies (5.8.3). Resolved from this project (node_modules, or $NODE_PATH) — never from an
 * environment-specific absolute path. A different major (TypeScript 6 rejects "moduleResolution": "node", TS5107) or minor is an error, not a warning.
 */
import { readFileSync } from 'node:fs'; import { createRequire } from 'node:module'; import { dirname, resolve } from 'node:path'; import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')); const pin = pkg.devDependencies?.typescript;
const fail = (m) => { process.stderr.write(`::error title=Toolchain::${m}\n`); process.exit(1); };
if (!/^\d+\.\d+\.\d+$/.test(String(pin))) fail(`package.json must pin TypeScript to an exact version (found ${JSON.stringify(pin)}).`);
let have; try { const req = createRequire(import.meta.url); have = JSON.parse(readFileSync(resolve(dirname(req.resolve('typescript/bin/tsc', { paths: [root, ...(process.env.NODE_PATH || '').split(':').filter(Boolean)] })), '../package.json'), 'utf8')).version; } catch { fail(`TypeScript ${pin} is not installed (run npm ci).`); }
if (have !== pin) fail(`TypeScript ${have} is installed but package.json pins ${pin} (run npm ci).`);
process.stdout.write(`Toolchain OK: project-pinned TypeScript ${have}.\n`);
