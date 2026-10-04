export function utf8ToBase64(str: string): string { const bytes = new TextEncoder().encode(str); let binary = ''; bytes.forEach((b) => { binary += String.fromCharCode(b); }); return btoa(binary); }
export function base64ToUtf8(b64: string): string {
  let binary: string;
  try { binary = atob(String(b64 ?? '').replace(/\s+/g, '')); } catch { throw new Error('The repository returned file content that is not valid base64 (the download was corrupted or truncated).'); }
  const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('The repository file is not valid UTF-8 text (it may have been saved with a different encoding).'); }
}
