/**
 * V17.5 — Settings → Schema Management → "Schema passphrase". The administrator sets or changes the passphrase and publishes the schema as an
 * encrypted file; other devices pull it with Schema → Pull Schema. Same repository connection and same validated publish gate as the existing sync.
 */
import { icon } from '../components/icons'; import { passphraseFieldHtml, wirePassphraseFields } from '../components/passphraseField'; import { store } from '../state'; import { services } from '../context'; import { e } from '../dom';
import { checkPassphrase } from '../../v17/services/schemaCrypto'; import { redactSecrets } from '../../v17/errors/appErrors';
let result = '';
const box = (kind: 'ok' | 'warn' | 'err', html: string) => `<div class="issue-box ${kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : ''} mini" role="${kind === 'err' ? 'alert' : 'status'}">${icon(kind === 'ok' ? 'check' : 'alert-triangle', 14)}<div>${html}</div></div>`;
export function adminPassphraseHtml(): string {
  const { passphrase, sync } = services(); const on = passphrase.hasSaved();
  return `<div class="builder-panel mt" data-v175-passphrase><h2>${icon('key', 16)} Schema passphrase — encrypted synchronization</h2>
    <p class="hint">With a passphrase set on this device, the schema is synchronized as an <strong>AES-256-GCM encrypted file</strong> (<code>${e(sync.encryptedFilePath())}</code>) in the same repository. Other devices open it with <strong>Schema → Pull Schema</strong> and the same passphrase. The passphrase is stored on this device only as ciphertext and is never written to the repository, a URL, a log or an error message.
    Status on this device: <span class="chip ${on ? 'chip-active' : 'chip-inactive'}">${on ? 'Encrypted synchronization ON' : 'OFF — plain schema file'}</span></p>
    <div class="form-row-2"><div>${passphraseFieldHtml('schemaAdminPass', 'Passphrase (at least 10 characters)')}</div><div>${passphraseFieldHtml('schemaAdminPass2', 'Confirm passphrase')}</div></div>
    <div class="row-actions"><button type="button" class="btn btn-outline" id="schemaPassSave">${icon('save', 14)} Save passphrase</button><button type="button" class="btn btn-primary" id="schemaPassPublish">${icon('upload', 14)} Save passphrase and publish encrypted schema</button>${on ? `<button type="button" class="btn btn-outline" id="schemaPassClear">Remove passphrase from this device</button>` : ''}</div>
    <p class="hint">Changed the passphrase? Publish again, then give the new passphrase to the other devices — they enter it under Schema → Pull Schema.</p><div id="schemaPassResult" aria-live="polite">${result}</div></div>`;
}
export function wireAdminPassphrase(p: HTMLElement, rerender: () => void): void {
  const { passphrase, sync } = services(); const root = p.querySelector<HTMLElement>('[data-v175-passphrase]'); if (!root) return; wirePassphraseFields(root);
  const f1 = root.querySelector<HTMLInputElement>('#schemaAdminPass')!; const f2 = root.querySelector<HTMLInputElement>('#schemaAdminPass2')!; const out = root.querySelector<HTMLElement>('#schemaPassResult')!; const show = (html: string) => { result = html; out.innerHTML = html; };
  void passphrase.get().then((v) => { if (v && !f1.value) { f1.value = v; f2.value = v; } });
  const read = async (): Promise<string | null> => { const a = f1.value; const bad = checkPassphrase(a); if (bad) { show(box('err', e(bad))); return null; } if (a !== f2.value) { show(box('err', 'The two passphrases do not match.')); return null; } return a; };
  root.querySelector('#schemaPassSave')!.addEventListener('click', async () => { const a = await read(); if (!a) return; try { await passphrase.set(a); show(box('ok', 'Passphrase saved on this device (encrypted). Schema synchronization from this device is now encrypted. Use "Save passphrase and publish" to update the repository file.')); store.pushToast('success', 'Schema passphrase saved.'); rerender(); } catch (err) { show(box('err', e(redactSecrets((err as Error).message, [a])))); } });
  root.querySelector('#schemaPassPublish')!.addEventListener('click', async () => {
    const a = await read(); if (!a) return; const had = passphrase.hasSaved(); if (!confirm('Publish the schemas on this device as an encrypted file? An existing encrypted file in the repository is replaced. Every schema is validated first.')) return;
    root.querySelectorAll('button').forEach((b) => b.setAttribute('disabled', '')); show(box('warn', 'Encrypting and publishing…'));
    try { if (!had) { try { await sync.pull(); } catch { /* the plain file may not exist yet — publishing creates the encrypted one */ } } await passphrase.set(a);
      const r = await sync.push({ allowReplacingInvalidRemote: true, replaceUndecryptable: true }); show(r.ok ? box('ok', `${e(r.messages.join(' '))}<br><span class="hint">Give the passphrase to the other devices through a secure channel; they pull with Schema → Pull Schema.</span>`) : box('err', e(redactSecrets([...r.problems].join(' '), [a]))));
      if (r.ok) store.pushToast('success', 'Encrypted schema published.'); } catch (err) { show(box('err', e(redactSecrets((err as Error).message, [a])))); }
    rerender();
  });
  root.querySelector('#schemaPassClear')?.addEventListener('click', () => { if (!confirm('Remove the passphrase from this device? Synchronization from this device returns to the plain schema file. The encrypted file already in the repository is not deleted.')) return; passphrase.clear(); show(box('ok', 'Passphrase removed from this device.')); rerender(); });
}
