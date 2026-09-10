const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('captureBridge', {
  status: (state, message) => ipcRenderer.send('capture:status', state, message),
  onMonitor: (callback) => ipcRenderer.on('capture:monitor', (_event, enabled) => callback(enabled)),
});
ipcRenderer.on('capture:port', event => {
  window.postMessage('capture:port', '*', event.ports);
});
