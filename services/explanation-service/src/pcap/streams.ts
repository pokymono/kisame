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
  segments?: Array<{
    direction: 'a_to_b' | 'b_to_a' | 'unknown';
    frame: number;
    ts: number;
    seq: number;
    src: Endpoint;
    dst: Endpoint;
    bytes: number;
    text: string;
    truncated: boolean;
  }>;
  segments_truncated?: boolean;
  match?: {
    query: string;
    mode: 'substring' | 'regex';
    case_sensitive: boolean;
    context_packets: number;
  };
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
const DEFAULT_MAX_SEGMENT_BYTES = 2000;
const DEFAULT_MAX_OUTPUT_SEGMENTS = 40;

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

function emptyDirections(): FollowTcpStreamResult['directions'] {
  return [
    { from: 'a', to: 'b', bytes: 0, text: '', truncated: false },
    { from: 'b', to: 'a', bytes: 0, text: '', truncated: false },
  ];
}

function buildDirections(
  a: { bytes: number; text: string; truncated: boolean },
  b: { bytes: number; text: string; truncated: boolean }
): FollowTcpStreamResult['directions'] {
  return [
    { from: 'a', to: 'b', bytes: a.bytes, text: a.text, truncated: a.truncated },
    { from: 'b', to: 'a', bytes: b.bytes, text: b.text, truncated: b.truncated },
  ];
}

async function runTshark(
  args: string[],
  opts?: { timeoutMs?: number; label?: string }
): Promise<string> {
  const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  const timeoutMs = Math.max(
    1000,
    Number(process.env.KISAME_TSHARK_TIMEOUT_MS ?? '') || opts?.timeoutMs || 20000
  );
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill();
    } catch {
      // Best-effort kill.
    }
  }, timeoutMs);

  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const [stdout, stderr, exitCode] = await Promise.all([stdoutPromise, stderrPromise, proc.exited]).finally(() => {
    clearTimeout(timeout);
  });

  if (timedOut) {
    logError('tshark.stream.timeout', {
      label: opts?.label ?? 'tshark',
      timeout_ms: timeoutMs,
      stderr_preview: stderr.slice(0, 200),
    });
    throw new Error(`tshark timed out after ${timeoutMs}ms. Try increasing KISAME_TSHARK_TIMEOUT_MS.`);
  }

  if (exitCode !== 0) {
    logError('tshark.stream.error', { exit_code: exitCode, stderr_preview: stderr.slice(0, 400) });
    throw new Error(
      `tshark failed (exit ${exitCode}). Ensure tshark is installed and readable by Bun.\n\nstderr:\n${stderr}`
    );
  }
  return stdout;
}

function parseFollowAsciiOutput(output: string): { endpoints?: { a: Endpoint; b: Endpoint }; text: string } {
  const lines = output.split('\n');
  let nodeA: Endpoint | null = null;
  let nodeB: Endpoint | null = null;
  const dataLines: string[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line.startsWith('=====')) continue;
    if (line.startsWith('Follow:')) continue;
    if (line.startsWith('Filter:')) continue;
    if (line.startsWith('Node ')) {
      const match = line.match(/^Node\s+\d+:\s+(.+)$/);
      if (!match) continue;
      const endpoint = match[1]?.trim();
      if (!endpoint) continue;
      const bracketed = endpoint.match(/^\[(.+)\]:(\d+)$/);
      if (bracketed) {
        const ip = bracketed[1] ?? '';
        const port = Number(bracketed[2]);
        if (!nodeA) nodeA = { ip, port: Number.isFinite(port) ? port : null };
        else if (!nodeB) nodeB = { ip, port: Number.isFinite(port) ? port : null };
        continue;
      }
      const lastColon = endpoint.lastIndexOf(':');
      if (lastColon > 0) {
        const ip = endpoint.slice(0, lastColon);
        const port = Number(endpoint.slice(lastColon + 1));
        const parsed = { ip, port: Number.isFinite(port) ? port : null };
        if (!nodeA) nodeA = parsed;
        else if (!nodeB) nodeB = parsed;
      }
      continue;
    }
    dataLines.push(raw);
  }

  return {
    endpoints: nodeA && nodeB ? { a: nodeA, b: nodeB } : undefined,
    text: dataLines.join('\n').trim(),
  };
}

async function runTsharkFollowAscii(
  session: PcapSession,
  streamId: number
): Promise<{ endpoints?: { a: Endpoint; b: Endpoint }; text: string }> {
  const tsharkPath = resolveTsharkPath();
  if (!tsharkPath) {
    throw new Error('tshark was not found. Install Wireshark or set TSHARK_PATH to the tshark binary.');
  }

  const args: string[] = [
    tsharkPath,
    '-r',
    session.filePath,
    '-n',
    '-q',
    '-z',
    `follow,tcp,ascii,${streamId}`,
  ];
  const stdout = await runTshark(args, { timeoutMs: 20000, label: 'stream.follow.ascii' });
  return parseFollowAsciiOutput(stdout);
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
    '-o',
    'tcp.desegment_tcp_streams:TRUE',
    '-o',
    'tcp.desegment_tcp_data:TRUE',
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
  const stdout = await runTshark(args, { timeoutMs: 15000, label: 'stream.list' });
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
  const result = { total: entries.length, streams: entries.slice(0, max) };
  logInfo('tshark.stream.list.complete', {
    session_id: session.id,
    total_streams: result.total,
    returned: result.streams.length,
  });
  return result;
}

export async function followTcpStream(
  session: PcapSession,
  streamId: number,
  opts?: {
    maxBytesPerDirection?: number;
    maxCombinedBytes?: number;
    maxSegments?: number;
    maxBytesPerSegment?: number;
    maxOutputSegments?: number;
    direction?: 'a_to_b' | 'b_to_a' | 'both';
    contains?: string;
    matchMode?: 'substring' | 'regex';
    caseSensitive?: boolean;
    contextPackets?: number;
    startFrame?: number;
    endFrame?: number;
    startTs?: number;
    endTs?: number;
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
  const stdout = await runTshark(args, { timeoutMs: 20000, label: 'stream.follow' });
  const lines = stdout.split('\n').filter((l) => l.length);
  if (lines.length === 0) {
    const fallback = await runTsharkFollowAscii(session, streamId);
    if (fallback.text) {
      const endpoints = fallback.endpoints ?? { a: { ip: '', port: null }, b: { ip: '', port: null } };
      const result = {
        stream_id: streamId,
        endpoints,
        payload_frames: 0,
        payload_bytes: 0,
        combined_text: fallback.text,
        combined_bytes: fallback.text.length,
        combined_truncated: false,
        directions: emptyDirections(),
        segments: [],
        segments_truncated: false,
        match: opts?.contains
          ? {
              query: opts.contains,
              mode: opts.matchMode ?? 'substring',
              case_sensitive: Boolean(opts.caseSensitive),
              context_packets: opts.contextPackets ?? 0,
            }
          : undefined,
        notes: ['Fallback follow,tcp,ascii used (no tcp.payload frames decoded).'],
      };
      logInfo('tshark.stream.follow.complete', {
        session_id: session.id,
        stream_id: streamId,
        payload_frames: 0,
        payload_bytes: 0,
        combined_truncated: false,
        segments: 0,
      });
      return result;
    }

    const result = {
      stream_id: streamId,
      endpoints: { a: { ip: '', port: null }, b: { ip: '', port: null } },
      payload_frames: 0,
      payload_bytes: 0,
      combined_text: '',
      combined_bytes: 0,
      combined_truncated: false,
      directions: emptyDirections(),
      segments: [],
      segments_truncated: false,
      match: opts?.contains
        ? {
            query: opts.contains,
            mode: opts.matchMode ?? 'substring',
            case_sensitive: Boolean(opts.caseSensitive),
            context_packets: opts.contextPackets ?? 0,
          }
        : undefined,
      notes: ['No payload frames found for this stream.'],
    };
    logInfo('tshark.stream.follow.complete', {
      session_id: session.id,
      stream_id: streamId,
      payload_frames: 0,
      payload_bytes: 0,
    });
    return result;
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
    const fallback = await runTsharkFollowAscii(session, streamId);
    if (fallback.text) {
      const endpoints = fallback.endpoints ?? { a: { ip: '', port: null }, b: { ip: '', port: null } };
      const result = {
        stream_id: streamId,
        endpoints,
        payload_frames: 0,
        payload_bytes: 0,
        combined_text: fallback.text,
        combined_bytes: fallback.text.length,
        combined_truncated: false,
        directions: emptyDirections(),
        segments: [],
        segments_truncated: false,
        match: opts?.contains
          ? {
              query: opts.contains,
              mode: opts.matchMode ?? 'substring',
              case_sensitive: Boolean(opts.caseSensitive),
              context_packets: opts.contextPackets ?? 0,
            }
          : undefined,
        notes: ['Fallback follow,tcp,ascii used (no tcp.payload frames decoded).'],
      };
      logInfo('tshark.stream.follow.complete', {
        session_id: session.id,
        stream_id: streamId,
        payload_frames: 0,
        payload_bytes: 0,
        combined_truncated: false,
        segments: 0,
      });
      return result;
    }

    const result = {
      stream_id: streamId,
      endpoints: { a: { ip: '', port: null }, b: { ip: '', port: null } },
      payload_frames: 0,
      payload_bytes: 0,
      combined_text: '',
      combined_bytes: 0,
      combined_truncated: false,
      directions: emptyDirections(),
      segments: [],
      segments_truncated: false,
      match: opts?.contains
        ? {
            query: opts.contains,
            mode: opts.matchMode ?? 'substring',
            case_sensitive: Boolean(opts.caseSensitive),
            context_packets: opts.contextPackets ?? 0,
          }
        : undefined,
      notes: ['No payload frames found for this stream.'],
    };
    logInfo('tshark.stream.follow.complete', {
      session_id: session.id,
      stream_id: streamId,
      payload_frames: 0,
      payload_bytes: 0,
    });
    return result;
  }

  const endpoints = {
    a: payloadRows[0]!.src,
    b: payloadRows[0]!.dst,
  };
  const keyA = endpointKey(endpoints.a);
  const keyB = endpointKey(endpoints.b);

  const directionForRow = (row: PayloadRow): 'a_to_b' | 'b_to_a' | 'unknown' => {
    const key = endpointKey(row.src);
    if (key === keyA) return 'a_to_b';
    if (key === keyB) return 'b_to_a';
    return 'unknown';
  };

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
  const maxBytesPerSegment = opts?.maxBytesPerSegment ?? DEFAULT_MAX_SEGMENT_BYTES;
  const maxOutputSegments = opts?.maxOutputSegments ?? DEFAULT_MAX_OUTPUT_SEGMENTS;

  const rangeFilteredRows = payloadRows.filter((row) => {
    if (opts?.startFrame != null && row.frame < opts.startFrame) return false;
    if (opts?.endFrame != null && row.frame > opts.endFrame) return false;
    if (opts?.startTs != null && row.ts < opts.startTs) return false;
    if (opts?.endTs != null && row.ts > opts.endTs) return false;
    return true;
  });

  const directionFilteredRows = rangeFilteredRows.filter((row) => {
    if (!opts?.direction || opts.direction === 'both') return true;
    const dir = directionForRow(row);
    if (opts.direction === 'a_to_b') return dir === 'a_to_b';
    if (opts.direction === 'b_to_a') return dir === 'b_to_a';
    return true;
  });

  const combinedSourceRows =
    opts?.contains || opts?.direction || opts?.startFrame != null || opts?.endFrame != null || opts?.startTs != null || opts?.endTs != null
      ? directionFilteredRows
      : payloadRows;

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

  const combinedRows = combinedSourceRows.slice().sort((a, b) => {
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

  let segments: FollowTcpStreamResult['segments'] = [];
  let segmentsTruncated = false;

  if (opts?.contains) {
    const mode = opts.matchMode ?? 'substring';
    const caseSensitive = Boolean(opts.caseSensitive);
    const contextPackets = Math.max(0, Math.floor(opts.contextPackets ?? 0));
    let matcher: (text: string) => boolean;

    if (mode === 'regex') {
      try {
        const regex = new RegExp(opts.contains, caseSensitive ? '' : 'i');
        matcher = (text) => regex.test(text);
      } catch {
        matcher = () => false;
        notes.push('Invalid regex provided for contains; no segments matched.');
      }
    } else {
      const needle = caseSensitive ? opts.contains : opts.contains.toLowerCase();
      matcher = (text) => (caseSensitive ? text : text.toLowerCase()).includes(needle);
    }

    const ordered = directionFilteredRows.slice().sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      if (a.frame !== b.frame) return a.frame - b.frame;
      return a.seq - b.seq;
    });

    const matchIndexes = new Set<number>();
    for (let i = 0; i < ordered.length; i++) {
      const row = ordered[i]!;
      const preview = bytesToPrintableAscii(row.bytes, maxBytesPerSegment).text;
      if (matcher(preview)) {
        for (let j = Math.max(0, i - contextPackets); j <= Math.min(ordered.length - 1, i + contextPackets); j++) {
          matchIndexes.add(j);
        }
      }
    }

    const selected = Array.from(matchIndexes)
      .sort((a, b) => a - b)
      .map((idx) => ordered[idx]!)
      .slice(0, maxOutputSegments);

    segments = selected.map((row) => {
      const ascii = bytesToPrintableAscii(row.bytes, maxBytesPerSegment);
      return {
        direction: directionForRow(row),
        frame: row.frame,
        ts: row.ts,
        seq: row.seq,
        src: row.src,
        dst: row.dst,
        bytes: row.bytes.length,
        text: ascii.text,
        truncated: ascii.truncated,
      };
    });

    if (matchIndexes.size > selected.length) segmentsTruncated = true;
  }

  const result = {
    stream_id: streamId,
    endpoints,
    payload_frames: payloadRows.length,
    payload_bytes: totalPayloadBytes,
    combined_text: combinedParts.join('').trimStart(),
    combined_bytes: combinedBytes,
    combined_truncated: combinedTruncated,
    directions: buildDirections(dirA, dirB),
    segments: segments.length ? segments : undefined,
    segments_truncated: segments.length ? segmentsTruncated : undefined,
    match: opts?.contains
      ? {
          query: opts.contains,
          mode: opts.matchMode ?? 'substring',
          case_sensitive: Boolean(opts.caseSensitive),
          context_packets: Math.max(0, Math.floor(opts.contextPackets ?? 0)),
        }
      : undefined,
    notes: notes.length ? notes : undefined,
  };

  logInfo('tshark.stream.follow.complete', {
    session_id: session.id,
    stream_id: streamId,
    payload_frames: result.payload_frames,
    payload_bytes: result.payload_bytes,
    combined_truncated: result.combined_truncated,
    segments: result.segments?.length ?? 0,
  });
  return result;
}
