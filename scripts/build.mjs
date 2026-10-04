// Clean production build: tsc → ES modules, add .js import extensions for the browser, copy static files.
import { execFileSync } from 'node:child_process';
import { rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, cpSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
let tsc; try { tsc = require.resolve('typescript/bin/tsc'); } catch { tsc = '/opt/oai-docgen/node_modules/typescript/bin/tsc'; }
rmSync(join(root, 'build'), { recursive: true, force: true }); rmSync(join(root, 'dist'), { recursive: true, force: true });
execFileSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.json')], { stdio: 'inherit' });
const jsRoot = join(root, 'build/js');
function fix(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { fix(p); continue; }
    if (!p.endsWith('.js')) continue;
    const src = readFileSync(p, 'utf8').replace(/(from\s+|import\s*\(\s*|import\s+)(['"])(\.{1,2}\/[^'"]+)\2/g, (m, pre, q, spec) => {
      if (spec.endsWith('.js')) return m;
      const abs = resolve(dirname(p), spec);
      const target = existsSync(`${abs}.js`) ? `${spec}.js` : existsSync(join(abs, 'index.js')) ? `${spec}/index.js` : `${spec}.js`;
      return `${pre}${q}${target}${q}`;
    });
    writeFileSync(p, src);
  }
}
fix(jsRoot);
mkdirSync(join(root, 'dist'), { recursive: true });
cpSync(jsRoot, join(root, 'dist/js'), { recursive: true, filter: (s) => !s.endsWith('.map') || process.env.SOURCEMAPS === '1' });
cpSync(join(root, 'public'), join(root, 'dist'), { recursive: true });
console.log('Build complete → dist/ (open with: npm run serve)');
