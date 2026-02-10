import { statSync, openSync, readSync, closeSync } from 'fs';
import type { PcapSession } from '../types';
import { ensureDir, getPcapDir } from '../utils/fs';
import { utcNowIso } from '../utils/response';
import { registerPcapFile } from './session-manager';
import { resolveTsharkPath } from './tshark';
import { logInfo, logWarn, logError, toErrorMeta } from '../utils/logger';

const isWindows = process.platform === 'win32';

export type CaptureInterface = {
  id: string;
  name: string;
  description?: string;
};

export type LiveCapture = {
  id: string;
  ownerId?: string;
  interfaceId: string;
  interfaceName: string;
  fileName: string;
  filePath: string;
  startedAt: string;
  process: Bun.Subprocess;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  endedAt: string | null;
  stats: {
    sizeBytes: number;
    packetCount: number;
    parseOffset: number;
    format: 'unknown' | 'pcap' | 'pcapng';
    endian: 'le' | 'be' | null;
  };
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
    const hint = isWindows
      ? 'Install Wireshark (https://wireshark.org) or set TSHARK_PATH to the tshark.exe path.'
      : 'Install Wireshark or set TSHARK_PATH to the tshark binary.';
    throw new Error(`tshark was not found. ${hint}`);
  }

  const proc = Bun.spawn([tsharkPath, '-D'], { stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    logError('capture.interfaces.error', { exit_code: exitCode, stderr_preview: stderr.slice(0, 400) });
    throw new Error(`tshark -D failed (exit ${exitCode}).\n\nstderr:\n${stderr}`);
  }

  const interfaces = stdout
    .split('\n')
    .map(parseInterfaceLine)
    .filter((entry): entry is CaptureInterface => Boolean(entry));
  logInfo('capture.interfaces.list', { count: interfaces.length });
  return interfaces;
}

function chooseDefaultInterface(interfaces: CaptureInterface[]): CaptureInterface {
  // Likely good interface patterns by platform
  const isLikelyGood = (name: string) => {
    if (isWindows) {
      // Windows: Prefer Ethernet or Wi-Fi adapters
      return /ethernet/i.test(name) || /wi-?fi/i.test(name) || /wireless/i.test(name);
    }
    // macOS/Linux: en0, eth0, bridge0, etc.
    return /^en\d+$/i.test(name) || /^eth\d+$/i.test(name) || /^bridge\d+$/i.test(name);
  };

  const isNoisyOrRestricted = (name: string) => {
    if (isWindows) {
      // Windows: Skip loopback and virtual adapters
      return /loopback/i.test(name) || /npcap/i.test(name) || /virtual/i.test(name);
    }
    // macOS/Linux: Skip loopback, VPN tunnels, and Apple-specific interfaces
    return (
      /^lo\d*$/i.test(name) ||
      /^utun\d+$/i.test(name) ||
      /^awdl\d+$/i.test(name) ||
      /^llw\d+$/i.test(name) ||
      /^p2p\d+$/i.test(name)
    );
  };

  const preferred = interfaces.find((iface) => isLikelyGood(iface.name) || isLikelyGood(iface.description ?? ''));
  if (preferred) return preferred;

  const nonRestricted = interfaces.find((iface) => !isNoisyOrRestricted(iface.name) && !isNoisyOrRestricted(iface.description ?? ''));
  return nonRestricted ?? interfaces[0]!;
}

function readFileSlice(filePath: string, start: number, end: number): Uint8Array {
  const length = Math.max(0, end - start);
  if (length === 0) return new Uint8Array();
  let fd: number | null = null;
  try {
    fd = openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = readSync(fd, buffer, 0, length, start);
    return bytesRead === length ? buffer : buffer.subarray(0, Math.max(0, bytesRead));
  } catch {
    return new Uint8Array();
  } finally {
    if (fd != null) closeSync(fd);
  }
}

function detectPcapEndian(header: Uint8Array): 'le' | 'be' | null {
  if (header.length < 4) return null;
  const b0 = header[0];
  const b1 = header[1];
  const b2 = header[2];
  const b3 = header[3];
  if (b0 === 0xd4 && b1 === 0xc3 && b2 === 0xb2 && b3 === 0xa1) return 'le';
  if (b0 === 0xa1 && b1 === 0xb2 && b2 === 0xc3 && b3 === 0xd4) return 'be';
  if (b0 === 0x4d && b1 === 0x3c && b2 === 0xb2 && b3 === 0xa1) return 'le';
  if (b0 === 0xa1 && b1 === 0xb2 && b2 === 0x3c && b3 === 0x4d) return 'be';
  return null;
}

function detectPcapngEndian(header: Uint8Array): 'le' | 'be' | null {
  if (header.length < 12) return null;
  const b8 = header[8];
  const b9 = header[9];
  const b10 = header[10];
  const b11 = header[11];
  if (b8 === 0x1a && b9 === 0x2b && b10 === 0x3c && b11 === 0x4d) return 'be';
  if (b8 === 0x4d && b9 === 0x3c && b10 === 0x2b && b11 === 0x1a) return 'le';
  return null;
}

function initCaptureStats(): LiveCapture['stats'] {
  return {
    sizeBytes: 0,
    packetCount: 0,
    parseOffset: 0,
    format: 'unknown',
    endian: null,
  };
}

function updateCaptureStats(capture: LiveCapture): { sizeBytes: number; packetCount: number } {
  let sizeBytes = 0;
  try {
    sizeBytes = statSync(capture.filePath).size;
  } catch {
    capture.stats.sizeBytes = 0;
    return { sizeBytes: 0, packetCount: capture.stats.packetCount };
  }

  if (sizeBytes < capture.stats.parseOffset) {
    capture.stats = initCaptureStats();
  }

  capture.stats.sizeBytes = sizeBytes;
  if (sizeBytes === 0) {
    return { sizeBytes, packetCount: capture.stats.packetCount };
  }

  if (capture.stats.format === 'unknown') {
    const header = readFileSlice(capture.filePath, 0, Math.min(32, sizeBytes));
    const isPcapng =
      header.length >= 4 &&
      header[0] === 0x0a &&
      header[1] === 0x0d &&
      header[2] === 0x0d &&
      header[3] === 0x0a;
    if (isPcapng) {
      capture.stats.format = 'pcapng';
      capture.stats.endian = detectPcapngEndian(header);
      capture.stats.parseOffset = 0;
    } else {
      const endian = detectPcapEndian(header);
      if (endian) {
        capture.stats.format = 'pcap';
        capture.stats.endian = endian;
        capture.stats.parseOffset = sizeBytes >= 24 ? 24 : 0;
      }
    }
  }

  if (capture.stats.format === 'unknown') {
    return { sizeBytes, packetCount: capture.stats.packetCount };
  }

  if (capture.stats.format === 'pcap' && capture.stats.parseOffset === 0 && sizeBytes >= 24) {
    capture.stats.parseOffset = 24;
  }

  if (capture.stats.format === 'pcapng' && capture.stats.endian == null) {
    const header = readFileSlice(capture.filePath, 0, Math.min(32, sizeBytes));
    capture.stats.endian = detectPcapngEndian(header);
    if (capture.stats.endian == null) {
      return { sizeBytes, packetCount: capture.stats.packetCount };
    }
  }

  if (sizeBytes <= capture.stats.parseOffset) {
    return { sizeBytes, packetCount: capture.stats.packetCount };
  }

  const slice = readFileSlice(capture.filePath, capture.stats.parseOffset, sizeBytes);
  const view = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
  let localOffset = 0;
  const littleEndian = capture.stats.endian === 'le';

  if (capture.stats.format === 'pcap') {
    while (localOffset + 16 <= slice.length) {
      const inclLen = view.getUint32(localOffset + 8, littleEndian);
      const recordLen = 16 + inclLen;
      if (recordLen <= 16 || localOffset + recordLen > slice.length) break;
      capture.stats.packetCount += 1;
      localOffset += recordLen;
    }
  } else if (capture.stats.format === 'pcapng') {
    while (localOffset + 8 <= slice.length) {
      const blockType = view.getUint32(localOffset, littleEndian);
      const blockLen = view.getUint32(localOffset + 4, littleEndian);
      if (blockLen < 12 || localOffset + blockLen > slice.length) break;
      if (blockType === 0x00000006 || blockType === 0x00000003 || blockType === 0x00000002) {
        capture.stats.packetCount += 1;
      }
      localOffset += blockLen;
    }
  }

  capture.stats.parseOffset += localOffset;
  return { sizeBytes, packetCount: capture.stats.packetCount };
}

export type StartCaptureOptions = {
  interfaceId?: string;
  durationSeconds?: number;
  maxPackets?: number;
  fileName?: string;
  captureFilter?: string;
  ownerId?: string;
};

export async function startLiveCapture(opts: StartCaptureOptions): Promise<LiveCapture> {
  const tsharkPath = resolveTsharkPath();
  if (!tsharkPath) {
    const hint = isWindows
      ? 'Install Wireshark (https://wireshark.org) or set TSHARK_PATH to the tshark.exe path.'
      : 'Install Wireshark or set TSHARK_PATH to the tshark binary.';
    throw new Error(`tshark was not found. ${hint}`);
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
  logInfo('capture.start', {
    capture_id: id,
    interface_id: iface.id,
    interface_name: iface.name,
    file_name: safeName,
    file_path: filePath,
  });
  const liveCapture: LiveCapture = {
    id,
    ownerId: opts.ownerId,
    interfaceId: iface.id,
    interfaceName: iface.name,
    fileName: safeName,
    filePath,
    startedAt: utcNowIso(),
    process: proc,
    stdout: '',
    stderr: '',
    exitCode: null,
    endedAt: null,
    stats: initCaptureStats(),
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

  void (async () => {
    const exitCode = await proc.exited;
    liveCapture.exitCode = exitCode;
    liveCapture.endedAt = utcNowIso();
    if (exitCode !== 0) {
      logWarn('capture.process.exit', { capture_id: id, exit_code: exitCode });
    }
  })();

  // Give tshark a moment to initialize. If it exits immediately, surface the error.
  const earlyExit = await Promise.race([
    proc.exited.then((code) => code),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 400)),
  ]);
  if (earlyExit !== null && earlyExit !== 0) {
    activeCaptures.delete(id);
    logError('capture.start.error', {
      capture_id: id,
      exit_code: earlyExit,
      stderr_preview: liveCapture.stderr.slice(0, 400),
    });
    throw new Error(
      `Live capture failed to start (exit ${earlyExit}).\n\nstderr:\n${liveCapture.stderr || 'No stderr output.'}`
    );
  }

  activeCaptures.set(id, liveCapture);
  return liveCapture;
}

export async function stopLiveCapture(
  captureId: string,
  ownerId?: string
): Promise<{
  session: PcapSession;
  exitCode: number;
}> {
  const capture = activeCaptures.get(captureId);
  if (!capture) {
    throw new Error('Unknown capture_id');
  }
  if (ownerId && capture.ownerId && capture.ownerId !== ownerId) {
    throw new Error('Unknown capture_id');
  }

  logInfo('capture.stop.request', { capture_id: captureId });
  try {
    // Windows doesn't support SIGINT; use SIGTERM or just kill
    capture.process.kill(isWindows ? 'SIGTERM' : 'SIGINT');
  } catch {
    // Ignore kill errors
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
    logError('capture.stop.error', { capture_id: captureId, error: toErrorMeta(error) });
    throw new Error(
      `Captured file missing or unreadable: ${(error as Error).message ?? String(error)}${extra}`
    );
  }
  const session = await registerPcapFile({
    id: capture.id,
    fileName: capture.fileName,
    filePath: capture.filePath,
    sizeBytes,
    ownerId: capture.ownerId ?? ownerId,
  });

  logInfo('capture.stop.complete', { capture_id: captureId, session_id: session.id, exit_code: exitCode });
  return { session, exitCode };
}

export function getLiveCapture(captureId: string): LiveCapture | undefined {
  return activeCaptures.get(captureId);
}

export function getLiveCaptureStats(captureId: string): { sizeBytes: number; packetCount: number } | null {
  const capture = activeCaptures.get(captureId);
  if (!capture) return null;
  return updateCaptureStats(capture);
}
