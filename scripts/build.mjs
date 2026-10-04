/**
 * Build: compiles src/ with the TypeScript compiler into a single AMD bundle, then embeds it — with a
 * 1 KB module loader, the stylesheet and the favicon — into ONE self-contained dist/index.html that
 * works by double-click (file://) or from any static host (SharePoint, GitHub Pages, IIS, …).
 * Requires only the "typescript" package (npm install).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
const cfgFile = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfgFile.config, ts.sys, root);
const options = { ...parsed.options, noEmit: false, module: ts.ModuleKind.AMD, moduleResolution: ts.ModuleResolutionKind.Node10, outFile: 'bundle.js', target: ts.ScriptTarget.ES2020, isolatedModules: false, verbatimModuleSyntax: false, sourceMap: false, declaration: false, removeComments: true, rootDir: path.join(root, 'src') };
const host = ts.createCompilerHost(options); let bundle = '';
host.writeFile = (name, text) => { if (name.endsWith('bundle.js')) bundle = text; };
const program = ts.createProgram(parsed.fileNames, options, host);
const diags = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diags.length) { console.error(ts.formatDiagnosticsWithColorAndContext(diags, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => '\n' })); process.exit(1); }
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
<meta name="description" content="AP-SQL Assistant — schema-grounded SQL generation (read-only and change request)"/>
<meta name="generator" content="AP-SQL Assistant ${pkg.version}"/>
<title>AP-SQL Assistant · V17.0</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${favicon}"/>
<style>${css}</style>
</head>
<body>
<noscript>AP-SQL Assistant requires JavaScript.</noscript>
<div id="app"></div>
<script>${js}</script>
</body>
</html>
`;
await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist', 'index.html'), html, 'utf8');
console.log(`Build complete: dist/index.html (${(html.length / 1024).toFixed(0)} KB, single self-contained file, version ${pkg.version}).`);
