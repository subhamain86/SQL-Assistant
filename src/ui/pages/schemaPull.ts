/**
 * V17.5.5 / V17.5.6 — Hamburger → Schema → Pull Schema.
 * Three cards: (1) GitHub repository (schema synchronization), (2) Pull Schema from GitHub, (3) Pull Secret Vault to Repository.
 * Card 2 has ONE action: Pull Schema. It calls SyncService.pullSchema() — the existing validated, transactional pull — against the repository, branch and schema file of Card 1.
 * There is no passphrase field: a passphrase-protected repository file can only be opened with a Vault passphrase that is already saved on this device (the decryption requirement is
 * not bypassed), and a file that cannot be opened is reported — never treated as missing. A failed pull never changes the local schemas (the registry write is validated and rolled back).
 */
import { icon } from '../components/icons'; import { store } from '../state'; import { services } from '../context'; import { e } from '../dom';
import { redactSecrets } from '../../v17/errors/appErrors'; import { repoCardHtml, wireRepoCard, vaultPullCardHtml, wireVaultPullCard } from './schemaRepoCards';
import type { PullOutcome } from '../../v17/sync/syncService'; import { ensureRepositoryAccess } from '../repoAccess'; import { brokerEnabled, publishedEnabled, secrets } from '../context'; import { setGithubPullNote, type PullNote } from '../githubState';
const UNCHANGED = 'The existing local schema has not been changed.';
export const PULL_MESSAGES = {
  unavailable: 'The synchronized schema could not be retrieved. Please verify the repository connection and try again.',
  decryption: `The schema file could not be decrypted. ${UNCHANGED}`,
  validation: `The synchronized schema failed validation. ${UNCHANGED}`,
  older: 'The synchronized schema is older than the current local schema and was not applied.',
  success: 'Schema pulled and validated successfully.',
  partial: 'Schema pull completed only partly.',
  auth: `The repository rejected the access token (it is invalid or has expired). ${UNCHANGED}`,
  permission: `The access token is not allowed to read the repository (it needs Contents: read), or GitHub's rate limit was reached. ${UNCHANGED}`,
  timeout: `GitHub did not answer in time. ${UNCHANGED}`,
  incompatible: `The synchronized schema uses a format this version of SQL Assistant cannot read. ${UNCHANGED}`,
  storage: `The schema could not be saved on this device. ${UNCHANGED}`,
  noToken: `No GitHub access token is set on this device. ${UNCHANGED}`,
  // V17.6.2 — central repository access
  signin: `Repository access needs a GitHub sign-in (none is active on this browser, or it expired). ${UNCHANGED}`,
  patMissing: `The central repository access is not set up: the access service has no GitHub PAT. ${UNCHANGED}`,
  patRejected: `GitHub rejected the central PAT (it is invalid, expired or revoked). ${UNCHANGED}`,
  patInsufficient: `The central PAT is not allowed to read the configured repository. ${UNCHANGED}`,
};
let view = ''; let busy = false;
const box = (kind: 'ok' | 'warn' | 'err', html: string) => `<div class="issue-box ${kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : 'err'} mini" role="${kind === 'err' ? 'alert' : 'status'}">${icon(kind === 'ok' ? 'check' : 'alert-triangle', 14)}<div>${html}</div></div>`;
const cardButton = () => `<button type="button" class="btn btn-outline btn-sm pull-open-vault">${icon('key', 13)} Go to the GitHub repository card</button>`;
function openCard(): void { document.querySelector<HTMLElement>('#schemaRepoCardMount [data-v1754-repo-card]')?.scrollIntoView({ block: 'center' }); document.querySelector<HTMLButtonElement>('#changeTokenBtn')?.focus(); }
/** The message for a pull that failed — it always says what failed and what to do, and that the local schema is unchanged. */
function problemHtml(o: PullOutcome): string {
  const detail = o.fileProblem ? `<br><span class="hint">Detail: ${e(o.fileProblem)}</span>` : '';
  switch (o.errorKind) {
    case 'signin': return box('err', `<strong>${e(PULL_MESSAGES.signin)}</strong><br>Select <em>Pull Schema</em> again to sign in with GitHub, or use <em>Sign in with GitHub</em> in the GitHub repository card above. ${cardButton()}${detail}`);
    case 'pat-missing': return box('err', `<strong>${e(PULL_MESSAGES.patMissing)}</strong><br>An administrator must configure the GitHub Actions secret <code>SQLA_GITHUB_PAT</code> and redeploy the repository access service. No action on this device can fix it.${detail}`);
    case 'pat-rejected': return box('err', `<strong>${e(PULL_MESSAGES.patRejected)}</strong><br>An administrator must replace the GitHub Actions secret <code>SQLA_GITHUB_PAT</code> with a valid fine-grained PAT and redeploy the repository access service. No action on this device can fix it.${detail}`);
    case 'pat-insufficient': return box('err', `<strong>${e(PULL_MESSAGES.patInsufficient)}</strong><br>The PAT needs <em>Contents: Read</em> (and <em>Read and write</em> to publish) on the repository, and — if the organization uses SSO — must be authorized for it. An administrator must fix the PAT, or the repository in the GitHub repository card.${detail}`);
    case 'config': if (brokerEnabled()) return box('err', `<strong>${e(PULL_MESSAGES.signin)}</strong><br>Select <em>Pull Schema</em> again to sign in with GitHub, or check the GitHub repository card above. ${cardButton()}${detail}`); return box('err', `<strong>${e(PULL_MESSAGES.noToken)}</strong><br>Select <em>Set Token</em> in the GitHub repository card above (Admin Password), or import the token with the <em>Pull Secret Vault to Repository</em> card below (<em>Import encrypted file</em> needs no token). ${cardButton()}`);
    case 'auth': return box('err', `<strong>${e(PULL_MESSAGES.auth)}</strong><br>Create a new GitHub token with <em>Contents: read</em> for this repository and set it in the GitHub repository card. ${cardButton()}${detail}`);
    case 'permission': if (publishedEnabled() && !secrets.githubToken) return box('err', `<strong>The site refused the published copy of the repository. ${e(UNCHANGED)}</strong><br>Open SQL Assistant from its normal address and sign in to the site first, then try again.${detail}`); if (brokerEnabled()) return box('err', `<strong>GitHub or the repository access service is limiting requests, or your account may not use the repository. ${e(UNCHANGED)}</strong><br>Wait a few minutes and try again.${detail}`); return box('err', `<strong>${e(PULL_MESSAGES.permission)}</strong><br>Ask the repository owner to grant the token <em>Contents: read</em> access, or wait a few minutes and try again. ${cardButton()}${detail}`);
    case 'timeout': return box('err', `<strong>${e(PULL_MESSAGES.timeout)}</strong><br>Check your network connection and try again.${detail}`);
    case 'not-found': return box('err', `<strong>${e(PULL_MESSAGES.unavailable)}</strong><br>The repository, branch or folder was not found for this token. Check that the token belongs to an account that can read the repository. ${UNCHANGED}${detail}`);
    case 'passphrase': return box('err', `<strong>${e(o.fileProblem?.startsWith('The repository holds') ? 'The repository file is passphrase-protected.' : 'The Vault passphrase saved on this device does not open the repository file.')}</strong><br>${e(o.fileProblem?.startsWith('The repository holds') ? o.fileProblem : `It may have been changed. ${UNCHANGED} Ask the administrator to publish the schema without a passphrase (Settings → Schema Management → Sync with GitHub Now on a device that has none saved), or clear this site's saved data in the browser and pull again.`)}`);
    case 'decryption': return box('err', `<strong>${e(PULL_MESSAGES.decryption)}</strong><br>The repository file is damaged. Ask the administrator to publish the schema again.${detail}`);
    case 'incompatible': return box('err', `<strong>${e(PULL_MESSAGES.incompatible)}</strong><br>Update SQL Assistant on this device (use the latest release) and pull again.${detail}`);
    case 'validation': return box('err', `<strong>${e(PULL_MESSAGES.validation)}</strong><br>Ask the administrator to correct and republish the schema.${detail}`);
    case 'storage': return box('err', `<strong>${e(PULL_MESSAGES.storage)}</strong><br>Free some browser storage or allow site data for this site, then pull again.${detail}`);
    default: return box('err', `<strong>${e(PULL_MESSAGES.unavailable)}</strong><br>${e(UNCHANGED)} Check your network connection and the GitHub repository card, then try again. ${cardButton()}${detail}`);
  }
}
/** The message for a pull that completed — success only when everything in the file was applied or already identical; kept / conflicting / rejected schemas make it a partial result. */
function resultHtml(o: PullOutcome): string {
  if (o.remoteMissing) return box('warn', `<strong>No schema file was found in the repository yet.</strong><br>${e(UNCHANGED)} Publish it first: on a device that has the schemas use <em>Sync with GitHub Now</em> (Settings → Schema Management).`);
  const a = services().schemas.active(); const applied = [...o.added.map((n) => `${n} (added)`), ...o.updated.map((n) => `${n} (updated)`)];
  const kept = o.localAhead.filter((n) => !o.unchanged.includes(n)); const conflicted = o.conflicts.map((c) => c.schemaName); const partial = kept.length > 0 || conflicted.length > 0 || o.rejected.length > 0;
  const detail = `${applied.length ? `Applied: ${e(applied.join(', '))}. ` : 'No schema content needed to change. '}Active schema: <strong>${e(a.name)}</strong> v${e(String(a.version))}.${kept.length ? `<br>${e(PULL_MESSAGES.older)} (${e(kept.join(', '))})` : ''}${conflicted.length ? `<br><strong>Not applied — changed on both sides:</strong> ${e(conflicted.join(', '))}. Resolve in Settings → Schema Management (<em>Use Local</em> / <em>Use Remote</em>).` : ''}${o.messages.length ? `<ul>${o.messages.slice(0, 6).map((m) => `<li>${e(m)}</li>`).join('')}</ul>` : ''}`;
  const tail = '<br><span class="hint">Manual Selectors, Describe What You Need, the offline NLU, SQL generation and the schema CASE/DECODE definitions now use the active schema.</span>';
  return box(partial ? 'warn' : 'ok', `<strong>${e(partial ? PULL_MESSAGES.partial : PULL_MESSAGES.success)}</strong><br>${detail}${tail}`);
}
/** V17.7.1 — the short, plain-text result of a pull (no HTML, no token): shown on Home and on the GitHub Repository page, and survives the page re-render a successful pull causes. */
export function pullSummary(o: PullOutcome | null): PullNote {
  const at = new Date().toISOString(); if (!o) return { kind: 'err', text: PULL_MESSAGES.unavailable, at };
  if (o.ok) { if (o.remoteMissing) return { kind: 'warn', text: `No schema file was found in the repository yet. ${UNCHANGED}`, at }; const partial = o.localAhead.filter((n) => !o.unchanged.includes(n)).length > 0 || o.conflicts.length > 0 || o.rejected.length > 0; return { kind: partial ? 'warn' : 'ok', text: partial ? PULL_MESSAGES.partial : PULL_MESSAGES.success, at }; }
  const byKind: Record<string, string> = { signin: PULL_MESSAGES.signin, 'pat-missing': PULL_MESSAGES.patMissing, 'pat-rejected': PULL_MESSAGES.patRejected, 'pat-insufficient': PULL_MESSAGES.patInsufficient, config: brokerEnabled() ? PULL_MESSAGES.signin : PULL_MESSAGES.noToken, auth: PULL_MESSAGES.auth, permission: PULL_MESSAGES.permission, timeout: PULL_MESSAGES.timeout, 'passphrase': `The protected repository file could not be opened with the secret saved on this device. ${UNCHANGED}`, decryption: PULL_MESSAGES.decryption, incompatible: PULL_MESSAGES.incompatible, validation: PULL_MESSAGES.validation, storage: PULL_MESSAGES.storage };
  return { kind: 'err', text: byKind[String(o.errorKind)] || `${PULL_MESSAGES.unavailable} ${UNCHANGED}`, at };
}
/**
 * V17.7.1 — "Pull Schema" from the Home page. The SAME sequence as the Pull Schema tab (repository authorization first, then SyncService.pullSchema() — validated, transactional, a failure never changes the local schemas);
 * only the display differs: a short result in the shared GitHub state. `accessHost` returns the element that shows the GitHub sign-in prompt when central access needs one.
 */
export async function pullSchemaFromHome(accessHost: () => HTMLElement | null): Promise<void> {
  if (busy) return; busy = true; setGithubPullNote({ kind: 'running', text: 'Pulling the schema from GitHub…', at: null });
  try {
    const acc = await ensureRepositoryAccess({ show: (html) => { const h = accessHost(); if (h) h.innerHTML = html; return h; } });
    if (!acc.ok) { setGithubPullNote({ kind: acc.cancelled ? 'warn' : 'err', text: acc.message, at: new Date().toISOString() }); return; }
    const out = await services().sync.pullSchema(); const n = pullSummary(out); setGithubPullNote(n);
    if (out.ok && !out.remoteMissing) store.pushToast(n.kind === 'warn' ? 'warning' : 'success', n.text);
  } catch (err) { setGithubPullNote({ kind: 'err', text: redactSecrets((err as Error)?.message || 'unexpected error', services().vault.knownSecrets()).slice(0, 240), at: new Date().toISOString() }); }
  finally { busy = false; }
}
/** The card currently on screen. A successful pull changes the schema registry, which makes the page re-render while the pull is still finishing — so the card is always looked up again, never kept across an await. */
const liveHost = (fallback?: HTMLElement) => document.querySelector<HTMLElement>('#schemaPullHost') || fallback || null;
async function pull(): Promise<void> {
  if (busy) return; busy = true; view = box('warn', 'Retrieving the schema from GitHub, validating it and synchronizing this device…'); paint(); // a new operation always starts clean — no stale message survives
  let out: PullOutcome | null = null;
  try {
    // V17.6.2: is repository authorization available? A valid session is reused; otherwise (central access) the GitHub sign-in starts here. Without central access this does nothing and the V17.6.1 token behaviour applies.
    const acc = await ensureRepositoryAccess({ show: (html) => { view = html; paint(); return document.querySelector<HTMLElement>('#pullResult'); } });
    if (!acc.ok) { view = box(acc.cancelled ? 'warn' : 'err', `<strong>${e(acc.message)}</strong>`); busy = false; const h0 = liveHost(); if (h0) renderPullPanel(h0); return; }
    view = box('warn', 'Retrieving the schema from GitHub, validating it and synchronizing this device…'); paint();
    out = await services().sync.pullSchema(); view = out.ok ? resultHtml(out) : problemHtml(out); }
  catch (err) { view = problemHtml({ ok: false, stage: null, fileProblem: redactSecrets((err as Error)?.message || 'unexpected error', services().vault.knownSecrets()), errorKind: null } as PullOutcome); }
  setGithubPullNote(pullSummary(out)); // V17.7.1: Home / GitHub Repository show the same result
  if (out?.ok && !out.remoteMissing) store.pushToast(view.includes('issue-box warn') ? 'warning' : 'success', view.includes('issue-box warn') ? PULL_MESSAGES.partial : PULL_MESSAGES.success);
  busy = false; const h = liveHost(); if (h) renderPullPanel(h); // re-render: the status chips (last download, nothing waiting …) now reflect the real result
}
function paint(): void {
  const host = liveHost(); if (!host) return; const r = host.querySelector<HTMLElement>('#pullResult'); if (r) r.innerHTML = view; host.querySelectorAll('.pull-open-vault').forEach((b) => { (b as HTMLElement).onclick = openCard; });
  const btn = host.querySelector<HTMLButtonElement>('#pullBtn'); if (btn) { btn.disabled = busy; btn.innerHTML = busy ? `${icon('refresh', 14)} Working…` : `${icon('download', 14)} Pull Schema`; }
}
function renderPullPanel(host: HTMLElement): void {
  host.innerHTML = `<div id="schemaPullMount"><div class="builder-panel"><h2>${icon('download', 16)} Pull Schema from GitHub</h2>
    <div class="row-actions"><button type="button" class="btn btn-primary" id="pullBtn">${icon('download', 14)} Pull Schema</button></div>
    <div id="pullResult" aria-live="polite">${view}</div></div></div>`;
  host.querySelector('#pullBtn')!.addEventListener('click', () => { void pull(); }); paint();
}
/** Schema → Pull Schema = the repository card, the schema pull, and the Secret Vault pull card — three independent mounts so one never wipes what was typed in another. */
export function renderSchemaPullTab(panel: HTMLElement): void {
  if (!busy) view = ''; // entering (or re-rendering) the page starts clean
  panel.innerHTML = '<div id="schemaRepoCardMount"></div><div id="schemaPullHost" class="mt"></div><div id="schemaVaultCardMount"></div>';
  const all = () => renderSchemaPullTab(panel);
  const repo = panel.querySelector<HTMLElement>('#schemaRepoCardMount')!; repo.innerHTML = repoCardHtml(); wireRepoCard(repo, all);
  renderPullPanel(panel.querySelector<HTMLElement>('#schemaPullHost')!);
  const vc = panel.querySelector<HTMLElement>('#schemaVaultCardMount')!; vc.innerHTML = vaultPullCardHtml(); wireVaultPullCard(vc, all);
}
/** Test hook / reset when the page is left. */
export function resetPullView(): void { view = ''; busy = false; }
