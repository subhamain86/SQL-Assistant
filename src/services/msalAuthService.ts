/** M365 Copilot Enterprise authentication — Authorization Code + PKCE, token in sessionStorage only. */
const TOKEN_CACHE_KEY = 'sqla.copilotToken.v16';
const PKCE_VERIFIER_KEY = 'sqla.copilotPkceVerifier.v16';
export interface CopilotAuthConfig { tenantId: string; clientId: string; scope: string; }
interface CachedToken { accessToken: string; scope: string; expiresAt: number; }
function b64url(bytes: Uint8Array): string { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function randomString(n: number): string { return b64url(crypto.getRandomValues(new Uint8Array(n))).slice(0, n); }
async function sha256b64url(input: string): Promise<string> { return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input) as BufferSource))); }
function readCached(scope: string): string | null { try { const raw = sessionStorage.getItem(TOKEN_CACHE_KEY); if (!raw) return null; const c = JSON.parse(raw) as CachedToken; if (c.scope !== scope || Date.now() >= c.expiresAt - 30000) return null; return c.accessToken; } catch { return null; } }
function writeCached(t: CachedToken): void { try { sessionStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify(t)); } catch { /* non-fatal */ } }
export function clearCachedCopilotToken(): void { try { sessionStorage.removeItem(TOKEN_CACHE_KEY); } catch { /* non-fatal */ } }
function authority(tenantId: string): string { return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0`; }
function popupForCode(url: string, redirectUri: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const popup = window.open(url, 'm365-copilot-signin', 'width=520,height=680');
    if (!popup) { reject(new Error('The sign-in popup was blocked by the browser. Allow popups for this site and try again.')); return; }
    const origin = new URL(redirectUri).origin; let settled = false;
    const cleanup = () => { window.removeEventListener('message', onMsg); clearInterval(poll); if (!popup.closed) popup.close(); };
    const onMsg = (ev: MessageEvent) => { if (ev.origin !== origin) return; const d = ev.data as { type?: string; code?: string; error?: string }; if (!d || d.type !== 'm365-copilot-auth-result') return; settled = true; cleanup(); if (d.error) reject(new Error(d.error)); else if (d.code) resolve(d.code); else reject(new Error('Sign-in did not return an authorization code.')); };
    window.addEventListener('message', onMsg);
    const poll = setInterval(() => { if (popup.closed && !settled) { cleanup(); reject(new Error('Sign-in was cancelled (the popup window was closed).')); } }, 500);
  });
}
export async function acquireCopilotToken(config: CopilotAuthConfig): Promise<string> {
  if (!config.tenantId || !config.clientId || !config.scope) throw new Error('M365 Copilot Enterprise is not fully configured (Tenant ID, Client ID, and Scope are all required).');
  const cached = readCached(config.scope); if (cached) return cached;
  const redirectUri = `${window.location.origin}${window.location.pathname}#copilot-auth-callback`;
  const verifier = randomString(64); const challenge = await sha256b64url(verifier); const state = randomString(24);
  try { sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier); } catch { /* non-fatal */ }
  const u = new URL(`${authority(config.tenantId)}/authorize`);
  Object.entries({ client_id: config.clientId, response_type: 'code', redirect_uri: redirectUri, response_mode: 'fragment', scope: config.scope, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' }).forEach(([k, v]) => u.searchParams.set(k, v));
  const code = await popupForCode(u.toString(), redirectUri);
  const res = await fetch(`${authority(config.tenantId)}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, scope: config.scope }).toString() });
  if (!res.ok) { let d = ''; try { const j = await res.json(); d = j.error_description ? ` (${String(j.error_description).split('\r\n')[0]})` : ''; } catch { /* ignore */ } throw new Error(`Microsoft identity platform rejected the sign-in (HTTP ${res.status})${d}.`); }
  const j = await res.json(); const token = j.access_token as string; if (!token) throw new Error('Microsoft identity platform did not return an access token.');
  writeCached({ accessToken: token, scope: config.scope, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 }); return token;
}
export function handleCopilotAuthCallbackIfPresent(): boolean {
  if (!window.location.hash.includes('copilot-auth-callback') && !window.location.hash.includes('code=')) return false;
  if (!window.opener) return false;
  const hash = window.location.hash.replace(/^#\/?/, '').replace('copilot-auth-callback', '');
  const params = new URLSearchParams(hash.startsWith('?') ? hash.slice(1) : hash);
  try { window.opener.postMessage({ type: 'm365-copilot-auth-result', code: params.get('code'), error: params.get('error_description') || params.get('error') }, window.location.origin); } catch { /* ignore */ }
  window.close(); return true;
}
