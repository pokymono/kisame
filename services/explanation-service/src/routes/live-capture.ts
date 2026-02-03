import { json } from '../utils/response';
import {
  listCaptureInterfaces,
  startLiveCapture,
  stopLiveCapture,
  getLiveCapture,
} from '../pcap';

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
    const capture = await startLiveCapture({
      interfaceId: body?.interface,
      durationSeconds: body?.duration_seconds,
      maxPackets: body?.max_packets,
      fileName: body?.file_name,
      captureFilter: body?.capture_filter,
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
    const result = await stopLiveCapture(body.capture_id);
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

export async function handleGetLiveCapture(captureId: string): Promise<Response> {
  const capture = getLiveCapture(captureId);
  if (!capture) {
    return json({ error: 'Unknown capture_id' }, { status: 404 });
  }
  return json({
    capture_id: capture.id,
    status: 'running',
    interface: { id: capture.interfaceId, name: capture.interfaceName },
    file_name: capture.fileName,
    started_at: capture.startedAt,
  });
}
