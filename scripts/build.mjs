/**
 * Build: the TypeScript compiler bundles src/ into one AMD bundle, embedded — with a ~1 KB module loader, the
 * stylesheet and the favicon — into ONE self-contained HTML file that works by double-click (file://) or from any
 * static host. Only dependency: "typescript" (no Vite/webpack).
 *   node scripts/build.mjs        → dist/index.html      (production: comments removed)
 *   node scripts/build.mjs --dev  → dev-dist/index.html  (development: comments kept + inline source map)
 * The build fails if the output contains anything that looks like a real credential.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
export async function build({ dev = false } = {}) {
  const cfgFile = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfgFile.config, ts.sys, root);
  const options = { ...parsed.options, noEmit: false, module: ts.ModuleKind.AMD, moduleResolution: ts.ModuleResolutionKind.Node10, outFile: 'bundle.js', target: ts.ScriptTarget.ES2020, isolatedModules: false, verbatimModuleSyntax: false, sourceMap: false, inlineSourceMap: dev, inlineSources: dev, declaration: false, removeComments: !dev, rootDir: path.join(root, 'src') };
  const host = ts.createCompilerHost(options); let bundle = '';
  host.writeFile = (name, text) => { if (name.endsWith('bundle.js')) bundle = text; };
  const program = ts.createProgram(parsed.fileNames, options, host);
  const diags = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
  if (diags.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diags, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
  if (!bundle) throw new Error('Build failed: the compiler produced no bundle.');
  const loader = `(function(){var d={},c={};window.define=function(id,deps,f){d[id]={deps:deps,f:f};};function r(id){if(c[id])return c[id].exports;var m=d[id];if(!m)throw new Error('Module not found: '+id);var mod={exports:{}};c[id]=mod;var a=m.deps.map(function(x){return x==='require'?r:x==='exports'?mod.exports:r(x);});var v=m.f.apply(null,a);if(v!==undefined)mod.exports=v;return mod.exports;}window.__sqlaRequire=r;})();`;
  const css = await readFile(path.join(root, 'src', 'styles', 'main.css'), 'utf8');
  const favicon = Buffer.from(await readFile(path.join(root, 'public', 'favicon.svg'))).toString('base64');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const js = `${loader}\n${bundle}\nwindow.__sqlaRequire('main');`.replace(/<\/script/gi, '<\\/script');
  const html = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="description" content="SQL Assistant — schema-grounded SQL generation (read-only and change request)"/>
<meta name="generator" content="SQL Assistant ${pkg.version}${dev ? ' (development build)' : ''}"/>
<title>SQL Assistant</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${favicon}"/>
<style>${css}</style>
</head>
<body>
<noscript>SQL Assistant requires JavaScript.</noscript>
<div id="app"></div>
<script>${js}</script>
</body>
</html>
`;
  const leak = html.match(/\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:ant-)?[A-Za-z0-9_-]{30,}|AKIA[0-9A-Z]{16})\b/);
  if (leak) throw new Error(`Build refused: the output contains something that looks like a real credential (${leak[0].slice(0, 6)}…). Remove it from the source.`);
  const outDir = path.join(root, dev ? 'dev-dist' : 'dist');
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'index.html'), html, 'utf8');
  return { file: path.join(outDir, 'index.html'), size: html.length, version: pkg.version };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dev = process.argv.includes('--dev');
  build({ dev }).then((r) => console.log(`Build complete: ${path.relative(root, r.file)} (${(r.size / 1024).toFixed(0)} KB, ${dev ? 'development' : 'production'}, single self-contained file, version ${r.version}).`)).catch((e) => { console.error(e.message || e); process.exit(1); });
}
