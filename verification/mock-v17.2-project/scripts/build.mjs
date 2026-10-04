import { writeFile, mkdir } from 'node:fs/promises'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const require = createRequire(path.join(root, 'package.json')); const ts = require('typescript');
const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile).config, ts.sys, root);
const options = { ...parsed.options, noEmit: false, module: ts.ModuleKind.AMD, moduleResolution: ts.ModuleResolutionKind.Node10, outFile: 'bundle.js', isolatedModules: false, rootDir: path.join(root, 'src') };
const host = ts.createCompilerHost(options); let bundle = ''; host.writeFile = (n, t) => { if (n.endsWith('bundle.js')) bundle = t; };
const program = ts.createProgram(parsed.fileNames, options, host); const d = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (d.length) { console.error(ts.formatDiagnostics(d, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => '\n' })); process.exit(1); }
const loader = `(function(){var d={},c={};window.define=function(id,deps,f){d[id]={deps:deps,f:f};};function r(id){if(c[id])return c[id].exports;var m=d[id];if(!m)throw new Error('Module not found: '+id);var mod={exports:{}};c[id]=mod;var a=m.deps.map(function(x){return x==='require'?r:x==='exports'?mod.exports:r(x);});var v=m.f.apply(null,a);if(v!==undefined)mod.exports=v;return mod.exports;}window.__sqlaRequire=r;})();`;
const pkg = require(path.join(root, 'package.json')); await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist', 'index.html'), `<!doctype html><html><head><meta charset="UTF-8"><title>SQL Assistant</title></head><body><div id="app"></div><script>${loader}\n${bundle}\nwindow.__sqlaRequire('main');</script></body></html>`);
console.log('built', pkg.version);
