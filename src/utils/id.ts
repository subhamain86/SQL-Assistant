let n = 0;
export function makeId(p = 'id'): string { n += 1; return `${p}_${Date.now().toString(36)}_${n.toString(36)}`; }
