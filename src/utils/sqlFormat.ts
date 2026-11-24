/**
 * V17.7.2 — readable layout for a SQL statement (Result card of "Describe What You Need").
 * WHITESPACE ONLY: every character that is not a space, tab or line break stays, in the same order — keywords are NOT re-cased, names are not changed, string literals ('…', "…"),
 * quoted identifiers and comments (-- …, /* … *​/) are copied untouched. The function therefore can never change what a statement means; tests/v1772 checks the property on every sample.
 * Layout: a new line for each top-level clause (WITH, SELECT, FROM, JOIN, WHERE, GROUP BY, HAVING, ORDER BY, UNION …, FETCH / LIMIT / OFFSET), select items and AND / OR conditions on their own indented lines.
 */
type Tok = { t: 'ws' | 'str' | 'cmt' | 'word' | 'sym'; v: string };
function lex(sql: string): Tok[] {
  const o: Tok[] = []; let i = 0; const n = sql.length;
  while (i < n) {
    const c = sql[i]; const two = sql.slice(i, i + 2);
    if (/\s/.test(c)) { let j = i + 1; while (j < n && /\s/.test(sql[j])) j++; o.push({ t: 'ws', v: sql.slice(i, j) }); i = j; }
    else if (two === '--') { let j = i; while (j < n && sql[j] !== '\n') j++; o.push({ t: 'cmt', v: sql.slice(i, j) }); i = j; }
    else if (two === '/*') { const e = sql.indexOf('*/', i + 2); const j = e < 0 ? n : e + 2; o.push({ t: 'cmt', v: sql.slice(i, j) }); i = j; }
    else if (c === "'" || c === '"' || c === '`') { let j = i + 1; while (j < n) { if (sql[j] === c) { if (sql[j + 1] === c) { j += 2; continue; } j++; break; } j++; } o.push({ t: 'str', v: sql.slice(i, j) }); i = j; }
    else if (/[A-Za-z0-9_$#@]/.test(c)) { let j = i + 1; while (j < n && /[A-Za-z0-9_$#@.]/.test(sql[j])) j++; o.push({ t: 'word', v: sql.slice(i, j) }); i = j; }
    else { o.push({ t: 'sym', v: c }); i++; }
  }
  return o;
}
const CLAUSE = /^(WITH|SELECT|FROM|WHERE|HAVING|UNION|INTERSECT|EXCEPT|MINUS|FETCH|LIMIT|OFFSET)$/;
const JOINW = /^(INNER|LEFT|RIGHT|FULL|CROSS|NATURAL|JOIN)$/;
export function formatSql(sql: string): string {
  const src = String(sql ?? ''); if (!src.trim()) return src;
  const sig = lex(src); const out: string[] = []; let depth = 0; let ind = 0; let line = ''; let clause = ''; let between = false; let space = false; let prev = ''; let prevWasJoinWord = false;
  const flush = () => { if (line.trim()) out.push(`${'  '.repeat(ind)}${line.trim()}`); line = ''; };
  const start = (cl: string, text: string, i = 0) => { flush(); ind = i; clause = cl; line = text; };
  for (let k = 0; k < sig.length; k++) {
    const tk = sig[k]; if (tk.t === 'ws') { space = true; continue; } const up = tk.t === 'word' ? tk.v.toUpperCase() : '';
    const nextUp = (() => { for (let j = k + 1; j < sig.length; j++) if (sig[j].t !== 'ws') return sig[j].t === 'word' ? sig[j].v.toUpperCase() : ''; return ''; })();
    if (tk.t === 'cmt' && tk.v.startsWith('--')) { line += `${line && space ? ' ' : ''}${tk.v}`; flush(); space = false; continue; }
    if (depth === 0) {
      if (CLAUSE.test(up) && !(up === 'FROM' && prev === 'DELETE') && !(up === 'WITH' && prev !== '' && prev !== ';')) { start(up, tk.v); prev = up; space = false; prevWasJoinWord = false; if (up === 'SELECT') { flush(); ind = 1; } continue; }
      if ((up === 'ORDER' || up === 'GROUP') && nextUp === 'BY') { start(up, tk.v); prev = up; space = false; continue; }
      if (JOINW.test(up) && !prevWasJoinWord && !(prev === 'ON')) { start('JOIN', tk.v); prevWasJoinWord = true; prev = up; space = false; continue; }
      if (JOINW.test(up) || up === 'OUTER') { prevWasJoinWord = up !== 'JOIN'; }
      else prevWasJoinWord = false;
      if (up === 'BETWEEN') between = true;
      else if (up === 'AND' && between) between = false;
      else if ((up === 'AND' || up === 'OR') && (clause === 'WHERE' || clause === 'HAVING' || clause === 'JOIN')) { flush(); ind = 1; line = tk.v; prev = up; space = false; continue; }
      if (tk.t === 'sym' && tk.v === ',' && clause === 'SELECT') { line += ','; flush(); ind = 1; space = false; prev = ','; continue; }
    }
    if (tk.t === 'sym' && tk.v === '(') depth++; else if (tk.t === 'sym' && tk.v === ')') depth = Math.max(0, depth - 1);
    line += `${line && space ? ' ' : ''}${tk.v}`; space = false; prev = up || tk.v;
  }
  flush(); return out.join('\n');
}
