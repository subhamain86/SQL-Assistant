/**
 * V17.0 — Settings → AI / LLM Model (replaces "Online AI/NLP Endpoint").
 *
 * Optional, additional intelligence layer. The offline NLU stays primary and
 * the application remains fully usable with no model configured, when the
 * model is disabled, unreachable, slow or returns something invalid.
 * Non-secret settings live in localStorage; the API key lives ONLY in the
 * encrypted Secret Vault (never in localStorage, logs, the UI or errors).
 * Any SQL a model returns is accepted only if it passes the existing read-only
 * safety validator AND the Active Schema validator.
 */
import { makeError, redactSecrets, type AppError } from '../errors/appErrors';

export type LlmProvider = 'openai-compatible' | 'azure-openai' | 'anthropic' | 'custom-endpoint';
export const LLM_PROVIDERS: { id: LlmProvider; label: string; needsModel: boolean; needsKey: boolean }[] = [
  { id: 'openai-compatible', label: 'OpenAI-compatible (Chat Completions API)', needsModel: true, needsKey: true },
  { id: 'azure-openai', label: 'Azure OpenAI', needsModel: false, needsKey: true },
  { id: 'anthropic', label: 'Anthropic (Messages API)', needsModel: true, needsKey: true },
  { id: 'custom-endpoint', label: 'Custom endpoint (V16 Online AI/NLP contract)', needsModel: false, needsKey: false }
];
export interface LlmModelConfig {
  enabled: boolean; provider: LlmProvider; endpoint: string; model: string; deployment: string; apiVersion: string;
  temperature: number; maxTokens: number; timeoutMs: number; useWhen: 'always' | 'low-confidence'; migratedFromV16?: boolean;
}
export const LLM_CONFIG_KEY = 'sqla.llmconfig.v17';
export function defaultLlmConfig(): LlmModelConfig { return { enabled: false, provider: 'openai-compatible', endpoint: '', model: '', deployment: '', apiVersion: '', temperature: 0, maxTokens: 800, timeoutMs: 15000, useWhen: 'always' }; }

export function normalizeLlmConfig(raw: unknown): LlmModelConfig {
  const d = defaultLlmConfig(); const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<LlmModelConfig>;
  const num = (v: unknown, def: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
  return { enabled: !!r.enabled, provider: LLM_PROVIDERS.some((p) => p.id === r.provider) ? r.provider! : d.provider, endpoint: typeof r.endpoint === 'string' ? r.endpoint.trim() : '', model: typeof r.model === 'string' ? r.model.trim() : '', deployment: typeof r.deployment === 'string' ? r.deployment.trim() : '', apiVersion: typeof r.apiVersion === 'string' ? r.apiVersion.trim() : '', temperature: num(r.temperature, 0, 0, 1), maxTokens: Math.round(num(r.maxTokens, 800, 64, 8000)), timeoutMs: Math.round(num(r.timeoutMs, 15000, 2000, 120000)), useWhen: r.useWhen === 'low-confidence' ? 'low-confidence' : 'always', migratedFromV16: !!r.migratedFromV16 };
}
export interface KeyValueStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; }
export function loadLlmConfig(storage: KeyValueStorage): LlmModelConfig { try { const raw = storage.getItem(LLM_CONFIG_KEY); return raw ? normalizeLlmConfig(JSON.parse(raw)) : defaultLlmConfig(); } catch { return defaultLlmConfig(); } }
export function saveLlmConfig(storage: KeyValueStorage, cfg: LlmModelConfig): void { const safe = normalizeLlmConfig(cfg); storage.setItem(LLM_CONFIG_KEY, JSON.stringify(safe)); }
/** One-time migration of the V16 "Online AI/NLP Endpoint" into an AI / LLM Model configuration. */
export function migrateFromV16Endpoint(storage: KeyValueStorage, v16Endpoint: string | null | undefined): { migrated: boolean; config: LlmModelConfig } {
  if (storage.getItem(LLM_CONFIG_KEY)) return { migrated: false, config: loadLlmConfig(storage) };
  const ep = (v16Endpoint || '').trim();
  const cfg: LlmModelConfig = ep ? { ...defaultLlmConfig(), enabled: true, provider: 'custom-endpoint', endpoint: ep, migratedFromV16: true } : defaultLlmConfig();
  saveLlmConfig(storage, cfg); return { migrated: !!ep, config: cfg };
}

export function validateLlmConfig(cfg: LlmModelConfig, hasApiKey: boolean): string[] {
  const issues: string[] = []; const p = LLM_PROVIDERS.find((x) => x.id === cfg.provider);
  if (!p) { issues.push('Choose a supported provider.'); return issues; }
  if (!cfg.endpoint) issues.push('Endpoint URL is required.');
  else { let u: URL | null = null; try { u = new URL(cfg.endpoint); } catch { issues.push('Endpoint URL is not a valid URL.'); }
    if (u && u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))) issues.push('Endpoint must use HTTPS (plain HTTP is only allowed for localhost).');
    if (u && (u.username || u.password)) issues.push('Do not put credentials in the endpoint URL — use the API key field (stored encrypted in the Secret Vault).');
    if (u && /[?&](api[-_]?key|key|token|access_token)=/i.test(u.search)) issues.push('Do not put an API key in the endpoint URL — use the API key field (stored encrypted in the Secret Vault).'); }
  if (p.needsModel && !cfg.model) issues.push('Model name is required for this provider.');
  if (cfg.provider === 'azure-openai') { if (!cfg.deployment) issues.push('Azure OpenAI requires the deployment name.'); if (!cfg.apiVersion) issues.push('Azure OpenAI requires the api-version.'); }
  if (p.needsKey && !hasApiKey) issues.push('An API key is required for this provider (stored encrypted in the Secret Vault).');
  return issues;
}

export interface LlmPrompt { system: string; user: string; }
export interface LlmSuggestion { sql?: string; tables?: string[]; columns?: { table: string; column: string }[]; explanation?: string; }

export function buildLlmPrompt(args: { request: string; schemaContext: string; offlineSql: string; dialect: string; examples: { request: string; sql: string }[] }): LlmPrompt {
  const system = [
    'You convert a business request into ONE read-only SQL SELECT (or WITH ... SELECT) statement.',
    `Target SQL dialect: ${args.dialect}.`,
    'Use ONLY the tables, columns and relationships listed in the schema. Never invent identifiers. Qualify every column as TABLE.COLUMN.',
    'Never produce INSERT, UPDATE, DELETE, MERGE, DDL, GRANT or multiple statements.',
    'If the schema does not contain what is needed, return sql as an empty string and explain what is missing.',
    'Respond with JSON only: {"sql": string, "tables": string[], "columns": [{"table": string, "column": string}], "explanation": string}.'
  ].join('\n');
  const ex = args.examples.slice(0, 2).map((e, i) => `Example ${i + 1} (confirmed by the user):\nRequest: ${e.request}\nSQL: ${e.sql}`).join('\n\n');
  const user = `ACTIVE SCHEMA:\n${args.schemaContext}\n\n${ex ? `${ex}\n\n` : ''}OFFLINE ENGINE DRAFT (may be incomplete):\n${args.offlineSql}\n\nREQUEST:\n${args.request}`;
  return { system, user };
}

export function buildLlmRequest(cfg: LlmModelConfig, apiKey: string | null, prompt: LlmPrompt, schemaContext: string): { url: string; init: RequestInit } {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const base = cfg.endpoint.replace(/\/+$/, '');
  switch (cfg.provider) {
    case 'azure-openai': {
      if (apiKey) headers['api-key'] = apiKey;
      const url = /\/chat\/completions/.test(base) ? base : `${base}/openai/deployments/${encodeURIComponent(cfg.deployment)}/chat/completions?api-version=${encodeURIComponent(cfg.apiVersion)}`;
      return { url, init: { method: 'POST', headers, body: JSON.stringify({ messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }], temperature: cfg.temperature, max_tokens: cfg.maxTokens }) } };
    }
    case 'anthropic': {
      if (apiKey) headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01'; headers['anthropic-dangerous-direct-browser-access'] = 'true';
      const url = /\/v1\/messages$/.test(base) ? base : `${base}/v1/messages`;
      return { url, init: { method: 'POST', headers, body: JSON.stringify({ model: cfg.model, max_tokens: cfg.maxTokens, temperature: cfg.temperature, system: prompt.system, messages: [{ role: 'user', content: prompt.user }] }) } };
    }
    case 'custom-endpoint': {
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      return { url: base, init: { method: 'POST', headers, body: JSON.stringify({ prompt: prompt.user.split('REQUEST:\n').pop(), schemaContext, instructions: prompt.system }) } };
    }
    default: {
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const url = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
      return { url, init: { method: 'POST', headers, body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }], temperature: cfg.temperature, max_tokens: cfg.maxTokens }) } };
    }
  }
}

function extractJsonObject(text: string): unknown { const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, ''); try { return JSON.parse(t); } catch { const i = t.indexOf('{'); const j = t.lastIndexOf('}'); if (i >= 0 && j > i) { try { return JSON.parse(t.slice(i, j + 1)); } catch { /* fall through */ } } } const sql = t.match(/(?:^|\n)\s*((?:WITH|SELECT)\b[\s\S]+?;?)\s*$/i); return sql ? { sql: sql[1] } : null; }
export function parseLlmResponse(provider: LlmProvider, json: unknown): LlmSuggestion | null {
  const j = json as Record<string, any>;
  let payload: unknown = null;
  if (provider === 'anthropic') { const text = Array.isArray(j?.content) ? j.content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('\n') : ''; payload = text ? extractJsonObject(text) : null; }
  else if (provider === 'custom-endpoint') payload = j && (j.sql !== undefined || j.tables !== undefined || j.columns !== undefined) ? j : (typeof j?.text === 'string' ? extractJsonObject(j.text) : null);
  else { const text = j?.choices?.[0]?.message?.content; payload = typeof text === 'string' ? extractJsonObject(text) : null; }
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  return { sql: typeof p.sql === 'string' ? p.sql.trim() : undefined, tables: Array.isArray(p.tables) ? p.tables.filter((x): x is string => typeof x === 'string') : undefined, columns: Array.isArray(p.columns) ? (p.columns as unknown[]).filter((c): c is { table: string; column: string } => !!c && typeof (c as any).table === 'string' && typeof (c as any).column === 'string') : undefined, explanation: typeof p.explanation === 'string' ? p.explanation.slice(0, 600) : undefined };
}

export async function callLlm(cfg: LlmModelConfig, apiKey: string | null, prompt: LlmPrompt, schemaContext: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; suggestion: LlmSuggestion } | { ok: false; error: AppError }> {
  const secrets = [apiKey];
  const issues = validateLlmConfig(cfg, !!apiKey);
  if (issues.length) return { ok: false, error: makeError('AI_LLM_CONFIG_INVALID', 'The AI / LLM Model configuration is incomplete or invalid.', issues, secrets) };
  const { url, init } = buildLlmRequest(cfg, apiKey, prompt, schemaContext);
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  let res: Response;
  try { res = await fetchImpl(url, { ...init, signal: ctrl.signal }); }
  catch (e) { clearTimeout(timer); const aborted = (e as Error)?.name === 'AbortError'; return { ok: false, error: makeError('AI_LLM_REQUEST_FAILED', aborted ? `The AI / LLM Model did not respond within ${Math.round(cfg.timeoutMs / 1000)} s — the offline engine result is used.` : 'The AI / LLM endpoint could not be reached (network error, firewall, or the endpoint does not allow browser/CORS requests) — the offline engine result is used.', undefined, secrets) }; }
  clearTimeout(timer);
  if (!res.ok) {
    let detail = ''; try { const body = await res.json(); detail = String(body?.error?.message || body?.message || '').slice(0, 200); } catch { /* ignore */ }
    const reason = res.status === 401 || res.status === 403 ? 'the API key was rejected (check the key and its permissions)' : res.status === 404 ? 'the endpoint, model or deployment name was not found' : res.status === 429 ? 'the provider rate limit or quota was exceeded' : res.status >= 500 ? 'the provider reported a server error' : 'the request was rejected';
    return { ok: false, error: makeError('AI_LLM_REQUEST_FAILED', `AI / LLM request failed with HTTP ${res.status}: ${reason}${detail ? ` (${redactSecrets(detail, secrets)})` : ''}. The offline engine result is used.`, undefined, secrets) };
  }
  let json: unknown; try { json = await res.json(); } catch { return { ok: false, error: makeError('AI_LLM_REQUEST_FAILED', 'The AI / LLM Model returned a response that is not JSON. The offline engine result is used.') }; }
  const suggestion = parseLlmResponse(cfg.provider, json);
  if (!suggestion) return { ok: false, error: makeError('AI_LLM_REQUEST_FAILED', 'The AI / LLM Model response did not contain a usable SQL/JSON answer. The offline engine result is used.') };
  return { ok: true, suggestion };
}
