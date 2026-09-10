const { contextBridge, ipcRenderer } = require('electron');
const invoke = (action, payload) => ipcRenderer.invoke('controller:action', action, payload);
contextBridge.exposeInMainWorld('radio', {
  getState: () => invoke('state'),
  join: () => invoke('join'),
  leave: () => invoke('leave'),
  start: () => invoke('start'),
  stop: () => invoke('stop'),
  volume: value => invoke('volume', value),
  monitor: enabled => invoke('monitor', enabled),
  navigate: address => invoke('navigate', address),
  back: () => invoke('back'),
  forward: () => invoke('forward'),
  reload: () => invoke('reload'),
  saveSettings: settings => invoke('settings', settings),
  clearSettings: () => invoke('clearSettings'),
  openHelp: topic => invoke('help', topic),
  dismissError: () => invoke('dismissError'),
  layout: bounds => ipcRenderer.send('controller:layout', bounds),
  showSettings: open => invoke('showSettings', open),
  onState: callback => ipcRenderer.on('controller:state', (_event, state) => callback(state)),
  hideBrowser: hidden => invoke('hideBrowser', hidden),
});
