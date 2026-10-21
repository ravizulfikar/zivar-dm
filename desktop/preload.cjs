const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('zivarDesktop', Object.freeze({
  isDesktop: true,
  getInfo: () => ipcRenderer.invoke('zivar:info'),
  copyText: text => ipcRenderer.invoke('zivar:copy', text),
  openExtensionFolder: () => ipcRenderer.invoke('zivar:extension-folder'),
  completeSetup: () => ipcRenderer.invoke('zivar:setup-complete'),
  quit: () => ipcRenderer.invoke('zivar:quit'),
  openFile: target => ipcRenderer.invoke('zivar:open-file', target),
  showFile: target => ipcRenderer.invoke('zivar:show-file', target),
  getSystem: () => ipcRenderer.invoke('zivar:get-system'),
  setAutoStart: enabled => ipcRenderer.invoke('zivar:set-autostart', enabled),
  relaunch: () => ipcRenderer.invoke('zivar:relaunch'),
  checkUpdate: () => ipcRenderer.invoke('zivar:check-update'),
  downloadUpdate: () => ipcRenderer.invoke('zivar:download-update'),
}));
