# V17.1 Test Report

All checks were run on a **clean copy** of the project: stale artifacts removed, then a fresh typecheck, tests and build.

| Check | Result |
|---|---|
| `npm run clean` | Stale `dist/`, `.test-build/`, `.diag-build/` removed |
| `npm run typecheck` (strict, `noUnusedLocals`, ES2020) | **0 errors** |
| `scripts/check-imports.mjs` (82 files) | **No unresolved imports, no runtime import cycles, no duplicate exports** |
| `npm test` — Node test runner against the compiled real sources | **50 / 50 passed** |
| `npm run build` (production) | `dist/index.html`, 621 KB, single self-contained file |
| `npm run smoke` — production build in headless Chromium, **file://** | **55 / 55 passed** |
| `npm run smoke -- --http` — production build served over **http://** | **55 / 55 passed** |
| `npm run diagnose` on a V16-damaged registry | Exact records and paths reported; repaired copy validates |

**How GitHub is tested:**
- The unit tests use a simulated GitHub Contents API with several independent "devices", each with its own storage.
- The browser test intercepts `api.github.com` at the network layer, so the real UI → GitHub → UI path is exercised.
- No live repository or real token was available in the build environment. Run **Validate repository file** once against your repository.

**About "Vite":** the project does not use Vite. It builds with the TypeScript compiler only (`scripts/build.mjs`), which is verified above. There is no separate development server, so the development runtime test is the http:// run of the built file.

## Unit / integration tests (50)
- ✔ crEngine: UPDATE/DELETE without WHERE blocked; confirmed allowed; INSERT
- ✔ crNlpEngine: "Update invoice 1234 status to Approved"
- ✔ errorRectifier: ORA-00904
- ✔ isCopilotConfigured requires every field
- ✔ V16.1: real-world data types valid
- ✔ default schemas valid with the shared validator (incl. relationships)
- ✔ V16.2: error containers render empty
- ✔ V16.4/16.5: Active Schema pointer last-write-wins (and invalid timestamps ignored)
- ✔ V16.5: GitHub calls time out; V17: vault never auto-pushes
- ✔ baseline: buildSelectSQL join + filter
- ✔ baseline: destructive SQL rejected
- ✔ baseline: fabricated table discarded
- ✔ baseline: V16 parser still runs
- ✔ filter quoting: user text quoted; only generated date expressions pass
- ✔ NLU: simple SELECT
- ✔ NLU: JOIN (direct + bridge + FK-derived)
- ✔ NLU: WHERE, multiple conditions, negation, IN
- ✔ NLU: string conditions
- ✔ NLU: date filtering across dialects
- ✔ NLU: ORDER BY, GROUP BY, aggregation, DISTINCT, complex
- ✔ NLU: unknown identifiers reported, never added; no substring false positives
- ✔ errors: empty schema / unknown text / no error box when no error
- ✔ Advanced Options: manual wins; all options still render
- ✔ learning: one-off not used; repeated used; accepted confirmed; schema untouched; survives restart
- ✔ learning: hint influences later request; sync masks literals and merges idempotently
- ✔ schema records: edit one row only; rename updates refs; invalid rejected; delete blocked/cascade
- ✔ schema change refreshes NLU context; stale results detected
- ✔ vault: encrypted, never plaintext; push/pull; wrong passphrase / tamper / downgrade / garbage handled
- ✔ AI/LLM: optional; validated; invalid config and failures fall back to offline; key never leaked
- ✔ ROOT CAUSE reproduced: a V16-style delete leaves dangling foreign keys that the pull validator rejects
- ✔ ROOT CAUSE fixed (publish gate): invalid local data is never pushed; the exact record is named; the remote file is untouched
- ✔ per-schema verdict: an invalid remote schema is rejected with reasons, valid ones still load, and the valid local copy is preserved
- ✔ recovery: explicit local repair → publish → the other device synchronises cleanly and generates SQL from the synced schema
- ✔ recovery: local invalid + remote valid → "Restore from repository" offers the valid copy; choosing it restores a valid local schema
- ✔ recovery: both copies invalid → neither is changed and both reasons are reported
- ✔ recovery: rejected remote copy can be explicitly repaired and reviewed as a pending conflict
- ✔ remote file problems produce specific messages (never the bare generic text)
- ✔ legacy formats normalise LOSSLESSLY and validate: V15 bare list, single schema, pre-V16 property names, maps, text flags
- ✔ current-format data (V16.x / V17.0 / V17.1) round-trips with zero conversions and zero changes
- ✔ validation stays strict: malformed records are rejected with paths (nothing is silently dropped)
- ✔ Manual Schema Update output always passes the repository validator (edit, add, rename, cascade delete) and syncs to another device
- ✔ Manual Schema Update: legacy problems elsewhere no longer block unrelated edits; new errors still do; legacy names stay editable
- ✔ GitHub failures each produce an understandable message and never expose the token
- ✔ stale-copy protection: pushing over a newer remote asks for a pull first
- ✔ large schema (> 1 MB, 400 tables) with special characters synchronises through the raw-content path
- ✔ active schema refresh + SQL generation use the synchronised schema (no stale cache)
- ✔ discovery requests are de-duplicated (concurrent page mounts share one download)
- ✔ a corrupted local registry is preserved under a backup key instead of being silently overwritten
- ✔ corrupted local Secret Vault data does not crash unlocking
- ✔ relationships that point at deleted columns are ignored for JOINs (never produce SQL on a missing column)

## Browser end-to-end checks (55, identical results over file:// and http://)
- ✔ App starts (single self-contained file)
- ✔ Version 17.1.0 shown; navbar unchanged ("V17")
- ✔ Page renders: readonly
- ✔ Page renders: cr
- ✔ Page renders: schema-used
- ✔ Page renders: error-rectifier
- ✔ Page renders: about
- ✔ Page renders: quickstart
- ✔ Hamburger navigation works
- ✔ Layout unchanged: equal top-card widths
- ✔ Manual Selectors generate SQL
- ✔ Describe What You Need → complex SQL (offline NLU)
- ✔ No error box when there is no error
- ✔ All Advanced Options present + auto/manual strip
- ✔ Manual Advanced Option reflected in SQL
- ✔ Accept & Learn stores learned knowledge
- ✔ CR builder works
- ✔ Settings password error box empty on load
- ✔ Settings tabs unchanged
- ✔ Token masked and never stored in plain text
- ✔ Schema health panel renders nothing when everything is valid
- ✔ Push All Schemas → repository (Local → Repository)
- ✔ Repository file written in format 2 with all schemas
- ✔ Cancel edit changes nothing
- ✔ Manual edit saved and auto-synchronised to the repository
- ✔ Delete confirmation error box empty
- ✔ Delete removes one row and the deletion is synchronised
- ✔ Invalid remote schema → specific reason (table/column/path) instead of the generic message
- ✔ Valid schemas in the same remote file still load
- ✔ Valid local schema NOT overwritten by invalid remote data
- ✔ Recovery options shown (publish local / review repaired copy / download)
- ✔ "Validate repository file" gives a full diagnostic report
- ✔ Publish my local copies repairs the repository
- ✔ Repository now holds the valid copy
- ✔ After recovery: sync is clean and no stale error is shown
- ✔ Corrupted remote JSON → line/column + cause
- ✔ Invalid/expired token → specific message, token not exposed
- ✔ Successful sync clears the previous error
- ✔ Invalid AI/LLM configuration → clear error
- ✔ Secret Vault push works; repository holds ciphertext only
- ✔ Settings tab renders: Security
- ✔ Settings tab renders: Synchronization
- ✔ Settings tab renders: Danger Zone
- ✔ Schema data persists across reload
- ✔ SQL generation uses the current (synchronised) schema
- ✔ Responsive: no horizontal overflow on mobile
- ✔ Legacy-invalid local schema still loads and generates SQL (nothing dropped)
- ✔ Locally edited data is not silently replaced by the remote copy
- ✔ Invalid local schema is reported with the exact record and a Repair option
- ✔ Publishing invalid local data is refused with the reason (root-cause fix)
- ✔ Repository not overwritten with invalid data
- ✔ Repair preview lists every change before anything is applied
- ✔ After repair the schema validates (health panel gone)
- ✔ Repaired schema auto-published; repository is valid again
- ✔ No unexpected console errors
