# SQL Assistant V17.2 — Test Report

All checks were run on a **clean copy** of the project: stale `dist/`, `dev-dist/`, `.test-build/` and `.diag-build/` were removed first, then everything was rebuilt.

| Check | Result |
|---|---|
| `npm run clean` | Stale artifacts removed |
| `npm run typecheck` (strict, `noUnusedLocals`) | **0 errors** |
| `npm run lint` (84 TypeScript files + CSS) | **No unresolved imports, no runtime import cycles, no duplicate exports, no debug statements, no hard-coded credentials, no old product name** |
| `npm test` (unit + integration, Node test runner on the compiled real sources) | **70 / 70 passed** |
| `npm run build` (production) | `dist/index.html`, 662 KB, one self-contained file, credential scan passed |
| `npm run build:dev` (development) | `dev-dist/index.html` with inline source maps |
| `npm run dev` | Development server answered HTTP 200 with the dev build (title "SQL Assistant", source maps present) |
| Browser test (headless Chromium) — production build, **file://** | **76 / 76 passed** |
| Browser test — production build, **http://** | **76 / 76 passed** |
| Browser test — **development** build | **76 / 76 passed** |

**How GitHub was tested:**
- Unit/integration tests use a simulated GitHub Contents API shared by several independent "devices", each with its own storage (each `loadDevice()` is also an application restart).
- The simulation covers concurrency (409/422), files over 1 MB, injected failures, and **stale (pre-push) copies** of the repository file.
- The browser test intercepts `api.github.com` at the network layer, so the real UI → GitHub → UI path runs.
- No live repository or real token was available in the build environment.

## Unit / integration tests (70)
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
- ✔ ROOT CAUSE (V17.1) reproduced: a V16-style delete leaves dangling foreign keys that the pull validator rejects
- ✔ publish gate: invalid local data is never pushed; the exact record is named; the remote file is untouched
- ✔ per-schema verdict: an invalid remote schema is rejected with reasons, valid ones still load, and the valid local copy is preserved
- ✔ recovery: explicit local repair → publish → the other device synchronises cleanly
- ✔ recovery: local invalid + remote valid → restore from repository
- ✔ recovery: both copies invalid → neither is changed and both reasons are reported
- ✔ recovery: rejected remote copy can be explicitly repaired and reviewed as a pending conflict
- ✔ remote file problems produce specific messages (never the bare generic text)
- ✔ legacy formats normalise LOSSLESSLY and validate
- ✔ current-format data (V16.x / V17.x) round-trips with zero conversions and zero changes
- ✔ validation stays strict: malformed records are rejected with paths (nothing is silently dropped)
- ✔ Manual Schema Update output always passes the repository validator and syncs to another device
- ✔ Manual Schema Update: legacy problems elsewhere no longer block unrelated edits; new errors still do
- ✔ GitHub failures each produce an understandable message and never expose the token
- ✔ stale-copy protection: pushing over a newer remote asks for a pull first
- ✔ large schema (> 1 MB, 400 tables) with special characters synchronises through the raw-content path
- ✔ active schema refresh + SQL generation use the synchronised schema (no stale cache)
- ✔ discovery requests are de-duplicated (concurrent page mounts share one download)
- ✔ a corrupted local registry is preserved under a backup key instead of being silently overwritten
- ✔ corrupted local Secret Vault data does not crash unlocking
- ✔ relationships that point at deleted columns are ignored for JOINs
- ✔ ROOT CAUSE 1 reproduced and fixed: an outdated (cached) copy of the repository file is never applied again
- ✔ ROOT CAUSE 2 reproduced and fixed: discovery reads the configured location, not a stale file at the default path
- ✔ ROOT CAUSE 3 fixed — scenario B: a local manual change is preserved and published; no false conflict on pull
- ✔ 3-way merge: remote-only change fast-forwards; changes on both sides become a conflict (never silently overwritten)
- ✔ ROOT CAUSE 4 fixed: a push that races another device recovers automatically (pull → merge → push)
- ✔ sync operations are serialised: concurrent pull / push / pull never interleave or 409
- ✔ scenarios A, C, D, E, F, G, H end-to-end
- ✔ every sync error names its failing stage; rejected data names the device/version that wrote it
- ✔ schema persistence failure during sync is reported as such and leaves the registry consistent
- ✔ validation stays strict, but database codes are case-sensitive: decode raw values "a" and "A" are different
- ✔ NLU: the specification example generates the expected SQL from the active schema
- ✔ NLU: relative dates — today, yesterday, last 7 days, this month, previous month, current year
- ✔ NLU: aliases and LEFT JOIN are detected; manual settings still win
- ✔ Advanced Options: table aliases, join type, join-path choice, NOT LIKE / NOT IN / BETWEEN / IS NOT NULL all build valid SQL
- ✔ structural SQL validation: parentheses, quotes, clause order, trailing comma, duplicate output aliases, duplicate table aliases
- ✔ learning: full example recorded (features, schema & engine version, outcome, corrections); duplicates merge; credentials never learned
- ✔ learning: a learned pattern that references a deleted column is ignored and the request is re-evaluated against the active schema
- ✔ Manual Schema Update: diffRows lists exactly the modified fields (row vs table scope); no change → no diff
- ✔ AI/LLM: offline browser / locked vault / provider error → offline engine result, never blocked
- ✔ product name is "SQL Assistant" in source, registry metadata and build output

## Browser checks (76; identical results for production file://, production http:// and the development build)
- ✔ App starts — no blank screen
- ✔ Application name is "SQL Assistant" (title, navbar, no old name)
- ✔ Version 17.2.0 shown in footer metadata
- ✔ Page renders: readonly
- ✔ Page renders: cr
- ✔ Page renders: schema-used
- ✔ Page renders: error-rectifier
- ✔ Page renders: about
- ✔ Page renders: quickstart
- ✔ Hamburger navigation works
- ✔ Layout unchanged: equal top-card widths
- ✔ Manual Selectors: tables + columns generate SQL
- ✔ Manual Selectors: filters (NOT LIKE)
- ✔ Specification example → correct SQL (join, ISO country mapping, relative date, sort)
- ✔ Offline NLU badge + active schema audit line
- ✔ Complex request → aggregation, grouping, date range, limit
- ✔ No error box when there is no error
- ✔ Unknown field reported, never added to SQL
- ✔ All Advanced Options present (incl. table aliases, join type, join paths) + auto/manual strip
- ✔ Advanced Options: table aliases
- ✔ Advanced Options: join type (LEFT JOIN)
- ✔ Advanced Options: join paths listed
- ✔ Manual changes take manual control (shown in strip)
- ✔ Advanced Options: DISTINCT + LIMIT
- ✔ Generated aliased SQL passes validation (alias-aware)
- ✔ Accept & Learn stores the corrected example with features, outcome and engine version
- ✔ Learned correction reused for a similar request (and shown as learned)
- ✔ CR builder works
- ✔ Settings password error box empty on load
- ✔ Settings tabs unchanged; "AI/LLM Model" replaces Online AI/NLP Endpoint
- ✔ Token masked and never stored in plain text
- ✔ Schema health panel renders nothing when everything is valid
- ✔ Push All Schemas → repository (Local → Repository)
- ✔ Repository file stamped with writer version and device
- ✔ Row selection: selected row highlighted and identified
- ✔ Edit dialog identifies the selected row; Save disabled until something changes
- ✔ Current → modified values shown before saving
- ✔ Reset restores the current values
- ✔ Cancel changes nothing
- ✔ Saving updates the selected row only (other rows unchanged)
- ✔ Row change saved centrally and auto-synchronised to the repository
- ✔ Selected row stays selected after saving
- ✔ Delete confirmation error box empty
- ✔ Delete removes the selected row only and the deletion is synchronised
- ✔ Invalid manual change rejected with a meaningful error
- ✔ Invalid remote schema → failing stage + exact record instead of the generic message
- ✔ Rejected data names its source (out-of-date writer) and this device
- ✔ Valid schemas in the same remote file still load
- ✔ Valid local schema NOT overwritten by invalid remote data
- ✔ "Validate repository file" gives a full diagnostic report
- ✔ Publish my local copies repairs the repository
- ✔ Repository now holds the valid copy
- ✔ Stale copy of the old invalid file is ignored — the error does NOT come back
- ✔ Normal sync afterwards is clean; no stale error shown
- ✔ Corrupted remote JSON → stage + line/column + cause
- ✔ Invalid/expired token → stage + specific message, token not exposed
- ✔ Successful sync clears the previous error (recovery)
- ✔ AI/LLM Model tab: provider/model/endpoint/key; offline stays primary
- ✔ Invalid AI/LLM configuration → clear error
- ✔ Secret Vault documents its security model honestly
- ✔ Push Secret Vault: repository holds AES-GCM ciphertext only (no token, no base64 token, no passphrase)
- ✔ Settings tab renders: Security
- ✔ Settings tab renders: Synchronization
- ✔ Settings tab renders: Danger Zone
- ✔ Schema data persists across reload
- ✔ SQL generation uses the current (synchronised) schema after restart
- ✔ Responsive: no horizontal overflow on mobile
- ✔ Legacy-invalid local schema still loads and generates SQL (nothing dropped)
- ✔ Locally edited data is not silently replaced by the remote copy (conflict instead)
- ✔ Invalid local schema reported with the exact record and a Repair option
- ✔ Publishing invalid local data is refused with the reason
- ✔ Repair preview lists every change before anything is applied
- ✔ After repair the schema validates (health panel gone)
- ✔ No secret in browser console, page, or any repository file
- ✔ No unexpected console errors or uncaught exceptions
- ✔ No credential in the build file
