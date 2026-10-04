/** CR ("Describe the Change") orchestration — offline engine, optionally assisted by M365 Copilot (unchanged V16 behaviour). */
import type { SchemaModel, CrRequirement, NlpOrchestrationResult } from '../types';
import { parseCrRequirement } from '../engines/crNlpEngine';
import { isBrowserOnline } from './onlineNlpService';
import { tryM365Copilot, isCopilotConfigured, buildMinimalSchemaContext } from './copilotNlpService';
import { secretVaultService } from './secretVaultService';
export function validateActiveSchemaAvailability(schema: SchemaModel | null | undefined): { available: boolean; reason?: string } {
  if (!schema) return { available: false, reason: 'No Active Schema is currently set.' };
  if (!Array.isArray(schema.tables) || !schema.tables.length) return { available: false, reason: `Active Schema "${schema.name}" has no tables defined yet.` };
  return { available: true };
}
export async function orchestrateCrNlp(rawText: string, schema: SchemaModel): Promise<NlpOrchestrationResult<CrRequirement>> {
  const a = validateActiveSchemaAvailability(schema); const offline = parseCrRequirement(rawText, schema);
  if (!a.available) { offline.notes.unshift(`Active schema unavailable: ${a.reason}`); return { result: offline, engineUsed: 'offline', onlineAttempted: false, onlineError: a.reason }; }
  if (!rawText.trim() || !isBrowserOnline()) return { result: offline, engineUsed: 'offline', onlineAttempted: false };
  const cfg = secretVaultService.isUnlocked() ? secretVaultService.getConfig()?.m365Copilot : null;
  if (cfg && isCopilotConfigured(cfg)) { const r = await tryM365Copilot(cfg, rawText, buildMinimalSchemaContext(rawText, schema)); return { result: offline, engineUsed: r ? 'copilot' : 'offline', onlineAttempted: true, onlineError: r ? undefined : 'M365 Copilot Enterprise did not respond.' }; }
  return { result: offline, engineUsed: 'offline', onlineAttempted: false };
}
