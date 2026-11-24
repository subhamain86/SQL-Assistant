/**
 * V17.6.2 — "is repository access available, and if not, get it" — ONE implementation used by Pull Schema, Pull Secret Vault, Push Secret Vault, the Settings synchronization buttons and the repository card.
 *
 *   · no central access configured (no repo-broker.config.json)  → nothing to do: the V17.6.1 token-on-this-device behaviour applies (mode 'local');
 *   · central access and a valid session already on this browser → reused (mode 'central'); nothing is asked of the user;
 *   · central access and no / an expired session               → GitHub sign-in (the broker runs GitHub's device flow): the card shows the code and the real github.com address, the page continues by itself
 *                                                               when the user approves; Cancel and leaving the page stop it. The result is a broker session — never a GitHub token, never the PAT.
 * Nothing here stores a secret: the session goes to sessionStorage through context.ts, and every message is free of tokens, codes and file contents.
 */
import { icon } from './components/icons'; import { e } from './dom';
import { brokerConfig, refreshBrokerConfig, brokerSession, saveBrokerSession, hasRepositoryOverride, secrets } from './context';
import { runBrokerSignIn, type BrokerSignInCode, type BrokerSession } from '../v17/services/repoBroker';

export type AccessResult = { ok: true; mode: 'local' | 'central' | 'test'; session: BrokerSession | null; signedIn: boolean } | { ok: false; message: string; cancelled: boolean };
export interface AccessUi { /** puts HTML on screen and returns the element that now holds it (null when the page was left) */ show: (html: string) => HTMLElement | null; }
const box = (kind: 'ok' | 'warn' | 'err', html: string) => `<div class="issue-box ${kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : ''} mini" role="${kind === 'err' ? 'alert' : 'status'}">${icon(kind === 'ok' ? 'check' : 'alert-triangle', 14)}<div>${html}</div></div>`;
export const signInPromptHtml = (c: BrokerSignInCode): string => box('warn', `<strong>Sign in to GitHub to use the repository.</strong> Open <a href="${e(c.verificationUri)}" target="_blank" rel="noopener noreferrer">${e(c.verificationUri.replace(/^https:\/\//, ''))}</a>, enter the code <code id="brokerUserCode">${e(c.userCode)}</code> and sign in with the GitHub account that may read this repository. This page continues by itself once you approve (the code is valid for about ${Math.max(1, Math.round(c.expiresInSec / 60))} minutes). <button type="button" class="btn btn-ghost btn-sm" id="brokerSignInCancel">Cancel</button><br><span class="hint">No token is copied to this device: the repository is read and written by the organization's central repository access service, which uses its own GitHub PAT. Your sign-in only proves that your account may use the repository.</span>`);
let inflight: Promise<AccessResult> | null = null; let cancelCurrent: (() => void) | null = null;
export const cancelSignIn = (): void => cancelCurrent?.();

/** Makes sure repository access is usable. Never throws. Several callers at once share one sign-in. */
export function ensureRepositoryAccess(ui: AccessUi): Promise<AccessResult> {
  if (inflight) return inflight;
  inflight = (async (): Promise<AccessResult> => {
    if (hasRepositoryOverride()) return { ok: true, mode: 'test', session: null, signedIn: false };
    if (brokerConfig.state === 'unknown') await refreshBrokerConfig();
    if (brokerConfig.state === 'invalid') return { ok: false, cancelled: false, message: `The central repository access configuration is not valid (${brokerConfig.message}). Ask your administrator to correct sql-assistant-data/repo-broker.config.json. Nothing was changed.` };
    if (brokerConfig.state !== 'enabled') return { ok: true, mode: 'local', session: null, signedIn: false };
    const have = brokerSession(); if (have) return { ok: true, mode: 'central', session: have, signedIn: false };
    if (!secrets.githubOwner || !secrets.githubRepo) return { ok: false, cancelled: false, message: 'The repository is not configured. Ask an administrator to check the GitHub repository card. Nothing was changed.' };
    const ctl = new AbortController(); cancelCurrent = () => ctl.abort(); let host: HTMLElement | null = null; let watch: ReturnType<typeof setInterval> | null = null;
    try {
      host = ui.show(box('warn', 'Starting the GitHub sign-in…')); watch = setInterval(() => { if (host && !host.isConnected) ctl.abort(); }, 1000); // leaving the page ends the sign-in
      const r = await runBrokerSignIn({ url: brokerConfig.config.url, owner: secrets.githubOwner, repo: secrets.githubRepo }, (c) => { host = ui.show(signInPromptHtml(c)) || host; host?.querySelector('#brokerSignInCancel')?.addEventListener('click', () => ctl.abort()); }, { signal: ctl.signal });
      if (!r.ok) return { ok: false, cancelled: r.kind === 'cancelled', message: r.message };
      saveBrokerSession(r.session); return { ok: true, mode: 'central', session: r.session, signedIn: true };
    } finally { if (watch) clearInterval(watch); cancelCurrent = null; }
  })().finally(() => { inflight = null; });
  return inflight;
}
