#!/usr/bin/env node
/**
 * SQL Assistant V17.6.3 — builds the CENTRAL TOKEN VAULT (run by .github/workflows/publish-data.yml on request, in a trusted GitHub Actions run).
 *
 * The vault is the SAME encrypted file SQL Assistant's "Push Secret Vault to Repository" writes (AES-256-GCM, PBKDF2-SHA-256 310 000 iterations, additional data "sql-assistant/secret-vault/v1") and
 * "Pull Secret Vault to Repository" reads; it holds one thing: a READ-ONLY GitHub token for the repository, so that a device can also use the GitHub API without anyone typing or copying a token.
 * Reading the repository does NOT need it (devices read the published copy) — it is for devices that must call the API.
 *
 *   env  SQLA_DEVICE_TOKEN    the token to deliver. Must be fine-grained, ONE repository, Contents: READ-ONLY. A token that can write is refused (SQLA_ALLOW_WRITE_TOKEN=true overrides — do not).
 *        SQLA_VAULT_PASSPHRASE the passphrase (≥ 10 characters). Without it the built-in default is used ONLY when SQLA_ALLOW_DEFAULT_VAULT_PASSPHRASE=true (it is public: it is in the application).
 *        SQLA_REPOSITORY / SQLA_BRANCH   default basware/sk-ap-sql-assistant / main        SQLA_VAULT_PATH   default sql-assistant-data/vault/secret-vault.v17.enc.json
 *   The token is checked with GitHub first (never printed; GitHub's own message and the SSO / permission headers are). Output: the vault file. Prints no secret.
 */
import { pbkdf2Sync, createCipheriv, randomBytes } from 'node:crypto'; import { writeFileSync, mkdirSync } from 'node:fs'; import { dirname, resolve } from 'node:path'; import { fileURLToPath } from 'node:url';
export const DEFAULT_VAULT_PASSPHRASE = 'xG71lfp1NHZVZ4WVWCPe'; const AAD = Buffer.from('sql-assistant/secret-vault/v1'); const ITER = 310_000; const SAFE = /^[A-Za-z0-9_.-]{1,100}$/;
export const isPlausibleToken = (t) => /^[\x21-\x7E]{20,255}$/.test(t);
/** The same envelope src/v17/services/cryptoBox.ts writes. */
export function sealVault(plain, pass) {
  if (!pass || pass.length < 10) throw new Error('The vault passphrase must be at least 10 characters.'); const salt = randomBytes(16); const iv = randomBytes(12); const key = pbkdf2Sync(Buffer.from(pass, 'utf8'), salt, ITER, 32, 'sha256');
  const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(AAD); const ct = Buffer.concat([c.update(Buffer.from(plain, 'utf8')), c.final(), c.getAuthTag()]);
  return { v: 1, alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iter: ITER, salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') };
}
export async function checkToken({ token, owner, repo, base = 'https://api.github.com', fetchFn = globalThis.fetch, allowWrite = false }) {
  const r = await fetchFn(`${base}/repos/${owner}/${repo}`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'sql-assistant-central-vault' }, redirect: 'error' }).catch(() => null);
  if (!r) throw new Error('GitHub could not be reached, so the token could not be checked.');
  if (!r.ok) { let m = ''; try { m = String((await r.clone().json())?.message || ''); } catch { /* */ } m = m.replace(/\bgh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/g, '[token]').slice(0, 200); const sso = r.headers.get('x-github-sso') ? ' · X-GitHub-SSO header present (SSO authorization required)' : '';
    throw new Error(`GitHub refused the device token (HTTP ${r.status}${m ? `: ${m}` : ''}${sso}). A fine-grained token needs the organization as resource owner, approval where the organization requires it, and Contents: Read on the repository.`); }
  const j = await r.json().catch(() => null); const p = j && typeof j.permissions === 'object' ? j.permissions : null; const canWrite = p ? !!(p.push || p.admin || p.maintain) : null;
  if (canWrite === true && !allowWrite) throw new Error('The device token can WRITE to the repository. Every device that can load the site would receive it. Create a token with Contents: Read-only and use that (or set SQLA_ALLOW_WRITE_TOKEN=true if you accept that risk).');
  return { canWrite };
}
export async function buildCentralVault(env = process.env, fetchFn = globalThis.fetch) {
  const token = String(env.SQLA_DEVICE_TOKEN || '').trim(); const [owner, repo] = String(env.SQLA_REPOSITORY || 'basware/sk-ap-sql-assistant').split('/'); const branch = String(env.SQLA_BRANCH || 'main'); const vaultPath = String(env.SQLA_VAULT_PATH || 'sql-assistant-data/vault/secret-vault.v17.enc.json');
  if (!token) throw new Error('The secret SQLA_DEVICE_TOKEN is not set — there is no token to deliver. (Reading the repository does not need one.)'); if (!isPlausibleToken(token)) throw new Error('SQLA_DEVICE_TOKEN does not look like a GitHub token (spaces, or too short).');
  if (!SAFE.test(owner || '') || !SAFE.test(repo || '')) throw new Error('SQLA_REPOSITORY must be owner/repo.'); if (!/^sql-assistant-data\/.+\.json$/.test(vaultPath) || vaultPath.includes('..') || /\.config\.json$/.test(vaultPath)) throw new Error('SQLA_VAULT_PATH must be a *.json file below sql-assistant-data/.');
  let pass = String(env.SQLA_VAULT_PASSPHRASE || ''); let usedDefault = false;
  if (!pass) { if (env.SQLA_ALLOW_DEFAULT_VAULT_PASSPHRASE !== 'true') throw new Error('No SQLA_VAULT_PASSPHRASE is set. The built-in default passphrase is PUBLIC (it ships inside the application), so a vault protected only by it is only as private as the site and the repository. Set the secret SQLA_VAULT_PASSPHRASE, or — if you accept that — the variable SQLA_ALLOW_DEFAULT_VAULT_PASSPHRASE=true.'); pass = DEFAULT_VAULT_PASSPHRASE; usedDefault = true; }
  const base = String(env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, ''); if (base !== 'https://api.github.com') { const u = new URL(base); if (!(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) throw new Error('GITHUB_API_BASE may only be overridden for http://localhost (tests).'); }
  const access = await checkToken({ token, owner, repo, base, fetchFn, allowWrite: env.SQLA_ALLOW_WRITE_TOKEN === 'true' });
  const secrets = { githubOwner: owner, githubRepo: repo, githubBranch: branch, schemaPath: 'sql-assistant-data/schemas/registry.json', vaultPath, githubToken: token, aiApiKey: '' };
  const envelope = sealVault(JSON.stringify(secrets), pass); const text = `${JSON.stringify(envelope, null, 2)}\n`; if (text.includes(token)) throw new Error('Safety check failed: the vault would contain the token in readable form. Nothing was written.');
  return { text, vaultPath, usedDefault, canWrite: access.canWrite };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { const r = await buildCentralVault(); const out = resolve(process.env.SQLA_OUT_ROOT || '.', r.vaultPath); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, r.text);
    process.stdout.write(`Central token vault written to ${r.vaultPath} (read-only token ${r.canWrite === false ? 'confirmed' : 'permission not reported by GitHub'}; passphrase from ${r.usedDefault ? 'the built-in default' : 'the secret SQLA_VAULT_PASSPHRASE'}).\n`); if (r.usedDefault) process.stdout.write('::warning title=Central token vault::The vault is protected only by the PUBLIC built-in default passphrase — it is only as private as the site and the repository.\n');
  } catch (e) { process.stderr.write(`::error title=Central token vault::${e.message}\n`); process.exit(1); }
}
