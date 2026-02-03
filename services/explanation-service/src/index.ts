/**
 * Explanation Service - Main Entry Point
 * 
 * A modular Bun-based service for PCAP analysis and AI-powered chat.
 */
import { json } from './utils/response';
import { initPcapStorage } from './pcap';
import {
  handleHealth,
  handleTsharkVersion,
  handlePcapUpload,
  handlePcapGet,
  handleAnalyzePcap,
  handleExplainSession,
  handleChat,
} from './routes';

// Initialize storage
await initPcapStorage();

const port = Number(process.env.PORT ?? 8787);

/**
 * Main request router
 */
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method;

  // Health check
  if (method === 'GET' && pathname === '/health') {
    return handleHealth(port);
  }

  // TShark version
  if (method === 'GET' && pathname === '/tshark/version') {
    return handleTsharkVersion();
  }

  // PCAP upload
  if (method === 'POST' && pathname === '/pcap') {
    return handlePcapUpload(req);
  }

  // PCAP get session
  if (method === 'GET' && pathname.startsWith('/pcap/')) {
    const id = pathname.split('/')[2] || '';
    return handlePcapGet(id);
  }

  // Analyze PCAP
  if (method === 'POST' && pathname === '/tools/analyzePcap') {
    return handleAnalyzePcap(req);
  }

  // Explain session
  if (method === 'POST' && pathname === '/explain/session') {
    return handleExplainSession(req);
  }

  // Chat endpoint
  if (method === 'POST' && pathname === '/chat') {
    return handleChat(req);
  }

  return json({ error: 'Not found' }, { status: 404 });
}

// Start server
Bun.serve({
  port,
  fetch: handleRequest,
});

console.log(`explanation-service listening on http://localhost:${port}`);
console.log('Modules loaded: pcap, ai, routes');
console.log(`AI SDK: ${process.env.OPENAI_API_KEY ? 'API key configured' : 'No API key (placeholder mode)'}`);
