import { analyzeWithTshark, type AnalyzeOptions } from './analyzer';

type WorkerMessage =
  | { ok: true; artifact: unknown }
  | { ok: false; error: string };

type WorkerGlobal = {
  postMessage: (payload: WorkerMessage) => void;
  onmessage: ((event: MessageEvent<AnalyzeOptions>) => void) | null;
};

const workerGlobal = globalThis as unknown as WorkerGlobal;

const sendMessage = (payload: WorkerMessage) => {
  workerGlobal.postMessage(payload);
};

workerGlobal.onmessage = async (event: MessageEvent<AnalyzeOptions>) => {
  try {
    const artifact = await analyzeWithTshark(event.data);
    sendMessage({ ok: true, artifact });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendMessage({ ok: false, error: message });
  }
};
