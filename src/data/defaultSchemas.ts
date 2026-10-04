import type { SchemaModel } from '../types';
const c = (name: string, label: string, type: string, extra: Record<string, unknown> = {}) => ({ name, label, type, nullable: true, description: '', ...extra });
export const CORE_SCHEMA: SchemaModel = {
  id: 'schema-core-ap-p2p', name: 'AP / P2P Core', version: '1.0', status: 'active', updatedAt: '2026-01-01T00:00:00.000Z', lastSyncedAt: null,
  tables: [
    { name: 'PO_HEADER', module: 'Purchase Orders', description: 'One row per purchase order.', columns: [
      c('PO_ID', 'PO ID', 'NUMBER', { nullable: false, isPrimaryKey: true }), c('VENDOR_ID', 'Vendor ID', 'NUMBER', { nullable: false, isForeignKey: true, references: { table: 'VENDOR', column: 'VENDOR_ID' } }),
      c('PO_DATE', 'PO Date', 'DATE', { nullable: false }), c('STATUS', 'Status', 'VARCHAR', { length: 1, nullable: false, decode: [{ rawValue: 'O', label: 'Open' }, { rawValue: 'C', label: 'Closed' }] }), c('TOTAL_AMOUNT', 'Total Amount', 'NUMBER', { nullable: false }) ] },
    { name: 'INVOICE_HEADER', module: 'Invoices', description: 'One row per supplier invoice.', columns: [
      c('INVOICE_ID', 'Invoice ID', 'NUMBER', { nullable: false, isPrimaryKey: true }), c('VENDOR_ID', 'Vendor ID', 'NUMBER', { nullable: false, isForeignKey: true, references: { table: 'VENDOR', column: 'VENDOR_ID' } }),
      c('PO_ID', 'PO ID', 'NUMBER', { isForeignKey: true, references: { table: 'PO_HEADER', column: 'PO_ID' } }), c('INVOICE_DATE', 'Invoice Date', 'DATE', { nullable: false }), c('DUE_DATE', 'Due Date', 'DATE'),
      c('STATUS', 'Status', 'VARCHAR', { length: 1, nullable: false, decode: [{ rawValue: 'P', label: 'Pending' }, { rawValue: 'A', label: 'Approved' }, { rawValue: 'R', label: 'Rejected' }, { rawValue: 'D', label: 'Paid' }] }),
      c('INVOICE_AMOUNT', 'Invoice Amount', 'NUMBER', { nullable: false }), c('CURRENCY', 'Currency', 'VARCHAR', { length: 3, nullable: false }) ] },
    { name: 'VENDOR', module: 'Vendors', description: 'Supplier / vendor master data.', columns: [
      c('VENDOR_ID', 'Vendor ID', 'NUMBER', { nullable: false, isPrimaryKey: true }), c('VENDOR_NAME', 'Vendor Name', 'VARCHAR', { length: 120, nullable: false }), c('COUNTRY', 'Country', 'VARCHAR', { length: 2, nullable: false }),
      c('STATUS', 'Status', 'VARCHAR', { length: 1, nullable: false, decode: [{ rawValue: 'A', label: 'Active' }, { rawValue: 'I', label: 'Inactive' }] }) ] }
  ],
  relationships: [
    { id: 'r1', fromTable: 'PO_HEADER', fromColumn: 'VENDOR_ID', toTable: 'VENDOR', toColumn: 'VENDOR_ID', kind: 'many-to-one' },
    { id: 'r3', fromTable: 'INVOICE_HEADER', fromColumn: 'VENDOR_ID', toTable: 'VENDOR', toColumn: 'VENDOR_ID', kind: 'many-to-one' },
    { id: 'r4', fromTable: 'INVOICE_HEADER', fromColumn: 'PO_ID', toTable: 'PO_HEADER', toColumn: 'PO_ID', kind: 'many-to-one' }
  ]
} as SchemaModel;
export const DEFAULT_SCHEMAS: SchemaModel[] = [CORE_SCHEMA];
export const DEFAULT_ACTIVE_SCHEMA_ID = CORE_SCHEMA.id;
