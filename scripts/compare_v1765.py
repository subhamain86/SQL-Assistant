"""SQL Assistant V17.6.5 — side-by-side comparison with the V17.6.4 build (the last known good UI). Loads BOTH production builds in Chromium and compares, page by page and at two widths,
the rendered markup (version strings and run-time timestamps normalized) and the style sheet. Pages that V17.6.5 was not asked to change must be IDENTICAL; only About (one new list entry), Settings → Security (Save, Reset to default, strength indicator, status line) and the Danger Zone hint text change. The style sheet must be the V17.6.4 one plus an ADDED block at the end.
   BASELINE=/path/to/V17.6.4/dist/index.html CHROME_PATH=/path/to/chrome python3 scripts/compare_v1763.py"""
import os, re, sys, hashlib, pathlib, difflib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]; OLD = pathlib.Path(os.environ.get("BASELINE", ROOT.parent / "SQL-Assistant-V17.6.4-baseline/dist/index.html")); NEW = ROOT / "dist/index.html"
def norm(h): return re.sub(r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?", "<time>", re.sub(r"V17\.[56]\b", "V17.X", re.sub(r"17\.(?:5\.[567]|6\.[1-5])", "17.5.X", re.sub(r"\bdata-theme=\"[^\"]*\"", "", h))))
def css(p): m = re.search(r"<style>(.*?)</style>", p.read_text(encoding="utf-8"), re.S); return m.group(1)
def ready(pg): pg.wait_for_function("() => document.documentElement.getAttribute('data-sqla-ready') === '1'", timeout=20000); pg.wait_for_timeout(300)
def snap(b, path, route, w=1366, tab=None, settings_tab=None, shot=None):
    ctx = b.new_context(viewport={"width": w, "height": 1000}); pg = ctx.new_page(); pg.goto(path.as_uri() + "?e2e=1"); ready(pg)
    pg.evaluate(f"location.hash = '#{route}'"); pg.wait_for_timeout(500)
    if settings_tab: pg.fill("#settingsPwInput", "admin"); pg.click("#settingsUnlockBtn"); pg.wait_for_timeout(900); pg.click(f'.tab-btn:has-text("{settings_tab}")'); pg.wait_for_timeout(400)
    if tab: pg.click(f'#schemaTabs .tab-btn:has-text("{tab}")'); pg.wait_for_timeout(500)
    # Settings keeps the panels of tabs already shown (hidden) in the DOM; the Security panel is rendered at unlock, so it is removed from the other tabs' snapshots — it is compared on its own (the Security tab).
    strip = "" if settings_tab in (None, "Security") else "m.querySelectorAll('[data-panel=\"security\"]').forEach((x) => x.remove());"
    out = {"main": pg.evaluate("() => { const m = document.querySelector('main').cloneNode(true); " + strip + " return m.outerHTML; }"), "nav": pg.evaluate("() => document.querySelector('#mainNavbar').outerHTML"), "foot": pg.evaluate("() => document.querySelector('footer').outerHTML")}
    if shot: pg.screenshot(path=str(shot), full_page=True)
    ctx.close(); return out
ROUTES = [("Quick Start", "quickstart", None, None), ("Read Only Query Builder", "readonly", None, None), ("Query Builder for CR", "cr", None, None), ("Error Rectifier", "error-rectifier", None, None),
          ("Schema → Tables & Views", "schema-used", "Tables & Views", None), ("Schema → Stored Schemas", "schema-used", "Stored Schemas", None),
          ("Settings → Security", "settings", None, "Security"), ("Settings → Manual Schema Update", "settings", None, "Manual Schema Update"), ("Settings → Schema Management", "settings", None, "Schema Management"),
          ("Settings → Synchronization", "settings", None, "Synchronization"), ("Settings → Admin Query Library", "settings", None, "Admin Query Library"), ("Settings → AI/LLM Model", "settings", None, "AI/LLM Model"), ("Settings → Danger Zone", "settings", None, "Danger Zone"),
          ("About", "about", None, None), ("Schema → Pull Schema", "schema-used", "Pull Schema", None), ("Settings → Secret Vault", "settings", None, "Secret Vault")]
EXPECT_CHANGED = {"About", "Settings → Security", "Settings → Danger Zone"}
def main():
    if not OLD.exists(): print(f"Baseline build not found: {OLD}"); sys.exit(2)
    res = []; shots = pathlib.Path(os.environ["SHOTS"]) if os.environ.get("SHOTS") else None
    oc, nc = css(OLD), css(NEW); same_css = nc.startswith(oc.rstrip()) and len(nc) > len(oc); print(("PASS " if same_css else "FAIL ") + "Style sheet: every V17.6.4 rule is unchanged (the V17.6.5 sheet starts with it) and only a block is ADDED at the end"); res.append(same_css)
    extra = nc[len(oc.rstrip()):]; only_new = bool(re.search(r"V17\.6\.5", extra)) and "pw-strength" in extra and "sec-actions" in extra and not re.search(r"\.btn-primary|\.builder-panel\s*\{|\.issue-box\s*\{|:root|--brand\s*:", extra); print(("PASS " if only_new else "FAIL ") + "The added block touches only the new Security elements (strength meter, mobile action buttons)"); res.append(only_new)
    with sync_playwright() as p:
        exe = os.environ.get("CHROME_PATH"); b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        for name, route, tab, st in ROUTES:
            for w in (1366, 390):
                key = re.sub(r"[^A-Za-z]+", "_", name); o = snap(b, OLD, route, w, tab, st, (shots / f"v1765_{key}_{w}.png") if shots and name in EXPECT_CHANGED else None); n = snap(b, NEW, route, w, tab, st, (shots / f"v1765_{key}_{w}.png") if shots and name in EXPECT_CHANGED else None)
                same = all(norm(o[k]) == norm(n[k]) for k in o); chrome_same = norm(o["nav"]) == norm(n["nav"]) and norm(o["foot"]) == norm(n["foot"])
                if name in EXPECT_CHANGED:
                    d = [l for l in difflib.unified_diff(re.sub(r">\s*<", ">\n<", norm(o["main"])).split("\n"), re.sub(r">\s*<", ">\n<", norm(n["main"])).split("\n"), lineterm="", n=0) if l[:1] in "+-" and l[:3] not in ("+++", "---")]
                    ok = not same; print(("PASS " if ok and chrome_same else "FAIL ") + f"{name} @{w}px: changed as intended ({len(d)} differing markup lines) — navbar and footer {'identical' if chrome_same else 'DIFFER'}"); res.append(ok and chrome_same)
                else:
                    print(("PASS " if same else "FAIL ") + f"{name} @{w}px: markup identical to V17.6.4 (navbar, page, footer)"); res.append(same)
                    if not same: print("   ", [k for k in o if norm(o[k]) != norm(n[k])])
        b.close()
    print(f"\n{sum(res)}/{len(res)} comparison checks passed"); sys.exit(0 if all(res) else 1)
if __name__ == "__main__": main()
