/**
 * PCAP Session Manager
 * Handles PCAP storage and retrieval
 */
import type { PcapSession } from '../types';
import { ensureDir, getPcapDir } from '../utils/fs';
import { utcNowIso } from '../utils/response';

// In-memory session store
const sessions = new Map<string, PcapSession>();

/**
 * Initialize the PCAP storage directory
 */
export async function initPcapStorage(): Promise<void> {
  const pcapDir = getPcapDir();
  await ensureDir(pcapDir);
}

/**
 * Store a new PCAP file and create a session
 */
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
  return session;
}

/**
 * Get a session by ID
 */
export function getSession(id: string): PcapSession | undefined {
  return sessions.get(id);
}

/**
 * List all sessions
 */
export function listSessions(): PcapSession[] {
  return Array.from(sessions.values());
}
