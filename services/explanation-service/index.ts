function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers ?? {}),
    },
  });
}

type PcapSession = {
  id: string;
  fileName: string;
  filePath: string;
  createdAt: string;
  sizeBytes: number;
};

type AnalysisArtifact = {
  schema_version: number;
  generated_at: string;
  pcap: {
    session_id: string;
    file_name: string;
    size_bytes: number;
    packets_analyzed: number;
    first_ts: number | null;
    last_ts: number | null;
  };
  tooling: { tshark_path: string; tshark_version: string | null };
  sessions: Array<{
    id: string;
    transport: 'tcp' | 'udp' | 'other';
    endpoints: { a: { ip: string; port: number | null }; b: { ip: string; port: number | null } };
    first_ts: number;
    last_ts: number;
    duration_seconds: number;
    packet_count: number;
    byte_count: number;
    evidence: { first_frame: number; last_frame: number; sample_frames: number[] };
    rule_flags: string[];
  }>;
  timeline: Array<{ ts: number; session_id: string; kind: string; summary: string; evidence_frame: number }>;
};

const DATA_DIR = Bun.env.KISAME_DATA_DIR ?? `${process.cwd()}/.data`;
const PCAP_DIR = `${DATA_DIR}/pcaps`;
await Bun.mkdir(PCAP_DIR, { recursive: true });

const sessions = new Map<string, PcapSession>();

function utcNowIso() {
  return new Date().toISOString();
}

function resolveTsharkPath(): string {
  if (Bun.env.TSHARK_PATH && Bun.env.TSHARK_PATH.trim()) return Bun.env.TSHARK_PATH.trim();
  return 'tshark';
}

async function tsharkVersion(tsharkPath: string): Promise<string | null> {
  try {
    const proc = Bun.spawn([tsharkPath, '--version'], { stdout: 'pipe', stderr: 'pipe' });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    const firstLine = text.split('\n')[0]?.trim();
    return firstLine || null;
  } catch {
    return null;
  }
}

function safeInt(v: string | undefined): number | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : null;
}

function safeFloat(v: string | undefined): number | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function sha1Hex12(input: string) {
  const bytes = new TextEncoder().encode(input);
  // @ts-expect-error Bun supports crypto for sha1
  const hash = Bun.CryptoHasher ? new (Bun as any).CryptoHasher('sha1').update(bytes).digest('hex') : null;
  if (hash) return String(hash).slice(0, 12);
  // Fallback: non-cryptographic but stable-ish (dev only)
  let acc = 0;
  for (const b of bytes) acc = (acc * 31 + b) >>> 0;
  return acc.toString(16).padStart(8, '0').slice(0, 8);
}

function canonicalEndpoint(ip: string, port: number | null) {
  return { ip, port };
}

function canonicalPair(
  srcIp: string,
  srcPort: number | null,
  dstIp: string,
  dstPort: number | null
): { a: { ip: string; port: number | null }; b: { ip: string; port: number | null } } {
  const aKey = `${srcIp}:${srcPort ?? -1}`;
  const bKey = `${dstIp}:${dstPort ?? -1}`;
  if (aKey <= bKey) return { a: canonicalEndpoint(srcIp, srcPort), b: canonicalEndpoint(dstIp, dstPort) };
  return { a: canonicalEndpoint(dstIp, dstPort), b: canonicalEndpoint(srcIp, srcPort) };
}

async function analyzeWithTshark(opts: {
  session: PcapSession;
  maxPackets?: number;
  sampleFramesPerSession: number;
}): Promise<AnalysisArtifact> {
  const tsharkPath = resolveTsharkPath();
  const version = await tsharkVersion(tsharkPath);

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

  const header = lines[0].split('\t').map((h) => h.replaceAll('"', ''));
  const idx = (name: string) => header.indexOf(name);
  const at = (row: string[], name: string) => {
    const i = idx(name);
    if (i < 0) return '';
    const raw = row[i] ?? '';
    return raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
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
    const row = lines[i].split('\t');
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
    if (s.evidence.sample_frames.length < opts.sampleFramesPerSession) {
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

function explainSession(artifact: AnalysisArtifact, sessionId: string) {
  const session = artifact.sessions.find((s) => s.id === sessionId);
  if (!session) return { session_id: sessionId, text: `Unknown session_id ${sessionId}.`, evidence_frames: [] as number[] };

  const a = `${session.endpoints.a.ip}${session.endpoints.a.port ? `:${session.endpoints.a.port}` : ''}`;
  const b = `${session.endpoints.b.ip}${session.endpoints.b.port ? `:${session.endpoints.b.port}` : ''}`;
  const evidenceFrames = [session.evidence.first_frame, ...session.evidence.sample_frames, session.evidence.last_frame].filter(
    (n, i, arr) => arr.indexOf(n) === i
  );
  const timeline = artifact.timeline.filter((e) => e.session_id === sessionId).slice(0, 8);
  const preview = timeline.map((e) => `- ${new Date(e.ts * 1000).toISOString()} ${e.summary} (#${e.evidence_frame})`).join('\n');
  const flags = session.rule_flags.length ? `Rule flags: ${session.rule_flags.join(', ')}.` : '';

  const text = [
    `Session ${session.id} (${session.transport.toUpperCase()}) observed between ${a} and ${b}.`,
    `Time range: ${new Date(session.first_ts * 1000).toISOString()} → ${new Date(session.last_ts * 1000).toISOString()}.`,
    `Volume: ${session.packet_count} packets, ${session.byte_count} bytes.`,
    flags,
    `Evidence frames: first #${session.evidence.first_frame}, last #${session.evidence.last_frame}.`,
    timeline.length ? `Timeline (first ${timeline.length} events):\n${preview}` : `Timeline: no decoded events for this session.`,
  ]
    .filter(Boolean)
    .join('\n');

  return { session_id: sessionId, text, evidence_frames: evidenceFrames };
}

const port = Number(process.env.PORT ?? 8787);

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'explanation-service', port });
    }

    if (req.method === 'GET' && url.pathname === '/tshark/version') {
      const tsharkPath = resolveTsharkPath();
      const version = await tsharkVersion(tsharkPath);
      return json({ tshark_path: tsharkPath, tshark_version: version });
    }

    // Upload raw PCAP bytes. Headers: x-filename (optional). Response: { session_id }.
    if (req.method === 'POST' && url.pathname === '/pcap') {
      const fileName = (req.headers.get('x-filename') || 'capture.pcap').split(/[\\/]/).pop() || 'capture.pcap';
      const buf = new Uint8Array(await req.arrayBuffer());
      const id = crypto.randomUUID();
      const filePath = `${PCAP_DIR}/${id}-${fileName.replaceAll(/[^a-zA-Z0-9._-]/g, '_')}`;
      await Bun.write(filePath, buf);
      const s: PcapSession = { id, fileName, filePath, createdAt: utcNowIso(), sizeBytes: buf.byteLength };
      sessions.set(id, s);
      return json({ session_id: id, file_name: fileName, size_bytes: buf.byteLength });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/pcap/')) {
      const id = url.pathname.split('/')[2] || '';
      const s = sessions.get(id);
      if (!s) return json({ error: 'Unknown session_id' }, { status: 404 });
      return json({ session_id: s.id, file_name: s.fileName, size_bytes: s.sizeBytes, created_at: s.createdAt });
    }

    // Tool: AnalyzePCAP (runs tshark) -> artifact JSON
    if (req.method === 'POST' && url.pathname === '/tools/analyzePcap') {
      const body = (await req.json().catch(() => null)) as
        | { session_id?: string; max_packets?: number; sample_frames_per_session?: number }
        | null;
      const sessionId = body?.session_id;
      if (!sessionId) return json({ error: 'Expected JSON body: { session_id }' }, { status: 400 });
      const s = sessions.get(sessionId);
      if (!s) return json({ error: 'Unknown session_id' }, { status: 404 });
      try {
        const artifact = await analyzeWithTshark({
          session: s,
          maxPackets: body?.max_packets,
          sampleFramesPerSession: body?.sample_frames_per_session ?? 8,
        });
        return json(artifact);
      } catch (e) {
        return json({ error: (e as Error).message ?? String(e) }, { status: 500 });
      }
    }

    // Deterministic explanation endpoint (AI SDK can replace this later)
    if (req.method === 'POST' && url.pathname === '/explain/session') {
      const body = (await req.json().catch(() => null)) as
        | { artifact?: AnalysisArtifact; session_id?: string }
        | null;
      if (!body?.artifact || !body?.session_id) {
        return json({ error: 'Expected JSON body: { artifact, session_id }' }, { status: 400 });
      }
      return json(explainSession(body.artifact, body.session_id));
    }

    return json({ error: 'Not found' }, { status: 404 });
  },
});

console.log(`explanation-service listening on http://localhost:${port}`);
