export const APP_VERSION = '17.2.1';
export const APP_NAME = 'SQL Assistant';
/** Registry file format. 2 = V17.1+ (stamped). Files without a stamp are "legacy" (V17.0 or older). */
export const SCHEMA_FORMAT_VERSION = 2;
export const WRITER_LABEL = `${APP_NAME} ${APP_VERSION}`;
export const LEGACY_FORMAT_LABEL = 'SQL Assistant V17.0 or older (no writer stamp)';
export function describeIssue(i) {
    const where = i.table ? ` [${i.table}${i.column ? `.${i.column}` : ''}]` : '';
    return `${i.message}${where} (at ${i.path})`;
}
// ───────────────────────────── helpers ─────────────────────────────
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
const trimStr = (v) => str(v).trim();
function firstPresent(o, keys) { for (const k of keys)
    if (k in o && o[k] !== undefined && o[k] !== null)
        return o[k]; return undefined; }
/** First alias whose value is a non-empty string/number — the L1 fix. */
function firstNonEmpty(o, keys) {
    for (const k of keys) {
        const v = trimStr(o[k]);
        if (v)
            return { key: k, value: v };
    }
    return { key: null, value: '' };
}
function bool(v, fallback = false) { if (typeof v === 'boolean')
    return v; if (v === 1 || v === '1' || v === 'true' || v === 'Y' || v === 'y' || v === 'yes')
    return true; if (v === 0 || v === '0' || v === 'false' || v === 'N' || v === 'n' || v === 'no')
    return false; return fallback; }
function num(v) { if (typeof v === 'number' && Number.isFinite(v))
    return v; if (typeof v === 'string' && /^\d+$/.test(v.trim()))
    return parseInt(v, 10); return undefined; }
const U = (s) => s.trim().toUpperCase();
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'schema'; }
export function detectWriter(reg) {
    const o = isObj(reg) ? reg : {};
    const writtenBy = trimStr(o.writtenBy) || null;
    const fv = typeof o.formatVersion === 'number' ? o.formatVersion : null;
    const stamped = !!writtenBy || fv !== null;
    return { stamped, formatVersion: fv, writtenBy, legacy: !stamped, label: stamped ? (writtenBy || `format ${fv}`) : LEGACY_FORMAT_LABEL };
}
function normalizeDecode(raw, path, table, column, c) {
    const unmapped = [];
    if (raw === undefined || raw === null)
        return { unmapped };
    let list;
    if (Array.isArray(raw))
        list = raw;
    else if (isObj(raw)) {
        list = Object.entries(raw).map(([k, v]) => ({ rawValue: k, label: str(v) }));
        c.notes.push({ rule: 'L1', path, message: `${table}.${column}: decode map object converted to a decode list.` });
    }
    else {
        c.issues.push({ severity: 'error', code: 'DECODE_NOT_ARRAY', message: `Invalid column definition: Column "${table}.${column}" has a decode value that is not a list (found ${typeof raw}).`, path, table, column, property: 'decode' });
        return { unmapped };
    }
    const out = [];
    const seenPair = new Set();
    list.forEach((e, i) => {
        const p = `${path}[${i}]`;
        if (!isObj(e)) {
            c.issues.push({ severity: 'error', code: 'DECODE_ENTRY_INVALID', message: `Invalid column definition: Column "${table}.${column}" has a decode entry (#${i + 1}) that is not an object.`, path: p, table, column, property: 'decode' });
            return;
        }
        const rawPick = firstNonEmpty(e, ['rawValue', 'raw', 'value', 'code', 'key', 'id']);
        const label = trimStr(firstPresent(e, ['label', 'description', 'name', 'text', 'meaning']));
        if (rawPick.key && rawPick.key !== 'rawValue')
            c.notes.push({ rule: 'L1', path: `${p}.${rawPick.key}`, message: `${table}.${column} decode #${i + 1}: raw value read from legacy "${rawPick.key}".` });
        if (!rawPick.value) {
            if (c.legacy && !label) {
                c.notes.push({ rule: 'L2', path: p, message: `${table}.${column} decode #${i + 1}: empty placeholder entry removed.` });
                return;
            }
            if (c.legacy && label) {
                unmapped.push(label);
                c.notes.push({ rule: 'L3', path: p, warning: true, message: `${table}.${column} decode #${i + 1}: label "${label}" has no raw code (lost by an older version) — preserved as an unmapped label.` });
                return;
            }
            out.push({ rawValue: '', label }); // current-format file: kept so the strict validator reports it
            return;
        }
        const key = `${rawPick.value}\u0000${label}`;
        if (c.legacy && seenPair.has(key)) {
            c.notes.push({ rule: 'L4', path: p, message: `${table}.${column} decode #${i + 1}: exact duplicate removed.` });
            return;
        }
        seenPair.add(key);
        out.push({ rawValue: rawPick.value, label });
    });
    return { decode: out.length ? out : undefined, unmapped };
}
function normalizeColumn(raw, path, table, c) {
    if (!isObj(raw)) {
        c.issues.push({ severity: 'error', code: 'COLUMN_NOT_OBJECT', message: `Invalid column definition in table "${table}": entry is not an object.`, path, table });
        return null;
    }
    const name = trimStr(firstPresent(raw, ['name', 'columnName', 'column_name', 'COLUMN_NAME']));
    const fkObj = isObj(raw.foreign_key) ? raw.foreign_key : isObj(raw.foreignKey) ? raw.foreignKey : null;
    if (fkObj || 'primary_key' in raw || 'schema_name' in raw)
        c.notes.push({ rule: 'L5', path, message: `${table}.${name || '?'}: legacy key names mapped to the current format.` });
    const refsRaw = isObj(raw.references) ? raw.references : fkObj;
    const refTable = trimStr(refsRaw ? firstPresent(refsRaw, ['table', 'toTable', 'fkTable']) : firstPresent(raw, ['fkTable', 'refTable']));
    const refCol = trimStr(refsRaw ? firstPresent(refsRaw, ['column', 'toColumn', 'fkColumn']) : firstPresent(raw, ['fkColumn', 'refColumn']));
    const isFk = bool(firstPresent(raw, ['isForeignKey', 'fk', 'FK']), false) || (raw.foreignKey === true) || !!fkObj || (!!refTable && !!refCol && 'fkTable' in raw);
    const { decode, unmapped } = normalizeDecode(raw.decode ?? raw.decodes ?? raw.values, `${path}.decode`, table, name || '?', c);
    const col = {
        name,
        label: trimStr(raw.label) || name,
        type: trimStr(firstPresent(raw, ['type', 'dataType', 'data_type', 'DATA_TYPE'])),
        nullable: bool(raw.nullable, true),
        description: str(firstPresent(raw, ['description', 'comment', 'comments'])),
        isPrimaryKey: bool(firstPresent(raw, ['isPrimaryKey', 'primaryKey', 'primary_key', 'pk', 'PK']), false)
    };
    const len = num(raw.length);
    if (len !== undefined)
        col.length = len;
    const prec = num(raw.precision);
    if (prec !== undefined)
        col.precision = prec;
    const alias = trimStr(raw.alias);
    if (alias)
        col.alias = alias;
    if (isFk) {
        col.isForeignKey = true;
        if (refTable || refCol)
            col.references = { table: refTable, column: refCol };
    }
    if (decode)
        col.decode = decode;
    const prevUnmapped = Array.isArray(raw.unmappedDecodeLabels) ? raw.unmappedDecodeLabels.map(trimStr).filter(Boolean) : [];
    if (raw.unmappedDecodeLabels !== undefined && !Array.isArray(raw.unmappedDecodeLabels))
        c.issues.push({ severity: 'error', code: 'COLUMN_PROPERTY_INVALID', message: `Invalid column definition: Column "${table}.${name}" has "unmappedDecodeLabels" that is not a list.`, path: `${path}.unmappedDecodeLabels`, table, column: name, property: 'unmappedDecodeLabels' });
    const allUnmapped = Array.from(new Set([...prevUnmapped, ...unmapped]));
    if (allUnmapped.length)
        col.unmappedDecodeLabels = allUnmapped;
    if (isObj(raw.unresolvedReference))
        col.unresolvedReference = { table: trimStr(raw.unresolvedReference.table), column: trimStr(raw.unresolvedReference.column) };
    return col;
}
function normalizeTable(raw, path, c) {
    if (!isObj(raw)) {
        c.issues.push({ severity: 'error', code: 'TABLE_NOT_OBJECT', message: 'Invalid table definition: entry is not an object.', path });
        return null;
    }
    const name = trimStr(firstPresent(raw, ['name', 'tableName', 'table_name', 'TABLE_NAME']));
    const colsRaw = firstPresent(raw, ['columns', 'cols', 'fields']);
    const columns = [];
    if (colsRaw !== undefined && !Array.isArray(colsRaw))
        c.issues.push({ severity: 'error', code: 'COLUMNS_NOT_ARRAY', message: `Invalid table definition: "${name}" has columns that are not a list.`, path: `${path}.columns`, table: name, property: 'columns' });
    else
        (colsRaw || []).forEach((col, i) => { const n = normalizeColumn(col, `${path}.columns[${i}]`, name || '?', c); if (n)
            columns.push(n); });
    const t = { name, module: trimStr(raw.module) || 'General', description: str(firstPresent(raw, ['description', 'notes', 'comment'])), columns };
    const ot = trimStr(raw.objectType).toUpperCase();
    if (ot === 'VIEW' || ot === 'TABLE')
        t.objectType = ot;
    return t;
}
function normalizeRelationships(raw, path, c) {
    if (raw === undefined || raw === null)
        return [];
    if (!Array.isArray(raw)) {
        c.issues.push({ severity: 'error', code: 'RELATIONSHIPS_NOT_ARRAY', message: 'Invalid schema: "relationships" is not a list.', path, property: 'relationships' });
        return [];
    }
    const out = [];
    raw.forEach((r, i) => {
        if (!isObj(r)) {
            c.issues.push({ severity: 'error', code: 'REL_INVALID', message: `Invalid relationship #${i + 1}: not an object.`, path: `${path}[${i}]` });
            return;
        }
        const kind = trimStr(r.kind);
        out.push({ id: trimStr(r.id) || `rel-${i + 1}`, fromTable: trimStr(r.fromTable), fromColumn: trimStr(r.fromColumn), toTable: trimStr(r.toTable), toColumn: trimStr(r.toColumn), kind: (['one-to-many', 'many-to-one', 'one-to-one'].includes(kind) ? kind : 'many-to-one') });
    });
    return out;
}
/** L6 — legacy FK targets outside this schema become documentation-only references. */
function repairLegacyReferences(schema, basePath, c) {
    const tables = new Map(schema.tables.map((t) => [U(t.name), t]));
    schema.tables.forEach((t, ti) => t.columns.forEach((col, ci) => {
        if (!col.isForeignKey || !col.references?.table || !col.references.column)
            return;
        const target = tables.get(U(col.references.table));
        const ok = !!target && target.columns.some((x) => U(x.name) === U(col.references.column));
        if (ok)
            return;
        col.unresolvedReference = { ...col.references };
        delete col.isForeignKey;
        delete col.references;
        c.notes.push({ rule: 'L6', warning: true, path: `${basePath}.tables[${ti}].columns[${ci}].foreign_key`, message: `${t.name}.${col.name}: reference to ${col.unresolvedReference.table}.${col.unresolvedReference.column} is outside this schema — kept as documentation (not used for joins).` });
    }));
}
export function normalizeSchema(raw, opts = {}) {
    const o = typeof opts === 'number' ? { index: opts } : opts;
    const basePath = o.basePath ?? (o.index !== undefined ? `schemas[${o.index}]` : 'schema');
    const c = { legacy: !!o.legacy, issues: [], notes: [], basePath };
    if (!isObj(raw)) {
        c.issues.push({ severity: 'error', code: 'SCHEMA_NOT_OBJECT', message: 'Invalid schema: entry is not an object.', path: basePath });
        return { schema: null, issues: c.issues, notes: c.notes };
    }
    const name = trimStr(firstPresent(raw, ['name', 'schemaName', 'schema_name', 'title']));
    if ('schema_name' in raw && !('name' in raw))
        c.notes.push({ rule: 'L5', path: `${basePath}.schema_name`, message: 'Legacy "schema_name" mapped to "name".' });
    const tablesRaw = firstPresent(raw, ['tables']);
    const tables = [];
    if (tablesRaw !== undefined && !Array.isArray(tablesRaw))
        c.issues.push({ severity: 'error', code: 'TABLES_NOT_ARRAY', message: 'Invalid schema: "tables" is not a list.', path: `${basePath}.tables`, property: 'tables' });
    else
        (tablesRaw || []).forEach((t, i) => { const n = normalizeTable(t, `${basePath}.tables[${i}]`, c); if (n)
            tables.push(n); });
    const status = trimStr(raw.status);
    const schema = {
        ...raw,
        id: trimStr(raw.id) || `schema-${slug(name)}`,
        name,
        version: trimStr(firstPresent(raw, ['version', 'schema_version'])) || '1.0',
        status: (['active', 'default', 'inactive'].includes(status) ? status : 'inactive'),
        updatedAt: trimStr(firstPresent(raw, ['updatedAt', 'last_updated'])) || new Date(0).toISOString(),
        lastSyncedAt: trimStr(raw.lastSyncedAt) || null,
        tables,
        relationships: normalizeRelationships(raw.relationships, `${basePath}.relationships`, c)
    };
    // drop legacy-only top-level keys that the current model does not use (they stay in the source file)
    ['schema_name', 'schema_version', 'last_updated', 'tables_count'].forEach((k) => { delete schema[k]; });
    if (c.legacy)
        repairLegacyReferences(schema, basePath, c);
    return { schema, issues: c.issues, notes: c.notes };
}
export function validateSchemaModel(schema, basePath = 'schema') {
    const errors = [];
    const warnings = [];
    const E = (i) => errors.push({ severity: 'error', ...i });
    const W = (i) => warnings.push({ severity: 'warning', ...i });
    if (schema.name !== undefined && !trimStr(schema.name))
        E({ code: 'SCHEMA_NAME_EMPTY', message: 'Invalid schema: name is empty.', path: `${basePath}.name`, property: 'name' });
    if (!Array.isArray(schema.tables)) {
        E({ code: 'TABLES_NOT_ARRAY', message: 'Invalid schema: "tables" is not a list.', path: `${basePath}.tables` });
        return { valid: false, errors, warnings };
    }
    if (!schema.tables.length)
        E({ code: 'SCHEMA_NO_TABLES', message: 'Invalid schema: it contains no tables.', path: `${basePath}.tables` });
    const tableNames = new Map();
    schema.tables.forEach((t, ti) => {
        const tp = `${basePath}.tables[${ti}]`;
        if (!isObj(t)) {
            E({ code: 'TABLE_NOT_OBJECT', message: 'Invalid table definition: entry is not an object.', path: tp });
            return;
        }
        const tn = trimStr(t.name);
        if (!tn)
            E({ code: 'TABLE_NAME_EMPTY', message: `Invalid table definition: table #${ti + 1} has an empty name.`, path: `${tp}.name`, property: 'name' });
        else if (tableNames.has(U(tn)))
            E({ code: 'TABLE_DUPLICATE', message: `Invalid table definition: table "${tn}" is defined more than once.`, path: `${tp}.name`, table: tn, property: 'name' });
        else
            tableNames.set(U(tn), ti);
        if (!Array.isArray(t.columns)) {
            E({ code: 'COLUMNS_NOT_ARRAY', message: `Invalid table definition: "${tn}" has columns that are not a list.`, path: `${tp}.columns`, table: tn });
            return;
        }
        if (!t.columns.length)
            E({ code: 'TABLE_NO_COLUMNS', message: `Invalid table definition: table "${tn}" has no columns.`, path: `${tp}.columns`, table: tn });
        const colNames = new Set();
        let hasPk = false;
        t.columns.forEach((col, ci) => {
            const cp = `${tp}.columns[${ci}]`;
            if (!isObj(col)) {
                E({ code: 'COLUMN_NOT_OBJECT', message: `Invalid column definition in table "${tn}": entry is not an object.`, path: cp, table: tn });
                return;
            }
            const cn = trimStr(col.name);
            if (!cn)
                E({ code: 'COLUMN_NAME_EMPTY', message: `Invalid column definition: table "${tn}" has a column (#${ci + 1}) with an empty name.`, path: `${cp}.name`, table: tn, property: 'name' });
            else if (colNames.has(U(cn)))
                E({ code: 'COLUMN_DUPLICATE', message: `Invalid column definition: Column "${tn}.${cn}" is defined more than once.`, path: `${cp}.name`, table: tn, column: cn, property: 'name' });
            else
                colNames.add(U(cn));
            if (!trimStr(col.type))
                E({ code: 'COLUMN_TYPE_EMPTY', message: `Invalid column definition: Column "${tn}.${cn}" has no data type.`, path: `${cp}.type`, table: tn, column: cn, property: 'type' });
            if (typeof col.nullable !== 'boolean')
                E({ code: 'COLUMN_PROPERTY_INVALID', message: `Invalid column definition: Column "${tn}.${cn}" has a non-boolean "nullable".`, path: `${cp}.nullable`, table: tn, column: cn, property: 'nullable' });
            ['length', 'precision'].forEach((k) => { const v = col[k]; if (v !== undefined && v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0))
                E({ code: 'COLUMN_PROPERTY_INVALID', message: `Invalid column definition: Column "${tn}.${cn}" has an invalid "${k}".`, path: `${cp}.${k}`, table: tn, column: cn, property: k }); });
            if (col.isPrimaryKey)
                hasPk = true;
            if (col.decode !== undefined) {
                if (!Array.isArray(col.decode))
                    E({ code: 'DECODE_NOT_ARRAY', message: `Invalid column definition: Column "${tn}.${cn}" has a decode value that is not a list.`, path: `${cp}.decode`, table: tn, column: cn, property: 'decode' });
                else {
                    const seen = new Map();
                    col.decode.forEach((d, di) => {
                        const dp = `${cp}.decode[${di}]`;
                        if (!isObj(d)) {
                            E({ code: 'DECODE_ENTRY_INVALID', message: `Invalid column definition: Column "${tn}.${cn}" has a decode entry (#${di + 1}) that is not an object.`, path: dp, table: tn, column: cn, property: 'decode' });
                            return;
                        }
                        const rv = trimStr(d.rawValue);
                        if (!rv) {
                            E({ code: 'DECODE_RAW_EMPTY', message: `Invalid column definition: Column "${tn}.${cn}" has a decode entry (#${di + 1}) with an empty raw value.`, path: `${dp}.rawValue`, table: tn, column: cn, property: 'rawValue' });
                            return;
                        }
                        if (!trimStr(d.label))
                            W({ code: 'DECODE_LABEL_EMPTY', message: `Column "${tn}.${cn}" decode "${rv}" has an empty label.`, path: `${dp}.label`, table: tn, column: cn, property: 'label' });
                        if (seen.has(rv) && seen.get(rv) !== trimStr(d.label))
                            E({ code: 'DECODE_DUPLICATE', message: `Invalid column definition: Column "${tn}.${cn}" maps raw value "${rv}" to two different labels.`, path: `${dp}.rawValue`, table: tn, column: cn, property: 'rawValue' });
                        else if (seen.has(rv))
                            W({ code: 'DECODE_DUPLICATE', message: `Column "${tn}.${cn}" lists decode "${rv}" twice.`, path: `${dp}.rawValue`, table: tn, column: cn, property: 'rawValue' });
                        seen.set(rv, trimStr(d.label));
                    });
                }
            }
            if (col.unmappedDecodeLabels !== undefined) {
                if (!Array.isArray(col.unmappedDecodeLabels) || col.unmappedDecodeLabels.some((l) => typeof l !== 'string'))
                    E({ code: 'COLUMN_PROPERTY_INVALID', message: `Invalid column definition: Column "${tn}.${cn}" has invalid "unmappedDecodeLabels".`, path: `${cp}.unmappedDecodeLabels`, table: tn, column: cn, property: 'unmappedDecodeLabels' });
                else if (col.unmappedDecodeLabels.length)
                    W({ code: 'LEGACY_UNMAPPED_DECODE', message: `Column "${tn}.${cn}" has ${col.unmappedDecodeLabels.length} legacy decode label(s) without a raw code (not used in SQL until restored).`, path: `${cp}.unmappedDecodeLabels`, table: tn, column: cn, property: 'unmappedDecodeLabels' });
            }
            if (col.unresolvedReference !== undefined && (!isObj(col.unresolvedReference) || !trimStr(col.unresolvedReference.table)))
                E({ code: 'COLUMN_PROPERTY_INVALID', message: `Invalid column definition: Column "${tn}.${cn}" has an invalid "unresolvedReference".`, path: `${cp}.unresolvedReference`, table: tn, column: cn, property: 'unresolvedReference' });
        });
        if (t.columns.length && !hasPk)
            W({ code: 'PK_MISSING', message: `Table "${tn}" has no primary key.`, path: `${tp}.columns`, table: tn });
    });
    // foreign keys (need all tables)
    const findTable = (n) => schema.tables.find((x) => isObj(x) && U(trimStr(x.name)) === U(n));
    schema.tables.forEach((t, ti) => {
        if (!isObj(t) || !Array.isArray(t.columns))
            return;
        t.columns.forEach((col, ci) => {
            if (!isObj(col) || !col.isForeignKey)
                return;
            const cp = `${basePath}.tables[${ti}].columns[${ci}].references`;
            const rt = trimStr(col.references?.table);
            const rc = trimStr(col.references?.column);
            if (!rt || !rc) {
                E({ code: 'FK_INCOMPLETE', message: `Invalid column definition: Column "${t.name}.${col.name}" is a foreign key without a complete reference.`, path: cp, table: t.name, column: col.name, property: 'references' });
                return;
            }
            const target = findTable(rt);
            if (!target)
                E({ code: 'FK_TABLE_NOT_FOUND', message: `Invalid column definition: Column "${t.name}.${col.name}" references table "${rt}", which is not in this schema.`, path: `${cp}.table`, table: t.name, column: col.name, property: 'references.table' });
            else if (!target.columns.some((x) => isObj(x) && U(trimStr(x.name)) === U(rc)))
                E({ code: 'FK_COLUMN_NOT_FOUND', message: `Invalid column definition: Column "${t.name}.${col.name}" references "${rt}.${rc}", which does not exist.`, path: `${cp}.column`, table: t.name, column: col.name, property: 'references.column' });
        });
    });
    // relationships
    if (schema.relationships !== undefined && !Array.isArray(schema.relationships))
        E({ code: 'RELATIONSHIPS_NOT_ARRAY', message: 'Invalid schema: "relationships" is not a list.', path: `${basePath}.relationships` });
    else {
        const seenRel = new Set();
        (schema.relationships || []).forEach((r, ri) => {
            const rp = `${basePath}.relationships[${ri}]`;
            if (!isObj(r)) {
                E({ code: 'REL_INVALID', message: `Invalid relationship #${ri + 1}: not an object.`, path: rp });
                return;
            }
            const k = `${U(trimStr(r.fromTable))}.${U(trimStr(r.fromColumn))}>${U(trimStr(r.toTable))}.${U(trimStr(r.toColumn))}`;
            if (seenRel.has(k))
                W({ code: 'REL_DUPLICATE', message: `Relationship ${r.fromTable}.${r.fromColumn} → ${r.toTable}.${r.toColumn} is listed twice.`, path: rp });
            seenRel.add(k);
            [['fromTable', 'fromColumn'], ['toTable', 'toColumn']].forEach(([tk, ck]) => {
                const tbl = findTable(trimStr(r[tk]));
                if (!tbl)
                    E({ code: 'REL_TABLE_NOT_FOUND', message: `Invalid relationship: table "${r[tk]}" is not in this schema.`, path: `${rp}.${tk}`, table: trimStr(r[tk]), property: tk });
                else if (!tbl.columns.some((x) => isObj(x) && U(trimStr(x.name)) === U(trimStr(r[ck]))))
                    E({ code: 'REL_COLUMN_NOT_FOUND', message: `Invalid relationship: column "${r[tk]}.${r[ck]}" does not exist.`, path: `${rp}.${ck}`, table: trimStr(r[tk]), column: trimStr(r[ck]), property: ck });
            });
        });
    }
    return { valid: errors.length === 0, errors, warnings };
}
export function checkRegistry(input, now = () => new Date().toISOString()) {
    const empty = (p) => ({ fileProblem: p, writer: detectWriter(null), schemas: [], validSchemas: [], invalidSchemas: [], migratedSchemas: [], activeSchemaId: null, activeSchemaUpdatedAt: null });
    let value = input.value;
    if (input.text !== undefined) {
        if (!input.text.trim())
            return empty({ severity: 'error', code: 'FILE_EMPTY', message: 'The repository schema file is empty.', path: '$' });
        try {
            value = JSON.parse(input.text);
        }
        catch (e) {
            return empty({ severity: 'error', code: 'FILE_NOT_JSON', message: `The repository schema file is not valid JSON (${e.message}).`, path: '$' });
        }
    }
    // Accept a bare schema / bare array as a one-file registry (older exports).
    let reg;
    if (Array.isArray(value))
        reg = { schemas: value };
    else if (isObj(value) && !Array.isArray(value.schemas) && Array.isArray(value.tables))
        reg = { schemas: [value] };
    else if (isObj(value))
        reg = value;
    else
        return empty({ severity: 'error', code: 'FILE_NOT_REGISTRY', message: 'The repository schema file does not contain a schema registry.', path: '$' });
    if (!Array.isArray(reg.schemas))
        return empty({ severity: 'error', code: 'FILE_NOT_REGISTRY', message: 'The repository schema file has no "schemas" list.', path: '$.schemas' });
    const writer = detectWriter(reg);
    if (writer.formatVersion !== null && writer.formatVersion > SCHEMA_FORMAT_VERSION)
        return { ...empty({ severity: 'error', code: 'FILE_NEWER_FORMAT', message: `The repository schema file uses format ${writer.formatVersion}, written by ${writer.writtenBy || 'a newer version'}. Update this device to the latest SQL Assistant to read it.`, path: '$.formatVersion' }), writer };
    const schemas = reg.schemas.map((raw, i) => {
        const n = normalizeSchema(raw, { index: i, legacy: writer.legacy });
        const name = n.schema?.name || (isObj(raw) ? trimStr(raw.name) || trimStr(raw.schema_name) : '') || `schema #${i + 1}`;
        if (!n.schema)
            return { index: i, name, id: '', schema: null, valid: false, errors: n.issues.filter((x) => x.severity === 'error'), warnings: [], legacy: writer.legacy, migrationStatus: writer.legacy ? 'migration-failed' : 'invalid', migrationNotes: n.notes };
        const v = validateSchemaModel(n.schema, `schemas[${i}]`);
        const errors = [...n.issues.filter((x) => x.severity === 'error'), ...v.errors];
        const warnings = [...n.issues.filter((x) => x.severity === 'warning'), ...v.warnings];
        const valid = errors.length === 0;
        let status = valid ? 'current' : 'invalid';
        if (writer.legacy)
            status = !valid ? 'migration-failed' : n.notes.length ? 'migrated' : 'legacy-clean';
        if (valid && status === 'migrated') {
            const info = { fromFormat: writer.label, migratedAt: now(), migratedBy: WRITER_LABEL, changes: n.notes.length, warnings: summarizeNoteWarnings(n.notes) };
            n.schema.migration = info;
        }
        return { index: i, name, id: n.schema.id, schema: n.schema, valid, errors, warnings, legacy: writer.legacy, migrationStatus: status, migrationNotes: n.notes };
    });
    return {
        fileProblem: null, writer, schemas,
        validSchemas: schemas.filter((s) => s.valid && s.schema).map((s) => s.schema),
        invalidSchemas: schemas.filter((s) => !s.valid),
        migratedSchemas: schemas.filter((s) => s.migrationStatus === 'migrated'),
        activeSchemaId: trimStr(reg.activeSchemaId) || null,
        activeSchemaUpdatedAt: trimStr(reg.activeSchemaUpdatedAt) || null
    };
}
function summarizeNoteWarnings(notes) {
    const unmapped = notes.filter((n) => n.rule === 'L3');
    const refs = notes.filter((n) => n.rule === 'L6');
    const out = [];
    if (unmapped.length)
        out.push(`${unmapped.length} decode label(s) had no raw code (lost by an older version) and are preserved as unmapped labels.`);
    if (refs.length)
        out.push(`${refs.length} reference(s) point outside this schema and are kept as documentation only.`);
    return out;
}
/** Rule counts for display, e.g. "437 decode codes recovered from legacy keys". */
export function summarizeMigration(notes) {
    const count = (r) => notes.filter((n) => n.rule === r).length;
    const out = [];
    if (count('L1'))
        out.push(`${count('L1')} decode raw value(s) read from legacy keys (e.g. "code").`);
    if (count('L5'))
        out.push(`${count('L5')} legacy property name(s) mapped to the current format.`);
    if (count('L2'))
        out.push(`${count('L2')} empty placeholder decode entr(y/ies) removed.`);
    if (count('L4'))
        out.push(`${count('L4')} exact duplicate decode entr(y/ies) removed.`);
    if (count('L3'))
        out.push(`${count('L3')} decode label(s) without a raw code preserved as unmapped labels.`);
    if (count('L6'))
        out.push(`${count('L6')} reference(s) outside this schema kept as documentation.`);
    return out;
}
/** Publish protection: validates every schema, then stamps writer/format metadata. Never emits an invalid schema. */
export function serializeRegistry(reg, device = '', now = () => new Date().toISOString()) {
    const problems = [];
    reg.schemas.forEach((s, i) => { const v = validateSchemaModel(s, `schemas[${i}]`); if (!v.valid)
        problems.push({ index: i, name: s.name, id: s.id, schema: s, valid: false, errors: v.errors, warnings: v.warnings, legacy: false, migrationStatus: 'invalid', migrationNotes: [] }); });
    if (problems.length)
        return { ok: false, text: '', problems };
    const out = { ...reg, formatVersion: SCHEMA_FORMAT_VERSION, writtenBy: WRITER_LABEL, writtenByDevice: device || reg.writtenByDevice || '', writtenAt: now() };
    return { ok: true, text: JSON.stringify(out, null, 2), problems };
}
/**
 * Restores decode codes for `unmappedDecodeLabels` from an original schema file (e.g. the
 * Alusta DB Description export the schema was first imported from). Matches table → column →
 * label (case-insensitive). Only fills codes that are missing; never overwrites existing entries.
 */
export function recoverDecodeFromSource(target, sourceRaw) {
    const src = normalizeSchema(Array.isArray(sourceRaw?.schemas) ? sourceRaw.schemas[0] : sourceRaw, { legacy: true });
    const next = JSON.parse(JSON.stringify(target));
    let restored = 0;
    let stillUnmapped = 0;
    const touched = [];
    next.tables.forEach((t) => t.columns.forEach((c) => {
        if (!c.unmappedDecodeLabels?.length)
            return;
        const st = src.schema?.tables.find((x) => U(x.name) === U(t.name));
        const sc = st?.columns.find((x) => U(x.name) === U(c.name));
        const remaining = [];
        c.unmappedDecodeLabels.forEach((label) => {
            const hit = sc?.decode?.find((d) => U(d.label) === U(label) && d.rawValue);
            if (hit && !(c.decode || []).some((d) => d.rawValue === hit.rawValue)) {
                (c.decode = c.decode || []).push({ rawValue: hit.rawValue, label: hit.label });
                restored += 1;
            }
            else if (!hit)
                remaining.push(label);
        });
        if (remaining.length !== c.unmappedDecodeLabels.length)
            touched.push(`${t.name}.${c.name}`);
        if (remaining.length) {
            c.unmappedDecodeLabels = remaining;
            stillUnmapped += remaining.length;
        }
        else
            delete c.unmappedDecodeLabels;
    }));
    return { schema: next, restored, stillUnmapped, columnsTouched: touched };
}
/** Counts used by the Schema Management UI. */
export function legacyLeftovers(schema) {
    let unmappedLabels = 0;
    let unresolvedRefs = 0;
    schema.tables.forEach((t) => t.columns.forEach((c) => { unmappedLabels += c.unmappedDecodeLabels?.length || 0; if (c.unresolvedReference)
        unresolvedRefs += 1; }));
    return { unmappedLabels, unresolvedRefs };
}
//# sourceMappingURL=schemaFormat.js.map