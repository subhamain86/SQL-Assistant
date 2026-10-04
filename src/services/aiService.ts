import type { RectifyResult } from '../types';
import { rectify } from '../engines/errorRectifierEngine';
export const aiService = { isAvailable: true, providerName: 'Offline NLU V17 (schema-grounded) + optional AI / LLM Model', rectifySQL(errorText: string, sql: string): RectifyResult { return rectify(errorText, sql); } };
