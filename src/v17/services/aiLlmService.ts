/** Optional AI/LLM Model. The offline NLU stays primary; failures fall back to the offline result. */
import { KEYS, readJson, writeJson, type KeyValueStore } from '../../services/storage';
import { redactSecrets, makeError, type AppError } from '../errors/appErrors';
export type AiProvider = 'openai' | 'azure-openai' | 'anthropic' | 'custom';
export type AiAuth = 'bearer' | 'api-key-header' | 'none';
export interface AiLlmConfig { enabled: boolean; provider: AiProvider; model: string; endpoint: string; authType: AiAuth; apiVersion: string; timeoutMs: number; extraJson: string; }
export const DEFAULT_AI_CONFIG: AiLlmConfig = { enabled: false, provider: 'openai', model: '', endpoint: '', authType: 'bearer', apiVersion: '', timeoutMs: 20000, extraJson: '' };
export const PROVIDER_DEFAULTS: Record<AiProvider, { endpoint: string; authType: AiAuth }> = { openai: { endpoint: 'https://api.openai.com/v1/chat/completions', authType: 'bearer' }, 'azure-openai': { endpoint: 'https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions', authType: 'api-key-header' }, anthropic: { endpoint: 'https://api.anthropic.com/v1/messages', authType: 'api-key-header' }, custom: { endpoint: '', authType: 'bearer' } };
export function loadAiConfig(s: KeyValueStore): AiLlmConfig { const c = readJson<Partial<AiLlmConfig> | null>(s, KEYS.aiConfig, null); const old = readJson<Record<string, unknown> | null>(s, KEYS.aiConfigV172, null);
  return { ...DEFAULT_AI_CONFIG, ...(old && !c ? { enabled: !!old.enabled, model: String(old.model || ''), endpoint: String(old.endpoint || ''), provider: (['openai', 'azure-openai', 'anthropic'].includes(String(old.provider)) ? old.provider : 'custom') as AiProvider } : {}), ...(c || {}) }; }
export const saveAiConfig = (c: AiLlmConfig, s: KeyValueStore) => writeJson(s, KEYS.aiConfig, c);
export function validateAiConfig(c: AiLlmConfig, key: string): string[] { const p: string[] = []; if (!c.enabled) return p; if (!c.model.trim()) p.push('Model is required.');
  if (!/^https:\/\//i.test(c.endpoint.trim()) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(c.endpoint.trim())) p.push('Endpoint must be an https:// URL (or http://localhost for a local model).');
  if (/\{(resource|deployment)\}/.test(c.endpoint)) p.push('Replace {resource}/{deployment} in the endpoint.'); if (c.authType !== 'none' && !key) p.push('API key is required for the selected authentication.');
  if (c.extraJson.trim()) { try { const v = JSON.parse(c.extraJson); if (!v || typeof v !== 'object' || Array.isArray(v)) p.push('Model-specific configuration must be a JSON object.'); } catch { p.push('Model-specific configuration is not valid JSON.'); } } return p; }
export async function requestSqlFromModel(c: AiLlmConfig, key: string, prompt: string, summary: string): Promise<{ sql: string } | { error: AppError }> {
  const p = validateAiConfig(c, key); if (!c.enabled) return { error: makeError('AI_LLM_CONFIG_INVALID', 'The AI/LLM Model is disabled.') }; if (p.length) return { error: makeError('AI_LLM_CONFIG_INVALID', 'The AI/LLM Model configuration is incomplete.', p) };
  const sys = `Write one read-only SQL SELECT. Use ONLY these tables/columns:\n${summary}\nReturn only SQL.`; const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (c.authType === 'bearer') h.Authorization = `Bearer ${key}`; if (c.authType === 'api-key-header') { if (c.provider === 'anthropic') { h['x-api-key'] = key; h['anthropic-version'] = c.apiVersion || '2023-06-01'; } else h['api-key'] = key; }
  const extra = c.extraJson.trim() ? JSON.parse(c.extraJson) : {}; const body = c.provider === 'anthropic' ? { model: c.model, max_tokens: 800, system: sys, messages: [{ role: 'user', content: prompt }], ...extra } : { model: c.model, messages: [{ role: 'system', content: sys }, { role: 'user', content: prompt }], ...extra };
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), c.timeoutMs);
  try { const r = await fetch(c.endpoint, { method: 'POST', headers: h, body: JSON.stringify(body), signal: ctl.signal }); if (!r.ok) return { error: makeError('AI_LLM_REQUEST_FAILED', `The AI/LLM Model returned HTTP ${r.status}.`) };
    const j = (await r.json()) as Record<string, any>; const sql = String(j?.choices?.[0]?.message?.content ?? j?.content?.[0]?.text ?? '').replace(/^```(?:sql)?\s*/i, '').replace(/```\s*$/, '').trim(); return sql ? { sql } : { error: makeError('AI_LLM_REQUEST_FAILED', 'The AI/LLM Model returned no SQL.') };
  } catch (e) { return { error: makeError('AI_LLM_REQUEST_FAILED', redactSecrets(`The AI/LLM Model is unavailable (${(e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message}).`, [key])) }; } finally { clearTimeout(tm); }
}
