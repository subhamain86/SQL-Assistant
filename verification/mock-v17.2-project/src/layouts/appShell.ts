export const APP_VERSION = '17.2.1';
export function mountAppShell(root: HTMLElement): void {
  root.innerHTML = `<div class="app-shell"><nav class="navbar">SQL Assistant · V${APP_VERSION}</nav><main><div id="syncErrorMount"></div><pre id="syncMsg"></pre></main><footer class="app-footer">SQL Assistant · Version ${APP_VERSION}</footer></div>`;
}
