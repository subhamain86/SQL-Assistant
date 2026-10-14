#!/usr/bin/env node
/**
 * SQL Assistant V17.6.2 — verifies the centrally managed GitHub PAT (the GitHub Actions secret SQLA_GITHUB_PAT) from the trusted environment that is allowed to use it: a GitHub Actions run.
 * Used by .github/workflows/verify-repo-pat.yml (weekly + on demand). It tells an administrator BEFORE users notice whether the secret is
 *   missing · rejected (invalid, expired or revoked) · insufficiently privileged (cannot see the repository, read-only, SSO not authorized) · about to expire.
 * It never prints the PAT, never writes anything to the repository, and uses no dependency.
 *
 *   SQLA_GITHUB_PAT=… SQLA_REPOSITORY=basware/sk-ap-sql-assistant SQLA_BRANCH=main node scripts/verify-pat.mjs
 *   SQLA_WARN_DAYS   warn when the PAT expires within this many days (default 14)
 *   SQLA_REQUIRE_WRITE  "0" accepts a read-only PAT (default: write is required, because the Secret Vault and schema publication write)
 */
import { fileURLToPath } from 'node:url';
const SAFE = /^[A-Za-z0-9_.-]{1,100}$/;
/** Returns { ok, level: 'ok' | 'warning' | 'error', code, message }. `fetchFn` / `base` are test seams. */
export async function verifyPat(env = process.env, fetchFn = globalThis.fetch) {
  const pat = String(env.SQLA_GITHUB_PAT || '').trim(); const [owner, repo] = String(env.SQLA_REPOSITORY || 'basware/sk-ap-sql-assistant').split('/'); const branch = String(env.SQLA_BRANCH || 'main');
  const warnDays = Number(env.SQLA_WARN_DAYS) || 14; const needWrite = env.SQLA_REQUIRE_WRITE !== '0';
  let base = String(env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, ''); if (base !== 'https://api.github.com') { const u = new URL(base); if (!(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) return { ok: false, level: 'error', code: 'bad-config', message: 'GITHUB_API_BASE may only be overridden for http://localhost (tests).' }; }
  // GitHub's own words for a refusal + the headers that tell the causes apart. Token-like strings are stripped; the PAT is never printed.
  const why = async (r) => { let m = ''; try { m = String((await r.clone().json())?.message || ''); } catch { m = ''; } m = m.replace(/\bgh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/g, '[token]').slice(0, 400); const h = (k) => r.headers.get(k); const bits = [];
    if (m) bits.push(`GitHub says: "${m}"`); if (h('x-github-sso')) bits.push('header X-GitHub-SSO is present (organization SSO authorization is required for this token)'); if (h('x-ratelimit-remaining') === '0') bits.push('rate limit exhausted'); if (h('x-accepted-github-permissions')) bits.push(`permissions GitHub accepts for this call: ${h('x-accepted-github-permissions')}`);
    return bits.length ? ` ${bits.join(' · ')}.` : ''; };
  // Safe upstream identifiers (a Microsoft Entra / Conditional Access answer is passed through GitHub's message): the AADSTS code and the trace / correlation GUIDs — nothing else is extracted.
  const upstream = async (r) => { let m = ''; try { m = String((await r.clone().json())?.message || ''); } catch { m = ''; } const g = (re) => (m.match(re) || [])[1] || ''; return { code: g(/\b(AADSTS\d{4,6})\b/), trace: g(/Trace ID:\s*([0-9a-fA-F-]{36})/), correlation: g(/Correlation ID:\s*([0-9a-fA-F-]{36})/) }; };
  const bad = (code, message) => ({ ok: false, level: 'error', code, message });
  if (!pat) return bad('pat-missing', 'The GitHub Actions secret SQLA_GITHUB_PAT is not set (or this workflow cannot read it). Create it under Settings → Secrets and variables → Actions → New repository secret.');
  if (!SAFE.test(owner || '') || !SAFE.test(repo || '')) return bad('bad-config', 'SQLA_REPOSITORY must be owner/repo.');
  const get = async (path) => { const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000); try { return await fetchFn(`${base}${path}`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${pat}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'sql-assistant-verify-pat' }, signal: ctl.signal, redirect: 'error' }); } catch { return null; } finally { clearTimeout(tm); } };
  const r = await get(`/repos/${owner}/${repo}`); if (!r) return bad('unreachable', 'GitHub could not be reached, so the PAT could not be verified. Run the workflow again.');
  if (r.status === 401) return bad('pat-rejected', 'GitHub rejected SQLA_GITHUB_PAT: it is invalid, expired or revoked. Create a new fine-grained PAT and replace the secret.');
  if (r.status === 403) { // V17.6.9: the failure is reported as what it is — a refused verification (HTTP 403) with the upstream diagnostic — not as "accepted"; no cause is named unless the upstream response says so
    const detail = await why(r); const up = await upstream(r); const ids = [up.code && `upstream error ${up.code}`, up.trace && `trace id ${up.trace}`, up.correlation && `correlation id ${up.correlation}`].filter(Boolean);
    return bad(r.headers.get('x-github-sso') ? 'pat-sso' : 'pat-insufficient', `Repository credential verification failed with HTTP 403. Review the enterprise authorization and Conditional Access diagnostic.${detail}${ids.length ? ` Diagnostic ids (safe, supplied upstream): ${ids.join(' · ')}.` : ''} Possible causes (NOT verified — this response does not say which one applies): the token's approval request is still pending, SSO is not authorized for the token, an enterprise / organization policy restricts personal access tokens, an IP allow list blocks the runner, the token's resource owner is not the organization${up.code ? `, or the policy named in the upstream message (${up.code})` : ''}. Retry: running this check again does not help until an administrator changes the authorization or the policy — SQL Assistant does not and must not bypass it. See docs/PUBLISHED_DATA.md → \"Troubleshooting a 403\". (Reading and publishing the data folder does NOT need this PAT — see publish-data.yml.)`); }
  if (r.status === 404) return bad('pat-insufficient', `SQLA_GITHUB_PAT cannot see the repository (HTTP 404): wrong SQLA_REPOSITORY, or the fine-grained PAT's resource owner is not the organization, or it was not granted this repository, or its approval is pending.${await why(r)}`);
  if (!r.ok) return bad('unexpected', `GitHub answered HTTP ${r.status}.`);
  let j = null; try { j = await r.json(); } catch { j = null; } const p = j && typeof j.permissions === 'object' ? j.permissions : null; const canWrite = p ? !!(p.push || p.admin || p.maintain) : null;
  if (needWrite && canWrite === false) return bad('pat-readonly', 'SQLA_GITHUB_PAT has READ-ONLY access: Pull works but publishing schemas and pushing the Secret Vault will fail. Grant Contents: Read and write.');
  const b = await get(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`); if (b && b.status === 404) return bad('branch-not-found', `The branch "${branch}" does not exist in the repository.`);
  const exp = r.headers.get('github-authentication-token-expiration'); const t = exp ? Date.parse(String(exp).replace(' UTC', 'Z').replace(' ', 'T')) : NaN;
  if (!Number.isNaN(t)) { const days = Math.floor((t - Date.now()) / 86400000); if (days <= warnDays) return { ok: true, level: 'warning', code: 'expiring', message: `SQLA_GITHUB_PAT works but expires in ${Math.max(days, 0)} day(s) (${new Date(t).toISOString().slice(0, 10)}). Create a new PAT and replace the secret before then.` }; return { ok: true, level: 'ok', code: 'ok', message: `SQLA_GITHUB_PAT is valid for ${owner}/${repo} (${canWrite === null ? 'write permission not reported' : canWrite ? 'read and write' : 'read-only'}); it expires on ${new Date(t).toISOString().slice(0, 10)}.` }; }
  return { ok: true, level: 'ok', code: 'ok', message: `SQLA_GITHUB_PAT is valid for ${owner}/${repo} (${canWrite === null ? 'write permission not reported' : canWrite ? 'read and write' : 'read-only'}). GitHub reported no expiry date.` };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = await verifyPat(); const tag = r.level === 'error' ? '::error title=Central PAT::' : r.level === 'warning' ? '::warning title=Central PAT::' : '';
  // V17.6.9: a failure names its stage, component, configuration key (never its value) and whether a plain retry can help.
  const retry = ['unreachable', 'unexpected'].includes(r.code) ? 'a plain re-run may help (transient)' : 'not until the cause is fixed (a re-run gives the same answer)';
  process.stdout.write(`${tag}${r.message}${r.level === 'error' ? ` [Stage: PAT verification · Component: scripts/verify-pat.mjs · Configuration key: SQLA_GITHUB_PAT (value never printed) · Code: ${r.code} · Retry: ${retry}]` : ''}\n`); process.exit(r.ok ? 0 : 1);
}
