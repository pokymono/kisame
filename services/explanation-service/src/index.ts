import { json, noContent } from './utils/response';
import { logDebug, logError, logInfo, toErrorMeta } from './utils/logger';
import { initPcapStorage } from './pcap';
import {
  handleHealth,
  handleTsharkVersion,
  handlePcapUpload,
  handlePcapGet,
  handlePcapList,
  handleAnalyzePcap,
  handleExplainSession,
  handleListCaptureInterfaces,
  handleStartLiveCapture,
  handleStopLiveCapture,
  handleGetLiveCapture,
  handleChat,
  handleChatStream,
  handleReport,
} from './routes';

await initPcapStorage();

const port = Number(process.env.PORT ?? 8787);
const idleTimeout = Number(process.env.IDLE_TIMEOUT ?? 120);

async function handleRequest(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method;

  if (method === 'OPTIONS') {
    return noContent();
  }

  const clientIp =
    req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? undefined;
  logInfo('http.request', {
    id: requestId,
    method,
    path: pathname,
    client_ip: clientIp,
  });

  let response: Response | undefined;

  try {
    if (method === 'GET' && pathname === '/health') {
      response = await handleHealth(port);
    } else if (method === 'GET' && pathname === '/tshark/version') {
      response = await handleTsharkVersion();
    } else if (method === 'POST' && pathname === '/pcap') {
      response = await handlePcapUpload(req);
    } else if (method === 'GET' && pathname === '/pcap/list') {
      response = await handlePcapList(req);
    } else if (method === 'GET' && pathname === '/capture/interfaces') {
      response = await handleListCaptureInterfaces();
    } else if (method === 'POST' && pathname === '/capture/start') {
      response = await handleStartLiveCapture(req);
    } else if (method === 'POST' && pathname === '/capture/stop') {
      response = await handleStopLiveCapture(req);
    } else if (method === 'GET' && pathname.startsWith('/capture/')) {
      const id = pathname.split('/')[2] || '';
      response = await handleGetLiveCapture(req, id);
    } else if (method === 'GET' && pathname.startsWith('/pcap/')) {
      const id = pathname.split('/')[2] || '';
      response = await handlePcapGet(req, id);
    } else if (method === 'POST' && pathname === '/tools/analyzePcap') {
      response = await handleAnalyzePcap(req);
    } else if (method === 'POST' && pathname === '/explain/session') {
      response = await handleExplainSession(req);
    } else if (method === 'POST' && pathname === '/chat/stream') {
      response = await handleChatStream(req);
    } else if (method === 'POST' && pathname === '/chat') {
      response = await handleChat(req);
    } else if (method === 'POST' && pathname === '/report') {
      response = await handleReport(req);
    } else {
      response = json({ error: 'Not found' }, { status: 404 });
    }
  } catch (error) {
    logError('http.error', { id: requestId, method, path: pathname, error: toErrorMeta(error) });
    response = json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    const durationMs = Date.now() - startedAt;
    logDebug('http.response', {
      id: requestId,
      method,
      path: pathname,
      status: response?.status,
      duration_ms: durationMs,
    });
  }

  if (!response) {
    return json({ error: 'Internal server error' }, { status: 500 });
  }
  return response;
}

Bun.serve({
  port,
  fetch: handleRequest,
  idleTimeout,
});

logInfo('service.start', { port, idle_timeout: idleTimeout });
logInfo('service.modules', { modules: ['pcap', 'ai', 'routes'] });
logInfo('ai.config', {
  api_key_configured: Boolean(process.env.OPENAI_API_KEY),
  model: process.env.OPENAI_MODEL ?? 'gpt-5.2',
});
