import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import type { PcapSession } from '../types';
import { ensureDir, getPcapDir } from '../utils/fs';
import { utcNowIso } from '../utils/response';
import { logInfo } from '../utils/logger';

const sessions = new Map<string, PcapSession>();
const SESSION_META_SUFFIX = '.meta.json';

type SessionMeta = {
  id?: string;
  fileName?: string;
  createdAt?: string;
  sizeBytes?: number;
  ownerId?: string;
};

function getMetaPath(pcapDir: string, id: string): string {
  return `${pcapDir}/${id}${SESSION_META_SUFFIX}`;
}

function readSessionMeta(pcapDir: string, id: string): SessionMeta | null {
  try {
    const raw = readFileSync(getMetaPath(pcapDir, id), 'utf-8');
    const parsed = JSON.parse(raw) as SessionMeta;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeSessionMeta(session: PcapSession): Promise<void> {
  try {
    const payload: SessionMeta = {
      id: session.id,
      fileName: session.fileName,
      createdAt: session.createdAt,
      sizeBytes: session.sizeBytes,
      ownerId: session.ownerId,
    };
    await Bun.write(getMetaPath(getPcapDir(), session.id), JSON.stringify(payload));
  } catch {
    // Best-effort only; metadata should not block PCAP storage.
  }
}

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

    let id = '';
    let fileName = '';
    const uuidMatch = entry.match(/^([0-9a-fA-F-]{36})-(.+)$/);
    if (uuidMatch?.[1] && uuidMatch?.[2]) {
      id = uuidMatch[1];
      fileName = uuidMatch[2];
    } else {
      const dashIndex = entry.indexOf('-');
      if (dashIndex <= 0) continue;
      id = entry.slice(0, dashIndex);
      fileName = entry.slice(dashIndex + 1);
    }

    if (sessions.has(id)) continue;

    const filePath = `${pcapDir}/${entry}`;
    try {
      const stats = statSync(filePath);
      const meta = readSessionMeta(pcapDir, id);
      sessions.set(id, {
        id,
        fileName: meta?.fileName ?? fileName,
        filePath,
        createdAt: meta?.createdAt ?? stats.mtime.toISOString(),
        sizeBytes: typeof meta?.sizeBytes === 'number' ? meta.sizeBytes : stats.size,
        ownerId: meta?.ownerId,
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
  data: Uint8Array,
  ownerId?: string
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
    ownerId,
  };

  sessions.set(id, session);
  await writeSessionMeta(session);
  logInfo('pcap.session.store', { session_id: id, file_name: fileName, size_bytes: data.byteLength });
  return session;
}

export async function registerPcapFile(opts: {
  id?: string;
  fileName: string;
  filePath: string;
  sizeBytes?: number;
  ownerId?: string;
}): Promise<PcapSession> {
  const id = opts.id ?? crypto.randomUUID();
  const session: PcapSession = {
    id,
    fileName: opts.fileName,
    filePath: opts.filePath,
    createdAt: utcNowIso(),
    sizeBytes: opts.sizeBytes ?? 0,
    ownerId: opts.ownerId,
  };

  sessions.set(id, session);
  await writeSessionMeta(session);
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

export function listSessions(ownerId?: string): PcapSession[] {
  hydrateSessionsFromDisk();
  const all = Array.from(sessions.values());
  if (!ownerId) return all;
  return all.filter((session) => session.ownerId === ownerId);
}

export function getSessionForOwner(id: string, ownerId: string): PcapSession | undefined {
  const session = getSession(id);
  if (!session) return undefined;
  if (session.ownerId !== ownerId) return undefined;
  return session;
}
