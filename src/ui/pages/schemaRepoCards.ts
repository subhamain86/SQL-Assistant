/**
 * V17.5.4 – V17.6.1 — the two cards that live in Hamburger → Schema → Pull Schema:
 *   Card 1  "GitHub repository (schema synchronization)" — repository, branch and schema file path. Hidden until the reveal button is used and READ-ONLY for everybody; only an administrator
 *           who passes the existing Admin Password check can unlock editing. The saved values are THE authoritative repository configuration (repositoryConfig.ts) used by schema
 *           synchronization, Pull Secret Vault and Push Secret Vault alike. The access token is set here too; V17.5.7 asks GitHub whether the token works (and with which permission) before it is saved.
 *   Card 3  "Pull Secret Vault to Repository" — IMPORTS the encrypted Secret Vault (from the repository or from a file) onto this device and stores the GitHub access token it holds (never displayed).
 *           It never writes to the repository; "Push Secret Vault to Repository" stays in Settings → Secret Vault and is the only action that pushes.
 *           V17.6.1: "Retrieve from Repository" works on a device that has NO token (vaultRetrieval.ts): saved token → anonymous read → GitHub SIGN-IN (bootstrapAuth.ts, device flow; the user authorizes on github.com as themselves,
 *           the short-lived token lives in memory for this one read and is never saved). The passphrase is asked for first, the file is checked structurally before decryption, and every failure leaves the device unchanged.
 *           V17.6.2: when central repository access is deployed (repo-broker.config.json) the token row of card 1 becomes "Repository access" (GitHub sign-in, status of the central PAT) and card 3 reads the vault through
 *           the central repository access service (no token on this device; the token inside the vault is not restored). Without that file everything above is unchanged.
 * Authorization is enforced by saveRepositoryConfig() (service layer) — the UI only collects the password. Importing a vault never reveals or changes the repository configuration card.
 */
import { icon } from '../components/icons'; import { passphraseFieldHtml, wirePassphraseFields } from '../components/passphraseField'; import { store } from '../state';
import { services, secrets, reloadSecrets, repository, repoConfig, repoConfigCustom, repoConfigProblem, refreshRepositoryConfig, hasRepositoryOverride, brokerEnabled, brokerInput, brokerSession, clearBrokerSession } from '../context'; import { ensureRepositoryAccess } from '../repoAccess';
import { brokerCheckLocation, brokerStatus } from '../../v17/services/repoBroker'; import { publishedEnabled, publishedRepo, publishedState } from '../context'; import { describePublication } from '../../v17/services/publishedData'; import { e } from '../dom';
import { verifyPassword, lockNote } from '../../services/passwordService'; import { maskSecret, type VaultImportReport } from '../../v17/services/secretVault'; import { redactSecrets } from '../../v17/errors/appErrors';
import { DEFAULT_VAULT_PASSPHRASE, isDefaultVaultPassphrase } from '../../v17/services/repositoryDefaults'; import { DEFAULT_REPOSITORY, repositoryLabel, parseRepositoryLabel, saveRepositoryConfig, type RepositoryConfig } from '../../v17/services/repositoryConfig';
import { checkRepositoryLocation, validateTokenAccess } from '../../v17/services/githubClient';
import { retrieveVaultFile, retrieveVaultAuthorized, validateVaultPayload, SIGN_IN_CAN_HELP, type VaultRetrieval, type VaultRetrievalVia } from '../../v17/services/vaultRetrieval'; import { fetchBootstrapConfig, runDeviceFlow, type BootstrapConfig, type DeviceCode } from '../../v17/services/bootstrapAuth';
import { encryptedPathFor } from '../../v17/services/schemaCrypto'; import { knowledgePathFor } from '../../v17/services/knowledgeSync'; import { adminMessagePathFor } from '../../v17/services/adminMessage';
const DEFAULT_VAULT_PATH = 'sql-assistant-data/vault/secret-vault.v17.enc.json';
const box = (kind: 'ok' | 'warn' | 'err', html: string) => `<div class="issue-box ${kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : ''} mini" role="${kind === 'err' ? 'alert' : 'status'}">${icon(kind === 'ok' ? 'check' : 'alert-triangle', 14)}<div>${html}</div></div>`;
/** The hidden informational message: what the repository card is for and which files SQL Assistant reads / writes there. No secret appears in it. */
function infoHtml(): string {
  const c = repoConfig; const p = c.schemaPath; return `<strong>Repository synchronization details</strong><ul>
    <li>All devices share <code>${e(repositoryLabel(c))}</code>, branch <code>${e(c.branch)}</code>. ${repoConfigCustom ? 'An administrator changed these values on this device.' : 'These are the application defaults.'} They can be changed only by an administrator (Admin Password).</li>
    <li>Schemas: <code>${e(p)}</code> (plain) and <code>${e(encryptedPathFor(p))}</code> (AES-256-GCM, when a Vault passphrase is saved). Knowledge: <code>${e(knowledgePathFor(p))}</code>. Admin message: <code>${e(adminMessagePathFor(p))}</code>. Secret Vault: <code>${e(secrets.vaultPath || DEFAULT_VAULT_PATH)}</code>.</li>
    ${brokerEnabled() ? '<li>Repository access is <strong>central</strong>: every read and write goes through the organization\'s repository access service, which uses the GitHub PAT stored as the GitHub Actions secret <code>SQLA_GITHUB_PAT</code>. This device holds no token; you sign in with GitHub once per browser session.</li>' : `<li>The GitHub access token is stored on this device only as AES-256-GCM ciphertext and is sent only to <code>api.github.com</code> over HTTPS. It needs <em>Contents: Read and write</em> to publish and <em>Contents: Read</em> to pull. Changing it asks for the Admin Password.</li>`}
    <li>Pull Schema from GitHub and Pull Secret Vault to Repository only <em>read</em> the repository. Writing happens only through <em>Sync with GitHub Now</em> (Settings → Schema Management) and <em>Push Secret Vault to Repository</em> (Settings → Secret Vault). Pull and Push use exactly the values shown here.</li></ul>`;
}
/** The V17.6.1 token row — shown when central repository access is NOT deployed. Unchanged. */
function tokenRowHtml(): string {
  const s = secrets; const pub = publishedEnabled() && publishedState.state === 'available' ? `<p class="hint" id="publishedHint">${icon('info', 13)} <strong>Reading needs no token.</strong> This device reads the repository's published copy (${e(describePublication(publishedState.marker))}); a token is only needed to <em>publish</em>.${s.githubToken ? '' : ' If a central read-only token vault was published, it is restored here automatically (below).'}</p><div id="autoTokenResult" aria-live="polite"></div>` : ''; return `${pub}<label class="block-label">GitHub Access Token</label><div class="masked-token-row"><span class="masked-token-display" id="maskedToken">${icon('key', 14)} ${e(maskSecret(s.githubToken))}</span><button type="button" class="btn btn-outline btn-sm" id="changeTokenBtn">${icon('edit', 14)} ${s.githubToken ? 'Change Token' : 'Set Token'}</button></div>
    <div id="tokenEditor" hidden><div class="form-row-2"><label class="block-label">New access token<input type="password" id="newTokenInput" autocomplete="off" placeholder="ghp_… or github_pat_…"></label><label class="block-label">Admin Password<input type="password" id="tokenAdminPw" autocomplete="off" aria-label="Admin Password"></label></div><div class="row-actions"><button type="button" class="btn btn-primary btn-sm" id="saveTokenBtn">${icon('save', 14)} Save Token</button></div></div>`;
}
/** V17.6.2 — shown instead of the token row when repository access is central: no token on this device; a GitHub sign-in proves the user may use the repository, the service's own PAT does the work. */
function centralAccessHtml(): string {
  const ses = brokerSession(); const when = ses ? new Date(ses.expiresAt).toLocaleString() : '';
  return `<label class="block-label">Repository access (central)</label><div class="masked-token-row"><span class="masked-token-display" id="accessStatus">${icon('key', 14)} ${ses ? `Signed in as ${e(ses.login)} · ${ses.canWrite ? 'can publish' : 'read-only'} · until ${e(when)}` : 'Not signed in on this browser'}</span><button type="button" class="btn btn-outline btn-sm" id="brokerSignInBtn">${icon('github', 14)} ${ses ? 'Sign in again' : 'Sign in with GitHub'}</button><button type="button" class="btn btn-outline btn-sm" id="brokerCheckBtn">${icon('clipboard-check', 14)} Check central access</button>${ses ? `<button type="button" class="btn btn-ghost btn-sm" id="brokerSignOutBtn">Sign out</button>` : ''}</div>
    <p class="hint">The repository is read and written by the organization's central repository access service, which uses its own GitHub PAT (a GitHub Actions secret). <strong>No token is stored on this device</strong> — you only sign in with the GitHub account that may use the repository.</p><div id="brokerResult" aria-live="polite"></div>`;
}
export function repoCardHtml(): string {
  const s = secrets; const c = repoConfig; return `<div class="builder-panel" data-v1754-repo-card><h2>${icon('github', 16)} GitHub repository (schema synchronization)</h2>
    <p class="hint">One repository for every device <span class="chip chip-inactive">${icon('lock', 11)} administrator only</span> — its values are hidden until you select <em>Show configuration</em> and can be changed only by an administrator (Admin Password). ${brokerEnabled() ? 'Repository access is <strong>central</strong>: you sign in with GitHub below and the organization\'s repository access service does the reading and writing — no token is stored on this device.' : 'The access token is stored on this device encrypted with AES-256-GCM (non-extractable device key) and is sent only to <code>api.github.com</code> over HTTPS. Use a fine-grained token limited to this repository with <strong>Contents: Read and write</strong>.'}</p>
    <div class="row-actions"><button type="button" class="btn btn-outline btn-sm" id="repoCfgToggle" aria-expanded="false" aria-controls="repoCfgPanel">${icon('eye', 14)} <span id="repoCfgToggleLabel">Show configuration</span></button></div>
    <div id="repoCfgPanel" hidden><div class="form-row-3"><label class="block-label">Repository (owner/repo)<input type="text" id="vaultRepo" value="${e(repositoryLabel(c))}" readonly aria-readonly="true" data-locked autocomplete="off" spellcheck="false"></label><label class="block-label">Branch<input type="text" id="vaultBranch" value="${e(c.branch)}" readonly aria-readonly="true" data-locked autocomplete="off" spellcheck="false"></label><label class="block-label">Schema file path<input type="text" id="vaultPath" value="${e(c.schemaPath)}" readonly aria-readonly="true" data-locked autocomplete="off" spellcheck="false"></label></div>
    ${repoConfigProblem ? box('warn', e(repoConfigProblem)) : ''}
    <div class="row-actions" id="repoCfgEditRow"><button type="button" class="btn btn-outline btn-sm" id="repoCfgEdit">${icon('edit', 14)} Edit configuration (administrator)</button></div>
    <div id="repoCfgAuth" hidden><div class="form-row-2"><label class="block-label">Admin Password<input type="password" id="repoCfgAdminPw" autocomplete="off" aria-label="Admin Password for the repository configuration"></label></div><div class="row-actions"><button type="button" class="btn btn-primary btn-sm" id="repoCfgUnlock">${icon('lock', 14)} Unlock editing</button><button type="button" class="btn btn-ghost btn-sm" id="repoCfgAuthCancel">Cancel</button></div></div>
    <div id="repoCfgEditActions" hidden><div class="row-actions"><button type="button" class="btn btn-primary btn-sm" id="repoCfgSave">${icon('save', 14)} Validate and save configuration</button><button type="button" class="btn btn-outline btn-sm" id="repoCfgDefaults">Restore application defaults</button><button type="button" class="btn btn-ghost btn-sm" id="repoCfgCancel">Cancel</button></div></div>
    <div id="repoCfgResult" aria-live="polite"></div>
    <div class="note-box mini" id="repoInfoMsg">${icon('info', 15)}<div>${infoHtml()}</div></div></div>
    ${brokerEnabled() ? centralAccessHtml() : tokenRowHtml()}
    <div id="vaultCfgResult" aria-live="polite"></div></div>`;
}
export function wireRepoCard(root: HTMLElement, onChange: () => void): void {
  const out = (ok: boolean, m: string) => { root.querySelector('#vaultCfgResult')!.innerHTML = box(ok ? 'ok' : 'err', e(redactSecrets(m, services().vault.knownSecrets()))); };
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  // The toggle only shows / hides the (read-only) values. It never reads from or writes to the saved configuration.
  const tgl = q<HTMLButtonElement>('#repoCfgToggle'); const panel = q('#repoCfgPanel'); const lbl = q('#repoCfgToggleLabel');
  const inputs = () => [q<HTMLInputElement>('#vaultRepo'), q<HTMLInputElement>('#vaultBranch'), q<HTMLInputElement>('#vaultPath')]; const cfgOut = q('#repoCfgResult');
  const cfgMsg = (kind: 'ok' | 'warn' | 'err', html: string) => { cfgOut.innerHTML = box(kind, html); };
  let unlockedPw: string | null = null; // held in memory only while editing is unlocked; the service verifies it again when saving
  let relock: ReturnType<typeof setTimeout> | null = null; const AUTO_LOCK_MS = 5 * 60 * 1000; // an unlocked editor locks itself after 5 minutes (like Settings)
  const lock = (restore: boolean) => { unlockedPw = null; if (relock) { clearTimeout(relock); relock = null; } const c = repoConfig; const v = [repositoryLabel(c), c.branch, c.schemaPath]; inputs().forEach((i, n) => { i.readOnly = true; i.setAttribute('aria-readonly', 'true'); i.setAttribute('data-locked', ''); if (restore) i.value = v[n]; }); q('#repoCfgAuth').hidden = true; q('#repoCfgEditActions').hidden = true; q('#repoCfgEditRow').hidden = false; q<HTMLInputElement>('#repoCfgAdminPw').value = ''; };
  tgl.addEventListener('click', () => { if (!panel.hidden) { lock(true); cfgOut.innerHTML = ''; } panel.hidden = !panel.hidden; tgl.setAttribute('aria-expanded', String(!panel.hidden)); lbl.textContent = panel.hidden ? 'Show configuration' : 'Hide configuration'; });
  q('#repoCfgEdit').addEventListener('click', () => { q('#repoCfgEditRow').hidden = true; q('#repoCfgAuth').hidden = false; cfgOut.innerHTML = ''; q<HTMLInputElement>('#repoCfgAdminPw').focus(); });
  q('#repoCfgAuthCancel').addEventListener('click', () => { lock(true); cfgOut.innerHTML = ''; });
  q('#repoCfgCancel').addEventListener('click', () => { lock(true); cfgOut.innerHTML = ''; });
  let unlocking = false;
  q('#repoCfgUnlock').addEventListener('click', async () => {
    if (unlocking) return; unlocking = true; try {
      const pw = q<HTMLInputElement>('#repoCfgAdminPw').value; if (!(await verifyPassword(pw))) { cfgMsg('err', `Incorrect Admin Password — the repository configuration stays read-only.${lockNote() ? ` ${lockNote()}` : ''}`); return; }
      unlockedPw = pw; relock = setTimeout(() => { if (root.isConnected) { lock(true); cfgMsg('warn', 'Editing was locked after 5 minutes of inactivity. Select <em>Edit configuration</em> to unlock it again.'); } else unlockedPw = null; }, AUTO_LOCK_MS); q<HTMLInputElement>('#repoCfgAdminPw').value = ''; q('#repoCfgAuth').hidden = true; q('#repoCfgEditActions').hidden = false; inputs().forEach((i) => { i.readOnly = false; i.setAttribute('aria-readonly', 'false'); i.removeAttribute('data-locked'); }); cfgOut.innerHTML = ''; inputs()[0].focus();
    } finally { unlocking = false; } });
  let saving = false;
  const commit = async (cfg: Partial<RepositoryConfig>) => {
    if (saving || unlockedPw === null) return; saving = true; const btns = [q<HTMLButtonElement>('#repoCfgSave'), q<HTMLButtonElement>('#repoCfgDefaults')]; btns.forEach((b) => (b.disabled = true)); cfgMsg('warn', 'Validating the repository configuration…');
    try {
      const prev = repoConfig; const token = secrets.githubToken;
      const liveCheck = async (c: RepositoryConfig) => {
        if (hasRepositoryOverride()) return { refuse: null, notes: [] as string[] };
        if (brokerEnabled()) { // V17.6.2: the location is verified through the central repository access service (it needs a sign-in that belongs to the NEW repository)
          const ses = brokerSession(); const inp = brokerInput(); if (!ses || !inp || ses.repo.toLowerCase() !== `${c.owner}/${c.repo}`.toLowerCase()) return { refuse: null, notes: ['The values are well-formed, but they could not be checked against GitHub because no repository sign-in exists for this repository yet. Sign in again after saving to verify them.'] };
          const r = await brokerCheckLocation({ ...inp, owner: c.owner, repo: c.repo, branch: c.branch, path: c.schemaPath, session: () => ses }); return r.ok ? { refuse: null, notes: [r.message] } : { refuse: `${r.message} The configuration was not saved.`, notes: [] as string[] };
        }
        if (!token) return { refuse: null, notes: ['The values are well-formed, but they could not be checked against GitHub because no access token is set on this device yet.'] };
        const r = await checkRepositoryLocation({ owner: c.owner, repo: c.repo, branch: c.branch, token, path: c.schemaPath });
        return r.ok ? { refuse: null, notes: [r.message] } : { refuse: `${r.message} The configuration was not saved.`, notes: [] as string[] };
      };
      const r = await saveRepositoryConfig(services().store, cfg, unlockedPw, { liveCheck });
      if (!r.ok) { cfgMsg('err', `<strong>${e(r.message)}</strong>${r.problems.length ? `<ul>${r.problems.map((x) => `<li>${e(x)}</li>`).join('')}</ul>` : ''}`); if (r.kind === 'unauthorized') lock(true); return; }
      refreshRepositoryConfig(); await reloadSecrets(); const changed = prev.owner !== r.config.owner || prev.repo !== r.config.repo || prev.branch !== r.config.branch || prev.schemaPath !== r.config.schemaPath;
      store.pushToast('success', r.custom ? 'Repository configuration saved.' : 'Application default repository configuration restored.');
      const msg = `<strong>${r.custom ? 'Repository configuration validated and saved.' : 'Application defaults restored.'}</strong> Pull Schema, Sync with GitHub Now and Push Secret Vault now use it.${r.notes.length ? `<br>${r.notes.map(e).join('<br>')}` : ''}${changed ? '<br><span class="hint">Schemas already synchronized from the previous repository keep their state; where this device and the new repository both differ, the next synchronization records a conflict for you to resolve — it never overwrites.</span>' : ''}`;
      onChange(); const rr = document.querySelector<HTMLElement>('#repoCfgResult'); if (rr) rr.innerHTML = box('ok', msg);
    } catch (err) { cfgMsg('err', e(`The configuration was not saved: ${redactSecrets((err as Error).message, services().vault.knownSecrets())}`)); }
    finally { saving = false; btns.forEach((b) => (b.disabled = false)); } };
  q('#repoCfgSave').addEventListener('click', () => {
    const [r, b, p] = inputs(); const parsed = parseRepositoryLabel(r.value); if (!parsed) { cfgMsg('err', '<strong>Repository: enter it as owner/repository (for example basware/sk-ap-sql-assistant). Nothing was saved.</strong>'); return; }
    void commit({ owner: parsed.owner, repo: parsed.repo, branch: b.value, schemaPath: p.value }); });
  q('#repoCfgDefaults').addEventListener('click', () => { void commit({ ...DEFAULT_REPOSITORY }); });
  if (brokerEnabled()) { wireCentralAccess(root, onChange); return; } // V17.6.2: central access has no token row
  void autoPopulateToken(root, onChange); // V17.6.3: a device with no token restores the central read-only token from the published vault, once per page load
  q('#changeTokenBtn').addEventListener('click', () => { q('#tokenEditor').hidden = false; q<HTMLInputElement>('#newTokenInput').focus(); });
  let busy = false;
  q('#saveTokenBtn').addEventListener('click', async () => {
    if (busy) return; const t = q<HTMLInputElement>('#newTokenInput').value.trim(); const pw = q<HTMLInputElement>('#tokenAdminPw').value;
    if (!t) { out(false, 'Enter a token.'); return; } if (/\s/.test(t)) { out(false, 'The token must not contain spaces.'); return; }
    busy = true; try {
      if (!(await verifyPassword(pw))) { out(false, `Incorrect Admin Password — the token was not changed.${lockNote() ? ` ${lockNote()}` : ''}`); return; }
      // V17.5.7 — ask GitHub whether the token works for the configured repository BEFORE it replaces anything. Only a definite rejection (401) blocks the save; "cannot be checked" (offline) and "no access" are reported with the token saved.
      let note = ''; if (!hasRepositoryOverride()) { out(true, 'Checking the token with GitHub…'); const a = await validateTokenAccess({ owner: secrets.githubOwner, repo: secrets.githubRepo, token: t });
        if (a.state === 'rejected') { out(false, `${a.message} The token was not saved${secrets.githubToken ? ' — the token already saved was kept' : ''}.`); return; } note = ` ${a.message}${a.state === 'unverified' ? ' It was saved anyway.' : a.canWrite === false ? ' Publishing and pushing will fail until it has Contents: Read and write.' : ''}`; }
      try { await services().vault.save({ ...secrets, githubToken: t }); await reloadSecrets(); store.pushToast('success', 'GitHub access token saved (encrypted).'); onChange(); const r = document.querySelector<HTMLElement>('#vaultCfgResult'); if (r) r.innerHTML = box('ok', e(`GitHub access token saved (encrypted).${note}`)); }
      catch (err) { out(false, `Encryption failed: ${(err as Error).message}`); }
    } finally { busy = false; } });
}
/**
 * V17.6.3 — token auto-population for a device that has none. Only when a published copy exists and the device has no token: the published vault is read (same origin, no credential), opened with the built-in default
 * passphrase and — if it holds a token GitHub accepts — restored through the normal, validated import (stored encrypted, shown masked). Nothing is typed or copied. If the vault is protected by another passphrase
 * the user is told to use the Pull Secret Vault card; every other outcome leaves the device unchanged. One attempt per page load.
 */
let autoTokenTried = false;
async function autoPopulateToken(root: HTMLElement, onChange: () => void): Promise<void> {
  if (autoTokenTried || secrets.githubToken || hasRepositoryOverride() || !publishedEnabled()) return; autoTokenTried = true;
  const el = () => document.querySelector<HTMLElement>('#autoTokenResult'); const say = (kind: 'ok' | 'warn' | 'err', html: string) => { const x = el(); if (x) x.innerHTML = box(kind, html); };
  try {
    const pr = publishedRepo(); if (!pr) return; const r = await retrieveVaultFile({ location: { owner: secrets.githubOwner, repo: secrets.githubRepo, branch: secrets.githubBranch || 'main' }, vaultPath: secrets.vaultPath, defaultPath: DEFAULT_VAULT_PATH, savedToken: '', override: pr, overrideVia: 'repository-published' });
    if (!r.ok) { if (r.kind !== 'file-not-found') say('warn', e(r.notes.length ? `${r.notes.join(' ')} Nothing on this device was changed.` : r.message)); return; }
    const v = validateVaultPayload(r.text); if (!v.ok) { say('warn', `The published vault cannot be used — ${e(v.message)}. Nothing on this device was changed.`); return; }
    const { vault } = services(); const verifyToken = (token: string) => validateTokenAccess({ owner: secrets.githubOwner, repo: secrets.githubRepo, token });
    try { const out = await vault.importSecrets(r.text, DEFAULT_VAULT_PASSPHRASE, { verifyToken }); await reloadSecrets();
      if (out.report.tokenImported) { store.pushToast('success', 'Central access token restored on this device (stored encrypted).'); onChange(); const x = document.querySelector<HTMLElement>('#autoTokenResult'); if (x) x.innerHTML = box('ok', `<strong>The central access token was restored automatically</strong> from the published vault (stored encrypted, shown masked).${out.report.access && out.report.access.state === 'ok' ? ` ${e(out.report.access.message)}` : ''}${out.report.warnings.length ? `<ul>${out.report.warnings.map((w) => `<li>${e(w)}</li>`).join('')}</ul>` : ''}`); }
      else say('warn', `The published vault was opened but it holds no token that could be restored.${out.report.warnings.length ? ` ${e(out.report.warnings.join(' '))}` : ''} Reading still works without a token.`);
    } catch (err) { const m = (err as Error).message; say('warn', /passphrase is wrong/i.test(m) ? 'A central token vault is published, but it is protected by its own Vault Sync Passphrase. Enter it in <em>Pull Secret Vault to Repository</em> and select <em>Retrieve from Repository</em>. Reading still works without a token.' : `${e(redactSecrets(m, services().vault.knownSecrets()))} Nothing on this device was changed.`); }
  } catch { /* never block the page */ }
}
/** The buttons of the central-access row: sign in (GitHub device flow run by the service), check the central PAT, sign out. */
function wireCentralAccess(root: HTMLElement, onChange: () => void): void {
  const out = root.querySelector<HTMLElement>('#brokerResult')!; const show = (html: string): HTMLElement => { out.innerHTML = html; return out; }; let working = false;
  const guard = async (fn: () => Promise<void>) => { if (working) return; working = true; root.querySelectorAll<HTMLButtonElement>('#brokerSignInBtn,#brokerCheckBtn').forEach((b) => (b.disabled = true)); try { await fn(); } finally { working = false; root.querySelectorAll<HTMLButtonElement>('#brokerSignInBtn,#brokerCheckBtn').forEach((b) => (b.disabled = false)); } };
  root.querySelector('#brokerSignInBtn')!.addEventListener('click', () => { void guard(async () => { clearBrokerSession(); const r = await ensureRepositoryAccess({ show }); if (!r.ok) { show(box(r.cancelled ? 'warn' : 'err', e(r.message))); return; } store.pushToast('success', `Signed in as ${r.session?.login || 'GitHub user'} — repository access is available.`); onChange(); }); });
  root.querySelector('#brokerCheckBtn')!.addEventListener('click', () => { void guard(async () => {
    const r = await ensureRepositoryAccess({ show }); if (!r.ok) { show(box(r.cancelled ? 'warn' : 'err', e(r.message))); return; } const inp = brokerInput(); if (!inp) { show(box('err', 'Central repository access is not available.')); return; }
    show(box('warn', 'Checking the central PAT with GitHub…')); const st = await brokerStatus(inp);
    if (!st.ok) { show(box('err', `<strong>${e(st.message)}</strong>`)); if (r.signedIn) onChange(); return; }
    show(box(st.warn ? 'warn' : 'ok', `<strong>${e(st.message)}</strong>${st.expiresAt ? `<br><span class="hint">PAT expiry reported by GitHub: ${e(st.expiresAt.slice(0, 10))}.</span>` : ''}${st.canWrite === false ? '<br>The central PAT has read-only access: publishing and pushing will fail until it has Contents: Read and write.' : ''}`)); }); });
  root.querySelector('#brokerSignOutBtn')?.addEventListener('click', () => { clearBrokerSession(); store.pushToast('info', 'Signed out of repository access on this browser.'); onChange(); });
}
export function vaultPullCardHtml(): string {
  return `<div class="builder-panel mt" data-v1754-vault-card><h2>${icon('cloud', 16)} Pull Secret Vault to Repository</h2>
    ${brokerEnabled() ? `<p class="hint"><strong>Direction: repository → this device.</strong> Imports the encrypted Secret Vault onto <strong>this device</strong> — retrieved from the repository (the repository is only <strong>read</strong>, never changed) or from an encrypted vault file — and restores the AI/LLM API key it holds. <strong>Repository access is central:</strong> <em>Retrieve from Repository</em> asks you to sign in with GitHub once (no token is copied to this device), and a GitHub token held in the vault is not restored. The key is derived (PBKDF2-SHA-256) from the <strong>Vault Sync Passphrase</strong>, which is never stored or uploaded; it decrypts the vault and does not authenticate you to GitHub. The repository location is the configuration above, not the vault's. Pushing the vault to the repository is a separate action: Settings → Secret Vault. The default passphrase is built into the application, so it only keeps the vault from casual reading — push with your own passphrase and enter it here.</p>` : `<p class="hint"><strong>Direction: repository → this device.</strong> Imports the encrypted Secret Vault onto <strong>this device</strong> — retrieved from the repository (the repository is only <strong>read</strong>, never changed) or from an encrypted vault file — and stores the GitHub access token it contains, encrypted and never displayed, so you do not have to set the token first. The key is derived (PBKDF2-SHA-256) from the <strong>Vault Sync Passphrase</strong>, which is never stored or uploaded. Files pushed by V17.2 can be imported too. The repository location is the configuration above, not the vault's. Pushing the vault to the repository is a separate action: Settings → Secret Vault. The default passphrase is built into the application, so it only keeps the vault from casual reading — for a confidential token push with your own passphrase and enter it here. The passphrase decrypts the vault; it does not sign you in to a private repository — on a device with no token, <em>Retrieve from Repository</em> asks you to authorize on github.com (where your administrator has enabled GitHub sign-in) or you can use <em>Import encrypted file</em>.</p>`}
    
    ${passphraseFieldHtml('v17VaultPass', 'Vault Sync Passphrase', 'Pre-filled with the default for this application; replace it if your administrator uses another one. Hidden by default — use the eye button to check it.')}
    <label class="block-label">Vault file path<input type="text" value="${e(secrets.vaultPath || DEFAULT_VAULT_PATH)}" readonly aria-readonly="true" id="vaultFilePathRO" data-locked></label>
    <div class="row-actions"><button type="button" class="btn btn-primary" id="pullVaultBtn">${icon('download', 14)} Retrieve from Repository</button><label class="btn btn-outline file-input-label">${icon('file-plus', 14)} Import encrypted file<input type="file" id="importVaultFile" accept=".json" hidden></label></div><div id="v17VaultResult" aria-live="polite"></div></div>`;
}
export const WRONG_PASSPHRASE_HINT = ' Enter the passphrase the Secret Vault was pushed with (the pre-filled default opens only a vault pushed with it) and try again. No other passphrase was tried; nothing on this device was changed.';
export const PASSPHRASE_REQUIRED_MESSAGE = 'Enter the Vault Sync Passphrase (at least 10 characters) that was used when the Secret Vault was pushed. Nothing was retrieved and nothing on this device was changed.';
export const DEFAULT_PASSPHRASE_WARNING = 'This vault was read without any GitHub credential and opened with the built-in default passphrase, which is part of the application: anyone who can reach that file can decrypt the token it holds. Push the vault again with your own passphrase (Settings → Secret Vault) and rotate the token if the file was reachable by people who should not have it.';
const SOURCE_LINE: Record<VaultRetrievalVia | 'file', string> = { 'repository-token': 'Source: the GitHub repository, read with the access token saved on this device.', 'repository-anonymous': 'Source: the GitHub repository, read without a credential (a public repository).', 'repository-signin': 'Source: the GitHub repository, read with your GitHub sign-in (a short-lived authorization that was kept in memory for this retrieval only and is not saved).', 'repository-broker': 'Source: the GitHub repository, read through the central repository access service (your GitHub sign-in; no token is stored on this device).', 'repository-published': 'Source: the published copy of the repository that is served next to this application (no GitHub credential was used; the copy was checked against its publication record).', 'test-repository': 'Source: the GitHub repository.', file: 'Source: the encrypted file you selected.' };
/** What an import did — never contains the token. `source` and `extra` (warnings) are plain text. */
export function importSummary(r: VaultImportReport, source = '', extra: string[] = []): { kind: 'ok' | 'warn'; html: string } {
  const parts: string[] = []; if (r.tokenImported) parts.push(r.tokenReplaced ? 'the GitHub access token was replaced by the one in the vault (stored encrypted)' : 'the GitHub access token was saved on this device (stored encrypted)'); if (r.aiKeyImported) parts.push('the AI/LLM API key was saved'); if (r.tokenKept) parts.push('the token already saved on this device was kept');
  if (r.tokenSkipped) parts.push('repository access is central, so the GitHub token inside the vault was not restored (no token is needed on this device)');
  const head = `<strong>Secret Vault imported and validated.</strong> ${e(parts.length ? parts.join('; ').replace(/^./, (c) => c.toUpperCase()) + '.' : '')}`; const ready = r.tokenImported || r.tokenKept || !!r.tokenSkipped; const warns = r.warnings.filter((w) => !(r.tokenSkipped && w.startsWith('The GitHub access token inside the vault was not restored'))); const all = [...warns, ...extra];
  const acc = r.access && r.access.state === 'ok' && r.tokenImported ? ` ${e(r.access.message)}` : '';
  return { kind: (warns.length && !r.tokenImported) || extra.length ? 'warn' : 'ok', html: `${head}${acc}${ready ? ' Pull Schema and Push Secret Vault can be used now — the import does not have to be repeated.' : ''}${all.length ? `<ul>${all.map((w) => `<li>${e(w)}</li>`).join('')}</ul>` : ''}${r.deviceVaultWasUnreadable ? '<br><span class="hint">The vault that was stored on this device could not be opened with this browser\'s device key; it was kept as a backup copy and replaced.</span>' : ''}${source ? `<br><span class="hint">${e(source)}</span>` : ''}` };
}
/** An encrypted vault that was already retrieved with a GitHub sign-in but could not be opened (wrong passphrase) is kept in MEMORY for a few minutes so the user can correct the passphrase without signing in again. Ciphertext only. */
const CACHE_MS = 10 * 60_000; let cachedVault: { text: string; via: VaultRetrievalVia; notes: string[]; at: number } | null = null;
export function wireVaultPullCard(root: HTMLElement, onChange: () => void): void {
  wirePassphraseFields(root); const inp = root.querySelector<HTMLInputElement>('#v17VaultPass')!; inp.value = DEFAULT_VAULT_PASSPHRASE; // assigned as a property — never written into markup
  let transient: string[] = []; // the short-lived sign-in token while it is in memory — registered only so it is redacted from any message
  const known = () => [...services().vault.knownSecrets(), inp.value, ...transient]; const res = () => root.querySelector<HTMLElement>('#v17VaultResult')!;
  const out = (ok: boolean, m: string) => { res().innerHTML = box(ok ? 'ok' : 'err', e(redactSecrets(m, known()))); };
  const done = (r: VaultImportReport, source: string, extra: string[]) => { const keep = inp.value; const s = importSummary(r, source, extra); store.pushToast(s.kind === 'ok' ? 'success' : 'warning', r.tokenImported ? 'Secret Vault imported — GitHub access token saved (encrypted).' : 'Secret Vault imported.'); onChange(); const rr = document.querySelector<HTMLElement>('#v17VaultResult'); if (rr) rr.innerHTML = box(s.kind, s.html); const i2 = document.querySelector<HTMLInputElement>('#v17VaultPass'); if (i2) i2.value = keep; }; // onChange re-renders the page: the repository configuration is hidden again, never revealed by an import
  let busy = false; const btn = root.querySelector<HTMLButtonElement>('#pullVaultBtn')!;
  const guard = async (fn: () => Promise<void>) => { if (busy) return; busy = true; btn.disabled = true; res().innerHTML = box('warn', 'Retrieving and decrypting the Secret Vault…'); try { await fn(); } finally { busy = false; btn.disabled = false; } };
  // The passphrase is asked for BEFORE anything is requested (and before the user is sent to sign in): a vault cannot be opened without it.
  const needPassphrase = (): boolean => { if (inp.value && inp.value.length >= 10) return false; out(false, PASSPHRASE_REQUIRED_MESSAGE); inp.focus(); return true; };
  // V17.5.7: GitHub is asked whether the imported token works (a rejected token never replaces a saved one; V17.6.1: a token GitHub cannot use is not restored either). Skipped when a test repository stands in for GitHub.
  const verifyToken = hasRepositoryOverride() ? undefined : (token: string) => validateTokenAccess({ owner: secrets.githubOwner, repo: secrets.githubRepo, token });
  const importOptions = () => (brokerEnabled() ? { skipToken: true } : { verifyToken }); // V17.6.2: with central repository access the token inside the vault is not restored (nor validated)
  const importText = async (text: string, failLabel: string, via: VaultRetrievalVia | 'file' = 'file', notes: string[] = []) => {
    if (via !== 'file') { const v = validateVaultPayload(text); if (!v.ok) { out(false, `${failLabel}: the file in the repository cannot be used — ${v.message}. Nothing on this device was changed.`); return; } } // existence, structure and version are checked BEFORE anything is decrypted
    const pass = inp.value;
    try { const { vault } = services(); const r = await vault.importSecrets(text, pass, importOptions()); await reloadSecrets(); cachedVault = null;
      done(r.report, [SOURCE_LINE[via], ...notes].join(' '), (via === 'repository-anonymous' || via === 'repository-published') && isDefaultVaultPassphrase(pass) ? [DEFAULT_PASSPHRASE_WARNING] : []); }
    catch (err) { const m = (err as Error).message; const wrong = /passphrase is wrong/i.test(m);
      if (wrong && via === 'repository-signin') { cachedVault = { text, via, notes, at: Date.now() }; }
      out(false, wrong ? `${failLabel}: ${m}${WRONG_PASSPHRASE_HINT}${via === 'repository-signin' ? ' The vault was already retrieved: correct the passphrase and select "Retrieve from Repository" again — you will not be asked to sign in again (kept in memory for 10 minutes).' : ''}` : `${failLabel}: ${m}${/not changed|nothing was changed|Nothing was changed/i.test(m) ? '' : ' Nothing on this device was changed.'}`);
      if (wrong) { const i2 = document.querySelector<HTMLInputElement>('#v17VaultPass'); if (i2) { i2.focus(); i2.select(); } } } };
  /** Route 3: the GitHub sign-in (device flow). Returns the retrieval result, or null when the flow ended (its message is already on screen). */
  const signIn = async (cfg: BootstrapConfig): Promise<VaultRetrieval | null> => {
    const ctl = new AbortController(); const watch = setInterval(() => { if (!root.isConnected) ctl.abort(); }, 1000); // leaving the page ends the sign-in
    const showCode = (c: DeviceCode) => { const el = document.querySelector<HTMLElement>('#v17VaultResult'); if (!el) return; el.innerHTML = box('warn', `<strong>Authorize on GitHub to retrieve the vault.</strong> Open <a href="${e(c.verificationUri)}" target="_blank" rel="noopener noreferrer">${e(c.verificationUri.replace(/^https:\/\//, ''))}</a>, enter the code <code id="bootstrapUserCode">${e(c.userCode)}</code> and sign in with the GitHub account that may read this repository. This page continues by itself once you approve (the code is valid for about ${Math.max(1, Math.round(c.expiresInSec / 60))} minutes). <button type="button" class="btn btn-ghost btn-sm" id="bootstrapCancel">Cancel</button><br><span class="hint">Your passphrase is not sent to GitHub. The sign-in is used once to read the encrypted vault and is not saved.</span>`); el.querySelector('#bootstrapCancel')?.addEventListener('click', () => ctl.abort()); };
    try {
      const flow = await runDeviceFlow(cfg, showCode, { signal: ctl.signal }); if (!flow.ok) { out(false, flow.kind === 'cancelled' ? flow.message : `Retrieve failed: ${flow.message}`); return null; }
      let tok = flow.token; transient = [tok]; res().innerHTML = box('warn', 'Signed in. Reading the encrypted vault from the repository…');
      try { return await retrieveVaultAuthorized({ location: { owner: secrets.githubOwner, repo: secrets.githubRepo, branch: secrets.githubBranch || 'main' }, vaultPath: secrets.vaultPath, defaultPath: DEFAULT_VAULT_PATH, token: tok }); } finally { tok = ''; transient = []; } // the sign-in token is dropped here
    } finally { clearInterval(watch); }
  };
  btn.addEventListener('click', () => { void guard(async () => {
    if (needPassphrase()) return;
    if (cachedVault && Date.now() - cachedVault.at < CACHE_MS) { const c = cachedVault; await importText(c.text, 'Retrieve failed', c.via, c.notes); return; } cachedVault = null;
    // V17.6.2 — is repository authorization available? Reuse a valid session; otherwise (central access) start the supported GitHub sign-in. Without central access this is a no-op and the V17.6.1 routes below apply.
    const acc = await ensureRepositoryAccess({ show: (html) => { const el = document.querySelector<HTMLElement>('#v17VaultResult'); if (el) el.innerHTML = html; return el; } });
    if (!acc.ok) { out(false, `Retrieve failed: ${acc.message}`); return; }
    if (acc.mode === 'central') { res().innerHTML = box('warn', 'Signed in. Reading the encrypted vault from the repository through the central repository access service…');
      const c = await retrieveVaultFile({ location: { owner: secrets.githubOwner, repo: secrets.githubRepo, branch: secrets.githubBranch || 'main' }, vaultPath: secrets.vaultPath, defaultPath: DEFAULT_VAULT_PATH, savedToken: '', override: repository(), overrideVia: 'repository-broker' });
      if (!c.ok) { out(false, `Retrieve failed: ${c.message}`); return; } await importText(c.text, 'Retrieve failed', c.via, c.notes); return; }
    // V17.6.3 — a device without a token reads the PUBLISHED copy (same origin, no credential). A device with a token keeps the V17.6.1 routes and falls back to the published copy before it asks for a sign-in.
    const tryPublished = async (): Promise<VaultRetrieval | null> => { const pr = publishedRepo(); if (!publishedEnabled() || !pr) return null; return retrieveVaultFile({ location: { owner: secrets.githubOwner, repo: secrets.githubRepo, branch: secrets.githubBranch || 'main' }, vaultPath: secrets.vaultPath, defaultPath: DEFAULT_VAULT_PATH, savedToken: '', override: pr, overrideVia: 'repository-published' }); };
    if (!secrets.githubToken && publishedEnabled() && !hasRepositoryOverride()) { res().innerHTML = box('warn', 'Reading the encrypted vault from the published copy of the repository…'); const p = await tryPublished();
      if (p && p.ok) { await importText(p.text, 'Retrieve failed', p.via, p.notes); return; } if (p && p.kind !== 'file-not-found') { out(false, `Retrieve failed: ${p.notes.length ? `${p.notes.join(' ')} Your saved settings were not changed.` : p.message}`); return; } }
    let r: VaultRetrieval = await retrieveVaultFile({ location: { owner: secrets.githubOwner, repo: secrets.githubRepo, branch: secrets.githubBranch || 'main' }, vaultPath: secrets.vaultPath, defaultPath: DEFAULT_VAULT_PATH, savedToken: secrets.githubToken, override: hasRepositoryOverride() ? repository() : null });
    if (!r.ok && SIGN_IN_CAN_HELP.includes(r.kind) && !hasRepositoryOverride() && secrets.githubToken && publishedEnabled()) { const p = await tryPublished(); if (p && p.ok) { await importText(p.text, 'Retrieve failed', p.via, [...p.notes, 'The access token saved on this device was not usable, so the published copy was read instead.']); return; } }
    if (!r.ok && SIGN_IN_CAN_HELP.includes(r.kind) && !hasRepositoryOverride()) { // the repository needs a credential this device does not have — ask the administrator-enabled GitHub sign-in (never a shortcut around GitHub's access control)
      const cfg = await fetchBootstrapConfig();
      if (cfg.state === 'invalid') { out(false, `Retrieve failed: ${r.message} (The GitHub sign-in recovery is configured incorrectly — ${cfg.message}. Ask your administrator to correct sql-assistant-data/vault-bootstrap.config.json.)`); return; }
      if (cfg.state === 'enabled') { const s = await signIn(cfg.config); if (!s) return; r = s; }
    }
    if (!r.ok) { out(false, `Retrieve failed: ${r.message}${r.notes.length && r.kind !== 'token-rejected' ? ` ${r.notes.join(' ')}` : ''}`); return; }
    await importText(r.text, 'Retrieve failed', r.via, r.notes); }); });
  root.querySelector('#importVaultFile')!.addEventListener('change', async (ev) => { const el = ev.target as HTMLInputElement; const f = el.files?.[0]; if (!f) return; await guard(async () => { if (needPassphrase()) return; let text = ''; try { text = await f.text(); } catch { out(false, 'Import failed: the file could not be read. Nothing on this device was changed.'); return; } await importText(text, 'Import failed', 'file'); }); el.value = ''; });
}
