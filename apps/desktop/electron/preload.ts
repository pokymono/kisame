// Preload script for secure communication between main and renderer processes
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Add your exposed APIs here
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  openPcapAndAnalyze: () => ipcRenderer.invoke('kisame:openPcapAndAnalyze'),
});
