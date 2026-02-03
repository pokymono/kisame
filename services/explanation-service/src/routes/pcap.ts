/**
 * PCAP-related route handlers
 */
import { json } from '../utils/response';
import { storePcap, getSession, analyzeWithTshark, getTsharkInfo, explainSession } from '../pcap';
import type { AnalysisArtifact } from '../types';

/**
 * GET /tshark/version - Get TShark version info
 */
export async function handleTsharkVersion(): Promise<Response> {
  const info = await getTsharkInfo();
  return json(info);
}

/**
 * POST /pcap - Upload a PCAP file
 */
export async function handlePcapUpload(req: Request): Promise<Response> {
  const fileName = (req.headers.get('x-filename') || 'capture.pcap').split(/[\\/]/).pop() || 'capture.pcap';
  const buf = new Uint8Array(await req.arrayBuffer());
  
  const session = await storePcap(fileName, buf);
  
  return json({
    session_id: session.id,
    file_name: session.fileName,
    size_bytes: session.sizeBytes,
  });
}

/**
 * GET /pcap/:id - Get session info
 */
export function handlePcapGet(sessionId: string): Response {
  const session = getSession(sessionId);
  if (!session) {
    return json({ error: 'Unknown session_id' }, { status: 404 });
  }
  return json({
    session_id: session.id,
    file_name: session.fileName,
    size_bytes: session.sizeBytes,
    created_at: session.createdAt,
  });
}

/**
 * POST /tools/analyzePcap - Analyze a PCAP file
 */
export async function handleAnalyzePcap(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    | { session_id?: string; max_packets?: number; sample_frames_per_session?: number }
    | null;
  
  const sessionId = body?.session_id;
  if (!sessionId) {
    return json({ error: 'Expected JSON body: { session_id }' }, { status: 400 });
  }
  
  const session = getSession(sessionId);
  if (!session) {
    return json({ error: 'Unknown session_id' }, { status: 404 });
  }
  
  try {
    const artifact = await analyzeWithTshark({
      session,
      maxPackets: body?.max_packets,
      sampleFramesPerSession: body?.sample_frames_per_session ?? 8,
    });
    return json(artifact);
  } catch (e) {
    return json({ error: (e as Error).message ?? String(e) }, { status: 500 });
  }
}

/**
 * POST /explain/session - Get explanation for a session
 */
export async function handleExplainSession(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    | { artifact?: AnalysisArtifact; session_id?: string }
    | null;
  
  if (!body?.artifact || !body?.session_id) {
    return json({ error: 'Expected JSON body: { artifact, session_id }' }, { status: 400 });
  }
  
  return json(explainSession(body.artifact, body.session_id));
}
