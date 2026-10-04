# Test report: SQL Assistant 17.3.1 (V17.2 UI + Admin Password)

Run from a clean build (build/, dist/, release/ and the root index.html removed first):

| Check | Result |
|---|---|
| typecheck (strict) | 0 errors |
| lint (58 files, no import cycles) | passed |
| Node tests (`test/*.test.mjs`, incl. `password.test.mjs`) | **29/29** |
| production build | `dist/index.html`, root `index.html`, `release/` (single self-contained page, 402 KB) |
| real-browser tests (Chromium, `scripts/browser_test.py`) | **56/56**, two consecutive runs |

## Browser checks
- ✔ Build output exists: dist/index.html
- ✔ Build output exists: index.html
- ✔ Build output exists: release/index.html
- ✔ Build output exists: release/404.html
- ✔ Build output exists: release/.nojekyll
- ✔ Entry page is self-contained (no src/main.ts, no module script, no CDN)
- ✔ Root cause reproduced: V17.2.1 root index.html (src/main.ts) is blank
- ✔ GitHub Pages sub-path /SQL-Assistant/: index loads with the V17.2 UI
- ✔ GitHub Pages sub-path /SQL-Assistant/: every route renders and survives refresh
- ✔ project root via http: index loads with the V17.2 UI
- ✔ project root via http: every route renders and survives refresh
- ✔ dist/index.html via file://: index loads with the V17.2 UI
- ✔ dist/index.html via file://: every route renders and survives refresh
- ✔ root index.html via file://: index loads with the V17.2 UI
- ✔ root index.html via file://: every route renders and survives refresh
- ✔ Version 17.3.1 in footer; no old product name
- ✔ Hamburger navigation works
- ✔ V17.2 layout: two equal top cards (Describe / Generated SQL)
- ✔ Offline NLU: aggregation, grouping, date range, limit
- ✔ Offline NLU badge + Active Schema audit line
- ✔ Manual Selectors: table + column
- ✔ Advanced Options: DISTINCT + limit
- ✔ Generated SQL validates
- ✔ Query Builder for CR
- ✔ Settings locked: password screen shown, tabs hidden
- ✔ Wrong password rejected; Settings stay locked
- ✔ Default password unlocks; V17.2 Settings tabs
- ✔ Default-password warning shown
- ✔ Navbar lock badge shows unlocked
- ✔ Change password: mismatch rejected
- ✔ Change password: wrong current password rejected
- ✔ Change password: success
- ✔ Password never stored in plain text
- ✔ Lock Settings returns to the lock screen
- ✔ Old default password no longer works
- ✔ Settings locked again after restart
- ✔ New password unlocks after restart
- ✔ Row selection identified
- ✔ Save disabled until a change
- ✔ Row edit saved; other rows unchanged
- ✔ Row delete: wrong password refused
- ✔ Row delete with the Admin Password removes only that row
- ✔ Sync #1: legacy AP schema 77 migrated, nothing rejected
- ✔ Republished: writer 17.3.1, all 437 decode entries
- ✔ Sync #2: success, no re-migration
- ✔ Sync #3: success, no re-migration
- ✔ Restart + sync: still clean
- ✔ Token masked; not in browser storage
- ✔ Push Secret Vault: encrypted, token not in repository
- ✔ AI/LLM Model tab present (offline stays primary)
- ✔ Danger Zone asks for the Admin Password
- ✔ Danger Zone: wrong password refused
- ✔ Reset Admin Password to default locks Settings
- ✔ Default password works again after reset
- ✔ Blocked storage: app still starts
- ✔ No console errors or uncaught exceptions
