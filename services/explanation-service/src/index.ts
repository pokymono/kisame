import { json, noContent } from './utils/response';
import { initPcapStorage } from './pcap';
import {
  handleHealth,
  handleTsharkVersion,
  handlePcapUpload,
  handlePcapGet,
  handleAnalyzePcap,
  handleExplainSession,
  handleListCaptureInterfaces,
  handleStartLiveCapture,
  handleStopLiveCapture,
  handleGetLiveCapture,
  handleChat,
  handleChatStream,
} from './routes';

await initPcapStorage();

const port = Number(process.env.PORT ?? 8787);
const idleTimeout = Number(process.env.IDLE_TIMEOUT ?? 120);

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method;

  if (method === 'OPTIONS') {
    return noContent();
  }

  if (method === 'GET' && pathname === '/health') {
    return handleHealth(port);
  }

  if (method === 'GET' && pathname === '/tshark/version') {
    return handleTsharkVersion();
  }

  if (method === 'POST' && pathname === '/pcap') {
    return handlePcapUpload(req);
  }

  if (method === 'GET' && pathname === '/capture/interfaces') {
    return handleListCaptureInterfaces();
  }

  if (method === 'POST' && pathname === '/capture/start') {
    return handleStartLiveCapture(req);
  }

  if (method === 'POST' && pathname === '/capture/stop') {
    return handleStopLiveCapture(req);
  }

  if (method === 'GET' && pathname.startsWith('/capture/')) {
    const id = pathname.split('/')[2] || '';
    return handleGetLiveCapture(id);
  }

  if (method === 'GET' && pathname.startsWith('/pcap/')) {
    const id = pathname.split('/')[2] || '';
    return handlePcapGet(id);
  }

  if (method === 'POST' && pathname === '/tools/analyzePcap') {
    return handleAnalyzePcap(req);
  }

  if (method === 'POST' && pathname === '/explain/session') {
    return handleExplainSession(req);
  }

  if (method === 'POST' && pathname === '/chat/stream') {
    return handleChatStream(req);
  }

  if (method === 'POST' && pathname === '/chat') {
    return handleChat(req);
  }

  return json({ error: 'Not found' }, { status: 404 });
}

Bun.serve({
  port,
  fetch: handleRequest,
  idleTimeout,
});

console.log(`explanation-service listening on http://localhost:${port}`);
console.log('Modules loaded: pcap, ai, routes');
console.log(`AI SDK: ${process.env.OPENAI_API_KEY ? 'API key configured' : 'No API key (placeholder mode)'}`);
