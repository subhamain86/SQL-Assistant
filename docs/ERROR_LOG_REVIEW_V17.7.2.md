# Review of the error logs — V17.7.2

**Evidence actually available.** The four log archives in `Desktop/Project/Error` (`logs_103717775423`, `logs_104050659931` and its duplicate, `logs_104050744994`, `logs_104051351287`) are ZIP files. In this session they could **not be downloaded or opened** (the sandbox has no access to SharePoint — HTTP 403 — and chat uploads do not accept ZIPs). The classification below therefore relies on `docs/ERROR_LOG_REVIEW_V17.7.1.md` / `docs/ERROR_LOG_REVIEW_V17.7.md`, whose author read the archives. **The log contents remain unverified by this release.**

| Area asked for | Finding |
|---|---|
| GitHub synchronization / configuration initialisation | Logged errors are external: `AZURE_CREDENTIALS` not set, `SQLA_BROKER_APP_NAME` with a space (unverified), HTTP 403 `AADSTS53003` Conditional Access on the central PAT. Not fixable in source and **not worked around**. V17.7.2 adds *visibility*: a failed central-configuration pull is logged locally with the repository's own (secret-masked) message and never changes the local configuration. |
| SQL generation | No archive describes a natural-language defect. The defects found in V17.7.2 were found by running the engine on the 77-table AP schema, not from logs — see `docs/NL_SQL_ROOT_CAUSE_V17.7.2.md`. |
| Navigation / UI | No archive concerns navigation or the Query Builder layouts. In this build, a browser run found **no console error and no page error** in any session. |
| Recurring errors | Stale files (59: 54 orphaned sources + 5 historical tests) in the *target repository* — unchanged by V17.7.2; clean them once with `node scripts/prune-orphans.mjs --delete && node scripts/prune-stale.mjs --delete`. V17.7.2 adds no orphan (`npm run check:stale` passes). |

## Unresolved / not fixable here
* Log contents unverified (above).
* `AZURE_CREDENTIALS`, `SQLA_BROKER_APP_NAME`, PAT `AADSTS53003`: external configuration / policy.
* Real GitHub, GitHub Actions and a deployed site were not reachable; GitHub was emulated.
