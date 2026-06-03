const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  getVanillaVersion: (versionId) => ipcRenderer.invoke('get-vanilla-version', versionId),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  uploadSkin: (payload) => ipcRenderer.invoke('upload-skin', payload),
  getSkin: (username) => ipcRenderer.invoke('get-skin', username),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectJavaFile: () => ipcRenderer.invoke('select-java-file'),
  windowControl: (action) => ipcRenderer.invoke('window-control', action),
  getMcVersions: () => ipcRenderer.invoke('get-mc-versions'),
  getLocalVersions: () => ipcRenderer.invoke('get-local-versions'),
  launchGame: (launchConfig) => ipcRenderer.invoke('launch-game', launchConfig),
  installMod: (payload) => ipcRenderer.invoke('install-mod', payload),
  installModpack: (payload) => ipcRenderer.invoke('install-modpack', payload),
  uploadCape: (payload) => ipcRenderer.invoke('upload-cape', payload),
  getCape: (username) => ipcRenderer.invoke('get-cape', username),
  analyzeLogs: (payload) => ipcRenderer.invoke('analyze-logs', payload),
  resetLauncher: () => ipcRenderer.invoke('reset-launcher'),
  installFabric: (gameVersion) => ipcRenderer.invoke('install-fabric', { gameVersion }),
  installForge: (gameVersion) => ipcRenderer.invoke('install-forge', { gameVersion }),
  openInstanceFolder: (instanceId) => ipcRenderer.invoke('open-instance-folder', instanceId),
  selectExternalClient: () => ipcRenderer.invoke('select-external-client'),
  
  // Event listeners
  onLaunchProgress: (callback) => ipcRenderer.on('launch-progress', (event, progress) => callback(progress)),
  onLaunchDownloadStatus: (callback) => ipcRenderer.on('launch-download-status', (event, status) => callback(status)),
  onLaunchStarted: (callback) => ipcRenderer.on('launch-started', () => callback()),
  onLaunchLogBatch: (callback) => ipcRenderer.on('launch-log-batch', (event, batch) => callback(batch)),
  onLaunchClosed: (callback) => ipcRenderer.on('launch-closed', (event, code) => callback(code)),
  onLaunchError: (callback) => ipcRenderer.on('launch-error', (event, error) => callback(error)),
  
  // Helper to remove all listeners
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('launch-progress');
    ipcRenderer.removeAllListeners('launch-download-status');
    ipcRenderer.removeAllListeners('launch-started');
    ipcRenderer.removeAllListeners('launch-log-batch');
    ipcRenderer.removeAllListeners('launch-closed');
    ipcRenderer.removeAllListeners('launch-error');
  }
});
