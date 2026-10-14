# Rollback from 17.6.9 to 17.6.8

17.6.9 changes no storage key, no record format and no repository path. Rolling back is therefore safe for users' data.

1. Redeploy the V17.6.8 package (`SQL-Assistant-V17.6.8.zip`, kept unchanged by the project) — its `release/` folder, or build it (`npm ci && npm run build`).
2. Browser storage needs no action: `sqla.pwvault.v15` and `sqla.adminpwmeta.v1765` are read identically by 17.6.8.
3. The central Admin Password record in the repository (`sql-assistant-data/security/admin-password.json`) is unchanged and is read by 17.6.8 as before.
4. The workflows of 17.6.8 can be restored from that package; the stale-file removal done for 17.6.9 does not need to be undone (those files belong to no version since 17.6.8).
5. Caveat: 17.6.8 again accepts the default `admin` on a device without a connection or with a refused credential — the defect fixed in 17.6.9. Roll back only for a blocking problem.

**Rollback package:** `rollback/SQL-Assistant-V17.6.8.zip` in this archive is the unmodified V17.6.8 package that was the baseline of this release (the exact differences are listed in `docs/CHANGED_FILES_V17.6.9.md`).
