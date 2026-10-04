/**
 * V17.0 — Glue between the V17 modules and the existing V16.5 singletons.
 * Every function here is called from ONE small, anchor-based patch applied by
 * tools/apply-v17.mjs; nothing in V16.5 is removed or redesigned.
 */
import type { SchemaModel, QueryRequirement, NlpOrchestrationResult, SchemaEditorRow } from '../types';
import { VALID_DATA_TYPES } from '../types';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { secretVaultService, DEFAULT_BOOTSTRAP_CONFIG } from '../services/secretVaultService';
import { getFile, putFile } from '../services/githubApiService';
import { getConfiguredEndpoint, isBrowserOnline } from '../services/onlineNlpService';
import { tryM365Copilot, isCopilotConfigured, buildMinimalSchemaContext } from '../services/copilotNlpService';
import { getDeviceTag } from '../engines/schemaVersionEngine';
import { icon } from '../components/icons';
import { openModal } from '../components/modal';
import { LearningStore, pullLearning, pushLearning, type RepoFileApi } from './services/learningStore';
import { describeWhatYouNeed, isResultStale, type DescribeResult } from './services/v17Orchestrator';
import { loadLlmConfig, migrateFromV16Endpoint } from './services/llmService';
import { applyV17ToState, advancedOverrides } from './engines/advancedOptionsResolver';
import { invalidateSchemaContext } from './engines/schemaContext';
import { dataTypeOptionValues } from './engines/schemaRecordEngine';
import type { V17Requirement } from './engines/nluEngine';
import { mountAutoOptionsPanel } from './ui/autoOptionsPanel';
import { renderDescribeExtras } from './ui/describeExtras';
import { openAcceptLearnModal } from './ui/acceptLearnModal';
import { renderAiLlmModelTab } from './ui/aiLlmModelTab';
import { mountVaultSyncSection } from './ui/vaultSyncSection';
import { escapeHtmlV17 as esc, formatAppError } from './errors/appErrors';

export const V17_VERSION = '17.0.0';
const kv = { getItem: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, setItem: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* reported by callers */ } } };
export const learningStore = new LearningStore(undefined, getDeviceTag);
const repoApi: RepoFileApi = { getFile: (r, b, p, t) => getFile(r, b, p, t), putFile: (r, b, p, t, c, m, s) => putFile(r, b, p, t, c, m, s) };
let lastResult: DescribeResult | null = null;
let booted = false;

/** Called once after mountAppShell(). Safe to call repeatedly. */
export function bootV17(): void {
  if (booted) return; booted = true;
  migrateFromV16Endpoint(kv, getConfiguredEndpoint());
  schemaService.subscribe(() => { invalidateSchemaContext(); if (lastResult && isResultStale(lastResult, schemaService.getActiveSchema())) lastResult = null; });
  const cfg = DEFAULT_BOOTSTRAP_CONFIG;
  pullLearning(learningStore, repoApi, cfg.githubRepo, cfg.githubBranch, '').catch(() => undefined); // public read; silently skipped for private repos
  secretVaultService.subscribe(() => { const c = secretVaultService.getConfig(); if (c?.githubToken) pullLearning(learningStore, repoApi, c.githubRepo, c.githubBranch, c.githubToken).catch(() => undefined); });
}

export function getLastDescribeResult(): DescribeResult | null { return lastResult && !isResultStale(lastResult, schemaService.getActiveSchema()) ? lastResult : null; }

/** Drop-in replacement for orchestrateReadOnlyNlp() — same signature and return type. */
export async function orchestrateReadOnlyNlpV17(rawText: string, _schemaFromPage: SchemaModel): Promise<NlpOrchestrationResult<QueryRequirement>> {
  const active = schemaService.getActiveSchema();
  const useSchema = active; // always the CURRENT Active Schema (never a stale copy held by the page)
  const vault = secretVaultService.isUnlocked() ? secretVaultService.getConfig() : null;
  const llmConfig = loadLlmConfig(kv);
  const r = await describeWhatYouNeed(rawText, useSchema, store.readOnly, { learning: learningStore, online: isBrowserOnline(), llm: { config: llmConfig, apiKey: vault?.llmApiKey || null, vaultLocked: !vault } });
  lastResult = r;
  const req = r.requirement as V17Requirement;
  // The V16.5 page renders notes as HTML — V17 text is escaped before it is added.
  req.notes = [...req.notes.map(esc), ...r.errors.map((e) => `⚠ ${esc(formatAppError(e))}${e.details?.length ? ` — ${esc(e.details.join('; '))}` : ''}`), ...r.warnings.map((w) => `⚠ ${esc(w)}`)];
  req.queryPlan = req.queryPlan.map(esc);
  // V16 M365 Copilot Enterprise integration preserved: schema-filtered table suggestions only.
  let copilotUsed = false;
  const copilotCfg = vault?.m365Copilot;
  if (rawText.trim() && copilotCfg && isCopilotConfigured(copilotCfg) && isBrowserOnline()) {
    const c = await tryM365Copilot(copilotCfg, rawText, buildMinimalSchemaContext(rawText, useSchema));
    if (c) {
      copilotUsed = true;
      const known = (c.tables || []).filter((t) => useSchema.tables.some((x) => x.name === t)); const unknown = (c.tables || []).filter((t) => !known.includes(t));
      if (!req.matchedTables.length && known.length) { req.matchedTables = known; req.notes.push(esc(`M365 Copilot Enterprise suggested table(s) from the Active Schema: ${known.join(', ')}.`)); }
      if (unknown.length) req.notes.push(esc(`M365 Copilot Enterprise referenced table(s) not in the Active Schema, which were discarded: ${unknown.join(', ')}.`));
    }
  }
  return { result: req, engineUsed: copilotUsed ? 'copilot' : r.engineUsed === 'offline+llm' ? 'online' : 'offline', onlineAttempted: r.llmAttempted || copilotUsed, onlineError: r.llmAttempted && !r.llmSql ? r.llmStatus : undefined };
}

/** Replaces store.mergeReadOnlyFromNlp(requirement) — superset of the V16 merge plus GROUP BY / HAVING / aggregates; manual Advanced Options always win. */
export function applyV17ResultToStore(requirement: QueryRequirement): void {
  const req = requirement as V17Requirement;
  if (!req.engine) { (store as any).mergeReadOnlyFromNlp?.(requirement); return; }
  store.updateReadOnly((s) => { const next = applyV17ToState(s, req, advancedOverrides).state; Object.assign(s, { selectedTables: next.selectedTables, selectedColumns: next.selectedColumns, filters: next.filters, sorts: next.sorts, advanced: next.advanced }); });
  if (lastResult?.usedLlmSql) store.readOnly.generatedSql = lastResult.sql;
}

export function renderV17Extras(notesMount: Element, rerenderSql: () => void): void {
  renderDescribeExtras(notesMount as HTMLElement, getLastDescribeResult(), { onUseLlmSql: (sql) => { store.readOnly.generatedSql = sql; rerenderSql(); store.pushToast('info', 'AI / LLM SQL placed in Generated SQL. Changing Manual Selectors regenerates SQL from the selectors.'); } });
}

export function recordV17Use(sql: string): void { try { learningStore.recordUse(sql); } catch { /* learning never blocks copying */ } }

export function openV17AcceptAndLearn(rerenderSql: () => void): void {
  const schema = schemaService.getActiveSchema();
  const lr = getLastDescribeResult();
  openAcceptLearnModal({ sql: store.readOnly.generatedSql, nlText: store.readOnly.naturalLanguageText, schema, learning: learningStore, learningId: lr?.learningId ?? null, toast: (k, t) => store.pushToast(k, t), onAccepted: (finalSql) => { store.readOnly.generatedSql = finalSql; rerenderSql(); } });
}

export function mountV17AutoOptions(panel: Element): void { mountAutoOptionsPanel(panel as HTMLElement, () => getLastDescribeResult()?.requirement.autoOptions ?? null); }
export function clearV17ManualOverrides(): void { advancedOverrides.clear(); lastResult = null; }

/** Settings → AI / LLM Model tab. */
export function renderV17AiLlmTab(panel: Element): void {
  renderAiLlmModelTab(panel as HTMLElement, {
    storage: kv, vaultUnlocked: () => secretVaultService.isUnlocked(), hasApiKey: () => !!secretVaultService.getConfig()?.llmApiKey, getApiKey: () => secretVaultService.getConfig()?.llmApiKey || null,
    saveApiKey: (key) => secretVaultService.saveConfig({ llmApiKey: key }), learning: learningStore, toast: (k, t) => store.pushToast(k, t),
    syncLearning: async (dir, mask) => {
      const c = secretVaultService.getConfig();
      const repo = c?.githubRepo || DEFAULT_BOOTSTRAP_CONFIG.githubRepo; const branch = c?.githubBranch || DEFAULT_BOOTSTRAP_CONFIG.githubBranch; const token = c?.githubToken || '';
      if (dir === 'push') { if (!token) return { ok: false, message: 'Unlock Settings and set the GitHub access token in the Secret Vault to push learned knowledge.' }; const r = await pushLearning(learningStore, repoApi, repo, branch, token, mask); return r.ok ? { ok: true, message: 'Learned query knowledge pushed to the repository.' } : { ok: false, message: r.error!.message, error: r.error }; }
      const r = await pullLearning(learningStore, repoApi, repo, branch, token);
      return r.error ? { ok: false, message: r.error.message, error: r.error } : { ok: true, message: `Pulled learned knowledge: ${r.added} new, ${r.updated} updated.` };
    }
  });
}

/** Settings → Secret Vault: V17 encrypted push / pull / export / import (mounted after the V16.5 tab renders). */
export function mountV17VaultSync(panel: Element): void {
  mountVaultSyncSection(panel as HTMLElement, {
    getPayload: () => { const c = secretVaultService.getConfig(); return c ? { githubToken: c.githubToken, githubRepo: c.githubRepo, githubBranch: c.githubBranch, githubSchemaPath: c.githubSchemaPath, llmApiKey: c.llmApiKey || undefined, m365Copilot: c.m365Copilot } : null; },
    applyPayload: (p) => secretVaultService.saveConfig({ githubToken: p.githubToken, githubRepo: p.githubRepo, githubBranch: p.githubBranch, githubSchemaPath: p.githubSchemaPath, ...(p.llmApiKey ? { llmApiKey: p.llmApiKey } : {}), ...(p.m365Copilot ? { m365Copilot: p.m365Copilot as any } : {}) }),
    getRememberedPassphrase: () => secretVaultService.getConfig()?.vaultSyncPassphrase || '',
    rememberPassphrase: async (p) => { await secretVaultService.saveConfig({ vaultSyncPassphrase: p }); },
    repo: () => { const c = secretVaultService.getConfig(); return { repo: c?.githubRepo || DEFAULT_BOOTSTRAP_CONFIG.githubRepo, branch: c?.githubBranch || DEFAULT_BOOTSTRAP_CONFIG.githubBranch, token: c?.githubToken || '' }; },
    api: repoApi, deviceTag: getDeviceTag, toast: (k, t) => store.pushToast(k, t)
  });
}

/** Manual Schema Update: option list that always contains the record's own data type (no silent type change on edit). */
export function v17DataTypeOptionsHtml(current: string): string { return dataTypeOptionValues(current, VALID_DATA_TYPES as string[]).map((t) => `<option value="${esc(t)}" ${t === current ? 'selected' : ''}>${esc(t)}</option>`).join(''); }

/** Manual Schema Update: delete with dependency check — asks before unlinking dependents (cascade). */
export async function v17DeleteRowWithDependencyCheck(schemaId: string, row: SchemaEditorRow): Promise<{ ok: boolean; error?: string }> {
  const svc = schemaService as unknown as { deleteRow(id: string, rowId: string, o?: { cascade?: boolean }): Promise<{ ok: boolean; error?: string; requiresCascade?: boolean; dependencies?: string[]; changes?: string[] }> };
  const first = await svc.deleteRow(schemaId, row.rowId);
  if (first.ok || !first.requiresCascade) return first;
  return new Promise((resolve) => {
    const modal = openModal(`${icon('alert-triangle', 18)} Dependent schema records`, `<p>${esc(`${row.tableName}.${row.columnName}`)} is used by:</p><ul>${(first.dependencies || []).map((d) => `<li>${esc(d)}</li>`).join('')}</ul><p class="hint">Continue to delete the column <strong>and</strong> remove these relationships / unlink these foreign keys (the referencing columns themselves are kept). Cancel to leave the schema unchanged.</p><div class="modal-actions"><button type="button" class="btn btn-ghost" id="v17DepCancel">Cancel</button><button type="button" class="btn btn-danger" id="v17DepContinue">${icon('trash', 14)} Delete and unlink</button></div>`, { closeOnBackdrop: false });
    modal.element.querySelector('#v17DepCancel')?.addEventListener('click', () => { modal.close(); resolve({ ok: false, error: 'Delete cancelled — the schema was not changed.' }); });
    modal.element.querySelector('#v17DepContinue')?.addEventListener('click', async () => { modal.close(); resolve(await svc.deleteRow(schemaId, row.rowId, { cascade: true })); });
  });
}
