# Source provenance (V17.3.1)

## UI: the V17.2 UI
The user interface is the **V17.2 UI**:
- the V17.2 stylesheet (`public/styles.css`);
- the navbar: hamburger menu, 3D logo, Sync Source and Sync Time dropdowns, Active Schema badge, network and lock badges, theme menu, Guided Walkthrough, signature;
- the page layouts: two-card builder, Manual Selectors tabs, Schema page;
- **password-protected Settings** with the V17.2 tabs: Security · Manual Schema Update · Schema Management · Secret Vault · Synchronization · AI/LLM Model · Danger Zone.

The V17.2 stylesheet and page code were written in the same conversation as V17.2 and reused from there. The V17.2 project archive in SharePoint (`AP-SQL-Assistant-V17.2.zip`) was read to confirm the V17.2 structure, element IDs, labels, tab names, default password behaviour and the V17.2 browser-test expectations. That archive's text index strips HTML from template strings, so page files could not be copied byte for byte. Each page was therefore rebuilt to the V17.2 markup and checked against the V17.2 browser-test selectors.

## Admin Password (the V17.2 password section)
- **Storage:** same storage key as V15–V17.2 (`sqla.pwvault.v15`), so existing passwords keep working. The password is never stored; only an AES-GCM encrypted marker (PBKDF2-SHA-256, 150 000 iterations) is kept.
- **Default:** the default password is `admin`. While it is in use, the UI warns.
- **Where it is required:**
  - unlocking Settings;
  - deleting a Manual Schema Update row (three-step confirmation);
  - deleting a schema;
  - every Danger Zone action.
- **Session:** Settings lock automatically after 5 minutes of inactivity, and on Lock Settings or reload.

## Engine and synchronization
The engine and synchronization code is V17.3.1. See `ROOT_CAUSE_V17.3.1.md`.

## Not accessible
- **The live repository file.** AP schema 77 was reproduced with a fixture of the same structure: 77 tables, 437 legacy `{code,label}` decode entries.
