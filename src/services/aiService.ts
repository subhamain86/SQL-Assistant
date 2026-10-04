import type { RectifyResult } from '../types';
import { rectify } from '../engines/errorRectifierEngine';
export const aiService = { isAvailable: true, providerName: 'Offline NLU (schema-grounded, primary) + optional AI/LLM Model', rectifySQL(errorText: string, sql: string): RectifyResult { return rectify(errorText, sql); } };
