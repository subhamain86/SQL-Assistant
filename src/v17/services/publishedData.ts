/**
 * V17.6.3 — PUBLISHED DATA: read the repository's `sql-assistant-data/` files from the SITE (same origin as index.html) instead of from the GitHub API.
 *
 * Why. The repository is private (GitHub Enterprise Cloud). Reading it through the API needs a credential, and a credential needs a PAT that an organization may refuse (approval, SSO, policy), a
 * trusted backend (V17.6.2 broker) or a copy of a token on every device. None of that is needed for READING if a trusted workflow publishes a copy of the data folder next to the app.
 * The workflow `.github/workflows/publish-data.yml` (GITHUB_TOKEN only — no PAT) mirrors `sql-assistant-data/**` of the repository into `<site>/sql-assistant-data/` and writes the marker
 * `sql-assistant-data/published.json` LAST. This module is the browser side: it believes nothing that the marker does not vouch for.
 *
 *   · the marker lists every published file with its SHA-256; a file is returned only when what the site served hashes to the listed value (a half-finished publication or a stale CDN copy is refused,
 *     never applied),
 *   · a file the marker does not list is "not published" (null), exactly like a file missing from the repository,
 *   · the site's single-page-app fallback (index.html answered for an unknown address) is recognised and treated as "not published",
 *   · writing is impossible here: a device without a token can read, and is told it needs a token (or the workflow / a clone) to publish.
 * Deliberately conservative: without a valid marker the feature is off and V17.6.2 behaviour is unchanged. No crypto except SHA-256, no storage, no secret, no GitHub address. Pure logic with
 * injectable I/O (tested in Node).
 */
import { RepositoryError, type SchemaRepository, type RepoFile } from './githubClient';
import { deployedFileUrl } from './bootstrapAuth';

export const PUBLISHED_ROOT = 'sql-assistant-data/';
export const PUBLISHED_MARKER_PATH = 'sql-assistant-data/published.json';
export const PUBLISHED_FORMAT = 'sqla-published-data';
export const MAX_MARKER_BYTES = 256 * 1024; export const MAX_PUBLISHED_FILE_BYTES = 8 * 1024 * 1024;
export interface PublishedMarker { publishedAt: string; sourceCommit: string; sourceRepository: string; files: Record<string, string>; }
export type PublishedState = { state: 'unknown' } | { state: 'none' } | { state: 'invalid'; message: string } | { state: 'available'; marker: PublishedMarker };
const looksLikeHtml = (t: string) => /^\s*</.test(t); const HEX64 = /^[0-9a-f]{64}$/; const COMMIT = /^[0-9a-f]{7,64}$/; const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
/** A path the publication may contain: a *.json file below sql-assistant-data/, never a configuration file (those are deployed by an administrator, not published from the repository) and never the marker. */
export function publishablePath(p: unknown): p is string {
  return typeof p === 'string' && p.length <= 255 && p.startsWith(PUBLISHED_ROOT) && /^[A-Za-z0-9._\-/]+$/.test(p) && !p.includes('//') && !p.split('/').some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))
    && /\.json$/i.test(p) && !/\.config\.json$/i.test(p) && p !== PUBLISHED_MARKER_PATH;
}
export function parsePublishedMarker(text: string): PublishedState {
  const t = String(text ?? '').replace(/^\uFEFF/, '').trim(); if (!t) return { state: 'none' };
  let j: Record<string, unknown>; try { const p = JSON.parse(t); if (!p || typeof p !== 'object' || Array.isArray(p)) return { state: 'invalid', message: 'the file must contain one JSON object' }; j = p as Record<string, unknown>; } catch { return { state: 'invalid', message: 'the file is not valid JSON' }; }
  if (j.format !== PUBLISHED_FORMAT) return { state: 'invalid', message: 'it is not a SQL Assistant publication marker' }; if (j.formatVersion !== 1) return { state: 'invalid', message: 'it was written in a newer or unknown format version — update SQL Assistant' };
  if (typeof j.publishedAt !== 'string' || Number.isNaN(Date.parse(j.publishedAt))) return { state: 'invalid', message: '"publishedAt" is missing or not a date' };
  if (typeof j.sourceCommit !== 'string' || !COMMIT.test(j.sourceCommit)) return { state: 'invalid', message: '"sourceCommit" is missing or not a commit id' };
  if (typeof j.sourceRepository !== 'string' || !REPO.test(j.sourceRepository)) return { state: 'invalid', message: '"sourceRepository" must be owner/repo' };
  const f = j.files; if (!f || typeof f !== 'object' || Array.isArray(f)) return { state: 'invalid', message: '"files" must be an object' }; const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(f as Record<string, unknown>)) { if (!publishablePath(k)) return { state: 'invalid', message: 'it lists a file that may not be published' }; if (typeof v !== 'string' || !HEX64.test(v)) return { state: 'invalid', message: 'a file hash is not a SHA-256 value' }; files[k] = v; }
  if (Object.keys(files).length > 500) return { state: 'invalid', message: 'it lists too many files' };
  return { state: 'available', marker: { publishedAt: j.publishedAt, sourceCommit: j.sourceCommit, sourceRepository: j.sourceRepository, files } };
}
export async function sha256Hex(text: string): Promise<string> { const d = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text) as BufferSource); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''); }

export interface PublishedDeps { pageUrl?: string; fetchFn?: typeof fetch; timeoutMs?: number; }
const pageOf = (d: PublishedDeps) => d.pageUrl ?? (typeof location !== 'undefined' ? location.href : '');
const fetcher = (d: PublishedDeps): typeof fetch => d.fetchFn ?? ((u, i) => globalThis.fetch(u, i));
/** GET one file of the site. null = not there (404, the app's fallback page, empty); throws RepositoryError for a timeout / network failure / unreadable answer. */
async function getSiteFile(d: PublishedDeps, path: string, maxBytes: number): Promise<string | null> {
  const url = deployedFileUrl(pageOf(d), path); if (!url) return null; const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), d.timeoutMs ?? 12_000);
  try {
    const r = await fetcher(d)(url, { method: 'GET', cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: ctl.signal });
    if (r.status === 404 || r.status === 410) return null; if (r.status === 401 || r.status === 403) throw new RepositoryError('The site refused the published data (it asked for a sign-in or denied access). Open SQL Assistant from its normal address and sign in to the site first.', 'permission', r.status);
    if (!r.ok) throw new RepositoryError(`The site answered HTTP ${r.status} for the published data.`, 'http', r.status);
    const text = await r.text(); if (text.length > maxBytes) throw new RepositoryError('A published file is larger than SQL Assistant accepts.', 'http'); if (!text.trim() || looksLikeHtml(text)) return null; return text;
  } catch (e) {
    if (e instanceof RepositoryError) throw e; if ((e as Error)?.name === 'AbortError') throw new RepositoryError('The site did not answer within the time limit while reading the published data.', 'timeout');
    throw new RepositoryError('The published data could not be reached (network problem).', 'network');
  } finally { clearTimeout(tm); }
}
/** Reads the marker. 'none' (no marker / the page is opened from disk / any transport problem) means the feature is simply not used; an INVALID marker is reported. */
export async function fetchPublishedMarker(d: PublishedDeps = {}): Promise<PublishedState> {
  try { const t = await getSiteFile(d, PUBLISHED_MARKER_PATH, MAX_MARKER_BYTES); return t === null ? { state: 'none' } : parsePublishedMarker(t); } catch { return { state: 'none' }; }
}
export const NO_WRITE_MESSAGE = 'This device reads the published copy of the repository and holds no GitHub access token, so it cannot publish. Set a token (Schema → Pull Schema → GitHub repository card), or publish from a clone / the "Publish SQL Assistant data" workflow.';
/** A read-only SchemaRepository over the published copy. The sha it reports is derived from the content hash (it is only ever compared with itself). */
export function publishedRepository(marker: PublishedMarker, d: PublishedDeps = {}): SchemaRepository {
  return {
    describe: `${marker.sourceRepository} — published copy of ${marker.publishedAt.slice(0, 16).replace('T', ' ')} UTC (commit ${marker.sourceCommit.slice(0, 7)})`,
    async read(path: string): Promise<RepoFile | null> {
      if (!publishablePath(path)) return null; const want = marker.files[path]; if (!want) return null; // not published = not in the repository at publication time
      const text = await getSiteFile(d, path, MAX_PUBLISHED_FILE_BYTES);
      if (text === null) throw new RepositoryError('The publication lists this file but the site does not serve it. The publication may still be in progress — try again in a minute.', 'http');
      if ((await sha256Hex(text)) !== want) throw new RepositoryError('The published copy of this file does not match its publication record (a publication may be in progress, or the site serves an older copy). Nothing was applied — try again in a minute.', 'http');
      return { text, sha: `pub${want.slice(0, 37)}` };
    },
    async write(): Promise<string> { throw new RepositoryError(NO_WRITE_MESSAGE, 'config'); },
  };
}
export const describePublication = (m: PublishedMarker) => `published ${m.publishedAt.slice(0, 16).replace('T', ' ')} UTC · commit ${m.sourceCommit.slice(0, 7)} · ${Object.keys(m.files).length} file(s)`;
