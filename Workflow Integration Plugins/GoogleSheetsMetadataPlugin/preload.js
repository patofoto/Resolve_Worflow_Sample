const { contextBridge, ipcRenderer } = require('electron/renderer');

contextBridge.exposeInMainWorld('resolveAPI', {
    loadSheetPreview: (config) => ipcRenderer.invoke('resolve:loadSheetPreview', config),
    applySheetMetadata: (payload) => ipcRenderer.invoke('resolve:applySheetMetadata', payload),
    pickCredentialsFile: () => ipcRenderer.invoke('resolve:pickCredentialsFile'),
    cleanupResolveInterface: () => ipcRenderer.invoke('resolve:cleanupResolveInterface')
});
