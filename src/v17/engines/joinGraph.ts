import type { SchemaModel, RelationshipDef } from '../../types';
const has = (s: SchemaModel, t: string, c: string) => !!s.tables.find((x) => x.name.toUpperCase() === String(t).toUpperCase())?.columns.some((k) => k.name.toUpperCase() === String(c).toUpperCase());
export const isResolvableRelationship = (s: SchemaModel, r: RelationshipDef) => has(s, r.fromTable, r.fromColumn) && has(s, r.toTable, r.toColumn);
export function deriveFkRelationships(s: SchemaModel): RelationshipDef[] {
  const ex = new Set(s.relationships.flatMap((r) => [`${r.fromTable}.${r.fromColumn}>${r.toTable}`, `${r.toTable}.${r.toColumn}>${r.fromTable}`]));
  const o: RelationshipDef[] = []; s.tables.forEach((t) => t.columns.forEach((c) => { if (c.isForeignKey && c.references && has(s, c.references.table, c.references.column) && !ex.has(`${t.name}.${c.name}>${c.references.table}`)) o.push({ id: `fk:${t.name}.${c.name}`, fromTable: t.name, fromColumn: c.name, toTable: c.references.table, toColumn: c.references.column, kind: 'many-to-one' }); }));
  return o;
}
export const withFkRelationships = (s: SchemaModel): SchemaModel => ({ ...s, relationships: [...s.relationships.filter((r) => isResolvableRelationship(s, r)), ...deriveFkRelationships(s)] });
