/**
 * V17.7.1 — the GitHub status section shown on the Home page (compact) and at the top of the GitHub Repository page. It only DISPLAYS the shared state of githubState.ts and offers the existing actions:
 * Pull Schema (the same pull as the Pull Schema tab), Sign in to GitHub (the existing ensureRepositoryAccess flow, central access only), Check connection (a read-only re-check) and a link to the repository settings.
 * It reuses the V17.7 panel, chip, hint and button styles — no new CSS. No token, code or file content is ever rendered here.
 */
import { icon } from '../components/icons'; import { e } from '../dom'; import { store, type Route } from '../state'; import { services, brokerEnabled } from '../context'; import { ensureRepositoryAccess } from '../repoAccess';
import { githubConn, githubPullNote, lastSyncAt, subscribeGithub, initGithubConnection, type GithubState } from '../githubState'; import { pullSchemaFromHome } from './schemaPull'; import { getSyncPrefs, SRC, TIME } from '../syncPrefs';
const CHIP: Record<GithubState, [string, string]> = { connected: ['chip-active', 'Connected'], published: ['chip-migrated', 'Read-only · published copy'], 'signin-required': ['chip-legacy', 'Sign-in needed'], 'not-configured': ['chip-inactive', 'Not set up'], checking: ['chip-inactive', 'Checking…'], idle: ['chip-inactive', 'Not checked yet'], rejected: ['chip-invalid', 'Token rejected'], 'no-access': ['chip-invalid', 'No access'], unreachable: ['chip-legacy', 'Unreachable'], error: ['chip-invalid', 'Problem'] };
const box = (kind: 'ok' | 'warn' | 'err', html: string) => `<div class="issue-box ${kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : ''} mini" role="${kind === 'err' ? 'alert' : 'status'}">${icon(kind === 'ok' ? 'check' : 'alert-triangle', 14)}<div>${html}</div></div>`;
const when = (iso: string | null): string => { if (!iso) return 'none yet'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? 'none yet' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };
/** The synchronization status in words: conflicts and unpublished local schemas come from the existing SyncService status; nothing here is computed from GitHub. */
function syncLine(): string {
  let st: ReturnType<ReturnType<typeof services>['sync']['status']> | null = null; try { st = services().sync.status(); } catch { st = null; } const p = getSyncPrefs();
  const parts: string[] = [`${SRC[p.source]} · ${TIME[p.time]}`]; if (st) { if (st.conflicts) parts.push(`${st.conflicts} conflict(s) need review (Settings → Schema Management)`); if (st.pending.length) parts.push(`${st.pending.length} local schema(s) not published yet`); if (st.lastError) parts.push(`last problem: ${st.lastError.message}`.slice(0, 200)); if (!st.conflicts && !st.pending.length && !st.lastError) parts.push('nothing waiting'); }
  return parts.join(' · ');
}
export function githubStatusHtml(opts: { onGithubPage?: boolean } = {}): string {
  const c = githubConn(); const [cls, label] = CHIP[c.state]; const n = githubPullNote(); const last = lastSyncAt(); const running = n.kind === 'running'; const needSignIn = c.state === 'signin-required' && brokerEnabled();
  return `<div class="builder-panel" data-github-status><h2>${icon('github', 16)} GitHub repository</h2>
    <div class="chip-row"><span class="chip ${cls}" id="ghStateChip">${e(label)}</span>${c.repo ? `<span class="chip chip-inactive" id="ghRepoChip">${e(c.repo)}</span>` : ''}${c.login ? `<span class="chip chip-inactive">${icon('user', 11)} ${e(c.login)}</span>` : ''}${c.state === 'connected' && c.canWrite === false ? '<span class="chip chip-legacy">read-only access</span>' : ''}</div>
    <p class="hint" id="ghStateMsg" role="status" aria-live="polite">${e(c.message)}${c.action ? ` <strong>${e(c.action)}</strong>` : ''}</p>
    <p class="hint" id="ghSyncLine">Repository synchronization: ${e(syncLine())}. Last successful synchronization: <strong id="ghLastSync">${e(when(last))}</strong>.${c.checkedAt ? ` Connection checked ${e(when(c.checkedAt))}.` : ''}</p>
    ${n.text ? box(n.kind === 'ok' ? 'ok' : n.kind === 'err' ? 'err' : 'warn', `<span id="ghPullNote">${e(n.text)}</span>${n.at && n.kind !== 'running' ? ` <span class="hint">(${e(when(n.at))})</span>` : ''}`) : ''}
    <div class="row-actions"><button type="button" class="btn btn-primary btn-sm" id="ghPullBtn" ${running ? 'disabled aria-busy="true"' : ''}>${icon('download', 14)} ${running ? 'Working…' : 'Pull Schema'}</button>${needSignIn ? `<button type="button" class="btn btn-primary btn-sm" id="ghSignInBtn">${icon('github', 14)} Sign in to GitHub</button>` : ''}<button type="button" class="btn btn-outline btn-sm" id="ghCheckBtn" ${c.state === 'checking' ? 'disabled' : ''}>${icon('refresh', 14)} Check connection</button>${opts.onGithubPage ? '' : `<button type="button" class="btn btn-outline btn-sm" id="ghOpenBtn">${icon('settings', 14)} GitHub repository settings</button>`}</div></div>`;
}
/** Renders the section into `root` and keeps it current. The sign-in prompt lives in its own element, so a state change never wipes a sign-in that is in progress. */
export function mountGithubStatus(root: HTMLElement, nav: (r: Route) => void, opts: { onGithubPage?: boolean } = {}): void {
  root.innerHTML = '<div data-gh-panel></div><div id="ghAccessHost" aria-live="polite"></div>'; const panel = root.querySelector<HTMLElement>('[data-gh-panel]')!; const host = root.querySelector<HTMLElement>('#ghAccessHost')!; let signing = false;
  const draw = (): void => {
    panel.innerHTML = githubStatusHtml(opts);
    panel.querySelector('#ghPullBtn')?.addEventListener('click', () => { host.innerHTML = ''; void pullSchemaFromHome(() => host); });
    panel.querySelector('#ghCheckBtn')?.addEventListener('click', () => { host.innerHTML = ''; void initGithubConnection({ force: true }); });
    panel.querySelector('#ghOpenBtn')?.addEventListener('click', () => nav('github'));
    panel.querySelector('#ghSignInBtn')?.addEventListener('click', () => { if (signing) return; signing = true; void ensureRepositoryAccess({ show: (html) => { host.innerHTML = html; return host; } }).then((r) => { if (!r.ok) { host.innerHTML = box(r.cancelled ? 'warn' : 'err', e(r.message)); return; } host.innerHTML = ''; store.pushToast('success', `Signed in as ${r.session?.login || 'GitHub user'} — repository access is available.`); return initGithubConnection({ force: true }); }).finally(() => { signing = false; if (root.isConnected) draw(); }); });
  };
  draw(); const off = subscribeGithub(() => { if (!root.isConnected) { off(); return; } if (!signing) draw(); });
  void initGithubConnection(); // a no-op while the start-up check is running or its answer is fresh
}
