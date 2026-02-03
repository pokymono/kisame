import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { spawn } from 'child_process';
import { existsSync, readFileSync, createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { ReadableStream } from 'stream/web';
import * as path from 'path';

type OpenPcapAndAnalyzeResult =
  | { canceled: true }
  | { canceled: false; pcapPath: string; analysis: unknown };

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
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

function resolveLocalTsharkPath(): string | null {
  const fromEnv = (process.env.TSHARK_PATH || '').trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  if (process.platform === 'win32') {
    const candidates = [
      'C:\\\\Program Files\\\\Wireshark\\\\tshark.exe',
      'C:\\\\Program Files (x86)\\\\Wireshark\\\\tshark.exe',
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
  }

  return null;
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

type UploadProgressEvent = {
  stage: 'idle' | 'upload' | 'analyze' | 'done' | 'error';
  loaded?: number;
  total?: number;
  percent?: number;
  message?: string;
};

function sendUploadProgress(win: BrowserWindow | undefined, event: UploadProgressEvent) {
  if (!win) return;
  win.webContents.send('kisame:uploadProgress', event);
}

async function ensureBackendTshark(bunUrl: string): Promise<void> {
  const res = await fetch(`${bunUrl}/tshark/version`);
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Backend tshark check failed (${res.status}). ${msg}`);
  }
  const data = (await res.json()) as { resolved?: boolean; tshark_path?: string | null };
  if (!data?.resolved) {
    throw new Error(
      `Backend at ${bunUrl} is missing tshark. Install Wireshark/tshark on the backend VM or set TSHARK_PATH. You can run scripts/setup-backend.sh on the VM.`
    );
  }
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
    await ensureBackendTshark(bunUrl);
    const stats = await stat(pcapPath);
    const total = stats.size;
    let loaded = 0;
    let lastEmit = 0;

    sendUploadProgress(win, { stage: 'upload', loaded: 0, total, percent: 0 });

    const fileStream = createReadStream(pcapPath);
    const uploadStream = new ReadableStream<Uint8Array>({
      start(controller) {
        fileStream.on('data', (chunk: string | Buffer) => {
          const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
          loaded += buffer.length;
          controller.enqueue(new Uint8Array(buffer));
          const now = Date.now();
          if (now - lastEmit > 80 || loaded === total) {
            lastEmit = now;
            const percent = total ? Math.round((loaded / total) * 100) : undefined;
            sendUploadProgress(win, { stage: 'upload', loaded, total, percent });
          }
        });
        fileStream.on('end', () => {
          controller.close();
          sendUploadProgress(win, { stage: 'upload', loaded: total, total, percent: 100 });
        });
        fileStream.on('error', (err) => controller.error(err));
      },
      cancel() {
        fileStream.destroy();
      },
    });

    const uploadRes = await fetch(`${bunUrl}/pcap`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-filename': path.basename(pcapPath),
      },
      body: uploadStream as unknown as ReadableStream,
      // Required for streaming request bodies in Node/Electron fetch.
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    if (!uploadRes.ok) {
      const msg = await uploadRes.text().catch(() => '');
      throw new Error(`Bun upload failed (${uploadRes.status}). ${msg}`);
    }
    const uploaded = (await uploadRes.json()) as { session_id: string };

    sendUploadProgress(win, { stage: 'analyze' });

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
    sendUploadProgress(win, { stage: 'done' });
    return { canceled: false, pcapPath, analysis };
  } catch (e) {
    sendUploadProgress(win, { stage: 'error', message: (e as Error).message ?? String(e) });
    // Fallback: local Python engine (still uses tshark locally).
    const python = getPythonCommand();
    const enginePath = getEngineEntryPath();
    const localTshark = resolveLocalTsharkPath();
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...(localTshark ? { TSHARK_PATH: localTshark } : {}),
    };

    const args: string[] = [enginePath, 'analyze', pcapPath];
    if (localTshark) {
      args.push('--tshark', localTshark);
    }
    if (process.env.KISAME_MAX_PACKETS) {
      args.push('--max-packets', process.env.KISAME_MAX_PACKETS);
    }
    if (process.env.KISAME_SKIP_HASH !== '0') {
      args.push('--skip-hash');
    }

    const { exitCode, stdout, stderr } = await runCommand(python, args, {
      cwd: app.getAppPath(),
      env: childEnv,
    });
    if (exitCode !== 0) {
      throw new Error(
        `Bun analyze failed (${(e as Error).message ?? String(e)}), and local engine also failed (exit ${exitCode}).\n\nLocal tshark: ${
          localTshark ?? 'not found (set TSHARK_PATH to C:\\\\Program Files\\\\Wireshark\\\\tshark.exe)'
        }\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}`
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
    sendUploadProgress(win, { stage: 'done' });
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
