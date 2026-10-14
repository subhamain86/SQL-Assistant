"""SQL Assistant V17.6.8 — side-by-side comparison with the V17.6.7 build (the baseline). Loads BOTH production builds in Chromium and compares, page by page and at two widths, the rendered markup
(version strings and run-time timestamps normalized) and the style sheet. Everything that V17.6.8 was not asked to change must be IDENTICAL: every page, every Settings tab, the footer, and the navbar
except for the ONE new Sync control (and its status element); the style sheet may only GROW by the rules of that control. About changes by one list entry.
   BASELINE=/path/to/V17.6.7/dist/index.html CHROME_PATH=/path/to/chrome python3 scripts/compare_v1768.py"""
import os, re, sys, pathlib, difflib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]; OLD = pathlib.Path(os.environ.get("BASELINE", ROOT.parent / "SQL-Assistant-V17.6.7-baseline/dist/index.html")); NEW = ROOT / "dist/index.html"
def norm(h): return re.sub(r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?", "<time>", re.sub(r"V17\.[56]\b", "V17.X", re.sub(r"17\.(?:5\.[567]|6\.[1-8])", "17.5.X", re.sub(r"\bdata-theme=\"[^\"]*\"", "", h))))
SYNC_NAV = re.compile(r'\s*<button[^>]*id="syncNowBtn".*?</button><span[^>]*id="syncNowStatus".*?</span>', re.S)
SYNC_HB = re.compile(r'\s*<button[^>]*id="hbSyncNow".*?</button>\s*<div class="hb-sync-status".*?</div>', re.S)
def css(p): m = re.search(r"<style>(.*?)</style>", p.read_text(encoding="utf-8"), re.S); return m.group(1)
def ready(pg): pg.wait_for_function("() => document.documentElement.getAttribute('data-sqla-ready') === '1'", timeout=20000); pg.wait_for_timeout(300)
def snap(b, path, route, w=1366, tab=None, settings_tab=None, hamburger=False):
    ctx = b.new_context(viewport={"width": w, "height": 1000}); pg = ctx.new_page(); pg.goto(path.as_uri() + "?e2e=1"); ready(pg)
    pg.evaluate(f"location.hash = '#{route}'"); pg.wait_for_timeout(400)
    if settings_tab: pg.fill("#settingsPwInput", "admin"); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(1200); pg.click(f'.tab-btn:has-text("{settings_tab}")'); pg.wait_for_timeout(350)
    if tab: pg.click(f'#schemaTabs .tab-btn:has-text("{tab}")'); pg.wait_for_timeout(450)
    if hamburger: pg.click("#navToggle"); pg.wait_for_timeout(300)
    out = {"main": pg.evaluate("() => document.querySelector('main').outerHTML"), "nav": pg.evaluate("() => document.querySelector('#mainNavbar').outerHTML"), "foot": pg.evaluate("() => document.querySelector('footer').outerHTML"), "hb": pg.evaluate("() => (document.querySelector('.hamburger-panel') || {outerHTML: ''}).outerHTML")}
    ctx.close(); return out
ROUTES = [("Quick Start", "quickstart", None, None), ("Read Only Query Builder", "readonly", None, None), ("Query Builder for CR", "cr", None, None), ("Error Rectifier", "error-rectifier", None, None),
          ("Schema → Tables & Views", "schema-used", "Tables & Views", None), ("Schema → Stored Schemas", "schema-used", "Stored Schemas", None),
          ("Settings → Security", "settings", None, "Security"), ("Settings → Manual Schema Update", "settings", None, "Manual Schema Update"), ("Settings → Schema Management", "settings", None, "Schema Management"),
          ("Settings → Synchronization", "settings", None, "Synchronization"), ("Settings → Admin Query Library", "settings", None, "Admin Query Library"), ("Settings → AI/LLM Model", "settings", None, "AI/LLM Model"), ("Settings → Danger Zone", "settings", None, "Danger Zone"),
          ("About", "about", None, None), ("Schema → Pull Schema", "schema-used", "Pull Schema", None), ("Settings → Secret Vault", "settings", None, "Secret Vault")]
EXPECT_CHANGED = {"About"}
def main():
    if not OLD.exists(): print(f"Baseline build not found: {OLD}"); sys.exit(2)
    res = []; co, cn = css(OLD), css(NEW)
    grows = cn.startswith(co) and len(cn) > len(co); add = cn[len(co):] if grows else ""
    sel_ok = grows and all(re.match(r"\s*(\.sync-now|\.hb-sync|@keyframes sqla-spin|@media|/\*)", seg) for seg in re.split(r"\n", add.strip()) if seg.strip())
    print(("PASS " if grows and sel_ok else "FAIL ") + f"Style sheet: the V17.6.7 rules are byte-identical and only {len(add)} characters of Sync-control rules were appended (no existing rule changed)"); res.append(grows and sel_ok)
    with sync_playwright() as p:
        exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        for name, route, tab, st in ROUTES:
            for w in (1366, 390):
                o = snap(b, OLD, route, w, tab, st); n = snap(b, NEW, route, w, tab, st)
                nn = lambda h: re.sub(r">\s+<", "><", norm(h)); n_nav = SYNC_NAV.sub("", n["nav"]); added = SYNC_NAV.search(n["nav"]) is not None
                nav_ok = nn(o["nav"]) == nn(n_nav) and added; foot_ok = nn(o["foot"]) == nn(n["foot"]); main_same = nn(o["main"]) == nn(n["main"])
                if name in EXPECT_CHANGED:
                    d = [l for l in difflib.unified_diff(re.sub(r">\s*<", ">\n<", norm(o["main"])).split("\n"), re.sub(r">\s*<", ">\n<", norm(n["main"])).split("\n"), lineterm="", n=0) if l[:1] in "+-" and l[:3] not in ("+++", "---")]
                    ok = (not main_same) and nav_ok and foot_ok; print(("PASS " if ok else "FAIL ") + f"{name} @{w}px: changed as intended ({len(d)} differing markup lines) — navbar differs ONLY by the Sync control, footer identical"); res.append(ok)
                else:
                    ok = main_same and nav_ok and foot_ok; print(("PASS " if ok else "FAIL ") + f"{name} @{w}px: page and footer identical to V17.6.7; navbar identical except for the one added Sync control"); res.append(ok)
                    if not ok: print("   ", {"main": main_same, "nav": nav_ok, "foot": foot_ok})
        for w in (390, 800):
            o = snap(b, OLD, "quickstart", w, hamburger=True); n = snap(b, NEW, "quickstart", w, hamburger=True); nn = lambda h: re.sub(r">\s+<", "><", norm(h)); n_hb = SYNC_HB.sub("", n["hb"]); ok = nn(o["hb"]) == nn(n_hb) and SYNC_HB.search(n["hb"]) is not None
            print(("PASS " if ok else "FAIL ") + f"Responsive menu @{w}px: identical to V17.6.7 except for the one added Sync entry"); res.append(ok)
        b.close()
    print(f"\n{sum(res)}/{len(res)} comparison checks passed"); sys.exit(0 if all(res) else 1)
if __name__ == "__main__": main()
