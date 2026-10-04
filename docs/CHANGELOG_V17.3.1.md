# SQL Assistant 17.3.1 (update): V17.2 UI and Admin Password restored

- **UI:** the **V17.2 UI** is restored, replacing the Bootstrap/V10.5-style UI of the first 17.3.1 package. That covers the navbar, the hamburger menu, the Sync Source and Sync Time dropdowns, the badges, the two-card builder, the Manual Selectors tabs and the Schema page.
- **Admin Password (mandatory):**
  - Settings is locked until the Admin Password is entered (default `admin`, with a warning until it is changed).
  - **Security** tab: change the password and lock the session; Settings re-lock automatically after 5 minutes.
  - The password is also required to delete a schema row (three-step confirmation), to delete a schema, and for every **Danger Zone** action (clear schema, clear learning, clear vault, reset the password).
  - Existing V17.2 passwords keep working (same storage key).
- **Fixed during browser testing:**
  - the Advanced Options Limit, GROUP BY and HAVING fields now apply while typing; before, a click right after typing was lost;
  - "Update invoice 1234 …" is again recognised as a WHERE condition in the Query Builder for CR.

# SQL Assistant 17.3.1

**Baselines:**
- **UI and deployment:** V17.2, the last known-good version.
- **Features:** V17.2.1.

## Fixed
- **Schema synchronization.** Root causes: the storage key, repository location and GitHub settings layout changed by the V17.2.1–V17.3 packages; the lossless decode rule not applied to stamped files; cache; large files. See `ROOT_CAUSE_V17.3.1.md`.
- **Blank index page.**
  - The root `index.html` no longer loads `src/main.ts`.
  - Single self-contained build, with no CDN and no module scripts.
  - The UI renders before services start.
  - Hash routing, plus `404.html` for GitHub Pages.
- **Settings re-render during blur.** Editing a filter, alias or the Manual Schema Update filter could replace the page with "Failed to set innerHTML". Views now re-render after the change event.
- **Leftover options in the Read Only builder.** Grouping, sorting and HAVING left over from an earlier description are removed when their tables are deselected.

## Restored V17.2 UI
- **Navigation and layout:**
  - fixed navbar with the 3D logo and the "Crafted by" signature;
  - hamburger off-canvas menu (Quick Start · Query Builder › · Schema › · Error Rectifier · Settings · Theme › · About);
  - Guided Walkthrough;
  - footer signature.
- **Builders:**
  - Describe What You Need side by side with Generated SQL (syntax highlighting; Tables / Columns / Filters Applied; Copy Result, Accept & Learn, Optimize);
  - a tab bar with one persistent **Build Query**;
  - Pick Tables, Pick Columns (alias and decode), Filters (Is one of / Is not one of);
  - Advanced Options cards, with **auto** and **manual** markers;
  - Query Builder for CR with the WHERE safeguard.
- **Other pages:** Used Schema, Update Schema (download, Smart Schema Import Engine, Danger Zone), Error Rectifier, About.
- **Settings:**
  - **Schema Management** with recovery options: Restore from repository, Validate repository file, Download repository file, Publish my local copies, Recover decode codes, Export.
  - **Manual Schema Update:** select a row, edit it in a dialog showing current → modified, Save enabled only after a change, Reset, Cancel, and delete with dependency confirmation.
  - **Secret Vault**, with Push and Retrieve.
  - **AI/LLM Model.**
