// npm run dev — development build served at http://localhost:5173, rebuilt when src/ or public/ changes (as in V17.2).
import { createServer } from 'node:http'; import { readFileSync, watch } from 'node:fs'; import { execFileSync } from 'node:child_process'; import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname; const build = () => { try { execFileSync(process.execPath, [join(root, 'scripts/build.mjs'), '--dev'], { stdio: 'inherit' }); } catch { /* error printed */ } };
build(); let t; for (const d of ['src', 'public']) watch(join(root, d), { recursive: true }, () => { clearTimeout(t); t = setTimeout(build, 200); });
const port = Number(process.env.PORT || 5173);
createServer((req, res) => { try { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(readFileSync(join(root, 'dev-dist/index.html'))); } catch (e) { res.writeHead(500); res.end(String(e)); } }).listen(port, () => console.log(`SQL Assistant dev server: http://localhost:${port}`));
