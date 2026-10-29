'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  ingestDrop: (p) => ipcRenderer.invoke('ingest-drop', p),
  applyIcon: (folder, sizes) => ipcRenderer.invoke('apply-icon', { folder, sizes }),
  restoreIcon: (folder) => ipcRenderer.invoke('restore-icon', { folder }),
  getState: (folder) => ipcRenderer.invoke('get-state', { folder }),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
});
