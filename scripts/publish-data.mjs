#!/usr/bin/env node
/**
 * SQL Assistant V17.6.3 — PUBLISH THE DATA FOLDER next to the app (run by .github/workflows/publish-data.yml with the built-in GITHUB_TOKEN — no PAT).
 *
 * Copies `<src>/sql-assistant-data/**.json` of the repository into `<dest>/sql-assistant-data/` (the folder the site is served from, e.g. dist/) and writes the marker
 * `<dest>/sql-assistant-data/published.json` LAST: { format, formatVersion, publishedAt, sourceCommit, sourceRepository, files: { path: sha256 } }.
 * The browser (src/v17/services/publishedData.ts) accepts a file only when its SHA-256 equals the marker's, so a half-finished or stale publication is refused instead of applied.
 *
 * Safety rules (each tested):
 *   · only *.json files below sql-assistant-data/; no dot-files, no symlinks, no path escapes, ≤ 8 MB each, ≤ 500 files;
 *   · NEVER a deployment configuration file (`*.config.json`: repo-broker / vault-bootstrap) — those are written by an administrator's deploy step; copying them from repository data would let a repository
 *     write redirect the application's sign-in or broker address;
 *   · a file that contains a GitHub token / private key in readable form is NOT published and the run FAILS (an encrypted vault contains none);
 *   · files that an earlier publication listed and the repository no longer has are removed from the site; files this script did not publish (configuration files) are never touched.
 *   usage: node scripts/publish-data.mjs --src . --dest dist --commit <sha> --repository owner/repo
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path'; import { createHash } from 'node:crypto'; import { fileURLToPath } from 'node:url';
export const ROOT = 'sql-assistant-data'; export const MARKER = `${ROOT}/published.json`; export const MAX_FILE = 8 * 1024 * 1024; export const MAX_FILES = 500;
const CRED = /\bgh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const okName = (p) => /^[A-Za-z0-9._\-/]+$/.test(p) && !p.includes('//') && !p.split('/').some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.')) && /\.json$/i.test(p) && !/\.config\.json$/i.test(p) && p !== MARKER && p.length <= 255;
const sha = (b) => createHash('sha256').update(b).digest('hex');
// V17.7.1: user-submitted queries that are still awaiting an administrator's decision (…/knowledge/submissions.json) are NOT published to the site: unreviewed SQL is read by the administrator through an authenticated repository connection only, never served to every device.
const UNPUBLISHED = /(^|\/)knowledge\/submissions\.json$/i;
function walk(dir, base, out, skipped) {
  for (const name of readdirSync(dir)) { const full = join(dir, name); const st = lstatSync(full); const rel = relative(base, full).split(sep).join('/');
    if (st.isSymbolicLink()) { skipped.push(`${rel}: symbolic link`); continue; } if (st.isDirectory()) { if (name.startsWith('.')) { skipped.push(`${rel}/: hidden folder`); continue; } walk(full, base, out, skipped); continue; }
    if (UNPUBLISHED.test(rel)) { skipped.push(`${rel}: unreviewed query submissions are not published`); continue; }
    if (!okName(rel)) { skipped.push(`${rel}: not an allowed file name (only *.json; no *.config.json; no dot-files)`); continue; } if (st.size > MAX_FILE) { skipped.push(`${rel}: larger than ${MAX_FILE} bytes`); continue; } out.push(rel); }
}
/** Returns { files, skipped, removed, marker }. Throws Error (with a message free of file contents) when a file must not be published. */
export function publish({ src, dest, commit, repository, now = () => new Date().toISOString() }) {
  const srcData = resolve(src, ROOT); if (!existsSync(srcData)) throw new Error(`There is no ${ROOT}/ folder in the repository to publish.`);
  if (!/^[0-9a-f]{7,64}$/.test(String(commit || ''))) throw new Error('--commit must be a commit id.'); if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(String(repository || ''))) throw new Error('--repository must be owner/repo.');
  const rels = []; const skipped = []; walk(srcData, resolve(src), rels, skipped); rels.sort(); if (rels.length > MAX_FILES) throw new Error(`More than ${MAX_FILES} files — refusing to publish.`);
  const files = {}; const blobs = new Map();
  for (const rel of rels) { const buf = readFileSync(join(resolve(src), rel)); const text = buf.toString('utf8'); if (CRED.test(text)) throw new Error(`${rel} contains a GitHub token or private key in readable form — NOT published. Remove it from the repository (and revoke the token); encrypted vault files contain none.`);
    try { JSON.parse(text); } catch { skipped.push(`${rel}: not valid JSON`); continue; } files[rel] = sha(buf); blobs.set(rel, buf); }
  const outData = resolve(dest, ROOT); mkdirSync(outData, { recursive: true }); const old = join(dest, MARKER); let removed = [];
  if (existsSync(old)) { try { const prev = JSON.parse(readFileSync(old, 'utf8')); for (const p of Object.keys(prev.files || {})) if (!(p in files) && okName(p)) { rmSync(join(resolve(dest), p), { force: true }); removed.push(p); } } catch { /* a damaged old marker is simply replaced */ } }
  for (const [rel, buf] of blobs) { const to = join(resolve(dest), rel); mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, buf); }
  if (existsSync(old)) { try { const prev = JSON.parse(readFileSync(old, 'utf8')); const same = prev && prev.files && JSON.stringify(Object.entries(prev.files).sort()) === JSON.stringify(Object.entries(files).sort()); if (same && prev.format === 'sqla-published-data') return { files, skipped, removed, marker: prev, unchanged: true }; } catch { /* rewrite */ } } // identical content ⇒ no new marker (no commit churn)
  const marker = { format: 'sqla-published-data', formatVersion: 1, publishedAt: now(), sourceCommit: commit, sourceRepository: repository, files };
  writeFileSync(join(resolve(dest), MARKER), `${JSON.stringify(marker, null, 2)}\n`); // LAST — the browser trusts only what the marker lists
  return { files, skipped, removed, marker };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = process.argv.slice(2); const get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  try { const r = publish({ src: get('--src', '.'), dest: get('--dest', 'dist'), commit: get('--commit', process.env.GITHUB_SHA), repository: get('--repository', process.env.GITHUB_REPOSITORY) });
    process.stdout.write(`${r.unchanged ? 'Nothing changed — the publication is already current' : 'Published'} (${Object.keys(r.files).length} file(s)) in ${get('--dest', 'dist')}/${ROOT}/ ; removed ${r.removed.length} stale file(s).\n`); r.skipped.forEach((s) => process.stdout.write(`::warning title=Not published::${s}\n`));
  } catch (e) { process.stderr.write(`::error title=Publish data::${e.message}\n`); process.exit(1); }
}
