# Rollback from 17.7.1 to 17.7.0

17.7.1 changes **no storage key that 17.7.0 reads, no record format and no repository path** that 17.7.0 uses. Rolling back is safe for users' data.

* Redeploy the V17.7 package: `rollback/SQL-Assistant-V17.7.zip` in the release archive is the unmodified baseline of this release (without its own nested rollback folder) — use its `release/` folder, or build it (`npm ci && npm run build`). (The zip is the V17.7.0 source reconstructed from the supplied source bundles; see `docs/VERIFICATION_REPORT_V17.7.1.md` for what the bundles did not contain.)
* **Browser storage**: V17.7.0 ignores `sqla.querysubs.v1771`, `sqla.querysubssync.v1771` and `sqla.querysubmitter.v1771` (new in 17.7.1). Pending submissions stay in the browser and in `sql-assistant-data/knowledge/submissions.json`; V17.7.0 neither reads nor rewrites them, so they are still there when 17.7.1 is redeployed.
* **Repository**: `knowledge/submissions.json` is a new, separate file; `knowledge.json`, the schema registry, the Admin Password record and the vault are exactly as 17.7.0 reads them. V17.7.0's `publish-data.yml` would publish it to the site — remove the file (or keep V17.7.1's `scripts/publish-data.mjs`) if unreviewed submissions must not be served.
* After a rollback the hamburger menu has no *GitHub Repository* / *Query Library* entries and Home has no GitHub panel; approved queries remain in the Admin Query Library (they are ordinary entries).
