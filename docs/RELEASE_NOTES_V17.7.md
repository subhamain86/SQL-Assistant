# Release notes — SQL Assistant V17.7

**For administrators.** If a non-default Admin Password exists centrally, no device — new, offline, half-synchronized or with cleared storage — accepts `admin`. The default is accepted only when (a) the authoritative repository answers that no record ever existed for a device that never knew one, or (b) the central record is an explicit reset. The production page no longer contains the browser-test hook that could replace the repository (and therefore the answer "no record").

**What you will notice.** Nothing in the UI except the entry on About → Recent versions. A device whose central record vanished from the repository stays locked until an administrator publishes a reset (`npm run reset-admin-password`, then push) or restores the record; clearing the site data of that one device also returns it to first-time state.

**Deployment.** Same artifacts (`dist/index.html`, `index.html`, `release/**`), same workflows. `npm run build` never contains test hooks; `npm run build:test` creates `test-dist/` for the Chromium suites only — never deploy it. Password synchronization needs no Node.js / npm on any device: it is the existing repository / central access service / published-copy path. Required one-time repository step (unchanged since V17.6.9): remove the 59 stale files (`docs/STALE_FILES_V17.7.md`). External blockers still open: `AZURE_CREDENTIALS`, PAT Conditional Access 403 (`docs/ERROR_LOG_REVIEW_V17.7.md`).

**Version.** Released as V17.7, stamped `17.7.0` (npm requires a three-part version; V17.6 was stamped `17.6.0` the same way).
