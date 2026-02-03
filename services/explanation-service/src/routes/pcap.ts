import { json } from '../utils/response';
import { storePcap, getSession, analyzeWithTshark, getTsharkInfo, explainSession } from '../pcap';
import type { AnalysisArtifact } from '../types';

export async function handleTsharkVersion(): Promise<Response> {
  const info = await getTsharkInfo();
  return json(info);
}

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

  const maxPackets =
    typeof body?.max_packets === 'number' && Number.isFinite(body.max_packets)
      ? Math.max(0, Math.floor(body.max_packets))
      : undefined;
  const sampleFramesPerSession =
    typeof body?.sample_frames_per_session === 'number' && Number.isFinite(body.sample_frames_per_session)
      ? Math.max(0, Math.floor(body.sample_frames_per_session))
      : 8;

  try {
    const artifact = await analyzeWithTshark({
      session,
      maxPackets,
      sampleFramesPerSession,
    });
    return json(artifact);
  } catch (e) {
    return json({ error: (e as Error).message ?? String(e) }, { status: 500 });
  }
}

export async function handleExplainSession(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    | { artifact?: AnalysisArtifact; session_id?: string }
    | null;
  
  if (!body?.artifact || !body?.session_id) {
    return json({ error: 'Expected JSON body: { artifact, session_id }' }, { status: 400 });
  }
  
  return json(explainSession(body.artifact, body.session_id));
}
