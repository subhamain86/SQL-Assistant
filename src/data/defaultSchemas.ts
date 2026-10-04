import type { SchemaModel } from '../types';
export const CORE_SCHEMA: SchemaModel = {
  id: 'schema-core-ap-p2p', name: 'AP / P2P Core', version: '1.0', status: 'active', updatedAt: new Date().toISOString(), lastSyncedAt: null,
  tables: [
    { name: 'PO_HEADER', module: 'Purchase Orders', description: 'One row per purchase order.', columns: [
      { name: 'PO_ID', label: 'PO ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
      { name: 'VENDOR_ID', label: 'Vendor ID', type: 'NUMBER', nullable: false, isForeignKey: true, references: { table: 'VENDOR', column: 'VENDOR_ID' }, description: 'Vendor on the PO.' },
      { name: 'BUYER_ID', label: 'Buyer ID', type: 'NUMBER', nullable: true, isForeignKey: true, references: { table: 'APP_USER', column: 'USER_ID' }, description: 'User who created the PO.' },
      { name: 'PO_DATE', label: 'PO Date', type: 'DATE', nullable: false, description: 'Date the PO was raised.' },
      { name: 'STATUS', label: 'Status', type: 'VARCHAR', length: 1, nullable: false, decode: [{ rawValue: 'O', label: 'Open' }, { rawValue: 'C', label: 'Closed' }, { rawValue: 'H', label: 'On Hold' }], description: 'PO lifecycle status.' },
      { name: 'TOTAL_AMOUNT', label: 'Total Amount', type: 'NUMBER', nullable: false, description: 'PO total value.' },
      { name: 'CURRENCY', label: 'Currency', type: 'VARCHAR', length: 3, nullable: false, description: 'ISO currency code.' } ] },
    { name: 'PO_LINE', module: 'Purchase Orders', description: 'Line items belonging to a purchase order.', columns: [
      { name: 'LINE_ID', label: 'Line ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
      { name: 'PO_ID', label: 'PO ID', type: 'NUMBER', nullable: false, isForeignKey: true, references: { table: 'PO_HEADER', column: 'PO_ID' }, description: 'Parent PO.' },
      { name: 'LINE_NO', label: 'Line No', type: 'NUMBER', nullable: false, description: 'Sequence within the PO.' },
      { name: 'ITEM_DESCRIPTION', label: 'Item Description', type: 'VARCHAR', length: 240, nullable: true, description: 'Free-text item description.' },
      { name: 'QTY', label: 'Quantity', type: 'NUMBER', nullable: false, description: 'Ordered quantity.' },
      { name: 'UNIT_PRICE', label: 'Unit Price', type: 'NUMBER', nullable: false, description: 'Price per unit.' },
      { name: 'GL_ACCOUNT_ID', label: 'GL Account ID', type: 'NUMBER', nullable: true, isForeignKey: true, references: { table: 'GL_ACCOUNT', column: 'ACCOUNT_ID' }, description: 'Cost allocation account.' } ] },
    { name: 'INVOICE_HEADER', module: 'Invoices', description: 'One row per supplier invoice.', columns: [
      { name: 'INVOICE_ID', label: 'Invoice ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
      { name: 'VENDOR_ID', label: 'Vendor ID', type: 'NUMBER', nullable: false, isForeignKey: true, references: { table: 'VENDOR', column: 'VENDOR_ID' }, description: 'Vendor who issued the invoice / supplier.' },
      { name: 'PO_ID', label: 'PO ID', type: 'NUMBER', nullable: true, isForeignKey: true, references: { table: 'PO_HEADER', column: 'PO_ID' }, description: 'Matched purchase order, if any.' },
      { name: 'INVOICE_DATE', label: 'Invoice Date', type: 'DATE', nullable: false, description: 'Date on the invoice document / created date.' },
      { name: 'DUE_DATE', label: 'Due Date', type: 'DATE', nullable: true, description: 'Date the invoice is due for payment.' },
      { name: 'POSTING_DATE', label: 'Posting Date', type: 'DATE', nullable: true, description: 'Date the invoice was posted to the ledger.' },
      { name: 'STATUS', label: 'Status', type: 'VARCHAR', length: 1, nullable: false, decode: [{ rawValue: 'P', label: 'Pending' }, { rawValue: 'A', label: 'Approved' }, { rawValue: 'R', label: 'Rejected' }, { rawValue: 'D', label: 'Paid' }], description: 'Invoice lifecycle status.' },
      { name: 'INVOICE_AMOUNT', label: 'Invoice Amount', type: 'NUMBER', nullable: false, description: 'Invoice total value / amount.' },
      { name: 'CURRENCY', label: 'Currency', type: 'VARCHAR', length: 3, nullable: false, description: 'ISO currency code.' } ] },
    { name: 'INVOICE_LINE', module: 'Invoices', description: 'Line items belonging to a supplier invoice.', columns: [
      { name: 'LINE_ID', label: 'Line ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
      { name: 'INVOICE_ID', label: 'Invoice ID', type: 'NUMBER', nullable: false, isForeignKey: true, references: { table: 'INVOICE_HEADER', column: 'INVOICE_ID' }, description: 'Parent invoice.' },
      { name: 'LINE_NO', label: 'Line No', type: 'NUMBER', nullable: false, description: 'Sequence within the invoice.' },
      { name: 'DESCRIPTION', label: 'Description', type: 'VARCHAR', length: 240, nullable: true, description: 'Free-text line description.' },
      { name: 'AMOUNT', label: 'Amount', type: 'NUMBER', nullable: false, description: 'Line amount.' },
      { name: 'GL_ACCOUNT_ID', label: 'GL Account ID', type: 'NUMBER', nullable: true, isForeignKey: true, references: { table: 'GL_ACCOUNT', column: 'ACCOUNT_ID' }, description: 'Cost allocation account.' } ] },
    { name: 'VENDOR', module: 'Vendors', description: 'Supplier / vendor master data.', columns: [
      { name: 'VENDOR_ID', label: 'Vendor ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
      { name: 'VENDOR_NAME', label: 'Vendor Name', type: 'VARCHAR', length: 120, nullable: false, description: 'Legal or trading name / supplier name.' },
      { name: 'DUNS_NUMBER', label: 'DUNS Number', type: 'VARCHAR', length: 15, nullable: true, description: 'D-U-N-S identifier.' },
      { name: 'COUNTRY', label: 'Country', type: 'VARCHAR', length: 2, nullable: false, description: 'ISO country code.' },
      { name: 'STATUS', label: 'Status', type: 'VARCHAR', length: 1, nullable: false, decode: [{ rawValue: 'A', label: 'Active' }, { rawValue: 'I', label: 'Inactive' }], description: 'Vendor account status.' },
      { name: 'PAYMENT_TERMS', label: 'Payment Terms', type: 'VARCHAR', length: 20, nullable: true, description: 'Standard payment terms code.' },
      { name: 'ORG_ID', label: 'Organization ID', type: 'NUMBER', nullable: true, isForeignKey: true, references: { table: 'ORGANIZATION', column: 'ORG_ID' }, description: 'Parent organization / corporate group this vendor belongs to.' } ] },
    { name: 'ORGANIZATION', module: 'Vendors', description: 'Parent corporate organization / group that one or more vendors belong to.', columns: [
      { name: 'ORG_ID', label: 'Organization ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
      { name: 'ORG_NAME', label: 'Organization Name', type: 'VARCHAR', length: 150, nullable: false, description: 'Name of the parent organization.' },
      { name: 'REGION', label: 'Region', type: 'VARCHAR', length: 40, nullable: true, description: 'Geographic region the organization operates in.' } ] },
    { name: 'GL_ACCOUNT', module: 'General Ledger', description: 'Chart of accounts.', columns: [
      { name: 'ACCOUNT_ID', label: 'Account ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
      { name: 'ACCOUNT_NAME', label: 'Account Name', type: 'VARCHAR', length: 120, nullable: false, description: 'Account description.' },
      { name: 'ACCOUNT_TYPE', label: 'Account Type', type: 'VARCHAR', length: 1, nullable: false, decode: [{ rawValue: 'E', label: 'Expense' }, { rawValue: 'A', label: 'Asset' }, { rawValue: 'L', label: 'Liability' }, { rawValue: 'R', label: 'Revenue' }], description: 'Account classification.' },
      { name: 'COST_CENTER', label: 'Cost Center', type: 'VARCHAR', length: 20, nullable: true, description: 'Owning cost center.' } ] },
    { name: 'APP_USER', module: 'Users & Approvals', description: 'Application user directory.', columns: [
      { name: 'USER_ID', label: 'User ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
      { name: 'FULL_NAME', label: 'Full Name', type: 'VARCHAR', length: 120, nullable: false, description: 'Display name.' },
      { name: 'EMAIL', label: 'Email', type: 'VARCHAR', length: 160, nullable: false, description: 'Login / contact email.' },
      { name: 'ROLE', label: 'Role', type: 'VARCHAR', length: 2, nullable: false, decode: [{ rawValue: 'A', label: 'Admin' }, { rawValue: 'S', label: 'Support' }, { rawValue: 'B', label: 'Buyer' }, { rawValue: 'AP', label: 'AP Clerk' }], description: 'Assigned application role.' },
      { name: 'ACTIVE_FLAG', label: 'Active', type: 'FLAG', nullable: false, decode: [{ rawValue: 'Y', label: 'Yes' }, { rawValue: 'N', label: 'No' }], description: 'Whether the account is active.' } ] },
    { name: 'APPROVAL_HISTORY', module: 'Users & Approvals', description: 'Audit trail of invoice approval actions — who approved, rejected, or escalated an invoice.', columns: [
      { name: 'APPROVAL_ID', label: 'Approval ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
      { name: 'INVOICE_ID', label: 'Invoice ID', type: 'NUMBER', nullable: false, isForeignKey: true, references: { table: 'INVOICE_HEADER', column: 'INVOICE_ID' }, description: 'Invoice being actioned.' },
      { name: 'APPROVER_ID', label: 'Approver ID', type: 'NUMBER', nullable: false, isForeignKey: true, references: { table: 'APP_USER', column: 'USER_ID' }, description: 'User who approved or rejected the invoice.' },
      { name: 'APPROVAL_DATE', label: 'Approval Date', type: 'DATE', nullable: false, description: 'Date/time of the approval action.' },
      { name: 'ACTION', label: 'Action', type: 'VARCHAR', length: 3, nullable: false, decode: [{ rawValue: 'APP', label: 'Approved' }, { rawValue: 'REJ', label: 'Rejected' }, { rawValue: 'ESC', label: 'Escalated' }], description: 'Action taken by the approver.' } ] },
    { name: 'VW_OPEN_INVOICES', module: 'Invoices', description: 'Read-only view of currently open (not yet paid) invoices with their vendor.', objectType: 'VIEW', columns: [
      { name: 'INVOICE_ID', label: 'Invoice ID', type: 'NUMBER', nullable: false, description: 'Invoice identifier.' },
      { name: 'VENDOR_ID', label: 'Vendor ID', type: 'NUMBER', nullable: false, description: 'Vendor identifier.' },
      { name: 'INVOICE_AMOUNT', label: 'Invoice Amount', type: 'NUMBER', nullable: false, description: 'Invoice total value.' },
      { name: 'STATUS', label: 'Status', type: 'VARCHAR', length: 1, nullable: false, description: 'Invoice status (always non-Paid in this view).' } ] }
  ],
  relationships: [
    { id: 'r1', fromTable: 'PO_HEADER', fromColumn: 'VENDOR_ID', toTable: 'VENDOR', toColumn: 'VENDOR_ID', kind: 'many-to-one' },
    { id: 'r2', fromTable: 'PO_LINE', fromColumn: 'PO_ID', toTable: 'PO_HEADER', toColumn: 'PO_ID', kind: 'many-to-one' },
    { id: 'r3', fromTable: 'INVOICE_HEADER', fromColumn: 'VENDOR_ID', toTable: 'VENDOR', toColumn: 'VENDOR_ID', kind: 'many-to-one' },
    { id: 'r4', fromTable: 'INVOICE_HEADER', fromColumn: 'PO_ID', toTable: 'PO_HEADER', toColumn: 'PO_ID', kind: 'many-to-one' },
    { id: 'r5', fromTable: 'INVOICE_LINE', fromColumn: 'INVOICE_ID', toTable: 'INVOICE_HEADER', toColumn: 'INVOICE_ID', kind: 'many-to-one' },
    { id: 'r6', fromTable: 'APPROVAL_HISTORY', fromColumn: 'INVOICE_ID', toTable: 'INVOICE_HEADER', toColumn: 'INVOICE_ID', kind: 'many-to-one' },
    { id: 'r8', fromTable: 'VENDOR', fromColumn: 'ORG_ID', toTable: 'ORGANIZATION', toColumn: 'ORG_ID', kind: 'many-to-one' }
  ]
};
export const EXTENDED_SCHEMA: SchemaModel = {
  id: 'schema-extended-p2p', name: 'AP / P2P Extended (with Contracts)', version: '1.0', status: 'inactive', updatedAt: new Date().toISOString(), lastSyncedAt: null,
  tables: [
    ...CORE_SCHEMA.tables,
    { name: 'CONTRACT', module: 'Contracts', description: 'Master service / supply contracts with vendors.', columns: [
      { name: 'CONTRACT_ID', label: 'Contract ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
      { name: 'VENDOR_ID', label: 'Vendor ID', type: 'NUMBER', nullable: false, isForeignKey: true, references: { table: 'VENDOR', column: 'VENDOR_ID' }, description: 'Contracted vendor.' },
      { name: 'START_DATE', label: 'Start Date', type: 'DATE', nullable: false, description: 'Contract start date.' },
      { name: 'END_DATE', label: 'End Date', type: 'DATE', nullable: true, description: 'Contract end date.' },
      { name: 'CONTRACT_VALUE', label: 'Contract Value', type: 'NUMBER', nullable: false, description: 'Total contracted value.' },
      { name: 'STATUS', label: 'Status', type: 'VARCHAR', length: 1, nullable: false, decode: [{ rawValue: 'A', label: 'Active' }, { rawValue: 'E', label: 'Expired' }, { rawValue: 'D', label: 'Draft' }], description: 'Contract status.' } ] }
  ],
  relationships: [...CORE_SCHEMA.relationships, { id: 'r7', fromTable: 'CONTRACT', fromColumn: 'VENDOR_ID', toTable: 'VENDOR', toColumn: 'VENDOR_ID', kind: 'many-to-one' }]
};
export const DEFAULT_SCHEMAS: SchemaModel[] = [CORE_SCHEMA, EXTENDED_SCHEMA];
export const DEFAULT_ACTIVE_SCHEMA_ID = CORE_SCHEMA.id;
