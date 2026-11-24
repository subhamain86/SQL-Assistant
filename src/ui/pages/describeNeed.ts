/**
 * V17.7.2 — Hamburger → Describe What You Need – Read Only Query Builder  /  Describe What You Need – Query Builder for CR.
 *
 * Two separate cards per page:  Card 1 "Describe What You Need (optional)" (the plain-English description)  ·  Card 2 "Result" (the generated SQL).
 * The Result card has explicit states — idle · loading · success · needs review · error — and a statement is shown as a SUCCESS only when src/v17/engines/nlAssessment.ts says that the SQL
 * covers the description and passed validation against the Active Schema. A description the engine cannot turn into trustworthy SQL produces an error with reasons (and, where possible,
 * real tables of the Active Schema that look related) — never a placeholder comment, never a silently smaller query.
 *
 * Independence: this page owns its own state. The Read Only description is generated with { independent: true } (no Manual Selector state, no manual-override markers, no context tables),
 * and the CR description is parsed into a private CrQueryState. Nothing from here changes the Manual Selectors unless the user selects "Open in Query Builder" (a one-way hand-over).
 * Schemas: both workflows read the Active Schema through services().schemas.active() at the moment of the request and remember which schema produced the result; a result whose schema is no
 * longer the Active Schema is flagged as stale. The CR workflow never calls the Read Only engine (and vice versa).
 */
import { icon } from '../components/icons'; import { renderSqlCodeBlock } from '../components/sqlCodeBlock'; import { openModal } from '../components/modal';
import { store, type Route } from '../state'; import { services, aiConfig, secrets } from '../context'; import { e, copyText } from '../dom';
import { generateFromDescription, type OrchestratedResult } from '../../v17/services/queryOrchestrator'; import { emptyReadOnly, importDescribedQuery } from './readonly'; import { importDescribedCr } from './other';
import { trackFeature, trackGeneration } from '../analyticsRuntime'; import { buildCrSQL, parseCrDescription } from '../../engines/crEngine'; import { validateCrState } from '../../engines/validationEngine';
import { assessCr, type NlAssessment } from '../../v17/engines/nlAssessment'; import { summarizeValidation, validateFinalQuery, type FullValidation } from '../../v17/engines/queryValidator'; import { TIER_LABEL, type LearnTier } from '../../v17/services/learningStore';
import { formatSql } from '../../utils/sqlFormat'; import { containsSecret } from '../../v17/errors/appErrors';
import type { Dialect, SchemaModel, CrQueryState } from '../../types';
const DIALECTS: Dialect[] = ['SQL Server', 'Oracle', 'PostgreSQL', 'MySQL', 'Generic'];
export const MAX_DESCRIPTION = 2000;
const schema = (): SchemaModel => services().schemas.active();
const li = (xs: string[]) => `<ul>${xs.map((x) => `<li>${e(x)}</li>`).join('')}</ul>`;
/** The state-specific banner of the Result card. Pure — exported for the tests. */
export function statusBoxHtml(a: NlAssessment): string {
  if (a.status === 'success') return `<div class="issue-box ok mini" role="status" data-result-status="success" style="margin:0 0 .75rem">${icon('check', 14)}<div><strong>Success</strong> — ${e(a.headline)}</div></div>`;
  if (a.status === 'review') return `<div class="issue-box warn mini" role="status" data-result-status="review" style="margin:0 0 .75rem">${icon('alert-triangle', 14)}<div><strong>Needs review</strong> — ${e(a.headline)}${a.warnings.length ? li(a.warnings) : ''}</div></div>`;
  return `<div class="issue-box mini" role="alert" data-result-status="error" style="margin:0 0 .75rem">${icon('alert-triangle', 14)}<div><strong>No SQL generated</strong> — ${e(a.headline)}${a.errors.length > 1 ? li(a.errors.slice(1)) : ''}${a.suggestions.length ? `<div class="hint">Tables of the Active Schema that may be what you mean: ${a.suggestions.map((s) => `<code>${e(s)}</code>`).join(', ')}. Use their names in the description.</div>` : ''}<div class="hint">What you can do: rephrase the description with table or column names from the Active Schema (Schema in the menu lists them), or use the Manual Selectors — they are not affected.</div></div></div>`;
}
const loadingHtml = (what: string) => `<div class="issue-box ok mini" role="status" aria-live="polite" data-result-status="loading"><span style="display:inline-flex;animation:sqla-spin 1s linear infinite">${icon('refresh', 14)}</span><div><strong>${e(what)}</strong> — checking it against the Active Schema…</div></div>`;
const staleHtml = (was: string, now: string) => `<div class="issue-box warn mini" role="status" data-result-stale>${icon('alert-triangle', 14)}<div>The Active Schema changed after this SQL was generated (generated for <strong>${e(was)}</strong>, now <strong>${e(now)}</strong>). Select <em>Regenerate</em> before using it.</div></div>`;
const validationHtml = (v: FullValidation | null, open: boolean) => !v ? '' : `<div class="issue-box ${v.valid ? 'ok' : ''} mini">${icon(v.valid ? 'check' : 'alert-triangle', 14)} ${v.valid ? 'SQL passed validation' : 'SQL needs attention'} — ${e(summarizeValidation(v))}</div><details ${open ? 'open' : ''} data-checks><summary>What was checked</summary><ul class="check-list">${v.checks.map((c) => `<li><span class="ck ck-${c.status}">${c.status === 'pass' ? '✔' : c.status === 'warn' ? '!' : '✖'}</span><span>${e(c.label)}${c.details.map((d) => `<span class="why">${e(d)}</span>`).join('')}</span></li>`).join('')}</ul></details>`;
const descriptionProblem = (text: string): string | null => { const t = text.trim(); if (!t) return 'Enter a description of what you need first.'; if (t.length > MAX_DESCRIPTION) return `The description is ${t.length} characters long — the limit is ${MAX_DESCRIPTION}.`; if (containsSecret(t)) return 'The description looks like it contains a credential (token, password or key). Remove it and try again.'; return null; };
const afterPaint = (fn: () => void) => { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(fn, 0)); else setTimeout(fn, 0); };
const errorAssessment = (msg: string, suggestions: string[] = []): NlAssessment => ({ status: 'error', headline: msg, errors: [msg], warnings: [], unreflected: [], droppedTables: [], suggestions });

// ══════════════════════════════════════════════ Read Only
interface RoState { text: string; dialect: Dialect; phase: 'idle' | 'loading' | 'done' | 'failed'; res: OrchestratedResult | null; problem: NlAssessment | null; schemaId: string; schemaName: string; schemaVersion: string; failure: string; formatted: boolean; run: number; checksOpen: boolean; }
const ro: RoState = { text: '', dialect: 'Oracle', phase: 'idle', res: null, problem: null, schemaId: '', schemaName: '', schemaVersion: '', failure: '', formatted: false, run: 0, checksOpen: false };
export function renderDescribeReadOnlyPage(container: HTMLElement, navigate?: (r: Route) => void): void {
  const q = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel);
  container.innerHTML = `<div class="page"><h1 class="page-title">${icon('sparkles')} Describe What You Need — Read Only Query Builder</h1><p class="page-subtitle">Describe the data you need in plain English. The SQL is built only from tables, columns and relationships of the Active Schema and is checked before it is shown. This page is independent of the Manual Selectors.</p>
    <div class="builder-panel" data-tour="describe-card" id="nlDescribeCard"><h2>${icon('sparkles', 16)} Describe What You Need (optional)</h2><textarea id="nlDesc" rows="5" maxlength="${MAX_DESCRIPTION + 200}" aria-label="Describe What You Need" placeholder="e.g. Top 5 vendors by total invoice amount for approved invoices this year">${e(ro.text)}</textarea><label class="inline-label">SQL dialect<select id="dialectSelect">${DIALECTS.map((d) => `<option ${d === ro.dialect ? 'selected' : ''}>${d}</option>`).join('')}</select></label><div class="row-actions"><button type="button" id="nlBuildBtn" class="btn btn-primary">${icon('zap', 15)} Build from Description</button></div><div class="schema-audit-line" id="nlSchemaLine"></div></div>
    <div class="builder-panel manual-selectors-panel" id="nlResultCard"><h2>${icon('code', 16)} Result</h2><div id="nlResult" aria-live="polite"></div></div></div>`;
  const activeLine = () => { const s = schema(); const l = q('#nlSchemaLine'); if (l) l.innerHTML = `${icon('database', 12)} Active Schema used: ${e(s.name)} (v${e(String(s.version))}) · ${s.tables.length} table(s)`; };
  const shown = (): string => { const raw = ro.res?.state.generatedSql || ''; return ro.formatted ? formatSql(raw) : raw; };
  function notesHtml(r: OrchestratedResult, s: SchemaModel): string {
    const badge = r.engine === 'online' ? `<span class="engine-badge engine-online">${icon('bot', 13)} Offline NLU + AI/LLM Model</span>` : `<span class="engine-badge engine-offline">${icon('wifi-off', 13)} Offline NLU${aiConfig.enabled ? ' — AI/LLM not needed' : ''}</span>`;
    const pu = r.requirement.patternUsed; const pat = pu ? `<div class="hint">${icon(pu.source === 'admin' ? 'shield' : 'sparkles', 12)} ${pu.source === 'admin' ? 'Admin Query Library' : `Learned query${pu.tier ? ` (${e(TIER_LABEL[pu.tier as LearnTier] || pu.tier)})` : ''}`}: <strong>${e(pu.label)}</strong> — ${Math.round(pu.similarity * 100)}% similar; ${pu.adopted.length ? `adapted: ${e(pu.adopted.join(', '))}` : 'nothing needed to be adapted'}.</div>` : '';
    const plan = r.engine === 'offline' ? r.requirement.autoOptions.map((o) => o.description) : [];
    return `<div class="notes-box"><div style="width:100%">${badge}<div class="schema-audit-line">${icon('database', 12)} Active Schema used: ${e(s.name)} (v${e(String(s.version))})</div>${pat}${plan.length ? `<strong>Query Plan</strong><ul class="plan-list">${plan.map((p) => `<li>${e(p)}</li>`).join('')}</ul>` : ''}${r.requirement.notes.length ? `<strong>Notes</strong><ul>${r.requirement.notes.map((n) => `<li>${e(n)}</li>`).join('')}</ul>` : ''}${r.onlineNote ? `<div class="hint">${icon('bot', 12)} AI/LLM Model: ${e(r.onlineNote)}</div>` : ''}<details class="mt"><summary class="hint">How this was resolved</summary><ol class="trace-list">${r.trace.map((t) => `<li>${e(t)}</li>`).join('')}</ol></details></div></div>`;
  }
  function draw(): void {
    activeLine(); const host = q('#nlResult'); if (!host) return; const busy = ro.phase === 'loading'; const b = q<HTMLButtonElement>('#nlBuildBtn'); if (b) { b.disabled = busy; b.setAttribute('aria-busy', String(busy)); b.innerHTML = busy ? `${icon('zap', 15)} Processing…` : `${icon('zap', 15)} Build from Description`; }
    if (ro.phase === 'idle') { host.innerHTML = '<p class="hint" data-result-status="idle">The generated SQL appears here after you select <em>Build from Description</em>.</p>'; return; }
    if (ro.phase === 'loading') { host.innerHTML = loadingHtml('Generating SQL'); return; }
    if (ro.phase === 'failed') { host.innerHTML = `<div class="issue-box mini" role="alert" data-result-status="error">${icon('alert-triangle', 14)}<div><strong>The description could not be turned into SQL.</strong><br>Why: ${e(ro.failure)}<br>What you can do: rephrase the description with table or column names from the Active Schema, then select Regenerate — or use the Manual Selectors, they are not affected.</div></div><div class="row-actions"><button type="button" class="btn btn-outline btn-sm" id="nlRetryBtn">${icon('refresh', 14)} Regenerate</button></div>`; q('#nlRetryBtn')?.addEventListener('click', () => { void run(); }); return; }
    if (ro.problem) { host.innerHTML = `${statusBoxHtml(ro.problem)}<div class="row-actions"><button type="button" class="btn btn-outline btn-sm" id="nlRetryBtn">${icon('refresh', 14)} Regenerate</button></div>`; q('#nlRetryBtn')?.addEventListener('click', () => { void run(); }); return; }
    const r = ro.res!; const a = r.assessment; const s = schema(); const stale = ro.schemaId !== s.id;
    host.innerHTML = `${stale ? staleHtml(ro.schemaName, s.name) : ''}${statusBoxHtml(a)}${a.status === 'error' ? '' : '<div id="nlSqlMount"></div>'}<div id="nlDetails">${notesHtml(r, { ...s, name: ro.schemaName, version: ro.schemaVersion } as SchemaModel)}</div>`;
    if (a.status === 'error') { host.insertAdjacentHTML('beforeend', `<div class="row-actions"><button type="button" class="btn btn-outline btn-sm" id="nlRetryBtn">${icon('refresh', 14)} Regenerate</button></div>`); q('#nlRetryBtn')?.addEventListener('click', () => { void run(); }); return; }
    const m = q<HTMLElement>('#nlSqlMount')!;
    renderSqlCodeBlock(m, shown(), {
      onCopy: () => { trackFeature('copy-sql'); void copyText(shown()).then(() => store.pushToast('success', 'SQL copied to clipboard.')); },
      onClear: () => { ro.phase = 'idle'; ro.res = null; ro.problem = null; draw(); },
      onValidate: () => { ro.checksOpen = true; renderChecks(); },
      onRegenerate: () => { void run(); }
    }, [{ id: 'btnFormatSql', label: ro.formatted ? 'Original layout' : 'Format SQL', iconName: 'wand', onClick: () => { ro.formatted = !ro.formatted; draw(); } },
      { id: 'btnAcceptLearn', label: 'Accept & Learn', iconName: 'check', onClick: acceptLearn }, { id: 'btnReportIssue', label: 'Report issue', iconName: 'alert-triangle', onClick: reportIssue },
      ...(r.engine === 'offline' ? [{ id: 'btnOpenBuilder', label: 'Open in Query Builder', iconName: 'table' as const, onClick: () => { importDescribedQuery(r.state, r.requirement); store.pushToast('info', 'The query was opened in the Read Only Query Builder (Manual Selectors).'); navigate?.('readonly'); } }] : [])]);
    renderChecks();
  }
  function renderChecks(): void { const v = q<HTMLElement>('#validationMount'); if (!v || !ro.res) return; v.innerHTML = validationHtml(ro.res.validation, ro.checksOpen); v.querySelector('[data-checks]')?.addEventListener('toggle', (ev) => { ro.checksOpen = (ev.target as HTMLDetailsElement).open; }); }
  async function run(): Promise<void> {
    if (ro.phase === 'loading') return; const text = ro.text.trim(); const bad = descriptionProblem(text); const s = schema(); const id = ++ro.run;
    ro.res = null; ro.problem = null; ro.failure = ''; ro.checksOpen = false;
    if (bad) { ro.phase = 'done'; ro.problem = errorAssessment(bad); draw(); return; }
    if (!s.tables.length) { ro.phase = 'done'; ro.problem = errorAssessment('The Active Schema has no tables. Pull or import a schema first (GitHub Repository / Schema in the menu).'); draw(); return; }
    ro.phase = 'loading'; draw(); await new Promise<void>((res) => afterPaint(res));
    try {
      const r = await generateFromDescription(text, emptyReadOnly(ro.dialect), s, ro.dialect, services().learning, aiConfig.enabled ? { config: aiConfig, apiKey: secrets.aiApiKey } : null, services().admin, { independent: true });
      if (id !== ro.run) return; trackGeneration('describe-read-only', r.assessment.status !== 'error', r.assessment.status === 'review'); /* V17.7.3 usage analytics: only the outcome, never the SQL */ ro.res = r; ro.schemaId = s.id; ro.schemaName = s.name; ro.schemaVersion = String(s.version); ro.phase = 'done';
    } catch (err) { if (id !== ro.run) return; trackGeneration('describe-read-only', false); ro.phase = 'failed'; ro.failure = (err as Error)?.message || 'an unexpected internal error occurred'; }
    if (container.isConnected) draw();
  }
  function acceptLearn(): void {
    const r = ro.res; if (!r) return; const s = schema(); const text = ro.text.trim();
    const md = openModal(`${icon('check', 18)} Accept &amp; Learn`, `<p class="hint">Review or adjust the SQL, then accept it. Accepted queries are validated against the Active Schema <strong>${e(s.name)}</strong>. Unchanged SQL becomes <em>confirmed</em>, edited SQL becomes <em>modified &amp; confirmed</em>, and SQL you report as having run successfully becomes the strongest learned pattern.</p><label class="block-label">Final SQL<textarea id="v17AcceptSql" rows="12" spellcheck="false" style="font-family:'Cascadia Code',Consolas,monospace;font-size:12.5px">${e(r.state.generatedSql)}</textarea></label><label class="block-label">Result when you ran it<select id="v17AcceptResult"><option value="unknown">Not run yet</option><option value="success">Ran successfully (correct result)</option><option value="failed">Failed or gave a wrong result</option></select></label><label class="block-label">Feedback (optional)<input type="text" id="v17AcceptNote" maxlength="300" placeholder="e.g. exactly what I needed"></label><div id="v17AcceptErrors"></div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="v17AcceptCancel">Cancel</button><button type="button" class="btn btn-primary" id="v17AcceptOk">${icon('check', 14)} Accept &amp; Learn</button></div>`, { wide: true, closeOnBackdrop: false });
    md.element.querySelector('#v17AcceptCancel')!.addEventListener('click', () => md.close());
    md.element.querySelector('#v17AcceptOk')!.addEventListener('click', () => {
      const sql = (md.element.querySelector('#v17AcceptSql') as HTMLTextAreaElement).value.trim(); const result = (md.element.querySelector('#v17AcceptResult') as HTMLSelectElement).value as 'unknown' | 'success' | 'failed'; const note = (md.element.querySelector('#v17AcceptNote') as HTMLInputElement).value;
      {
        const v = validateFinalQuery(sql, s, ro.dialect, { state: { ...r.state, generatedSql: sql } });
        if (!v.valid || !/\bSELECT\b/i.test(sql)) { md.element.querySelector('#v17AcceptErrors')!.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)}<div><strong>This SQL cannot be accepted.</strong><br>Where: Accept &amp; Learn → validation against the Active Schema<br>Why: ${e(v.errors.slice(0, 4).join(' ') || 'No SELECT statement was found.')}<br>What you can do: correct the SQL above (or use Report issue if the generated SQL was wrong) and accept again.</div></div>`; return; }
        const modified = sql.replace(/\s+/g, ' ') !== r.state.generatedSql.replace(/\s+/g, ' ');
        const ok = text ? services().learning.confirm(text, s, sql, modified ? sql : null, { resultStatus: result, feedback: result === 'success' ? 'positive' : result === 'failed' ? 'negative' : 'none', feedbackNote: note, dialect: ro.dialect }) : false;
        trackFeature('accept-learn'); if (modified) r.state.generatedSql = sql; md.close(); draw();
        store.pushToast(ok ? (result === 'failed' ? 'warning' : 'success') : 'info', ok ? (result === 'failed' ? 'Noted as a failed result — it will not be used as a learned pattern.' : result === 'success' ? 'Learned as a successfully executed query (strongest learned pattern).' : modified ? 'Modified SQL accepted and learned as confirmed knowledge.' : 'SQL accepted and learned as confirmed knowledge.') : 'Accepted. (Not learned: the description appears to contain a credential, or browser storage refused the write.)');
      }
    });
  }
  function reportIssue(): void {
    const text = ro.text.trim(); if (!text) { store.pushToast('info', 'Describe the requirement first — feedback is recorded against a description.'); return; }
    const md = openModal(`${icon('alert-triangle', 18)} Report an issue with this SQL`, `<p class="hint">The description and its SQL will no longer be used as a learned pattern.</p><label class="block-label">What was wrong?<select id="v17IssueKind"><option>Wrong table or column</option><option>Wrong filter or date range</option><option>Wrong grouping, total or sorting</option><option>The SQL failed when I ran it</option><option>Other</option></select></label><label class="block-label">Details (optional)<input type="text" id="v17IssueNote" maxlength="300"></label><div class="modal-actions"><button type="button" class="btn btn-ghost" id="v17IssueCancel">Cancel</button><button type="button" class="btn btn-primary" id="v17IssueOk">Report</button></div>`, { closeOnBackdrop: false });
    md.element.querySelector('#v17IssueCancel')!.addEventListener('click', () => md.close());
    md.element.querySelector('#v17IssueOk')!.addEventListener('click', () => { const kind = (md.element.querySelector('#v17IssueKind') as HTMLSelectElement).value; const note = (md.element.querySelector('#v17IssueNote') as HTMLInputElement).value; const ok = services().learning.setFeedback(text, schema(), 'negative', `${kind}${note ? ` — ${note}` : ''}`, /failed/.test(kind)); md.close(); store.pushToast(ok ? 'success' : 'info', ok ? 'Thank you — this result will not be used as a learned pattern.' : 'Nothing to demote: this description has not been learned on this device.'); });
  }
  q('#nlDesc')!.addEventListener('input', (ev) => { ro.text = (ev.target as HTMLTextAreaElement).value; });
  q('#nlDesc')!.addEventListener('keydown', (ev) => { const k = ev as KeyboardEvent; if (k.key === 'Enter' && (k.ctrlKey || k.metaKey)) { k.preventDefault(); void run(); } });
  q('#dialectSelect')!.addEventListener('change', (ev) => { ro.dialect = (ev.target as HTMLSelectElement).value as Dialect; });
  q('#nlBuildBtn')!.addEventListener('click', () => { void run(); });
  if (ro.phase === 'loading') ro.phase = 'idle'; // a page that was left while a request ran starts from a clean state (the late answer is ignored by the run counter)
  draw();
}

// ══════════════════════════════════════════════ Query Builder for CR
interface CrNl { text: string; phase: 'idle' | 'loading' | 'done'; parsed: ReturnType<typeof parseCrDescription> | null; state: CrQueryState | null; assessment: NlAssessment | null; schemaId: string; schemaName: string; formatted: boolean; run: number; }
const crn: CrNl = { text: '', phase: 'idle', parsed: null, state: null, assessment: null, schemaId: '', schemaName: '', formatted: false, run: 0 };
export function renderDescribeCrPage(container: HTMLElement, navigate?: (r: Route) => void): void {
  const q = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel);
  container.innerHTML = `<div class="page"><h1 class="page-title">${icon('sparkles')} Describe What You Need — Query Builder for CR</h1><p class="page-subtitle">Describe the change in plain English, for example “Update vendor name to Acme Corp where vendor id = 5”. INSERT / UPDATE / DELETE SQL is built only from tables and columns of the Active Schema; UPDATE and DELETE always need a WHERE condition. Nothing is executed. This page is independent of the Manual Selectors.</p>
    <div class="builder-panel" data-tour="describe-card" id="nlDescribeCard"><h2>${icon('sparkles', 16)} Describe What You Need (optional)</h2><textarea id="crNlDesc" rows="5" maxlength="${MAX_DESCRIPTION + 200}" aria-label="Describe What You Need" placeholder="e.g. Update invoice 1234 status to Approved">${e(crn.text)}</textarea><div class="row-actions"><button type="button" id="crNlBuildBtn" class="btn btn-primary">${icon('zap', 15)} Build from Description</button></div><div class="schema-audit-line" id="crNlSchemaLine"></div></div>
    <div class="builder-panel manual-selectors-panel" id="crNlResultCard"><h2>${icon('code', 16)} Result</h2><div id="crNlResult" aria-live="polite"></div></div></div>`;
  const shown = (): string => { const raw = crn.state?.generatedSql || ''; return crn.formatted ? formatSql(raw) : raw; };
  function detailsHtml(s: string): string {
    const p = crn.parsed!; const st = crn.state!;
    return `<div class="notes-box"><div style="width:100%"><span class="engine-badge engine-offline">${icon('wifi-off', 13)} Offline/local engine</span><div class="schema-audit-line">${icon('database', 12)} Active Schema used: ${e(s)}</div><ul>${p.notes.map((n) => `<li>${e(n)}</li>`).join('')}${st.values.length ? `<li>${st.queryType === 'INSERT' ? 'VALUES' : 'SET'}: ${e(st.values.map((v) => `${v.column} = ${v.value}`).join(', '))}</li>` : ''}${st.queryType !== 'INSERT' ? (st.filters.length ? `<li>WHERE: ${e(st.filters.map((f) => `${f.column} ${f.operator} ${f.value}`).join(' AND '))}</li>` : '<li>No WHERE condition detected — add one in the description (for example “where vendor id = 5”).</li>') : ''}</ul></div></div>`;
  }
  function draw(): void {
    const s = schema(); const sl = q('#crNlSchemaLine'); if (sl) sl.innerHTML = `${icon('database', 12)} Active Schema used: ${e(s.name)} (v${e(String(s.version))}) · ${s.tables.length} table(s)`;
    const host = q('#crNlResult'); if (!host) return; const busy = crn.phase === 'loading'; const b = q<HTMLButtonElement>('#crNlBuildBtn'); if (b) { b.disabled = busy; b.setAttribute('aria-busy', String(busy)); b.innerHTML = busy ? `${icon('zap', 15)} Processing…` : `${icon('zap', 15)} Build from Description`; }
    if (crn.phase === 'idle') { host.innerHTML = '<p class="hint" data-result-status="idle">The generated statement appears here after you select <em>Build from Description</em>.</p>'; return; }
    if (crn.phase === 'loading') { host.innerHTML = loadingHtml('Generating SQL'); return; }
    const a = crn.assessment!; const stale = crn.schemaId !== s.id;
    host.innerHTML = `${stale ? staleHtml(crn.schemaName, s.name) : ''}${statusBoxHtml(a)}${a.status === 'error' ? '' : '<div id="crNlSqlMount"></div>'}${crn.parsed ? `<div id="crNlDetails">${detailsHtml(crn.schemaName)}</div>` : ''}`;
    if (a.status === 'error') { host.insertAdjacentHTML('beforeend', `<div class="row-actions"><button type="button" class="btn btn-outline btn-sm" id="crNlRetryBtn">${icon('refresh', 14)} Regenerate</button></div>`); q('#crNlRetryBtn')?.addEventListener('click', () => { void run(); }); return; }
    const st = crn.state!;
    renderSqlCodeBlock(q<HTMLElement>('#crNlSqlMount')!, shown(), {
      onCopy: () => { trackFeature('copy-sql'); void copyText(shown()).then(() => store.pushToast('success', 'SQL copied to clipboard.')); },
      onClear: () => { crn.phase = 'idle'; crn.parsed = null; crn.state = null; crn.assessment = null; draw(); },
      onRegenerate: () => { void run(); }
    }, [{ id: 'btnFormatSql', label: crn.formatted ? 'Original layout' : 'Format SQL', iconName: 'wand', onClick: () => { crn.formatted = !crn.formatted; draw(); } },
      { id: 'btnOpenBuilder', label: 'Open in Query Builder for CR', iconName: 'edit', onClick: () => { if (!st.table) return; importDescribedCr({ queryType: st.queryType, table: st.table, values: st.values, filters: st.filters, text: crn.text.trim() }); store.pushToast('info', 'The statement was opened in Query Builder for CR (Manual Selectors).'); navigate?.('cr'); } }]);
  }
  async function run(): Promise<void> {
    if (crn.phase === 'loading') return; const text = crn.text.trim(); const bad = descriptionProblem(text); const s = schema(); const id = ++crn.run;
    crn.parsed = null; crn.state = null; crn.assessment = null; crn.schemaId = s.id; crn.schemaName = s.name;
    if (bad) { crn.phase = 'done'; crn.assessment = errorAssessment(bad); draw(); return; }
    if (!s.tables.length) { crn.phase = 'done'; crn.assessment = errorAssessment('The Active Schema has no tables. Pull or import a schema first (GitHub Repository / Schema in the menu).'); draw(); return; }
    crn.phase = 'loading'; draw(); await new Promise<void>((res) => afterPaint(res)); if (id !== crn.run) return;
    try {
      const p = parseCrDescription(text, s); const st: CrQueryState = { dialect: 'Oracle', naturalLanguageText: text, queryType: p.queryType || 'UPDATE', table: p.table, values: p.values, filters: p.filters, confirmNoWhere: false, generatedSql: '' };
      st.generatedSql = p.queryType && p.table ? buildCrSQL(st) : ''; let a = assessCr(text, s, p, st.generatedSql);
      if (a.status !== 'error') { const issues = validateCrState(st); const errs = issues.filter((x) => x.severity === 'error').map((x) => x.message); const warns = issues.filter((x) => x.severity !== 'error').map((x) => x.message); if (errs.length) a = { ...a, status: 'error', errors: errs, headline: errs[0] }; else if (warns.length) a = { ...a, status: 'review', warnings: [...a.warnings, ...warns], headline: 'Statement generated, but part of the description was not used — review it before use.' }; }
      crn.parsed = p; crn.state = st; crn.assessment = a; trackGeneration('describe-cr', a.status !== 'error', a.status === 'review'); /* V17.7.3 usage analytics: only the outcome, never the SQL */
    } catch (err) { trackGeneration('describe-cr', false); crn.assessment = errorAssessment(`The description could not be turned into SQL: ${(err as Error)?.message || 'an unexpected internal error occurred'}.`); }
    crn.phase = 'done'; if (container.isConnected) draw();
  }
  q('#crNlDesc')!.addEventListener('input', (ev) => { crn.text = (ev.target as HTMLTextAreaElement).value; });
  q('#crNlDesc')!.addEventListener('keydown', (ev) => { const k = ev as KeyboardEvent; if (k.key === 'Enter' && (k.ctrlKey || k.metaKey)) { k.preventDefault(); void run(); } });
  q('#crNlBuildBtn')!.addEventListener('click', () => { void run(); });
  if (crn.phase === 'loading') crn.phase = 'idle';
  draw();
}
