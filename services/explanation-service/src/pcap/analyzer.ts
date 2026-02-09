import type { PcapSession, AnalysisArtifact } from '../types';
import { utcNowIso } from '../utils/response';
import { safeInt, safeFloat, sha1Hex12, canonicalPair } from './tshark-utils';
import { resolveTsharkPath, tsharkVersion, getTsharkInfo as fetchTsharkInfo } from './tshark';


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


export type AnalyzeOptions = {
  session: PcapSession;
  maxPackets?: number;
  sampleFramesPerSession?: number;
};

export async function analyzeWithTshark(opts: AnalyzeOptions): Promise<AnalysisArtifact> {
  const tsharkPath = resolveTsharkPath();
  if (!tsharkPath) {
    throw new Error(
      'tshark was not found. Install Wireshark or set TSHARK_PATH to the tshark binary (macOS default: /Applications/Wireshark.app/Contents/MacOS/tshark).'
    );
  }
  const version = await tsharkVersion(tsharkPath);
  const sampleFramesPerSession = Math.max(0, opts.sampleFramesPerSession ?? 8);

  const fields = [
    'frame.number',
    'frame.time_epoch',
    'frame.len',
    'ip.src',
    'ip.dst',
    'ipv6.src',
    'ipv6.dst',
    'tcp.srcport',
    'tcp.dstport',
    'udp.srcport',
    'udp.dstport',
    'frame.protocols',
    'dns.qry.name',
    'http.request.method',
    'http.host',
    'http.request.uri',
    'tls.handshake.extensions_server_name',
  ];

  const args: string[] = [
    tsharkPath,
    '-r',
    opts.session.filePath,
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
  ];
  if (opts.maxPackets && opts.maxPackets > 0) args.push('-c', String(opts.maxPackets));
  for (const f of fields) args.push('-e', f);

  const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(
      `tshark failed (exit ${exitCode}). Ensure tshark is installed and readable by Bun.\n\nstderr:\n${stderr}`
    );
  }

  const lines = stdout.split('\n').filter((l) => l.length);
  if (lines.length === 0) {
    return {
      schema_version: 1,
      generated_at: utcNowIso(),
      pcap: {
        session_id: opts.session.id,
        file_name: opts.session.fileName,
        size_bytes: opts.session.sizeBytes,
        packets_analyzed: 0,
        first_ts: null,
        last_ts: null,
      },
      tooling: { tshark_path: tsharkPath, tshark_version: version },
      sessions: [],
      timeline: [],
    };
  }

  const headerLine = lines[0]!;
  const header = parseTsvLine(headerLine).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const at = (row: string[], name: string) => {
    const i = idx(name);
    if (i < 0) return '';
    return row[i] ?? '';
  };

  const sessionsMap = new Map<
    string,
    {
      id: string;
      transport: 'tcp' | 'udp' | 'other';
      endpoints: { a: { ip: string; port: number | null }; b: { ip: string; port: number | null } };
      first_ts: number;
      last_ts: number;
      packet_count: number;
      byte_count: number;
      evidence: { first_frame: number; last_frame: number; sample_frames: number[] };
      protocol_chains: Record<string, number>;
      observations: {
        dns_queries: Array<{ name: string; ts: number; evidence_frame: number }>;
        http_requests: Array<{
          method: string;
          host: string | null;
          uri: string | null;
          ts: number;
          evidence_frame: number;
        }>;
        tls_sni: Array<{ server_name: string; ts: number; evidence_frame: number }>;
      };
      rule_flags: string[];
    }
  >();

  const timeline: AnalysisArtifact['timeline'] = [];

  let packetCount = 0;
  let firstTs: number | null = null;
  let lastTs: number | null = null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const row = parseTsvLine(line);
    const frameNo = safeInt(at(row, 'frame.number'));
    const ts = safeFloat(at(row, 'frame.time_epoch'));
    const frameLen = safeInt(at(row, 'frame.len'));
    if (frameNo == null || ts == null) continue;

    packetCount++;
    firstTs = firstTs == null ? ts : Math.min(firstTs, ts);
    lastTs = lastTs == null ? ts : Math.max(lastTs, ts);

    const srcIp = (at(row, 'ip.src') || at(row, 'ipv6.src')).trim();
    const dstIp = (at(row, 'ip.dst') || at(row, 'ipv6.dst')).trim();
    if (!srcIp || !dstIp) continue;

    const tcpSrc = safeInt(at(row, 'tcp.srcport'));
    const tcpDst = safeInt(at(row, 'tcp.dstport'));
    const udpSrc = safeInt(at(row, 'udp.srcport'));
    const udpDst = safeInt(at(row, 'udp.dstport'));

    let transport: 'tcp' | 'udp' | 'other' = 'other';
    let srcPort: number | null = null;
    let dstPort: number | null = null;
    if (tcpSrc != null || tcpDst != null) {
      transport = 'tcp';
      srcPort = tcpSrc;
      dstPort = tcpDst;
    } else if (udpSrc != null || udpDst != null) {
      transport = 'udp';
      srcPort = udpSrc;
      dstPort = udpDst;
    }

    const pair = canonicalPair(srcIp, srcPort, dstIp, dstPort);
    const sessionKey = `${transport}:${pair.a.ip}:${pair.a.port ?? -1}->${pair.b.ip}:${pair.b.port ?? -1}`;
    const sessionId = sha1Hex12(sessionKey);

    let s = sessionsMap.get(sessionKey);
    if (!s) {
      s = {
        id: sessionId,
        transport,
        endpoints: pair,
        first_ts: ts,
        last_ts: ts,
        packet_count: 0,
        byte_count: 0,
        evidence: { first_frame: frameNo, last_frame: frameNo, sample_frames: [] },
        protocol_chains: {},
        observations: { dns_queries: [], http_requests: [], tls_sni: [] },
        rule_flags: [],
      };
      sessionsMap.set(sessionKey, s);
    }

    s.packet_count += 1;
    s.byte_count += frameLen ?? 0;
    s.first_ts = Math.min(s.first_ts, ts);
    s.last_ts = Math.max(s.last_ts, ts);
    s.evidence.first_frame = Math.min(s.evidence.first_frame, frameNo);
    s.evidence.last_frame = Math.max(s.evidence.last_frame, frameNo);
    if (s.evidence.sample_frames.length < sampleFramesPerSession) {
      s.evidence.sample_frames.push(frameNo);
    }

    const chain = at(row, 'frame.protocols').trim();
    if (chain) s.protocol_chains[chain] = (s.protocol_chains[chain] ?? 0) + 1;

    const dnsQry = at(row, 'dns.qry.name').trim();
    if (dnsQry) {
      s.observations.dns_queries.push({ name: dnsQry, ts, evidence_frame: frameNo });
      timeline.push({ ts, session_id: sessionId, kind: 'dns_query', summary: `DNS query: ${dnsQry}`, evidence_frame: frameNo });
    }

    const httpMethod = at(row, 'http.request.method').trim();
    const httpHost = at(row, 'http.host').trim();
    const httpUri = at(row, 'http.request.uri').trim();
    if (httpMethod && (httpHost || httpUri)) {
      const summary = `HTTP request: ${httpMethod} ${httpHost}${httpUri}`;
      s.observations.http_requests.push({
        method: httpMethod,
        host: httpHost || null,
        uri: httpUri || null,
        ts,
        evidence_frame: frameNo,
      });
      timeline.push({ ts, session_id: sessionId, kind: 'http_request', summary, evidence_frame: frameNo });
    }

    const sni = at(row, 'tls.handshake.extensions_server_name').trim();
    if (sni) {
      s.observations.tls_sni.push({ server_name: sni, ts, evidence_frame: frameNo });
      timeline.push({ ts, session_id: sessionId, kind: 'tls_sni', summary: `TLS SNI: ${sni}`, evidence_frame: frameNo });
    }
  }

  const sessionList: AnalysisArtifact['sessions'] = Array.from(sessionsMap.values()).map((s) => {
    const duration = s.last_ts - s.first_ts;
    const flags: string[] = [];
    if (s.packet_count >= 1000) flags.push('many_packets');
    if (duration >= 60) flags.push('long_duration');
    if (s.byte_count >= 10 * 1024 * 1024) flags.push('large_bytes');
    if (s.transport === 'other') flags.push('non_tcp_udp');

    return {
      id: s.id,
      transport: s.transport,
      endpoints: s.endpoints,
      first_ts: s.first_ts,
      last_ts: s.last_ts,
      duration_seconds: duration,
      packet_count: s.packet_count,
      byte_count: s.byte_count,
      evidence: s.evidence,
      rule_flags: flags,
    };
  });

  sessionList.sort((a, b) => (a.first_ts !== b.first_ts ? a.first_ts - b.first_ts : a.id.localeCompare(b.id)));
  timeline.sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : a.evidence_frame - b.evidence_frame));

  return {
    schema_version: 1,
    generated_at: utcNowIso(),
    pcap: {
      session_id: opts.session.id,
      file_name: opts.session.fileName,
      size_bytes: opts.session.sizeBytes,
      packets_analyzed: packetCount,
      first_ts: firstTs,
      last_ts: lastTs,
    },
    tooling: { tshark_path: tsharkPath, tshark_version: version },
    sessions: sessionList,
    timeline,
  };
}


export async function getTsharkInfo(): Promise<{
  tshark_path: string | null;
  tshark_version: string | null;
  resolved: boolean;
}> {
  return fetchTsharkInfo();
}
