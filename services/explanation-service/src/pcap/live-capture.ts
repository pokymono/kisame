import { statSync } from 'fs';
import type { PcapSession } from '../types';
import { ensureDir, getPcapDir } from '../utils/fs';
import { utcNowIso } from '../utils/response';
import { registerPcapFile } from './session-manager';
import { resolveTsharkPath } from './tshark';

export type CaptureInterface = {
  id: string;
  name: string;
  description?: string;
};

export type LiveCapture = {
  id: string;
  interfaceId: string;
  interfaceName: string;
  fileName: string;
  filePath: string;
  startedAt: string;
  process: Bun.Subprocess;
  stdout: string;
  stderr: string;
};

const activeCaptures = new Map<string, LiveCapture>();

function parseInterfaceLine(line: string): CaptureInterface | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d+)\.\s+([^\s]+)\s*(?:\((.+)\))?$/);
  if (!match) return null;
  const [, id, name, description] = match;
  if (!id || !name) return null;
  return {
    id,
    name,
    description: description?.trim() || undefined,
  };
}

export async function listCaptureInterfaces(): Promise<CaptureInterface[]> {
  const tsharkPath = resolveTsharkPath();
  if (!tsharkPath) {
    throw new Error(
      'tshark was not found. Install Wireshark or set TSHARK_PATH to the tshark binary (macOS default: /Applications/Wireshark.app/Contents/MacOS/tshark).'
    );
  }

  const proc = Bun.spawn([tsharkPath, '-D'], { stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`tshark -D failed (exit ${exitCode}).\n\nstderr:\n${stderr}`);
  }

  return stdout
    .split('\n')
    .map(parseInterfaceLine)
    .filter((entry): entry is CaptureInterface => Boolean(entry));
}

function chooseDefaultInterface(interfaces: CaptureInterface[]): CaptureInterface {
  const isLikelyGood = (name: string) =>
    /^en\d+$/i.test(name) || /^bridge\d+$/i.test(name);

  const isNoisyOrRestricted = (name: string) =>
    /^lo\d*$/i.test(name) ||
    /^utun\d+$/i.test(name) ||
    /^awdl\d+$/i.test(name) ||
    /^llw\d+$/i.test(name) ||
    /^p2p\d+$/i.test(name);

  const preferred = interfaces.find((iface) => isLikelyGood(iface.name));
  if (preferred) return preferred;

  const nonRestricted = interfaces.find((iface) => !isNoisyOrRestricted(iface.name));
  return nonRestricted ?? interfaces[0]!;
}

export type StartCaptureOptions = {
  interfaceId?: string;
  durationSeconds?: number;
  maxPackets?: number;
  fileName?: string;
  captureFilter?: string;
};

export async function startLiveCapture(opts: StartCaptureOptions): Promise<LiveCapture> {
  const tsharkPath = resolveTsharkPath();
  if (!tsharkPath) {
    throw new Error(
      'tshark was not found. Install Wireshark or set TSHARK_PATH to the tshark binary (macOS default: /Applications/Wireshark.app/Contents/MacOS/tshark).'
    );
  }

  const interfaces = await listCaptureInterfaces();
  if (interfaces.length === 0) {
    throw new Error('No capture interfaces available.');
  }

  const iface =
    interfaces.find((entry) => entry.id === opts.interfaceId || entry.name === opts.interfaceId) ??
    chooseDefaultInterface(interfaces);

  const pcapDir = getPcapDir();
  await ensureDir(pcapDir);

  const id = crypto.randomUUID();
  const safeName = (opts.fileName ?? `live-${new Date().toISOString()}.pcap`)
    .replace(/[:]/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `${pcapDir}/${id}-${safeName}`;

  const args = [tsharkPath, '-i', iface.id, '-w', filePath, '-n'];
  if (opts.durationSeconds && opts.durationSeconds > 0) {
    args.push('-a', `duration:${Math.floor(opts.durationSeconds)}`);
  }
  if (opts.maxPackets && opts.maxPackets > 0) {
    args.push('-c', `${Math.floor(opts.maxPackets)}`);
  }
  if (opts.captureFilter) {
    args.push('-f', opts.captureFilter);
  }

  const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  const liveCapture: LiveCapture = {
    id,
    interfaceId: iface.id,
    interfaceName: iface.name,
    fileName: safeName,
    filePath,
    startedAt: utcNowIso(),
    process: proc,
    stdout: '',
    stderr: '',
  };

  const decoder = new TextDecoder();
  if (proc.stdout) {
    void (async () => {
      const reader = proc.stdout.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        liveCapture.stdout += decoder.decode(value, { stream: true });
      }
      liveCapture.stdout += decoder.decode();
    })();
  }

  if (proc.stderr) {
    void (async () => {
      const reader = proc.stderr.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        liveCapture.stderr += decoder.decode(value, { stream: true });
      }
      liveCapture.stderr += decoder.decode();
    })();
  }

  // Give tshark a moment to initialize. If it exits immediately, surface the error.
  const earlyExit = await Promise.race([
    proc.exited.then((code) => code),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 400)),
  ]);
  if (earlyExit !== null && earlyExit !== 0) {
    activeCaptures.delete(id);
    throw new Error(
      `Live capture failed to start (exit ${earlyExit}).\n\nstderr:\n${liveCapture.stderr || 'No stderr output.'}`
    );
  }

  activeCaptures.set(id, liveCapture);
  return liveCapture;
}

export async function stopLiveCapture(captureId: string): Promise<{
  session: PcapSession;
  exitCode: number;
}> {
  const capture = activeCaptures.get(captureId);
  if (!capture) {
    throw new Error('Unknown capture_id');
  }

  try {
    capture.process.kill('SIGINT');
  } catch {
  }

  const exitCode = await capture.process.exited;
  activeCaptures.delete(captureId);

  // Ensure the file exists and has a size before registering.
  let sizeBytes = 0;
  try {
    sizeBytes = statSync(capture.filePath).size;
  } catch (error) {
    const stderr = capture.stderr?.trim();
    const extra = stderr ? `\n\nstderr:\n${stderr}` : '';
    throw new Error(
      `Captured file missing or unreadable: ${(error as Error).message ?? String(error)}${extra}`
    );
  }
  const session = await registerPcapFile({
    id: capture.id,
    fileName: capture.fileName,
    filePath: capture.filePath,
    sizeBytes,
  });

  return { session, exitCode };
}

export function getLiveCapture(captureId: string): LiveCapture | undefined {
  return activeCaptures.get(captureId);
}
