#!/usr/bin/env node
/**
 * V17.2.1 deploy kit - post-build hardening for dist/index.html.
 * Runs after scripts/build.mjs. It is idempotent: it can run any number of times.
 *  1. Verifies that the build output is the self-contained bundle and not the source index.html.
 *  2. Makes sure the #app mount point exists. If it is missing, main.ts throws and the page stays blank.
 *  3. Injects a boot guard: a loading screen, plus a visible error panel instead of a blank or black page.
 */
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'dist', 'index.html');
const START = '<!-- sqla-boot-guard:start -->', END = '<!-- sqla-boot-guard:end -->';
const BSTART = '<!-- sqla-boot-screen:start -->', BEND = '<!-- sqla-boot-screen:end -->';
const fail = (m) => { console.error(`\u2716 harden-dist: ${m}`); process.exit(1); };
const warn = (m) => console.warn(`\u26A0 harden-dist: ${m}`);

try { await stat(file); } catch { fail('dist/index.html not found. Run "npm run build" first.'); }
let pkgVersion = '';
try { pkgVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version || ''; } catch {}

let html = await readFile(file, 'utf8');
const strip = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); return i >= 0 && j > i ? s.slice(0, i) + s.slice(j + b.length) : s; };
html = strip(html, START, END); html = strip(html, BSTART, BEND);
html = strip(html, '<!-- sqla-boot-observer:start -->', '<!-- sqla-boot-observer:end -->');

// 1. The output must be the compiled bundle, not the source entry page
if (/src=["'][^"']*src\/main\.ts["']/i.test(html)) fail('dist/index.html still references src/main.ts. This is the SOURCE page, not the build output. Check scripts/build.mjs.');
if (!/__sqlaRequire\(\s*['"]main['"]\s*\)/.test(html)) warn('Bundle entry call __sqlaRequire("main") not found. Check that the build embedded the compiled bundle.');
const ext = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]).filter((s) => !s.startsWith('data:'));
if (ext.length) warn(`External script reference(s) found: ${ext.join(', ')}. These break file:// and SharePoint use.`);
if (!/<head[^>]*>/i.test(html) || !/<body[^>]*>/i.test(html)) fail('dist/index.html has no <head>/<body>. The build output is malformed.');

// 2. Mount point
if (!/id=["']app["']/.test(html)) { html = html.replace(/<body([^>]*)>/i, '<body$1>\n<div id="app"></div>'); warn('#app mount point was missing and has been added.'); }

// 3. Boot guard
const guard = `${START}
<style id="sqla-boot-style">
#sqla-boot{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;background:#f4f6fb;color:#1a2436;font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif}
@media (prefers-color-scheme:dark){#sqla-boot{background:#0e1526;color:#eef2fb}}
#sqla-boot .sqla-spin{width:38px;height:38px;border:4px solid rgba(47,111,237,.25);border-top-color:#2f6fed;border-radius:50%;animation:sqlaSpin .9s linear infinite}
@keyframes sqlaSpin{to{transform:rotate(360deg)}}
#sqla-boot-error{display:none;max-width:760px;width:100%;text-align:left;background:#fff4f4;color:#8a1c1c;border:1px solid #f1b5b5;border-radius:10px;padding:16px 18px;font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
@media (prefers-color-scheme:dark){#sqla-boot-error{background:#3a1d1d;color:#ffd6d6;border-color:#7a3434}}
#sqla-boot-error button{margin-top:12px;padding:7px 14px;border:0;border-radius:8px;background:#2f6fed;color:#fff;cursor:pointer;font:inherit}
</style>
<script id="sqla-boot-guard">
(function(){
  var mounted=false, errors=[];
  function isMounted(){var a=document.getElementById('app');return !!(a&&(a.children.length||document.querySelector('.app-shell')));}
  window.__sqlaBootFail=function(msg){
    if(mounted)return; errors.push(String(msg||'Unknown error'));
    var box=document.getElementById('sqla-boot-error'), sp=document.querySelector('#sqla-boot .sqla-spin'), t=document.getElementById('sqla-boot-text');
    if(!box)return; if(sp)sp.style.display='none'; if(t)t.textContent='AP-SQL Assistant could not start';
    box.style.display='block';
    box.textContent='Details:\\n- '+errors.slice(0,5).join('\\n- ')+
      '\\n\\nWhat to check:\\n1. Open dist/index.html (the built file), not the index.html in the source folder.\\n2. If SharePoint downloads the file instead of showing it, host it on GitHub Pages / Azure Static Web Apps / IIS.\\n3. Clear this site\\'s browser storage if the error mentions stored data, then reload.';
    var b=document.createElement('button'); b.textContent='Reload'; b.onclick=function(){location.reload();}; box.appendChild(document.createElement('br')); box.appendChild(b);
  };
  window.__sqlaBootDone=function(){ if(mounted)return; mounted=true; window.__appMounted=true; var s=document.getElementById('sqla-boot'); if(s&&s.parentNode)s.parentNode.removeChild(s); };
  window.addEventListener('error',function(e){ if(!mounted&&!isMounted()) window.__sqlaBootFail((e.message||'Script error')+(e.filename?' ('+e.filename.split('/').pop()+':'+e.lineno+')':'')); });
  window.addEventListener('unhandledrejection',function(e){ if(!mounted&&!isMounted()) window.__sqlaBootFail('Unhandled promise rejection: '+((e.reason&&e.reason.message)||e.reason)); });
  setTimeout(function(){ if(!mounted&&!isMounted()) window.__sqlaBootFail('The application did not render within 15 seconds.'); },15000);
})();
</script>
${END}`;
const screen = `${BSTART}
<div id="sqla-boot" role="status" aria-live="polite"><div class="sqla-spin" aria-hidden="true"></div><div id="sqla-boot-text">Loading AP-SQL Assistant${pkgVersion ? ' · V' + pkgVersion : ''}…</div><div id="sqla-boot-error" role="alert"></div></div>
<noscript><div style="padding:24px;font-family:sans-serif">AP-SQL Assistant requires JavaScript.</div></noscript>
${BEND}`;
const observer = `<!-- sqla-boot-observer:start -->
<script>
(function(){var a=document.getElementById('app');function chk(){if(a&&(a.children.length||document.querySelector('.app-shell'))){window.__sqlaBootDone&&window.__sqlaBootDone();return true;}return false;}
if(!chk()&&a&&window.MutationObserver){var o=new MutationObserver(function(){if(chk())o.disconnect();});o.observe(a,{childList:true});}})();
</script>
<!-- sqla-boot-observer:end -->`;

html = html.replace(/<head([^>]*)>/i, (m) => `${m}\n${guard}`);
html = html.replace(/<body([^>]*)>/i, (m) => `${m}\n${screen}`);
html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${observer}\n</body>`) : html + observer;

await writeFile(file, html, 'utf8');
console.log(`\u2714 harden-dist: dist/index.html verified and hardened (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB${pkgVersion ? ', v' + pkgVersion : ''}).`);
