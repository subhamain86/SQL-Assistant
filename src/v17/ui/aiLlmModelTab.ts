/**
 * V17.0 — Settings → "AI / LLM Model" tab (replaces "AI / NLP Engine" / Online AI/NLP Endpoint).
 * Offline NLU is always on; the AI / LLM Model is optional and off by default.
 * The API key is written only into the encrypted Secret Vault and is never displayed.
 */
import { icon } from '../../components/icons';
import { LLM_PROVIDERS, loadLlmConfig, saveLlmConfig, validateLlmConfig, callLlm, buildLlmPrompt, type LlmModelConfig, type LlmProvider, type KeyValueStorage } from '../services/llmService';
import type { LearningStore } from '../services/learningStore';
import { statusOf } from '../services/learningStore';
import { renderErrorListHtml, escapeHtmlV17 as esc, makeError, type AppError } from '../errors/appErrors';

export interface AiLlmTabDeps {
  storage: KeyValueStorage;
  vaultUnlocked: () => boolean; hasApiKey: () => boolean; getApiKey: () => string | null; saveApiKey: (key: string) => Promise<{ ok: boolean; error?: string }>;
  learning: LearningStore; syncLearning: (direction: 'push' | 'pull', maskLiterals: boolean) => Promise<{ ok: boolean; message: string; error?: AppError | null }>;
  toast: (k: 'success' | 'error' | 'info' | 'warning', t: string) => void; fetchImpl?: typeof fetch;
}

export function renderAiLlmModelTab(panel: HTMLElement, deps: AiLlmTabDeps): void {
  const cfg = loadLlmConfig(deps.storage);
  const provider = LLM_PROVIDERS.find((p) => p.id === cfg.provider)!;
  const st = deps.learning.stats();
  panel.innerHTML = `
  <div class="issue-box ok mini">${icon('wifi-off', 14)} Offline NLU (V17): always active — SQL is generated locally from the Active Schema, with no external service required.</div>
  <h5 class="mt">${icon('bot', 15)} AI / LLM Model <span class="chip chip-inactive">Optional</span></h5>
  <p class="hint">An additional intelligence layer for <strong>Describe What You Need</strong>. The offline engine runs first; when enabled, the model receives only the relevant part of the Active Schema and the offline draft. Any SQL it returns is used only if it passes the read-only safety check and the Active Schema check. If the model is disabled, not configured, unreachable or invalid, the application continues with the offline engine.${cfg.migratedFromV16 ? ' <strong>Your V16 Online AI/NLP Endpoint was migrated here as a "Custom endpoint".</strong>' : ''}</p>
  <label class="inline-check"><input type="checkbox" id="v17LlmEnabled" ${cfg.enabled ? 'checked' : ''}/> Enable AI / LLM Model for Describe What You Need</label>
  <div class="form-row-2">
    <label class="block-label">Model / provider<select id="v17LlmProvider">${LLM_PROVIDERS.map((p) => `<option value="${p.id}" ${p.id === cfg.provider ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
    <label class="block-label">Endpoint URL<input type="text" id="v17LlmEndpoint" value="${esc(cfg.endpoint)}" placeholder="https://…" autocomplete="off"/></label>
  </div>
  <div class="form-row-2">
    <label class="block-label">Model name<input type="text" id="v17LlmModel" value="${esc(cfg.model)}" placeholder="${provider.needsModel ? 'required — the model id your provider expects' : 'optional for this provider'}" autocomplete="off"/></label>
    <label class="block-label">API key / credential<input type="password" id="v17LlmKey" value="" placeholder="${deps.hasApiKey() ? '•••••••••••• (stored encrypted — leave blank to keep)' : deps.vaultUnlocked() ? 'stored only in the encrypted Secret Vault' : 'unlock the Secret Vault to set the key'}" autocomplete="new-password" ${deps.vaultUnlocked() ? '' : 'disabled'}/></label>
  </div>
  <div class="form-row-2" id="v17AzureRow" ${cfg.provider === 'azure-openai' ? '' : 'hidden'}>
    <label class="block-label">Azure deployment name<input type="text" id="v17LlmDeployment" value="${esc(cfg.deployment)}" autocomplete="off"/></label>
    <label class="block-label">Azure api-version<input type="text" id="v17LlmApiVersion" value="${esc(cfg.apiVersion)}" autocomplete="off"/></label>
  </div>
  <details class="advanced-sync-details mt"><summary>Optional parameters</summary>
    <div class="form-row-3">
      <label class="block-label">Temperature (0–1)<input type="number" id="v17LlmTemp" min="0" max="1" step="0.1" value="${cfg.temperature}"/></label>
      <label class="block-label">Max tokens<input type="number" id="v17LlmMaxTokens" min="64" max="8000" value="${cfg.maxTokens}"/></label>
      <label class="block-label">Timeout (seconds)<input type="number" id="v17LlmTimeout" min="2" max="120" value="${Math.round(cfg.timeoutMs / 1000)}"/></label>
    </div>
    <label class="block-label">Use the model<select id="v17LlmUseWhen"><option value="always" ${cfg.useWhen === 'always' ? 'selected' : ''}>For every description (offline result stays the default)</option><option value="low-confidence" ${cfg.useWhen === 'low-confidence' ? 'selected' : ''}>Only when the offline engine's confidence is low</option></select></label>
  </details>
  <div class="row-actions"><button type="button" class="btn btn-primary btn-sm" id="v17LlmSave">${icon('save', 14)} Save</button><button type="button" class="btn btn-outline btn-sm" id="v17LlmTest">${icon('zap', 14)} Test connection</button><button type="button" class="btn btn-ghost btn-sm" id="v17LlmDisable">${icon('wifi-off', 14)} Disable (offline only)</button></div>
  <div id="v17LlmResult"></div>
  <h5 class="mt">${icon('history', 15)} Learned Query Knowledge</h5>
  <p class="hint">Built from descriptions you used and SQL you accepted ("Accept &amp; Learn"). Only repeated or confirmed patterns are used, always re-checked against the current Active Schema. It never changes the schema or the application logic.</p>
  <div class="chip-row"><span class="chip">${st.total} recorded</span><span class="chip chip-active">${st.confirmed} confirmed</span><span class="chip">${st.repeated} repeated</span><span class="chip chip-inactive">${st.observed} observed only (not used)</span></div>
  <label class="inline-check"><input type="checkbox" id="v17MaskLiterals" checked/> Mask literal values (quoted text, long numbers) when synchronizing to the repository</label>
  <div class="row-actions"><button type="button" class="btn btn-outline btn-sm" id="v17LearnPull">${icon('download', 14)} Pull from repository</button><button type="button" class="btn btn-outline btn-sm" id="v17LearnPush">${icon('upload', 14)} Push to repository</button><button type="button" class="btn btn-outline btn-sm" id="v17LearnExport">${icon('download', 14)} Export JSON</button><button type="button" class="btn btn-ghost btn-sm" id="v17LearnClear">${icon('trash', 14)} Clear learned knowledge</button></div>
  <div id="v17LearnResult"></div>`;

  const $ = <T extends HTMLElement>(id: string) => panel.querySelector<T>(`#${id}`)!;
  const result = $('v17LlmResult'); const learnResult = $('v17LearnResult');
  const read = (): LlmModelConfig => ({ ...cfg, enabled: $<HTMLInputElement>('v17LlmEnabled').checked, provider: $<HTMLSelectElement>('v17LlmProvider').value as LlmProvider, endpoint: $<HTMLInputElement>('v17LlmEndpoint').value.trim(), model: $<HTMLInputElement>('v17LlmModel').value.trim(), deployment: $<HTMLInputElement>('v17LlmDeployment').value.trim(), apiVersion: $<HTMLInputElement>('v17LlmApiVersion').value.trim(), temperature: parseFloat($<HTMLInputElement>('v17LlmTemp').value) || 0, maxTokens: parseInt($<HTMLInputElement>('v17LlmMaxTokens').value, 10) || 800, timeoutMs: (parseInt($<HTMLInputElement>('v17LlmTimeout').value, 10) || 15) * 1000, useWhen: $<HTMLSelectElement>('v17LlmUseWhen').value === 'low-confidence' ? 'low-confidence' : 'always' });
  const ok = (m: string) => `<div class="issue-box ok mini">${icon('check', 14)} ${esc(m)}</div>`;
  panel.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', () => { result.innerHTML = ''; }));
  $<HTMLSelectElement>('v17LlmProvider').addEventListener('change', (e) => { $('v17AzureRow').hidden = (e.target as HTMLSelectElement).value !== 'azure-openai'; });

  async function persist(): Promise<{ next: LlmModelConfig; key: string | null } | null> {
    const next = read(); const typedKey = $<HTMLInputElement>('v17LlmKey').value;
    const willHaveKey = !!typedKey || deps.hasApiKey();
    if (next.enabled) { const issues = validateLlmConfig(next, willHaveKey); if (issues.length) { result.innerHTML = renderErrorListHtml([makeError('AI_LLM_CONFIG_INVALID', 'The AI / LLM Model was not enabled because the configuration is incomplete or invalid.', issues)], esc); return null; } }
    if (typedKey) { const r = await deps.saveApiKey(typedKey); $<HTMLInputElement>('v17LlmKey').value = ''; if (!r.ok) { result.innerHTML = renderErrorListHtml([makeError('AI_LLM_CONFIG_INVALID', `The API key could not be stored in the Secret Vault: ${r.error || 'the vault rejected the change'}.`)], esc); return null; } }
    saveLlmConfig(deps.storage, next); return { next, key: deps.getApiKey() };
  }
  $('v17LlmSave').addEventListener('click', async () => { const r = await persist(); if (!r) return; result.innerHTML = ok(r.next.enabled ? 'AI / LLM Model saved and enabled. The offline engine remains the primary engine.' : 'Saved. AI / LLM Model is disabled — only the offline engine is used.'); deps.toast('success', 'AI / LLM Model settings saved.'); });
  $('v17LlmDisable').addEventListener('click', () => { const next = { ...read(), enabled: false }; saveLlmConfig(deps.storage, next); $<HTMLInputElement>('v17LlmEnabled').checked = false; result.innerHTML = ok('AI / LLM Model disabled — only the offline engine is used.'); deps.toast('info', 'AI / LLM Model disabled.'); });
  $('v17LlmTest').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>('v17LlmTest'); const original = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Testing…';
    const next = read(); const key = $<HTMLInputElement>('v17LlmKey').value || deps.getApiKey();
    const prompt = buildLlmPrompt({ request: 'Connection test: return {"sql":"SELECT 1 FROM TEST_TABLE;","tables":["TEST_TABLE"],"columns":[],"explanation":"ok"}', schemaContext: 'TABLE TEST_TABLE: connection test | ID NUMBER PK', offlineSql: 'SELECT 1 FROM TEST_TABLE;', dialect: 'Generic', examples: [] });
    const res = await callLlm({ ...next, enabled: true }, key, prompt, 'TABLE TEST_TABLE', deps.fetchImpl);
    btn.disabled = false; btn.innerHTML = original;
    result.innerHTML = res.ok ? ok(`Connection succeeded — the model returned a ${res.suggestion.sql ? 'SQL' : 'JSON'} answer.`) : renderErrorListHtml([res.error], esc);
  });
  const sync = async (dir: 'push' | 'pull') => { const r = await deps.syncLearning(dir, $<HTMLInputElement>('v17MaskLiterals').checked); learnResult.innerHTML = r.ok ? ok(r.message) : renderErrorListHtml([r.error || makeError('REPOSITORY_SYNC_FAILED', r.message)], esc); };
  $('v17LearnPull').addEventListener('click', () => sync('pull'));
  $('v17LearnPush').addEventListener('click', () => sync('push'));
  $('v17LearnExport').addEventListener('click', () => { const blob = new Blob([JSON.stringify(deps.learning.toFile(false), null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `learned-query-knowledge-${Date.now()}.json`; document.body.appendChild(a); a.click(); a.remove(); });
  $('v17LearnClear').addEventListener('click', () => { if (!confirm('Clear all learned query knowledge on this device? (The schema and settings are not affected.)')) return; deps.learning.clear(); deps.toast('info', 'Learned query knowledge cleared on this device.'); renderAiLlmModelTab(panel, deps); });
  void statusOf;
}
