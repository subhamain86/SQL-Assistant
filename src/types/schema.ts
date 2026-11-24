export interface DecodeEntry { rawValue: string; label: string; }
export interface ColumnDef {
  name: string; label: string; type: string; length?: number; precision?: number; nullable: boolean;
  alias?: string; isPrimaryKey?: boolean; isForeignKey?: boolean; references?: { table: string; column: string };
  decode?: DecodeEntry[]; description: string;
  /** Legacy FK to a table outside this schema (documentation only). */
  unresolvedReference?: { table: string; column: string };
  /** Legacy decode labels whose raw code was lost by an older version (kept, never used in SQL). */
  unmappedDecodeLabels?: string[];
}
export interface TableDef { name: string; module: string; description: string; columns: ColumnDef[]; objectType?: 'TABLE' | 'VIEW'; }
export interface RelationshipDef { id: string; fromTable: string; fromColumn: string; toTable: string; toColumn: string; kind: 'one-to-many' | 'many-to-one' | 'one-to-one'; }
export interface SchemaMigrationInfo { fromFormat: string; migratedAt: string; migratedBy: string; changes: number; warnings: string[]; }
export interface SchemaModel { id: string; name: string; version: string; status: 'active' | 'default' | 'inactive'; updatedAt: string; lastSyncedAt: string | null; tables: TableDef[]; relationships: RelationshipDef[]; migration?: SchemaMigrationInfo; }
export interface SchemaRegistry { schemas: SchemaModel[]; activeSchemaId: string; activeSchemaUpdatedAt?: string | null; formatVersion?: number; writtenBy?: string; writtenByDevice?: string; writtenAt?: string; }
export interface SchemaEditorRow { rowId: string; module: string; tableName: string; tableDescription: string; columnName: string; columnDescription: string; dataType: string; length: number | null; precision: number | null; nullable: boolean; alias: string; decodeText: string; isPrimaryKey: boolean; isForeignKey: boolean; fkTable: string; fkColumn: string; }
export interface PendingConflict { id: string; schemaId: string; schemaName: string; remoteSchemaJson: string; detectedAt: string; }
export interface SyncLogEntry { id: string; timestamp: string; kind: 'pull' | 'push' | 'error'; message: string; }
