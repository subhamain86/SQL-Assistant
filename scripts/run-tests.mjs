/** Compiles src/ to CommonJS (.test-build/) and runs every test in test/ with the Node test runner. */
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript'); const out = path.join(root, '.test-build');
rmSync(out, { recursive: true, force: true });
const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile).config, ts.sys, root);
const program = ts.createProgram(cfg.fileNames, { ...cfg.options, noEmit: false, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, outDir: out, rootDir: path.join(root, 'src'), isolatedModules: false, verbatimModuleSyntax: false });
const r = program.emit(); const d = [...ts.getPreEmitDiagnostics(program), ...r.diagnostics];
if (d.length) { console.error(ts.formatDiagnostics(d, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => '\n' })); process.exit(1); }
writeFileSync(path.join(out, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const only = process.argv.slice(2);
const files = readdirSync(path.join(root, 'test')).filter((f) => /\.test\.c?js$/.test(f)).filter((f) => !only.length || only.some((o) => f.includes(o))).map((f) => path.join('test', f));
execFileSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit', env: { ...process.env, V17_BUILD: out } });
