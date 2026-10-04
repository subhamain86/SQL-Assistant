export type Dialect = 'SQL Server' | 'Oracle' | 'PostgreSQL' | 'MySQL' | 'Generic';
export type FilterOperator = '=' | '<>' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'NOT LIKE' | 'IS NULL' | 'IS NOT NULL' | 'IN' | 'NOT IN' | 'BETWEEN';
export interface FilterCondition { id: string; table: string; column: string; operator: FilterOperator; value: string; value2?: string; combinator: 'AND' | 'OR'; }
export interface JoinSpec { id: string; table: string; joinType: 'INNER JOIN' | 'LEFT JOIN'; onLeftTable: string; onLeftColumn: string; onRightColumn: string; }
export interface SortSpec { id: string; table: string; column: string; direction: 'ASC' | 'DESC'; /* V17-PATCH:sortspec-expression */ expression?: string; }
export type ColumnDisplayMode = 'raw' | 'schema-decode' | 'manual-decode';
export interface SelectedColumnSpec { id: string; table: string; column: string; alias: string; aggregate?: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | null; useDecode: boolean; manualExpr?: string; displayMode?: ColumnDisplayMode; }
export type CaseWhenClause = { whenExpr: string; thenValue: string };
export interface CaseExpressionSpec { id: string; alias: string; whens: CaseWhenClause[]; elseValue: string; }
export interface DecodeExpressionSpec { id: string; alias: string; sourceExpr: string; pairs: { rawValue: string; label: string }[]; elseValue: string; }
export interface CteSpec { id: string; name: string; body: string; }
export interface AdvancedOptions { distinct: boolean; groupByColumns: string[]; havingClause: string; limit: number | null; recursive: boolean; saveAsView: string | null; caseExpressions: CaseExpressionSpec[]; decodeExpressions: DecodeExpressionSpec[]; ctes: CteSpec[]; }
export interface ReadOnlyQueryState { dialect: Dialect; naturalLanguageText: string; selectedTables: string[]; selectedColumns: SelectedColumnSpec[]; joins: JoinSpec[]; filters: FilterCondition[]; sorts: SortSpec[]; advanced: AdvancedOptions; generatedSql: string; lastGeneratedAt: string | null; joinPathChoices: Record<string, string>; }
export type CrQueryType = 'INSERT' | 'UPDATE' | 'DELETE';
export interface CrValuePair { id: string; column: string; value: string; }
export interface CrQueryState { dialect: Dialect; naturalLanguageText: string; queryType: CrQueryType; table: string | null; values: CrValuePair[]; filters: FilterCondition[]; confirmNoWhere: boolean; generatedSql: string; lastGeneratedAt: string | null; }
export interface ClarificationQuestion { question: string; options: string[]; }
export interface QueryRequirement { rawText: string; matchedTables: string[]; matchedColumns: SelectedColumnSpec[]; matchedFilters: FilterCondition[]; matchedSorts: SortSpec[]; limit: number | null; distinct: boolean; confidence: number; notes: string[]; queryPlan: string[]; clarifications: ClarificationQuestion[]; unresolvedTerms: string[]; }
export interface SQLGenerationResult { sql: string; requirement: QueryRequirement | null; warnings: string[]; ok: boolean; }
export interface ValidationIssue { severity: 'error' | 'warning'; message: string; }
export interface ValidationResult { valid: boolean; issues: ValidationIssue[]; }
export interface RectifyResult { correctedSql: string; explanation: string; whatChanged: string[]; detectedDialect: Dialect | null; }
export interface CrRequirement { rawText: string; queryType: CrQueryType | null; matchedTable: string | null; values: CrValuePair[]; filters: FilterCondition[]; notes: string[]; confidence: number; }
export type NlpEngineSource = 'online' | 'offline' | 'copilot';
export interface NlpOrchestrationResult<T> { result: T; engineUsed: NlpEngineSource; onlineAttempted: boolean; onlineError?: string; }
export interface SqlSchemaValidationResult { valid: boolean; unknownTables: string[]; unknownColumnRefs: string[]; warnings: string[]; }
