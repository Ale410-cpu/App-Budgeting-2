const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('budgetApp', {
  ping: () => ipcRenderer.invoke('app:ping'),
  platform: process.platform,
  saveData: (data) => ipcRenderer.invoke('app:save-data', data),
  loadData: () => ipcRenderer.invoke('app:load-data'),
  getDataFileInfo: () => ipcRenderer.invoke('app:get-data-file-info'),
  selectDataFile: () => ipcRenderer.invoke('app:select-data-file'),
  chooseSaveDataLocation: (currentData, startInICloud) =>
    ipcRenderer.invoke('app:choose-save-data-location', currentData, startInICloud),
  useICloudDataLocation: (currentData) =>
    ipcRenderer.invoke('app:use-icloud-data-location', currentData),
  openDataFolder: () => ipcRenderer.invoke('app:open-data-folder'),
  getTickerPrice: (ticker) => ipcRenderer.invoke('app:get-ticker-price', ticker),
  checkForUpdates: (repo, githubToken) => ipcRenderer.invoke('app:check-for-updates', repo, githubToken),
  downloadAndInstallUpdate: (options) => ipcRenderer.invoke('app:download-and-install-update', options),
  sendNotification: (payload) => ipcRenderer.invoke('app:send-notification', payload),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  onUpdateProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('app:update-progress', listener);
    return () => {
      ipcRenderer.removeListener('app:update-progress', listener);
    };
  },
  onDataUpdatedOnDisk: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:data-updated-on-disk', listener);
    return () => {
      ipcRenderer.removeListener('app:data-updated-on-disk', listener);
    };
  },
});
