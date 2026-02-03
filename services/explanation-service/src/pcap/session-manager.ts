import type { PcapSession } from '../types';
import { ensureDir, getPcapDir } from '../utils/fs';
import { utcNowIso } from '../utils/response';
import { logInfo } from '../utils/logger';

const sessions = new Map<string, PcapSession>();

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
  return sessions.get(id);
}

export function listSessions(): PcapSession[] {
  return Array.from(sessions.values());
}
