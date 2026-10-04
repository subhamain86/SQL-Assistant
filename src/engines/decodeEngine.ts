import type { ColumnDef } from '../types';
export function decodeLegend(c: ColumnDef): string { return (c.decode || []).map((d) => `${d.rawValue}=${d.label}`).join(', '); }
