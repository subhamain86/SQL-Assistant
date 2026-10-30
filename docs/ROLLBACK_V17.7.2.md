# Rollback — V17.7.2 → V17.7.1

1. Deploy `SQL-Assistant-V17.7.1.zip` (`Desktop/Project/Raw/SQL-Assistant-V17.7.1.zip`, the last good UI baseline) in place of V17.7.2.
2. **Central configuration:** nothing needs to be undone. `sql-assistant-data/config/repository-config.json` is an ordinary data file that V17.7.1 ignores. To remove it, delete the file in the repository (a commit); machines keep the last values they applied.
3. Browser storage written by V17.7.2 (`sqla.centralcfg.v1772`, `sqla.centralcfglog.v1772`) is ignored by V17.7.1 and may stay.
4. Everything else (schemas, learned patterns, Query Library, token vault, Admin Password) is stored exactly as in V17.7.1 and needs no migration.
