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
  
  // Terminal APIs
  terminal: {
    create: (cols: number, rows: number) => ipcRenderer.invoke('terminal:create', cols, rows),
    write: (data: string) => ipcRenderer.invoke('terminal:write', data),
    resize: (cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', cols, rows),
    kill: () => ipcRenderer.invoke('terminal:kill'),
    onData: (handler: (data: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: string) => handler(data);
      ipcRenderer.on('terminal:data', listener);
      return () => ipcRenderer.removeListener('terminal:data', listener);
    },
    onExit: (handler: (exitCode: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, exitCode: number) => handler(exitCode);
      ipcRenderer.on('terminal:exit', listener);
      return () => ipcRenderer.removeListener('terminal:exit', listener);
    },
  },
});
