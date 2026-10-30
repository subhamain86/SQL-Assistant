/**
 * V17.7.2 — CENTRALLY MAINTAINED REPOSITORY CONFIGURATION (GitHub Repository / Schema Synchronization).
 *
 * Before V17.7.2 the repository location (owner/repo, branch, schema file path) existed in two places only: the defaults compiled into the application (repositoryDefaults.ts) and an override in the
 * browser storage of the one device on which an administrator saved it. A change therefore never reached another machine — every new machine started from the compiled defaults and had to be set up by hand.
 *
 * Now there is ONE authoritative, version-controlled source: the record `sql-assistant-data/config/repository-config.json` in the application's bootstrap repository (the repository the application
 * ships with — repositoryDefaults.LOCKED_REPOSITORY). It is a normal file under sql-assistant-data/, so it has Git history, is mirrored by the existing publish-data workflow (a new machine without any token
 * reads it from the published copy) and is read and written through the SAME repository connection as every other synchronization (saved token, central access service, published copy). It holds
 * NO secret: owner, repository, branch, schema path, a revision counter and bookkeeping. Credentials stay where they were (the encrypted vault / the central access service / GitHub Actions secrets).
 *
 *   · WRITE  — only an administrator (the existing Admin Password check, enforced HERE, in the service) whose repository connection may write (the repository's own permissions are not bypassed).
 *              Order: Admin Password → validation → optional live check → read the current record → write revision N+1 (conflict-checked with the file's sha) → read it back and compare → apply locally.
 *              Nothing local changes unless the central write was confirmed; a refusal or failure changes nothing. Two administrators cannot overwrite each other: a newer revision is never replaced.
 *   · READ   — at start-up, at every scheduled synchronization and on the Sync button: a record with a HIGHER revision than the one this device applied is validated and applied transactionally
 *              (single write + read-back + restore — repositoryConfig.writeRepositoryConfig). A new machine has revision 0, so it adopts the central record at once; an existing machine adopts every later one.
 *   · LOCAL  — a device with no repository connection at all (first set-up) may still save the values on this device only (Admin Password required). They are marked pending and published by the next
 *              synchronization — unless a NEWER central revision exists by then, in which case the central record wins and the pending local change is dropped (and logged). Local values never overwrite a newer central one.
 *   · SAFE   — an unreadable / invalid / oversized / secret-looking central record is ignored and logged; the local configuration is untouched. Every outcome is written to a small local log (no secret in it).
 * Pure logic with injected I/O (tested in Node with memoryRepository).
 */
import { KEYS, readJson, writeJson, deviceTag, type KeyValueStore } from '../../services/storage';
import { verifyPassword, authBlockedMessage } from '../../services/passwordService';
import { APP_VERSION } from '../sync/schemaFormat';
import { RepositoryError, type SchemaRepository } from './githubClient';
import { DEFAULT_REPOSITORY, loadRepositoryConfig, sameRepositoryConfig, validateRepositoryConfig, writeRepositoryConfig, repositoryLabel, type RepositoryConfig } from './repositoryConfig';
export const CENTRAL_CONFIG_FORMAT = 'sqla-repository-config'; export const CENTRAL_CONFIG_FORMAT_VERSION = 1;
/** The central record always lives in the bootstrap repository at this path (…/config/repository-config.json — deliberately NOT named *.config.json: those are deployment files that publish-data never publishes). */
export const CENTRAL_CONFIG_PATH = 'sql-assistant-data/config/repository-config.json';
export const MAX_CENTRAL_CONFIG_BYTES = 16 * 1024;
/** GitHub tokens, PEM keys and bearer values. NOT the general containsSecret(): its OpenAI-key pattern (sk-…) also matches the application's own default repository name `sk-ap-sql-assistant`, which is a legitimate value of this record. */
const CRED = /\bgh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:Bearer|token)\s+[A-Za-z0-9._\-]{16,}/i;
const looksLikeCredential = (t: string): boolean => CRED.test(t);
export interface CentralConfigRecord { format: string; formatVersion: number; revision: number; updatedAt: string; updatedByDevice: string; appVersion: string; config: RepositoryConfig; }
export interface CentralConfigOutcome { ok: boolean; changed: boolean; published: boolean; revision: number; message: string; stage: 'Configuration' | 'Validation' | 'Download' | 'Parse' | 'Apply' | 'Publish' | null; }
export type CentralConfigSource = 'central' | 'pending-local' | 'default-or-local';
export interface CentralConfigState { /** the central revision this device has applied (0 = none yet) */ revision: number; updatedAt: string | null; source: CentralConfigSource; pending: RepositoryConfig | null; lastPullAt: string | null; lastOutcome: string; lastMessage: string; }
export interface CentralConfigLogEntry { at: string; event: string; ok: boolean; message: string; }
interface Meta { v: 1; revision: number; updatedAt: string | null; sha: string | null; pending: { config: RepositoryConfig; savedAt: string } | null; lastPullAt: string | null; lastOutcome: string; lastMessage: string; }
const EMPTY: Meta = { v: 1, revision: 0, updatedAt: null, sha: null, pending: null, lastPullAt: null, lastOutcome: 'never', lastMessage: '' };
const isoOk = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const clean = (c: Partial<RepositoryConfig>): RepositoryConfig => ({ owner: String(c.owner ?? '').trim(), repo: String(c.repo ?? '').trim(), branch: String(c.branch ?? '').trim(), schemaPath: String(c.schemaPath ?? '').trim() });
/** Untrusted input (the repository file): every field is validated and unknown fields are dropped. */
export function sanitizeCentralConfig(o: unknown): { record: CentralConfigRecord | null; problem: string | null } {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { record: null, problem: 'the file must contain one JSON object' }; const j = o as Record<string, unknown>;
  if (j.format !== CENTRAL_CONFIG_FORMAT) return { record: null, problem: 'it is not a SQL Assistant repository configuration' }; if (typeof j.formatVersion !== 'number' || j.formatVersion > CENTRAL_CONFIG_FORMAT_VERSION) return { record: null, problem: 'it was written in a newer or unknown format version — update SQL Assistant' };
  if (typeof j.revision !== 'number' || !Number.isInteger(j.revision) || j.revision < 1 || j.revision > 1_000_000_000) return { record: null, problem: '"revision" must be a whole number ≥ 1' }; if (!isoOk(j.updatedAt)) return { record: null, problem: '"updatedAt" is missing or not a date' };
  if (!j.config || typeof j.config !== 'object' || Array.isArray(j.config)) return { record: null, problem: '"config" must be an object' }; const c = clean(j.config as Partial<RepositoryConfig>); const bad = validateRepositoryConfig(c); if (bad.length) return { record: null, problem: `the configuration is not valid (${bad[0]})` };
  if (looksLikeCredential(JSON.stringify(j))) return { record: null, problem: 'it contains something that looks like a credential' };
  return { record: { format: CENTRAL_CONFIG_FORMAT, formatVersion: CENTRAL_CONFIG_FORMAT_VERSION, revision: j.revision, updatedAt: String(j.updatedAt), updatedByDevice: String(j.updatedByDevice ?? '').slice(0, 40), appVersion: String(j.appVersion ?? '').slice(0, 20), config: c }, problem: null };
}
export const serializeCentralConfig = (r: CentralConfigRecord): string => `${JSON.stringify(r, null, 2)}\n`;
export function parseCentralConfigText(text: string): { record: CentralConfigRecord | null; problem: string | null } {
  const t = String(text ?? '').replace(/^\uFEFF/, ''); if (t.length > MAX_CENTRAL_CONFIG_BYTES) return { record: null, problem: 'the file is larger than SQL Assistant accepts' };
  let j: unknown; try { j = JSON.parse(t); } catch { return { record: null, problem: 'the file is not valid JSON' }; } return sanitizeCentralConfig(j);
}
export interface SaveCentralOptions { /** test seam — defaults to the real Admin Password check */ verify?: (password: string) => Promise<boolean>; /** optional live verification (repository / branch / path reachable). Returns null when fine, or a refusal message. */ liveCheck?: (c: RepositoryConfig) => Promise<{ refuse: string | null; notes: string[] }>; }
export type SaveCentralResult = { ok: true; config: RepositoryConfig; custom: boolean; central: boolean; revision: number; notes: string[]; message: string } | { ok: false; kind: 'unauthorized' | 'invalid' | 'unverified' | 'storage' | 'download' | 'publish' | 'conflict'; message: string; problems: string[] };
const LOG_MAX = 30;
export class CentralConfigService {
  private busy: Promise<unknown> | null = null;
  /** `repo` = the repository connection IN FORCE (the one the saved token / sign-in belongs to) — the primary home of the record. `o.mirror` = the application's default (bootstrap) repository when it is a different repository: written best-effort and read as a fallback, so machines that start from the compiled defaults can find the record too. */
  constructor(private store: KeyValueStore, private repo: () => SchemaRepository | null, private secrets: () => string[] = () => [], private o: { now?: () => string; mirror?: () => { repo: SchemaRepository; label: string } | null } = {}) {}
  private now = () => (this.o.now ? this.o.now() : new Date().toISOString());
  private meta(): Meta { const m = readJson<Partial<Meta> | null>(this.store, KEYS.centralConfig, null); if (!m || typeof m !== 'object') return { ...EMPTY }; const rev = typeof m.revision === 'number' && Number.isInteger(m.revision) && m.revision >= 0 ? m.revision : 0;
    const pc = m.pending && typeof m.pending === 'object' ? clean((m.pending as { config: Partial<RepositoryConfig> }).config || {}) : null; const pending = pc && !validateRepositoryConfig(pc).length ? { config: pc, savedAt: String((m.pending as { savedAt?: string }).savedAt || '') } : null;
    return { v: 1, revision: rev, updatedAt: isoOk(m.updatedAt) ? m.updatedAt : null, sha: typeof m.sha === 'string' ? m.sha : null, pending, lastPullAt: isoOk(m.lastPullAt) ? m.lastPullAt : null, lastOutcome: String(m.lastOutcome || 'never').slice(0, 40), lastMessage: String(m.lastMessage || '').slice(0, 300) }; }
  private setMeta(p: Partial<Meta>): boolean { return writeJson(this.store, KEYS.centralConfig, { ...this.meta(), ...p, v: 1 }); }
  /** known secrets and GitHub-token shapes are masked; a repository name is never touched */
  private red = (m: string): string => { let o = String(m ?? ''); this.secrets().filter((x) => !!x && x.length >= 6).forEach((x) => { o = o.split(x).join('••••••'); }); return o.replace(/\bgh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/g, '••••••'); };
  /** What this device knows about the central configuration (for the GitHub Repository card). */
  state(): CentralConfigState { const m = this.meta(); return { revision: m.revision, updatedAt: m.updatedAt, source: m.pending ? 'pending-local' : m.revision > 0 ? 'central' : 'default-or-local', pending: m.pending ? m.pending.config : null, lastPullAt: m.lastPullAt, lastOutcome: m.lastOutcome, lastMessage: m.lastMessage }; }
  log(): CentralConfigLogEntry[] { const l = readJson<CentralConfigLogEntry[]>(this.store, KEYS.centralConfigLog, []); return Array.isArray(l) ? l.filter((x) => x && typeof x.at === 'string').slice(-LOG_MAX) : []; }
  private note(event: string, ok: boolean, message: string): void { const entry: CentralConfigLogEntry = { at: this.now(), event, ok, message: this.red(message).slice(0, 300) }; writeJson(this.store, KEYS.centralConfigLog, [...this.log(), entry].slice(-LOG_MAX)); }
  private out(p: Partial<CentralConfigOutcome> & { message: string }): CentralConfigOutcome { return { ok: false, changed: false, published: false, revision: this.meta().revision, stage: null, ...p }; }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> { const run = async () => { while (this.busy) { try { await this.busy; } catch { /* ignore */ } } const p = fn(); this.busy = p; try { return await p; } finally { this.busy = null; } }; return run(); }
  /** Reads the record from the primary repository and, best-effort, from the mirror (errors of the mirror are ignored: a token for one repository cannot see another). The valid record with the higher revision wins; `fp` stays the PRIMARY file (its sha is what a conflict-checked write needs). */
  private async readCentral(repo: SchemaRepository): Promise<{ f: { text: string; sha: string } | null; fp: { text: string; sha: string } | null; err: string | null }> {
    let fp: { text: string; sha: string } | null = null; let err: string | null = null; try { fp = await repo.read(CENTRAL_CONFIG_PATH); } catch (e) { err = this.red((e as Error).message); }
    let fm: { text: string; sha: string } | null = null; const m = this.o.mirror ? this.o.mirror() : null; if (m) { try { fm = await m.repo.read(CENTRAL_CONFIG_PATH); } catch { fm = null; } }
    const rev = (x: { text: string } | null): number => (x ? parseCentralConfigText(x.text).record?.revision ?? -1 : -2); let f = fp; if (fm && rev(fm) >= 1 && rev(fm) > rev(fp)) f = fm;
    return { f, fp, err: f ? null : err };
  }
  /** After a confirmed write to the primary: the same record into the default repository, best-effort. Returns one sentence for the administrator (null when there is no separate default repository). */
  private async mirrorWrite(text: string, revision: number): Promise<string | null> {
    const m = this.o.mirror ? this.o.mirror() : null; if (!m) return null;
    try { const cur = await m.repo.read(CENTRAL_CONFIG_PATH); const pr = cur ? parseCentralConfigText(cur.text).record : null; if (pr && pr.revision >= revision) return `Not written to ${m.label}: it already holds revision ${pr.revision}.`;
      await m.repo.write(CENTRAL_CONFIG_PATH, text, cur ? cur.sha : null, `Update repository configuration (revision ${revision})`); return `Also written to ${m.label} (the application's default repository), so machines that start from the application defaults find it.`; }
    catch (e) { return `Not written to ${m.label} (${this.red((e as Error).message)}). Machines that start from the application defaults cannot see this configuration until their default repository is changed to the location in use (see docs/CENTRAL_CONFIG.md).`; }
  }
  /** Read the central record and apply a newer one; publish a pending local change when no newer central revision exists. Never throws; a failure changes nothing local. */
  pull(): Promise<CentralConfigOutcome> { return this.exclusive(() => this.doPull()); }
  private async doPull(): Promise<CentralConfigOutcome> {
    const repo = this.repo(); if (!repo) return this.out({ stage: 'Configuration', message: 'No repository connection — the repository configuration was not synchronized.' });
    const rd = await this.readCentral(repo); if (rd.err) { const m = rd.err; this.setMeta({ lastPullAt: this.now(), lastOutcome: 'download-failed', lastMessage: m }); this.note('pull', false, `Download failed: ${m}`); return this.out({ stage: 'Download', message: m }); }
    const f = rd.f; const meta = this.meta(); const at = this.now();
    if (!f) { this.setMeta({ lastPullAt: at, sha: null, lastOutcome: 'none-published', lastMessage: 'No central configuration has been published yet.' }); if (meta.pending) return this.publishPending(null, 0);
      this.note('pull', true, 'No central configuration published yet — the values of this device stay in force.'); return this.out({ ok: true, message: 'No central repository configuration has been published yet; this device keeps its own values.' }); }
    const p = parseCentralConfigText(f.text);
    if (!p.record) { const m = `The central repository configuration is not usable (${p.problem}) and was ignored; this device keeps its configuration.`; this.setMeta({ lastPullAt: at, lastOutcome: 'invalid', lastMessage: m }); this.note('pull', false, m); return this.out({ stage: 'Parse', message: m }); }
    const remote = p.record;
    if (remote.revision > meta.revision) {
      const was = loadRepositoryConfig(this.store).config; const w = writeRepositoryConfig(this.store, remote.config);
      if (!w.ok) { const m = `${w.message} Central revision ${remote.revision} was not applied.`; this.setMeta({ lastPullAt: at, lastOutcome: 'apply-failed', lastMessage: m }); this.note('pull', false, m); return this.out({ stage: 'Apply', message: m }); }
      const dropped = meta.pending ? ' A change saved only on this device was replaced by this newer central revision.' : '';
      const changed = !sameRepositoryConfig(was, remote.config); const m = `${changed ? 'Repository configuration updated from the central repository' : 'Central repository configuration confirmed'} (revision ${remote.revision}, ${repositoryLabel(remote.config)} · ${remote.config.branch}).${dropped}`;
      this.setMeta({ revision: remote.revision, updatedAt: remote.updatedAt, sha: f.sha, pending: null, lastPullAt: at, lastOutcome: 'applied', lastMessage: m }); this.note('pull', true, m);
      return this.out({ ok: true, changed, revision: remote.revision, message: m });
    }
    this.setMeta({ sha: f.sha, lastPullAt: at });
    if (meta.pending) return this.publishPending(rd.fp, remote.revision);
    const m = remote.revision < meta.revision ? 'The repository holds an older configuration revision than this device; the newer one is kept.' : `The repository configuration is up to date (revision ${meta.revision}).`;
    this.setMeta({ lastOutcome: 'up-to-date', lastMessage: m }); return this.out({ ok: true, message: m });
  }
  /** Publishes the configuration that was saved on this device while no repository connection existed. */
  private async publishPending(f: { sha: string } | null, remoteRevision: number): Promise<CentralConfigOutcome> {
    const meta = this.meta(); if (!meta.pending) return this.out({ ok: true, message: 'Nothing to publish.' }); const r = await this.publish(meta.pending.config, f, Math.max(remoteRevision, meta.revision));
    if (!r.ok) { this.setMeta({ lastOutcome: 'publish-pending-failed', lastMessage: r.message }); this.note('publish-pending', false, r.message); return this.out({ stage: 'Publish', message: `The configuration saved on this device could not be published: ${r.message}` }); }
    const m = `The configuration saved on this device was published as central revision ${r.revision}.`; this.setMeta({ revision: r.revision, updatedAt: r.updatedAt, sha: r.sha, pending: null, lastOutcome: 'published', lastMessage: m }); this.note('publish-pending', true, m); return this.out({ ok: true, published: true, revision: r.revision, message: m });
  }
  /** Writes revision N+1 with the sha of the file that was read (so a concurrent write is refused, never overwritten) and confirms it by reading it back. */
  private async publish(c: RepositoryConfig, f: { sha: string } | null, baseRevision: number, retry = true): Promise<{ ok: true; revision: number; updatedAt: string; sha: string; mirror: string | null } | { ok: false; kind: 'publish' | 'conflict'; message: string }> {
    const repo = this.repo(); if (!repo) return { ok: false, kind: 'publish', message: 'No repository connection.' };
    const rec: CentralConfigRecord = { format: CENTRAL_CONFIG_FORMAT, formatVersion: CENTRAL_CONFIG_FORMAT_VERSION, revision: baseRevision + 1, updatedAt: this.now(), updatedByDevice: deviceTag(this.store), appVersion: APP_VERSION, config: c }; const text = serializeCentralConfig(rec);
    if (looksLikeCredential(text)) return { ok: false, kind: 'publish', message: 'The configuration looks like it contains a credential and was not published.' };
    let sha: string; try { sha = await repo.write(CENTRAL_CONFIG_PATH, text, f ? f.sha : null, `Update repository configuration (revision ${rec.revision})`); }
    catch (e) { const m = this.red((e as Error).message); if (retry && (e instanceof RepositoryError ? e.kind === 'conflict' : /changed on the server/.test(m))) { let g; try { g = await repo.read(CENTRAL_CONFIG_PATH); } catch (e2) { return { ok: false, kind: 'publish', message: this.red((e2 as Error).message) }; } const pr = g ? parseCentralConfigText(g.text).record : null; if (pr && pr.revision > baseRevision) return { ok: false, kind: 'conflict', message: `Another administrator published a newer configuration (revision ${pr.revision}) at the same time. It was not overwritten — synchronize, review it and save again.` }; return this.publish(c, g ? { sha: g.sha } : null, baseRevision, false); } return { ok: false, kind: 'publish', message: m }; }
    let back; try { back = await repo.read(CENTRAL_CONFIG_PATH); } catch (e) { return { ok: false, kind: 'publish', message: `The configuration was written but could not be read back to confirm it (${this.red((e as Error).message)}). Use Sync to verify.` }; }
    const br = back ? parseCentralConfigText(back.text).record : null; if (!br || br.revision !== rec.revision || !sameRepositoryConfig(br.config, c)) return { ok: false, kind: 'publish', message: 'The configuration was written but the repository does not return what was written. Use Sync to verify.' };
    const mirror = await this.mirrorWrite(text, rec.revision); return { ok: true, revision: rec.revision, updatedAt: rec.updatedAt, sha: back!.sha || sha, mirror };
  }
  /**
   * Administrator: validate and save the configuration CENTRALLY (and locally). Admin Password → validation → live check → publish (read-back confirmed) → local apply.
   * With no repository connection at all the values are saved on this device only and published by the next synchronization (see the header). Saving the application defaults publishes the defaults.
   */
  save(input: Partial<RepositoryConfig>, adminPassword: string, o: SaveCentralOptions = {}): Promise<SaveCentralResult> {
    return this.exclusive(async () => {
      let ok = false; try { ok = await (o.verify || verifyPassword)(String(adminPassword ?? '')); } catch { ok = false; }
      if (!ok) { const m = authBlockedMessage() ? `${authBlockedMessage()} The repository configuration was not changed.` : 'Incorrect Admin Password — the repository configuration was not changed.'; this.note('save', false, 'Refused: the Admin Password was not accepted.'); return { ok: false, kind: 'unauthorized', message: m, problems: [] }; }
      const c = clean(input); const problems = validateRepositoryConfig(c); if (problems.length) { this.note('save', false, 'Refused: the configuration is not valid.'); return { ok: false, kind: 'invalid', message: 'The repository configuration is not valid — nothing was saved.', problems }; }
      const notes: string[] = []; if (o.liveCheck) { const r = await o.liveCheck(c); notes.push(...r.notes); if (r.refuse) { this.note('save', false, `Refused by the live check: ${r.refuse}`); return { ok: false, kind: 'unverified', message: r.refuse, problems: [] }; } }
      const repo = this.repo(); const was = loadRepositoryConfig(this.store).config;
      if (!repo) { // first set-up: no connection to publish through — saved on this device, published later
        const w = writeRepositoryConfig(this.store, c); if (!w.ok) { this.note('save', false, w.message); return { ok: false, kind: 'storage', message: w.message, problems: [] }; }
        const m = 'Saved on this device only: there is no repository connection to publish through yet. It becomes the central configuration at the next synchronization once a connection exists (a newer central revision, if one exists by then, takes precedence).';
        this.setMeta({ pending: { config: c, savedAt: this.now() }, lastOutcome: 'saved-local-pending', lastMessage: m }); this.note('save', true, m); return { ok: true, config: c, custom: w.custom, central: false, revision: this.meta().revision, notes, message: m };
      }
      const rd = await this.readCentral(repo); if (rd.err) { const m = `The current central configuration could not be read, so nothing was saved: ${rd.err}`; this.note('save', false, m); return { ok: false, kind: 'download', message: m, problems: [] }; }
      const pr = rd.f ? parseCentralConfigText(rd.f.text).record : null; const base = Math.max(pr ? pr.revision : 0, this.meta().revision);
      const pub = await this.publish(c, rd.fp ? { sha: rd.fp.sha } : null, base);
      if (!pub.ok) { this.note('save', false, pub.message); return { ok: false, kind: pub.kind, message: `${pub.message} Nothing was changed on this device.`, problems: [] }; }
      if (pub.mirror) notes.push(pub.mirror); const w = writeRepositoryConfig(this.store, c); const m = `Repository configuration saved centrally (revision ${pub.revision}). New machines start with it and existing machines receive it at their next synchronization.`;
      this.setMeta({ revision: pub.revision, updatedAt: pub.updatedAt, sha: pub.sha, pending: null, lastPullAt: this.now(), lastOutcome: 'published', lastMessage: m });
      if (!w.ok) { const m2 = `${m} This device's own storage rejected the local copy (${w.message}); the next synchronization applies it again.`; this.note('save', true, m2); return { ok: true, config: c, custom: !sameRepositoryConfig(c, DEFAULT_REPOSITORY), central: true, revision: pub.revision, notes, message: m2 }; }
      this.note('save', true, `${m} (${repositoryLabel(c)} · ${c.branch})${sameRepositoryConfig(was, c) ? ' — values unchanged' : ''}${pub.mirror ? ` ${pub.mirror}` : ''}`); return { ok: true, config: c, custom: w.custom, central: true, revision: pub.revision, notes, message: m };
    });
  }
}
