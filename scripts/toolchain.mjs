/**
 * V17.7.4 — the ONE place that finds the TypeScript compiler. No npm, no registry, no network: a build only needs Node ≥ 20.
 *
 * Look-up order (the version must be EXACTLY the one package.json pins in devDependencies, currently 5.8.3 — a different version is skipped, never used silently):
 *   1. $TSC_PATH            — a TypeScript package folder, or its bin/tsc, or its lib/tsc.js (for an environment that already has the pinned compiler somewhere)
 *   2. tools/typescript/    — the COMMITTED copy that ships with this project (only the files tsc needs for tsconfig.json / tsconfig.test.json). Every file is verified against the SHA-256 list in
 *                             tools/typescript/CHECKSUMS.json; a modified or damaged copy is refused with the name of the file.
 *   3. node_modules/typescript (and $NODE_PATH) — an ordinary npm installation, if there is one.
 * Never an absolute path of a particular machine.
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'; import { join, dirname, resolve } from 'node:path'; import { createHash } from 'node:crypto';
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const pkgDirOf = (p) => { try { if (statSync(p).isDirectory()) return p; } catch { return p; } const d = dirname(p); return /[\\/](bin|lib)$/.test(d) ? dirname(d) : d; };
export const COMMITTED_DIR = 'tools/typescript';
/** → { ok: true, tsc, version, source } | { ok: false, message } */
export function resolveTypeScript(root) {
  const pin = (() => { try { return readJson(join(root, 'package.json')).devDependencies?.typescript; } catch { return undefined; } })();
  if (!/^\d+\.\d+\.\d+$/.test(String(pin))) return { ok: false, message: `package.json must pin TypeScript to an exact version (found ${JSON.stringify(pin)}).` };
  const candidates = []; if (process.env.TSC_PATH) candidates.push({ source: 'TSC_PATH', dir: pkgDirOf(resolve(process.env.TSC_PATH)), explicit: true });
  candidates.push({ source: `${COMMITTED_DIR} (committed)`, dir: join(root, COMMITTED_DIR), checksums: true }, { source: 'node_modules', dir: join(root, 'node_modules/typescript') });
  for (const p of (process.env.NODE_PATH || '').split(':').filter(Boolean)) candidates.push({ source: 'NODE_PATH', dir: join(p, 'typescript') });
  const notes = [];
  for (const c of candidates) {
    const bin = join(c.dir, 'bin/tsc'); if (!existsSync(bin) || !existsSync(join(c.dir, 'package.json'))) { notes.push(`${c.source}: not found`); if (c.explicit) return { ok: false, message: `TSC_PATH points to ${c.dir}, which is not a TypeScript package (bin/tsc and package.json are missing).` }; continue; }
    let version; try { version = readJson(join(c.dir, 'package.json')).version; } catch { notes.push(`${c.source}: unreadable package.json`); continue; }
    if (version !== pin) { notes.push(`${c.source}: TypeScript ${version}, not ${pin}`); if (c.explicit) return { ok: false, message: `TypeScript ${version} is installed at TSC_PATH but package.json pins ${pin}.` }; continue; }
    if (c.checksums) { const bad = verifyChecksums(c.dir); if (bad) return { ok: false, message: `The committed TypeScript in ${COMMITTED_DIR} does not match tools/typescript/CHECKSUMS.json (${bad}). Restore the folder from the package; nothing was built.` }; }
    return { ok: true, tsc: bin, version, source: c.source };
  }
  return { ok: false, message: `No usable TypeScript ${pin} was found — package.json pins ${pin}. Looked in: ${notes.join('; ')}. The project ships it in ${COMMITTED_DIR}/; restore that folder, or set TSC_PATH to a TypeScript ${pin} package.` };
}
/** '' when every listed file exists and has its recorded SHA-256, otherwise a short description of the first problem */
export function verifyChecksums(dir) {
  let list; try { list = readJson(join(dir, 'CHECKSUMS.json')); } catch { return 'CHECKSUMS.json is missing or unreadable'; }
  for (const [file, want] of Object.entries(list.sha256 || {})) { const p = join(dir, file); if (!existsSync(p)) return `${file} is missing`; if (createHash('sha256').update(readFileSync(p)).digest('hex') !== want) return `${file} was modified`; } return '';
}

/**
 * V17.7.5 — the CI "Install" step. It verifies the COMMITTED compiler and nothing else: no TSC_PATH, no node_modules, no registry, NO FALLBACK of any kind.
 * Every file listed in tools/typescript/CHECKSUMS.json must exist with its SHA-256, and no file outside the list may be present. → { ok: true, version } | { ok: false, message } (the message names the file).
 */
export function verifyCommitted(root) {
  const pin = (() => { try { return readJson(join(root, 'package.json')).devDependencies?.typescript; } catch { return undefined; } })(); const dir = join(root, COMMITTED_DIR);
  const how = `Restore the folder from the repository (git checkout -- ${COMMITTED_DIR}). The project ships its pinned TypeScript there and this check does NOT fall back to a package registry.`;
  if (!/^\d+\.\d+\.\d+$/.test(String(pin))) return { ok: false, message: `package.json must pin TypeScript to an exact version (found ${JSON.stringify(pin)}).` };
  if (!existsSync(dir)) return { ok: false, message: `${COMMITTED_DIR}/ is missing. ${how}` };
  let list; try { list = readJson(join(dir, 'CHECKSUMS.json')); } catch { return { ok: false, message: `${COMMITTED_DIR}/CHECKSUMS.json is missing or unreadable. ${how}` }; }
  const bad = verifyChecksums(dir); if (bad) return { ok: false, message: `${COMMITTED_DIR}/${bad}. The committed TypeScript does not match ${COMMITTED_DIR}/CHECKSUMS.json. ${how}` };
  const listed = new Set(Object.keys(list.sha256 || {})); const walk = (d, base = '') => readdirSync(d).flatMap((x) => (statSync(join(d, x)).isDirectory() ? walk(join(d, x), `${base}${x}/`) : [`${base}${x}`]));
  const extra = walk(dir).filter((f) => !listed.has(f) && f !== 'CHECKSUMS.json' && f !== 'README.md'); if (extra.length) return { ok: false, message: `${COMMITTED_DIR}/${extra[0]} is not listed in CHECKSUMS.json (an unexpected file). ${how}` };
  let version; try { version = readJson(join(dir, 'package.json')).version; } catch { return { ok: false, message: `${COMMITTED_DIR}/package.json is unreadable. ${how}` }; }
  if (version !== pin) return { ok: false, message: `${COMMITTED_DIR} holds TypeScript ${version} but package.json pins ${pin}. ${how}` };
  return { ok: true, version, files: listed.size };
}
