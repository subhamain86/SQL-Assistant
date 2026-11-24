/**
 * V17.7.3 — USAGE ANALYTICS CONFIGURATION (public, deployed next to index.html; changing it never needs a rebuild).
 *
 * `sql-assistant-data/analytics.config.json`, written by the deploy workflow from repository variables (see docs/ANALYTICS.md) or placed by the administrator:
 *
 *   { "analytics": { "enabled": true, "provider": "service", "serviceUrl": "https://sql-assistant-analytics.example.org",
 *                    "inactivityTimeout": 300, "collectUserIdentity": false, "applicationVersion": "", "adminAuthenticationEnabled": true, "adminSessionTimeout": 900 } }
 *
 * The dotted names of the requirement also work as flat keys ("analytics.enabled": true, …). Times are in SECONDS.
 *   analytics.enabled                    false (default) = nothing is collected and the dashboard is unavailable
 *   analytics.provider                   "service" (the SQL Assistant analytics service, server/analytics-service.mjs) · "repository" (V17.7.4: NO server — encrypted files in the repository, see docs/ANALYTICS_SERVERLESS.md) · "none"
 *   analytics.repositoryPath             (repository provider) the folder below sql-assistant-data/ that holds the encrypted data (default sql-assistant-data/analytics)
 *   analytics.retentionDays              (repository provider) data older than this is removed by the administrator's Compact (30 … 3650, default 400)
 *   analytics.publicKey                  (repository provider, optional) { "kid": …, "jwk": { kty, crv, x, y } } — pins the administrator's PUBLIC key so devices do not have to trust the key file in the repository
 *   analytics.serviceUrl                 the https address of that service (http only for localhost)
 *   analytics.inactivityTimeout          active usage pauses after this long without an interaction (5 … 3600, default 300)
 *   analytics.collectUserIdentity        false (default) = a random per-device id only; true = additionally the GitHub login of a signed-in user (central access) as the user label
 *   analytics.applicationVersion         the version label reported with the usage (default: the version of this build)
 *   analytics.adminAuthenticationEnabled true (default). false = the in-app dashboard is NOT available at all (usage is still collected). There is deliberately no setting that opens the dashboard without the password
 *   analytics.adminSessionTimeout        the dashboard locks after this long without an interaction (10 … 28800, default 900)
 *
 * THE ADMINISTRATOR PASSWORD IS NOT HERE AND MUST NOT BE: this file is public. A file that contains anything password-, secret- or token-like is refused as a whole (and the password must be rotated).
 * Pure logic with injectable I/O (tested in Node). Every problem means "analytics is off" — never an error for the user and never a reason to stop SQL Assistant.
 */
import { normalizeRelayUrl, deployedFileUrl } from './bootstrapAuth';
import { APP_VERSION } from '../sync/schemaFormat'; import { parsePublicJwk, type PublicJwk } from './analyticsCrypto'; import { validAnalyticsPath, DEFAULT_ANALYTICS_PATH } from './analyticsRepo';

export const ANALYTICS_CONFIG_RELATIVE_PATH = 'sql-assistant-data/analytics.config.json';
export const MAX_ANALYTICS_CONFIG_BYTES = 16 * 1024;
export interface ServiceAnalyticsConfig { enabled: true; provider: 'service'; serviceUrl: string; inactivityTimeout: number; collectUserIdentity: boolean; applicationVersion: string; adminAuthenticationEnabled: boolean; adminSessionTimeout: number; }
/** V17.7.4: the serverless provider — encrypted files in the repository; `publicKey` is the optional pin. */
export interface RepositoryAnalyticsConfig { enabled: true; provider: 'repository'; repositoryPath: string; retentionDays: number; publicKey: { kid: string; jwk: PublicJwk } | null; inactivityTimeout: number; collectUserIdentity: boolean; applicationVersion: string; adminAuthenticationEnabled: boolean; adminSessionTimeout: number; }
export type AnalyticsConfig = ServiceAnalyticsConfig | RepositoryAnalyticsConfig;
export type AnalyticsConfigState = { state: 'unknown' } | { state: 'disabled'; reason: string } | { state: 'invalid'; message: string } | { state: 'enabled'; config: AnalyticsConfig };
export const DEFAULT_INACTIVITY_SECONDS = 300; export const DEFAULT_ADMIN_SESSION_SECONDS = 900;
const KEYS = ['enabled', 'provider', 'serviceUrl', 'inactivityTimeout', 'collectUserIdentity', 'applicationVersion', 'adminAuthenticationEnabled', 'adminSessionTimeout', 'repositoryPath', 'retentionDays', 'publicKey'] as const;
const stripBom = (t: string) => t.replace(/^\uFEFF/, ''); const looksLikeHtml = (t: string) => /^\s*</.test(t);
const SECRETISH = /pass(?:word|phrase)?|secret|token|credential|api[-_]?key|private[-_]?key|hash/i;
const VERSION = /^[0-9A-Za-z.+_-]{1,32}$/;

/** Walks every key of the file: a public configuration must not carry a secret of any kind. */
function secretKey(o: unknown, depth = 0): string | null {
  if (!o || typeof o !== 'object' || depth > 4) return null;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) { if (SECRETISH.test(k)) return k; const inner = secretKey(v, depth + 1); if (inner) return inner; }
  return null;
}
/** V17.7.4: a PUBLIC file must not carry key material that is private: a JWK with "d" (or the RSA private members), a PEM private key, or a wrapped key file (kdf + ct). */
function privateKeyMaterial(o: unknown, depth = 0): boolean {
  if (typeof o === 'string') return /PRIVATE KEY|pkcs8/i.test(o); if (!o || typeof o !== 'object' || depth > 5) return false; const r = o as Record<string, unknown>;
  if (typeof r.kty === 'string' && ['d', 'p', 'q', 'dp', 'dq', 'qi'].some((k) => k in r)) return true; if ('kdf' in r && 'ct' in r) return true; return Object.values(r).some((v) => privateKeyMaterial(v, depth + 1));
}
const num = (v: unknown, name: string, dflt: number, lo: number, hi: number): number | string => { if (v === undefined || v === null || v === '') return dflt; if (typeof v !== 'number' || !Number.isFinite(v)) return `"${name}" must be a number of seconds`; return Math.min(Math.max(Math.round(v), lo), hi); };
const bool = (v: unknown, name: string, dflt: boolean): boolean | string => { if (v === undefined || v === null) return dflt; return typeof v === 'boolean' ? v : `"${name}" must be true or false`; };

export function parseAnalyticsConfig(text: string): AnalyticsConfigState {
  const t = stripBom(String(text ?? '')).trim(); if (!t) return { state: 'disabled', reason: 'no configuration' };
  let j: unknown; try { j = JSON.parse(t); } catch { return { state: 'invalid', message: 'the file is not valid JSON' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { state: 'invalid', message: 'the file must contain one JSON object' };
  const sk = secretKey(j); if (sk) return { state: 'invalid', message: `the file is public and must not contain a password, secret or token ("${sk.slice(0, 40)}"). Remove it, and rotate the administrator password if it was ever written here` };
  if (privateKeyMaterial(j)) return { state: 'invalid', message: 'the file is public and must not contain a private key (a JWK with "d", a PEM private key or a wrapped key file). Remove it' };
  const root = j as Record<string, unknown>; const nested = root.analytics; if (nested !== undefined && (typeof nested !== 'object' || nested === null || Array.isArray(nested))) return { state: 'invalid', message: '"analytics" must be an object' };
  const o: Record<string, unknown> = {}; for (const k of KEYS) { const flat = root[`analytics.${k}`]; const n = nested ? (nested as Record<string, unknown>)[k] : undefined; if (n !== undefined) o[k] = n; else if (flat !== undefined) o[k] = flat; }
  if (o.enabled === undefined || o.enabled === false) return { state: 'disabled', reason: 'analytics.enabled is not true' }; if (o.enabled !== true) return { state: 'invalid', message: '"enabled" must be true or false' };
  const provider = o.provider === undefined ? 'service' : o.provider; if (provider === 'none') return { state: 'disabled', reason: 'analytics.provider is "none"' }; if (provider !== 'service' && provider !== 'repository') return { state: 'invalid', message: '"provider" must be "service", "repository" or "none"' };
  if (provider === 'repository') return parseRepositoryConfig(o);
  const url = normalizeRelayUrl(o.serviceUrl); if (!url) return { state: 'invalid', message: '"serviceUrl" must be the https address of the analytics service (http only for localhost) without credentials, query or hash' };
  const inact = num(o.inactivityTimeout, 'inactivityTimeout', DEFAULT_INACTIVITY_SECONDS, 5, 3600); if (typeof inact === 'string') return { state: 'invalid', message: inact };
  const sess = num(o.adminSessionTimeout, 'adminSessionTimeout', DEFAULT_ADMIN_SESSION_SECONDS, 10, 28800); if (typeof sess === 'string') return { state: 'invalid', message: sess };
  const ident = bool(o.collectUserIdentity, 'collectUserIdentity', false); if (typeof ident === 'string') return { state: 'invalid', message: ident };
  const auth = bool(o.adminAuthenticationEnabled, 'adminAuthenticationEnabled', true); if (typeof auth === 'string') return { state: 'invalid', message: auth };
  let version = APP_VERSION; if (o.applicationVersion !== undefined && o.applicationVersion !== null && o.applicationVersion !== '' && o.applicationVersion !== 'auto') { if (typeof o.applicationVersion !== 'string' || !VERSION.test(o.applicationVersion)) return { state: 'invalid', message: '"applicationVersion" may contain only letters, digits and . + _ - (at most 32 characters)' }; version = o.applicationVersion; }
  return { state: 'enabled', config: { enabled: true, provider: 'service', serviceUrl: url, inactivityTimeout: inact, collectUserIdentity: ident, applicationVersion: version, adminAuthenticationEnabled: auth, adminSessionTimeout: sess } };
}
/** the common keys of both providers, validated once */
function parseRepositoryConfig(o: Record<string, unknown>): AnalyticsConfigState {
  const path = o.repositoryPath === undefined || o.repositoryPath === null || o.repositoryPath === '' ? DEFAULT_ANALYTICS_PATH : o.repositoryPath; if (!validAnalyticsPath(path)) return { state: 'invalid', message: '"repositoryPath" must be a folder below sql-assistant-data/ made of letters, digits, "." "_" "-" (for example sql-assistant-data/analytics)' };
  const keep = num(o.retentionDays, 'retentionDays', 400, 30, 3650); if (typeof keep === 'string') return { state: 'invalid', message: keep.replace('of seconds', 'of days') };
  const inact = num(o.inactivityTimeout, 'inactivityTimeout', DEFAULT_INACTIVITY_SECONDS, 5, 3600); if (typeof inact === 'string') return { state: 'invalid', message: inact };
  const sess = num(o.adminSessionTimeout, 'adminSessionTimeout', DEFAULT_ADMIN_SESSION_SECONDS, 10, 28800); if (typeof sess === 'string') return { state: 'invalid', message: sess };
  const ident = bool(o.collectUserIdentity, 'collectUserIdentity', false); if (typeof ident === 'string') return { state: 'invalid', message: ident };
  const auth = bool(o.adminAuthenticationEnabled, 'adminAuthenticationEnabled', true); if (typeof auth === 'string') return { state: 'invalid', message: auth };
  let version = APP_VERSION; if (o.applicationVersion !== undefined && o.applicationVersion !== null && o.applicationVersion !== '' && o.applicationVersion !== 'auto') { if (typeof o.applicationVersion !== 'string' || !VERSION.test(o.applicationVersion)) return { state: 'invalid', message: '"applicationVersion" may contain only letters, digits and . + _ - (at most 32 characters)' }; version = o.applicationVersion; }
  let publicKey: RepositoryAnalyticsConfig['publicKey'] = null; if (o.publicKey !== undefined && o.publicKey !== null) { const k = o.publicKey as Record<string, unknown>; const jwk = k && typeof k === 'object' ? parsePublicJwk(k.jwk) : null; if (!jwk || typeof k.kid !== 'string' || !/^[A-Za-z0-9_-]{4,24}$/.test(k.kid) || Object.keys(k).sort().join(',') !== 'jwk,kid') return { state: 'invalid', message: '"publicKey" must be { "kid": …, "jwk": { "kty": "EC", "crv": "P-256", "x": …, "y": … } } — the PUBLIC key only' }; publicKey = { kid: k.kid, jwk }; }
  return { state: 'enabled', config: { enabled: true, provider: 'repository', repositoryPath: path, retentionDays: keep, publicKey, inactivityTimeout: inact, collectUserIdentity: ident, applicationVersion: version, adminAuthenticationEnabled: auth, adminSessionTimeout: sess } };
}
export const analyticsConfigUrl = (pageUrl: string): string | null => deployedFileUrl(pageUrl, ANALYTICS_CONFIG_RELATIVE_PATH);
/** Reads the deployment setting. Anything but a valid, enabled file means "analytics is off" (an INVALID file is reported to the administrator on the Analytics page, never to ordinary users as an error). */
export async function fetchAnalyticsConfig(d: { pageUrl?: string; fetchFn?: typeof fetch; timeoutMs?: number } = {}): Promise<AnalyticsConfigState> {
  const pageUrl = d.pageUrl ?? (typeof location !== 'undefined' ? location.href : ''); const url = analyticsConfigUrl(pageUrl); if (!url) return { state: 'disabled', reason: 'no deployed configuration' };
  const f: typeof fetch = d.fetchFn ?? ((u, i) => globalThis.fetch(u, i)); const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), d.timeoutMs ?? 5000);
  try { const r = await f(url, { method: 'GET', cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: ctl.signal }); if (!r.ok) return { state: 'disabled', reason: 'no deployed configuration' };
    const text = await r.text(); if (text.length > MAX_ANALYTICS_CONFIG_BYTES || looksLikeHtml(text)) return { state: 'disabled', reason: 'no deployed configuration' }; return parseAnalyticsConfig(text);
  } catch { return { state: 'disabled', reason: 'the configuration could not be read' }; } finally { clearTimeout(tm); }
}
