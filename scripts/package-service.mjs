#!/usr/bin/env node
/**
 * V17.7.5 — packages one OPTIONAL SERVICE for ANY host that runs Node ≥ 20. No cloud account, no credential, no package manager, no network.
 *
 *   node scripts/package-service.mjs analytics|broker [--out service-dist] [--self-test]
 *
 * Output (service-dist/<service>/): server.mjs (a byte-identical copy of the single-file service), README.md (run instructions), Dockerfile, <service>.service (systemd), env.example (variable NAMES only), SHA256SUMS.
 * The packager refuses to write an artifact that contains a secret-looking value, a cloud-vendor reference or a package-manager command (it scans every file it wrote).
 * `--self-test` starts the PACKAGED copy with a minimal environment (PATH only, synthetic settings generated on the spot — nothing is read from the environment, no secret exists) and checks that it answers.
 * The broker's central PAT and the analytics password hash are the OPERATOR's, set on the operator's own host — they are never inputs of this script or of the workflow that runs it.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, mkdtempSync, copyFileSync, statSync } from 'node:fs'; import { join, resolve, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto'; import { spawn, spawnSync } from 'node:child_process'; import { createServer } from 'node:net'; import { tmpdir } from 'node:os';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const SERVICES = {
  analytics: {
    source: 'server/analytics-service.mjs', dir: 'sqla-analytics-service', unit: 'sqla-analytics', title: 'SQL Assistant — usage analytics service (provider "service")', port: 8789, health: '/healthz',
    what: 'Stores usage METADATA sent by SQL Assistant (no SQL, no results, no customer data) and shows it only to the administrator, behind ONE administrator password that is kept as a salted hash. Used only when `analytics.provider` is `"service"`; the serverless provider needs no service.',
    vars: [
      ['SQLA_ANALYTICS_ALLOWED_ORIGINS', 'required', 'the page origin(s) that serve SQL Assistant, comma-separated, no path — for example https://tools.example.org'],
      ['SQLA_ANALYTICS_ADMIN_PASSWORD_HASH', 'secret', 'the administrator password as a hash: run `node server.mjs hash-password` on the host and store its output here. Alternative: `node server.mjs set-admin-password` writes a private file in the data folder. Without either, the administration endpoints answer 503 (there is no default password)'],
      ['SQLA_ANALYTICS_ADMIN_PASSWORD', 'secret', 'alternative to the hash for a platform that can only store plain secrets: at least 12 characters, hashed in memory at start-up and never logged — prefer the hash'],
      ['SQLA_ANALYTICS_DATA_DIR', 'optional', 'a PERSISTENT folder for the store (default ./analytics-data)'],
      ['SQLA_ANALYTICS_TRUST_PROXY', 'optional', '1 behind a reverse proxy you control (caller address from X-Forwarded-For)'],
      ['SQLA_ANALYTICS_ADMIN_IDLE_SECONDS', 'optional', 'administrator session idle limit (default 1800)'], ['SQLA_ANALYTICS_ADMIN_MAX_SECONDS', 'optional', 'administrator session absolute limit (default 28800)'],
      ['SQLA_ANALYTICS_RETENTION_DAYS', 'optional', 'default 400'], ['SQLA_ANALYTICS_RATE_LIMIT_PER_MINUTE', 'optional', 'default 600 per caller address'], ['SQLA_ANALYTICS_AUDIT_LOG', 'optional', '0 switches the audit lines off'],
      ['HOST', 'optional', 'listen address (default 0.0.0.0)'], ['PORT', 'optional', 'default 8789'],
    ],
    after: 'Then publish the service address as the repository variable `SQLA_ANALYTICS_URL` (the Pages workflow writes it into `sql-assistant-data/analytics.config.json`). Put the service behind HTTPS.',
  },
  broker: {
    source: 'server/repo-broker.mjs', dir: 'sqla-repo-broker', unit: 'sqla-repo-broker', title: 'SQL Assistant — repository access broker (holds the central GitHub PAT)', port: 8788, health: '/healthz',
    what: 'Lets SQL Assistant read and write ONLY its own data folder of the repository without a GitHub token on the device: the central PAT lives here, and a caller may use it only after GitHub\'s own sign-in proved that the caller\'s account can read the repository. It never returns the PAT. Used only when central repository access is deployed (`repo-broker.config.json`).',
    vars: [
      ['SQLA_GITHUB_PAT', 'secret', 'the central PAT: fine-grained, ONE repository, Contents: Read and write. Set it HERE, on the host that runs the service — it is not an input of any workflow'],
      ['SQLA_SESSION_SECRET', 'secret', 'at least 32 random characters; signs broker sessions (without it sessions end whenever the service restarts)'],
      ['SQLA_GITHUB_CLIENT_ID', 'required', 'the public client ID of the GitHub App / OAuth App with the device flow enabled'],
      ['SQLA_ALLOWED_ORIGINS', 'required', 'the page origin(s) that serve SQL Assistant, comma-separated, no path'],
      ['SQLA_ALLOWED_REPOSITORIES', 'optional', 'owner/repo list the PAT may be used for'], ['SQLA_ALLOWED_PATH_PREFIXES', 'optional', 'folders the PAT may write (default sql-assistant-data/)'],
      ['SQLA_SESSION_TTL_MINUTES', 'optional', 'default 480'], ['SQLA_MAX_WRITE_BYTES', 'optional', 'the largest single file write in bytes (default 8 MiB)'], ['SQLA_RATE_LIMIT_PER_MINUTE', 'optional', 'default 240'], ['SQLA_AUDIT_LOG', 'optional', '0 switches the audit lines off'], ['PORT', 'optional', 'default 8788'],
    ],
    after: 'Then publish the service address as the repository variable `SQLA_BROKER_URL` (the Pages workflow writes it into `sql-assistant-data/repo-broker.config.json`). Put the service behind HTTPS.',
  },
};
/** patterns that must never appear in an artifact (the secret patterns are the ones the page build refuses; the others keep the artifact host-neutral) */
export const ARTIFACT_FORBIDDEN = [
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'a GitHub token'], [/github_pat_[A-Za-z0-9_]{20,}/, 'a GitHub fine-grained token'], [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'], [/\bsk-[A-Za-z0-9]{20,}/, 'an API key'], [/scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]{16,}\$[A-Za-z0-9_-]{43}/, 'a password hash'],
  [/azure/i, 'an Azure reference'], [/AZURE_/, 'an Azure variable'], [/\bnpm\b/i, 'a package-manager command'], [/\bnpx\b/i, 'a package-manager command'], [/registry\.npmjs|npmjs\.(?:org|com)/i, 'a package registry address'],
];
const sha = (b) => createHash('sha256').update(b).digest('hex');

export function readmeFor(key) {
  const s = SERVICES[key]; const rows = s.vars.map(([n, k, d]) => `| \`${n}\` | ${k} | ${d} |`).join('\n'); const unit = s.unit;
  return `# ${s.title}

${s.what}

This folder is everything you need: \`server.mjs\` is a single file with **no dependencies** — it runs wherever **Node 20 or newer** runs. Nothing here needs a cloud account, a package manager or a network connection to start, and no secret is stored in any file of this folder.

## 1. Run it
\`\`\`
node server.mjs
\`\`\`
Health check (no secret is returned): \`GET http://<host>:${s.port}${s.health}\`.

## 2. Environment variables (set them on YOUR host; this folder holds names only — see \`env.example\`)
| Variable | | Meaning |
|---|---|---|
${rows}

${s.after}

## 3. As a service on Linux (systemd)
Copy \`server.mjs\` to \`/opt/${unit}/\`, create a user for it, put the variables in \`/etc/${unit}.env\` (mode 0600, owned by root — **not** in a repository), install \`${unit}.service\` and run \`systemctl enable --now ${unit}\`.

## 4. In a container
\`Dockerfile\` uses only the Node base image and copies one file:
\`\`\`
docker build -t ${unit} .
docker run -d --name ${unit} -p ${s.port}:${s.port} --env-file ./${unit}.env ${unit}
\`\`\`

## 5. Integrity
\`SHA256SUMS\` lists the hash of every file. \`server.mjs\` is a byte-identical copy of \`${s.source}\` of the SQL Assistant repository.
`;
}
export const dockerfileFor = (key) => `# ${SERVICES[key].title}
# Only the Node base image and one file: no package manager runs, nothing is downloaded at build time except the base image itself.
FROM node:24-slim
WORKDIR /app
COPY server.mjs ./server.mjs
USER node
ENV PORT=${SERVICES[key].port}
EXPOSE ${SERVICES[key].port}
CMD ["node", "server.mjs"]
`;
export const systemdFor = (key) => { const s = SERVICES[key]; return `[Unit]
Description=${s.title}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${s.unit}
WorkingDirectory=/opt/${s.unit}
ExecStart=/usr/bin/node /opt/${s.unit}/server.mjs
# the variables are set HERE, on the host (mode 0600) — never in a repository
EnvironmentFile=/etc/${s.unit}.env
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/${s.unit}

[Install]
WantedBy=multi-user.target
`; };
export const envExampleFor = (key) => { const s = SERVICES[key]; return `# ${s.title} — variable NAMES only. Copy to your host as ${s.unit}.env and fill in YOUR values there. Never put a value in a repository.\n${s.vars.map(([n, k, d]) => `# ${k}: ${d}\n${n}=`).join('\n')}\n`; };

/** → [] or [{ file, what, sample }] */
export function scanArtifact(dir) {
  const bad = []; for (const f of readdirSync(dir)) { const t = readFileSync(join(dir, f), 'utf8'); for (const [re, what] of ARTIFACT_FORBIDDEN) { const m = re.exec(t); if (m) bad.push({ file: f, what, sample: m[0].slice(0, 12) }); } } return bad;
}
export function packageService(key, outRoot = join(root, 'service-dist')) {
  const s = SERVICES[key]; if (!s) throw new Error(`unknown service "${key}" (analytics | broker)`); const dir = join(outRoot, s.dir); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  if (!existsSync(join(root, s.source))) throw new Error(`${s.source} is missing`); copyFileSync(join(root, s.source), join(dir, 'server.mjs'));
  writeFileSync(join(dir, 'README.md'), readmeFor(key)); writeFileSync(join(dir, 'Dockerfile'), dockerfileFor(key)); writeFileSync(join(dir, `${s.unit}.service`), systemdFor(key)); writeFileSync(join(dir, 'env.example'), envExampleFor(key));
  const bad = scanArtifact(dir); if (bad.length) { rmSync(dir, { recursive: true, force: true }); throw new Error(`the artifact would contain ${bad.map((b) => `${b.what} in ${b.file} ("${b.sample}…")`).join('; ')} — nothing was written`); }
  const sums = readdirSync(dir).sort().map((f) => `${sha(readFileSync(join(dir, f)))}  ${f}`).join('\n'); writeFileSync(join(dir, 'SHA256SUMS'), `${sums}\n`);
  return { dir, files: [...readdirSync(dir)].sort(), identical: sha(readFileSync(join(dir, 'server.mjs'))) === sha(readFileSync(join(root, s.source))) };
}

const freePort = () => new Promise((res, rej) => { const srv = createServer(); srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => res(p)); }); srv.on('error', rej); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url, init) => { try { const r = await fetch(url, init); let j = null; try { j = await r.json(); } catch { j = null; } return { status: r.status, json: j }; } catch (e) { return { status: 0, json: null, err: e.message }; } };
/** Starts the PACKAGED copy with a minimal environment and checks it answers. Throws with a plain message on any failure. */
export async function selfTest(key, outRoot = join(root, 'service-dist')) {
  const s = SERVICES[key]; const dir = join(outRoot, s.dir); if (!existsSync(join(dir, 'server.mjs'))) throw new Error(`${dir}/server.mjs is missing — package first`); const port = await freePort(); const data = mkdtempSync(join(tmpdir(), 'sqla-selftest-'));
  const base = { PATH: dirname(process.execPath) }; const origin = 'https://example.invalid'; const notes = []; let env; let secretPw = '';
  if (key === 'analytics') { secretPw = `${randomBytes(18).toString('base64url')}-Aa1`; const h = spawnSync(process.execPath, ['server.mjs', 'hash-password', '--stdin'], { cwd: dir, input: `${secretPw}\n`, encoding: 'utf8', env: base }); if (h.status !== 0 || !/^scrypt\$/.test(h.stdout.trim())) throw new Error(`hash-password failed: ${(h.stderr || '').trim()}`); notes.push('hash-password works'); env = { ...base, PORT: String(port), HOST: '127.0.0.1', SQLA_ANALYTICS_ALLOWED_ORIGINS: origin, SQLA_ANALYTICS_ADMIN_PASSWORD_HASH: h.stdout.trim(), SQLA_ANALYTICS_DATA_DIR: data, SQLA_ANALYTICS_AUDIT_LOG: '0' }; }
  else env = { ...base, PORT: String(port), SQLA_GITHUB_CLIENT_ID: 'Iv1.0000000000000000', SQLA_ALLOWED_ORIGINS: origin, SQLA_AUDIT_LOG: '0' };
  const child = spawn(process.execPath, ['server.mjs'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  try {
    let h; for (let i = 0; i < 40; i += 1) { h = await get(`http://127.0.0.1:${port}${s.health}`); if (h.status === 200) break; await sleep(150); }
    if (h.status !== 200 || !h.json || h.json.ok !== true) throw new Error(`the packaged service did not answer ${s.health}: ${out.trim().slice(0, 300)}`);
    if (key === 'analytics') {
      if (h.json.adminConfigured !== true) throw new Error('the packaged analytics service did not see the (synthetic) password hash'); notes.push('starts with a minimal environment; adminConfigured');
      const H = { Origin: origin, 'Content-Type': 'text/plain' }; const bad = await get(`http://127.0.0.1:${port}/v1/admin/login`, { method: 'POST', headers: H, body: JSON.stringify({ password: 'wrong-wrong-wrong-1' }) }); if (bad.status !== 401) throw new Error(`a wrong password gave ${bad.status}, expected 401`);
      const good = await get(`http://127.0.0.1:${port}/v1/admin/login`, { method: 'POST', headers: H, body: JSON.stringify({ password: secretPw }) }); if (good.status !== 200 || !good.json?.token) throw new Error(`the right password gave ${good.status}`); notes.push('login: wrong password 401, right password 200');
      const refused = await get(`http://127.0.0.1:${port}/v1/admin/summary`, { headers: { Origin: origin } }); if (refused.status !== 401) throw new Error('the dashboard data was served without a session'); notes.push('dashboard data refused without a session');
    } else {
      if (h.json.patConfigured !== false) throw new Error('the broker reports a PAT although none was given'); notes.push('starts with a minimal environment; reports that no PAT is configured (none was given — by design)');
      const u = await get(`http://127.0.0.1:${port}/v1/contents?owner=o&repo=r&branch=main&path=sql-assistant-data/x.json`, { headers: { Origin: origin } }); if (u.status !== 401) throw new Error(`an unauthenticated read gave ${u.status}, expected 401`); notes.push('an unauthenticated read is refused (401)');
    }
    return notes;
  } finally { child.kill('SIGTERM'); await sleep(100); if (child.exitCode === null) child.kill('SIGKILL'); rmSync(data, { recursive: true, force: true }); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const key = process.argv[2]; const oi = process.argv.indexOf('--out'); const out = oi > 0 ? resolve(process.argv[oi + 1]) : join(root, 'service-dist');
  if (!SERVICES[key]) { process.stderr.write(`Usage: node scripts/package-service.mjs analytics|broker [--out DIR] [--self-test]\n`); process.exit(2); }
  try {
    if (process.argv.includes('--self-test')) { const notes = await selfTest(key, out); process.stdout.write(`Self test passed (${key}):\n${notes.map((n) => `  - ${n}`).join('\n')}\n`); }
    else { const r = packageService(key, out); process.stdout.write(`Packaged ${key} → ${r.dir}\n  files: ${r.files.join(', ')}\n  server.mjs is a byte-identical copy of ${SERVICES[key].source}: ${r.identical}\n  scanned: no secret, no cloud-vendor reference, no package-manager command.\n`); }
  } catch (e) { process.stderr.write(`::error title=Package ${key}::${e.message}\n`); process.exit(1); }
}
