import type { PcapSession } from '../types';
import { resolveTsharkPath } from './tshark';
import { safeInt, safeFloat } from './tshark-utils';
import { logError, logInfo } from '../utils/logger';

type Endpoint = { ip: string; port: number | null };

export type TcpStreamEntry = {
  stream_id: number;
  endpoints: { a: Endpoint; b: Endpoint };
  first_ts: number;
  last_ts: number;
  duration_seconds: number;
  packet_count: number;
  byte_count: number;
  evidence_frames: { first: number; last: number };
};

export type FollowTcpStreamResult = {
  stream_id: number;
  endpoints: { a: Endpoint; b: Endpoint };
  payload_frames: number;
  payload_bytes: number;
  combined_text: string;
  combined_bytes: number;
  combined_truncated: boolean;
  directions: Array<{
    from: 'a' | 'b';
    to: 'a' | 'b';
    bytes: number;
    text: string;
    truncated: boolean;
  }>;
  notes?: string[];
};

type PayloadRow = {
  ts: number;
  frame: number;
  seq: number;
  src: Endpoint;
  dst: Endpoint;
  bytes: Uint8Array;
};

const DEFAULT_MAX_BYTES = 12000;
const DEFAULT_MAX_COMBINED_BYTES = 16000;
const DEFAULT_MAX_SEGMENTS = 80;

function parseTsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === '\t' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  values.push(current);
  return values;
}

function endpointKey(endpoint: Endpoint): string {
  return `${endpoint.ip}:${endpoint.port ?? ''}`;
}

function hexToBytes(value: string): Uint8Array {
  const cleaned = value.replace(/[:\s]/g, '').trim();
  if (!cleaned) return new Uint8Array();
  const len = Math.floor(cleaned.length / 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const byte = cleaned.slice(i * 2, i * 2 + 2);
    out[i] = Number.parseInt(byte, 16) || 0;
  }
  return out;
}

function bytesToPrintableAscii(bytes: Uint8Array, maxBytes?: number): {
  text: string;
  bytesUsed: number;
  truncated: boolean;
} {
  const limit = maxBytes == null ? bytes.length : Math.max(0, Math.min(bytes.length, maxBytes));
  let text = '';
  for (let i = 0; i < limit; i++) {
    const b = bytes[i] ?? 0;
    if (b === 0x0a) {
      text += '\n';
    } else if (b === 0x0d) {
      text += '\r';
    } else if (b === 0x09) {
      text += '\t';
    } else if (b >= 0x20 && b <= 0x7e) {
      text += String.fromCharCode(b);
    } else {
      text += '.';
    }
  }
  return { text, bytesUsed: limit, truncated: limit < bytes.length };
}

async function runTshark(args: string[]): Promise<string> {
  const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    logError('tshark.stream.error', { exit_code: exitCode, stderr_preview: stderr.slice(0, 400) });
    throw new Error(
      `tshark failed (exit ${exitCode}). Ensure tshark is installed and readable by Bun.\n\nstderr:\n${stderr}`
    );
  }
  return stdout;
}

export async function listTcpStreams(session: PcapSession, opts?: {
  limit?: number;
  maxPackets?: number;
}): Promise<{ total: number; streams: TcpStreamEntry[] }> {
  const tsharkPath = resolveTsharkPath();
  if (!tsharkPath) {
    throw new Error('tshark was not found. Install Wireshark or set TSHARK_PATH to the tshark binary.');
  }

  const args: string[] = [
    tsharkPath,
    '-r',
    session.filePath,
    '-n',
    '-T',
    'fields',
    '-E',
    'header=y',
    '-E',
    'separator=\t',
    '-E',
    'quote=d',
    '-E',
    'occurrence=f',
    '-Y',
    'tcp',
    '-e',
    'tcp.stream',
    '-e',
    'frame.number',
    '-e',
    'frame.time_epoch',
    '-e',
    'frame.len',
    '-e',
    'ip.src',
    '-e',
    'ipv6.src',
    '-e',
    'ip.dst',
    '-e',
    'ipv6.dst',
    '-e',
    'tcp.srcport',
    '-e',
    'tcp.dstport',
  ];
  if (opts?.maxPackets && opts.maxPackets > 0) args.push('-c', String(opts.maxPackets));

  logInfo('tshark.stream.list.start', { session_id: session.id, file_name: session.fileName });
  const stdout = await runTshark(args);
  const lines = stdout.split('\n').filter((l) => l.length);
  if (lines.length === 0) return { total: 0, streams: [] };

  const header = parseTsvLine(lines[0]!).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const at = (row: string[], name: string) => {
    const i = idx(name);
    if (i < 0) return '';
    return row[i] ?? '';
  };

  const streams = new Map<number, TcpStreamEntry>();

  for (let i = 1; i < lines.length; i++) {
    const row = parseTsvLine(lines[i]!);
    const streamId = safeInt(at(row, 'tcp.stream'));
    const frameNo = safeInt(at(row, 'frame.number'));
    const ts = safeFloat(at(row, 'frame.time_epoch'));
    if (streamId == null || frameNo == null || ts == null) continue;

    const frameLen = safeInt(at(row, 'frame.len')) ?? 0;
    const srcIp = (at(row, 'ip.src') || at(row, 'ipv6.src')).trim();
    const dstIp = (at(row, 'ip.dst') || at(row, 'ipv6.dst')).trim();
    if (!srcIp || !dstIp) continue;
    const srcPort = safeInt(at(row, 'tcp.srcport'));
    const dstPort = safeInt(at(row, 'tcp.dstport'));

    let entry = streams.get(streamId);
    if (!entry) {
      entry = {
        stream_id: streamId,
        endpoints: {
          a: { ip: srcIp, port: srcPort },
          b: { ip: dstIp, port: dstPort },
        },
        first_ts: ts,
        last_ts: ts,
        duration_seconds: 0,
        packet_count: 0,
        byte_count: 0,
        evidence_frames: { first: frameNo, last: frameNo },
      };
      streams.set(streamId, entry);
    }

    entry.packet_count += 1;
    entry.byte_count += frameLen;
    entry.first_ts = Math.min(entry.first_ts, ts);
    entry.last_ts = Math.max(entry.last_ts, ts);
    entry.evidence_frames.first = Math.min(entry.evidence_frames.first, frameNo);
    entry.evidence_frames.last = Math.max(entry.evidence_frames.last, frameNo);
  }

  const entries = Array.from(streams.values()).map((entry) => ({
    ...entry,
    duration_seconds: Math.max(0, entry.last_ts - entry.first_ts),
  }));
  entries.sort((a, b) => (a.first_ts !== b.first_ts ? a.first_ts - b.first_ts : a.stream_id - b.stream_id));

  const max = opts?.limit ?? 50;
  return { total: entries.length, streams: entries.slice(0, max) };
}

export async function followTcpStream(
  session: PcapSession,
  streamId: number,
  opts?: {
    maxBytesPerDirection?: number;
    maxCombinedBytes?: number;
    maxSegments?: number;
  }
): Promise<FollowTcpStreamResult> {
  const tsharkPath = resolveTsharkPath();
  if (!tsharkPath) {
    throw new Error('tshark was not found. Install Wireshark or set TSHARK_PATH to the tshark binary.');
  }

  const args: string[] = [
    tsharkPath,
    '-r',
    session.filePath,
    '-n',
    '-T',
    'fields',
    '-E',
    'header=y',
    '-E',
    'separator=\t',
    '-E',
    'quote=d',
    '-E',
    'occurrence=f',
    '-Y',
    `tcp.stream == ${streamId} && tcp.payload`,
    '-e',
    'frame.number',
    '-e',
    'frame.time_epoch',
    '-e',
    'ip.src',
    '-e',
    'ipv6.src',
    '-e',
    'ip.dst',
    '-e',
    'ipv6.dst',
    '-e',
    'tcp.srcport',
    '-e',
    'tcp.dstport',
    '-e',
    'tcp.seq',
    '-e',
    'tcp.payload',
  ];

  logInfo('tshark.stream.follow.start', { session_id: session.id, stream_id: streamId });
  const stdout = await runTshark(args);
  const lines = stdout.split('\n').filter((l) => l.length);
  if (lines.length === 0) {
    return {
      stream_id: streamId,
      endpoints: { a: { ip: '', port: null }, b: { ip: '', port: null } },
      payload_frames: 0,
      payload_bytes: 0,
      combined_text: '',
      combined_bytes: 0,
      combined_truncated: false,
      directions: [
        { from: 'a', to: 'b', bytes: 0, text: '', truncated: false },
        { from: 'b', to: 'a', bytes: 0, text: '', truncated: false },
      ],
      notes: ['No payload frames found for this stream.'],
    };
  }

  const header = parseTsvLine(lines[0]!).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const at = (row: string[], name: string) => {
    const i = idx(name);
    if (i < 0) return '';
    return row[i] ?? '';
  };

  const payloadRows: PayloadRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseTsvLine(lines[i]!);
    const frame = safeInt(at(row, 'frame.number'));
    const ts = safeFloat(at(row, 'frame.time_epoch'));
    const seq = safeInt(at(row, 'tcp.seq'));
    if (frame == null || ts == null || seq == null) continue;

    const srcIp = (at(row, 'ip.src') || at(row, 'ipv6.src')).trim();
    const dstIp = (at(row, 'ip.dst') || at(row, 'ipv6.dst')).trim();
    if (!srcIp || !dstIp) continue;
    const srcPort = safeInt(at(row, 'tcp.srcport'));
    const dstPort = safeInt(at(row, 'tcp.dstport'));
    const payloadHex = at(row, 'tcp.payload').trim();
    if (!payloadHex) continue;

    payloadRows.push({
      ts,
      frame,
      seq,
      src: { ip: srcIp, port: srcPort },
      dst: { ip: dstIp, port: dstPort },
      bytes: hexToBytes(payloadHex),
    });
  }

  if (payloadRows.length === 0) {
    return {
      stream_id: streamId,
      endpoints: { a: { ip: '', port: null }, b: { ip: '', port: null } },
      payload_frames: 0,
      payload_bytes: 0,
      combined_text: '',
      combined_bytes: 0,
      combined_truncated: false,
      directions: [
        { from: 'a', to: 'b', bytes: 0, text: '', truncated: false },
        { from: 'b', to: 'a', bytes: 0, text: '', truncated: false },
      ],
      notes: ['No payload frames found for this stream.'],
    };
  }

  const endpoints = {
    a: payloadRows[0]!.src,
    b: payloadRows[0]!.dst,
  };
  const keyA = endpointKey(endpoints.a);
  const keyB = endpointKey(endpoints.b);

  const aToB: PayloadRow[] = [];
  const bToA: PayloadRow[] = [];
  const other: PayloadRow[] = [];
  let totalPayloadBytes = 0;

  for (const row of payloadRows) {
    totalPayloadBytes += row.bytes.length;
    const key = endpointKey(row.src);
    if (key === keyA) {
      aToB.push(row);
    } else if (key === keyB) {
      bToA.push(row);
    } else {
      other.push(row);
    }
  }

  aToB.sort((a, b) => (a.seq !== b.seq ? a.seq - b.seq : a.frame - b.frame));
  bToA.sort((a, b) => (a.seq !== b.seq ? a.seq - b.seq : a.frame - b.frame));

  const maxBytesPerDirection = opts?.maxBytesPerDirection ?? DEFAULT_MAX_BYTES;
  const maxCombinedBytes = opts?.maxCombinedBytes ?? DEFAULT_MAX_COMBINED_BYTES;
  const maxSegments = opts?.maxSegments ?? DEFAULT_MAX_SEGMENTS;

  const buildDirectional = (rows: PayloadRow[]) => {
    let used = 0;
    let truncated = false;
    const parts: string[] = [];
    for (const row of rows) {
      if (used >= maxBytesPerDirection) {
        truncated = true;
        break;
      }
      const remaining = maxBytesPerDirection - used;
      const { text, bytesUsed, truncated: chunkTrunc } = bytesToPrintableAscii(row.bytes, remaining);
      if (bytesUsed > 0) {
        parts.push(text);
        used += bytesUsed;
      }
      if (chunkTrunc) {
        truncated = true;
        break;
      }
    }
    return { text: parts.join(''), bytes: used, truncated };
  };

  const dirA = buildDirectional(aToB);
  const dirB = buildDirectional(bToA);

  const combinedRows = payloadRows.slice().sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    if (a.frame !== b.frame) return a.frame - b.frame;
    return a.seq - b.seq;
  });

  let combinedBytes = 0;
  let combinedTruncated = false;
  const combinedParts: string[] = [];
  let lastLabel = '';
  let segmentCount = 0;

  for (const row of combinedRows) {
    if (combinedBytes >= maxCombinedBytes) {
      combinedTruncated = true;
      break;
    }
    const label = `${row.src.ip}:${row.src.port ?? ''} -> ${row.dst.ip}:${row.dst.port ?? ''}`;
    if (label !== lastLabel) {
      if (segmentCount >= maxSegments) {
        combinedTruncated = true;
        break;
      }
      combinedParts.push(`\n[${label}]\n`);
      lastLabel = label;
      segmentCount += 1;
    }

    const remaining = maxCombinedBytes - combinedBytes;
    const { text, bytesUsed, truncated: chunkTrunc } = bytesToPrintableAscii(row.bytes, remaining);
    if (bytesUsed > 0) {
      combinedParts.push(text);
      combinedBytes += bytesUsed;
    }
    if (chunkTrunc) {
      combinedTruncated = true;
      break;
    }
  }

  const notes: string[] = [];
  if (other.length) {
    notes.push('Some payload frames did not match the primary endpoints; output may be incomplete.');
  }
  if (combinedTruncated || dirA.truncated || dirB.truncated) {
    notes.push('Payload output was truncated to keep responses compact.');
  }

  return {
    stream_id: streamId,
    endpoints,
    payload_frames: payloadRows.length,
    payload_bytes: totalPayloadBytes,
    combined_text: combinedParts.join('').trimStart(),
    combined_bytes: combinedBytes,
    combined_truncated: combinedTruncated,
    directions: [
      { from: 'a', to: 'b', bytes: dirA.bytes, text: dirA.text, truncated: dirA.truncated },
      { from: 'b', to: 'a', bytes: dirB.bytes, text: dirB.text, truncated: dirB.truncated },
    ],
    notes: notes.length ? notes : undefined,
  };
}
