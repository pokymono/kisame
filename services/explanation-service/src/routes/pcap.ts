import { json } from '../utils/response';
import { logInfo, logWarn, logError, toErrorMeta } from '../utils/logger';
import { ConcurrencyLimiter, QueueFullError } from '../utils/concurrency';
import { storePcap, getSessionForOwner, listSessions, analyzeWithTshark, getTsharkInfo, explainSession } from '../pcap';
import type { AnalysisArtifact } from '../types';
import type { AnalyzeOptions } from '../pcap/analyzer';
import { getClientId } from '../utils/client';

const analyzeLimiter = new ConcurrencyLimiter(
  Number(process.env.ANALYZE_MAX_CONCURRENCY ?? 3),
  Number(process.env.ANALYZE_QUEUE_LIMIT ?? 8)
);

async function analyzeInWorker(opts: AnalyzeOptions): Promise<AnalysisArtifact> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../pcap/analyze-worker.ts', import.meta.url), {
      type: 'module',
    });

    const timeoutMs = Number(process.env.ANALYZE_WORKER_TIMEOUT_MS ?? 0);
    const timeoutId =
      timeoutMs > 0
        ? setTimeout(() => {
            worker.terminate();
            reject(new Error('Analysis worker timed out.'));
          }, timeoutMs)
        : null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      worker.terminate();
    };

    worker.onmessage = (event: MessageEvent<{ ok: boolean; artifact?: AnalysisArtifact; error?: string }>) => {
      cleanup();
      if (event.data.ok && event.data.artifact) {
        resolve(event.data.artifact);
        return;
      }
      reject(new Error(event.data.error ?? 'Analysis worker failed.'));
    };

    worker.onerror = (error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    worker.postMessage(opts);
  });
}

async function runAnalysis(opts: AnalyzeOptions): Promise<AnalysisArtifact> {
  if (process.env.ANALYZE_USE_WORKER === '0') {
    return analyzeWithTshark(opts);
  }
  return analyzeInWorker(opts);
}

export async function handleTsharkVersion(): Promise<Response> {
  logInfo('pcap.tshark.version');
  const info = await getTsharkInfo();
  return json(info);
}

export async function handlePcapUpload(req: Request): Promise<Response> {
  const fileName = (req.headers.get('x-filename') || 'capture.pcap').split(/[\\/]/).pop() || 'capture.pcap';
  const buf = new Uint8Array(await req.arrayBuffer());
  logInfo('pcap.upload.start', { file_name: fileName, size_bytes: buf.byteLength });
  
  const ownerId = getClientId(req);
  const session = await storePcap(fileName, buf, ownerId);
  logInfo('pcap.upload.complete', { session_id: session.id, file_name: session.fileName, size_bytes: session.sizeBytes });
  
  return json({
    session_id: session.id,
    file_name: session.fileName,
    size_bytes: session.sizeBytes,
  });
}

export function handlePcapGet(req: Request, sessionId: string): Response {
  const ownerId = getClientId(req);
  const session = getSessionForOwner(sessionId, ownerId);
  if (!session) {
    logWarn('pcap.get.missing', { session_id: sessionId });
    return json({ error: 'Unknown session_id' }, { status: 404 });
  }
  return json({
    session_id: session.id,
    file_name: session.fileName,
    size_bytes: session.sizeBytes,
    created_at: session.createdAt,
  });
}

export function handlePcapList(req: Request): Response {
  const ownerId = getClientId(req);
  const sessions = listSessions(ownerId);
  return json({
    total: sessions.length,
    sessions: sessions.map((session) => ({
      session_id: session.id,
      file_name: session.fileName,
      size_bytes: session.sizeBytes,
      created_at: session.createdAt,
    })),
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
  
  const ownerId = getClientId(req);
  const session = getSessionForOwner(sessionId, ownerId);
  if (!session) {
    logWarn('pcap.analyze.missing', { session_id: sessionId });
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

  logInfo('pcap.analyze.start', {
    session_id: sessionId,
    file_name: session.fileName,
    max_packets: maxPackets ?? null,
    sample_frames_per_session: sampleFramesPerSession,
  });

  let release: (() => void) | null = null;
  try {
    try {
      release = await analyzeLimiter.acquire();
    } catch (error) {
      if (error instanceof QueueFullError) {
        logWarn('pcap.analyze.queue_full', { session_id: sessionId, ...analyzeLimiter.stats() });
        return json(
          { error: 'Analyze queue is full. Please retry shortly.', ...analyzeLimiter.stats() },
          { status: 429 }
        );
      }
      throw error;
    }

    const startedAt = Date.now();
    const artifact = await runAnalysis({
      session,
      maxPackets,
      sampleFramesPerSession,
    });
    logInfo('pcap.analyze.complete', {
      session_id: sessionId,
      packets_analyzed: artifact.pcap.packets_analyzed,
      session_count: artifact.sessions.length,
      timeline_events: artifact.timeline.length,
      duration_ms: Date.now() - startedAt,
    });
    return json(artifact);
  } catch (e) {
    logError('pcap.analyze.error', { session_id: sessionId, error: toErrorMeta(e) });
    return json({ error: (e as Error).message ?? String(e) }, { status: 500 });
  } finally {
    if (typeof release === 'function') {
      release();
    }
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
