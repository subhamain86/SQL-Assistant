/** M365 Copilot Enterprise adapter (unchanged V16 behaviour; responses are schema-filtered before use). */
import type { M365CopilotConfig } from './secretVaultService';
import { acquireCopilotToken } from './msalAuthService';
import type { OnlineNlpResponse } from './onlineNlpService';
const TIMEOUT_MS = 8000;
export function isCopilotConfigured(c: M365CopilotConfig | null | undefined): boolean { return !!c && c.enabled && !!c.tenantId && !!c.clientId && !!c.agentEndpoint && !!c.scope; }
export async function tryM365Copilot(config: M365CopilotConfig, prompt: string, ctx: string): Promise<OnlineNlpResponse | null> {
  if (!isCopilotConfigured(config) || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
  let token: string; try { token = await acquireCopilotToken(config); } catch { return null; }
  const c = new AbortController(); const t = setTimeout(() => c.abort(), TIMEOUT_MS);
  try { const res = await fetch(config.agentEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ prompt, schemaContext: ctx }), signal: c.signal }); if (!res.ok) return null; return (await res.json()) as OnlineNlpResponse; }
  catch { return null; } finally { clearTimeout(t); }
}
export function buildMinimalSchemaContext(promptText: string, schema: { tables: { name: string; module: string; description: string; columns: { name: string; type: string }[] }[]; relationships: { fromTable: string; fromColumn: string; toTable: string; toColumn: string }[] }): string {
  const words = new Set((promptText.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2));
  const overlap = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((x) => words.has(x)).length;
  const scored = schema.tables.map((t) => ({ t, s: overlap(`${t.name} ${t.module} ${t.description}`) })).sort((a, b) => b.s - a.s);
  const chosen = scored.filter((x) => x.s > 0).slice(0, 6).map((x) => x.t); const use = chosen.length ? chosen : schema.tables.slice(0, 3);
  const names = new Set(use.map((t) => t.name)); const parts = use.map((t) => `TABLE ${t.name} (${t.module}) — ${t.description} — columns: ${t.columns.map((c) => `${c.name}:${c.type}`).join(', ')}`);
  const rels = schema.relationships.filter((r) => names.has(r.fromTable) && names.has(r.toTable)); if (rels.length) parts.push(`RELATIONSHIPS: ${rels.map((r) => `${r.fromTable}.${r.fromColumn}->${r.toTable}.${r.toColumn}`).join('; ')}`);
  return parts.join('\n');
}
