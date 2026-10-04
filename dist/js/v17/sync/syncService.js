import { KEYS, readJson, writeJson } from '../../services/storage.js';
import { checkRegistry, serializeRegistry, describeIssue, summarizeMigration } from './schemaFormat.js';
import { shouldApplyRemoteActiveSchema, getDeviceTag } from '../../engines/schemaVersionEngine.js';
import { redactSecrets } from '../errors/appErrors.js';
import { makeId } from '../../utils/id.js';
import { DEFAULT_SCHEMAS } from '../../data/defaultSchemas.js';
let DEFAULT_HASHES_CACHE = null;
const DEFAULT_HASHES = { has: (h) => (DEFAULT_HASHES_CACHE || (DEFAULT_HASHES_CACHE = new Set(DEFAULT_SCHEMAS.map((d) => contentHash(d))))).has(h) };
const norm = (s) => s.trim().toLowerCase();
function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
} return h.toString(16).padStart(8, '0') + str.length.toString(36); }
/** Hash of the logical content only (tables + relationships). Volatile metadata is excluded on purpose. */
/** Canonical form: sorted keys; false / null / undefined / empty values omitted (they are equivalent on read). */
function canon(v) {
    if (Array.isArray(v))
        return v.map(canon);
    if (v && typeof v === 'object') {
        const o = {};
        Object.keys(v).sort().forEach((k) => { const x = v[k]; if (x === undefined || x === null || x === false || x === '' || (Array.isArray(x) && !x.length))
            return; o[k] = canon(x); });
        return o;
    }
    return v;
}
export function contentHash(s) {
    return fnv(JSON.stringify(canon({ t: s.tables.map((t) => ({ n: t.name, m: t.module, d: t.description, o: t.objectType || '', c: t.columns.map((c) => ({ ...c, label: c.label === c.name ? '' : c.label })) })), r: s.relationships.map((r) => [r.fromTable, r.fromColumn, r.toTable, r.toColumn, r.kind]) })));
}
function firstLocation(e) { return e.table ? `${e.table}${e.column ? `.${e.column}` : ''}` : e.path; }
export function rejectedFromReport(r) {
    const first = r.errors[0];
    return { name: r.name, legacy: r.legacy, location: first ? firstLocation(first) : '(schema)', reason: first ? first.message : 'Unknown validation problem.', errors: r.errors.slice(0, 25).map(describeIssue), total: r.errors.length };
}
export function rejectionMessage(x) {
    return x.legacy
        ? `Legacy schema migration could not be completed.\nSchema: ${x.name}\nLocation: ${x.location}\nReason: ${x.reason}${x.total > 1 ? ` (…and ${x.total - 1} more)` : ''}\nThe existing valid local schema was preserved.`
        : `Schema "${x.name}" failed validation and was not loaded.\nLocation: ${x.location}\nReason: ${x.reason}${x.total > 1 ? ` (…and ${x.total - 1} more)` : ''}\nYour local copy was kept unchanged.`;
}
export function migrationMessage(m) {
    return `Legacy schema detected.\nThe schema "${m.name}" was created by an older SQL Assistant version and required migration before synchronization.\nMigration completed successfully. The schema was validated and synchronized using the current schema format.${m.summary.length ? `\n• ${m.summary.join('\n• ')}` : ''}${m.warnings.length ? `\nAttention: ${m.warnings.join(' ')}` : ''}`;
}
export class SyncService {
    constructor(schemas, repo, store, schemaPath, knownSecrets = () => []) {
        this.schemas = schemas;
        this.repo = repo;
        this.store = store;
        this.schemaPath = schemaPath;
        this.knownSecrets = knownSecrets;
        this.busy = null;
    }
    bases() { return readJson(this.store, KEYS.syncBase, {}); }
    setBases(b) { writeJson(this.store, KEYS.syncBase, b); }
    meta() { return readJson(this.store, KEYS.syncMeta, { sha: null, lastPullAt: null, lastPushAt: null }); }
    setMeta(m) { writeJson(this.store, KEYS.syncMeta, { ...this.meta(), ...m }); }
    log() { return readJson(this.store, KEYS.syncLog, []); }
    addLog(kind, message) { const l = [{ id: makeId('log'), timestamp: new Date().toISOString(), kind, message: redactSecrets(message, this.knownSecrets()) }, ...this.log()].slice(0, 200); writeJson(this.store, KEYS.syncLog, l); }
    conflicts() { return readJson(this.store, KEYS.conflicts, []); }
    setConflicts(c) { writeJson(this.store, KEYS.conflicts, c); }
    /** Serializes sync operations (no overlapping pull/push races). */
    async exclusive(fn) { while (this.busy) {
        try {
            await this.busy;
        }
        catch { /* ignore */ }
    } const p = fn(); this.busy = p; try {
        return await p;
    }
    finally {
        this.busy = null;
    } }
    pull() { return this.exclusive(() => this.doPull()); }
    async doPull() {
        const out = { ok: false, fileProblem: null, remoteWriter: '', remoteLegacy: false, remoteMissing: false, added: [], updated: [], unchanged: [], localAhead: [], conflicts: [], migrated: [], rejected: [], activeChanged: false, needsPublish: false, messages: [] };
        const repo = this.repo();
        if (!repo) {
            out.fileProblem = 'Repository synchronization is not configured. Add the GitHub repository and token in Settings → Secret Vault.';
            return out;
        }
        let file;
        try {
            file = await repo.read(this.schemaPath());
        }
        catch (e) {
            out.fileProblem = redactSecrets(e.message, this.knownSecrets());
            this.addLog('error', out.fileProblem);
            return out;
        }
        if (!file) {
            out.ok = true;
            out.remoteMissing = true;
            out.needsPublish = true;
            out.messages.push('The repository has no schema file yet — publishing will create it.');
            this.addLog('pull', 'Remote schema file not found.');
            return out;
        }
        const report = checkRegistry({ text: file.text });
        out.remoteWriter = report.writer.label;
        out.remoteLegacy = report.writer.legacy;
        if (report.fileProblem) {
            out.fileProblem = `${report.fileProblem.message} Your local schemas were kept unchanged.`;
            this.addLog('error', out.fileProblem);
            return out;
        }
        const local = this.schemas.registry();
        const bases = this.bases();
        const now = new Date().toISOString();
        const schemas = local.schemas.map((s) => ({ ...s }));
        const conflicts = this.conflicts().filter((c) => !report.validSchemas.some((r) => norm(r.name) === norm(c.schemaName)));
        report.schemas.forEach((rep) => {
            if (!rep.valid || !rep.schema) {
                out.rejected.push(rejectedFromReport(rep));
                return;
            }
            const rs = rep.schema;
            const key = norm(rs.name);
            const rh = contentHash(rs);
            if (rep.migrationStatus === 'migrated')
                out.migrated.push({ name: rs.name, summary: summarizeMigration(rep.migrationNotes), warnings: rs.migration?.warnings || [] });
            const idx = schemas.findIndex((s) => norm(s.name) === key);
            if (idx === -1) {
                const id = schemas.some((s) => s.id === rs.id) ? `${rs.id}-${Date.now().toString(36)}` : rs.id;
                schemas.push({ ...rs, id, status: 'inactive', lastSyncedAt: now });
                bases[key] = rh;
                out.added.push(rs.name);
                return;
            }
            const ls = schemas[idx];
            const lh = contentHash(ls);
            const base = bases[key];
            if (lh === rh) {
                schemas[idx] = { ...ls, lastSyncedAt: now, migration: ls.migration || rs.migration };
                bases[key] = rh;
                out.unchanged.push(rs.name);
                return;
            }
            if (base && lh === base) {
                schemas[idx] = { ...rs, id: ls.id, status: ls.status, lastSyncedAt: now };
                bases[key] = rh;
                out.updated.push(rs.name);
                return;
            }
            if (base && rh === base) {
                out.localAhead.push(ls.name);
                return;
            }
            // First sync of an untouched built-in schema: the repository copy wins (nothing local to lose).
            if (!base && !ls.lastSyncedAt && DEFAULT_HASHES.has(lh)) {
                schemas[idx] = { ...rs, id: ls.id, status: ls.status, lastSyncedAt: now };
                bases[key] = rh;
                out.updated.push(rs.name);
                return;
            }
            const c = { id: makeId('cf'), schemaId: ls.id, schemaName: ls.name, localVersion: ls.version, remoteVersion: rs.version, changedPaths: [], remoteSchemaJson: JSON.stringify(rs), detectedAt: now };
            conflicts.push(c);
            out.conflicts.push(c);
        });
        // Schemas that exist only locally are local-ahead (published on the next push).
        schemas.forEach((s) => { if (!report.schemas.some((r) => r.schema && norm(r.schema.name) === norm(s.name)) && !out.rejected.some((x) => norm(x.name) === norm(s.name)) && !out.localAhead.includes(s.name))
            out.localAhead.push(s.name); });
        // Active schema (latest explicit change wins).
        let activeSchemaId = local.activeSchemaId;
        let activeSchemaUpdatedAt = local.activeSchemaUpdatedAt ?? null;
        const remoteActive = report.activeSchemaId ? report.validSchemas.find((s) => s.id === report.activeSchemaId) : undefined;
        const mappedRemoteActive = remoteActive ? schemas.find((s) => norm(s.name) === norm(remoteActive.name))?.id : undefined;
        if (mappedRemoteActive && shouldApplyRemoteActiveSchema(local.activeSchemaUpdatedAt, report.activeSchemaUpdatedAt, mappedRemoteActive, local.activeSchemaId)) {
            activeSchemaId = mappedRemoteActive;
            activeSchemaUpdatedAt = report.activeSchemaUpdatedAt;
            out.activeChanged = true;
        }
        const next = { schemas, activeSchemaId, activeSchemaUpdatedAt };
        const saved = this.schemas.replaceRegistry(next);
        if (!saved.ok) {
            out.fileProblem = `The synchronized schemas could not be saved locally: ${saved.errors.map((e) => e.message).join(' ')} Your local schemas were kept unchanged.`;
            this.addLog('error', out.fileProblem);
            return out;
        }
        this.setBases(bases);
        this.setConflicts(conflicts);
        this.setMeta({ sha: file.sha, lastPullAt: now });
        out.ok = true;
        out.needsPublish = out.migrated.length > 0 || out.localAhead.length > 0;
        out.migrated.forEach((m) => out.messages.push(migrationMessage(m)));
        if (out.rejected.length)
            out.messages.push(`${out.rejected.length} of ${report.schemas.length} schema(s) in the repository failed validation and were not loaded — your local copies were kept unchanged.`, ...out.rejected.map(rejectionMessage));
        this.addLog('pull', `Pulled ${report.schemas.length} schema(s) (writer: ${report.writer.label}): ${out.added.length} added, ${out.updated.length} updated, ${out.unchanged.length} unchanged, ${out.migrated.length} migrated, ${out.rejected.length} rejected, ${out.conflicts.length} conflict(s).`);
        return out;
    }
    /** Publish protection: never writes an invalid schema; always writes the current writer stamp. */
    push(opts = {}) { return this.exclusive(() => this.doPush(opts)); }
    async doPush(opts) {
        const repo = this.repo();
        if (!repo)
            return { ok: false, messages: [], problems: ['Repository synchronization is not configured. Add the GitHub repository and token in Settings → Secret Vault.'] };
        let remote;
        try {
            remote = await repo.read(this.schemaPath());
        }
        catch (e) {
            return { ok: false, messages: [], problems: [redactSecrets(e.message, this.knownSecrets())] };
        }
        if (remote && remote.sha !== this.meta().sha) {
            const pulled = await this.doPull();
            if (!pulled.ok)
                return { ok: false, messages: [], problems: [pulled.fileProblem || 'Pull before publish failed.'] };
            if (pulled.conflicts.length)
                return { ok: false, skipped: 'conflicts', messages: pulled.messages, problems: [`${pulled.conflicts.length} schema conflict(s) must be resolved before publishing.`] };
            remote = await repo.read(this.schemaPath());
        }
        if (remote && !opts.allowReplacingInvalidRemote) {
            const rep = checkRegistry({ text: remote.text });
            const invalidOnlyRemote = rep.invalidSchemas.filter((r) => !this.schemas.schemas().some((s) => norm(s.name) === norm(r.name)));
            if (invalidOnlyRemote.length)
                return { ok: false, skipped: 'remote-invalid', messages: [], problems: [`The repository contains ${invalidOnlyRemote.length} schema(s) that cannot be read (${invalidOnlyRemote.map((r) => `"${r.name}"`).join(', ')}). Publishing would remove them from the repository. Recover them first, or confirm publishing in Settings → Schema Management.`] };
        }
        const ser = serializeRegistry(this.schemas.registry(), safeDevice());
        if (!ser.ok)
            return { ok: false, messages: [], problems: ser.problems.map((p) => `Schema "${p.name}" is invalid and was not published: ${p.errors.slice(0, 3).map(describeIssue).join('; ')}`) };
        let sha;
        try {
            sha = await repo.write(this.schemaPath(), ser.text, remote ? remote.sha : null, `SQL Assistant 17.2.1: publish ${this.schemas.schemas().length} validated schema(s)`);
        }
        catch (e) {
            const msg = redactSecrets(e.message, this.knownSecrets());
            this.addLog('error', msg);
            return { ok: false, messages: [], problems: [msg] };
        }
        const bases = {};
        this.schemas.schemas().forEach((s) => { bases[norm(s.name)] = contentHash(s); });
        this.setBases(bases);
        this.setMeta({ sha, lastPushAt: new Date().toISOString() });
        this.addLog('push', `Published ${this.schemas.schemas().length} validated schema(s) in format 2.`);
        return { ok: true, messages: [`Published ${this.schemas.schemas().length} validated schema(s) using the current schema format.`], problems: [] };
    }
    /** Normal synchronization: pull, then publish when this device holds newer or migrated data. */
    async synchronize() {
        const pull = await this.pull();
        if (!pull.ok || !pull.needsPublish || pull.conflicts.length)
            return { pull, push: null };
        if (pull.rejected.length)
            return { pull, push: { ok: false, skipped: 'remote-invalid', messages: [], problems: ['Publishing was postponed because the repository still contains schema(s) that cannot be read; they would otherwise be removed.'] } };
        return { pull, push: await this.push() };
    }
    resolveConflict(id, choice) {
        const c = this.conflicts().find((x) => x.id === id);
        if (!c)
            return false;
        if (choice === 'take-remote') {
            const rs = JSON.parse(c.remoteSchemaJson);
            const ls = this.schemas.byId(c.schemaId);
            const r = this.schemas.saveSchema({ ...rs, id: c.schemaId, status: ls?.status || 'inactive', lastSyncedAt: new Date().toISOString() });
            if (!r.ok)
                return false;
            const b = this.bases();
            b[norm(rs.name)] = contentHash(rs);
            this.setBases(b);
        }
        else {
            const b = this.bases();
            b[norm(c.schemaName)] = contentHash(JSON.parse(c.remoteSchemaJson));
            this.setBases(b);
        }
        this.setConflicts(this.conflicts().filter((x) => x.id !== id));
        return true;
    }
}
function safeDevice() { try {
    return getDeviceTag();
}
catch {
    return '';
} }
//# sourceMappingURL=syncService.js.map