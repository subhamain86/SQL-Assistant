/**
 * V17.7.3 / V17.7.4 — Hamburger → Analytics → Administrator Authentication → Usage Analytics dashboard.
 *
 * The menu entry is visible to everybody; the page is not. Selecting it opens the Administrator Authentication dialog; until the analytics service accepted the administrator password NOTHING of the
 * dashboard is requested, rendered or cached — a wrong password shows only "Invalid administrator password". The password is checked by the service (never by this page), it is not shown, not kept after the
 * attempt and not written anywhere; the resulting session lives in memory (analyticsRuntime.ts) and ends with Lock Analytics, the inactivity period, a reload, or a password change.
 *
 * The dashboard shows aggregates only (no per-user list exists in the service): KPI cards, the daily / weekly / monthly utilization, the usage trend, the most-used features and the application versions,
 * for a date range chosen here. Usage METADATA only is ever collected — see the privacy panel on this page and docs/ANALYTICS.md.
 * V17.7.4: with the serverless provider ("repository") the same dialog unwraps the administrator key with the password and the data is decrypted in this browser (docs/ANALYTICS_SERVERLESS.md); the first-time Set up, Rotate keys
 * and Compact live in analyticsRepoPanel.ts.
 */
import { icon } from '../components/icons'; import { openModal, type ModalHandle } from '../components/modal'; import { renderTabs } from '../components/tabs'; import { store } from '../state'; import { e } from '../dom';
import { openSetupWizard, renderRepositoryAdminExtras } from './analyticsRepoPanel';
import { analyticsProvider, analyticsAvailability, unlockAnalytics, lockAnalytics, isAnalyticsUnlocked, fetchAnalyticsSummary, changeAnalyticsPassword, analyticsPasswordManaged, analyticsLockSeconds, onAnalyticsChange, refreshAnalyticsConfig, LOCK_MESSAGES, lastLockReason } from '../analyticsRuntime';
import { fmtInt, fmtRate, fmtDuration, presetRange, rangeProblem, utcToday, RANGE_LABELS, trendRows, trendSvg, utilizationTable, rankingBars, featureLabel, type RangePreset } from '../../v17/services/analyticsView';
import type { AnalyticsSummary } from '../../v17/services/analyticsAdmin';

export const ANALYTICS_RELEASE_NOTE = 'V17.7.3 introduces optional Usage Analytics for measuring SQL Assistant adoption and utilization. The Analytics dashboard is available from the hamburger menu and protected by centralized administrator authentication. Analytics capture usage metadata only and do not capture SQL content, credentials, database results, or customer data.';
export const ANALYTICS_RELEASE_NOTE_1774 = 'V17.7.4 makes Usage Analytics deployable without a server or cloud credentials. Analytics data is encrypted on the device and can be read only in the Analytics dashboard after administrator authentication. SQL Assistant continues to capture usage metadata only and does not capture SQL content, credentials, database results, or customer data.';
const box = (kind: 'ok' | 'warn' | 'err', html: string): string => `<div class="issue-box ${kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : ''} mini" role="${kind === 'err' ? 'alert' : 'status'}">${icon(kind === 'ok' ? 'check' : 'alert-triangle', 14)}<div>${html}</div></div>`;

// page state that survives a re-render (never the password, never the token — only the chosen range and the last numbers while unlocked)
let preset: RangePreset = '30d'; let customFrom = ''; let customTo = ''; let data: AnalyticsSummary | null = null; let loading = false; let loadError = ''; let loadedAt = ''; let loadId = 0; let utilTab = 'daily';
let authModal: ModalHandle | null = null; let unsubscribe: (() => void) | null = null;
onAnalyticsChange(() => { if (!isAnalyticsUnlocked()) { data = null; loadError = ''; loading = false; loadedAt = ''; loadId += 1; } }); // after a lock nothing of the dashboard is kept

function currentRange(): { from: string; to: string } { const today = utcToday(); if (preset === 'custom') return { from: customFrom || presetRange('30d', today).from, to: customTo || today }; return presetRange(preset, today); }

// ───────────────────────────────────────── the Administrator Authentication dialog
function openAuthDialog(onUnlocked: () => void): void {
  if (authModal && authModal.element.isConnected) return; const a = analyticsAvailability(); const ready = a.kind === 'ready';
  const m = openModal(`${icon('lock', 18)} Administrator Authentication`, `<form id="anAuthForm" autocomplete="off" novalidate>
    <p class="hint">${ready ? 'Enter the Analytics administrator password to open the Analytics dashboard.' : 'The Analytics dashboard needs administrator authentication.'}</p>
    ${ready ? `<label class="block-label" for="anAuthPw">Administrator password<input type="password" id="anAuthPw" name="analytics-administrator" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="anAuthMsg" required></label>` : box('warn', `<span id="anAuthUnavailable">${e(a.message)}</span>`)}
    <div id="anAuthMsg" class="an-auth-msg" role="alert" aria-live="assertive"></div>
    <div class="row-actions"><button type="submit" class="btn btn-primary" id="anAuthOk" ${ready ? '' : 'disabled'}>${icon('unlock', 14)} Unlock</button><button type="button" class="btn btn-outline" id="anAuthCancel">Cancel</button></div></form>`, { id: 'analyticsAuthModal' });
  authModal = m; const root = m.element; const form = root.querySelector<HTMLFormElement>('#anAuthForm')!; const msg = root.querySelector<HTMLElement>('#anAuthMsg')!; const pw = root.querySelector<HTMLInputElement>('#anAuthPw'); let busy = false;
  root.querySelector('#anAuthCancel')!.addEventListener('click', () => { if (pw) pw.value = ''; m.close(); authModal = null; });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault(); if (busy || !pw) return; const value = pw.value; if (!value) { msg.innerHTML = box('err', 'Enter the administrator password.'); pw.focus(); return; }
    busy = true; const ok = root.querySelector<HTMLButtonElement>('#anAuthOk')!; ok.disabled = true; ok.setAttribute('aria-busy', 'true'); msg.textContent = '';
    void unlockAnalytics(value).then((r) => {
      pw.value = ''; // the password is not kept after the attempt, whatever the outcome
      if (r.ok) { m.close(); authModal = null; store.pushToast('success', 'Analytics unlocked.'); onUnlocked(); return; }
      msg.innerHTML = box('err', e(r.message) + (r.kind === 'locked' && r.retryAfterSeconds ? ` <span class="hint">(about ${Math.max(1, Math.ceil(r.retryAfterSeconds / 60))} min)</span>` : '')); pw.focus();
      if (r.kind === 'not-set-up') { msg.insertAdjacentHTML('beforeend', `<div class="row-actions"><button type="button" class="btn btn-outline btn-sm" id="anSetupBtn">${icon('key', 14)} Set up Analytics…</button></div>`); msg.querySelector('#anSetupBtn')?.addEventListener('click', () => { m.close(); authModal = null; openSetupWizard(() => undefined); /* the page stays locked: unlock with the new password */ }); }
    }).finally(() => { busy = false; if (root.isConnected) { ok.disabled = false; ok.removeAttribute('aria-busy'); } });
  });
}

// ───────────────────────────────────────── the dashboard
function kpi(id: string, label: string, value: string, sub: string): string { return `<div class="an-kpi" data-kpi="${id}"><div class="an-kpi-label">${e(label)}</div><div class="an-kpi-value" data-kpi-value>${e(value)}</div><div class="an-kpi-sub">${e(sub)}</div></div>`; }
function kpiHtml(s: AnalyticsSummary): string {
  const k = s.kpi; const ref = s.range.referenceDay;
  return [
    kpi('unique-users', 'Unique Users', fmtInt(k.uniqueUsers), `in ${s.range.from} – ${s.range.to}`), kpi('daily-active-users', 'Daily Active Users', fmtInt(k.dailyActiveUsers), `on ${ref}`), kpi('weekly-active-users', 'Weekly Active Users', fmtInt(k.weeklyActiveUsers), `7 days to ${ref}`), kpi('monthly-active-users', 'Monthly Active Users', fmtInt(k.monthlyActiveUsers), `30 days to ${ref}`),
    kpi('total-sessions', 'Total Sessions', fmtInt(k.totalSessions), 'page sessions started'), kpi('average-active-time', 'Average Active Usage Time', fmtDuration(k.averageActiveMsPerSession), `per session · ${fmtDuration(k.averageActiveMsPerUser)} per user`), kpi('total-active-time', 'Total Active Usage Time', fmtDuration(k.totalActiveMs), 'active use only — not time open'),
    kpi('queries-generated', 'SQL Queries Generated', fmtInt(k.generated), 'generation requests'), kpi('successful-generations', 'Successful Generations', fmtInt(k.successful), k.needsReview ? `${fmtInt(k.needsReview)} flagged for review` : 'valid SQL produced'), kpi('failed-generations', 'Failed Generations', fmtInt(k.failed), 'no valid SQL produced'), kpi('success-rate', 'Success Rate', fmtRate(k.successRate), 'successful ÷ generated'),
  ].join('');
}
function viewsHtml(s: AnalyticsSummary): string {
  const t = trendRows(s);
  return `<div class="builder-panel an-section" data-view="trend"><h2>${icon('history', 16)} Usage trend over time</h2>${trendSvg(t.rows, t.granularity)}</div>
    <div class="builder-panel an-section" data-view="utilization"><h2>${icon('table', 16)} Utilization</h2><div id="anUtilTabs"></div></div>
    <div class="an-two"><div class="builder-panel an-section" data-view="features"><h2>${icon('zap', 16)} Most-used SQL Assistant features</h2>${rankingBars(s.features.map((f) => ({ label: featureLabel(f.id), value: f.count })), 'uses')}</div>
    <div class="builder-panel an-section" data-view="versions"><h2>${icon('info', 16)} Application versions in use</h2>${rankingBars(s.versions.map((v) => ({ label: `V${v.version}`, value: v.sessions, sub: `${fmtInt(v.users)} user${v.users === 1 ? '' : 's'}` })), 'sessions')}</div></div>`;
}
function mountUtil(host: HTMLElement, s: AnalyticsSummary): void {
  renderTabs(host, [
    { id: 'daily', label: 'Daily utilization', render: (p) => { p.innerHTML = utilizationTable(s.daily.map((d) => ({ ...d, label: d.date })), 'Day (UTC)'); } },
    { id: 'weekly', label: 'Weekly utilization', render: (p) => { p.innerHTML = utilizationTable(s.weekly.map((w) => ({ ...w, label: `Week of ${w.weekStart}` })), 'Week (Monday start)'); } },
    { id: 'monthly', label: 'Monthly utilization', render: (p) => { p.innerHTML = utilizationTable(s.monthly.map((m) => ({ ...m, label: m.month })), 'Month (UTC)'); } },
  ], utilTab, undefined, (id) => { utilTab = id; });
}
const privacyHtml = (): string => `<div class="builder-panel an-privacy" data-an-privacy><h2>${icon('shield', 16)} What is measured — and what never is</h2><p>${e(ANALYTICS_RELEASE_NOTE_1774)}</p><p>${e(ANALYTICS_RELEASE_NOTE)}</p>
  <ul class="an-list"><li><strong>Collected:</strong> a random per-device id (so a returning user is not counted again for every session), a random session id, the application version, which feature or page was used, how many seconds SQL Assistant was actively used, and for each SQL generation only which builder was used and whether it produced valid SQL.</li>
  <li><strong>Never collected:</strong> generated SQL, SQL you typed, descriptions, database results, schema content, customer data, credentials, passwords, connection strings or any other application content.</li>
  <li><strong>Active time</strong> counts only while the tab is visible and focused and you interacted recently. It pauses in the background and after the inactivity timeout.</li>${analyticsProvider() === 'repository' ? '<li><strong>Stored encrypted:</strong> usage data is encrypted on the device before it is written to the repository; it can be read only here, after the administrator password was entered. Commit history shows which GitHub account wrote a file and when, but not what it contains.</li>' : ''}</ul></div>`;

export function renderAnalyticsPage(c: HTMLElement, _nav?: unknown): void {
  unsubscribe?.(); unsubscribe = null; let mounted = true;
  const q = <T extends HTMLElement = HTMLElement>(s: string): T | null => c.querySelector<T>(s);
  function locked(): void {
    const a = analyticsAvailability(); const why = lastLockReason(); const note = why && LOCK_MESSAGES[why] ? box('warn', e(LOCK_MESSAGES[why])) : '';
    c.innerHTML = `<div class="page an-page" data-an-state="locked"><h1 class="page-title">${icon('bar-chart')} Analytics</h1><p class="page-subtitle">Usage analytics for SQL Assistant adoption and utilization. Administrator access only.</p>
      <div class="builder-panel an-locked">${note}<h2>${icon('lock', 16)} Analytics is locked</h2><p class="hint">${a.kind === 'ready' ? 'The dashboard opens only after the Analytics administrator password was accepted.' : e(a.message)}</p>
      <div class="row-actions"><button type="button" class="btn btn-primary" id="anUnlockBtn">${icon('unlock', 14)} Unlock Analytics</button></div></div>${privacyHtml()}</div>`;
    q('#anUnlockBtn')!.addEventListener('click', () => openAuthDialog(() => { if (mounted && c.isConnected) draw(); }));
  }
  function dashboard(): void {
    const r = currentRange(); const lockMin = Math.max(1, Math.round(analyticsLockSeconds() / 60)); const lockText = analyticsLockSeconds() < 60 ? `${analyticsLockSeconds()} s` : `${lockMin} min`;
    c.innerHTML = `<div class="page an-page" data-an-state="unlocked"><h1 class="page-title">${icon('bar-chart')} Analytics</h1><p class="page-subtitle">Usage analytics for SQL Assistant adoption and utilization — usage metadata only. Days and weeks are UTC.</p>
      <div class="builder-panel an-toolbar"><div class="an-toolbar-row"><label class="block-label an-range">Date range<select id="anPreset" aria-label="Date range">${(Object.keys(RANGE_LABELS) as RangePreset[]).map((p) => `<option value="${p}" ${p === preset ? 'selected' : ''}>${RANGE_LABELS[p]}</option>`).join('')}</select></label>
        <span class="an-custom" ${preset === 'custom' ? '' : 'hidden'}><label class="block-label">From<input type="date" id="anFrom" value="${e(r.from)}"></label><label class="block-label">To<input type="date" id="anTo" value="${e(r.to)}"></label><button type="button" class="btn btn-outline btn-sm" id="anApply">Apply</button></span>
        <span class="an-spacer"></span><button type="button" class="btn btn-outline btn-sm" id="anRefresh">${icon('refresh', 14)} Refresh</button><button type="button" class="btn btn-primary btn-sm" id="anLock">${icon('lock', 14)} Lock Analytics</button></div>
        <p class="hint an-meta"><span id="anRangeMsg" role="alert"></span>Showing <strong data-range>${e(r.from)} – ${e(r.to)}</strong> · <span id="anUpdated">${loadedAt ? `updated ${e(loadedAt)}` : 'not loaded yet'}</span> · locks automatically after ${e(lockText)} without activity.</p></div>
      <div id="anBody" aria-live="polite"></div>
      <details class="builder-panel an-admin-panel" id="anAdminPanel"><summary>${icon('key', 15)} Administrator password</summary><div id="anAdminBody"></div></details>${privacyHtml()}</div>`;
    q('#anLock')!.addEventListener('click', () => { lockAnalytics('manual'); store.pushToast('info', LOCK_MESSAGES.manual); });
    q('#anRefresh')!.addEventListener('click', () => { void load(); });
    q<HTMLSelectElement>('#anPreset')!.addEventListener('change', (ev) => { preset = (ev.target as HTMLSelectElement).value as RangePreset; if (preset === 'custom') { const cur = currentRange(); customFrom = customFrom || cur.from; customTo = customTo || cur.to; q('.an-custom')!.removeAttribute('hidden'); } else { q('.an-custom')!.setAttribute('hidden', ''); void load(); } });
    q('#anApply')?.addEventListener('click', () => { customFrom = q<HTMLInputElement>('#anFrom')!.value; customTo = q<HTMLInputElement>('#anTo')!.value; const p = rangeProblem(customFrom, customTo); q('#anRangeMsg')!.innerHTML = p ? `<span class="an-range-error">${e(p)}</span> ` : ''; if (!p) void load(); });
    adminPanel(); body();
  }
  function body(): void {
    const b = q('#anBody'); if (!b) return;
    if (loading && !data) { b.innerHTML = `<div class="builder-panel"><p class="hint" role="status">Loading usage…</p></div>`; return; }
    if (loadError && !data) { b.innerHTML = `${box('err', e(loadError))}<div class="row-actions"><button type="button" class="btn btn-outline btn-sm" id="anRetry">${icon('refresh', 14)} Try again</button></div>`; q('#anRetry')?.addEventListener('click', () => { void load(); }); return; }
    if (!data) { b.innerHTML = ''; return; }
    b.innerHTML = `${loadError ? box('warn', e(loadError)) : ''}<div class="an-kpis" data-an-kpis>${kpiHtml(data)}</div>${viewsHtml(data)}`; const u = q('#anUtilTabs'); if (u) mountUtil(u, data); const up = q('#anUpdated'); if (up && loadedAt) up.textContent = `updated ${loadedAt}`; const rg = q('[data-range]'); if (rg) rg.textContent = `${data.range.from} – ${data.range.to}`; /* the range the NUMBERS are for */
  }
  function adminPanel(): void {
    const h = q('#anAdminBody'); if (!h) return;
    if (analyticsPasswordManaged()) { h.innerHTML = `<p class="hint">The administrator password is managed in the analytics service's environment (a platform secret), so it cannot be changed from here. Change it there — see docs/ANALYTICS.md. SQL Assistant never needs to be rebuilt for it.</p>`; return; }
    h.innerHTML = `<form id="anPwForm" autocomplete="off" novalidate><p class="hint">${analyticsProvider() === 'repository' ? 'Change the one centralized Analytics administrator password. The private key is wrapped again with the new password (the key pair is unchanged, so earlier data stays readable); afterwards Analytics is locked and must be unlocked with the new password.' : 'Change the one centralized Analytics administrator password. The current password is checked again by the service; after the change every administrator session ends and Analytics must be unlocked with the new password.'}</p>
      <div class="form-row-3"><label class="block-label">Current password<input type="password" id="anPwCur" autocomplete="off" spellcheck="false"></label><label class="block-label">New password (${analyticsProvider() === 'repository' ? 14 : 12} characters or more)<input type="password" id="anPwNew" autocomplete="off" spellcheck="false"></label><label class="block-label">Repeat the new password<input type="password" id="anPwNew2" autocomplete="off" spellcheck="false"></label></div>
      <div id="anPwMsg" role="alert" aria-live="assertive"></div><div class="row-actions"><button type="submit" class="btn btn-primary btn-sm" id="anPwSave">${icon('save', 14)} Change password</button></div></form>`;
    const f = q<HTMLFormElement>('#anPwForm')!; const msg = q('#anPwMsg')!; let busy = false;
    f.addEventListener('submit', (ev) => {
      ev.preventDefault(); if (busy) return; const cur = q<HTMLInputElement>('#anPwCur')!; const n1 = q<HTMLInputElement>('#anPwNew')!; const n2 = q<HTMLInputElement>('#anPwNew2')!; const clear = (): void => { cur.value = ''; n1.value = ''; n2.value = ''; };
      if (!cur.value || !n1.value) { msg.innerHTML = box('err', 'Enter the current and the new password.'); return; } if (n1.value !== n2.value) { msg.innerHTML = box('err', 'The two entries of the new password differ.'); return; }
      busy = true; const a = cur.value; const b2 = n1.value; clear(); msg.innerHTML = ''; void changeAnalyticsPassword(a, b2).then((r) => { if (r.ok) { store.pushToast('success', 'Administrator password changed. Unlock Analytics with the new password.'); return; } msg.innerHTML = box('err', e(r.kind === 'invalid' ? 'The current password is not correct.' : r.message)); }).finally(() => { busy = false; });
    });
    if (analyticsProvider() === 'repository') renderRepositoryAdminExtras(h);
  }
  async function load(): Promise<void> {
    const r = currentRange(); const p = rangeProblem(r.from, r.to); if (p) { const m = q('#anRangeMsg'); if (m) m.innerHTML = `<span class="an-range-error">${e(p)}</span> `; return; }
    const my = ++loadId; loading = true; loadError = ''; body();
    const res = await fetchAnalyticsSummary(r.from, r.to); if (my !== loadId || !mounted || !c.isConnected) return; loading = false;
    if (res.ok) { data = res.data; loadedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); loadError = ''; }
    else { loadError = res.message; if (res.kind === 'session') { return; } }
    body();
  }
  function draw(): void { if (!isAnalyticsUnlocked()) { locked(); return; } dashboard(); if (!data || data.range.from !== currentRange().from || data.range.to !== currentRange().to) void load(); }
  unsubscribe = onAnalyticsChange(() => { if (!c.isConnected) { mounted = false; unsubscribe?.(); unsubscribe = null; return; } draw(); });
  draw();
  // The dialog opens whenever the page is opened while locked (also when Analytics is unavailable — it then explains why); nothing of the dashboard exists until the service accepted the password.
  const showAuth = (): void => openAuthDialog(() => { if (mounted && c.isConnected) draw(); });
  if (!isAnalyticsUnlocked()) {
    showAuth(); const first = analyticsAvailability().kind;
    if (first === 'unknown' || first === 'disabled') void refreshAnalyticsConfig().then(() => { if (!mounted || !c.isConnected || isAnalyticsUnlocked() || analyticsAvailability().kind === first) return; draw(); if (authModal && authModal.element.isConnected) { authModal.close(); authModal = null; } showAuth(); }); // a transient start-up failure must not stick
  }
}
