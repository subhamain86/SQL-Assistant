import json, subprocess
from playwright.sync_api import sync_playwright
fx = json.loads(subprocess.check_output(['node','-e',"const f=require('/home/claude/v1721/test/fixtures.cjs');const b=f.v170Published('stripped');b.name='Broken legacy';console.log(JSON.stringify({repo:{schemas:[f.currentSchema('Core'),f.v170Published(),b]}}))"]))
res=[]
def chk(c,m): res.append(('PASS ' if c else 'FAIL ')+m)
with sync_playwright() as p:
    br=p.chromium.launch(args=['--no-sandbox'],executable_path='/opt/pw-browsers/chromium-1208/chrome-linux64/chrome')
    ctx=br.new_context(); pg=ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
    pg.goto('file:///home/claude/mock172/dist/index.html'); pg.wait_for_timeout(400)
    chk(pg.title()=='SQL Assistant','Browser title is "SQL Assistant"')
    nav=pg.inner_text('.navbar'); chk('SQL Assistant' in nav and 'AP-SQL' not in nav and '17.2.1' in nav,'Header shows SQL Assistant · V17.2.1: '+nav)
    chk(pg.inner_html('#syncErrorMount').strip()=='' and pg.locator('[data-v1721-migration]').count()==0,'No diagnostics box before sync (empty container)')
    out=pg.evaluate('(f)=>window.__sync(f)',fx['repo'])
    chk('1 of 3 schema(s)' in out['message'],'Sync: only the unrecoverable schema rejected → '+out['message'])
    ap=[s for s in out['local']['schemas'] if s['name']=='AP schema 77'][0]
    chk(ap['tables'][0]['columns'][2]['decode'][0]['rawValue']=='Invoice.Domain.Invoice' and len(ap['tables'])==77,'AP schema 77 loaded with restored decode values (77 tables)')
    chk(sum(len(c.get('decode') or []) for t in ap['tables'] for c in t['columns'])==437,'All 437 decode entries present after sync')
    chk(ap['schemaFormat']['appVersion']=='17.2.1','Writer stamp added (schemaFormat 17.2.1)')
    chk(not any(s['name']=='Broken legacy' for s in out['local']['schemas']),'Unrecoverable schema not loaded (local protected)')
    panel=pg.inner_text('[data-v1721-migration]')
    for t in ['Migration successful','Migrated schema','Migration failed','Legacy schema migration could not be completed','Location: IA_ACTION_LOG.ROOT_DOCUMENT_TYPE','…and 434 more','existing valid local schema was preserved']: chk(t in panel,'Diagnostics panel shows: '+t)
    out2=pg.evaluate('(f)=>window.__sync(f)',{'schemas':[s for s in out['local']['schemas'] if s['name']!='AP schema 77' or True if s.get('schemaFormat') or s['name']=='AP schema 77']})
    chk('loaded' in out2['message'],'Re-sync of migrated data: '+out2['message'])
    pg.screenshot(path='/home/claude/v1721/docs/browser-test-sync-diagnostics.png',full_page=True)
    pg.reload(); pg.wait_for_timeout(300)
    out3=pg.evaluate('(f)=>window.__sync(f)',{'schemas':[ap]}); chk('All 1 schema(s) loaded' in out3['message'],'After restart: migrated AP schema 77 syncs without failure')
    chk(not errs,'No console/runtime errors'+(': '+' | '.join(errs[:3]) if errs else ''))
    br.close()
print('\n'.join(res)); print(sum(r.startswith('PASS') for r in res),'passed,',sum(r.startswith('FAIL') for r in res),'failed')
