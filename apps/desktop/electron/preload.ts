// Preload script for secure communication between main and renderer processes
import { contextBridge, ipcRenderer } from 'electron';

type ChatQueryResult = {
  query: string;
  response: string;
  timestamp: string;
  context_available: boolean;
};

type UploadProgressEvent = {
  stage: 'idle' | 'upload' | 'analyze' | 'done' | 'error';
  loaded?: number;
  total?: number;
  percent?: number;
  message?: string;
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
  getBackendUrl: () => ipcRenderer.invoke('kisame:getBackendUrl') as Promise<string>,
  onUploadProgress: (handler: (event: UploadProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: UploadProgressEvent) => {
      handler(payload);
    };
    ipcRenderer.on('kisame:uploadProgress', listener);
    return () => ipcRenderer.removeListener('kisame:uploadProgress', listener);
  },
  
  // Terminal APIs (multi-instance)
  terminal: {
    create: (cols: number, rows: number) => 
      ipcRenderer.invoke('terminal:create', cols, rows) as Promise<{ success: boolean; id: string }>,
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke('terminal:kill', id),
    onData: (handler: (id: string, data: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { id: string; data: string }) => {
        handler(payload.id, payload.data);
      };
      ipcRenderer.on('terminal:data', listener);
      return () => ipcRenderer.removeListener('terminal:data', listener);
    },
    onExit: (handler: (id: string, exitCode: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { id: string; exitCode: number }) => {
        handler(payload.id, payload.exitCode);
      };
      ipcRenderer.on('terminal:exit', listener);
      return () => ipcRenderer.removeListener('terminal:exit', listener);
    },
  },
});
