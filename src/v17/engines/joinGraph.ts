/**
 * Relationship awareness for join planning. Foreign keys declared on columns are derived as
 * relationships ON THE FLY (the stored schema is never modified). V17.1: relationships whose
 * endpoints do not exist in the schema (legacy V16 delete leftovers) are excluded from join
 * planning so SQL never joins on a missing column; the schema validator reports them.
 */
import type { SchemaModel, RelationshipDef } from '../../types';
function hasColumn(schema: SchemaModel, table: string, column: string): boolean { const t = schema.tables.find((x) => x.name.toUpperCase() === String(table || '').toUpperCase()); return !!t && t.columns.some((c) => c.name.toUpperCase() === String(column || '').toUpperCase()); }
export function isResolvableRelationship(schema: SchemaModel, r: RelationshipDef): boolean { return hasColumn(schema, r.fromTable, r.fromColumn) && hasColumn(schema, r.toTable, r.toColumn); }
export function deriveFkRelationships(schema: SchemaModel): RelationshipDef[] {
  const existing = new Set(schema.relationships.map((r) => `${r.fromTable}.${r.fromColumn}>${r.toTable}.${r.toColumn}`.toUpperCase()));
  const reverse = new Set(schema.relationships.map((r) => `${r.toTable}.${r.toColumn}>${r.fromTable}.${r.fromColumn}`.toUpperCase()));
  const out: RelationshipDef[] = [];
  schema.tables.forEach((t) => t.columns.forEach((c) => {
    if (!c.isForeignKey || !c.references?.table || !c.references.column) return;
    const target = schema.tables.find((x) => x.name.toUpperCase() === c.references!.table.toUpperCase());
    const targetCol = target?.columns.find((x) => x.name.toUpperCase() === c.references!.column.toUpperCase());
    if (!target || !targetCol) return;
    const key = `${t.name}.${c.name}>${target.name}.${targetCol.name}`.toUpperCase();
    if (existing.has(key) || reverse.has(key)) return;
    out.push({ id: `fk:${t.name}.${c.name}`, fromTable: t.name, fromColumn: c.name, toTable: target.name, toColumn: targetCol.name, kind: 'many-to-one' });
  }));
  return out;
}
const memo = new WeakMap<SchemaModel, { sig: string; result: SchemaModel }>();
/** Same schema with only resolvable relationships, plus FK-derived ones (cached per instance + content signature). */
export function withFkRelationships(schema: SchemaModel): SchemaModel {
  const sig = `${schema.relationships.length}|${schema.tables.length}|${schema.tables.reduce((n, t) => n + t.columns.length, 0)}|${schema.updatedAt}|${schema.versionMeta?.checksum ?? ''}`;
  const hit = memo.get(schema); if (hit && hit.sig === sig) return hit.result;
  const valid = schema.relationships.filter((r) => isResolvableRelationship(schema, r));
  const derived = deriveFkRelationships(schema);
  const result = derived.length || valid.length !== schema.relationships.length ? { ...schema, relationships: [...valid, ...derived] } : schema;
  memo.set(schema, { sig, result }); return result;
}
