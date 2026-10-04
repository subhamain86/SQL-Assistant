import type { SchemaModel, RelationshipDef } from '../types';
const direct = (s: SchemaModel, a: string, b: string) => s.relationships.filter((r) => (r.fromTable === a && r.toTable === b) || (r.fromTable === b && r.toTable === a));
const line = (r: RelationshipDef, inc: string, j: string) => (r.fromTable === inc ? `INNER JOIN ${j} ON ${inc}.${r.fromColumn} = ${j}.${r.toColumn}` : `INNER JOIN ${j} ON ${j}.${r.fromColumn} = ${inc}.${r.toColumn}`);
export function computeAutoJoinPlan(s: SchemaModel, primary: string, others: string[]): { joinLines: string[]; unresolvedWarnings: string[] } {
  const joinLines: string[] = []; const warn: string[] = []; const scope = new Set([primary]);
  for (const t of others) {
    if (scope.has(t)) continue; let done = false;
    for (const a of Array.from(scope)) {
      const d = direct(s, a, t); if (d.length) { joinLines.push(line(d[0], a, t)); done = true; break; }
      const br = s.tables.find((x) => !scope.has(x.name) && x.name !== t && direct(s, x.name, a).length && direct(s, x.name, t).length);
      if (br) { joinLines.push(line(direct(s, br.name, a)[0], a, br.name)); scope.add(br.name); joinLines.push(line(direct(s, br.name, t)[0], br.name, t)); done = true; break; }
    }
    if (!done) warn.push(`No relationship path found between "${t}" and the other selected table(s) in the active schema — no JOIN was generated for it.`);
    scope.add(t);
  }
  return { joinLines, unresolvedWarnings: warn };
}
