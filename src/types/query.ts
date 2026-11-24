export type Dialect = 'SQL Server' | 'Oracle' | 'PostgreSQL' | 'MySQL' | 'Generic';
export type FilterOperator = '=' | '<>' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'NOT LIKE' | 'IS NULL' | 'IS NOT NULL' | 'IN' | 'NOT IN' | 'BETWEEN';
export interface FilterCondition { id: string; table: string; column: string; operator: FilterOperator; value: string; value2?: string; combinator: 'AND' | 'OR'; }
export type JoinType = 'INNER JOIN' | 'LEFT JOIN' | 'RIGHT JOIN' | 'FULL JOIN';
export type SubqueryKind = 'EXISTS' | 'NOT EXISTS' | 'IN' | 'NOT IN';
/** A read-only sub-select used as an extra WHERE condition (V17.4). `column` is TABLE.COLUMN for IN / NOT IN. */
export interface SubquerySpec { id: string; kind: SubqueryKind; column: string; body: string; }
export interface SortSpec { id: string; table: string; column: string; direction: 'ASC' | 'DESC'; expression?: string; }
/** V17.5: how a schema CASE/DECODE definition is written. DECODE exists in Oracle only (other dialects always get CASE). */
export type DecodeStyle = 'case' | 'decode';
export interface SelectedColumnSpec { id: string; table: string; column: string; alias: string; aggregate?: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | null; useDecode: boolean; manualExpr?: string; displayMode?: 'raw' | 'schema-decode' | 'manual-decode'; decodeStyle?: DecodeStyle; /** V17.5: the last manual CASE/DECODE of this column, kept when the user switches to "From Schema" so switching never loses work. */ manualDraft?: { expr: string; alias: string }; }
export interface CteSpec { id: string; name: string; body: string; }
export interface AdvancedOptions { distinct: boolean; groupByColumns: string[]; havingClause: string; limit: number | null; viewName: string; tableAliases: boolean; joinType: JoinType; recursive: boolean; ctes: CteSpec[]; subqueries?: SubquerySpec[]; }
export interface ReadOnlyQueryState { dialect: Dialect; naturalLanguageText: string; selectedTables: string[]; selectedColumns: SelectedColumnSpec[]; filters: FilterCondition[]; sorts: SortSpec[]; advanced: AdvancedOptions; generatedSql: string; joinPathChoices: Record<string, string>; }
export type CrQueryType = 'INSERT' | 'UPDATE' | 'DELETE';
export interface CrValuePair { id: string; column: string; value: string; }
export interface CrQueryState { dialect: Dialect; naturalLanguageText: string; queryType: CrQueryType; table: string | null; values: CrValuePair[]; filters: FilterCondition[]; confirmNoWhere: boolean; generatedSql: string; }
export interface QueryRequirement { rawText: string; matchedTables: string[]; matchedColumns: SelectedColumnSpec[]; matchedFilters: FilterCondition[]; matchedSorts: SortSpec[]; limit: number | null; distinct: boolean; confidence: number; notes: string[]; unresolvedTerms: string[]; }
export interface ValidationIssue { severity: 'error' | 'warning'; message: string; }
export interface ValidationResult { valid: boolean; issues: ValidationIssue[]; }
export interface SqlSchemaValidationResult { valid: boolean; unknownTables: string[]; unknownColumnRefs: string[]; warnings: string[]; }
