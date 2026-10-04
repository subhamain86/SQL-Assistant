import { safeTrim, safeUpperTrim } from '../utils/validation.js';
import { validateSchemaModel, normalizeSchema, checkRegistry, describeIssue } from '../v17/sync/schemaFormat.js';
const toIssues = (list, withPath = false) => list.map((i) => ({ severity: i.severity, message: withPath ? describeIssue(i) : i.message }));
export function validateSchemaIntegrity(tables, relationships = []) {
    const r = validateSchemaModel({ tables, relationships });
    return { valid: r.valid, issues: [...toIssues(r.errors), ...toIssues(r.warnings)] };
}
export function validateSingleRowAgainstSchema(schema, tableName, columnName, originalTableName, originalColumnName) {
    const issues = [];
    const t = safeTrim(tableName);
    const c = safeTrim(columnName);
    if (!t)
        issues.push({ severity: 'error', message: 'Table Name is required.' });
    if (!c)
        issues.push({ severity: 'error', message: 'Column Name is required.' });
    if (!t || !c)
        return issues;
    if (safeUpperTrim(originalTableName) === safeUpperTrim(t) && safeUpperTrim(originalColumnName) === safeUpperTrim(c))
        return issues;
    const table = schema.tables.find((x) => safeUpperTrim(x?.name) === safeUpperTrim(t));
    if (table?.columns?.some((x) => safeUpperTrim(x?.name) === safeUpperTrim(c)))
        issues.push({ severity: 'error', message: `Column "${t}.${c}" already exists in this schema.` });
    return issues;
}
export function validateIncomingSchemaFile(candidate) {
    const n = normalizeSchema(candidate);
    if (!n.schema)
        return { valid: false, issues: toIssues(n.issues, true) };
    const v = validateSchemaModel(n.schema);
    const errors = [...n.issues.filter((i) => i.severity === 'error'), ...v.errors];
    return { valid: errors.length === 0, issues: [...toIssues(errors, true), ...toIssues([...n.issues.filter((i) => i.severity === 'warning'), ...v.warnings], true)] };
}
export function validateIncomingRegistryFile(candidate) {
    const r = checkRegistry({ value: candidate });
    if (r.fileProblem)
        return { valid: false, issues: [{ severity: 'error', message: r.fileProblem.message }] };
    const issues = [];
    r.schemas.forEach((s) => { s.errors.forEach((e) => issues.push({ severity: 'error', message: `Schema "${s.name}": ${describeIssue(e)}` })); s.warnings.forEach((w) => issues.push({ severity: 'warning', message: `Schema "${s.name}": ${describeIssue(w)}` })); });
    return { valid: r.invalidSchemas.length === 0, issues };
}
//# sourceMappingURL=schemaIntegrityEngine.js.map