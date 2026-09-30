const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('budgetApp', {
  ping: () => ipcRenderer.invoke('app:ping'),
  platform: process.platform,
  saveData: (data) => ipcRenderer.invoke('app:save-data', data),
  loadData: () => ipcRenderer.invoke('app:load-data'),
  getTickerPrice: (ticker) => ipcRenderer.invoke('app:get-ticker-price', ticker),
  checkForUpdates: (repo) => ipcRenderer.invoke('app:check-for-updates', repo),
  downloadAndInstallUpdate: (options) => ipcRenderer.invoke('app:download-and-install-update', options),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  onUpdateProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('app:update-progress', listener);
    return () => {
      ipcRenderer.removeListener('app:update-progress', listener);
    };
  },
});