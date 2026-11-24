#!/usr/bin/env node
/** V17.7.4 — runs the project-pinned TypeScript compiler (see scripts/toolchain.mjs) with the given arguments: `node scripts/tsc.mjs -p tsconfig.json --noEmit`. No npm, no registry. */
import { spawnSync } from 'node:child_process'; import { resolve, dirname } from 'node:path'; import { fileURLToPath } from 'node:url'; import { resolveTypeScript } from './toolchain.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const t = resolveTypeScript(root);
if (!t.ok) { process.stderr.write(`::error title=Toolchain::${t.message}\n`); process.exit(2); }
process.exit(spawnSync(process.execPath, [t.tsc, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' }).status ?? 1);
