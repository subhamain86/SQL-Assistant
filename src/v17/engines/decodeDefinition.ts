/**
 * V17.5.2 — the single authority for "does the ACTIVE schema contain a usable CASE/DECODE definition for this column?".
 *
 * The schema format stores a definition as `column.decode = [{ rawValue, label }, …]` (plus `unmappedDecodeLabels` for legacy labels whose code was lost).
 * Whether it is written as CASE or DECODE is a rendering choice of the SQL engine (DECODE only on Oracle), not something the schema stores.
 *
 *   none        no definition for this column                          → only the manual option is offered
 *   valid       every entry has a non-empty code and label, no conflicts → the schema option is offered and SQL may be generated
 *   incomplete  a usable list exists but legacy labels have no code      → NOT offered, NOT used (a partial mapping would silently hide values)
 *   invalid     an entry is malformed (empty code / empty label, conflicting duplicate, not a list) → NOT offered, NOT used
 *
 * Nothing here ever invents an entry. Pure functions, no I/O, no imports from the rest of the app (so every layer may use it without cycles).
 */
import type { ColumnDef, DecodeEntry } from '../../types';
export type DecodeState = 'none' | 'valid' | 'incomplete' | 'invalid';
export interface DecodeDefinition { state: DecodeState; entries: DecodeEntry[]; problems: string[]; }
const NONE: DecodeDefinition = { state: 'none', entries: [], problems: [] };
export function decodeDefinition(col: Pick<ColumnDef, 'decode' | 'unmappedDecodeLabels'> | null | undefined): DecodeDefinition {
  if (!col) return NONE; const raw = (col as { decode?: unknown }).decode; const unm = (col.unmappedDecodeLabels || []).map((x) => String(x ?? '').trim()).filter(Boolean);
  const unmappedProblem = unm.length ? [`${unm.length} label${unm.length === 1 ? '' : 's'} without a code (${unm.slice(0, 4).join(', ')}${unm.length > 4 ? ', …' : ''})`] : [];
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) return unm.length ? { state: 'incomplete', entries: [], problems: unmappedProblem } : NONE;
  if (!Array.isArray(raw)) return { state: 'invalid', entries: [], problems: ['the definition is not a list of code = label pairs'] };
  const problems: string[] = []; const entries: DecodeEntry[] = []; const seen = new Map<string, string>();
  raw.forEach((d: unknown, i) => {
    if (!d || typeof d !== 'object') { problems.push(`entry #${i + 1} is not a code = label pair`); return; }
    const code = String((d as DecodeEntry).rawValue ?? ''); const label = String((d as DecodeEntry).label ?? '');
    if (!code.trim()) { problems.push(`entry #${i + 1} has an empty code`); return; } if (!label.trim()) { problems.push(`code "${code}" has an empty label`); return; }
    if (seen.has(code)) { if (seen.get(code) !== label) problems.push(`code "${code}" is mapped to more than one label`); return; } // an identical repeated pair is harmless and is written once
    seen.set(code, label); entries.push({ rawValue: code, label });
  });
  if (problems.length) return { state: 'invalid', entries: [], problems };
  return unmappedProblem.length ? { state: 'incomplete', entries, problems: unmappedProblem } : { state: 'valid', entries, problems: [] };
}
/** The sentence shown to the user (picker, builder warnings, NLU notes) when a schema definition cannot be used. Empty for `valid`. */
export function decodeUnavailableMessage(def: DecodeDefinition, ref: string): string {
  if (def.state === 'valid') return '';
  if (def.state === 'none') return `No CASE/DECODE definition is available for ${ref} in the active schema`;
  return `The CASE/DECODE definition of ${ref} in the active schema is ${def.state} (${def.problems.join('; ')}) — no CASE/DECODE is generated from it. Correct it in Settings → Manual Schema Update, or use Manual CASE/DECODE`;
}
/** Default alias of a decoded column. When two decoded columns would get the same name (STATUS of two tables) BOTH are table-qualified, so the SQL stays valid and stable. */
export function decodeAliases(specs: { id: string; table: string; column: string; alias?: string }[]): Map<string, string> {
  const out = new Map<string, string>(); const base = (s: { column: string }) => `${s.column}_DESC`; const count = new Map<string, number>();
  specs.filter((s) => !s.alias).forEach((s) => count.set(base(s).toUpperCase(), (count.get(base(s).toUpperCase()) || 0) + 1));
  const taken = new Set(specs.filter((s) => s.alias).map((s) => String(s.alias).toUpperCase()));
  specs.forEach((s) => {
    if (s.alias) { out.set(s.id, s.alias); return; } let a = (count.get(base(s).toUpperCase()) || 0) > 1 ? `${s.table}_${s.column}_DESC` : base(s); let n = 2; const root = a;
    while (taken.has(a.toUpperCase())) a = `${root}_${n++}`; taken.add(a.toUpperCase()); out.set(s.id, a);
  });
  return out;
}
