export function utf8ToBase64(s: string): string { let b = ''; new TextEncoder().encode(s).forEach((x) => { b += String.fromCharCode(x); }); return btoa(b); }
export function base64ToUtf8(b64: string): string {
  let bin: string; try { bin = atob(String(b64 ?? '').replace(/\s+/g, '')); } catch { throw new Error('The repository returned file content that is not valid base64.'); }
  const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u); } catch { throw new Error('The repository file is not valid UTF-8 text.'); }
}
