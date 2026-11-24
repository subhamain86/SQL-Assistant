# Rollback — V17.7.4 → V17.7.3

1. Deploy `SQL-Assistant-V17.7.3.zip` (the V17.7.3 package, included in the delivery) in place of V17.7.4.
2. Data written by the serverless provider (`sql-assistant-data/analytics/**`) stays in the repository and is ignored by V17.7.3 (it knows only the service provider). It can be left or deleted; it is encrypted and holds no secret except the **wrapped** private key. Deleting `admin-key.json` makes the data permanently unreadable.
3. Browser keys `sqla.analytics.uid.v1773` / `sqla.analytics.queue.v1773` are unchanged between the two versions.
4. The Pages workflow variables `SQLA_ANALYTICS_PROVIDER` etc. are ignored by the V17.7.3 workflow; remove `release/sql-assistant-data/analytics.config.json` if the provider should stay off.
5. The committed compiler (`tools/typescript/`) and the new scripts are not needed by V17.7.3 (which builds with an npm-installed TypeScript 5.8.3).

## About the V17.7.3 package in `rollback/`
`rollback/SQL-Assistant-V17.7.3.zip` is a **rebuild** of V17.7.3 (the original zip was no longer available): V17.7.2 sources plus the recorded V17.7.3 change set, verified before V17.7.4 was started (41 Node tests and 84/84 browser checks). If you still hold the original V17.7.3 zip, use that. `RECONSTRUCTED.txt` inside the rollback zip says the same.
