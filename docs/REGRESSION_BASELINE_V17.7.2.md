# Regression baseline — V17.7.2

* **Reference:** V17.7.1 sources as supplied (246 text files), rebuilt unchanged and tested before any change. Baseline unit run: 322 pass / 7 fail — all 7 are environment gaps of the text bundle (placeholder favicon and missing Python browser scripts → V17.6.9 hygiene, UI-pin and release-hygiene tests; one timing-sensitive retrieval benchmark that passed on re-run), none a product defect.
* **UI pin:** `test/fixtures/ui-baseline-v1771.json` — SHA-256 of every `src/ui` module and the style sheet of V17.7.1; exactly seven modules are listed as deliberately changed (`changedIn1772`), the style sheet and favicon are not among them.
* **Token / vault / Pull Schema code:** `test/fixtures/repo-cards-v1771-lines.json` pins every line of `schemaRepoCards.ts`; only seven known lines differ.
