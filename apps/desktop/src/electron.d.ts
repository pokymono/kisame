// Type definitions for Electron API exposed via preload script

export interface ElectronAPI {
  platform: string;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
  openPcapAndAnalyze: () => Promise<
    | { canceled: true }
    | { canceled: false; pcapPath: string; analysis: unknown }
  >;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
