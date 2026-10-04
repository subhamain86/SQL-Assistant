# Source provenance
- **V17.2 baseline.** Built on the V17.1 project as delivered in `AP-SQL-Assistant-V17.1.zip` (the copy in SharePoint `Desktop/Project/TS/SQL-Assistant-V17.1`).
  - The individual `.ts` files there cannot be read through the SharePoint connector (HTTP 400). The V17.1 sources were therefore restored source-for-source from the V17.1 build.
  - Before any V17.2 change was trusted, they were verified with the complete V16/V17.0/V17.1 regression suites (50 tests) and the V17.1 browser checks.
- **Earlier versions.** V17.0 and V17.1 provenance is described in their own changelogs.
- **Not inspected.** The live repository file was not reachable from the build environment. Use **Validate repository file** (or `npm run diagnose`) on your repository; it reports the writer version and device of the current file.
