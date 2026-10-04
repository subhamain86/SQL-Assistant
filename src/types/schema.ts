export type ColumnDataType = 'VARCHAR' | 'NUMBER' | 'DATE' | 'FLAG' | 'TIMESTAMP';
export const VALID_DATA_TYPES: ColumnDataType[] = ['VARCHAR', 'NUMBER', 'DATE', 'FLAG', 'TIMESTAMP'];
export interface DecodeEntry { rawValue: string; label: string; }
export interface ColumnDef {
  name: string; label: string; type: string; length?: number; precision?: number; nullable: boolean;
  alias?: string; isPrimaryKey?: boolean; isForeignKey?: boolean; references?: { table: string; column: string };
  decode?: DecodeEntry[]; description: string;
  unresolvedReference?: { table: string; column: string };
  unmappedDecodeLabels?: string[];
}
export interface TableDef { name: string; module: string; description: string; columns: ColumnDef[]; objectType?: 'TABLE' | 'VIEW'; }
export interface RelationshipDef { id: string; fromTable: string; fromColumn: string; toTable: string; toColumn: string; kind: 'one-to-many' | 'many-to-one' | 'one-to-one'; }
export type SchemaStatus = 'active' | 'default' | 'inactive';
export interface SchemaMigrationInfo { fromFormat: string; migratedAt: string; migratedBy: string; changes: number; warnings: string[]; }
export interface SchemaModel { id: string; name: string; version: string; status: SchemaStatus; updatedAt: string; lastSyncedAt: string | null; tables: TableDef[]; relationships: RelationshipDef[]; migration?: SchemaMigrationInfo; }
export interface SchemaRegistry { schemas: SchemaModel[]; activeSchemaId: string; activeSchemaUpdatedAt?: string | null; formatVersion?: number; writtenBy?: string; writtenByDevice?: string; writtenAt?: string; }
export interface SchemaEditorRow { rowId: string; module: string; tableName: string; tableDescription: string; columnName: string; columnDescription: string; dataType: ColumnDataType; length: number | null; precision: number | null; nullable: boolean; alias: string; decodeText: string; isPrimaryKey: boolean; isForeignKey: boolean; fkTable: string; fkColumn: string; }
