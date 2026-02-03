import { existsSync, readdirSync, statSync } from 'fs';
import type { PcapSession } from '../types';
import { ensureDir, getPcapDir } from '../utils/fs';
import { utcNowIso } from '../utils/response';
import { logInfo } from '../utils/logger';

const sessions = new Map<string, PcapSession>();

function hydrateSessionsFromDisk(): void {
  const pcapDir = getPcapDir();
  if (!existsSync(pcapDir)) return;

  let entries: string[] = [];
  try {
    entries = readdirSync(pcapDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.pcap') && !entry.endsWith('.pcapng')) continue;
    const dashIndex = entry.indexOf('-');
    if (dashIndex <= 0) continue;
    const id = entry.slice(0, dashIndex);
    if (sessions.has(id)) continue;

    const filePath = `${pcapDir}/${entry}`;
    try {
      const stats = statSync(filePath);
      const fileName = entry.slice(dashIndex + 1);
      sessions.set(id, {
        id,
        fileName,
        filePath,
        createdAt: stats.mtime.toISOString(),
        sizeBytes: stats.size,
      });
    } catch {
      // Ignore files we cannot stat.
    }
  }
}

export async function initPcapStorage(): Promise<void> {
  const pcapDir = getPcapDir();
  await ensureDir(pcapDir);
}

export async function storePcap(
  fileName: string,
  data: Uint8Array
): Promise<PcapSession> {
  const pcapDir = getPcapDir();
  const id = crypto.randomUUID();
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `${pcapDir}/${id}-${sanitizedName}`;

  await Bun.write(filePath, data);

  const session: PcapSession = {
    id,
    fileName,
    filePath,
    createdAt: utcNowIso(),
    sizeBytes: data.byteLength,
  };

  sessions.set(id, session);
  logInfo('pcap.session.store', { session_id: id, file_name: fileName, size_bytes: data.byteLength });
  return session;
}

export async function registerPcapFile(opts: {
  id?: string;
  fileName: string;
  filePath: string;
  sizeBytes?: number;
}): Promise<PcapSession> {
  const id = opts.id ?? crypto.randomUUID();
  const session: PcapSession = {
    id,
    fileName: opts.fileName,
    filePath: opts.filePath,
    createdAt: utcNowIso(),
    sizeBytes: opts.sizeBytes ?? 0,
  };

  sessions.set(id, session);
  logInfo('pcap.session.register', { session_id: id, file_name: opts.fileName, size_bytes: session.sizeBytes });
  return session;
}

export function getSession(id: string): PcapSession | undefined {
  let session = sessions.get(id);
  if (!session) {
    hydrateSessionsFromDisk();
    session = sessions.get(id);
  }
  return session;
}

export function listSessions(): PcapSession[] {
  hydrateSessionsFromDisk();
  return Array.from(sessions.values());
}
