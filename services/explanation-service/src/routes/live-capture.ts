import { json } from '../utils/response';
import {
  listCaptureInterfaces,
  startLiveCapture,
  stopLiveCapture,
  getLiveCapture,
  getLiveCaptureStats,
} from '../pcap';
import { getClientId } from '../utils/client';

export async function handleListCaptureInterfaces(): Promise<Response> {
  try {
    const interfaces = await listCaptureInterfaces();
    return json({ interfaces });
  } catch (error) {
    return json({ error: (error as Error).message ?? String(error) }, { status: 500 });
  }
}

export async function handleStartLiveCapture(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    | {
        interface?: string;
        duration_seconds?: number;
        max_packets?: number;
        file_name?: string;
        capture_filter?: string;
      }
    | null;

  try {
    const ownerId = getClientId(req);
    const capture = await startLiveCapture({
      interfaceId: body?.interface,
      durationSeconds: body?.duration_seconds,
      maxPackets: body?.max_packets,
      fileName: body?.file_name,
      captureFilter: body?.capture_filter,
      ownerId,
    });

    return json({
      capture_id: capture.id,
      interface: {
        id: capture.interfaceId,
        name: capture.interfaceName,
      },
      file_name: capture.fileName,
      started_at: capture.startedAt,
      status: 'running',
    });
  } catch (error) {
    return json({ error: (error as Error).message ?? String(error) }, { status: 500 });
  }
}

export async function handleStopLiveCapture(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { capture_id?: string } | null;
  if (!body?.capture_id) {
    return json({ error: 'Expected JSON body: { capture_id }' }, { status: 400 });
  }

  try {
    const ownerId = getClientId(req);
    const result = await stopLiveCapture(body.capture_id, ownerId);
    return json({
      capture_id: body.capture_id,
      status: 'stopped',
      exit_code: result.exitCode,
      session_id: result.session.id,
      file_name: result.session.fileName,
      size_bytes: result.session.sizeBytes,
      created_at: result.session.createdAt,
    });
  } catch (error) {
    return json({ error: (error as Error).message ?? String(error) }, { status: 500 });
  }
}

export async function handleGetLiveCapture(req: Request, captureId: string): Promise<Response> {
  const ownerId = getClientId(req);
  const capture = getLiveCapture(captureId);
  if (!capture || (capture.ownerId && capture.ownerId !== ownerId)) {
    return json({ error: 'Unknown capture_id' }, { status: 404 });
  }

  const stats = getLiveCaptureStats(captureId);
  const sizeBytes = stats?.sizeBytes ?? 0;
  const packetCount = stats?.packetCount ?? 0;
  const status = capture.exitCode == null ? 'running' : capture.exitCode === 0 ? 'stopped' : 'error';
  const stderrPreview = capture.stderr?.trim();
  const errorMessage =
    status === 'error'
      ? stderrPreview
        ? stderrPreview.slice(0, 400)
        : 'Capture process exited with an error.'
      : undefined;

  return json({
    capture_id: capture.id,
    status,
    exit_code: capture.exitCode ?? null,
    interface: { id: capture.interfaceId, name: capture.interfaceName },
    file_name: capture.fileName,
    started_at: capture.startedAt,
    ended_at: capture.endedAt,
    size_bytes: sizeBytes,
    packet_count: packetCount,
    error: errorMessage,
  });
}
