/** V17.0 — Settings → Secret Vault → "Push Secret Vault to Repository" (encrypted, no GitHub Vault needed). Local secrets stay in the local vault. */
import { icon } from '../../components/icons';
import { pushVaultSync, pullVaultSync, parseEnvelope, decryptEnvelope, encryptPayload, validatePassphrase, VAULT_SYNC_PATH, type SyncedSecretPayload, type RepoApi } from '../services/vaultSyncService';
import { renderErrorListHtml, escapeHtmlV17 as esc, makeError, type AppError } from '../errors/appErrors';
export interface VaultSyncDeps { getPayload: () => SyncedSecretPayload | null; applyPayload: (p: SyncedSecretPayload) => Promise<{ ok: boolean; error?: string }>; getRememberedPassphrase: () => string; rememberPassphrase: (p: string) => Promise<void>; repo: () => { repo: string; branch: string; token: string }; api: RepoApi; deviceTag: () => string; toast: (k: 'success' | 'error' | 'info' | 'warning', t: string) => void; }
export function mountVaultSyncSection(panel: HTMLElement, deps: VaultSyncDeps): void {
  const legacy = panel.querySelector<HTMLButtonElement>('#pushVaultBtn'); if (!legacy) return;
  const pushBtn = legacy.cloneNode(true) as HTMLButtonElement; legacy.replaceWith(pushBtn);
  const section = document.createElement('div'); section.setAttribute('data-v17-vault-sync', '');
  const remembered = deps.getRememberedPassphrase();
  section.innerHTML = `
    <p class="hint mt">${icon('shield', 13)} <strong>V17 encrypted synchronization.</strong> The GitHub token and configuration are encrypted in this browser with AES-256-GCM using a key derived (PBKDF2-SHA-256, 600,000 iterations) from your <strong>Vault Sync Passphrase</strong>, then written to <code>${esc(VAULT_SYNC_PATH)}</code>. The passphrase is never written to the repository, so the key is never stored next to the encrypted secret. Pushing only happens when you press the button.</p>
    <div class="form-row-2"><label class="block-label">Vault Sync Passphrase<input type="password" id="v17VaultPass" autocomplete="new-password" placeholder="${remembered ? '•••••••••••• (remembered on this device)' : 'at least 12 characters, 3 character types'}"/></label><label class="block-label">Confirm passphrase (first push)<input type="password" id="v17VaultPass2" autocomplete="new-password"/></label></div>
    <label class="inline-check"><input type="checkbox" id="v17VaultRemember" ${remembered ? 'checked' : ''}/> Remember the passphrase on this device (kept only inside the local encrypted Secret Vault)</label>
    <div class="row-actions"><button type="button" class="btn btn-outline btn-sm" id="v17VaultPull">${icon('download', 14)} Pull &amp; decrypt from repository</button><button type="button" class="btn btn-outline btn-sm" id="v17VaultExport">${icon('download', 14)} Export encrypted file</button><label class="btn btn-outline btn-sm file-input-label">${icon('upload', 14)} Import encrypted file<input type="file" id="v17VaultImport" accept=".json,application/json" hidden/></label></div>
    <p class="hint">Local vs synchronized: the local Secret Vault (unlocked by the Admin Password) keeps working exactly as before on every device. The synchronized copy is a separate encrypted file; a new device needs the passphrase — and, for a private repository, either a GitHub token with read access or the exported encrypted file.</p>
    <div id="v17VaultResult"></div>`;
  pushBtn.insertAdjacentElement('afterend', section);
  const $ = <T extends HTMLElement>(id: string) => section.querySelector<T>(`#${id}`)!; const out = $('v17VaultResult');
  const show = (errs: AppError[], okMsg?: string) => { out.innerHTML = errs.length ? renderErrorListHtml(errs, esc) : okMsg ? `<div class="issue-box ok mini">${icon('check', 14)} ${esc(okMsg)}</div>` : ''; };
  section.querySelectorAll('input').forEach((el) => el.addEventListener('input', () => { out.innerHTML = ''; }));
  const passphrase = (requireConfirm: boolean): string | null => { const p = $<HTMLInputElement>('v17VaultPass').value || deps.getRememberedPassphrase(); const p2 = $<HTMLInputElement>('v17VaultPass2').value; if (!p) { show([makeError('VAULT_PASSPHRASE_INVALID', 'Enter the Vault Sync Passphrase.')]); return null; } if (requireConfirm && $<HTMLInputElement>('v17VaultPass').value && p !== p2) { show([makeError('VAULT_PASSPHRASE_INVALID', 'The two passphrase fields do not match.')]); return null; } return p; };
  const busy = async (btn: HTMLButtonElement, label: string, fn: () => Promise<void>) => { const o = btn.innerHTML; btn.disabled = true; btn.innerHTML = label; try { await fn(); } catch (e) { show([makeError('REPOSITORY_SYNC_FAILED', `Unexpected failure: ${(e as Error)?.name || 'error'}. Nothing was changed.`)]); } finally { btn.disabled = false; btn.innerHTML = o; } };
  pushBtn.addEventListener('click', () => busy(pushBtn, 'Encrypting & pushing…', async () => {
    const payload = deps.getPayload(); if (!payload) { show([makeError('VAULT_LOCKED', 'Unlock Settings (Admin Password) first.')]); return; }
    const p = passphrase(true); if (!p) return;
    const r = await pushVaultSync({ payload, passphrase: p, deviceTag: deps.deviceTag(), api: deps.api }); if (!r.ok) { show([r.error!]); return; }
    if ($<HTMLInputElement>('v17VaultRemember').checked) await deps.rememberPassphrase(p);
    $<HTMLInputElement>('v17VaultPass').value = ''; $<HTMLInputElement>('v17VaultPass2').value = '';
    show([], `Encrypted Secret Vault pushed to the repository (contains: ${r.meta!.contains.join(', ')}). No readable token was written.`); deps.toast('success', 'Encrypted Secret Vault pushed to the repository.');
  }));
  $<HTMLButtonElement>('v17VaultPull').addEventListener('click', () => busy($<HTMLButtonElement>('v17VaultPull'), 'Pulling…', async () => {
    const p = passphrase(false); if (!p) return; const { repo, branch, token } = deps.repo();
    const r = await pullVaultSync({ repo, branch, readToken: token, passphrase: p, api: deps.api }); if (!r.ok) { show([r.error!]); return; }
    const applied = await deps.applyPayload(r.payload!); if (!applied.ok) { show([makeError('DECRYPTION_FAILED', `Decrypted successfully, but the local Secret Vault could not be updated: ${applied.error || 'vault rejected the change'}.`)]); return; }
    if ($<HTMLInputElement>('v17VaultRemember').checked) await deps.rememberPassphrase(p);
    show([], `Configuration decrypted and saved to this device's local Secret Vault (last pushed ${new Date(r.meta!.updatedAt).toLocaleString()} from ${r.meta!.updatedByDevice}).`); deps.toast('success', 'Secret Vault configuration synchronized to this device.');
  }));
  $<HTMLButtonElement>('v17VaultExport').addEventListener('click', () => busy($<HTMLButtonElement>('v17VaultExport'), 'Encrypting…', async () => {
    const payload = deps.getPayload(); if (!payload) { show([makeError('VAULT_LOCKED', 'Unlock Settings (Admin Password) first.')]); return; }
    const p = passphrase(true); if (!p) return; const issues = validatePassphrase(p); if (issues.length) { show([makeError('VAULT_PASSPHRASE_INVALID', 'The Vault Sync Passphrase does not meet the minimum strength rules.', issues)]); return; }
    const enc = await encryptPayload(payload, p, deps.deviceTag()); if (!enc.envelope) { show([enc.error!]); return; }
    const blob = new Blob([JSON.stringify(enc.envelope, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'secret-vault.v17.enc.json'; document.body.appendChild(a); a.click(); a.remove();
    show([], 'Encrypted file exported. It contains no readable secrets; transfer it to the other device and use "Import encrypted file" with the same passphrase.');
  }));
  $<HTMLInputElement>('v17VaultImport').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''; if (!file) return;
    const p = passphrase(false); if (!p) return;
    const parsed = parseEnvelope(await file.text()); if (!parsed.envelope) { show([parsed.error!]); return; }
    const dec = await decryptEnvelope(parsed.envelope, p); if (!dec.payload) { show([dec.error!]); return; }
    const applied = await deps.applyPayload(dec.payload); if (!applied.ok) { show([makeError('DECRYPTION_FAILED', `Decrypted successfully, but the local Secret Vault could not be updated: ${applied.error || 'vault rejected the change'}.`)]); return; }
    show([], 'Encrypted file imported and saved to this device\'s local Secret Vault.'); deps.toast('success', 'Secret Vault configuration imported.');
  });
}
