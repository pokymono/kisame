export interface ChatQueryResult {
  query: string;
  response: string;
  timestamp: string;
  context_available: boolean;
}

export interface TerminalAPI {
  listShells: () => Promise<{ label: string; path: string }[]>;
  create: (cols: number, rows: number, shellPath?: string) => Promise<{ success: boolean; id: string; error?: string }>;
  write: (id: string, data: string) => Promise<void>;
  resize: (id: string, cols: number, rows: number) => Promise<void>;
  kill: (id: string) => Promise<void>;
  onData: (handler: (id: string, data: string) => void) => () => void;
  onExit: (handler: (id: string, exitCode: number) => void) => () => void;
}

export interface ElectronAPI {
  platform: string;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
  openPcapAndAnalyze: (clientId?: string) => Promise<
    | { canceled: true }
    | { canceled: false; pcapPath: string; analysis: unknown }
  >;
  sendChatQuery: (
    query: string,
    context?: { session_id?: string; artifact?: unknown }
  ) => Promise<ChatQueryResult>;
  getBackendUrl: () => Promise<string>;
  saveExportFile: (payload: {
    suggestedName: string;
    content: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<{ canceled: true } | { canceled: false; filePath: string }>;
  saveExportBundle: (payload: {
    folderName?: string;
    files: { name: string; content: string }[];
  }) => Promise<{ canceled: true } | { canceled: false; folderPath: string; filesWritten: string[] }>;
  saveExportPdf: (payload: {
    html: string;
    suggestedName?: string;
    fileName?: string;
    folderPath?: string;
  }) => Promise<{ canceled: true } | { canceled: false; filePath: string }>;
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
