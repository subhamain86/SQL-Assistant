import type { Dialect } from '../types';
const RULES: [RegExp, Dialect, string, string][] = [
  [/ORA-00904/i, 'Oracle', 'ORA-00904: a referenced column or alias does not exist in the tables in scope.', 'Check the column name and that its table is in FROM/JOIN.'],
  [/ORA-00942/i, 'Oracle', 'ORA-00942: the table or view does not exist or you lack privileges.', 'Check the table name, schema prefix and SELECT privilege.'],
  [/ORA-00918/i, 'Oracle', 'ORA-00918: a column is ambiguous between joined tables.', 'Qualify the column with its table alias.'],
  [/ORA-00937|ORA-00979/i, 'Oracle', 'Aggregate and non-aggregate columns are mixed without a matching GROUP BY.', 'Add every non-aggregated SELECT column to GROUP BY.'],
  [/ORA-00932|ORA-01722|inconsistent datatypes/i, 'Oracle', 'The branches of a CASE/DECODE (or a comparison) mix text and numbers.', 'Convert the numeric branch with TO_CHAR(...) or compare like with like.'],
  [/ORA-00933/i, 'Oracle', 'ORA-00933: the SQL command is not properly ended (stray text, comma or keyword).', 'Remove trailing commas and text after the statement.'],
  [/Incorrect syntax near/i, 'SQL Server', 'SQL Server syntax error near the reported token.', 'Check commas, parentheses and keywords before the token.'],
  [/Conversion failed/i, 'SQL Server', 'SQL Server could not convert a value between text and number.', 'Use CAST(... AS VARCHAR) in the CASE branch.'],
  [/does not exist/i, 'PostgreSQL', 'PostgreSQL could not find the referenced object.', 'Check spelling, alias and case sensitivity.'],
  [/Unknown column/i, 'MySQL', 'MySQL could not find the column in the tables in scope.', 'Check the column and that its table is joined.']];
export function rectify(err: string, sql: string): { correctedSql: string; explanation: string; whatChanged: string[]; dialect: Dialect | null } {
  let fixed = sql.replace(/,\s*(FROM|WHERE|GROUP BY|ORDER BY|HAVING)\b/gi, ' $1'); const ch: string[] = []; if (fixed !== sql) ch.push('Removed a trailing comma before a clause keyword.');
  if (/ORA-00932|ORA-01722|inconsistent datatypes|Conversion failed/i.test(err)) { const n = fixed.replace(/\bELSE\s+([A-Za-z_][\w.]*)\s+END\b/gi, (_m, c) => `ELSE TO_CHAR(${c}) END`); if (n !== fixed) { fixed = n; ch.push('Converted the ELSE branch of CASE to text (TO_CHAR) so every branch returns the same type.'); } }
  const r = RULES.find(([re]) => re.test(err));
  return { correctedSql: fixed, explanation: r ? r[2] : 'The error did not match a known pattern. Check names, GROUP BY, ambiguous columns and quotes/parentheses.', whatChanged: ch.length ? ch : [r ? r[3] : 'No automatic change applied.'], dialect: r ? r[1] : null };
}
