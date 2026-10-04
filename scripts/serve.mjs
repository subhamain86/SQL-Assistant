// npm run serve — serves release/ like GitHub Pages (unknown paths → 404.html = the app). PORT and BASE (e.g. /SQL-Assistant/) are optional.
import { createServer } from 'node:http'; import { readFileSync, existsSync, statSync } from 'node:fs'; import { join, normalize } from 'node:path';
const root = join(new URL('..', import.meta.url).pathname, 'release'); const base = process.env.BASE || '/'; const port = Number(process.env.PORT || 8080);
createServer((req, res) => { const url = decodeURIComponent((req.url || '/').split('?')[0]); if (!url.startsWith(base)) { res.writeHead(302, { Location: base }); res.end(); return; }
  let p = normalize(join(root, url.slice(base.length))); if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; } if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  const ok = existsSync(p); res.writeHead(ok ? 200 : 404, { 'Content-Type': p.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8' }); res.end(readFileSync(ok ? p : join(root, '404.html'))); }).listen(port, () => console.log(`Serving release/ at http://localhost:${port}${base}`));
