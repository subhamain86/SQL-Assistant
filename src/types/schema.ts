export type ColumnDataType = 'VARCHAR' | 'NUMBER' | 'DATE' | 'FLAG' | 'TIMESTAMP';
export const VALID_DATA_TYPES: ColumnDataType[] = ['VARCHAR', 'NUMBER', 'DATE', 'FLAG', 'TIMESTAMP'];
export interface DecodeEntry { rawValue: string; label: string; }
export interface ColumnDef {
  name: string; label: string; type: string; length?: number; precision?: number; nullable: boolean;
  alias?: string; isPrimaryKey?: boolean; isForeignKey?: boolean; references?: { table: string; column: string };
  decode?: DecodeEntry[]; description: string;
  /** V17.2.1 — documented reference to a table/column that is not part of this schema (kept from legacy files; not used for JOINs). */
  unresolvedReference?: { table: string; column: string };
  /** V17.2.1 — legacy decode labels whose raw code was lost by an older version (kept; not used in SQL until the code is restored). */
  unmappedDecodeLabels?: string[];
}
export type SchemaObjectType = 'TABLE' | 'VIEW';
export interface TableDef { name: string; module: string; description: string; columns: ColumnDef[]; objectType?: SchemaObjectType; }
export interface RelationshipDef { id: string; fromTable: string; fromColumn: string; toTable: string; toColumn: string; kind: 'one-to-many' | 'many-to-one' | 'one-to-one'; }
export type SchemaStatus = 'active' | 'default' | 'inactive';
export interface SchemaVersionMeta { version: string; schemaId: string; lastUpdated: string; updatedByDevice: string; source: 'local' | 'location' | 'github' | 'vault' | 'import'; checksum: string; }
/** V17.2.1 — record of a legacy-format migration applied to this schema. */
export interface SchemaMigrationInfo { fromFormat: string; migratedAt: string; migratedBy: string; changes: number; warnings: string[]; }
export interface SchemaModel { id: string; name: string; version: string; status: SchemaStatus; updatedAt: string; lastSyncedAt: string | null; tables: TableDef[]; relationships: RelationshipDef[]; versionMeta?: SchemaVersionMeta; originalFileName?: string; migration?: SchemaMigrationInfo; }
export interface SchemaRegistry { schemas: SchemaModel[]; activeSchemaId: string; activeSchemaUpdatedAt?: string | null; formatVersion?: number; writtenBy?: string; writtenByDevice?: string; writtenAt?: string; }
export interface SchemaEditorRow { rowId: string; module: string; tableName: string; tableDescription: string; columnName: string; columnDescription: string; dataType: ColumnDataType; length: number | null; precision: number | null; nullable: boolean; alias: string; decodeText: string; isPrimaryKey: boolean; isForeignKey: boolean; fkTable: string; fkColumn: string; }
export interface SchemaIntegrityIssue { severity: 'error' | 'warning'; message: string; }
export interface SchemaIntegrityResult { valid: boolean; issues: SchemaIntegrityIssue[]; }
export interface SchemaConflict { hasConflict: boolean; localVersion: string; remoteVersion: string; changedPaths: string[]; }
