export interface ChatQueryResult {
  query: string;
  response: string;
  timestamp: string;
  context_available: boolean;
}

export interface TerminalAPI {
  create: (cols: number, rows: number) => Promise<{ success: boolean }>;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  kill: () => Promise<void>;
  onData: (handler: (data: string) => void) => () => void;
  onExit: (handler: (exitCode: number) => void) => () => void;
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
  terminal: TerminalAPI;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
