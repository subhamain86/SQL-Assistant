/**
 * V17.2.1 — recursive schema validator with exact locations.
 * Validation is NOT weakened: every rule of the V17.x validator is enforced (decode entries must have
 * a non-empty raw value, no duplicates, identifiers, arrays, types…). Locations use the format
 *   schemas[2] › tables[0] (IA_ACTION_LOG) › columns[2] (ROOT_DOCUMENT_TYPE) › decode[0] › rawValue
 */
export interface SchemaIssue { severity: 'error' | 'warning'; path: string; location: string; property: string; reason: string; }

const IDENT = /^[A-Za-z_][A-Za-z0-9_$#]*$/;
const isStr = (v: unknown): v is string => typeof v === 'string';
const nonEmpty = (v: unknown) => isStr(v) && v.trim().length > 0;

export function validateSchemaDeep(schema: any, schemaPath = 'schema'): SchemaIssue[] {
  const out: SchemaIssue[] = [];
  const add = (severity: SchemaIssue['severity'], path: string, location: string, property: string, reason: string) => out.push({ severity, path, location, property, reason });
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) { add('error', schemaPath, '(schema)', '', 'Schema must be an object.'); return out; }
  if (!nonEmpty(schema.name)) add('error', schemaPath, '(schema)', 'name', 'Schema name is missing.');
  if (!Array.isArray(schema.tables)) { add('error', schemaPath, '(schema)', 'tables', '"tables" must be an array.'); return out; }
  if (schema.relationships !== undefined && !Array.isArray(schema.relationships)) add('error', schemaPath, '(schema)', 'relationships', '"relationships" must be an array.');

  const tableCols = new Map<string, Set<string>>();
  const seenTables = new Set<string>();
  schema.tables.forEach((t: any, ti: number) => {
    const tp = `${schemaPath} › tables[${ti}]${t && isStr(t.name) ? ` (${t.name})` : ''}`;
    if (!t || typeof t !== 'object') { add('error', tp, `tables[${ti}]`, '', 'Table must be an object.'); return; }
    if (!nonEmpty(t.name) || !IDENT.test(t.name)) { add('error', tp, `tables[${ti}]`, 'name', `Table name ${JSON.stringify(t.name)} is not a valid identifier.`); return; }
    const tu = t.name.toUpperCase();
    if (seenTables.has(tu)) add('error', tp, t.name, 'name', `Duplicate table "${t.name}".`);
    seenTables.add(tu);
    if (t.module !== undefined && !isStr(t.module)) add('error', tp, t.name, 'module', 'Module must be a string.');
    if (t.description !== undefined && !isStr(t.description)) add('error', tp, t.name, 'description', 'Description must be a string.');
    if (!Array.isArray(t.columns)) { add('error', tp, t.name, 'columns', '"columns" must be an array.'); return; }
    const cols = new Set<string>(); tableCols.set(tu, cols);
    t.columns.forEach((c: any, ci: number) => {
      const cp = `${tp} › columns[${ci}]${c && isStr(c.name) ? ` (${c.name})` : ''}`;
      const loc = `${t.name}.${c && isStr(c.name) ? c.name : `columns[${ci}]`}`;
      if (!c || typeof c !== 'object') { add('error', cp, loc, '', 'Column must be an object.'); return; }
      if (!nonEmpty(c.name) || !IDENT.test(c.name)) { add('error', cp, loc, 'name', `Column name ${JSON.stringify(c.name)} is not a valid identifier.`); return; }
      const cu = c.name.toUpperCase();
      if (cols.has(cu)) add('error', cp, loc, 'name', `Duplicate column "${c.name}" in table "${t.name}".`);
      cols.add(cu);
      if (!nonEmpty(c.type)) add('error', cp, loc, 'type', 'Data type is missing.');
      else if (/^not specified$/i.test(c.type.trim())) add('warning', cp, loc, 'type', 'Data type is "Not specified" in the source document.');
      if (typeof c.nullable !== 'boolean') add('error', cp, loc, 'nullable', '"nullable" must be true or false.');
      if (c.label !== undefined && !isStr(c.label)) add('error', cp, loc, 'label', 'Label must be a string.');
      if (c.isPrimaryKey !== undefined && typeof c.isPrimaryKey !== 'boolean') add('error', cp, loc, 'isPrimaryKey', 'Must be true or false.');
      if (c.isForeignKey !== undefined && typeof c.isForeignKey !== 'boolean') add('error', cp, loc, 'isForeignKey', 'Must be true or false.');
      if (c.references !== undefined && c.references !== null) {
        if (typeof c.references !== 'object' || !nonEmpty(c.references.table) || !nonEmpty(c.references.column)) add('error', cp, loc, 'references', 'Foreign key reference needs "table" and "column".');
      }
      if (c.decode !== undefined && c.decode !== null) {
        if (!Array.isArray(c.decode)) { add('error', cp, loc, 'decode', '"decode" must be an array.'); return; }
        const seen = new Set<string>();
        c.decode.forEach((d: any, di: number) => {
          const dp = `${cp} › decode[${di}]`;
          if (!d || typeof d !== 'object') { add('error', dp, loc, `decode[${di}]`, 'Decode entry must be an object.'); return; }
          if (!nonEmpty(d.rawValue)) { add('error', dp, loc, `decode[${di}].rawValue`, `Column "${loc}" has a decode entry (#${di + 1}) with an empty raw value.`); return; }
          if (d.label !== undefined && !isStr(d.label)) add('error', dp, loc, `decode[${di}].label`, 'Decode label must be a string.');
          const k = d.rawValue.trim().toUpperCase();
          if (seen.has(k)) add('error', dp, loc, `decode[${di}].rawValue`, `Duplicate decode raw value "${d.rawValue}".`);
          seen.add(k);
        });
      }
    });
  });

  (Array.isArray(schema.relationships) ? schema.relationships : []).forEach((r: any, ri: number) => {
    const rp = `${schemaPath} › relationships[${ri}]`;
    if (!r || typeof r !== 'object') { add('error', rp, `relationships[${ri}]`, '', 'Relationship must be an object.'); return; }
    for (const k of ['fromTable', 'fromColumn', 'toTable', 'toColumn']) if (!nonEmpty(r[k])) add('error', rp, `relationships[${ri}]`, k, `"${k}" is missing.`);
    const ft = tableCols.get(String(r.fromTable || '').toUpperCase()); const tt = tableCols.get(String(r.toTable || '').toUpperCase());
    if (r.fromTable && !ft) add('error', rp, `${r.fromTable}.${r.fromColumn}`, 'fromTable', `Table "${r.fromTable}" does not exist.`);
    else if (ft && r.fromColumn && !ft.has(String(r.fromColumn).toUpperCase())) add('error', rp, `${r.fromTable}.${r.fromColumn}`, 'fromColumn', `Column "${r.fromTable}.${r.fromColumn}" does not exist.`);
    if (r.toTable && !tt) add('error', rp, `${r.toTable}.${r.toColumn}`, 'toTable', `Table "${r.toTable}" does not exist.`);
    else if (tt && r.toColumn && !tt.has(String(r.toColumn).toUpperCase())) add('error', rp, `${r.toTable}.${r.toColumn}`, 'toColumn', `Column "${r.toTable}.${r.toColumn}" does not exist.`);
  });
  return out;
}

export const errorsOnly = (issues: SchemaIssue[]) => issues.filter((i) => i.severity === 'error');
