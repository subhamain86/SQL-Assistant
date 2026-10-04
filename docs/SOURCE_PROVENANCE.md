# Source provenance — please read

The V16.5 source files in the SharePoint folder could not be opened by the build assistant (each file returned HTTP 400). This package was therefore rebuilt from these sources:

| Part | Source |
|---|---|
| Engines, services, sync, vault, password, Copilot / MSAL, schema service, store, navbar, tour, icons, CSS | V16.2 source (readable zip in OneDrive), carried over as-is in behaviour |
| V16.3 – V16.5 changes | Reimplemented from `CHANGELOG_V16.5.md`: 8-second GitHub timeout, and Active Schema pointer sync (last-write-wins) in both public discovery and authenticated pull |
| Page / dialog HTML markup | **Rebuilt.** The readable V16.2 text had the HTML templates stripped, so markup was rewritten from the surviving IDs, CSS classes, labels and smoke-test selectors. Layout, sections, labels, buttons and IDs follow V16, but the markup is not byte-identical. |
| V17.0 | New modules in `src/v17/`, integrated directly |

**Recommendation:** before you replace V16.5 for all users, open both versions side by side once. If you upload the real V16.5 zip, the V17 changes can be applied on top of it unchanged (`src/v17/` is self-contained).
