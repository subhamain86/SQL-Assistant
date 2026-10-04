/**
 * Settings → AI/LLM Model (renamed from "Online AI/NLP Endpoint"). OPTIONAL.
 * The offline NLU stays the primary/default engine; the online model is only consulted when it is
 * enabled AND the offline result has low confidence. Its SQL must pass read-only + Active Schema
 * validation or it is rejected. Any failure falls back to the offline result.
 */
import { KEYS, browserStore, readJson, writeJson, type KeyValueStore } from '../../services/storage';
import { redactSecrets, makeError, type AppError } from '../errors/appErrors';
export type AiProvider = 'openai' | 'azure-openai' | 'anthropic' | 'custom';
export type AiAuth = 'bearer' | 'api-key-header' | 'none';
export interface AiLlmConfig { enabled: boolean; provider: AiProvider; model: string; endpoint: string; authType: AiAuth; apiVersion: string; temperature: number; maxTokens: number; timeoutMs: number; extraJson: string; }
export const DEFAULT_AI_CONFIG: AiLlmConfig = { enabled: false, provider: 'openai', model: '', endpoint: '', authType: 'bearer', apiVersion: '', temperature: 0, maxTokens: 800, timeoutMs: 20000, extraJson: '' };
export const PROVIDER_DEFAULTS: Record<AiProvider, { endpoint: string; authType: AiAuth }> = {
  openai: { endpoint: 'https://api.openai.com/v1/chat/completions', authType: 'bearer' },
  'azure-openai': { endpoint: 'https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions', authType: 'api-key-header' },
  anthropic: { endpoint: 'https://api.anthropic.com/v1/messages', authType: 'api-key-header' },
  custom: { endpoint: '', authType: 'bearer' }
};
export function loadAiConfig(store: KeyValueStore = browserStore): AiLlmConfig {
  const legacy = readJson<Record<string, unknown> | null>(store, 'sqla.onlineNlp.v15', null); // migrate old "Online AI/NLP Endpoint" settings
  const cfg = readJson<Partial<AiLlmConfig> | null>(store, KEYS.aiConfig, null);
  return { ...DEFAULT_AI_CONFIG, ...(legacy && !cfg ? { enabled: !!legacy.enabled, endpoint: String(legacy.endpoint || ''), provider: 'custom' as AiProvider } : {}), ...(cfg || {}) };
}
export function validateAiConfig(c: AiLlmConfig, apiKey: string): string[] {
  const p: string[] = []; if (!c.enabled) return p;
  if (!c.model.trim()) p.push('Model is required.');
  if (!/^https:\/\//i.test(c.endpoint.trim()) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(c.endpoint.trim())) p.push('Endpoint must be an https:// URL (or http://localhost for a local model).');
  if (/\{(resource|deployment)\}/.test(c.endpoint)) p.push('Replace {resource}/{deployment} in the endpoint.');
  if (c.authType !== 'none' && !apiKey) p.push('API key is required for the selected authentication (store it in Secret Vault).');
  if (!(c.temperature >= 0 && c.temperature <= 2)) p.push('Temperature must be between 0 and 2.');
  if (!(c.maxTokens >= 50 && c.maxTokens <= 8000)) p.push('Max tokens must be between 50 and 8000.');
  if (c.extraJson.trim()) { try { const v = JSON.parse(c.extraJson); if (!v || typeof v !== 'object' || Array.isArray(v)) p.push('Model-specific configuration must be a JSON object.'); } catch { p.push('Model-specific configuration is not valid JSON.'); } }
  return p;
}
export function saveAiConfig(c: AiLlmConfig, store: KeyValueStore = browserStore): boolean { return writeJson(store, KEYS.aiConfig, c); }
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export async function requestSqlFromModel(c: AiLlmConfig, apiKey: string, prompt: string, schemaSummary: string, fetcher: FetchLike = (u, i) => fetch(u, i)): Promise<{ sql: string } | { error: AppError }> {
  const problems = validateAiConfig(c, apiKey);
  if (!c.enabled) return { error: makeError('AI_LLM_CONFIG_INVALID', 'The AI/LLM Model is disabled.') };
  if (problems.length) return { error: makeError('AI_LLM_CONFIG_INVALID', 'The AI/LLM Model configuration is incomplete.', problems) };
  const system = `You write a single read-only SQL SELECT statement. Use ONLY these tables and columns:\n${schemaSummary}\nReturn only SQL.`;
  const extra = c.extraJson.trim() ? JSON.parse(c.extraJson) : {};
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (c.authType === 'bearer') headers.Authorization = `Bearer ${apiKey}`;
  if (c.authType === 'api-key-header') { if (c.provider === 'anthropic') { headers['x-api-key'] = apiKey; headers['anthropic-version'] = c.apiVersion || '2023-06-01'; } else headers['api-key'] = apiKey; }
  const body = c.provider === 'anthropic'
    ? { model: c.model, max_tokens: c.maxTokens, temperature: c.temperature, system, messages: [{ role: 'user', content: prompt }], ...extra }
    : { model: c.model, temperature: c.temperature, max_tokens: c.maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], ...extra };
  const url = c.provider === 'azure-openai' && c.apiVersion && !/api-version=/.test(c.endpoint) ? `${c.endpoint}${c.endpoint.includes('?') ? '&' : '?'}api-version=${encodeURIComponent(c.apiVersion)}` : c.endpoint;
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), c.timeoutMs);
  try {
    const r = await fetcher(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) return { error: makeError('AI_LLM_REQUEST_FAILED', `The AI/LLM Model returned HTTP ${r.status}.`, undefined, [apiKey]) };
    const j = await r.json() as Record<string, any>;
    const text: string = j?.choices?.[0]?.message?.content ?? j?.content?.[0]?.text ?? j?.output ?? j?.sql ?? '';
    const sql = String(text).replace(/^```(?:sql)?\s*/i, '').replace(/```\s*$/, '').trim();
    if (!sql) return { error: makeError('AI_LLM_REQUEST_FAILED', 'The AI/LLM Model returned no SQL.') };
    return { sql };
  } catch (e) { return { error: makeError('AI_LLM_REQUEST_FAILED', redactSecrets(`The AI/LLM Model is unavailable (${(e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message}).`, [apiKey]), undefined, [apiKey]) }; }
  finally { clearTimeout(timer); }
}
