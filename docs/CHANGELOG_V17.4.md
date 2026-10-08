# SQL Assistant 17.4 — what changed

V17.4 is built **on the V17.3.1 code, functionality and UI** (see `SOURCE_PROVENANCE.md`). The V17.3.1 UI is unchanged except where a V17.4 feature needs a control; the only new Settings tab is *Admin Query Library*.

## Fixed
* **Manual Selectors no longer reset.** Root cause: every table click re-rendered the whole *Tables & Columns* section (pickers kept their search / module / scroll state in closures) and every tab switch re-mounted it. Now: the section is mounted **once** and the pickers update **in place**; module filter, searches, scroll positions and the active tab live in a centralized UI state; the *Tables & Columns* tab stays mounted while another tab is shown; the whole builder draft survives a page reload (session only) and an Active Schema change (selections are pruned to what still exists, not wiped). Selections made for a table that is not currently selected are **kept** (and shown again when the table is re-selected) but never reach the SQL.
* **MySQL date shortcuts** ("this year", "last month") generated PostgreSQL's `DATE_TRUNC()` — found by the new validator, fixed at the source.
* **Secret Vault › Retrieve / Import** did not refresh the repository fields and masked token after success.
* **The NLU could not resolve** *"top 20 suppliers by total invoice value"* (it produced `SELECT * … FETCH FIRST 20`) or *"invoices from supplier ABC … with their invoice number, gross amount and status"* (dropped the supplier filter and the gross amount, and selected a table named `IA_TABLE_30` because the number 30 matched its name). See *Describe What You Need* below.

## Describe What You Need
* **Measures are found across the whole schema** ("total invoice value" → `SUM(INVOICE_HEADER.INVOICE_AMOUNT)` / `SUM(IA_INVOICE.GROSS_SUM)`), scored by entity words, measure synonyms (amount / sum / value / total / gross / net …), whether the table is already in scope and relationship distance.
* **"top N <entity> by …"** groups by the entity (a table's name column, or a column such as `SUPPLIER_NAME`), sorts DESC and limits.
* **A proper name after an entity word is a filter** ("supplier ABC" → `SUPPLIER_NAME = 'ABC'`).
* **Output requested in words that the schema cannot provide is reported**, never invented ("Not found in the Active Schema: invoice number, gross amount").
* **Manual Selectors are context:** tables already selected are used when the description names none.
* **Retrieval order:** Active Schema → Admin Query Library → centrally learned queries → offline NLU → local SQL engine (shown under *How this was resolved*). Patterns are **adapted**, never copied: the schema, the request, the dialect and the manual selections always win.
* **Explain this SQL:** tables, columns, joins, filters, aggregation, grouping, sorting, limit, options and the pattern used.
* **12-point validation before SQL is shown:** tables, columns, joins, syntax, functions, aliases, GROUP BY, aggregates, filters, dialect, unresolved entities, destructive SQL. Only valid SQL is learned.

## Centralized, tiered self-learning
`sqla.learning.v174` (versioned) records request, generated / modified / final SQL, schema id + version + fingerprint, dialect, tables, columns, joins, filters, advanced options, result status, feedback and the extracted pattern. Tiers: **executed** (user-reported success) > **confirmed** > **modified & confirmed** > **repeated** (≥ 3×) > **generated** (stored, never used). Failed results and negative feedback are excluded; credentials are never learned. Indexed retrieval; incremental writes. Synchronized between devices (below).

## Admin Query Library (new Settings tab)
Add / edit / delete (Admin Password) / enable-disable / test-validate / approve / search / filter; metadata: name, description, SQL, tables, columns, purpose, tags, dialect, schema + version compatibility, created by/date, approval. Only **approved + enabled + still valid against the Active Schema** queries are trusted. Editing the SQL withdraws approval. Learned queries can be promoted to a draft for review. Import / export JSON.

## Advanced Options
* A short plain-language description for **every** option, and an "all SQL options at a glance" catalog (dialect-aware).
* **RIGHT JOIN, FULL JOIN** (not offered for MySQL), **EXISTS / NOT EXISTS / IN / NOT IN sub-select filters** (read-only, validated), **date shortcuts** on date filters, ORDER BY ASC/DESC, `RECURSIVE` keyword only where the dialect uses it.
* Automatic and manual modes work together; a manual option takes precedence.

## Knowledge synchronization
Learned queries + the Admin Query Library are one versioned file next to the schema registry (`…/knowledge/knowledge.json`), merged per record with deletion tombstones. Incoming records are sanitized: credentials and non-read-only SQL are rejected.

## Secret Vault — Push to Repository
Validate → encrypt (AES-256-GCM, PBKDF2-SHA-256 310 000) → assert **no plaintext / Base64 secret** → push → **read back, decrypt and compare**. A device that lost its key explains how to recover and keeps the unreadable data (backed up, never overwritten silently).

## AI/LLM Model
The four layers are shown with live status (schema engine · offline NLU · local learning · optional local LLM). New *Local model* provider (no key, localhost) and *Test connection*. The app is fully usable without any AI service and while offline.

## Data & compatibility
Versioned, idempotent, non-destructive migrations (V17.3.1 learned queries → the tiered store; the old key is kept). Saved schemas, GitHub sync, vault files (V17.3.1 and V17.2 formats), settings and the Admin Password are unchanged.
