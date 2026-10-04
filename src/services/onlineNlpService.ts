/** V16 legacy endpoint storage — kept only so V17 can migrate it into Settings → AI/LLM Model. */
const ENDPOINT_STORAGE_KEY = 'sqla.onlineNlpEndpoint.v15';
export function getConfiguredEndpoint(): string | null { try { return localStorage.getItem(ENDPOINT_STORAGE_KEY) || null; } catch { return null; } }
export function setConfiguredEndpoint(url: string | null): void { if (url && url.trim()) localStorage.setItem(ENDPOINT_STORAGE_KEY, url.trim()); else localStorage.removeItem(ENDPOINT_STORAGE_KEY); }
export interface OnlineNlpResponse { sql?: string; tables?: string[]; columns?: { table: string; column: string }[]; filters?: unknown[]; raw?: unknown; }
export function isBrowserOnline(): boolean { return typeof navigator === 'undefined' ? true : navigator.onLine !== false; }
