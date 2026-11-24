import type { SchemaModel } from '../types';
const C = (name: string, label: string, type: string, x: Record<string, unknown> = {}) => ({ name, label, type, nullable: true, description: '', ...x });
const FK = (table: string, column: string) => ({ isForeignKey: true, references: { table, column } });
/** V17.2 built-in schemas (unchanged). */
export const CORE_SCHEMA: SchemaModel = {
  id: 'schema-core-ap-p2p', name: 'AP / P2P Core', version: '1.0', status: 'active', updatedAt: '2026-01-01T00:00:00.000Z', lastSyncedAt: null,
  tables: [
    { name: 'PO_HEADER', module: 'Purchase Orders', description: 'One row per purchase order.', columns: [
      C('PO_ID', 'PO ID', 'NUMBER', { nullable: false, isPrimaryKey: true, description: 'Primary key.' }), C('VENDOR_ID', 'Vendor ID', 'NUMBER', { nullable: false, ...FK('VENDOR', 'VENDOR_ID'), description: 'Vendor on the PO.' }),
      C('BUYER_ID', 'Buyer ID', 'NUMBER', { ...FK('APP_USER', 'USER_ID'), description: 'User who created the PO.' }), C('PO_DATE', 'PO Date', 'DATE', { nullable: false, description: 'Date the PO was raised.' }),
      C('STATUS', 'Status', 'VARCHAR', { length: 1, nullable: false, decode: [{ rawValue: 'O', label: 'Open' }, { rawValue: 'C', label: 'Closed' }, { rawValue: 'H', label: 'On Hold' }], description: 'PO lifecycle status.' }),
      C('TOTAL_AMOUNT', 'Total Amount', 'NUMBER', { nullable: false, description: 'PO total value.' }), C('CURRENCY', 'Currency', 'VARCHAR', { length: 3, nullable: false, description: 'ISO currency code.' })] },
    { name: 'PO_LINE', module: 'Purchase Orders', description: 'Line items belonging to a purchase order.', columns: [
      C('LINE_ID', 'Line ID', 'NUMBER', { nullable: false, isPrimaryKey: true, description: 'Primary key.' }), C('PO_ID', 'PO ID', 'NUMBER', { nullable: false, ...FK('PO_HEADER', 'PO_ID'), description: 'Parent PO.' }),
      C('LINE_NO', 'Line No', 'NUMBER', { nullable: false, description: 'Sequence within the PO.' }), C('ITEM_DESCRIPTION', 'Item Description', 'VARCHAR', { length: 240, description: 'Free-text item description.' }),
      C('QTY', 'Quantity', 'NUMBER', { nullable: false, description: 'Ordered quantity.' }), C('UNIT_PRICE', 'Unit Price', 'NUMBER', { nullable: false, description: 'Price per unit.' }), C('GL_ACCOUNT_ID', 'GL Account ID', 'NUMBER', { ...FK('GL_ACCOUNT', 'ACCOUNT_ID'), description: 'Cost allocation account.' })] },
    { name: 'INVOICE_HEADER', module: 'Invoices', description: 'One row per supplier invoice.', columns: [
      C('INVOICE_ID', 'Invoice ID', 'NUMBER', { nullable: false, isPrimaryKey: true, description: 'Primary key.' }), C('VENDOR_ID', 'Vendor ID', 'NUMBER', { nullable: false, ...FK('VENDOR', 'VENDOR_ID'), description: 'Vendor who issued the invoice / supplier.' }),
      C('PO_ID', 'PO ID', 'NUMBER', { ...FK('PO_HEADER', 'PO_ID'), description: 'Matched purchase order, if any.' }), C('INVOICE_DATE', 'Invoice Date', 'DATE', { nullable: false, description: 'Date on the invoice document / created date.' }),
      C('DUE_DATE', 'Due Date', 'DATE', { description: 'Date the invoice is due for payment.' }), C('POSTING_DATE', 'Posting Date', 'DATE', { description: 'Date the invoice was posted to the ledger.' }),
      C('STATUS', 'Status', 'VARCHAR', { length: 1, nullable: false, decode: [{ rawValue: 'P', label: 'Pending' }, { rawValue: 'A', label: 'Approved' }, { rawValue: 'R', label: 'Rejected' }, { rawValue: 'D', label: 'Paid' }], description: 'Invoice lifecycle status.' }),
      C('INVOICE_AMOUNT', 'Invoice Amount', 'NUMBER', { nullable: false, description: 'Invoice total value / amount.' }), C('CURRENCY', 'Currency', 'VARCHAR', { length: 3, nullable: false, description: 'ISO currency code.' })] },
    { name: 'INVOICE_LINE', module: 'Invoices', description: 'Line items belonging to a supplier invoice.', columns: [
      C('LINE_ID', 'Line ID', 'NUMBER', { nullable: false, isPrimaryKey: true, description: 'Primary key.' }), C('INVOICE_ID', 'Invoice ID', 'NUMBER', { nullable: false, ...FK('INVOICE_HEADER', 'INVOICE_ID'), description: 'Parent invoice.' }),
      C('LINE_NO', 'Line No', 'NUMBER', { nullable: false, description: 'Sequence within the invoice.' }), C('DESCRIPTION', 'Description', 'VARCHAR', { length: 240, description: 'Free-text line description.' }),
      C('AMOUNT', 'Amount', 'NUMBER', { nullable: false, description: 'Line amount.' }), C('GL_ACCOUNT_ID', 'GL Account ID', 'NUMBER', { ...FK('GL_ACCOUNT', 'ACCOUNT_ID'), description: 'Cost allocation account.' })] },
    { name: 'VENDOR', module: 'Vendors', description: 'Supplier / vendor master data.', columns: [
      C('VENDOR_ID', 'Vendor ID', 'NUMBER', { nullable: false, isPrimaryKey: true, description: 'Primary key.' }), C('VENDOR_NAME', 'Vendor Name', 'VARCHAR', { length: 120, nullable: false, description: 'Legal or trading name / supplier name.' }),
      C('DUNS_NUMBER', 'DUNS Number', 'VARCHAR', { length: 15, description: 'D-U-N-S identifier.' }), C('COUNTRY', 'Country', 'VARCHAR', { length: 2, nullable: false, description: 'ISO country code.' }),
      C('STATUS', 'Status', 'VARCHAR', { length: 1, nullable: false, decode: [{ rawValue: 'A', label: 'Active' }, { rawValue: 'I', label: 'Inactive' }], description: 'Vendor account status.' }),
      C('PAYMENT_TERMS', 'Payment Terms', 'VARCHAR', { length: 20, description: 'Standard payment terms code.' }), C('ORG_ID', 'Organization ID', 'NUMBER', { ...FK('ORGANIZATION', 'ORG_ID'), description: 'Parent organization / corporate group this vendor belongs to.' })] },
    { name: 'ORGANIZATION', module: 'Vendors', description: 'Parent corporate organization / group that one or more vendors belong to.', columns: [
      C('ORG_ID', 'Organization ID', 'NUMBER', { nullable: false, isPrimaryKey: true, description: 'Primary key.' }), C('ORG_NAME', 'Organization Name', 'VARCHAR', { length: 150, nullable: false, description: 'Name of the parent organization.' }), C('REGION', 'Region', 'VARCHAR', { length: 40, description: 'Geographic region the organization operates in.' })] },
    { name: 'GL_ACCOUNT', module: 'General Ledger', description: 'Chart of accounts.', columns: [
      C('ACCOUNT_ID', 'Account ID', 'NUMBER', { nullable: false, isPrimaryKey: true, description: 'Primary key.' }), C('ACCOUNT_NAME', 'Account Name', 'VARCHAR', { length: 120, nullable: false, description: 'Account description.' }),
      C('ACCOUNT_TYPE', 'Account Type', 'VARCHAR', { length: 1, nullable: false, decode: [{ rawValue: 'E', label: 'Expense' }, { rawValue: 'A', label: 'Asset' }, { rawValue: 'L', label: 'Liability' }, { rawValue: 'R', label: 'Revenue' }], description: 'Account classification.' }), C('COST_CENTER', 'Cost Center', 'VARCHAR', { length: 20, description: 'Owning cost center.' })] },
    { name: 'APP_USER', module: 'Users & Approvals', description: 'Application user directory.', columns: [
      C('USER_ID', 'User ID', 'NUMBER', { nullable: false, isPrimaryKey: true, description: 'Primary key.' }), C('FULL_NAME', 'Full Name', 'VARCHAR', { length: 120, nullable: false, description: 'Display name.' }), C('EMAIL', 'Email', 'VARCHAR', { length: 160, nullable: false, description: 'Login / contact email.' }),
      C('ROLE', 'Role', 'VARCHAR', { length: 2, nullable: false, decode: [{ rawValue: 'A', label: 'Admin' }, { rawValue: 'S', label: 'Support' }, { rawValue: 'B', label: 'Buyer' }, { rawValue: 'AP', label: 'AP Clerk' }], description: 'Assigned application role.' }),
      C('ACTIVE_FLAG', 'Active', 'FLAG', { nullable: false, decode: [{ rawValue: 'Y', label: 'Yes' }, { rawValue: 'N', label: 'No' }], description: 'Whether the account is active.' })] },
    { name: 'APPROVAL_HISTORY', module: 'Users & Approvals', description: 'Audit trail of invoice approval actions — who approved, rejected, or escalated an invoice.', columns: [
      C('APPROVAL_ID', 'Approval ID', 'NUMBER', { nullable: false, isPrimaryKey: true, description: 'Primary key.' }), C('INVOICE_ID', 'Invoice ID', 'NUMBER', { nullable: false, ...FK('INVOICE_HEADER', 'INVOICE_ID'), description: 'Invoice being actioned.' }),
      C('APPROVER_ID', 'Approver ID', 'NUMBER', { nullable: false, ...FK('APP_USER', 'USER_ID'), description: 'User who approved or rejected the invoice.' }), C('APPROVAL_DATE', 'Approval Date', 'DATE', { nullable: false, description: 'Date/time of the approval action.' }),
      C('ACTION', 'Action', 'VARCHAR', { length: 3, nullable: false, decode: [{ rawValue: 'APP', label: 'Approved' }, { rawValue: 'REJ', label: 'Rejected' }, { rawValue: 'ESC', label: 'Escalated' }], description: 'Action taken by the approver.' })] },
    { name: 'VW_OPEN_INVOICES', module: 'Invoices', description: 'Read-only view of currently open (not yet paid) invoices with their vendor.', objectType: 'VIEW', columns: [
      C('INVOICE_ID', 'Invoice ID', 'NUMBER', { nullable: false, description: 'Invoice identifier.' }), C('VENDOR_ID', 'Vendor ID', 'NUMBER', { nullable: false, description: 'Vendor identifier.' }),
      C('INVOICE_AMOUNT', 'Invoice Amount', 'NUMBER', { nullable: false, description: 'Invoice total value.' }), C('STATUS', 'Status', 'VARCHAR', { length: 1, nullable: false, description: 'Invoice status (always non-Paid in this view).' })] }
  ],
  relationships: [
    { id: 'r1', fromTable: 'PO_HEADER', fromColumn: 'VENDOR_ID', toTable: 'VENDOR', toColumn: 'VENDOR_ID', kind: 'many-to-one' }, { id: 'r2', fromTable: 'PO_LINE', fromColumn: 'PO_ID', toTable: 'PO_HEADER', toColumn: 'PO_ID', kind: 'many-to-one' },
    { id: 'r3', fromTable: 'INVOICE_HEADER', fromColumn: 'VENDOR_ID', toTable: 'VENDOR', toColumn: 'VENDOR_ID', kind: 'many-to-one' }, { id: 'r4', fromTable: 'INVOICE_HEADER', fromColumn: 'PO_ID', toTable: 'PO_HEADER', toColumn: 'PO_ID', kind: 'many-to-one' },
    { id: 'r5', fromTable: 'INVOICE_LINE', fromColumn: 'INVOICE_ID', toTable: 'INVOICE_HEADER', toColumn: 'INVOICE_ID', kind: 'many-to-one' }, { id: 'r6', fromTable: 'APPROVAL_HISTORY', fromColumn: 'INVOICE_ID', toTable: 'INVOICE_HEADER', toColumn: 'INVOICE_ID', kind: 'many-to-one' },
    { id: 'r8', fromTable: 'VENDOR', fromColumn: 'ORG_ID', toTable: 'ORGANIZATION', toColumn: 'ORG_ID', kind: 'many-to-one' }
  ]
} as SchemaModel;
export const EXTENDED_SCHEMA: SchemaModel = {
  id: 'schema-extended-p2p', name: 'AP / P2P Extended (with Contracts)', version: '1.0', status: 'inactive', updatedAt: '2026-01-01T00:00:00.000Z', lastSyncedAt: null,
  tables: [...JSON.parse(JSON.stringify(CORE_SCHEMA.tables)), { name: 'CONTRACT', module: 'Contracts', description: 'Master service / supply contracts with vendors.', columns: [
    C('CONTRACT_ID', 'Contract ID', 'NUMBER', { nullable: false, isPrimaryKey: true, description: 'Primary key.' }), C('VENDOR_ID', 'Vendor ID', 'NUMBER', { nullable: false, ...FK('VENDOR', 'VENDOR_ID'), description: 'Contracted vendor.' }),
    C('START_DATE', 'Start Date', 'DATE', { nullable: false, description: 'Contract start date.' }), C('END_DATE', 'End Date', 'DATE', { description: 'Contract end date.' }), C('CONTRACT_VALUE', 'Contract Value', 'NUMBER', { nullable: false, description: 'Total contracted value.' }),
    C('STATUS', 'Status', 'VARCHAR', { length: 1, nullable: false, decode: [{ rawValue: 'A', label: 'Active' }, { rawValue: 'E', label: 'Expired' }, { rawValue: 'D', label: 'Draft' }], description: 'Contract status.' })] }],
  relationships: [...CORE_SCHEMA.relationships.map((r) => ({ ...r })), { id: 'r7', fromTable: 'CONTRACT', fromColumn: 'VENDOR_ID', toTable: 'VENDOR', toColumn: 'VENDOR_ID', kind: 'many-to-one' }]
} as SchemaModel;
export const DEFAULT_SCHEMAS: SchemaModel[] = [CORE_SCHEMA, EXTENDED_SCHEMA];
export const DEFAULT_ACTIVE_SCHEMA_ID = CORE_SCHEMA.id;
