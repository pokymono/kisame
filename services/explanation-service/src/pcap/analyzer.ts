import type { PcapSession, AnalysisArtifact } from '../types';
import { utcNowIso } from '../utils/response';
import { safeInt, safeFloat, sha1Hex12, canonicalPair } from './tshark-utils';
import { resolveTsharkPath, tsharkVersion, getTsharkInfo as fetchTsharkInfo } from './tshark';
import { logInfo, logWarn, logError } from '../utils/logger';


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
  const startedAt = Date.now();
  const tsharkPath = resolveTsharkPath();
  if (!tsharkPath) {
    throw new Error(
      'tshark was not found. Install Wireshark or set TSHARK_PATH to the tshark binary (macOS default: /Applications/Wireshark.app/Contents/MacOS/tshark).'
    );
  }
  const version = await tsharkVersion(tsharkPath);
  const sampleFramesPerSession = Math.max(0, opts.sampleFramesPerSession ?? 8);
  logInfo('tshark.analyze.start', {
    file_name: opts.session.fileName,
    size_bytes: opts.session.sizeBytes,
    max_packets: opts.maxPackets ?? null,
    sample_frames: sampleFramesPerSession,
    tshark_path: tsharkPath,
    tshark_version: version ?? 'unknown',
  });

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
    logError('tshark.analyze.error', {
      exit_code: exitCode,
      stderr_preview: stderr.slice(0, 400),
    });
    throw new Error(
      `tshark failed (exit ${exitCode}). Ensure tshark is installed and readable by Bun.\n\nstderr:\n${stderr}`
    );
  }

  const lines = stdout.split('\n').filter((l) => l.length);
  if (lines.length === 0) {
    logWarn('tshark.analyze.empty', { file_name: opts.session.fileName });
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
      protocol_tokens_seen: Set<string>;
      tcp_payload_seen: boolean;
      udp_payload_seen: boolean;
    }
  >();

  const timeline: AnalysisArtifact['timeline'] = [];
  const TIMELINE_PROTOCOL_TOKENS = new Set([
    'smb',
    'smb2',
    'ntlmssp',
    'dcerpc',
    'samr',
    'lsarpc',
    'kerberos',
    'ldap',
    'rdp',
    'ssh',
    'ftp',
    'telnet',
    'http',
    'tls',
    'ssl',
    'dns',
    'quic',
    'stun',
    'turn',
    'ntp',
    'ssdp',
    'mdns',
    'llmnr',
    'nbns',
    'dhcp',
    'bootp',
    'snmp',
    'tftp',
    'sip',
    'rtp',
    'rtcp',
    'ike',
    'isakmp',
    'radius',
    'syslog',
    'mqtt',
  ]);

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
        protocol_tokens_seen: new Set<string>(),
        tcp_payload_seen: false,
        udp_payload_seen: false,
      };
      sessionsMap.set(sessionKey, s);

      if (transport === 'tcp') {
        const srcLabel = `${srcIp}:${srcPort ?? '?'}`;
        const dstLabel = `${dstIp}:${dstPort ?? '?'}`;
        timeline.push({
          ts,
          session_id: sessionId,
          kind: 'tcp_session_start',
          summary: `TCP session start: ${srcLabel} -> ${dstLabel}`,
          evidence_frame: frameNo,
        });
      } else if (transport === 'udp') {
        const srcLabel = `${srcIp}:${srcPort ?? '?'}`;
        const dstLabel = `${dstIp}:${dstPort ?? '?'}`;
        timeline.push({
          ts,
          session_id: sessionId,
          kind: 'udp_session_start',
          summary: `UDP session start: ${srcLabel} -> ${dstLabel}`,
          evidence_frame: frameNo,
        });
      }
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
    if (chain) {
      s.protocol_chains[chain] = (s.protocol_chains[chain] ?? 0) + 1;
      const tokens = chain
        .split(':')
        .map((token) => token.trim().toLowerCase())
        .filter(Boolean);

      for (const token of tokens) {
        if (token === 'data' && transport === 'tcp' && !s.tcp_payload_seen) {
          s.tcp_payload_seen = true;
          timeline.push({
            ts,
            session_id: sessionId,
            kind: 'tcp_payload',
            summary: 'TCP payload observed',
            evidence_frame: frameNo,
          });
        }
        if (token === 'data' && transport === 'udp' && !s.udp_payload_seen) {
          s.udp_payload_seen = true;
          timeline.push({
            ts,
            session_id: sessionId,
            kind: 'udp_payload',
            summary: 'UDP payload observed',
            evidence_frame: frameNo,
          });
        }
        if (TIMELINE_PROTOCOL_TOKENS.has(token) && !s.protocol_tokens_seen.has(token)) {
          s.protocol_tokens_seen.add(token);
          timeline.push({
            ts,
            session_id: sessionId,
            kind: 'protocol_observed',
            summary: `Protocol observed: ${token.toUpperCase()}`,
            evidence_frame: frameNo,
          });
        }
      }
    }

    const dnsQry = at(row, 'dns.qry.name').trim();
    if (dnsQry) {
      s.observations.dns_queries.push({ name: dnsQry, ts, evidence_frame: frameNo });
      timeline.push({
        ts,
        session_id: sessionId,
        kind: 'dns_query',
        summary: `DNS query: ${dnsQry}`,
        evidence_frame: frameNo,
        meta: { dns_name: dnsQry },
      });
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
      timeline.push({
        ts,
        session_id: sessionId,
        kind: 'http_request',
        summary,
        evidence_frame: frameNo,
        meta: {
          http: {
            method: httpMethod,
            host: httpHost || null,
            uri: httpUri || null,
          },
        },
      });
    }

    const sni = at(row, 'tls.handshake.extensions_server_name').trim();
    if (sni) {
      s.observations.tls_sni.push({ server_name: sni, ts, evidence_frame: frameNo });
      timeline.push({
        ts,
        session_id: sessionId,
        kind: 'tls_sni',
        summary: `TLS SNI: ${sni}`,
        evidence_frame: frameNo,
        meta: { sni },
      });
    }
  }

  const sessionList: AnalysisArtifact['sessions'] = Array.from(sessionsMap.values()).map((s) => {
    const duration = s.last_ts - s.first_ts;
    const flags: string[] = [];
    if (s.packet_count >= 1000) flags.push('many_packets');
    if (duration >= 60) flags.push('long_duration');
    if (s.byte_count >= 10 * 1024 * 1024) flags.push('large_bytes');
    if (s.transport === 'other') flags.push('non_tcp_udp');

    const protocolTokens = new Set<string>();
    for (const chain of Object.keys(s.protocol_chains)) {
      for (const token of chain.split(':')) {
        const normalized = token.trim().toLowerCase();
        if (normalized) protocolTokens.add(normalized);
      }
    }
    const hasToken = (token: string) => protocolTokens.has(token);
    const ports = [s.endpoints.a.port, s.endpoints.b.port].filter(
      (p): p is number => typeof p === 'number' && Number.isFinite(p)
    );
    const portSet = new Set(ports);
    const hasPort = (port: number) => portSet.has(port);
    const addFlag = (flag: string) => {
      if (!flags.includes(flag)) flags.push(flag);
    };

    if (hasToken('smb') || hasToken('smb2') || hasPort(445) || hasPort(139)) addFlag('smb');
    if (hasToken('ntlmssp')) addFlag('ntlm');
    if (hasToken('dcerpc') || hasPort(135)) addFlag('dcerpc');
    if (hasToken('samr')) addFlag('samr');
    if (hasToken('lsarpc')) addFlag('lsarpc');
    if (hasToken('srvsvc')) addFlag('srvsvc');
    if (hasToken('kerberos') || hasPort(88) || hasPort(464)) addFlag('kerberos');
    if (hasToken('ldap') || hasPort(389) || hasPort(636) || hasPort(3268) || hasPort(3269)) addFlag('ldap');
    if (hasToken('rdp') || hasPort(3389)) addFlag('rdp');
    if (hasToken('ssh') || hasPort(22)) addFlag('ssh');
    if (hasToken('telnet') || hasPort(23)) addFlag('telnet');
    if (hasToken('ftp') || hasPort(21)) addFlag('ftp');
    if (hasToken('tftp') || hasPort(69)) addFlag('tftp');
    if (hasToken('vnc') || hasPort(5900) || hasPort(5901) || hasPort(5902) || hasPort(5903)) addFlag('vnc');
    if (hasToken('snmp') || hasPort(161)) addFlag('snmp');
    if (hasToken('http')) addFlag('http');
    if (hasToken('http2')) addFlag('http2');
    if (hasToken('tls') || hasToken('ssl') || hasPort(443)) addFlag('tls');
    if (hasToken('dns') || hasPort(53)) addFlag('dns');
    if (hasToken('icmp')) addFlag('icmp');
    if (hasPort(5985) || hasPort(5986)) addFlag('winrm');

    if ((hasToken('smb') || hasToken('smb2')) && ports.length) {
      const smbPorts = new Set([445, 139]);
      const nonStandard = ports.some((p) => !smbPorts.has(p));
      if (nonStandard) addFlag('smb_nonstandard_port');
    }

    const protocolEntries = Object.entries(s.protocol_chains)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([chain, count]) => ({ chain, count }));

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
      protocols: protocolEntries.length ? protocolEntries : undefined,
    };
  });

  for (const session of sessionList) {
    if (session.transport !== 'udp') continue;
    const duration = session.duration_seconds ?? Math.max(0, session.last_ts - session.first_ts);
    timeline.push({
      ts: session.last_ts,
      session_id: session.id,
      kind: 'udp_session_summary',
      summary: `UDP summary: ${session.packet_count} packets, ${session.byte_count} bytes, ${duration.toFixed(2)}s`,
      evidence_frame: session.evidence.last_frame,
    });
  }

  sessionList.sort((a, b) => (a.first_ts !== b.first_ts ? a.first_ts - b.first_ts : a.id.localeCompare(b.id)));
  timeline.sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : a.evidence_frame - b.evidence_frame));

  logInfo('tshark.analyze.complete', {
    file_name: opts.session.fileName,
    packets: packetCount,
    sessions: sessionList.length,
    timeline_events: timeline.length,
    duration_ms: Date.now() - startedAt,
  });

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
