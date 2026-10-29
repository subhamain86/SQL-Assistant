# Query Library — submissions, approval and the user view (V17.7.1)

```
user tests a query → Add New Query → Submit for approval → PENDING APPROVAL → administrator reviews → Approve / Reject → an approved query becomes an entry of the Admin Query Library
```

## Data model (reused, not duplicated)
A submission carries the fields of an `AdminQuery` (name, description, purpose, SQL, tables, columns, tags, dialect, schema name / versions) plus: usage notes, submitter, device, submission time, "I ran it successfully", **status** (`pending` | `approved` | `rejected`), reviewer, review time, feedback, the id of the library entry an approval created, and the warnings found at submission. Approval hands the fields to the existing `AdminQueryLibrary.upsert()` / `approve()`; there is no parallel library.

## Rules
| Rule | Where it is enforced |
|---|---|
| A submission is never trusted: it is not in the library store, `trusted()` / `hints()` never see it | `querySubmissions.ts` (own store) — tested |
| Only SELECT / WITH, no credential, ≤ 20 000 characters, balanced parentheses; destructive statements and credentials are **refused** at submission and again when read from a file / the repository | `sqlBlockers()`, `sanitizeSubmission()` |
| Unknown tables / columns and failed schema checks **warn** (the SQL is kept exactly); they block an **approval** until fixed | `check()` / `approvalProblems()` |
| Duplicates: same SQL (case, whitespace, comments, trailing `;` ignored) or same name — refused while pending or in the library; a rejected one may be resubmitted | `check()` |
| Approve / reject need the one-time **action ticket** of a successful Admin Password check; wrong password, other purposes (`confirm`, `settings-unlock`), a used or expired ticket are refused and change nothing | `approve()` / `reject()` → `takeActionTicket()` |
| The default `admin` is accepted only where the Admin Password authority confirms it (V17.7 rules unchanged) | `verifyPassword()` |
| A file / the repository can never carry a decision into the library: an import is forced to `pending`; a status read from the repository is only displayed | `importFile()`, `mergeRemote()` |
| Metadata is plain text, clipped, control characters removed, escaped where shown | `clip()`, `e()` |
| The user view lists `approved && enabled` only and contains no administrator control or metadata | `queryLibrary.ts` (source-level and browser tests) |
| No route reaches an administrator function; Settings keeps its Admin Password lock | `ROUTES`, `renderSettingsPage` (unchanged) |

## Sharing a submission with the administrator
* Connection that **may write** (a token with write access, or a central-access sign-in whose GitHub account has write access): the submission is merged into and published to `sql-assistant-data/knowledge/submissions.json` — its own file (a V17.7 device rewrites `knowledge.json` without knowing anything new in it, which would drop submissions). The administrator's device reads it (Settings → *Refresh submissions*) and publishes the decision; the submitter sees the status after *Share now / refresh status*.
* Connection that **cannot write** (read-only account, published copy, no connection): the submission stays on the device and the page says so. The user exports it (*Export my submissions*); the administrator imports it (*Import submissions file*) — imported records are always `pending`.
* The approved library entry travels with the **existing** knowledge synchronization (Sync button / *Sync knowledge now* / scheduler), unchanged.

## Limitation that must be stated (architecture, not a defect of this change)
SQL Assistant is a **static, client-side application**. Its shared state is a set of JSON files in a repository, and the repository decides who may write. Therefore:
* **What the application enforces**: no interface or route gives an ordinary user an administrator capability; the submission service refuses approval / rejection without a fresh Admin Password check; a submission can never become trusted through the submission channel.
* **What it cannot enforce against a determined user who holds a write credential**: anybody whose connection may write to `sql-assistant-data/` can edit `knowledge.json` directly (already true in V17.7 for the Admin Query Library). The trust boundary for the **shared** library is *repository write access*. Give ordinary users **read-only** access; only administrators need write access. A read-only user can still submit by export / import and browse the library through the published copy or a read connection.
* The library on each device is browser storage; a user who edits their own browser storage affects only their own device.
* A server-side approval API would be needed to close this completely; it is out of scope for a static application and was not simulated.
