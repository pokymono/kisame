// Preload script for secure communication between main and renderer processes
import { contextBridge, ipcRenderer } from 'electron';

type ChatQueryResult = {
  query: string;
  response: string;
  timestamp: string;
  context_available: boolean;
};

contextBridge.exposeInMainWorld('electronAPI', {
  // Add your exposed APIs here
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  openPcapAndAnalyze: () => ipcRenderer.invoke('kisame:openPcapAndAnalyze'),
  sendChatQuery: (query: string, context?: { session_id?: string; artifact?: unknown }) =>
    ipcRenderer.invoke('kisame:sendChatQuery', query, context) as Promise<ChatQueryResult>,
});
