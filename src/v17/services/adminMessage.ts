/**
 * V17.5.1 — short cross-device administrator message (shown in the navbar).
 * One small versioned JSON file next to the schema registry, read and written through the SAME repository connection as the schema and knowledge
 * synchronization (…/messages/admin-message.json). Merge rule: the record with the newer `updatedAt` wins; clearing the message is a record too
 * (`active:false`) so the clear reaches every device. The text is plain text only (never HTML, never a link), limited to 140 characters, and anything that
 * looks like a credential is refused. A dismissed message stays hidden on that device until the administrator publishes a new one.
 * The message never changes any synchronization setting and a download failure is silent (the last known message stays on screen).
 */
import { KEYS, readJson, writeJson, deviceTag, type KeyValueStore } from '../../services/storage';
import { containsSecret, redactSecrets } from '../errors/appErrors';
import { APP_VERSION } from '../sync/schemaFormat';
import type { SchemaRepository } from './githubClient';
export const ADMIN_MESSAGE_FORMAT = 'sqla-admin-message'; export const ADMIN_MESSAGE_FORMAT_VERSION = 1; export const ADMIN_MESSAGE_MAX = 140;
export type AdminMessageLevel = 'info' | 'warning';
export interface AdminMessage { format: string; formatVersion: number; id: string; active: boolean; text: string; level: AdminMessageLevel; updatedAt: string; updatedByDevice: string; appVersion: string; }
export interface AdminMessageOutcome { ok: boolean; published: boolean; changed: boolean; message: string; stage: 'Configuration' | 'Download' | 'Parse' | 'Validation' | 'Publish' | null; }
/** …/schemas/registry.json → …/messages/admin-message.json  (default: sql-assistant-data/messages/admin-message.json) */
export function adminMessagePathFor(schemaPath: string): string { const p = (schemaPath || '').replace(/^\/+/, ''); const m = p.match(/^(.*?)\/schemas\/[^/]+$/); if (m) return `${m[1]}/messages/admin-message.json`; const i = p.lastIndexOf('/'); return i > 0 ? `${p.slice(0, i)}/admin-message.json` : 'sql-assistant-data/messages/admin-message.json'; }
/** Normalises the text (one line, no control characters) and returns the problem, if any. */
export function checkMessageText(raw: string): { text: string; problem: string | null } {
  const text = String(raw ?? '').normalize('NFKC').replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return { text, problem: 'Enter the message text.' }; if ([...text].length > ADMIN_MESSAGE_MAX) return { text, problem: `The message is ${[...text].length} characters long — the limit is ${ADMIN_MESSAGE_MAX}.` };
  if (containsSecret(text) || /\b(password|passphrase|token|secret)\s*[:=]/i.test(text)) return { text, problem: 'The message looks like it contains a credential (token, password or passphrase) and cannot be published.' };
  return { text, problem: null };
}
const ID = /^[A-Za-z0-9_-]{1,64}$/; const isoOk = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
/** Untrusted input (the repository file, the local store): every field is validated. Returns null when it is not a usable record. */
export function sanitizeMessage(o: any): AdminMessage | null {
  if (!o || typeof o !== 'object' || o.format !== ADMIN_MESSAGE_FORMAT || typeof o.formatVersion !== 'number' || o.formatVersion > ADMIN_MESSAGE_FORMAT_VERSION) return null;
  if (!ID.test(String(o.id)) || !isoOk(o.updatedAt) || typeof o.active !== 'boolean') return null; const level: AdminMessageLevel = o.level === 'warning' ? 'warning' : 'info';
  const base = { format: ADMIN_MESSAGE_FORMAT, formatVersion: ADMIN_MESSAGE_FORMAT_VERSION, id: String(o.id), level, updatedAt: String(o.updatedAt), updatedByDevice: String(o.updatedByDevice ?? '').slice(0, 40), appVersion: String(o.appVersion ?? '').slice(0, 20) };
  if (!o.active) return { ...base, active: false, text: '' }; const c = checkMessageText(String(o.text ?? '')); return c.problem ? null : { ...base, active: true, text: c.text };
}
export class AdminMessageService {
  private busy: Promise<unknown> | null = null; private listeners = new Set<() => void>(); private lastPullMs = 0;
  constructor(private store: KeyValueStore, private repo: () => SchemaRepository | null, private path: () => string, private secrets: () => string[] = () => []) {}
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); } private emit() { this.listeners.forEach((l) => l()); }
  /** The record this device knows about (active or a clearing tombstone), or null. */
  record(): AdminMessage | null { return sanitizeMessage(readJson(this.store, KEYS.adminMessage, null)); }
  /** The message to SHOW: active and not dismissed on this device. */
  current(): AdminMessage | null { const r = this.record(); return r && r.active && this.store.get(KEYS.adminMessageDismissed) !== r.id ? r : null; }
  dismiss(): void { const r = this.record(); if (r) { this.store.set(KEYS.adminMessageDismissed, r.id); this.emit(); } }
  private meta(): { sha: string | null; pending: boolean; lastPullAt: string | null } { return readJson(this.store, KEYS.adminMessageMeta, { sha: null, pending: false, lastPullAt: null }); }
  pendingPublish(): boolean { return !!this.meta().pending; }
  private setMeta(m: Partial<{ sha: string | null; pending: boolean; lastPullAt: string | null }>) { writeJson(this.store, KEYS.adminMessageMeta, { ...this.meta(), ...m }); }
  private save(r: AdminMessage): boolean { const ok = writeJson(this.store, KEYS.adminMessage, r); if (ok) this.emit(); return ok; }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> { const run = async () => { while (this.busy) { try { await this.busy; } catch { /* ignore */ } } const p = fn(); this.busy = p; try { return await p; } finally { this.busy = null; } }; return run(); }
  private out(p: Partial<AdminMessageOutcome>): AdminMessageOutcome { return { ok: false, published: false, changed: false, message: '', stage: null, ...p }; }
  private mk(text: string, level: AdminMessageLevel, active: boolean): AdminMessage { const now = new Date().toISOString(); return { format: ADMIN_MESSAGE_FORMAT, formatVersion: ADMIN_MESSAGE_FORMAT_VERSION, id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, active, text: active ? text : '', level, updatedAt: now, updatedByDevice: deviceTag(this.store), appVersion: APP_VERSION }; }
  /** Download + merge. A failure never throws and never removes the message already shown. `quiet` = no result text when nothing changed. */
  pull(): Promise<AdminMessageOutcome> { return this.exclusive(() => this.doPull()); }
  /** Pull, then publish a message that could not be published earlier (administrator device came back online). */
  synchronize(): Promise<AdminMessageOutcome> { return this.exclusive(async () => { const p = await this.doPull(); if (!p.ok || !this.meta().pending) return p; const q = await this.doPush(); return q.ok ? { ...p, published: true, message: 'Admin message published.' } : p; }); }
  /** Throttled pull for "the tab became visible again" — at most once per `minMs`. */
  pullIfStale(minMs = 5 * 60_000): Promise<AdminMessageOutcome | null> { return Date.now() - this.lastPullMs < minMs ? Promise.resolve(null) : this.pull(); }
  private async doPull(): Promise<AdminMessageOutcome> {
    this.lastPullMs = Date.now(); const repo = this.repo(); if (!repo) return this.out({ stage: 'Configuration', message: 'Repository synchronization is not configured.' });
    let f; try { f = await repo.read(this.path()); } catch (e) { return this.out({ stage: 'Download', message: redactSecrets((e as Error).message, this.secrets()) }); }
    if (!f) { this.setMeta({ sha: null, lastPullAt: new Date().toISOString() }); return this.out({ ok: true, message: 'No admin message in the repository.' }); }
    let remote: AdminMessage | null = null; try { remote = sanitizeMessage(JSON.parse(String(f.text).replace(/^\uFEFF/, ''))); } catch { remote = null; }
    if (!remote) return this.out({ stage: 'Parse', message: 'The admin message file in the repository is not valid and was ignored.' });
    const local = this.record(); this.setMeta({ sha: f.sha, lastPullAt: new Date().toISOString() });
    if (local && local.updatedAt >= remote.updatedAt) return this.out({ ok: true, message: 'Admin message is up to date.' });
    if (!this.save(remote)) return this.out({ stage: 'Download', message: 'Browser storage rejected the write — the admin message was not updated.' });
    this.setMeta({ pending: false }); return this.out({ ok: true, changed: true, message: remote.active ? 'New admin message received.' : 'The admin message was cleared.' });
  }
  /** Administrator: publish (or replace) the message. The local copy is saved first; if the repository write fails it is kept and retried by the next synchronization. */
  publish(text: string, level: AdminMessageLevel): Promise<AdminMessageOutcome> {
    return this.exclusive(async () => { const c = checkMessageText(text); if (c.problem) return this.out({ stage: 'Validation', message: c.problem }); const r = this.mk(c.text, level === 'warning' ? 'warning' : 'info', true); return this.commit(r); });
  }
  /** Administrator: clear the message on every device (a clearing record is published, so devices that are offline now receive it later). */
  clear(): Promise<AdminMessageOutcome> { return this.exclusive(async () => this.commit(this.mk('', 'info', false))); }
  private async commit(r: AdminMessage): Promise<AdminMessageOutcome> {
    if (!this.save(r)) return this.out({ stage: 'Publish', message: 'Browser storage rejected the write — nothing was changed.' }); this.setMeta({ pending: true });
    const p = await this.doPush(); const what = r.active ? 'Admin message' : 'The clearing of the admin message';
    return p.ok ? this.out({ ok: true, published: true, changed: true, message: `${what} was published and will appear on the other devices at their next synchronization (or when they open SQL Assistant).` })
      : this.out({ ok: true, published: false, changed: true, stage: p.stage, message: `${what} was saved on this device but could not be published: ${p.message} It will be published automatically at the next synchronization.` });
  }
  private async doPush(retry = true): Promise<AdminMessageOutcome> {
    const repo = this.repo(); if (!repo) return this.out({ stage: 'Configuration', message: 'The repository connection is not set up on this device (Settings → Secret Vault).' });
    const r = this.record(); if (!r) return this.out({ ok: true, message: 'Nothing to publish.' }); const text = JSON.stringify(r, null, 1); if (containsSecret(text)) return this.out({ stage: 'Validation', message: 'The message looks like it contains a credential and was not published.' });
    let remote; try { remote = await repo.read(this.path()); } catch (e) { return this.out({ stage: 'Download', message: redactSecrets((e as Error).message, this.secrets()) }); }
    if (remote) { let theirs: AdminMessage | null = null; try { theirs = sanitizeMessage(JSON.parse(remote.text)); } catch { theirs = null; } if (theirs && theirs.updatedAt > r.updatedAt) { this.save(theirs); this.setMeta({ sha: remote.sha, pending: false }); return this.out({ ok: true, message: 'A newer admin message from another administrator is already published; it was kept.' }); } }
    try { const sha = await repo.write(this.path(), text, remote ? remote.sha : null, `${r.active ? 'Publish' : 'Clear'} admin message`); this.setMeta({ sha, pending: false }); return this.out({ ok: true, published: true }); }
    catch (e) { const m = redactSecrets((e as Error).message, this.secrets()); if (retry && /changed on the server/.test(m)) return this.doPush(false); return this.out({ stage: 'Publish', message: m }); }
  }
}
