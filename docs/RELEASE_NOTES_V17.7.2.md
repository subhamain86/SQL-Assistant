# Release notes — V17.7.2

* **Describe What You Need** has moved out of the two Query Builders into two hamburger options with a *Describe What You Need (optional)* card and a *Result* card. A result is a **success** only when the SQL covers the description and validates; otherwise it is **Needs review** (with what was left out) or an **error** with reasons — never a silently smaller query.
* **Generated SQL** is directly below **Manual Selectors** in Read Only and CR.
* **Repository configuration** edited by an administrator is published to the repository and adopted by new and existing machines.
* **First deployment:** the first administrator save of the repository configuration creates `sql-assistant-data/config/repository-config.json`; until then every machine uses the application defaults exactly as in V17.7.1.
* **Keep your own `public/favicon.svg`.** It is not part of text bundles; the package in this release contains a neutral placeholder only where the original was not available (see `docs/TEST_REPORT_V17.7.2.md`).
