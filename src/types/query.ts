export type Dialect = 'SQL Server' | 'Oracle' | 'PostgreSQL' | 'MySQL' | 'Generic';
export type FilterOperator = '=' | '<>' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'NOT LIKE' | 'IS NULL' | 'IS NOT NULL' | 'IN' | 'NOT IN' | 'BETWEEN';
export interface FilterCondition { id: string; table: string; column: string; operator: FilterOperator; value: string; value2?: string; combinator: 'AND' | 'OR'; }
export type JoinType = 'INNER JOIN' | 'LEFT JOIN';
export interface SortSpec { id: string; table: string; column: string; direction: 'ASC' | 'DESC'; expression?: string; }
export interface SelectedColumnSpec { id: string; table: string; column: string; alias: string; aggregate?: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | null; useDecode: boolean; manualExpr?: string; displayMode?: 'raw' | 'schema-decode' | 'manual-decode'; }
export interface CteSpec { id: string; name: string; body: string; }
export interface AdvancedOptions { distinct: boolean; groupByColumns: string[]; havingClause: string; limit: number | null; viewName: string; tableAliases: boolean; joinType: JoinType; recursive: boolean; ctes: CteSpec[]; }
export interface ReadOnlyQueryState { dialect: Dialect; naturalLanguageText: string; selectedTables: string[]; selectedColumns: SelectedColumnSpec[]; filters: FilterCondition[]; sorts: SortSpec[]; advanced: AdvancedOptions; generatedSql: string; joinPathChoices: Record<string, string>; }
export type CrQueryType = 'INSERT' | 'UPDATE' | 'DELETE';
export interface CrValuePair { id: string; column: string; value: string; }
export interface CrQueryState { dialect: Dialect; naturalLanguageText: string; queryType: CrQueryType; table: string | null; values: CrValuePair[]; filters: FilterCondition[]; confirmNoWhere: boolean; generatedSql: string; }
export interface QueryRequirement { rawText: string; matchedTables: string[]; matchedColumns: SelectedColumnSpec[]; matchedFilters: FilterCondition[]; matchedSorts: SortSpec[]; limit: number | null; distinct: boolean; confidence: number; notes: string[]; unresolvedTerms: string[]; }
export interface ValidationIssue { severity: 'error' | 'warning'; message: string; }
export interface ValidationResult { valid: boolean; issues: ValidationIssue[]; }
export interface SqlSchemaValidationResult { valid: boolean; unknownTables: string[]; unknownColumnRefs: string[]; warnings: string[]; }
