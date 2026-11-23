// The one bridge between the web UI and the desktop shell. contextIsolation keeps the page from
// reaching ipcRenderer itself; it only gets these calls.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a sandboxed preload cannot be an ES module
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sakuyaDesktop', {
  updates: {
    getState: () => ipcRenderer.invoke('update:state'),
    onState(callback) {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('update:changed', listener);
      return () => ipcRenderer.removeListener('update:changed', listener);
    },
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    setAutoUpdate: (on) => ipcRenderer.invoke('update:auto', !!on),
    dismissUpdated: () => ipcRenderer.invoke('update:dismiss'),
  },
});
