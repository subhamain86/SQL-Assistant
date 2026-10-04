/**
 * Development runtime: builds dev-dist/index.html (comments + inline source maps), serves it on http://localhost:5173
 * and rebuilds whenever a file in src/ changes (refresh the browser to load the new build).
 *   npm run dev            (PORT=xxxx to change the port; --once builds and serves without watching)
 */
import http from 'node:http'; import { readFile } from 'node:fs/promises'; import { watch } from 'node:fs';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 5173);
let building = null; let lastError = null;
async function rebuild() { if (building) return building; building = build({ dev: true }).then((r) => { lastError = null; console.log(`[dev] built ${path.relative(root, r.file)} (${(r.size / 1024).toFixed(0)} KB)`); }).catch((e) => { lastError = String(e.message || e); console.error(`[dev] build failed:\n${lastError}`); }).finally(() => { building = null; }); return building; }
await rebuild();
if (!process.argv.includes('--once')) { let t = null; watch(path.join(root, 'src'), { recursive: true }, () => { clearTimeout(t); t = setTimeout(rebuild, 150); }); }
http.createServer(async (req, res) => {
  if (lastError) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(`Build failed:\n${lastError}`); return; }
  if (req.url === '/' || req.url?.startsWith('/index.html') || req.url?.startsWith('/#')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(await readFile(path.join(root, 'dev-dist', 'index.html'))); return; }
  res.writeHead(404); res.end('Not found');
}).on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `[dev] Port ${port} is already in use — stop the other server or run with PORT=<free port>.` : `[dev] ${e.message}`); process.exit(1); }).listen(port, '127.0.0.1', () => console.log(`[dev] SQL Assistant development server: http://localhost:${port}/`));
