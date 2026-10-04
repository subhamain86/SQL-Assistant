import type { SchemaModel, SchemaVersionMeta, SchemaConflict, TableDef, RelationshipDef } from '../types';
const DEVICE_ID_KEY = 'sqla.deviceTag.v15';
export function getDeviceTag(): string { let tag: string | null = null; try { tag = localStorage.getItem(DEVICE_ID_KEY); } catch { /* ignore */ } if (!tag) { tag = 'device-' + Math.random().toString(36).slice(2, 8); try { localStorage.setItem(DEVICE_ID_KEY, tag); } catch { /* ignore */ } } return tag; }
function canonicalize(tables: TableDef[], relationships: RelationshipDef[]): string { const st = [...tables].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ ...t, columns: [...t.columns].sort((a, b) => a.name.localeCompare(b.name)) })); const sr = [...relationships].sort((a, b) => (a.fromTable + a.fromColumn).localeCompare(b.fromTable + b.fromColumn)); return JSON.stringify({ tables: st, relationships: sr }); }
export async function computeChecksum(tables: TableDef[], relationships: RelationshipDef[]): Promise<string> { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalize(tables, relationships)) as BufferSource); return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join(''); }
function bumpVersion(current: string | undefined): string { if (!current) return '1.0.0'; const p = current.split('.').map((x) => parseInt(x, 10) || 0); while (p.length < 3) p.push(0); p[2] += 1; return p.join('.'); }
export async function stampNewVersion(schema: SchemaModel, source: SchemaVersionMeta['source']): Promise<SchemaVersionMeta> { return { version: bumpVersion(schema.versionMeta?.version), schemaId: schema.versionMeta?.schemaId || schema.id, lastUpdated: new Date().toISOString(), updatedByDevice: getDeviceTag(), source, checksum: await computeChecksum(schema.tables, schema.relationships) }; }
export function detectConflict(local: SchemaModel, remote: SchemaModel): SchemaConflict {
  const lc = local.versionMeta?.checksum ?? ''; const rc = remote.versionMeta?.checksum ?? '';
  const lv = local.versionMeta?.version ?? local.version; const rv = remote.versionMeta?.version ?? remote.version;
  if (lc && rc && lc === rc) return { hasConflict: false, localVersion: lv, remoteVersion: rv, changedPaths: [] };
  const changed: string[] = []; const map = new Map<string, string>();
  local.tables.forEach((t) => t.columns.forEach((c) => map.set(`${t.name}.${c.name}`, JSON.stringify(c))));
  remote.tables.forEach((t) => t.columns.forEach((c) => { const p = `${t.name}.${c.name}`; const l = map.get(p); if (l === undefined) changed.push(p + ' (new)'); else if (l !== JSON.stringify(c)) changed.push(p); map.delete(p); }));
  map.forEach((_v, p) => changed.push(p + ' (removed remotely)'));
  const relKey = (r: RelationshipDef) => `${r.fromTable}.${r.fromColumn}>${r.toTable}.${r.toColumn}`;
  const lr = new Set(local.relationships.map(relKey)); const rr = new Set(remote.relationships.map(relKey));
  rr.forEach((k) => { if (!lr.has(k)) changed.push(`relationship ${k} (new)`); }); lr.forEach((k) => { if (!rr.has(k)) changed.push(`relationship ${k} (removed remotely)`); });
  return { hasConflict: changed.length > 0, localVersion: lv, remoteVersion: rv, changedPaths: changed };
}
export function sameLogicalSchema(a: Pick<SchemaModel, 'name'>, b: Pick<SchemaModel, 'name'>): boolean { return a.name.trim().toLowerCase() === b.name.trim().toLowerCase(); }
/** V16.4/V16.5: last-write-wins for the Active Schema pointer across devices. */
export function shouldApplyRemoteActiveSchema(localAt: string | null | undefined, remoteAt: string | null | undefined, remoteId: string | null | undefined, localId: string): boolean {
  if (!remoteId || remoteId === localId || !remoteAt) return false;
  const r = new Date(remoteAt).getTime(); if (!Number.isFinite(r)) return false;
  if (!localAt) return true;
  const l = new Date(localAt).getTime(); if (!Number.isFinite(l)) return true;
  return r > l;
}
