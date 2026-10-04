import type { SchemaModel, RelationshipDef } from '../types';
export interface JoinPathOption { id: string; label: string; bridgeTable: string | null; relationships: RelationshipDef[]; }
export interface JoinPathResolution { pairKey: string; tableA: string; tableB: string; options: JoinPathOption[]; isAmbiguous: boolean; chosenOptionId: string | null; }
export interface AutoJoinPlan { joinLines: string[]; bridgeTablesUsed: string[]; resolutions: JoinPathResolution[]; unresolvedWarnings: string[]; }
function pairKey(a: string, b: string): string { return [a, b].sort().join('|'); }
function directRelationships(schema: SchemaModel, a: string, b: string): RelationshipDef[] { return schema.relationships.filter((r) => (r.fromTable === a && r.toTable === b) || (r.fromTable === b && r.toTable === a)); }
function bridgeTablesBetween(schema: SchemaModel, a: string, b: string, excludeTables: Set<string>) {
  const results: { bridge: string; relA: RelationshipDef; relB: RelationshipDef }[] = [];
  for (const t of schema.tables) { if (t.name === a || t.name === b || excludeTables.has(t.name)) continue; const relsToA = directRelationships(schema, t.name, a); const relsToB = directRelationships(schema, t.name, b); if (relsToA.length > 0 && relsToB.length > 0) results.push({ bridge: t.name, relA: relsToA[0], relB: relsToB[0] }); }
  return results;
}
function relationshipJoinLine(rel: RelationshipDef, alreadyIncluded: string, joining: string): string {
  if (rel.fromTable === alreadyIncluded) return `INNER JOIN ${joining} ON ${alreadyIncluded}.${rel.fromColumn} = ${joining}.${rel.toColumn}`;
  return `INNER JOIN ${joining} ON ${joining}.${rel.fromColumn} = ${alreadyIncluded}.${rel.toColumn}`;
}
export function computeAutoJoinPlan(schema: SchemaModel, primaryTable: string, otherTables: string[], joinPathChoices: Record<string, string>): AutoJoinPlan {
  const joinLines: string[] = []; const bridgeTablesUsed: string[] = []; const resolutions: JoinPathResolution[] = []; const unresolvedWarnings: string[] = [];
  const inScope = new Set<string>([primaryTable]); const joinedPairs = new Set<string>();
  for (const target of otherTables) {
    if (inScope.has(target)) continue;
    const scopeList = [primaryTable, ...Array.from(inScope).filter((t) => t !== primaryTable)];
    let resolved = false;
    for (const anchor of scopeList) {
      const key = pairKey(anchor, target);
      if (joinedPairs.has(key)) { resolved = true; break; }
      const direct = directRelationships(schema, anchor, target);
      const bridges = direct.length === 0 ? bridgeTablesBetween(schema, anchor, target, inScope) : [];
      const options: JoinPathOption[] = [
        ...direct.map((rel) => ({ id: `direct:${rel.id}`, label: `Direct`, bridgeTable: null, relationships: [rel] })),
        ...bridges.map((b) => ({ id: `bridge:${b.bridge}`, label: `Via ${b.bridge}`, bridgeTable: b.bridge, relationships: [b.relA, b.relB] }))
      ];
      if (options.length === 0) continue;
      const isAmbiguous = options.length > 1;
      const chosenId = joinPathChoices[key] && options.some((o) => o.id === joinPathChoices[key]) ? joinPathChoices[key] : (isAmbiguous ? null : options[0].id);
      resolutions.push({ pairKey: key, tableA: anchor, tableB: target, options, isAmbiguous, chosenOptionId: chosenId });
      if (chosenId) {
        const chosen = options.find((o) => o.id === chosenId)!;
        if (chosen.bridgeTable && !inScope.has(chosen.bridgeTable)) { joinLines.push(relationshipJoinLine(chosen.relationships[0], anchor, chosen.bridgeTable)); inScope.add(chosen.bridgeTable); bridgeTablesUsed.push(chosen.bridgeTable); joinLines.push(relationshipJoinLine(chosen.relationships[1], chosen.bridgeTable, target)); }
        else if (!chosen.bridgeTable) joinLines.push(relationshipJoinLine(chosen.relationships[0], anchor, target));
        inScope.add(target); joinedPairs.add(key);
      }
      resolved = true; break;
    }
    if (!resolved) { unresolvedWarnings.push(`No relationship path found between "${target}" and the other selected table(s) in the active schema — no JOIN was generated for it.`); inScope.add(target); }
  }
  return { joinLines, bridgeTablesUsed, resolutions, unresolvedWarnings };
}
