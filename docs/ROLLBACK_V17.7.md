# Rollback from 17.7.0 to 17.6.9

17.7.0 changes no storage key, no record format and no repository path. Rolling back is safe for users' data.

1. Redeploy the V17.6.9 package (`rollback/SQL-Assistant-V17.6.9.zip` in this archive: the unmodified baseline of this release without its own nested rollback folder) — its `release/` folder, or build it (`npm ci && npm run build`).
2. Browser storage needs no action: `sqla.pwvault.v15` and `sqla.adminpwmeta.v1765` are read identically by 17.6.9.
3. The central record `sql-assistant-data/security/admin-password.json` is unchanged and read by 17.6.9 as before.
4. The workflows are unchanged between the two versions.
5. Caveat: 17.6.9 again ships the `?e2e=1` test hook in the production page and the weaker inference of the default (see `CHANGELOG_V17.7.md`, items 1–6). Roll back only for a blocking problem.
