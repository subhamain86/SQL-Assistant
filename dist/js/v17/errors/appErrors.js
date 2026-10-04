export const ERROR_TITLES = {
    ACTIVE_SCHEMA_UNAVAILABLE: 'Active schema unavailable', TABLE_NOT_FOUND: 'Table not found in the Active Schema', COLUMN_NOT_FOUND: 'Column not found in the Active Schema',
    INVALID_SCHEMA_RECORD: 'Invalid schema record', SCHEMA_UPDATE_FAILED: 'Schema update failed', SCHEMA_DEPENDENCY_BLOCKED: 'Schema change blocked by dependent records',
    SCHEMA_SYNC_FAILED: 'Schema synchronization failed', REPOSITORY_SYNC_FAILED: 'Repository synchronization failed', ENCRYPTION_FAILED: 'Encryption failed', DECRYPTION_FAILED: 'Decryption failed',
    VAULT_LOCKED: 'Secret Vault is locked', VAULT_PASSPHRASE_INVALID: 'Vault Sync Passphrase invalid', AI_LLM_CONFIG_INVALID: 'AI/LLM configuration invalid', AI_LLM_REQUEST_FAILED: 'AI/LLM request failed',
    AI_LLM_RESPONSE_REJECTED: 'AI/LLM response rejected by schema validation', OFFLINE_MODEL_UNABLE: 'Offline model unable to process request', LEARNING_STORE_FAILED: 'Learned query knowledge could not be saved',
    SQL_VALIDATION_FAILED: 'SQL validation failed', JOIN_PATH_NOT_FOUND: 'No join path between selected tables'
};
export const SECRET_PATTERNS = [
    /\bghp_[A-Za-z0-9]{20,}\b/g, /\bgho_[A-Za-z0-9]{20,}\b/g, /\bghu_[A-Za-z0-9]{20,}\b/g, /\bghs_[A-Za-z0-9]{20,}\b/g, /\bghr_[A-Za-z0-9]{20,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, /\bsk-[A-Za-z0-9_\-]{16,}\b/g, /\bsk-ant-[A-Za-z0-9_\-]{16,}\b/g, /\bAKIA[0-9A-Z]{16}\b/g, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g,
    /(Bearer|token)\s+[A-Za-z0-9._\-]{16,}/gi, /(api[-_]?key["'\s:=]+)[A-Za-z0-9._\-]{12,}/gi, /(password["'\s:=]+)[^\s'"]{4,}/gi
];
export function containsSecret(text) { return SECRET_PATTERNS.some((re) => { re.lastIndex = 0; const hit = re.test(String(text ?? '')); re.lastIndex = 0; return hit; }); }
export function redactSecrets(text, knownSecrets = []) {
    let out = String(text ?? '');
    knownSecrets.filter((s) => typeof s === 'string' && s.length >= 6).forEach((s) => { out = out.split(s).join('••••••'); });
    SECRET_PATTERNS.forEach((re) => { out = out.replace(re, (m, p1) => (typeof p1 === 'string' && /^(Bearer|token|api|password)/i.test(p1) ? `${p1} ••••••` : '••••••')); });
    return out;
}
export function makeError(code, message, details, knownSecrets = []) {
    return { code, message: redactSecrets(message, knownSecrets), details: details?.map((d) => redactSecrets(d, knownSecrets)) };
}
export function toAppError(e, fallbackCode, context, knownSecrets = []) {
    if (e && typeof e === 'object' && 'code' in e && 'message' in e && typeof e.code === 'string' && e.code in ERROR_TITLES)
        return makeError(e.code, e.message, e.details, knownSecrets);
    const raw = e instanceof Error ? e.message : (e && typeof e === 'object' && 'message' in e) ? String(e.message) : String(e ?? '');
    return makeError(fallbackCode, `${context}: ${raw && raw !== 'undefined' ? raw : 'no further detail was returned'}`, undefined, knownSecrets);
}
export function formatAppError(err) { return `${ERROR_TITLES[err.code]} — ${err.message}`; }
export function renderErrorListHtml(errors, escape) {
    if (!errors.length)
        return '';
    return `<div class="issue-box mini" data-v17-errors><ul>${errors.map((e) => `<li><strong>${escape(ERROR_TITLES[e.code])}:</strong> ${escape(e.message)}${e.details?.length ? `<ul>${e.details.map((d) => `<li>${escape(d)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul></div>`;
}
export function escapeHtmlV17(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
//# sourceMappingURL=appErrors.js.map