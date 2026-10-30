# Why "Describe What You Need" gave results that were not accurate or useful — root causes (V17.7.2)

Method: the offline engine (`runOfflineNlu` + `applyV17ToState` + `buildSelect` + `validateFinalQuery`) was run on the real **77-table AP schema** and on the default schema with realistic descriptions *before* any change; each defect below was reproduced first and has a regression test in `test/v1772.test.mjs`.

| # | Finding (reproduced) | Root cause | Correction |
|---|---|---|---|
| 1 | "invoices over 1000 sorted by invoice date desc" → `SELECT * FROM IA_INVOICE ORDER BY …` shown as a normal result; the amount filter vanished | The engine builds the SQL it *can* and reports success; nothing compared the description with the SQL | `nlAssessment.ts`: words of the description that the SQL does not reflect are listed and the result is **Needs review**, not success |
| 2 | "invoices with payment terms and cost center" → `SELECT *` | same | same |
| 3 | "show invoices and their action log entries" → only `IA_INVOICE`, the second recognised table silently dropped | recognised tables with no relationship in the imported schema are removed from the SQL without any message | the dropped table is named and the reason is given ("no relationship … no join was assumed"); no join is ever invented |
| 4 | "delete all invoices" / "update invoice status…" → a plain `SELECT` shown as success | the Read Only engine ignores the verb | data-change requests are refused in Read Only with a pointer to the CR page |
| 5 | A description naming nothing → a placeholder comment "-- Select at least one table…" in the SQL area | no result state other than SQL | explicit **error** state: reasons, real table names that may be meant (never invented), no SQL block |
| 6 | The description was merged with the Manual Selectors state (selected tables, filters, limit, manual-override markers) | `generateFromDescription(text, cur, …)` started from the current manual state | `{ independent: true }`: the description starts from an empty state and ignores the manual-override markers; Manual Selectors are untouched unless the user selects *Open in Query Builder* |
| 7 | AI/LLM prompt: `tables.map(name(cols)).join().slice(0, 12000)` | on a 77-table schema the text is cut mid-table, the relevant tables are often not in the first 12 000 characters, no relationships (the model invents joins), no types/keys/decode values, no dialect | `llmContext.ts`: tables ranked by relevance to the request, whole tables only, relationships ("the only allowed joins"), PK/FK, decode values, dialect, an `UNSUPPORTED:` escape; SQL from the model must pass `validateFinalQuery` **and** a qualifier check |
| 8 | `validateFinalQuery("SELECT FOO.BAR FROM IA_INVOICE")` → valid | qualifiers that are neither a schema table nor an alias defined in the statement were not checked | `unknownQualifiers()` in the assessment and for model SQL |
| 9 | CR: "Update vendor name to Acme Corp" → `'acme'`; "status to A" → `'a'`; "country = FI" → `'fi'` | values were read from the lower-cased text and cut at the first space | values keep the typed case, quoted values are read whole, several assignments are supported, decode labels map to codes |
| 10 | CR: any "set" made the statement an UPDATE; table found by substring (`IA_INVOICE` inside `IA_INVOICE_LINE`), views could be chosen; unknown columns dropped silently | fixed command priority, substring test, no view check, no report | first command word decides; whole names, longest first; views refused; unknown columns reported |
| 11 | CR: unrestricted UPDATE/DELETE and "no values" were shown as `-- …` comments in the SQL block | same as 5 | explicit error with reason; never an unrestricted statement from a description |

## Deliberately unchanged
The offline NLU's table/column/join/date/aggregation logic, the Query Library / learning, the Manual Selectors and the SQL engine are untouched. The assessment only *reports* what the SQL does not cover; it never edits SQL and never adds a schema object.

## Known limits
* The word-coverage check is heuristic: a description phrased with words the schema does not know can be marked *Needs review* although the SQL is right (the cost of never calling an incomplete query a success). Rephrasing with schema names resolves it.
* Quality of the optional AI/LLM Model was tested only with a stubbed endpoint.
