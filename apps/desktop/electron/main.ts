import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { readFile } from 'fs/promises';
import * as path from 'path';

type OpenPcapAndAnalyzeResult =
  | { canceled: true }
  | { canceled: false; pcapPath: string; analysis: unknown };

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string } = {}
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ exitCode: typeof code === 'number' ? code : 1, stdout, stderr })
    );
  });
}

function getPythonCommand(): string {
  if (process.env.KISAME_PYTHON) return process.env.KISAME_PYTHON;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function getEngineEntryPath(): string {
  const appPath = app.getAppPath();
  return path.resolve(appPath, '..', '..', 'services', 'forensic-engine', 'main.py');
}

type KisameConfig = {
  backendUrl?: string;
};

function loadBackendUrlFromConfig(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as KisameConfig;
    if (!parsed.backendUrl) return null;
    return parsed.backendUrl.trim();
  } catch {
    return null;
  }
}

function getBunServiceUrl(): string {
  if (process.env.KISAME_BUN_URL) return process.env.KISAME_BUN_URL;

  const configPaths: string[] = [];
  if (process.env.KISAME_CONFIG_PATH) {
    configPaths.push(process.env.KISAME_CONFIG_PATH);
  }
  configPaths.push(path.join(app.getPath('userData'), 'kisame.config.json'));
  configPaths.push(path.join(app.getAppPath(), 'kisame.config.json'));

  for (const configPath of configPaths) {
    const url = loadBackendUrlFromConfig(configPath);
    if (url) return url;
  }

  return 'http://localhost:8787';
}

const createWindow = (): void => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // In development, load from Vite dev server
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    // In production, load the built files
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
};

ipcMain.handle('kisame:openPcapAndAnalyze', async (): Promise<OpenPcapAndAnalyzeResult> => {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const result = await dialog.showOpenDialog(win, {
    title: 'Open PCAP',
    properties: ['openFile'],
    filters: [
      { name: 'PCAP', extensions: ['pcap', 'pcapng'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };

  const pcapPath = result.filePaths[0];

  // Preferred path: upload to Bun service and run tshark there (AnalyzePCAP tool).
  const bunUrl = getBunServiceUrl();
  try {
    const bytes = await readFile(pcapPath);
    const uploadRes = await fetch(`${bunUrl}/pcap`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-filename': path.basename(pcapPath),
      },
      body: bytes,
    });
    if (!uploadRes.ok) {
      const msg = await uploadRes.text().catch(() => '');
      throw new Error(`Bun upload failed (${uploadRes.status}). ${msg}`);
    }
    const uploaded = (await uploadRes.json()) as { session_id: string };

    const analyzeBody: { session_id: string; max_packets?: number } = { session_id: uploaded.session_id };
    if (process.env.KISAME_MAX_PACKETS) analyzeBody.max_packets = Number(process.env.KISAME_MAX_PACKETS);

    const analyzeRes = await fetch(`${bunUrl}/tools/analyzePcap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(analyzeBody),
    });
    if (!analyzeRes.ok) {
      const msg = await analyzeRes.text().catch(() => '');
      throw new Error(`Bun analyze failed (${analyzeRes.status}). ${msg}`);
    }
    const analysis = (await analyzeRes.json()) as unknown;
    return { canceled: false, pcapPath, analysis };
  } catch (e) {
    // Fallback: local Python engine (still uses tshark locally).
    const python = getPythonCommand();
    const enginePath = getEngineEntryPath();

    const args: string[] = [enginePath, 'analyze', pcapPath];
    if (process.env.KISAME_MAX_PACKETS) {
      args.push('--max-packets', process.env.KISAME_MAX_PACKETS);
    }
    if (process.env.KISAME_SKIP_HASH !== '0') {
      args.push('--skip-hash');
    }

    const { exitCode, stdout, stderr } = await runCommand(python, args, { cwd: app.getAppPath() });
    if (exitCode !== 0) {
      throw new Error(
        `Bun analyze failed (${(e as Error).message ?? String(e)}), and local engine also failed (exit ${exitCode}).\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}`
      );
    }
    let analysis: unknown;
    try {
      analysis = JSON.parse(stdout);
    } catch (err) {
      throw new Error(
        `Bun analyze failed (${(e as Error).message ?? String(e)}), and local engine returned non-JSON.\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}`
      );
    }
    return { canceled: false, pcapPath, analysis };
  }
});

ipcMain.handle('kisame:getBackendUrl', async (): Promise<string> => {
  return getBunServiceUrl();
});

type ChatQueryResult = {
  query: string;
  response: string;
  timestamp: string;
  context_available: boolean;
};

ipcMain.handle(
  'kisame:sendChatQuery',
  async (
    _event,
    query: string,
    context?: { session_id?: string; artifact?: unknown }
  ): Promise<ChatQueryResult> => {
    const bunUrl = getBunServiceUrl();

    try {
      const res = await fetch(`${bunUrl}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, context }),
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Chat request failed (${res.status}). ${msg}`);
      }

      return (await res.json()) as ChatQueryResult;
    } catch (e) {
      // Return error as a response so the UI can display it
      return {
        query,
        response: `Error: ${(e as Error).message ?? String(e)}`,
        timestamp: new Date().toISOString(),
        context_available: false,
      };
    }
  }
);

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
