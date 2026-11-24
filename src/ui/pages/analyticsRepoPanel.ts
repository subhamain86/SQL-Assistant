/**
 * V17.7.4 — the administration of the serverless Analytics provider ("repository"): the first-time Set up wizard and, inside the unlocked dashboard, Rotate keys, Publish public key and Compact.
 * (Change password is the same form as for the service provider — analyticsPage.ts — because analyticsRuntime.ts dispatches by provider.)
 *
 * Every password typed here is used for ONE action: it is read from the field, the field is emptied at once, and the value is passed to the runtime — never rendered, stored, logged or put in the URL.
 * Results say what happened in words; the only key material ever shown is the PUBLIC key (an optional pin for analytics.config.json).
 */
import { icon } from '../components/icons'; import { openModal } from '../components/modal'; import { store } from '../state'; import { e } from '../dom';
import { setupAnalytics, rotateAnalyticsKeys, publishAnalyticsKey, compactAnalytics, analyticsRepoInfo, analyticsLoadInfo, analyticsConfigState } from '../analyticsRuntime';
import { MIN_PASSWORD_LENGTH } from '../../v17/services/analyticsCrypto';
import type { PinSnippet } from '../../v17/services/analyticsRepo';

const box = (kind: 'ok' | 'warn' | 'err', html: string): string => `<div class="issue-box ${kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : ''} mini" role="${kind === 'err' ? 'alert' : 'status'}">${icon(kind === 'ok' ? 'check' : 'alert-triangle', 14)}<div>${html}</div></div>`;
const pinHtml = (pin: PinSnippet): string => `<p class="hint">Optional: to PIN this public key (so devices do not have to trust the key file in the repository), add it to <code>sql-assistant-data/analytics.config.json</code>:</p><textarea class="an-pin" readonly rows="8" aria-label="Public key to pin" data-an-pin>${e(JSON.stringify({ analytics: { publicKey: pin } }, null, 2))}</textarea><p class="hint">This is the PUBLIC key only. The private key never leaves the administrator's password protection.</p>`;
const repoCfg = (): { path: string; keep: number } => { const c = analyticsConfigState(); return c.state === 'enabled' && c.config.provider === 'repository' ? { path: c.config.repositoryPath, keep: c.config.retentionDays } : { path: '', keep: 0 }; };

/** The first-time Set up wizard. Offered to an administrator whose Settings are unlocked (the existing Admin Password); the repository's own write permission is the real gate, and the service refuses to replace an existing key file. */
export function openSetupWizard(onDone: () => void): void {
  const cfg = repoCfg(); const admin = store.settingsUnlocked;
  const m = openModal(`${icon('key', 18)} Set up Analytics`, admin
    ? `<form id="anSetupForm" autocomplete="off" novalidate><p class="hint">This creates the administrator key pair for Analytics in the repository folder <code>${e(cfg.path)}</code>. The private key is stored only <strong>wrapped with the password you choose</strong>; the usage data written by SQL Assistant can then be read only after that password is entered in the Analytics dashboard. There is no way to recover the data if the password is forgotten — keep it safe. Your GitHub access token on this device must be allowed to write to the repository.</p>
      <div class="form-row-2"><label class="block-label">Analytics administrator password (${MIN_PASSWORD_LENGTH} characters or more)<input type="password" id="anSetupPw" autocomplete="off" spellcheck="false"></label><label class="block-label">Repeat the password<input type="password" id="anSetupPw2" autocomplete="off" spellcheck="false"></label></div>
      <div id="anSetupMsg" role="alert" aria-live="assertive"></div><div class="row-actions"><button type="submit" class="btn btn-primary" id="anSetupGo">${icon('key', 14)} Set up Analytics</button><button type="button" class="btn btn-outline" id="anSetupCancel">Cancel</button></div></form>`
    : `${box('warn', 'Setting up Analytics is an administrator action. Unlock <strong>Settings</strong> with the Admin Password first (Hamburger → Settings), then come back.')}<div class="row-actions"><button type="button" class="btn btn-outline" id="anSetupCancel">Close</button></div>`, { id: 'analyticsSetupModal' });
  const root = m.element; root.querySelector('#anSetupCancel')?.addEventListener('click', () => m.close()); const form = root.querySelector<HTMLFormElement>('#anSetupForm'); if (!form) return; const msg = root.querySelector<HTMLElement>('#anSetupMsg')!; let busy = false;
  form.addEventListener('submit', (ev) => {
    ev.preventDefault(); if (busy) return; const f1 = root.querySelector<HTMLInputElement>('#anSetupPw')!; const f2 = root.querySelector<HTMLInputElement>('#anSetupPw2')!; const a = f1.value; const b = f2.value; f1.value = ''; f2.value = '';
    if (!a) { msg.innerHTML = box('err', 'Choose the administrator password.'); return; } if (a !== b) { msg.innerHTML = box('err', 'The two entries differ.'); return; }
    busy = true; msg.innerHTML = box('warn', 'Generating the key pair and writing it to the repository…'); const go = root.querySelector<HTMLButtonElement>('#anSetupGo')!; go.disabled = true;
    void setupAnalytics(a).then((r) => {
      if (r.ok) { form.innerHTML = `${box('ok', '<strong>Analytics is set up.</strong> Devices will now encrypt their usage data to the new public key. Unlock Analytics with the new password to open the dashboard.')}${pinHtml(r.pin)}<div class="row-actions"><button type="button" class="btn btn-primary" id="anSetupDone">Done</button></div>`; root.querySelector('#anSetupDone')!.addEventListener('click', () => { m.close(); onDone(); }); store.pushToast('success', 'Analytics set up.'); return; }
      msg.innerHTML = box('err', e(r.message)); go.disabled = false;
    }).finally(() => { busy = false; });
  });
}

/** The repository-provider additions of the administrator panel (shown after the common Change password form). */
export function renderRepositoryAdminExtras(host: HTMLElement): void {
  const cfg = repoCfg(); const info = analyticsRepoInfo(); const load = analyticsLoadInfo();
  const stat = `<ul class="an-list"><li>Data folder: <code>${e(cfg.path)}</code> · retention ${e(String(cfg.keep))} days.</li><li>Keys unlocked in this session: <strong>${info ? info.keys : 0}</strong> (current key id <code>${e(info ? info.currentKid : '—')}</code>).</li>${load ? `<li>Last load: ${load.files} file(s), ${load.events} event(s)${load.damaged ? `, <strong>${load.damaged} unreadable file(s) skipped</strong>` : ''}${load.truncated ? ', <strong>only the most recent files were read — use Compact</strong>' : ''}.</li>` : ''}</ul>`;
  host.insertAdjacentHTML('beforeend', `<hr class="an-sep"><div id="anRepoExtras"><h3>${icon('shield', 15)} Encrypted storage in the repository</h3>${stat}
    <form id="anRotateForm" autocomplete="off" novalidate><p class="hint"><strong>Rotate keys</strong> creates a new key pair; devices start encrypting to the new public key, and the old keys are kept so earlier data stays readable. Enter the current administrator password to confirm.</p>
      <div class="form-row-2"><label class="block-label">Current administrator password<input type="password" id="anRotPw" autocomplete="off" spellcheck="false"></label></div><div id="anRotMsg" role="alert" aria-live="assertive"></div>
      <div class="row-actions"><button type="submit" class="btn btn-outline btn-sm" id="anRotGo">${icon('refresh', 14)} Rotate keys</button><button type="button" class="btn btn-outline btn-sm" id="anPubGo">${icon('upload', 14)} Publish public key</button></div></form>
    <div class="an-compact"><p class="hint"><strong>Compact</strong> merges the encrypted batch files of finished days into encrypted monthly roll-ups (and removes data older than the retention period), so the repository does not grow without limit. Reading and writing are done in this browser; nothing is sent anywhere else.</p>
      <div id="anCompactMsg" role="status" aria-live="polite"></div><div class="row-actions"><button type="button" class="btn btn-outline btn-sm" id="anCompactGo">${icon('broom', 14)} Compact now</button></div></div></div>`);
  const q = <T extends HTMLElement>(s: string): T => host.querySelector<T>(s)!; let busy = false;
  q('#anRotateForm').addEventListener('submit', (ev) => {
    ev.preventDefault(); if (busy) return; const f = q<HTMLInputElement>('#anRotPw'); const pw = f.value; f.value = ''; const msg = q('#anRotMsg'); if (!pw) { msg.innerHTML = box('err', 'Enter the current administrator password.'); return; }
    busy = true; msg.innerHTML = box('warn', 'Creating the new key pair…'); void rotateAnalyticsKeys(pw).then((r) => { msg.innerHTML = r.ok ? `${box('ok', 'Keys rotated. Devices will use the new public key; earlier data stays readable.')}${pinHtml(r.pin)}` : box('err', e(r.kind === 'invalid' ? 'The current password is not correct.' : r.message)); }).finally(() => { busy = false; });
  });
  q('#anPubGo').addEventListener('click', () => { if (busy) return; busy = true; const msg = q('#anRotMsg'); msg.innerHTML = box('warn', 'Publishing the public key…'); void publishAnalyticsKey().then((r) => { msg.innerHTML = r.ok ? `${box('ok', 'The current public key is published.')}${pinHtml(r.pin)}` : box('err', e(r.message)); }).finally(() => { busy = false; }); });
  q('#anCompactGo').addEventListener('click', () => {
    if (busy) return; busy = true; const msg = q('#anCompactMsg'); msg.innerHTML = box('warn', 'Starting…'); const go = q<HTMLButtonElement>('#anCompactGo'); go.disabled = true;
    void compactAnalytics((t) => { msg.innerHTML = box('warn', e(t)); }).then((r) => {
      if (!r.ok) { msg.innerHTML = box('err', e(r.message)); return; } const x = r.report;
      msg.innerHTML = box('ok', `Merged ${x.filesMerged} file(s) of ${x.daysCompacted.length} day(s) into ${x.rollupsWritten} roll-up(s); removed ${x.filesDeleted} file(s)${x.prunedDays ? `; dropped ${x.prunedDays} day(s) beyond the retention period` : ''}${x.skippedUnreadable ? `; <strong>${x.skippedUnreadable} unreadable file(s) were left untouched</strong>` : ''}.${x.remaining ? ' More files remain — run Compact again.' : ''}`);
    }).finally(() => { busy = false; go.disabled = false; });
  });
}
