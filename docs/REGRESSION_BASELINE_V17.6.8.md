### Regression baseline — V17.6.8 (compared with V17.6.7)

The V17.6.7 package (`SQL-Assistant-V17.6.7.zip`) is the baseline. `scripts/compare_v1768.py` loads the V17.6.7 and the V17.6.8 production builds in Chromium and compares them page by page at 1366 px and 390 px (plus the responsive navigation panel at 390 px and 800 px):

* **Style sheet:** the V17.6.7 rules are byte-identical; the V17.6.8 sheet is the V17.6.7 sheet **plus appended Sync-control rules** (`.sync-now-*`, `.hb-sync-*`, `@keyframes sqla-spin`, one reduced-motion and one width rule). No existing rule changed.
* **Pages:** Quick Start, Read Only Query Builder, Query Builder for CR, Error Rectifier, Schema (Tables & Views, Stored Schemas, Pull Schema), Settings (Security, Manual Schema Update, Schema Management, Synchronization, Admin Query Library, AI/LLM Model, Danger Zone, Secret Vault): **markup identical**; footer identical.
* **About:** one new list entry (17.6.8) — nothing else.
* **Navbar:** identical except for the ONE added Sync control (button + status chip); the responsive navigation panel identical except for the one added Sync entry (button + status line).

#### Existing tests that changed (and why) — every change is a deliberate V17.6.8 policy change, nothing else
| Test | Change |
|---|---|
| `test/v1765`, `v1766`, `v1767` (Node) | The harness registers the authority (`setPasswordAuthority(device.svc)`) instead of the removed `setPasswordRefresh`. |
| `v1765` *publishing impossible*, *conflict*, *no repository connection*, *concurrent write* | Change/Reset are now **publish-first**: refused (nothing changed locally) when publishing is impossible; a conflicting local-only marker is replaced by the central one; a standalone device changes locally only; a higher revision that appears meanwhile wins. |
| `v1766` *9. invalid central data*, *failing repository read*, *old defect*, wiring | A device that cannot read / validate the central record no longer accepts the default (state `error` / `default-unverified`); a valid local marker still works; wiring assertions target the authority. |
| `v1767` *ROOT CAUSE*, *FIX*, *RESET*, *default-confirmed*, *unreadable*, *invalid*, wiring, version | Same policy: standalone ⇒ provisional default; managed ⇒ none; the invalidation event is `central-verifier-changed`; version stamps moved to `v1768`. |
| `test/password.test.mjs`, `v1757` | Local-primitive tests register a standalone authority. |
| `v1763` Node test, browser scripts `browser_test.py`, `_v175`, `_v1751`, `_v1755`, `_v1757`, `_v1761`, `_v1765` | Version expectation 17.6.7 → 17.6.8. |
| Browser `_v1751` | Unlocks Settings *before* the test repository is taken offline (a device that cannot read the central record is no longer unlocked with the default). |
| Browser `_v1757` | The refused live check locks the editor like any failed authorization — unlocked again before the next step; message wording. |
| Browser `_v1762` | With central access and no sign-in the default is not accepted (message names the Sync button); the editor is unlocked after the sign-in. |
| Browser `_v1765` | Read-only repository: the change is refused, then published once writing is possible. |
| Browser `_v1766`, `_v1767` | Invalid central record: default not accepted, Settings locked, message names the Sync button; central access: the unlock starts the existing sign-in first. |

No test was removed or weakened; assertions that encoded the old policy were replaced by the stricter V17.6.8 assertions. Unchanged and passing: all V17.4–V17.6.4 behavioural tests, SQL generation, NLU, schema synchronization, Secret Vault, repository configuration, broker, published data.
