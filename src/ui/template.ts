/**
 * Page markup — the V17.2 known-good UI (V8–V17.2 lineage): fixed navbar with 3D logo, hamburger off-canvas menu
 * (Quick Start · Query Builder › · Schema › · Error Rectifier · Settings · Theme › · About), cards with icon badges,
 * Describe What You Need | Generated SQL side by side, tab bar with one persistent Build Query action, footer signature.
 * IDs and labels follow the original markup so the walkthrough, tests and muscle memory keep working.
 */
import { APP_NAME } from '../v17/sync/schemaFormat';
const logo = (id: string, size: number) => `<svg class="app-logo-svg" width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${APP_NAME} 3D database logo"><defs><linearGradient id="cylBody${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#bcd2ff"/><stop offset="100%" stop-color="#123a8a"/></linearGradient><radialGradient id="cylTop${id}" cx="35%" cy="30%" r="75%"><stop offset="0%" stop-color="#ffffff"/><stop offset="55%" stop-color="#cfe0ff"/><stop offset="100%" stop-color="#7ea4ff"/></radialGradient></defs><ellipse cx="32" cy="52" rx="25" ry="8" fill="#0d1b3f" opacity="0.32"/><path d="M56 14 V50 A24 8 0 0 1 8 50 V14 Z" fill="url(#cylBody${id})"/><path d="M8 32 A24 8 0 0 0 56 32" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.5"/><ellipse cx="32" cy="14" rx="24" ry="8" fill="url(#cylTop${id})" stroke="rgba(255,255,255,.6)" stroke-width="1"/><path d="M46 12 L35 34 H44 L37 52 L53 28 H44 Z" fill="#ffd166" stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
const badge = (color: string, icon: string, sm = true) => `<span class="icon-badge ${sm ? 'icon-badge-sm ' : ''}badge-${color}"><i class="bi bi-${icon}"></i></span>`;
const menuBtn = (view: string, color: string, icon: string, label: string, sm = false) => `<button class="nav-link text-start" data-view="${view}" type="button"><span class="menu-item-label">${badge(color, icon, sm)}<span>${label}</span></span></button>`;
const dialects = '<option>Oracle</option><option>SQL Server</option><option>PostgreSQL</option><option>MySQL</option><option>Generic</option>';
const strip = (id: string) => `<div class="shared-schema-strip level-checking" id="${id}"></div>`;
export function pageTemplate(version: string): string {
  return `
<nav class="navbar border-bottom bg-body fixed-top" id="mainNavbar"><div class="container-fluid">
  <button class="btn btn-outline-secondary" type="button" data-bs-toggle="offcanvas" data-bs-target="#mainMenu" data-tour="hamburger" aria-label="Open menu"><i class="bi bi-list fs-5"></i></button>
  <span class="navbar-brand ms-2 mb-0 fw-semibold d-flex align-items-center gap-2"><span class="logo-3d-wrap"><span class="app-logo-badge">${logo('Nav', 34)}</span></span><span id="appName">${APP_NAME}</span></span>
  <span class="text-body-secondary small d-none d-md-inline">Read-only &amp; Change Request SQL, built from your approved schema</span>
  <div class="ms-auto d-flex align-items-center gap-3">
    <span class="small text-body-secondary d-none d-lg-inline" id="navActiveSchema"></span>
    <button class="btn btn-outline-primary btn-sm" id="tourBtn" data-tour="tourbtn" type="button"><i class="bi bi-compass-fill me-1"></i>Guided Walkthrough</button>
    <span class="creator-signature-wrap d-none d-lg-flex flex-column align-items-start lh-1"><span class="creator-signature-label">Crafted by</span><span class="creator-signature">Subham Ain</span></span>
  </div></div></nav>
<div class="offcanvas offcanvas-start" tabindex="-1" id="mainMenu">
  <div class="offcanvas-header"><h5 class="offcanvas-title d-flex align-items-center gap-2"><i class="bi bi-list fs-5"></i> Menu</h5><button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button></div>
  <div class="offcanvas-body d-flex flex-column">
    ${menuBtn('quickstart', 'teal', 'house-door-fill', 'Quick Start')}
    <div class="menu-submenu-toggle open" data-submenu="queryBuilderSubmenu"><span class="menu-item-label">${badge('indigo', 'lightning-charge-fill', false)}<span>Query Builder</span></span><span class="chevron">&#8250;</span></div>
    <div class="menu-submenu open" id="queryBuilderSubmenu">${menuBtn('builder', 'blue', 'eye-fill', 'Read Only Query Builder', true)}${menuBtn('crbuilder', 'orange', 'pencil-square', 'Query Builder for CR', true)}</div>
    <div class="menu-submenu-toggle" data-submenu="schemaSubmenu"><span class="menu-item-label">${badge('purple', 'hdd-stack-fill', false)}<span>Schema</span></span><span class="chevron">&#8250;</span></div>
    <div class="menu-submenu" id="schemaSubmenu">${menuBtn('usedschema', 'blue', 'file-earmark-text-fill', 'Used Schema', true)}${menuBtn('updateschema', 'pink', 'cloud-arrow-up-fill', 'Update Schema', true)}</div>
    ${menuBtn('errorrectifier', 'cyan', 'magic', 'Error Rectifier')}
    ${menuBtn('settings', 'dark', 'gear-fill', 'Settings')}
    <div class="menu-submenu-toggle" data-submenu="themeSubmenu"><span class="menu-item-label">${badge('purple', 'palette-fill', false)}<span>Theme</span></span><span class="chevron">&#8250;</span></div>
    <div class="menu-submenu" id="themeSubmenu">
      <button class="nav-link text-start" data-theme="auto" type="button"><span class="menu-item-label">${badge('gray', 'display')}<span>System Default</span></span></button>
      <button class="nav-link text-start" data-theme="light" type="button"><span class="menu-item-label">${badge('orange', 'sun-fill')}<span>Light</span></span></button>
      <button class="nav-link text-start" data-theme="dark" type="button"><span class="menu-item-label">${badge('indigo', 'moon-stars-fill')}<span>Dark</span></span></button></div>
    <button class="nav-link text-start mt-auto" id="aboutMenuBtn" type="button"><span class="menu-item-label">${badge('gray', 'info-circle-fill', false)}<span>About</span></span></button>
  </div></div>
<div class="container-fluid py-3" style="max-width:1180px;">
  <section class="app-view" id="view-quickstart">
    ${strip('sharedSchemaStripQuickstart')}
    <div class="hero-brand-row mb-3"><span class="logo-3d-wrap"><span class="app-logo-badge app-logo-badge-lg">${logo('Hero', 56)}</span></span><div><h1 class="h3 builder-heading mb-0">Welcome — what does this tool do?</h1><div class="text-body-secondary small">${APP_NAME} · Version ${version}</div></div></div>
    <p class="text-body-secondary">This assistant writes database queries for you — both <strong>read-only reports</strong> and <strong>Change Request SQL</strong> (INSERT / UPDATE / DELETE text) — using the organization's approved database schema as its single source of truth, and helps you <strong>correct a SQL query</strong> when a database gives you back an error. Describe what you need in plain language (understood by the built-in <strong>offline</strong> language model), make selections manually, or both together. It never connects to a real database and never executes anything; it only ever produces SQL text for you to review and copy.</p>
    <h2 class="h6 mt-4">${badge('purple', 'diagram-3-fill')} Areas covered by the active schema</h2><div class="d-flex flex-wrap gap-2 mb-3" id="qsModuleChips"></div>
    <h2 class="h6 mt-4">${badge('teal', 'stars')} Try an example</h2><div class="row row-cols-1 row-cols-sm-2 row-cols-lg-3 g-3" id="qsExampleGrid"></div>
    <div class="row row-cols-1 row-cols-md-2 g-3 mt-2">
      <div class="col"><div class="card h-100"><div class="card-body"><h3 class="h6">${badge('blue', 'eye-fill', false)}Read Only Query Builder</h3><p class="small text-body-secondary mb-2">Describe what you need in plain language and click Build Query right there, make selections manually, or combine both.</p><button class="btn btn-outline-primary btn-sm" data-view="builder" type="button"><i class="bi bi-arrow-right-circle me-1"></i>Open Read Only Query Builder</button></div></div></div>
      <div class="col"><div class="card h-100 border-warning-subtle"><div class="card-body"><h3 class="h6">${badge('orange', 'pencil-square', false)}Query Builder for CR <span class="badge text-bg-warning-subtle text-warning-emphasis">CR</span></h3><p class="small text-body-secondary mb-2">Describe the change in plain language and click Build Query, or use the manual controls.</p><button class="btn btn-outline-warning btn-sm" data-view="crbuilder" type="button"><i class="bi bi-arrow-right-circle me-1"></i>Open Query Builder for CR</button></div></div></div></div>
    <div class="row row-cols-1 g-3 mt-1"><div class="col"><div class="card h-100 border-info-subtle"><div class="card-body"><h3 class="h6">${badge('cyan', 'magic', false)}Error Rectifier</h3><p class="small text-body-secondary mb-2">Paste a database error and the SQL that caused it, and get a corrected query with a plain-language explanation.</p><button class="btn btn-outline-info btn-sm" data-view="errorrectifier" type="button"><i class="bi bi-arrow-right-circle me-1"></i>Open Error Rectifier</button></div></div></div></div>
  </section>
  <section class="app-view" id="view-builder">
    ${strip('sharedSchemaStripBuilder')}
    <h1 class="h4 builder-heading">${badge('blue', 'eye-fill', false)}Read Only Query Builder</h1>
    <div class="builder-row mb-3">
      <div class="builder-col-half"><div class="card" data-tour="prompt"><div class="card-body">
        <h2 class="h6">${badge('indigo', 'chat-left-text-fill')} Describe What You Need <span class="fw-normal text-body-secondary small">(optional)</span></h2>
        <textarea class="form-control mb-2" id="promptInput" rows="3" placeholder="Example: total invoice amount per vendor for approved invoices in the last 30 days, top 10. Try: 'status is one of Approved, Paid'."></textarea>
        <div class="d-flex flex-wrap gap-2 align-items-center"><label class="small text-body-secondary mb-0" for="dialectSel">SQL dialect</label><select class="form-select form-select-sm w-auto" id="dialectSel">${dialects}</select>
          <div class="form-check form-check-inline ms-2 mb-0"><input class="form-check-input" type="checkbox" id="optDistinct2"><label class="form-check-label small" for="optDistinct2">Remove duplicates</label></div></div>
        <div class="describe-action-row" data-tour="describe-build"><span class="describe-hint">Engine: <strong>offline NLU</strong> (primary)<span id="aiEngineHint"></span>. Works from your description alone, your manual selections alone, or both together.</span><button class="btn btn-primary btn-sm" id="generateFromDescriptionBtn" type="button"><i class="bi bi-lightning-charge-fill me-1"></i>Build Query</button></div>
        <div class="description-interpretation-box" id="descriptionInterpretationBox"></div>
      </div></div></div>
      <div class="builder-col-half result-col"><div class="card" data-tour="results"><div class="card-body">
        <h2 class="h6">${badge('green', 'code-slash')} Generated SQL</h2>
        <div id="resultBody"><p class="text-body-secondary small mb-0">Your generated SQL will appear here as soon as you click Build Query.</p></div>
        <div class="d-flex flex-wrap gap-2 mt-2"><button class="btn btn-outline-primary btn-sm d-none" id="copyBtn" type="button"><i class="bi bi-clipboard-check-fill me-1"></i>Copy Result</button><button class="btn btn-outline-success btn-sm d-none" id="acceptLearnBtn" type="button"><i class="bi bi-mortarboard-fill me-1"></i>Accept &amp; Learn</button><button class="btn btn-outline-success btn-sm d-none" id="optimizeBtn" type="button"><i class="bi bi-speedometer2 me-1"></i>Optimize</button></div>
        <div class="optimize-report-box mt-2" id="optimizeReportBox"></div>
      </div></div></div>
    </div>
    <ul class="nav nav-tabs flex-wrap" id="manualTabs">
      <li class="nav-item"><button class="nav-link active" data-tab="tables" type="button"><i class="bi bi-table me-1"></i>Tables &amp; Columns</button></li>
      <li class="nav-item"><button class="nav-link" data-tab="advanced" type="button"><i class="bi bi-sliders me-1"></i>Advanced Options</button></li>
      <li class="nav-item"><button class="nav-link" data-tab="requirements" type="button"><i class="bi bi-clipboard-check me-1"></i>Selected / Described Requirements</button></li></ul>
    <div class="tab-action-bar"><span class="text-body-secondary tab-action-hint">Configure your query using the tabs below, and/or use the description above, then build.</span><button class="btn btn-primary btn-sm" id="generateBtn" type="button"><i class="bi bi-lightning-charge-fill me-1"></i>Build Query</button></div>
    <div class="tab-content-wrap" data-tour="tabs">
      <div class="tab-pane-manual" id="pane-tables"><div class="builder-row">
        <div class="builder-col-third"><div class="card"><div class="card-body"><h2 class="h6">${badge('blue', 'table')} Pick Tables</h2><p class="small text-body-secondary">Use the module dropdown to narrow things down. You can select any number of tables.</p>
          <div class="d-flex flex-wrap gap-2 mb-2"><select class="form-select form-select-sm" id="moduleFilterSel"></select><input class="form-control form-control-sm" id="tableSearchInput" placeholder="Search tables...">
            <div class="d-flex gap-2"><button class="btn btn-outline-secondary btn-sm" id="tableSelectAllBtn" type="button"><i class="bi bi-check2-square me-1"></i>Select All (filtered)</button><button class="btn btn-outline-secondary btn-sm" id="tableUnselectAllBtn" type="button"><i class="bi bi-square me-1"></i>Clear Selection</button></div>
            <span class="small text-body-secondary" id="tableSelCount">0 tables selected</span></div>
          <div class="d-flex flex-column gap-2" id="tableListGrid" style="max-height:320px; overflow:auto;"></div></div></div></div>
        <div class="builder-col-third"><div class="card"><div class="card-body"><h2 class="h6">${badge('purple', 'list-columns-reverse')} Pick Columns <span class="fw-normal text-body-secondary small">(optional)</span></h2>
          <div class="d-flex flex-wrap gap-2 mb-2"><select class="form-select form-select-sm" id="selectedTableDropdown"></select><input class="form-control form-control-sm" id="columnSearchInput" placeholder="Search columns...">
            <div class="d-flex gap-2"><button class="btn btn-outline-secondary btn-sm" id="columnSelectAllBtn" type="button"><i class="bi bi-check2-square me-1"></i>Select All</button><button class="btn btn-outline-secondary btn-sm" id="columnUnselectAllBtn" type="button"><i class="bi bi-square me-1"></i>Unselect All</button></div></div>
          <div class="column-row-grid fw-semibold small text-body-secondary"><span></span><span>Column</span><span>Alias</span><span>Decode</span></div>
          <div id="columnListBody" style="max-height:360px; overflow:auto;"></div><div class="text-body-secondary small" id="columnListEmpty"></div></div></div></div>
        <div class="builder-col-third"><div class="card"><div class="card-body"><h2 class="h6">${badge('orange', 'funnel-fill')} Filters</h2><p class="small text-body-secondary">Conditions that determine which records appear in the result. Use <strong>Is one of</strong> / <strong>Is not one of</strong> with a comma-separated list of values (e.g. <code>10, 20, 40</code>) for SQL <code>IN</code> / <code>NOT IN</code>. <span class="fw-semibold d-block">SQL: WHERE</span></p>
          <div class="filter-group" id="readOnlyFilterGroup"></div><div class="filter-group-toolbar mt-2"><button class="btn btn-outline-primary btn-sm" id="readOnlyAddFilterBtn" type="button"><i class="bi bi-plus-circle me-1"></i>Add Filter</button> <button class="btn btn-outline-secondary btn-sm" id="readOnlyClearFiltersBtn" type="button"><i class="bi bi-x-circle me-1"></i>Clear all filters</button></div></div></div></div>
      </div></div>
      <div class="tab-pane-manual d-none" id="pane-advanced">
        <p class="small text-body-secondary">Options marked <span class="auto-badge">auto</span> were inferred from your description; anything you change here is marked <span class="manual-badge">manual</span> and always wins. <button class="btn btn-link btn-sm p-0 align-baseline" id="releaseManualBtn" type="button">Return all options to automatic</button></p>
        <div class="row g-3">
          <div class="col-12" id="joinOptionCard"><div class="card adv-option-card"><div class="card-body"><h3 class="h6 adv-option-title">${badge('indigo', 'link-45deg')}How should tables be connected?<span id="joinMark"></span></h3><p class="adv-option-explainer">Used when your query has more than one table.</p>
            <label class="join-choice d-block"><input class="form-check-input me-2" type="radio" name="joinType" id="optJoinInner" value="INNER JOIN" checked><strong>Only show records that match in every table</strong></label>
            <label class="join-choice d-block"><input class="form-check-input me-2" type="radio" name="joinType" id="optJoinLeft" value="LEFT JOIN"><strong>Also show records that don't have a match</strong></label>
            <hr><div class="small fw-semibold mb-1">How your selected tables will be connected:</div><div id="joinPreviewBox" class="small"></div>
            <div class="form-check mt-2"><input class="form-check-input" type="checkbox" id="optTableAliases"><label class="form-check-label small" for="optTableAliases">Use table aliases<span id="aliasMark"></span></label></div>
            <div class="adv-option-technical mt-2">Technical: SQL INNER JOIN / LEFT JOIN</div></div></div></div>
          <div class="col-md-6"><div class="card adv-option-card h-100"><div class="card-body"><h3 class="h6 adv-option-title">${badge('teal', 'sort-down')}Choose how to order your results<span id="sortMark"></span></h3><div id="sortRowsContainer"></div>
            <div class="filter-group-toolbar mt-2"><button class="btn btn-outline-primary btn-sm" id="addSortRowBtn" type="button"><i class="bi bi-plus-circle me-1"></i>Add Sort Column</button> <button class="btn btn-outline-secondary btn-sm" id="clearSortBtn" type="button"><i class="bi bi-x-circle me-1"></i>Clear all sorting</button></div><div class="adv-option-technical mt-2">Technical: SQL ORDER BY</div></div></div></div>
          <div class="col-md-6"><div class="card adv-option-card h-100"><div class="card-body"><h3 class="h6 adv-option-title">${badge('blue', 'list-ol')}Limit the number of results<span id="limitMark"></span></h3><div class="d-flex gap-2 align-items-center"><input class="form-control form-control-sm w-auto" id="optLimit" placeholder="e.g. 10" inputmode="numeric" style="max-width:140px;"><button class="btn btn-outline-secondary btn-sm" id="optLimitClearBtn" type="button"><i class="bi bi-x-circle me-1"></i>Clear</button></div><div class="adv-option-technical mt-2">Technical: SQL TOP / LIMIT / FETCH FIRST</div></div></div></div>
          <div class="col-md-6"><div class="card adv-option-card h-100"><div class="card-body"><h3 class="h6 adv-option-title">${badge('green', 'collection-fill')}Group results<span id="groupMark"></span></h3><input class="form-control form-control-sm" id="optGroupBy" placeholder="e.g. VENDOR.VENDOR_NAME"><div class="adv-option-technical mt-2">Technical: SQL GROUP BY (completed automatically when aggregates are used)</div></div></div></div>
          <div class="col-md-6"><div class="card adv-option-card h-100"><div class="card-body"><h3 class="h6 adv-option-title">${badge('green', 'funnel')}Filter on a total (after grouping)<span id="havingMark"></span></h3><div class="d-flex gap-2 align-items-center"><input class="form-control form-control-sm" id="optHaving" placeholder="e.g. COUNT(*) > 5"><button class="btn btn-outline-secondary btn-sm" id="optHavingClearBtn" type="button"><i class="bi bi-x-circle me-1"></i>Clear</button></div><div class="adv-option-technical mt-2">Technical: SQL HAVING</div></div></div></div>
          <div class="col-md-6"><div class="card adv-option-card h-100"><div class="card-body"><h3 class="h6 adv-option-title">${badge('purple', 'bookmark-star-fill')}Give this query a friendly name</h3><div class="d-flex gap-2 align-items-center"><input class="form-control form-control-sm" id="optView" placeholder="e.g. HighValueInvoices"><button class="btn btn-outline-secondary btn-sm" id="optViewClearBtn" type="button"><i class="bi bi-x-circle me-1"></i>Clear</button></div><div class="adv-option-technical mt-2">Technical: SQL WITH name AS (...)</div></div></div></div>
          <div class="col-md-6"><div class="card adv-option-card h-100"><div class="card-body"><h3 class="h6 adv-option-title">${badge('pink', 'files')}Remove duplicates<span id="distinctMark"></span></h3><div class="form-check"><input class="form-check-input" type="checkbox" id="optDistinct"><label class="form-check-label small" for="optDistinct">Only return unique rows</label></div><div class="adv-option-technical mt-2">Technical: SQL SELECT DISTINCT</div></div></div></div>
        </div></div>
      <div class="tab-pane-manual d-none" id="pane-requirements"><div id="requirementsSummaryBody" class="small"></div></div>
    </div>
  </section>
  <section class="app-view" id="view-crbuilder">
    ${strip('sharedSchemaStripCr')}
    <h1 class="h4 builder-heading">${badge('orange', 'pencil-square', false)}Query Builder for CR</h1>
    <div class="alert alert-warning cr-safety-banner mb-3"><i class="bi bi-shield-lock-fill me-1"></i><strong>Generated SQL only</strong> — this application does not execute database changes.</div>
    <div class="card mb-3 cr-query-type-card"><div class="card-body"><label class="form-label fw-semibold small mb-1 d-block"><i class="bi bi-list-check me-1"></i>Query Type</label>
      <div class="btn-group" role="group" id="crCommandSelector"><button class="btn btn-outline-warning btn-sm" data-command="INSERT" type="button"><i class="bi bi-plus-circle-fill me-1"></i>INSERT</button><button class="btn btn-outline-warning btn-sm" data-command="UPDATE" type="button"><i class="bi bi-pencil-fill me-1"></i>UPDATE</button><button class="btn btn-outline-warning btn-sm" data-command="DELETE" type="button"><i class="bi bi-trash-fill me-1"></i>DELETE</button></div></div></div>
    <div class="builder-row mb-3">
      <div class="builder-col-half"><div class="card"><div class="card-body"><h2 class="h6">${badge('indigo', 'chat-left-text-fill')} Describe What You Need <span class="fw-normal text-body-secondary small">(optional)</span></h2>
        <textarea class="form-control mb-2" id="crDescriptionInput" rows="2" placeholder="Example: update the invoice status to Approved where invoice id is one of 100, 101, 102"></textarea>
        <div class="d-flex flex-wrap gap-2 align-items-center"><label class="small text-body-secondary mb-0" for="crDialectSel">SQL dialect</label><select class="form-select form-select-sm w-auto" id="crDialectSel">${dialects}</select></div>
        <div class="describe-action-row"><span class="describe-hint">Works from your description alone, your manual selections alone, or both together.</span><button class="btn btn-warning btn-sm" id="crGenerateFromDescriptionBtn" type="button"><i class="bi bi-lightning-charge-fill me-1"></i>Build Query</button></div>
        <div class="description-interpretation-box" id="crDescriptionInterpretationBox"></div></div></div></div>
      <div class="builder-col-half result-col"><div class="card"><div class="card-body"><h2 class="h6">${badge('green', 'code-slash')} Generated SQL</h2><div id="crResultBody"><p class="text-body-secondary small mb-0">Choose a query type, select a table, and click Build Query.</p></div>
        <div class="d-flex flex-wrap gap-2 mt-2"><button class="btn btn-outline-primary btn-sm d-none" id="crCopyBtn" type="button"><i class="bi bi-clipboard-check-fill me-1"></i>Copy Result</button></div></div></div></div>
    </div>
    <div class="tab-action-bar" style="border-top:1px solid var(--sqla-border);border-radius:.5rem .5rem 0 0"><span class="text-body-secondary tab-action-hint">Configure your Change Request below, and/or use the description above, then build.</span><button class="btn btn-warning btn-sm" id="crBuildBtn" type="button"><i class="bi bi-lightning-charge-fill me-1"></i>Build Query</button></div>
    <div class="tab-content-wrap"><div class="builder-row mb-3">
      <div class="builder-col-third"><div class="card"><div class="card-body"><h2 class="h6">${badge('blue', 'table')} Pick Table</h2><select class="form-select form-select-sm" id="crTableSelect"></select></div></div></div>
      <div class="builder-col-third"><div class="card"><div class="card-body"><h2 class="h6">${badge('purple', 'list-columns-reverse')} Pick Columns <span class="fw-normal text-body-secondary small d-block">Values to INSERT / SET</span></h2><div id="crColumnsBody" style="max-height:280px; overflow:auto;"></div></div></div></div>
      <div class="builder-col-third"><div class="card" id="crWherePanel"><div class="card-body"><h2 class="h6">${badge('orange', 'funnel-fill')} Filters <span class="fw-normal text-body-secondary small d-block">WHERE Conditions</span></h2>
        <div class="alert alert-warning py-2 px-3 small d-none" id="crWhereRequiredWarning">&#9888;&#65039; A WHERE condition is required to identify which records should be updated or deleted.</div>
        <div class="filter-group" id="crFilterGroup"></div><div class="filter-group-toolbar mt-2"><button class="btn btn-outline-primary btn-sm" id="crAddFilterBtn" type="button"><i class="bi bi-plus-circle me-1"></i>Add Filter</button> <button class="btn btn-outline-secondary btn-sm" id="crClearFiltersBtn" type="button"><i class="bi bi-x-circle me-1"></i>Clear all filters</button>
          <div class="form-check mb-0 mt-2"><input class="form-check-input" type="checkbox" id="crAllowNoWhere"><label class="form-check-label small" for="crAllowNoWhere">I explicitly confirm this query should have no WHERE condition</label></div></div></div></div></div>
    </div></div>
  </section>
  <section class="app-view" id="view-usedschema">
    ${strip('sharedSchemaStripUsedSchema')}
    <h1 class="h4 builder-heading">${badge('blue', 'file-earmark-text-fill', false)}Used Schema</h1>
    <div class="row g-2 mb-3" id="usedSchemaSummary"></div>
    <div class="d-flex gap-2 mb-2"><input class="form-control" id="schemaSearchInput" placeholder="Search tables, columns, aliases, or descriptions..."></div>
    <div class="small text-body-secondary mb-2" id="schemaSearchResultCount"></div><div id="schemaTree"></div>
  </section>
  <section class="app-view" id="view-updateschema">
    <h1 class="h4 builder-heading">${badge('pink', 'cloud-arrow-up-fill', false)}Update Schema</h1>
    <div class="schema-persistence-status mb-3" id="schemaPersistenceStatus"></div>
    <div class="card mb-3"><div class="card-body"><h2 class="h6">${badge('cyan', 'arrow-repeat')} Repository Schema Sync</h2><p class="small text-body-secondary">Schemas are shared across devices through the GitHub repository configured in <a href="#settings/vault">Settings → Secret Vault</a>. Synchronization, validation and recovery live in <a href="#settings/schema-management">Settings → Schema Management</a>.</p><a class="btn btn-outline-primary btn-sm" href="#settings/schema-management"><i class="bi bi-arrow-repeat me-1"></i>Open Schema Management</a></div></div>
    <div class="card mb-3"><div class="card-body"><h2 class="h6">${badge('green', 'download')} Download Current Schema</h2><div class="d-flex flex-wrap gap-2"><button class="btn btn-outline-secondary btn-sm" id="downloadCurrentJsonBtn" type="button"><i class="bi bi-filetype-json me-1"></i>Current Schema (.json)</button><button class="btn btn-outline-secondary btn-sm" id="downloadCurrentCsvBtn" type="button"><i class="bi bi-filetype-csv me-1"></i>Current Schema (.csv)</button></div></div></div>
    <div class="card mb-3"><div class="card-body"><h2 class="h6">${badge('indigo', 'magic')} Smart Schema Import Engine</h2>
      <p class="small text-body-secondary">Import a schema file (JSON or CSV). Files from any SQL Assistant version are accepted; older formats are migrated and every change is reported. The schema is validated before it is saved.</p>
      <div class="d-flex flex-wrap gap-2 align-items-center mb-2"><input class="form-control w-auto" type="file" id="updateSchemaFileInput" accept=".json,.csv"><input class="form-control form-control-sm w-auto" id="importSchemaName" placeholder="Schema name (optional)"><button class="btn btn-primary btn-sm" id="updateSchemaProcessBtn" type="button"><i class="bi bi-gear-fill me-1"></i>Process File</button><button class="btn btn-link btn-sm" id="toggleExpectedStructureBtn" type="button"><i class="bi bi-search me-1"></i>View Expected Structure</button></div>
      <div class="d-none small" id="expectedStructureBox">Expected columns (CSV): Module, Table Name, Table Description, Column Name, Column Description, Data Type, Length, Precision, Nullable, Alias, Decode, Primary Key, Foreign Key.</div>
      <div id="updateSchemaResult"></div></div></div>
    <div class="card danger-zone-card"><div class="card-body"><h2 class="h6 danger-zone-title"><i class="bi bi-exclamation-triangle-fill me-2"></i>Danger Zone</h2><p class="small text-body-secondary">Remove the active schema from this device. A backup is downloaded automatically first. (The repository copy is not changed until you publish.)</p><button class="btn btn-outline-danger btn-sm" id="deleteSchemaBtn" type="button"><i class="bi bi-trash-fill me-1"></i>Delete Current Schema</button></div></div>
  </section>
  <section class="app-view" id="view-errorrectifier">
    <h1 class="h4 builder-heading">${badge('cyan', 'magic', false)}Error Rectifier</h1>
    <div class="alert alert-warning mb-3"><i class="bi bi-shield-lock-fill me-1"></i><strong>SQL generated for review only. ${APP_NAME} does not execute database changes.</strong></div>
    <div class="builder-row mb-3">
      <div class="builder-col-half"><div class="card h-100"><div class="card-body"><h2 class="h6">${badge('red', 'exclamation-octagon-fill')} Enter Database Error</h2><textarea class="form-control" id="errErrorInput" rows="6" placeholder="Example: ORA-00932: inconsistent datatypes: expected CHAR got NUMBER"></textarea></div></div></div>
      <div class="builder-col-half"><div class="card h-100"><div class="card-body"><h2 class="h6">${badge('blue', 'code-square')} Enter Current SQL Query</h2><textarea class="form-control font-monospace" id="errSqlInput" rows="6" placeholder="SELECT LOGIN_TYPE, CASE WHEN LOGIN_TYPE = 0 THEN 'Forms' ELSE LOGIN_TYPE END AS LOGIN_TYPE FROM ADM_USER_DATA;"></textarea></div></div></div>
    </div>
    <div class="tab-action-bar" style="border-radius:.5rem;border:1px solid var(--sqla-border);"><div class="d-flex flex-wrap gap-2 align-items-center"><label class="small text-body-secondary mb-0" for="errDialectSel">SQL dialect</label><select class="form-select form-select-sm w-auto" id="errDialectSel">${dialects}</select><span class="text-body-secondary tab-action-hint">Auto-detected from the pasted error where possible.</span></div><button class="btn btn-primary btn-sm" id="errRectifyBtn" type="button"><i class="bi bi-magic me-1"></i>Rectify SQL</button></div>
    <div class="card mt-3"><div class="card-body"><h2 class="h6">${badge('green', 'code-slash')} Rectified SQL</h2><div id="errRectifiedSqlBody"><p class="text-body-secondary small mb-0">Paste a database error and the SQL that produced it above, then click Rectify SQL.</p></div></div></div>
    <div class="card mt-3"><div class="card-body"><h2 class="h6">${badge('purple', 'lightbulb-fill')} Explanation</h2><div id="errExplanationBody"><p class="text-body-secondary small mb-0">The error identified and the correction applied will be explained here.</p></div></div></div>
  </section>
  <section class="app-view" id="view-settings">
    ${strip('sharedSchemaStripSettings')}
    <h1 class="h4 builder-heading">${badge('dark', 'gear-fill', false)}Settings</h1>
    <ul class="nav nav-tabs flex-wrap" id="settingsTabs">
      <li class="nav-item"><a class="nav-link" data-settings-tab="schema-management" href="#settings/schema-management"><i class="bi bi-hdd-stack me-1"></i>Schema Management</a></li>
      <li class="nav-item"><a class="nav-link" data-settings-tab="manual-update" href="#settings/manual-update"><i class="bi bi-pencil-square me-1"></i>Manual Schema Update</a></li>
      <li class="nav-item"><a class="nav-link" data-settings-tab="vault" href="#settings/vault"><i class="bi bi-shield-lock me-1"></i>Secret Vault</a></li>
      <li class="nav-item"><a class="nav-link" data-settings-tab="ai" href="#settings/ai"><i class="bi bi-cpu me-1"></i>AI/LLM Model</a></li></ul>
    <div class="tab-content-wrap" id="settingsBody"></div>
  </section>
</div>
<footer class="text-center py-4 text-body-secondary small"><div>${APP_NAME} · Version ${version}</div>
  <div class="creator-signature-wrap d-flex flex-column align-items-center mt-1"><div><span class="creator-signature-label">Crafted by</span> <span class="creator-signature">Subham Ain</span></div><svg class="creator-signature-flourish" width="92" height="10" viewBox="0 0 86 10" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 6 C 20 -2, 34 12, 50 4 S 78 -2, 84 6" fill="none" stroke-width="2" stroke-linecap="round"/></svg></div></footer>
<div class="modal fade" id="aboutModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h5 class="modal-title d-flex align-items-center gap-2">${badge('gray', 'info-circle-fill')}About ${APP_NAME}</h5><button class="btn-close" data-bs-dismiss="modal" type="button"></button></div><div class="modal-body"><ul class="list-group list-group-flush" id="aboutList"></ul></div></div></div></div>
<div class="modal fade" id="muEditModal" tabindex="-1"><div class="modal-dialog modal-lg"><div class="modal-content"><div class="modal-header"><h5 class="modal-title" id="muEditTitle">Edit row</h5><button class="btn-close" data-bs-dismiss="modal" type="button"></button></div><div class="modal-body" id="muEditBody"></div>
  <div class="modal-footer"><span class="small text-body-secondary me-auto" id="muEditHint"></span><button class="btn btn-outline-secondary btn-sm" id="muResetBtn" type="button"><i class="bi bi-arrow-counterclockwise me-1"></i>Reset</button><button class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal" type="button">Cancel</button><button class="btn btn-primary btn-sm" id="muSaveBtn" type="button" disabled><i class="bi bi-check2-circle me-1"></i>Save</button></div></div></div></div>
<div id="tourOverlay"><div id="tourSpotlight"></div><div id="tourPopup"><div class="small text-body-secondary mb-1" id="tourStepLabel"></div><h3 class="h6" id="tourTitle"></h3><div id="tourBody" class="small"></div><div class="d-flex justify-content-end gap-2 mt-2"><button class="btn btn-outline-secondary btn-sm" id="tourPrev" type="button">Back</button><button class="btn btn-primary btn-sm" id="tourNext" type="button">Next</button><button class="btn btn-link btn-sm" id="tourSkip" type="button">Skip</button></div></div></div>
<div id="toastHost" aria-live="polite"></div>`;
}
