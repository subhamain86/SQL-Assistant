import type { Dialect } from '../../types';
export type DateUnit = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
export function todayExpr(d: Dialect): string { switch (d) { case 'Oracle': return 'TRUNC(SYSDATE)'; case 'SQL Server': return 'CAST(GETDATE() AS DATE)'; case 'MySQL': return 'CURDATE()'; default: return 'CURRENT_DATE'; } }
export function agoExpr(n: number, unit: DateUnit, d: Dialect): string {
  const amount = Math.max(0, Math.floor(n));
  switch (d) {
    case 'Oracle': return unit === 'DAY' ? `TRUNC(SYSDATE) - ${amount}` : unit === 'WEEK' ? `TRUNC(SYSDATE) - ${amount * 7}` : `ADD_MONTHS(TRUNC(SYSDATE), -${unit === 'YEAR' ? amount * 12 : amount})`;
    case 'SQL Server': return `DATEADD(${unit}, -${amount}, CAST(GETDATE() AS DATE))`;
    case 'MySQL': return `DATE_SUB(CURDATE(), INTERVAL ${amount} ${unit})`;
    default: return `CURRENT_DATE - INTERVAL '${amount} ${unit}'`;
  }
}
export function startOfExpr(unit: Exclude<DateUnit, 'DAY'>, back: number, d: Dialect): string {
  const b = Math.max(0, Math.floor(back));
  switch (d) {
    case 'Oracle': { const fmt = unit === 'WEEK' ? 'IW' : unit === 'MONTH' ? 'MM' : 'YYYY'; const base = `TRUNC(SYSDATE, '${fmt}')`; if (!b) return base; return unit === 'WEEK' ? `${base} - ${b * 7}` : `ADD_MONTHS(${base}, -${unit === 'YEAR' ? b * 12 : b})`; }
    case 'SQL Server': { const base = unit === 'WEEK' ? 'DATEADD(WEEK, DATEDIFF(WEEK, 0, GETDATE()), 0)' : unit === 'MONTH' ? 'DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)' : 'DATEFROMPARTS(YEAR(GETDATE()), 1, 1)'; return b ? `DATEADD(${unit}, -${b}, ${base})` : base; }
    case 'MySQL': { const base = unit === 'WEEK' ? 'DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)' : unit === 'MONTH' ? "DATE_FORMAT(CURDATE(), '%Y-%m-01')" : 'MAKEDATE(YEAR(CURDATE()), 1)'; return b ? `DATE_SUB(${base}, INTERVAL ${b} ${unit})` : base; }
    default: { const base = `DATE_TRUNC('${unit}', CURRENT_DATE)`; return b ? `${base} - INTERVAL '${b} ${unit}'` : base; }
  }
}
export function nextDayExpr(d: Dialect): string { return d === 'Oracle' ? 'TRUNC(SYSDATE) + 1' : d === 'SQL Server' ? 'DATEADD(DAY, 1, CAST(GETDATE() AS DATE))' : d === 'MySQL' ? 'DATE_ADD(CURDATE(), INTERVAL 1 DAY)' : "CURRENT_DATE + INTERVAL '1 DAY'"; }
export function dateLiteral(iso: string, d: Dialect): string { return d === 'SQL Server' ? `CAST('${iso}' AS DATE)` : `DATE '${iso}'`; }
export function monthBucketExpr(col: string, d: Dialect): string { switch (d) { case 'MySQL': return `DATE_FORMAT(${col}, '%Y-%m')`; case 'SQL Server': return `FORMAT(${col}, 'yyyy-MM')`; default: return `TO_CHAR(${col}, 'YYYY-MM')`; } }
export function yearBucketExpr(col: string, d: Dialect): string { return d === 'SQL Server' ? `YEAR(${col})` : `EXTRACT(YEAR FROM ${col})`; }
const N = '\\d{1,5}'; const U = '(DAY|WEEK|MONTH|YEAR)';
const SAFE_PATTERNS: RegExp[] = [
  /^CURRENT_DATE$/, /^TRUNC\(SYSDATE\)$/, /^CAST\(GETDATE\(\) AS DATE\)$/, /^CURDATE\(\)$/,
  new RegExp(`^TRUNC\\(SYSDATE\\) - ${N}$`), new RegExp(`^ADD_MONTHS\\(TRUNC\\(SYSDATE\\), -${N}\\)$`),
  new RegExp(`^DATEADD\\(${U}, -${N}, CAST\\(GETDATE\\(\\) AS DATE\\)\\)$`), new RegExp(`^DATE_SUB\\(CURDATE\\(\\), INTERVAL ${N} ${U}\\)$`),
  new RegExp(`^CURRENT_DATE - INTERVAL '${N} ${U}'$`),
  new RegExp(`^TRUNC\\(SYSDATE, '(IW|MM|YYYY)'\\)( - ${N})?$`), new RegExp(`^ADD_MONTHS\\(TRUNC\\(SYSDATE, '(IW|MM|YYYY)'\\), -${N}\\)$`),
  /^DATEADD\(WEEK, DATEDIFF\(WEEK, 0, GETDATE\(\)\), 0\)$/, /^DATEFROMPARTS\(YEAR\(GETDATE\(\)\), MONTH\(GETDATE\(\)\), 1\)$/, /^DATEFROMPARTS\(YEAR\(GETDATE\(\)\), 1, 1\)$/,
  new RegExp(`^DATEADD\\(${U}, -${N}, (DATEADD\\(WEEK, DATEDIFF\\(WEEK, 0, GETDATE\\(\\)\\), 0\\)|DATEFROMPARTS\\(YEAR\\(GETDATE\\(\\)\\), MONTH\\(GETDATE\\(\\)\\), 1\\)|DATEFROMPARTS\\(YEAR\\(GETDATE\\(\\)\\), 1, 1\\))\\)$`),
  /^DATE_SUB\(CURDATE\(\), INTERVAL WEEKDAY\(CURDATE\(\)\) DAY\)$/, /^DATE_FORMAT\(CURDATE\(\), '%Y-%m-01'\)$/, /^MAKEDATE\(YEAR\(CURDATE\(\)\), 1\)$/,
  new RegExp(`^DATE_SUB\\((DATE_SUB\\(CURDATE\\(\\), INTERVAL WEEKDAY\\(CURDATE\\(\\)\\) DAY\\)|DATE_FORMAT\\(CURDATE\\(\\), '%Y-%m-01'\\)|MAKEDATE\\(YEAR\\(CURDATE\\(\\)\\), 1\\)), INTERVAL ${N} ${U}\\)$`),
  new RegExp(`^DATE_TRUNC\\('${U}', CURRENT_DATE\\)( - INTERVAL '${N} ${U}')?$`),
  /^TRUNC\(SYSDATE\) \+ 1$/, /^DATEADD\(DAY, 1, CAST\(GETDATE\(\) AS DATE\)\)$/, /^DATE_ADD\(CURDATE\(\), INTERVAL 1 DAY\)$/, /^CURRENT_DATE \+ INTERVAL '1 DAY'$/,
  /^DATE '\d{4}-\d{2}-\d{2}'$/, /^CAST\('\d{4}-\d{2}-\d{2}' AS DATE\)$/
];
export function isSafeDateExpression(value: string): boolean { const v = value.trim(); return v.length < 160 && SAFE_PATTERNS.some((re) => re.test(v)); }
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }
function validYmd(y: number, m: number, d: number): boolean { if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false; return d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); }
export interface ParsedDate { iso: string; ambiguous: boolean; }
export function parseDateToken(raw: string): ParsedDate | null {
  const s = raw.trim().toLowerCase().replace(/,/g, '');
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) { const y = +m[1], mo = +m[2], d = +m[3]; return validYmd(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}`, ambiguous: false } : null; }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) { let d = +m[1], mo = +m[2]; const y = +m[3]; let ambiguous = d <= 12 && mo <= 12 && d !== mo; if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; ambiguous = false; } return validYmd(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}`, ambiguous } : null; }
  m = s.match(/^(\d{1,2})\s+([a-z]{3,9})\s+(\d{4})$/);
  if (m) { const mo = MONTHS.findIndex((x) => x.startsWith(m![2].slice(0, 3))) + 1; const y = +m[3], d = +m[1]; return mo > 0 && validYmd(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}`, ambiguous: false } : null; }
  m = s.match(/^([a-z]{3,9})\s+(\d{1,2})\s+(\d{4})$/);
  if (m) { const mo = MONTHS.findIndex((x) => x.startsWith(m![1].slice(0, 3))) + 1; const y = +m[3], d = +m[2]; return mo > 0 && validYmd(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}`, ambiguous: false } : null; }
  return null;
}
export function monthIndex(word: string): number { const w = word.toLowerCase(); if (w.length < 3) return -1; return MONTHS.findIndex((x) => x.startsWith(w.slice(0, 3)) && w.length <= x.length && x.startsWith(w)); }
export function monthRange(year: number, month1: number): { from: string; to: string } { const ny = month1 === 12 ? year + 1 : year; const nm = month1 === 12 ? 1 : month1 + 1; return { from: `${year}-${pad(month1)}-01`, to: `${ny}-${pad(nm)}-01` }; }
export const DATE_TOKEN_RE = String.raw`(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})`;
