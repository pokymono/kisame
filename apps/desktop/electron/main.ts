import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { spawn } from 'child_process';
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

function getBunServiceUrl(): string {
  return process.env.KISAME_BUN_URL ?? 'http://localhost:8787';
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
