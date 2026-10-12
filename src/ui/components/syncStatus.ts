/**
 * V17.5.2 — one honest status block for repository synchronization, used by Schema → Pull Schema and Settings → Schema Management.
 * It states what is TRUE on this device: connection, saved schema passphrase, last successful pull / publish, schemas whose latest content is NOT yet in the
 * repository, unresolved conflicts and the latest failure. A local edit therefore always shows as "not yet published" until a publish really succeeded.
 */
import { icon } from './icons'; import { e } from '../dom'; import { services, secrets, vaultProblem } from '../context';
const when = (iso: string | null) => (iso ? iso.replace('T', ' ').slice(0, 16) + ' UTC' : 'never');
/** V17.5.5: `passphrase:false` leaves out the Vault-passphrase chip and `location:false` leaves out the repository name and file path — used by the Pull Schema card, where those values stay hidden until the reveal button is used. Both default to true (Settings → Schema Management is unchanged). */
export function syncStatusHtml(opts: { passphrase?: boolean; location?: boolean } = {}): string {
  const showPass = opts.passphrase !== false; const showLoc = opts.location !== false;
  let st; try { st = services().sync.status(); } catch { return ''; } const pass = services().passphrase;
  const connected = !!secrets.githubOwner && !!secrets.githubRepo && !!secrets.githubToken; const chip = (cls: string, ic: Parameters<typeof icon>[0], text: string) => `<span class="chip ${cls}">${icon(ic, 12)} ${text}</span>`;
  const conn = vaultProblem ? chip('chip-invalid', 'alert-triangle', 'Saved repository settings cannot be opened on this device') : connected ? chip('chip-active', 'github', showLoc ? `Repository ${e(secrets.githubOwner)}/${e(secrets.githubRepo)} · token saved` : 'GitHub repository connected · token saved') : chip('chip-invalid', 'alert-triangle', 'No repository connection on this device');
  const pp = pass.isUnreadable() ? chip('chip-invalid', 'key', 'Vault passphrase saved but unreadable here — enter it again') : pass.hasSaved() ? chip('chip-active', 'key', 'Vault passphrase available on this device (encrypted)') : chip('chip-inactive', 'key', 'No Vault passphrase on this device');
  const pend = st.pending.length ? chip('chip-legacy', 'upload', `${st.pending.length} schema${st.pending.length === 1 ? '' : 's'} with changes not yet published: ${e(st.pending.slice(0, 4).join(', '))}${st.pending.length > 4 ? ', …' : ''}`) : chip('chip-active', 'check', 'Nothing waiting to be published');
  const cf = st.conflicts ? chip('chip-invalid', 'shield-alert', `${st.conflicts} unresolved conflict${st.conflicts === 1 ? '' : 's'}`) : '';
  const err = st.lastError ? `<div class="hint pull-status-err">${icon('alert-triangle', 12)} Latest synchronization problem (${e(when(st.lastError.at))}): ${e(st.lastError.message)}</div>` : '';
  const times = `last download ${e(when(st.lastPullAt))} · last publish ${e(when(st.lastPushAt))}`; const line = showLoc ? `${st.mode === 'encrypted' ? 'Encrypted file' : 'Plain schema file'}: <code>${e(st.path)}</code> · ${times}` : `Last download ${e(when(st.lastPullAt))} · last publish ${e(when(st.lastPushAt))}`;
  return `<div class="pull-status" id="syncStatusBlock" aria-live="polite"><div class="chip-row">${conn}${showPass ? pp : ''}${pend}${cf}</div><div class="hint">${line}</div>${err}</div>`;
}
