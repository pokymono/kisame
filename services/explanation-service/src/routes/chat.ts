/**
 * Chat route handler using AI SDK
 */
import { json } from '../utils/response';
import { processChat } from '../ai';
import type { ChatQueryRequest, AnalysisArtifact } from '../types';

/**
 * POST /chat - Handle chat queries
 */
export async function handleChat(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as ChatQueryRequest | null;
  
  if (!body?.query) {
    return json({ error: 'Expected JSON body: { query, context? }' }, { status: 400 });
  }

  const response = await processChat(body.query, body.context);
  return json(response);
}
