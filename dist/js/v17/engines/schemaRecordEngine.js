import { validateSchemaModel } from '../sync/schemaFormat.js';
import { makeError } from '../errors/appErrors.js';
const IDENT = /^[A-Za-z_][A-Za-z0-9_$#]{0,127}$/;
const TYPE_RE = /^[A-Za-z][A-Za-z0-9_ ]{0,40}(\(\s*(\d+|\*)\s*(,\s*\d+\s*)?(\s+(BYTE|CHAR))?\))?(\s+WITH( LOCAL)? TIME ZONE)?$/i;
function clone(v) { return JSON.parse(JSON.stringify(v)); }
const U = (s) => String(s ?? '').trim().toUpperCase();
export function parseRowId(rowId) { const i = rowId.indexOf('::'); if (i <= 0)
    return null; return { table: rowId.slice(0, i), column: rowId.slice(i + 2) }; }
export function parseDecodeText(text) {
    const problems = [];
    const seen = new Set();
    const entries = (text || '').split(/[\n;]+/).map((l) => l.trim()).filter(Boolean).map((line) => { const i = line.indexOf('='); return i === -1 ? { rawValue: line, label: line } : { rawValue: line.slice(0, i).trim(), label: line.slice(i + 1).trim() }; });
    entries.forEach((e) => { if (!e.rawValue)
        problems.push(`Decode line "${e.rawValue}=${e.label}" has an empty raw value.`); if (seen.has(e.rawValue))
        problems.push(`Decode raw value "${e.rawValue}" is listed more than once.`); seen.add(e.rawValue); if (!e.label)
        problems.push(`Decode raw value "${e.rawValue}" has an empty label.`); });
    return { entries, problems };
}
const FIELD_LABELS = [
    ['module', 'Module', 'table'], ['tableName', 'Table Name', 'row'], ['tableDescription', 'Table Description', 'table'], ['columnName', 'Column Name', 'row'], ['columnDescription', 'Column Description', 'row'],
    ['dataType', 'Data Type', 'row'], ['length', 'Length', 'row'], ['precision', 'Precision', 'row'], ['nullable', 'Nullable', 'row'], ['alias', 'Alias', 'row'], ['decodeText', 'Decode', 'row'],
    ['isPrimaryKey', 'Primary Key', 'row'], ['isForeignKey', 'Foreign Key', 'row'], ['fkTable', 'References Table', 'row'], ['fkColumn', 'References Column', 'row']
];
const show = (v) => (v === null || v === undefined || v === '' ? '(empty)' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v).replace(/\n/g, '; '));
export function diffRows(original, edited) {
    return FIELD_LABELS.filter(([k]) => show(original[k]) !== show(edited[k]) && !(k === 'module' && !String(edited.module || '').trim())).map(([k, label, scope]) => ({ field: String(k), label, from: show(original[k]), to: show(edited[k]), scope }));
}
export function validateRecordFields(row, schema, original = null) {
    const p = [];
    const t = (row.tableName || '').trim();
    const c = (row.columnName || '').trim();
    const dt = String(row.dataType || '').trim();
    const tChanged = !original || U(original.tableName) !== U(t);
    const cChanged = !original || U(original.columnName) !== U(c);
    const dtChanged = !original || U(String(original.dataType)) !== U(dt);
    if (!t)
        p.push('Table Name is required.');
    else if (tChanged && !IDENT.test(t) && !schema.tables.some((x) => U(x.name) === U(t)))
        p.push(`Table Name "${t}" is not a valid identifier (letters, digits, _, $, # — must start with a letter or underscore, no spaces).`);
    if (!c)
        p.push('Column Name is required.');
    else if (cChanged && !IDENT.test(c))
        p.push(`Column Name "${c}" is not a valid identifier (letters, digits, _, $, # — must start with a letter or underscore, no spaces).`);
    if (!dt)
        p.push('Data Type is required.');
    else if (dtChanged && !TYPE_RE.test(dt))
        p.push(`Data Type "${dt}" is not a recognisable SQL data type (e.g. VARCHAR2, NUMBER(10,2), DATE, TIMESTAMP(6)).`);
    if (row.length !== null && row.length !== undefined && (!Number.isInteger(row.length) || row.length < 0))
        p.push('Length must be a whole number of 0 or more.');
    if (row.precision !== null && row.precision !== undefined && (!Number.isInteger(row.precision) || row.precision < 0))
        p.push('Precision must be a whole number of 0 or more.');
    if (row.isForeignKey) {
        if (!row.fkTable?.trim() || !row.fkColumn?.trim())
            p.push('Foreign Key requires both a References Table and a References Column.');
        else {
            const rt = schema.tables.find((x) => U(x.name) === U(row.fkTable));
            const sameTable = U(row.fkTable) === U(t);
            if (!rt && !sameTable)
                p.push(`References Table "${row.fkTable}" does not exist in this schema.`);
            else if (rt && !rt.columns.some((x) => U(x.name) === U(row.fkColumn)) && !(sameTable && U(row.fkColumn) === U(c)))
                p.push(`References Column "${row.fkTable}.${row.fkColumn}" does not exist in this schema.`);
        }
    }
    p.push(...parseDecodeText(row.decodeText).problems);
    return p;
}
export function analyzeDependencies(schema, table, column) {
    const deps = [];
    schema.relationships.forEach((r) => { if ((U(r.fromTable) === U(table) && U(r.fromColumn) === U(column)) || (U(r.toTable) === U(table) && U(r.toColumn) === U(column)))
        deps.push({ kind: 'relationship', relationshipId: r.id, description: `Relationship ${r.fromTable}.${r.fromColumn} → ${r.toTable}.${r.toColumn}` }); });
    schema.tables.forEach((t) => t.columns.forEach((c) => { if (c.isForeignKey && c.references && U(c.references.table) === U(table) && U(c.references.column) === U(column) && !(U(t.name) === U(table) && U(c.name) === U(column)))
        deps.push({ kind: 'foreign-key', table: t.name, column: c.name, description: `Foreign key ${t.name}.${c.name} references ${table}.${column}` }); }));
    return deps;
}
function buildColumn(row, decode, previous) {
    const name = row.columnName.trim();
    const col = { ...(previous || {}), name, label: previous && U(previous.name) === U(name) && previous.label ? previous.label : name, description: row.columnDescription ?? '', type: String(row.dataType).trim(), nullable: !!row.nullable, isPrimaryKey: !!row.isPrimaryKey, isForeignKey: !!row.isForeignKey };
    if (row.length !== null && row.length !== undefined)
        col.length = row.length;
    else
        delete col.length;
    if (row.precision !== null && row.precision !== undefined)
        col.precision = row.precision;
    else
        delete col.precision;
    if (row.alias?.trim())
        col.alias = row.alias.trim();
    else
        delete col.alias;
    if (row.isForeignKey && row.fkTable && row.fkColumn) {
        col.references = { table: row.fkTable.trim(), column: row.fkColumn.trim() };
        delete col.unresolvedReference;
    }
    else
        delete col.references;
    if (decode.length)
        col.decode = decode;
    else
        delete col.decode;
    // V17.2.1: a legacy label without a code is resolved once the user supplies "CODE=Label" for it.
    if (col.unmappedDecodeLabels?.length) {
        const have = new Set(decode.map((d) => d.label.trim().toUpperCase()));
        col.unmappedDecodeLabels = col.unmappedDecodeLabels.filter((l) => !have.has(l.trim().toUpperCase()));
        if (!col.unmappedDecodeLabels.length)
            delete col.unmappedDecodeLabels;
    }
    return col;
}
const issueKey = (i) => `${i.code}|${i.message}`;
function introducedErrors(before, after) {
    const prev = new Set(validateSchemaModel(before).errors.map(issueKey));
    const fresh = validateSchemaModel(after).errors.filter((e) => !prev.has(issueKey(e)));
    return fresh.length ? [makeError('INVALID_SCHEMA_RECORD', 'The change would leave the schema in an invalid state and was not saved.', fresh.map((e) => e.message))] : [];
}
export function upsertSchemaRecord(schema, row, originalRowId, originalRow = null) {
    const orig = originalRowId ? parseRowId(originalRowId) : null;
    if (originalRowId && !orig)
        return { ok: false, changes: [], errors: [makeError('INVALID_SCHEMA_RECORD', `Row id "${originalRowId}" is malformed.`)] };
    let original = originalRow;
    if (!original && orig) {
        const t = schema.tables.find((x) => x.name === orig.table);
        const c = t?.columns.find((x) => x.name === orig.column);
        if (t && c)
            original = { rowId: originalRowId, module: t.module, tableName: t.name, tableDescription: t.description, columnName: c.name, columnDescription: c.description, dataType: c.type, length: c.length ?? null, precision: c.precision ?? null, nullable: c.nullable, alias: c.alias ?? '', decodeText: '', isPrimaryKey: !!c.isPrimaryKey, isForeignKey: !!c.isForeignKey, fkTable: c.references?.table ?? '', fkColumn: c.references?.column ?? '' };
    }
    const fieldProblems = validateRecordFields(row, schema, original);
    if (fieldProblems.length)
        return { ok: false, changes: [], errors: [makeError('INVALID_SCHEMA_RECORD', 'The schema record is not valid and was not saved.', fieldProblems)] };
    const next = clone(schema);
    const changes = [];
    const decode = parseDecodeText(row.decodeText).entries;
    const newTable = row.tableName.trim();
    const newCol = row.columnName.trim();
    if (orig) {
        const ot = next.tables.find((t) => t.name === orig.table);
        const oc = ot?.columns.find((c) => c.name === orig.column);
        if (!ot)
            return { ok: false, changes, errors: [makeError('TABLE_NOT_FOUND', `Table "${orig.table}" no longer exists in schema "${schema.name}" — reload the editor (it may have been changed on another device).`)] };
        if (!oc)
            return { ok: false, changes, errors: [makeError('COLUMN_NOT_FOUND', `Column "${orig.table}.${orig.column}" no longer exists in schema "${schema.name}" — reload the editor (it may have been changed on another device).`)] };
        const movedTable = U(ot.name) !== U(newTable);
        const renamed = U(oc.name) !== U(newCol);
        const deps = analyzeDependencies(schema, orig.table, orig.column);
        if (movedTable && deps.length)
            return { ok: false, changes, errors: [makeError('SCHEMA_DEPENDENCY_BLOCKED', `"${orig.table}.${orig.column}" cannot be moved to table "${newTable}" because other records depend on it. Remove or re-point these first:`, deps.map((d) => d.description))] };
        if (!movedTable && renamed && ot.columns.some((c) => c !== oc && U(c.name) === U(newCol)))
            return { ok: false, changes, errors: [makeError('INVALID_SCHEMA_RECORD', `Column "${ot.name}.${newCol}" already exists.`)] };
        if (!movedTable) {
            const idx = ot.columns.indexOf(oc);
            ot.columns[idx] = buildColumn(row, decode, oc);
            if (row.module?.trim() && row.module.trim() !== ot.module) {
                changes.push(`Table ${ot.name} module changed to "${row.module.trim()}".`);
                ot.module = row.module.trim();
            }
            if (row.tableDescription !== undefined && (row.tableDescription ?? '') !== (ot.description ?? '')) {
                ot.description = row.tableDescription;
                changes.push(`Table ${ot.name} description updated.`);
            }
            changes.push(`Updated ${ot.name}.${newCol}.`);
            if (renamed) {
                next.relationships.forEach((r) => { if (r.fromTable === ot.name && r.fromColumn === oc.name) {
                    r.fromColumn = newCol;
                    changes.push(`Relationship ${r.id} now uses ${ot.name}.${newCol}.`);
                } if (r.toTable === ot.name && r.toColumn === oc.name) {
                    r.toColumn = newCol;
                    changes.push(`Relationship ${r.id} now points to ${ot.name}.${newCol}.`);
                } });
                next.tables.forEach((t) => t.columns.forEach((c) => { if (c.isForeignKey && c.references && c.references.table === ot.name && c.references.column === oc.name && !(t === ot && c === ot.columns[idx])) {
                    c.references = { table: ot.name, column: newCol };
                    changes.push(`Foreign key ${t.name}.${c.name} now references ${ot.name}.${newCol}.`);
                } }));
            }
        }
        else {
            ot.columns = ot.columns.filter((c) => c !== oc);
            let target = next.tables.find((t) => U(t.name) === U(newTable));
            if (target?.columns.some((c) => U(c.name) === U(newCol)))
                return { ok: false, changes: [], errors: [makeError('INVALID_SCHEMA_RECORD', `Column "${target.name}.${newCol}" already exists.`)] };
            if (!target) {
                target = { name: newTable, module: row.module?.trim() || ot.module || 'General', description: row.tableDescription || '', columns: [] };
                next.tables.push(target);
                changes.push(`Created table ${newTable}.`);
            }
            target.columns.push(buildColumn(row, decode, oc));
            changes.push(`Moved ${orig.table}.${orig.column} to ${target.name}.${newCol}.`);
            if (ot.columns.length === 0 && !next.relationships.some((r) => r.fromTable === ot.name || r.toTable === ot.name) && !next.tables.some((t) => t.columns.some((c) => c.isForeignKey && c.references?.table === ot.name))) {
                next.tables = next.tables.filter((t) => t !== ot);
                changes.push(`Removed now-empty table ${ot.name}.`);
            }
        }
    }
    else {
        let target = next.tables.find((t) => U(t.name) === U(newTable));
        if (target?.columns.some((c) => U(c.name) === U(newCol)))
            return { ok: false, changes, errors: [makeError('INVALID_SCHEMA_RECORD', `Column "${target.name}.${newCol}" already exists in this schema.`)] };
        if (!target) {
            target = { name: newTable, module: row.module?.trim() || 'General', description: row.tableDescription || '', columns: [] };
            next.tables.push(target);
            changes.push(`Created table ${newTable}.`);
        }
        target.columns.push(buildColumn(row, decode));
        changes.push(`Added ${target.name}.${newCol}.`);
    }
    const errors = introducedErrors(schema, next);
    if (errors.length)
        return { ok: false, changes: [], errors };
    return { ok: true, schema: next, changes, errors: [] };
}
export function deleteSchemaRecord(schema, rowId, opts = {}) {
    const id = parseRowId(rowId);
    if (!id)
        return { ok: false, changes: [], errors: [makeError('INVALID_SCHEMA_RECORD', `Row id "${rowId}" is malformed.`)], dependencies: [] };
    const next = clone(schema);
    const t = next.tables.find((x) => x.name === id.table);
    if (!t)
        return { ok: false, changes: [], errors: [makeError('TABLE_NOT_FOUND', `Table "${id.table}" was not found in schema "${schema.name}" — it may already have been removed.`)], dependencies: [] };
    if (!t.columns.some((c) => c.name === id.column))
        return { ok: false, changes: [], errors: [makeError('COLUMN_NOT_FOUND', `Column "${id.table}.${id.column}" was not found in schema "${schema.name}" — it may already have been removed.`)], dependencies: [] };
    const deps = analyzeDependencies(schema, id.table, id.column);
    const lastColumn = t.columns.length === 1;
    const tableRels = lastColumn ? schema.relationships.filter((r) => (r.fromTable === t.name || r.toTable === t.name) && !deps.some((d) => d.relationshipId === r.id)) : [];
    const tableFkRefs = lastColumn ? schema.tables.flatMap((x) => x.columns.filter((c) => c.isForeignKey && c.references?.table === t.name && !deps.some((d) => d.table === x.name && d.column === c.name)).map((c) => ({ kind: 'foreign-key', table: x.name, column: c.name, description: `Foreign key ${x.name}.${c.name} references table ${t.name}` }))) : [];
    const allDeps = [...deps, ...tableRels.map((r) => ({ kind: 'relationship', relationshipId: r.id, description: `Relationship ${r.fromTable}.${r.fromColumn} → ${r.toTable}.${r.toColumn} (table ${t.name} would be removed)` })), ...tableFkRefs];
    if (allDeps.length && !opts.cascade)
        return { ok: false, changes: [], dependencies: allDeps, errors: [makeError('SCHEMA_DEPENDENCY_BLOCKED', `"${id.table}.${id.column}" cannot be deleted on its own because other schema records depend on it. Confirm the dependent records listed below should also be removed/unlinked, or update them first.`, allDeps.map((d) => d.description))] };
    const changes = [];
    t.columns = t.columns.filter((c) => c.name !== id.column);
    changes.push(`Deleted ${id.table}.${id.column}.`);
    if (allDeps.length) {
        const relIds = new Set(allDeps.filter((d) => d.relationshipId).map((d) => d.relationshipId));
        next.relationships = next.relationships.filter((r) => { if (relIds.has(r.id)) {
            changes.push(`Removed relationship ${r.fromTable}.${r.fromColumn} → ${r.toTable}.${r.toColumn}.`);
            return false;
        } return true; });
        allDeps.filter((d) => d.kind === 'foreign-key').forEach((d) => { const c = next.tables.find((x) => x.name === d.table)?.columns.find((x) => x.name === d.column); if (c) {
            c.isForeignKey = false;
            delete c.references;
            changes.push(`Unlinked foreign key ${d.table}.${d.column} (column kept).`);
        } });
    }
    if (t.columns.length === 0) {
        next.tables = next.tables.filter((x) => x !== t);
        changes.push(`Removed now-empty table ${t.name}.`);
    }
    const errors = introducedErrors(schema, next);
    if (errors.length)
        return { ok: false, changes: [], errors, dependencies: allDeps };
    const isDangling = (sc, r) => !sc.tables.some((x) => x.name === r.fromTable && x.columns.some((c) => c.name === r.fromColumn)) || !sc.tables.some((x) => x.name === r.toTable && x.columns.some((c) => c.name === r.toColumn));
    const preExisting = new Set(schema.relationships.filter((r) => isDangling(schema, r)).map((r) => r.id));
    const dangling = next.relationships.filter((r) => isDangling(next, r) && !preExisting.has(r.id));
    if (dangling.length)
        return { ok: false, changes: [], dependencies: allDeps, errors: [makeError('SCHEMA_UPDATE_FAILED', 'The delete would leave relationships pointing at columns that no longer exist, so it was not applied.', dangling.map((r) => `${r.fromTable}.${r.fromColumn} → ${r.toTable}.${r.toColumn}`))] };
    return { ok: true, schema: next, changes, errors: [], dependencies: allDeps };
}
export function dataTypeOptionValues(current, standard) { const cur = String(current || '').trim(); return cur && !standard.some((s) => U(s) === U(cur)) ? [cur, ...standard] : [...standard]; }
//# sourceMappingURL=schemaRecordEngine.js.map