# SQL Assistant V17.7.1 — release notes

* **GitHub connection at start-up** — SQL Assistant checks the saved GitHub access (token, central sign-in or published copy) when it opens, with read-only requests, and the Home page shows the real state, the last synchronization and a **Pull Schema** button. Nothing is written or published automatically; no sign-in is started without you; if GitHub is unavailable everything else keeps working.
* **GitHub Repository** in the hamburger menu opens the repository card, Pull Schema and Pull Secret Vault together. Schema → Pull Schema works as before.
* **Query Library** in the hamburger menu: **Add New Query** (submit a query you ran successfully; it stays *Pending approval* until an administrator approves it) and **View Query Library** (approved queries, read-only: search, details, copy SQL).
* **Administrators**: Settings → Admin Query Library → *Query submissions awaiting review*; Approve / Reject ask for the Admin Password again.
* **Please read** `docs/QUERY_LIBRARY.md` → *Limitation*: in a static application the repository's write permission is the real trust boundary — give ordinary users read-only access.
* Upgrade: replace the deployed `release/` folder; nothing to migrate. Rollback: `docs/ROLLBACK_V17.7.1.md`.
