/**
 * V17.5 — Schema → Pull Schema.
 * Workflow: validate passphrase → retrieve (existing repository connection) → decrypt → validate → compare local / remote → [Apply | Cancel] →
 * import → activate → refresh. Nothing is written locally before the user presses Apply, and Apply itself is transactional (the existing validated,
 * rolled-back registry write): a failed pull leaves the working local schema untouched.
 */
import { icon } from '../components/icons'; import { passphraseFieldHtml, wirePassphraseFields } from '../components/passphraseField'; import { store } from '../state'; import { services, secrets } from '../context'; import { e } from '../dom';
import { redactSecrets } from '../../v17/errors/appErrors'; import type { PullPreview, PullRow, PullOutcome } from '../../v17/sync/syncService';
const UNCHANGED = 'The existing local schema has not been changed.';
export const PULL_MESSAGES = {
  incorrect: `The passphrase is incorrect. ${UNCHANGED}`,
  unavailable: 'The synchronized schema could not be retrieved. Please verify the repository connection and try again.',
  decryption: `The schema could not be decrypted using the supplied passphrase. ${UNCHANGED}`,
  validation: `The synchronized schema failed validation. ${UNCHANGED}`,
  older: 'The synchronized schema is older than the current local schema and was not applied.',
  success: 'Schema pulled and validated successfully.',
  passphrase: `Schema pull failed because the passphrase could not be validated. Your existing local schema has not been changed.`,
  cancelled: `Pull cancelled. ${UNCHANGED}`,
};
type View = { html: string; preview: PullPreview | null; pass: string | null };
let view: View = { html: '', preview: null, pass: null }; let busy = false;
const box = (kind: 'ok' | 'warn' | 'err', html: string) => `<div class="issue-box ${kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : ''} mini" role="${kind === 'err' ? 'alert' : 'status'}">${icon(kind === 'ok' ? 'check' : 'alert-triangle', 14)}<div>${html}</div></div>`;
const when = (iso: string) => (iso && !Number.isNaN(Date.parse(iso)) && Date.parse(iso) > 0 ? iso.replace('T', ' ').slice(0, 16) : '—');
const KIND: Record<PullRow['kind'], string> = { add: 'New on this device — will be added', update: 'Newer in the repository — will replace the local copy', unchanged: 'Already identical', 'local-newer': 'Local copy is newer — not applied', conflict: 'Changed on both — not applied (resolve in Settings → Schema Management)' };
function problemHtml(p: NonNullable<PullPreview['problem']>): string {
  const items = p.items?.length ? `<ul>${p.items.map((i) => `<li>${e(i)}</li>`).join('')}</ul>` : '';
  switch (p.kind) {
    case 'passphrase': return box('err', `<strong>${e(PULL_MESSAGES.passphrase)}</strong><br>${e(p.detail)}`);
    case 'incorrect-passphrase': return box('err', `<strong>${e(PULL_MESSAGES.incorrect)}</strong><br>Check the passphrase with your administrator — it may have been changed — and try again.`);
    case 'decryption': return box('err', `<strong>${e(PULL_MESSAGES.decryption)}</strong><br>${e(p.detail)}<br>If the problem continues, ask the administrator to publish the schema again.`);
    case 'not-encrypted': return box('err', `<strong>The synchronized schema file is not protected by a passphrase.</strong><br>${e(UNCHANGED)}<br>Ask the administrator to set a passphrase and publish the schema (Settings → Schema Management).`);
    case 'validation': case 'metadata': return box('err', `<strong>${e(PULL_MESSAGES.validation)}</strong><br>${e(p.detail)}${items}Ask the administrator to correct and republish the schema.`);
    case 'missing': return box('err', `<strong>${e(PULL_MESSAGES.unavailable)}</strong><br>${e(p.detail)} Ask the administrator to publish the schema first. ${e(UNCHANGED)}`);
    case 'configuration': return box('err', `<strong>${e(PULL_MESSAGES.unavailable)}</strong><br>${e(p.detail)} An administrator can set the repository and access token in Settings → Secret Vault. ${e(UNCHANGED)}`);
    default: return box('err', `<strong>${e(PULL_MESSAGES.unavailable)}</strong><br>${e(UNCHANGED)}<br><span class="hint">Detail: ${e(p.detail)}</span>`);
  }
}
function previewHtml(p: PullPreview): string {
  const h = p.header; const rows = p.rows;
  const table = `<div class="pull-table-wrap"><table class="pull-table"><thead><tr><th>Schema</th><th>This device</th><th>Repository</th><th>Contents</th><th>Result</th></tr></thead><tbody>${rows.map((r) => `<tr><td data-label="Schema"><strong>${e(r.name)}</strong></td><td data-label="This device">${r.kind === 'add' ? 'Not on this device yet' : `v${e(r.localVersion)}<br><span class="hint">updated ${e(when(r.localUpdated))}</span>`}</td><td data-label="Repository">v${e(r.remoteVersion)}<br><span class="hint">updated ${e(when(r.remoteUpdated))}</span></td><td data-label="Contents">${r.tables} tables · ${r.columns} columns · ${r.decodeEntries} CASE/DECODE entries</td><td data-label="Result"><strong>${e(KIND[r.kind])}</strong></td></tr>`).join('')}</tbody></table></div>`;
  const older = rows.filter((r) => r.kind === 'local-newer'); const meta = `Written by ${e(p.writtenBy || '—')}${h?.appVersion ? ` · app ${e(h.appVersion)}` : ''}${h ? ` · schema format ${h.schemaFormatVersion}` : ''}${h?.writtenAt ? ` · ${e(when(h.writtenAt))}` : ''}${h?.writtenByDevice ? ` · ${e(h.writtenByDevice)}` : ''}`;
  const steps = ['Passphrase validated', 'Schema retrieved from the repository', 'Decrypted', 'Validated (format, version, tables, columns, data types, relationships, CASE/DECODE, required metadata)'].map((x) => `<li>${icon('check', 13)} ${e(x)}</li>`).join('');
  return `<ul class="pull-steps">${steps}</ul><div class="hint mt">${meta}</div>${table}${older.length ? box('warn', e(PULL_MESSAGES.older)) : ''}${p.willChange ? `${p.remoteActive ? `<p class="hint">Active schema after the pull: <strong>${e(p.remoteActive)}</strong> (now: ${e(p.localActive.name)} v${e(p.localActive.version)}).</p>` : ''}<div class="row-actions"><button type="button" class="btn btn-primary" id="pullApplyBtn">${icon('check', 14)} Apply to this device</button><button type="button" class="btn btn-outline" id="pullCancelBtn">Cancel</button></div><p class="hint">Nothing has been changed on this device yet.</p>` : box('ok', 'This device is already up to date — there is nothing to apply.')}`;
}
function paint(): void {
  const m = document.querySelector<HTMLElement>('#schemaPullMount'); if (!m) return; const r = m.querySelector<HTMLElement>('#pullResult'); if (r) r.innerHTML = view.html;
  m.querySelector('#pullApplyBtn')?.addEventListener('click', () => { void apply(); }); m.querySelector('#pullCancelBtn')?.addEventListener('click', cancel);
  const btn = m.querySelector<HTMLButtonElement>('#pullBtn'); if (btn) { btn.disabled = busy; btn.innerHTML = busy ? `${icon('refresh', 14)} Working…` : `${icon('download', 14)} Pull Schema`; }
}
const input = () => document.querySelector<HTMLInputElement>('#schemaPullPass');
async function pull(): Promise<void> {
  if (busy) return; busy = true; view = { html: box('warn', 'Validating the passphrase and retrieving the synchronized schema…'), preview: null, pass: null }; paint(); // a new operation always starts clean — no stale error survives
  const pass = input()?.value ?? '';
  try { const pv = await services().sync.previewEncryptedPull(pass); view = pv.ok ? { html: previewHtml(pv), preview: pv, pass } : { html: problemHtml(pv.problem!), preview: null, pass: null }; }
  catch (err) { view = { html: problemHtml({ kind: 'unavailable', detail: redactSecrets((err as Error)?.message || 'unexpected error', [pass, ...services().vault.knownSecrets()]) }), preview: null, pass: null }; }
  busy = false; paint();
}
async function apply(): Promise<void> {
  const pv = view.preview; const pass = view.pass; if (!pv || busy) return; busy = true; paint();
  let out: PullOutcome | null = null; try { out = await services().sync.applyPreview(pv); } catch (err) { view = { html: box('err', `<strong>${e(PULL_MESSAGES.unavailable)}</strong><br>${e(UNCHANGED)}<br><span class="hint">Detail: ${e(redactSecrets((err as Error)?.message || '', [pass || '']))}</span>`), preview: null, pass: null }; busy = false; paint(); return; }
  if (!out.ok) { view = { html: box('err', `<strong>${e(PULL_MESSAGES.validation)}</strong><br>${e(out.fileProblem || 'The schema could not be saved.')}`), preview: null, pass: null }; busy = false; paint(); return; }
  let remembered = false; if (pass && document.querySelector<HTMLInputElement>('#schemaPullRemember')?.checked !== false) { try { await services().passphrase.set(pass); remembered = true; } catch { remembered = false; } }
  const a = services().schemas.active(); const applied = [...out.added.map((n) => `${n} (added)`), ...out.updated.map((n) => `${n} (updated)`)];
  view = { html: box('ok', `<strong>${e(PULL_MESSAGES.success)}</strong><br>${applied.length ? `Applied: ${e(applied.join(', '))}. ` : 'No schema content needed to change. '}Active schema: <strong>${e(a.name)}</strong> v${e(String(a.version))}.${out.localAhead.length ? `<br>${e(PULL_MESSAGES.older)} (${e(out.localAhead.join(', '))})` : ''}<br><span class="hint">Manual Selectors, Describe What You Need, the offline NLU, SQL generation and the schema CASE/DECODE definitions now use this schema.${remembered ? ' The passphrase was saved on this device (encrypted).' : ''}</span>`), preview: null, pass: null };
  store.pushToast('success', PULL_MESSAGES.success); busy = false; paint(); const inp = input(); if (inp && remembered) inp.value = pass || '';
}
function cancel(): void { view = { html: box('warn', e(PULL_MESSAGES.cancelled)), preview: null, pass: null }; paint(); }
export function renderSchemaPullTab(panel: HTMLElement): void {
  const { sync, passphrase } = services(); const saved = passphrase.hasSaved(); const connected = !!secrets.githubOwner && !!secrets.githubRepo && !!secrets.githubToken;
  panel.innerHTML = `<div id="schemaPullMount"><div class="builder-panel"><h2>${icon('download', 16)} Pull Schema</h2>
    <div class="note-box pull-help">${icon('info', 16)}<div><strong>How to pull the schema</strong><ol><li>Enter the active passphrase used to protect the synchronized schema and select <strong>Pull Schema</strong>.</li><li>The passphrase is required to decrypt and import the synchronized schema on this device.</li><li>Keep the passphrase secure and do not share it through unsecured channels.</li></ol></div></div>
    <p class="hint mt pull-repo-hint">${icon('github', 12)} <span>${connected ? `Repository <code>${e(`${secrets.githubOwner}/${secrets.githubRepo}`)}</code> · <code>${e(sync.encryptedFilePath())}</code>` : 'The repository connection is not set up on this device — an administrator configures it in Settings → Secret Vault.'}</span></p>
    ${passphraseFieldHtml('schemaPullPass', 'Passphrase', saved ? (passphrase.isUnreadable() ? 'The passphrase saved on this device can no longer be read here — enter it again.' : 'The passphrase saved on this device is shown masked. If an administrator changed it, type the new one and pull.') : 'Ask your administrator for the passphrase.')}
    <label class="inline-check"><input type="checkbox" id="schemaPullRemember" ${saved || true ? 'checked' : ''}> Remember this passphrase on this device (stored encrypted)</label>
    <div class="row-actions"><button type="button" class="btn btn-primary" id="pullBtn">${icon('download', 14)} Pull Schema</button>${saved ? `<button type="button" class="btn btn-outline" id="pullForgetBtn">Remove saved passphrase</button>` : ''}</div>
    <div id="pullResult" aria-live="polite">${view.html}</div></div></div>`;
  wirePassphraseFields(panel); const inp = panel.querySelector<HTMLInputElement>('#schemaPullPass')!;
  void passphrase.get().then((p) => { if (p && !inp.value) inp.value = p; });
  panel.querySelector('#pullBtn')!.addEventListener('click', () => { void pull(); }); inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') void pull(); });
  panel.querySelector('#pullForgetBtn')?.addEventListener('click', () => { passphrase.clear(); inp.value = ''; view = { html: box('ok', 'The saved passphrase was removed from this device. Schema synchronization on this device is no longer encrypted until a passphrase is set again.'), preview: null, pass: null }; renderSchemaPullTab(panel); });
  paint();
}
/** Test hook / reset when the page is left. */
export function resetPullView(): void { view = { html: '', preview: null, pass: null }; busy = false; }
