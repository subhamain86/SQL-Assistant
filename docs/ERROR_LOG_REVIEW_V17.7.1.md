# Review of the supplied error archives — V17.7.1

**Evidence actually available.** The four log archives (`logs_103717775423`, `logs_104050659931` and its duplicate `(1)`, `logs_104050744994`, `logs_104051351287`) are listed in the OneDrive folder `Desktop/Project/Error` (the `Documents.csv` export confirms names and dates, 13 Oct 2026). Their **contents could not be read in this session** (the files are zip archives; only a short text preview of the first part of some of them was available through the search index, and no download was possible). The classification below therefore **relies on `docs/ERROR_LOG_REVIEW_V17.7.md`**, whose author unpacked and read all five archives stage by stage. **The log review remains unverified by this release.**

| Archive | Class (from the V17.7 review) |
|---|---|
| `logs_103717775423` (build, 17.6.7) | repository defect — files of earlier versions (155 TypeScript errors) |
| `logs_104051351287` (build, 17.6.8) | repository defect — stale files / historical tests (23 failing tests) |
| `logs_104050659931` (+ duplicate) (deploy) | external configuration — `AZURE_CREDENTIALS` not set; `SQLA_BROKER_APP_NAME` contains a space (unverified) |
| `logs_104050744994` (verify PAT) | external policy — HTTP 403 `AADSTS53003` (Conditional Access) on the central PAT |

## Findings relevant to V17.7.1
1. **No log describes a defect in code that V17.7.1 changes.** All runs pre-date V17.7 (12–13 Oct); none concerns the Home page, the hamburger menu, token initialisation at start-up or the Query Library, which did not exist.
2. **Stale files** (59 in the target repository: 54 orphaned sources + 5 historical tests): unchanged by V17.7.1; the reviewed list and removal commands (`node scripts/prune-orphans.mjs --delete && node scripts/prune-stale.mjs --delete`) are unchanged and the repository must still be cleaned once. V17.7.1 adds no orphan (`npm run check:stale` reports no new file).
3. **`AZURE_CREDENTIALS` / `SQLA_BROKER_APP_NAME` / PAT `AADSTS53003`**: external, not fixable in source, **not worked around**. What V17.7.1 changes is visibility: the start-up check now reports a refused token (`rejected` / `no-access`) or a failing central PAT (`error`, with the service's own message) on the Home page. The message never contains the token.
4. Diagnostics preserved: the synchronization log `lastError`, the central-service messages and `authTrace` are unchanged; the new state adds redacted messages only.

## Not verified
* The contents of the four archives (see above).
* No real GitHub, GitHub Actions run, Azure broker or deployed site was reachable; GitHub and the repository were emulated (`docs/TEST_REPORT_V17.7.1.md`).
