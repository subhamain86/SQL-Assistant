# Source provenance

- **V17.1 is built on the V17.0 project** delivered as `AP-SQL-Assistant-V17.0.zip`. That project was reconstructed source-for-source, with every V17.0 fix included, because the zip's text index strips HTML from TypeScript template strings. Behaviour and UI were then re-verified with the full V17.0 test and browser suites.
- **V17.0 itself** was built from the V16.2 source plus the V16.3–V16.5 changes described in their changelogs, because the V16.5 source files could not be opened. Page markup was rebuilt from the surviving IDs, classes and labels.
- **Not inspected:** the live repository file (`sql-assistant-data/schemas/registry.json`) was not reachable from the build environment. The root cause was established by tracing the code and reproducing it with data exactly as V16.x wrote it. Use **Validate repository file** (or `npm run diagnose`) to confirm it on your data.
