import { corsHeaders, json } from '../utils/response';
import { processChat, streamChat } from '../ai';
import type { ChatQueryRequest } from '../types';

export async function handleChat(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as ChatQueryRequest | null;

  if (!body?.query) {
    return json({ error: 'Expected JSON body: { query, context? }' }, { status: 400 });
  }

  const response = await processChat(body.query, body.context);
  return json(response);
}

export async function handleChatStream(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as ChatQueryRequest | null;

  if (!body?.query) {
    return json({ error: 'Expected JSON body: { query, context? }' }, { status: 400 });
  }

  const stream = streamChat(body.query, body.context);

  return new Response(stream, {
    headers: {
      ...corsHeaders(),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
