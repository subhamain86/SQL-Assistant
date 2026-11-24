/** Automatic joins from relationships (V17.2 behaviour restored: direct or bridge paths; the user chooses when several exist). */
import type { SchemaModel, RelationshipDef } from '../types';
export interface JoinPathOption { id: string; label: string; bridgeTable: string | null; relationships: RelationshipDef[]; }
export interface JoinPathResolution { pairKey: string; tableA: string; tableB: string; options: JoinPathOption[]; isAmbiguous: boolean; chosenOptionId: string | null; }
export interface JoinPlan { joinLines: string[]; bridgeTablesUsed: string[]; resolutions: JoinPathResolution[]; description: string[]; unresolvedWarnings: string[]; }
const pairKey = (a: string, b: string) => [a, b].sort().join('|');
const direct = (s: SchemaModel, a: string, b: string) => s.relationships.filter((r) => (r.fromTable === a && r.toTable === b) || (r.fromTable === b && r.toTable === a));
const describeRel = (r: RelationshipDef) => `${r.fromTable}.${r.fromColumn} = ${r.toTable}.${r.toColumn}`;
const line = (r: RelationshipDef, inc: string, j: string) => (r.fromTable === inc ? `INNER JOIN ${j} ON ${inc}.${r.fromColumn} = ${j}.${r.toColumn}` : `INNER JOIN ${j} ON ${j}.${r.fromColumn} = ${inc}.${r.toColumn}`);
export function computeAutoJoinPlan(s: SchemaModel, primary: string, others: string[], choices: Record<string, string> = {}): JoinPlan {
  const joinLines: string[] = []; const bridgeTablesUsed: string[] = []; const resolutions: JoinPathResolution[] = []; const description: string[] = []; const warn: string[] = [];
  const scope = new Set([primary]); const joined = new Set<string>();
  for (const target of others) {
    if (scope.has(target)) continue; let resolved = false;
    for (const anchor of [primary, ...Array.from(scope).filter((t) => t !== primary)]) {
      const key = pairKey(anchor, target); if (joined.has(key)) { resolved = true; break; }
      const d = direct(s, anchor, target);
      const bridges = d.length ? [] : s.tables.filter((t) => t.name !== anchor && t.name !== target && !scope.has(t.name) && direct(s, t.name, anchor).length && direct(s, t.name, target).length);
      const options: JoinPathOption[] = [...d.map((r) => ({ id: `direct:${r.id}`, label: `Direct (${describeRel(r)})`, bridgeTable: null, relationships: [r] })), ...bridges.map((b) => ({ id: `bridge:${b.name}`, label: `Via ${b.name}`, bridgeTable: b.name, relationships: [direct(s, b.name, anchor)[0], direct(s, b.name, target)[0]] }))];
      if (!options.length) continue;
      const amb = options.length > 1; const chosenId = choices[key] && options.some((o) => o.id === choices[key]) ? choices[key] : amb ? null : options[0].id;
      resolutions.push({ pairKey: key, tableA: anchor, tableB: target, options, isAmbiguous: amb, chosenOptionId: chosenId });
      if (chosenId) { const o = options.find((x) => x.id === chosenId)!;
        if (o.bridgeTable && !scope.has(o.bridgeTable)) { joinLines.push(line(o.relationships[0], anchor, o.bridgeTable)); scope.add(o.bridgeTable); bridgeTablesUsed.push(o.bridgeTable); joinLines.push(line(o.relationships[1], o.bridgeTable, target)); description.push(`${anchor} ↔ ${target} via ${o.bridgeTable}`); }
        else if (!o.bridgeTable) { joinLines.push(line(o.relationships[0], anchor, target)); description.push(`${anchor} ↔ ${target} on ${describeRel(o.relationships[0])}`); }
        scope.add(target); joined.add(key);
      } else warn.push(`More than one join path exists between ${anchor} and ${target} — choose one in Advanced Options → Join paths.`);
      resolved = true; break;
    }
    if (!resolved) { warn.push(`No relationship path found between "${target}" and the other selected table(s) in the Active Schema — no JOIN was generated for it.`); scope.add(target); }
  }
  return { joinLines, bridgeTablesUsed, resolutions, description, unresolvedWarnings: warn };
}
