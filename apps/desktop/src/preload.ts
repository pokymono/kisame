// Preload script for secure communication between main and renderer processes
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Add your exposed APIs here
  platform: process.platform
});
