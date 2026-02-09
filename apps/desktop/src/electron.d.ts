export interface ChatQueryResult {
  query: string;
  response: string;
  timestamp: string;
  context_available: boolean;
}

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
  sendChatQuery: (
    query: string,
    context?: { session_id?: string; artifact?: unknown }
  ) => Promise<ChatQueryResult>;
  getBackendUrl: () => Promise<string>;
  onUploadProgress: (
    handler: (event: {
      stage: 'idle' | 'upload' | 'analyze' | 'done' | 'error';
      loaded?: number;
      total?: number;
      percent?: number;
      message?: string;
    }) => void
  ) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
