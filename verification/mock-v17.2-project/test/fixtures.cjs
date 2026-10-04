const fs = require('node:fs'); const path = require('node:path');
const SRC = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ap-schema-77.source.json'), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
/** AP schema 77 as a V17.0 device published it: model keys mapped, but decode `code` NOT mapped → rawValue "" (no writer stamp). */
function v170Published(decodeForm = 'rawValue-empty-with-code') {
  return { id: 'schema-ap77', name: 'AP schema 77', version: '5.3', status: 'inactive', updatedAt: '2026-09-07T00:00:00Z', lastSyncedAt: null,
    tables: SRC.tables.map((t) => ({ name: t.name, module: t.module, description: t.notes, columns: t.columns.map((c) => {
      const o = { name: c.name, label: c.name, type: c.type, nullable: c.nullable, description: c.description };
      if (c.primary_key) o.isPrimaryKey = true;
      if (c.foreign_key) { o.isForeignKey = true; o.references = { table: c.foreign_key.table, column: c.foreign_key.column }; }
      if (c.alias) o.alias = c.alias;
      if (c.decode) o.decode = c.decode.map((d) => decodeForm === 'rawValue-empty-with-code' ? { rawValue: '', label: d.label, code: d.code } : decodeForm === 'code-only' ? { code: d.code, label: d.label } : { rawValue: '', label: d.label });
      return o; }) })), relationships: [] };
}
function currentSchema(name = 'AP / P2P Core') {
  return { id: 'schema-core', name, version: '1.0', status: 'active', updatedAt: '2026-10-01T00:00:00Z', lastSyncedAt: null,
    tables: [{ name: 'VENDOR', module: 'Vendors', description: 'Vendors', columns: [
      { name: 'VENDOR_ID', label: 'Vendor ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'PK' },
      { name: 'STATUS', label: 'Status', type: 'VARCHAR2', nullable: false, description: 's', decode: [{ rawValue: 'A', label: 'Active' }, { rawValue: 'I', label: 'Inactive' }] }] },
      { name: 'INVOICE_HEADER', module: 'Invoices', description: 'Invoices', columns: [
      { name: 'INVOICE_ID', label: 'Invoice ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'PK' },
      { name: 'VENDOR_ID', label: 'Vendor ID', type: 'NUMBER', nullable: false, isForeignKey: true, references: { table: 'VENDOR', column: 'VENDOR_ID' }, description: 'FK' }] }],
    relationships: [{ id: 'r1', fromTable: 'INVOICE_HEADER', fromColumn: 'VENDOR_ID', toTable: 'VENDOR', toColumn: 'VENDOR_ID', kind: 'many-to-one' }],
    schemaFormat: { app: 'SQL Assistant', appVersion: '17.2.1', formatVersion: 3, writer: '17.2.1', generatedAt: '2026-10-04T00:00:00Z' } };
}
module.exports = { SRC, clone, v170Published, currentSchema, TOTAL_DECODES: SRC.tables.reduce((n, t) => n + t.columns.reduce((m, c) => m + (c.decode ? c.decode.length : 0), 0), 0) };
